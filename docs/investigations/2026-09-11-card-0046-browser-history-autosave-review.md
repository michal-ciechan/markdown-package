# CARD-0046 review of 0aba329

Outcome: two confirmed findings; return to implementation before closing CARD-0046.
No application code changed.

## P1 — Inconsistent restore reads can silently orphan another tab's durable draft

Locations: `src/web-viewer/src/persistence/session.js:165-180` and
`src/web-viewer/src/persistence/store.js:79-104`.

`prepare` reads the package pointer, review and draft in separate readonly
transactions. It can therefore combine an old active-draft pointer with a newer
review revision. A tombstoned old draft leaves the expected draft key/revision
unset. `work` compares the review and expected draft revisions, but does not
compare the package's current active-draft pointer with the expected pointer.
It then replaces that pointer with the incoming draft's key.

Confirmed with two real Chromium pages sharing real IndexedDB. Only delivery of
one package-read completion was delayed; stored values and transaction behavior
were not fabricated:

1. Tab 1 saves draft A against the whole document.
2. Tab 2 begins reopening that package; pause after its package-record read has
   captured the pointer to A, before the restore code consumes the result.
3. Tab 1 cancels A, selects the first section, and saves draft B. Both writes
   complete. A now has a tombstone, while the package points to B.
4. Release Tab 2's read. It reads the newer review revision but looks up the old
   A pointer and sees a tombstone. It restores no editor and permits new authoring.
5. In Tab 2 select the whole document and compose C, a different target from B.
6. C is saved successfully, with **zero conflict records**. The package's active
   pointer changes from B to C. Both live draft rows exist in IndexedDB, but B is
   no longer reachable through normal restore or the recovery panel.

Observed keys with the original fixture:

- B: `61b14a3e47fd30699eb763e78a0ef1c47e86a7d6ca1fef9d26b2cc91a3ca8368`
- C, the resulting active pointer:
  `57e454110d5dd7ad62b4f2d43b80b6737a274b44fe79c36fcd4719e57ede7aaf`

This is silent loss of discoverability, not physical deletion of B's row. The
recovery UI enumerates explicit conflicts and the package's active pointer; it
does not enumerate orphan live drafts. A control using B's same target correctly
produced a conflict, explaining why ordinary conflicting-edit tests pass.

Fix: obtain package/review/active-draft state from a consistent readonly
transaction before validating it asynchronously. Also compare the active pointer
as part of the write transaction's expected state, so an inconsistent or stale
session cannot replace another live draft. Preserve any displaced work in explicit
recovery, and cover this draft-switch-during-restore interleaving.

Reproduction retained at
`C:\src\markdown-package\.antiphon\task-6c362e40-repro.spec.js`.
It also includes the passing original-anchor composition check. To rerun, copy
it to `src/web-viewer/tests/antiphon-autosave.spec.js`, then from `src/web-viewer`:

```powershell
npx playwright test tests/antiphon-autosave.spec.js --project chromium
```

The probe uses the original package fixture and real application controls. Its
expected active-pointer assertion fails on this commit. Remove the temporary
test copy after review; the retained `.antiphon` copy is outside the normal suite.

## P2 — Unconditional startup code escapes the unchanged bundle ceiling

`src/web-viewer/src/main.js:65` unconditionally imports the persistence module
during startup. This is not delayed until a user requests an optional feature.
The existing gate at `src/web-viewer/build.mjs:159-165` includes the static graph
and dynamic Git closures, so it excludes the newly introduced session chunk.

Verified build values:

| Measure | Gzip bytes |
| --- | ---: |
| Reported V-2 static-plus-Git closure | 131,838 |
| Excluded startup session chunk | 8,592 |
| Same accounting including persistence startup | 140,430 |
| Approved Review ceiling | 133,145 |
| Excess | 7,285 |

The technical gate passes, but splitting immediately requested application code
out of its accounting defeats the budget's purpose. The README/build report
disclose this accurately; disclosure does not make it compliance with the
approved plan's unchanged build gates. This finding concerns the effect of the
split, not an assertion about the implementer's intent.

Count all startup-loaded capability chunks in V-2 and reduce cost to fit, or
obtain an explicit budget change through the project's approval process. Do not
close this as a within-budget implementation on the current measurement.

## Confirmed working

- No package Blob/File copy or complete archive buffer is persisted. Write paths
  store metadata, structured-cloned handles, positions, review/draft envelopes,
  pointers and conflict recovery. Prepared exports/object URLs are excluded.
  Selected quotes can naturally include the full selected scope, as approved.
- `packageKey` uses canonical JSON of the five-part manifest tuple. Existing
  tests establish renamed-snapshot reuse and isolation of different namespaces;
  tuple tests also distinguish commits and profiles. Stored selectors and full
  normalized document digests are validated on reattachment.
- Original editor context is captured at editor-open time. An independent
  runtime probe changed the section during composition and confirmed the saved
  target retained the original quote. The 400ms/1,500ms timer implementation,
  input snapshots, blur/hidden/pagehide flushes and Cancel generation checks are
  present. Standard cancel/submit and retry-ID tests pass.
- Ordinary two-tab edits and stale writes after package deletion are rejected
  transactionally and retained as conflicts. The P1 finding is the distinct
  inconsistent-restore/active-pointer case above.
- Startup uses permission queries only; requesting permission/picking requires
  explicit actions. Denied/missing access and changed identity have fallback or
  explicit mismatch flows. Permission tests use injected doubles.
- Storage denial, quota retry, abort, future-version recovery, blocked opens and
  versionchange cases pass their executable checks. No automatic database wipe
  or unrelated-storage clearing exists in application recovery code. Failed
  saves retain the in-memory authoring/export path and last committed draft.
- Preview, gutter, table rendering, selection and review-export regression tests
  pass. No dependency or .NET change was introduced.
- README describes persistence, exact-snapshot limits, retention/deletion,
  browser capability fallback and local-save versus export status. Both docs
  explicitly mark native Chrome/Edge/Android file-provider and Safari/iOS device
  acceptance untested; Playwright WebKit is not presented as native Safari proof.

## Validation and limitations

- `npm test`: **116 passed, 0 failed**.
- `npm run test:browser`: **145 passed, 2 failed** out of 147:
  Chromium 85/85, Firefox 31/31, WebKit 29/31. WebKit's ordinary two-tab test
  timed out waiting for saving, and its paste test timed out waiting for open.
- Isolated rerun with
  `npx playwright test tests/persistence.spec.js --project webkit -g 'two tabs preserve|paste inputs retain'`:
  **2 passed, 0 failed**. These timeouts were not reproduced in isolation;
  this review does not claim a clean single full-suite run.
- `python tests/validate-export.py test-results/browser-review.mdpkg`:
  **25 checks passed, 0 failed**, against the full run's Chromium export before
  the isolated rerun cleared the output directory.
- Final independent probes: **1 passed, 1 failed** (original-anchor preservation
  passed; inconsistent hydration silently replaced the active draft pointer).
- Build/dependency/path gates report pass, subject to the P2 accounting finding.
- No physical-device/native-provider testing was performed.

This report and the retained `.antiphon` reproduction are the only deliverables.
Temporary test/config files were removed. Pre-existing untracked design files and
the prior CARD-0044/CARD-0047 review documents were left untouched.
