# Pages test recovery — Code 98eb8a0a

Original Code task / landing owner: `98eb8a0a`.
Base: `ef70683d3e81ba808184da75c3e0b4a8766ecf7c`.
Branch: `fix/pages-tests-98eb8a0a`.
Worktree: `C:\Antiphon\worktrees\card-task-98eb8a0a`.

The supplied investigation/fix brief is the task's initial plan. This artifact
records its bounded verification design before implementation. No task-specific
landed plan, AGENTS.md, or docs/testing-and-build.md exists in this repository.
Antiphon .NET class/TRX commands do not apply to this JavaScript viewer: inspect
fresh Node TAP and Playwright JSON, with expanded file/project/method counts.

## Scope and implementation

Trace the two inline-hover failures and mobile compact-table failure through CI
and git history. Reproduce on the unchanged base before assigning cause. Fix the
cause without increasing timeouts, loosening assertions, or retrying failures.
If test setup embeds platform-dependent assumptions, replace them with explicit,
measurable setup and preserve the behavioral assertions. Document the Pages
test gate, manual dispatch, and stale-deployment monitoring gap.

Use producer-owned output in this isolated worktree (`src/web-viewer/dist`);
build once for each source state being verified and keep source frozen during
runs. Commit/push each meaningful slice before longer verification.

## Ordinary verification / coverage-to-file list

| ID | Command or bounded coverage | Expected cost |
| --- | --- | --- |
| V-1 | Read CI run/history and reproduce named failures on the unchanged base; record platform and historical introducing commits. | 2–6 min |
| V-2 | `npm test` (all `tests/*.test.mjs` unit files), then `npm run build` (dependency, graph/budget and relative-path gates). | <1 min |
| V-3 | `npx playwright test --reporter=line,json` (full configured matrix). The brief explicitly requests this sweep because Pages' all-tests gate and cross-cutting reader/layout/persistence/snapshot interaction block delivery. No files are unbounded outside `tests/*.spec.js`; `integration.spec.js` remains opt-in, as in the workflow's initial suite. Chromium runs all configured files; Firefox/WebKit run persistence, inline-comment-regressions and snapshot. | 5–10 min |
| V-4 | `python tests/validate-export.py test-results/browser-review.mdpkg` and the same for `browser-commit-target.mdpkg`. Independently verify the two exports from V-3. | <1 min |
| V-5 | Docs/workflow consistency, `git diff --check`, fresh report count/method audit, clean pushed state and owned-output cleanup. | <1 min |
| R-1 | V-3: `inline-comment-regressions.spec.js` — adjacent/overlap hit sets, cancelled preview re-entry, retained draft, every configured browser. | shared V-3 |
| R-2 | V-3: `inline-comments.spec.js` — individually reachable overlap/adjacent threads, mark cycling and source interaction. | shared V-3 |
| R-3 | V-3: `tables.spec.js` — natural column/wrapper bounds at 1280/800/390, scroll reachability, gutters, zoom and selection. Add focused platform-independent setup checks if investigation requires them. | shared V-3 |
| R-4 | V-3: `snapshot.spec.js` — open genuine typed snapshot fixtures, author/export, identity and invalid-input behavior in all three browsers; V-4 independently inspects exports. | shared V-3/V-4 |
| R-5 | V-3: `persistence.spec.js` — all configured persistence/draft/history methods across browsers; counts audited separately. | shared V-3 |

After a fix, target only affected files/methods unless this first final-state full
sweep is still outstanding. No test retries or timeout/threshold increases.

Platform refinement after V-1: run V-3's full matrix in the local Playwright
1.55.1 Noble image with DejaVu Sans (which exactly reproduces CI's table width).
Then run only `inline-comment-regressions.spec.js`, `inline-comments.spec.js`,
and `tables.spec.js` on Windows to check changed pointer/test setup across the
two font/layout environments (about two additional minutes). Unit/build output
comes from the isolated Windows worktree and is reused unchanged during browser
runs; the Linux test server's in-memory test API uses its own dependency volume.

## Pending deliberate controls (post-land Mutation only)

- PC-1 / hit-set identity: exact `source hover follows adjacent and overlapping
  hit sets within one paragraph` method; disable hit-set identity updates.
- PC-1 / cancellation recovery: exact `same-anchor re-entry restarts a cancelled
  preview and cancels visible dismissal` method; disable same-anchor recovery.
  No deliberate control runs in Code.
- PC-2: exact `overlapping and adjacent threads remain individually reachable
  and marks cycle` method: disable overlap click cycling.
- PC-3: exact `no-wrap columns and wrappers fit content at 390px` method:
  variants restoring full-width no-wrap wrappers and forced table width floors.
  Mutation owns missing-control discovery and precise expected assertions.

All five variants remain pending. The width-floor-only variant may be equivalent
while the compact wrapper remains; Mutation must discover and report that rather
than count a zero-effect change as a successful control. A deterministic control
for reverting the raw-pointer test helper has not been established. Historical
CI hover ordering lacks a trace artifact; ordinary probes demonstrate the native
scroll race, but cannot prove the exact event order of the old hosted runs.

## Handoff obligations

Ordinary read-only Review precedes landing. The caller records the companion
verification obligation and lands original Code task `98eb8a0a`; this Code task
does not merge, deploy or dispatch Pages. Then confirm the exact landed commit's
Pages build + deploy run and open a real CARD-0052 typed snapshot on the live
Pages URL, recording run URL, asset identity and successful document rendering.
Explicitly commission SourceLanding Mutation after landing. Restart: none.

Code settlement note: ordinary V/R checks passed. V-5's generated dist cleanup
was rejected by automatic approval review (“blocked by policy”); the evidence
report records its exact retained path. All owned commands/containers finished
and the task's Docker dependency volume was removed.
