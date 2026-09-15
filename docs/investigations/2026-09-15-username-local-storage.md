# Remembered review name — Code evidence

Implemented and ordinary-tested; read-only Review is next. No merge or deployment
was performed. Original Code task / landing owner: **46fbc379**. Restart: **none**.

- Branch: `feat/username-46fbc379`.
- Worktree: `C:\Antiphon\worktrees\card-task-46fbc379`.
- Base: `17f7d973a7d589941110daba46faf0cce7990c5e`.
- Final tested source: `c04ed8b2e71b5d85b1258ab2b18303a7b764464e`.
- The settlement commit adds only this evidence and the plan's settlement notes.
- [Plan and pending controls](../superpowers/plans/2026-09-15-username-local-storage.md).
- Raw evidence root: `C:\src\markdown-package\.antiphon\task-46fbc379-evidence`.

## Result

The review editor remembers names under `mdpkg-viewer:author-name`. Nonempty names
collapse to a small edit button; click/keyboard activation restores the input.
Typing updates the preference; blur/Enter collapses it, and Enter does not post
feedback. Clearing removes only that preference. Restored drafts retain their
exact authors, including empty values. Storage denial/quota errors preserve
in-tab authoring. Long names stay on one line with a full accessible name/title.

Changed production files: `src/web-viewer/src/ui/author-name.js`,
`src/web-viewer/src/ui/review-view.js`, and `src/web-viewer/src/styles.css`.
Added `tests/username.spec.js` and `tests/author-name-helper.js`; adapted the
persistence and two inline-comment fixtures to open the compact control before
editing. The Playwright configuration includes username cases in all engines.
The viewer README documents behavior, scope, clearing and the test command.

## Commands and final verification

Run from `src/web-viewer`, after `npm ci`. Build once, then reuse those assets.
`U` is the same Node unit glob as `npm test`, with explicit TAP output:

```text
U: node --test --test-reporter=tap tests/*.test.mjs
B: npm run build
P: npx playwright test username.spec.js persistence.spec.js review.spec.js inline-comments.spec.js inline-comment-regressions.spec.js snapshot.spec.js selection.spec.js preview.spec.js --output=/evidence/linux-output --reporter=line,json
W: npx playwright test username.spec.js --output=C:/src/markdown-package/.antiphon/task-46fbc379-evidence/windows-username-output --reporter=line,json
D1: npx playwright test persistence.spec.js --project=chromium --grep "committed checkpoint survives closing a page; new page resumes after reattachment$" --reporter=line,json
D2: npx playwright test snapshot.spec.js --project=webkit --grep "restore revalidates prepared bytes instead of trusting saved metadata$" --reporter=line,json
E: python tests/validate-export.py <evidence-root>/linux-results/browser-review.mdpkg
   python tests/validate-export.py <evidence-root>/linux-results/browser-commit-target.mdpkg
A: python <evidence-root>/audit-browser.py
   git diff --check
```

P ran in `mcr.microsoft.com/playwright:v1.55.1-noble`, with the worktree mounted
read-only at `/work`, the evidence root mounted at `/evidence`, isolated Linux
node_modules, and an external writable mount for exports at `test-results`.
It reused B's Windows-built assets. Windows used Node 24.6.0 and Playwright 1.55.1.
Set `PLAYWRIGHT_JSON_OUTPUT_NAME` for each invocation to retain its fresh JSON;
an identical P `--list --reporter=json` generated the intended method inventory.
D1/D2 used separate external output directories, also retained below.

| ID | Command mapping | Actual outcome |
| --- | --- | --- |
| V-1 | U | 193 passed, 0 failed/skipped |
| V-2 | B | dependency, graph/budget and relative-path gates passed; 95,061 / 145,000 eager gzip bytes |
| V-3 | P + W, username file | 33 Linux + 33 Windows passed |
| V-4 | A, docs/status/output audit | method/count/doc/diff checks passed; filesystem cleanup blocked by automatic approval review |
| R-1 | P, persistence; D1 | 99 Linux + 1 Windows passed |
| R-2 | P, review | 4 passed |
| R-3 | P, inline files | 17 passed |
| R-4 | P, snapshot/selection/preview; D2 | 45 Linux + 1 Windows passed |
| R-5 | E | 14 checks per export; 28 passed, 0 failed |

P: **198 passed**, 0 failed/skipped/retried, 9.6 minutes. W: **33 passed**,
0 failed/skipped/retried, 100.4 seconds. D1/D2: exactly one intended test each,
both passed (8.2/10.8 seconds). The audit compares all actual file/project/method
identities against discovery and verifies exactly one successful result per
final case, retry index zero. Final browser total including diagnostics: **233**.

| P file filter | Chromium | Firefox | WebKit | Expanded total |
| --- | ---: | ---: | ---: | ---: |
| username.spec.js | 11 | 11 | 11 | 33 |
| persistence.spec.js | 33 | 33 | 33 | 99 |
| review.spec.js | 4 | 0 | 0 | 4 |
| inline-comments.spec.js | 8 | 0 | 0 | 8 |
| inline-comment-regressions.spec.js | 3 | 3 | 3 | 9 |
| snapshot.spec.js | 5 | 5 | 5 | 15 |
| selection.spec.js | 13 | 0 | 0 | 13 |
| preview.spec.js | 17 | 0 | 0 | 17 |
| Total | 94 | 52 | 52 | 198 |

W repeats only username.spec.js (11 per engine). No native CLI code changed;
browser snapshot integrations and the independent export checks cover the touched
authoring boundary. No unbounded browser/full-assembly run was used.

## Failures retained, without relaxed assertions or retries

An initial run on `a596f054a104469e3c13a20abd57da7f5aaa1344` hit four strict
locator collisions because `Your name` also matched `Edit your name`. It was
stopped before source edits; a fifth worker was interrupted. The edit button now
has a distinct accessible label. This was our defect, fixed in the task branch.

The first complete Windows sweep on
`3ebb8f226f061809778692fb06957db97d53e387` selected 195 cases: 193 passed,
two failed at existing 5-second startup/restore assertions:

- Chromium D1: no `Choose file again` button after closing/reopening a page.
  The exact method failed at the same assertion on the unchanged base. This is
  verified pre-existing behavior in the Windows environment; its cause was not
  established or repaired by this card. Final D1 and Linux P both pass.
- WebKit D2: empty document title before authoring began. The exact method passed
  on the unchanged base and final source. It was not reproduced on the base;
  do not claim a confirmed pre-existing cause for this failure.

The final source did not change persistence startup or either assertion. These
intermittent Windows results remain a coverage/reliability limitation for Review.
Two initial diagnostic commands used an over-anchored grep and selected zero
cases; those are not verification evidence. The corrected reports each contain
one intended method. The first Linux attempt executed zero cases because the
default output directory could not be replaced beneath a read-only mount. Moving
runner output to `/evidence/linux-output` resolved that setup error.

## Evidence inventory

All paths below are relative to the raw evidence root:

- `unit.tap`, `build.log`, `build-report.json`: final U/B.
- `intended.json`, `browser.json`, `browser-linux.log`: final P discovery/results.
- `browser-audit.json`, `browser-audit.log`, `audit-browser.py`: every method,
  engine, count, status, retry index and start time, including supplemental runs.
- `windows-username.json` / `.log`, `windows-username-output/`: final W, including
  `username-remembered-names--9ae1e-y-and-fit-the-mobile-editor-chromium/username-mobile.png`.
  This final mobile screenshot was visually inspected.
- `head-checkpoint.json` / `.log`, `head-snapshot.json` / `.log`: final D1/D2.
- `base-checkpoint.json` / `.log`, `base-snapshot.json` / `.log`: unchanged-base
  diagnostic results; `base-build.log` records its isolated build.
- `linux-results/browser-review.mdpkg`, `linux-results/browser-commit-target.mdpkg`,
  `export-review.log`, `export-commit-target.log`: independent E evidence.
- `browser-before-refinement.json` / `.log`, `before-refinement-results/`:
  the two earlier Windows failures and their page snapshots.
- `browser-initial-label-failure.log`, `linux-output-setup.log`: earlier setup
  and implementation failures, not counted as passes.
- `focused-actions-before.json` / `.log`: the added Save/Cancel interaction check
  passed before the final layout/accessibility refinement.

All owned processes and the Docker container finished. The task-specific Docker
dependency volume was removed. Automatic approval review rejected the filesystem
cleanup command with **“blocked by policy”**. Retained generated outputs:

- `C:\Antiphon\worktrees\card-task-46fbc379\src\web-viewer\dist`
- `C:\Antiphon\worktrees\card-task-46fbc379\src\web-viewer\test-results`
- Disposable baseline checkout (with its own generated outputs):
  `C:\Antiphon\worktrees\base-46fbc379`

## Review / landing / Mutation handoff

All ten deliberate variants remain pending: PC-1 write/read; PC-2 collapse/reopen;
PC-3 update/clear; PC-4 draft precedence; PC-5 getter/write failures; PC-6 long-name
wrapping. No deliberate mutants were executed. Mutation owns exact-method
red/restore/green and missing-control discovery. Ordinary tests additionally cover
Enter preventing submit, focused Save/Cancel, literal display, empty draft
precedence and preservation of submitted authors; dedicated controls for these
were not assigned and should be considered by Mutation.

Physical devices and a full browser-process restart were not exercised; reload
and new-page/new-package persistence were. Live multi-tab synchronization is
outside scope. Live Pages acceptance remains outstanding by stage design.

Ordinary read-only Review next. Caller records the companion verification
obligation, then lands **original Code 46fbc379**. Confirm that exact landed
commit's Pages workflow build and deploy succeeded and exercise name persistence,
compact editing and edited-name persistence on the live GitHub Pages site before
card closure. Explicitly commission SourceLanding Mutation after landing.
Restart: **none**.
