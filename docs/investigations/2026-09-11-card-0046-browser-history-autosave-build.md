# CARD-0046 browser history and autosave implementation

Implemented against master `0a91471`, including CARD-0044 previews and CARD-0047
gutter controls. The approved metadata/read-handle scope is implemented without
whole-package Blob caching, original-file writes or browser Back/Forward routing.

## Behavior and integration

- Native IndexedDB schema v1 scopes its database name to the deployment base
  path. Separate stores hold packages, handles, positions, reviews, drafts,
  resume pointers and conflicts. No runtime dependency was added.
- Canonical structured manifest tuples identify snapshots; filenames are only
  hints. Full normalized source digests and existing reference/selector validation
  prevent feedback reattachment to changed text under a reused declared identity.
- Recent packages/documents are bounded to 20 each. Older authored work remains
  discoverable. Remove from recents and Delete saved work have separate effects.
- Enhanced picking is capability-detected, unrestricted and read-only. Stored
  granted handles can reopen automatically. Permission requests require an
  explicit Allow access gesture with the handle already loaded. Standard input,
  drop and paste preserve their file-only fallback. Invalid/cancelled candidates
  retain the current reader/editor; changed identities require an explicit choice.
- Editor inputs use 400 ms trailing / 1,500 ms maximum-wait saving. Immutable
  captures retain the original model/anchor, author, kind and exact body.
  Submit/reply/state changes save the review graph, namespace and existing IDs;
  submission and draft tombstoning share one transaction. Cancel invalidates
  pending captures. Retries do not regenerate submitted comment IDs.
- Draft/review revision checks and package deletion generations run inside
  read/write transactions. Conflicting tab writes retain their incoming snapshot
  in recovery. Reading-position transactions patch resume fields without erasing
  a newer active-draft pointer. Tab-local document pointers use guarded session
  storage, with global-pointer fallback.
- Viewport sampling uses animation-frame coalescing and 250 ms trailing /
  1,000 ms maximum-wait saving. Positions include the exact scope locator,
  source-position block, offset, fraction, source mode and full-source digest.
  Restore waits for layout; explicit navigation/input cancels delayed positioning.
  A draft in another document offers Resume draft in that document.
- Missing, changed or unsupported saved work is retained for copy/discard recovery.
  Quota handling prunes expendable history/handles and retries once. A blocked or
  unavailable store does not disable in-memory reading, authoring or export.
  Saved in this browser denotes transaction completion; Review not exported is
  independent. Beforeunload is registered only while local feedback is at risk.

Files: `src/web-viewer/src/persistence/{model,store,position,session}.js`,
`src/web-viewer/src/inbound/file-access.js`, `src/web-viewer/src/ui/recent-view.js`,
reader/review hooks, `main.js`, styles, README, test entry, persistence tests,
Playwright projects and Pages CI browser installation.

## Validation

Node tests: **116 passed, 0 failed**.

Final browser run: **147 passed, 0 failed** in 4.7 minutes: 85 Chromium,
31 Firefox and 31 WebKit cases. This includes recent-document section restoration
and the final open/restore guards.

Independent export validation: **25 ZIP/Git checks passed, 0 failures**.
This validation used the final run's Chromium download.

Browser tests cover real IndexedDB and application reload/reattachment, submitted
review/reply dependencies, cancel/submit transactions, repeated quote occurrences,
Unicode and incomplete fields, conflicts and stale deletion, quota/transaction
failures, future versions, retention, blocked upgrades, cleared site data,
drop/paste, picker cancellation, stale opens, source/viewport resume and per-tab
pointers. Permission outcomes are injected doubles, not native-provider evidence.

The initial permission-gesture test exposed self-cancellation of its pending open;
the corrected gesture starts a fresh generation. WebKit exposed a recovery-panel
rerender during a click; unchanged recovery content now retains its DOM. A test
expectation was corrected to use the canonical heading source (`## Part 2`).

## Browser/device matrix

Runtime versions obtained by launching the installed Playwright 1.55.1 browsers
on Windows:

| Runtime/device | Evidence |
| --- | --- |
| Chromium 140.0.7339.186 | 85 tests passed: real IndexedDB/fallback and existing viewer tests; 390px screenshots/touch emulation. |
| Firefox 141.0 | 31 real IndexedDB/fallback tests passed. |
| Playwright WebKit 26.0 | 31 real IndexedDB/fallback tests passed; not a Safari/device certification. |
| Native desktop Chrome and Edge | **Untested**: OS picker, grants across full browser restart, temporary/revoked permission, moved/deleted file/provider and changed native handle contents. |
| Chrome Android 132+ with local/cloud provider | **Untested** on a real device. |
| Safari macOS, iOS/iPadOS, other iOS browsers | **Untested** natively, including real public.data/provider selection. |
| Native Firefox desktop/Android | **Untested** outside the automated Firefox runtime. |

No universal native handle-reuse claim is made. Runtime capability checks remain
the product behavior. The remaining manual matrix is the one in the approved plan.

Desktop/phone/reload screenshots were inspected locally at:

- `C:\src\markdown-package\.antiphon\task-cf471d00-desktop.png`
- `C:\src\markdown-package\.antiphon\task-cf471d00-phone.png`
- `C:\src\markdown-package\.antiphon\task-cf471d00-resume.png`

## Build and cost

V-1 dependency/calibration, V-2 graph/budget and D-1 relative-path gates pass.
The final build's existing static-plus-Git measure is **131,838 / 133,145 gzip
bytes**. The ceiling, pinned dependencies and Git-loading boundary are unchanged.

Persistence is an isolated capability module requested at startup. Its separate
chunk is **8,592 gzip bytes** and is outside that existing V-2 closure; it is an
additional startup transfer, not a zero-cost feature. Static-plus-Git plus that
chunk totals **140,430 gzip bytes**. README explicitly documents this accounting;
the optional inflater remains separate. A capability-module load failure retains
in-memory authoring with the loss-prevention guard. Git still loads only for export.

## Rerun

From `C:\src\markdown-package\src\web-viewer`:

```powershell
npm ci
npx playwright install chromium firefox webkit
npm test
npm run test:browser
python tests/validate-export.py test-results/browser-review.mdpkg
```

Pages CI installs all three runtimes (`--with-deps`). Existing single-output
export tests stay Chromium-only so browser projects cannot overwrite their file.
Use `npx playwright test persistence.spec.js` for the persistence/fallback suite.

The recovery guarantee remains the last completed transaction. Browser eviction,
site-data clearing and uncommitted final keystrokes can lose work. Whole-package
caching and native/device acceptance remain outside this implementation's claims.
