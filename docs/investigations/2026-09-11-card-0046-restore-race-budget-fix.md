# CARD-0046 restore race and startup budget correction

The restore race is fixed. Release remains blocked by the unchanged bundle
ceiling: the honestly counted candidate is 138,602 gzip bytes, 5,457 over 133,145.
No allowance was increased and the production build refuses to emit assets.

## Storage correction

`src/web-viewer/src/persistence/store.js` now reads the package record, review,
active draft and resume record within one readonly IndexedDB transaction.
`session.js` validates that completed snapshot asynchronously and uses the same
snapshot for recovery text. Startup also reads its package/resume state together.

The work transaction compares the package's active-draft pointer with the
session's expected pointer, alongside the existing review/draft revision checks.
A mismatch stores the incoming envelope in `conflicts`; it cannot replace the
live pointer. Tombstoned pointers retain their expected key/revision. Attachment
also retains the captured deletion generation instead of adopting a newer
generation while refreshing recent-package metadata.

Two browser regressions use real IndexedDB:

- The review's two-tab draft-switch interleaving: A is saved, Tab 2's read
  completion is held after its transaction releases its locks, Tab 1 cancels A
  and saves B, and Tab 2 resumes. Tab 2 restores the consistent A snapshot;
  its subsequent incoming C goes to visible recovery. Package/resume pointers
  still identify B, and reattachment restores B through the ordinary UI.
- A save with the current review revision but an absent expected draft pointer
  must conflict independently of the revision guard. The live draft and both
  pointers remain unchanged; incoming C is retained in recovery.

No stored values or native transaction semantics are fabricated in the first
regression; only delivery of a completed read is delayed. The second supplies
stale expectations directly to the store API, using real stored envelopes.

## Bundle accounting and optimization

`build-graph.mjs` follows every reachable dynamic import by default, including
nested startup capabilities, and counts shared chunks/CSS once. The existing
conditional DEFLATE fallback is the sole explicit exclusion: it is requested
only for compressed package entries when native raw decompression is unavailable.
The Git writer remains counted despite loading only on export. Two Node tests
cover nested dynamic startup imports, shared dependencies, CSS, and the rule
that an explicitly deferred entry still counts if imported statically.

`main.js` now bundles unconditional persistence startup with the application.
Its promise still catches initialization failures so in-memory use remains
available. Consolidation eliminates separate session/shared transfers and saves
1,915 gzip bytes compared with the corrected code left split. No parser,
permission, authoring, export, preview or gutter implementation was changed.

All measurements below use the pinned esbuild and per-file level-9 gzip method:

| Candidate | Budgeted gzip bytes | Excess |
| --- | ---: | ---: |
| Reviewed implementation, counting startup honestly | 140,430 | 7,285 |
| Storage fix with the old startup split | 140,517 | 7,372 |
| Retained: consolidate unconditional startup | 138,602 | 5,457 |
| Trial: consolidated with UTF-8 output | 138,701 | 5,556 |
| Trial: consolidated with legal comments omitted | 137,736 | 4,591 |

UTF-8 output did not help. Omitting legal comments was only a measurement probe;
it still fails and was not retained. License notices remain in the output.
Further splitting would increase transfer overhead unless functionality were
actually deferred; moving automatic history/resume work behind another startup
import would still count under the corrected gate. No such exclusion was added.
These bounded optimizations did not reach the ceiling. This is not a claim that
all possible broader architectural optimizations have been exhausted.

The retained build consists of 97,164 gzip bytes in the initial static graph
(including CSS) and 41,438 in the Git writer: 138,602 budgeted bytes. The optional
inflater adds 2,343, for **140,945 gzip bytes across all emitted candidate assets**.
`build-report.json` records both budgeted and all-assets totals. README now
describes the honest accounting and build failure.

## Validation

- `npm test`: **118 passed, 0 failed** (116 existing plus two graph tests).
- Full `npx playwright test`: **153 passed, 0 failed**, in one 5.1-minute run:
  Chromium 87/87, Firefox 33/33, WebKit 33/33. This includes six new executions
  of the two persistence regressions, and all existing preview/gutter cases.
- `python tests/validate-export.py test-results/browser-review.mdpkg`:
  **25 passed, 0 failed**, against that run's Chromium export before the
  subsequent isolated regression control cleared the test output directory.
- Negative control: the new draft-switch test against the reviewed `0aba329`
  store/session source **failed as expected (1/1)**: restoration yielded empty
  input instead of the consistent A snapshot. The harness compiles old sources
  through an esbuild plugin without changing tracked files.
- After restoring the fixed candidate, both focused regressions passed again
  in all three engines: **6 passed, 0 failed**.
- V-1 dependency/calibration, lazy Git graph and deployment-path checks pass.
  **V-2 fails**, solely on 138,602 > 133,145 gzip bytes.

The two WebKit cases reported as timeouts during review (ordinary two-tab
conflict/deletion and paste opening) both pass in this full run, without retries.
The new race tests also pass in WebKit. The prior timeouts were not reproduced;
their cause remains unestablished, so no unrelated timeout/product change or
claim of having fixed a flake is made. This is engine automation; no additional
native-file-provider or physical-device acceptance is claimed.

The final `npm run test:browser` invocation exits 1 at V-2, before starting
Playwright, and leaves only `dist/build-report.json`. Behavioral verification
therefore uses a temporary local bundle
generated with the same production esbuild options, without changing the budget
or claiming a successful production build. Local harness:
`C:\src\markdown-package\.antiphon\task-77699f72-test-build.mjs`.

Reproduce the behavioral run from the repository root, then the viewer directory:

```powershell
node .antiphon/task-77699f72-test-build.mjs
Set-Location src/web-viewer
npm test
npx playwright test
python tests/validate-export.py test-results/browser-review.mdpkg
npm run build
```

The final command intentionally fails V-2 and clears the temporary deployable
assets, leaving only the diagnostic build report. No bypass was added to the
production build, package scripts or CI.

## Decision and repository scope

Decide whether to authorize a revised ceiling using the measured 138,602-byte
candidate, or commission further optimization/feature deferral to retain 133,145.
Until then this is not a passing build or a release-ready CARD-0046 completion.

The pre-existing untracked `docs/design/` directory and CARD-0044, CARD-0046 and
CARD-0047 review documents belong to other work and are left untouched. Only
this task's explicit source, test and documentation paths are committed.
