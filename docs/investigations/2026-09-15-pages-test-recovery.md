# Pages test recovery — evidence for Code 98eb8a0a

Base `ef70683d3e81ba808184da75c3e0b4a8766ecf7c`; original landing owner
`98eb8a0a`. [Verification plan](../superpowers/plans/2026-09-15-pages-test-recovery.md).
Raw evidence is under
`C:\Antiphon\worktrees\card-task-98eb8a0a\.antiphon\evidence-98eb8a0a`.

## Confirmed history

- Table failure introduced by `ef86e808c375823f206c556a8da5c95c54cd1468`
  (CARD-0048), first failing [run 34646957200](https://github.com/michal-ciechan/markdown-package/actions/runs/34646957200):
  156 passed, 1 failed, wrapper 317.625 against `<308`.
- Overlap hover test added by `9435faa65da876e65494ed878d9310499555648a`
  (CARD-0049). Its first browser run after the budget gate was approved,
  [34653884818](https://github.com/michal-ciechan/markdown-package/actions/runs/34653884818),
  failed overlap hover and the table test: 163 passed, 2 failed.
- Hit-set hover test added by `b81979128564a8002dfa2f68fe2c4bad204b9d12`
  (CARD-0049), immediately failing in
  [34655186703](https://github.com/michal-ciechan/markdown-package/actions/runs/34655186703).
  That run had 167 passed, 4 failed (the three current failures plus a historical
  one-pixel persistence assertion). All three current failures predate CARD-0052.
- Latest [34934030540](https://github.com/michal-ciechan/markdown-package/actions/runs/34934030540)
  verifies the exact supplied base: 186 passed, the three named failures, deploy
  skipped. Last successful Pages deployment remains run 34635802695.

## Table cause and fix

The application correctly sizes to natural content, bounded by the scrollport.
The original compact-table assertion assumes its text is at least 10px narrower
than the mobile content area, which depends on the installed system font.
The stock Playwright Linux image resolves system-ui to WenQuanYi Zen Hei;
GitHub's Ubuntu image has DejaVu Sans available. With DejaVu Sans installed in
the local image, the unchanged base exactly reproduces CI's 317.625px wrapper,
325.171875px natural table and 318px available width. All preceding column,
wrapper, scroll reachability and overflow assertions pass. Windows and the
stock Linux image both pass the original three targeted tests; Linux with
DejaVu reproduces the table failure (2 passed, 1 failed).

Add a ninth, deliberately short table as the compact-wrapper control. Keep the
same `< available - 10` assertion, all eight original tables and all natural
width, single-line, row-height, selection, scrolling and overflow assertions.
Retain the first table's compact assertion at desktop widths. No production CSS,
font, width threshold or timeout changes. Final verification passed below.

## Hover cause and fix

Both tests used raw viewport mouse coordinates immediately after clicking
Collapse folds. That click can scroll the page; a queued native scroll event
calls `hidePeek`, cancelling a pending hover. The correct word can receive the
pointer event and still never open a tooltip if scroll is dispatched afterward.
An event-recording probe with a native one-pixel scroll reproduced this on
unchanged production code: 6/10 hovers remained hidden, each with a scroll
event 0.5–1.0ms after the pointer event; 4/10 opened when scroll arrived first.
No timer or event handler was changed for this probe. A subsequent stationary
hover after scrolling settled opened correctly. Raw logs:
`geometry-linux-scroll.log` and diagnostic source `geometry-probe.mjs`.

Use paragraph-relative range coordinates with Playwright locator hover/click
actions, which wait for stable layout and verify the hit target. Both tests now
include a native scroll before the first hover. Preserve every tooltip identity,
overlap count, individual reachability and cycling assertion. The existing
clock-controlled 250ms preview/150ms dismissal test keeps its raw timed gestures.
No production behavior, timeout, retry policy or tooltip assertion changes.

Evidence limit: the unchanged hover tests passed locally on Windows and Linux,
including 10/10 diagnostic repetitions with two CPUs and CI=true. CI supplies
no trace artifact, so the exact event ordering in those historical CI runs is
inferred from the reproduced race and source, not directly observed there.
The table failure is an exact reproduction.

## Ordinary verification completed

Verified commit: `096c97fd34d03ccef26a9ca8a57c1c197896f71b`.
The final documentation/evidence commit changes no application or test source.
Branch: `fix/pages-tests-98eb8a0a`.
Exact worktree: `C:\Antiphon\worktrees\card-task-98eb8a0a`.
Production source is unchanged from the original base. Windows Node is 24.6.0;
the local Playwright 1.55.1 Noble image uses Node 22.19.0. CI uses Node 24; the
Node/build checks and Windows affected-file run cover Node 24 locally.

Commands below run from `src/web-viewer`. Browser runs reuse the same isolated
production build; the Linux server builds its separate test API in memory.

| ID | Actual outcome / command mapping |
| --- | --- |
| V-1 | Complete. Historical CI logs attribute all three failures before CARD-0052. Base Windows 3/3 and stock Linux 3/3 pass; Linux + DejaVu gives the exact table failure (2 pass, 1 fail). Instrumented original hover methods 10/10 pass; native queued-scroll probe reproduces hidden preview in 6/10, with the ordering limitation above. |
| V-2 | PASS. `node --test --test-reporter=tap tests/*.test.mjs` (the `npm test` file set): 193 passed, zero failed/skipped. `npm run build`: dependency, graph/budget and relative-path gates pass; 94,708 / 145,000 counted gzip bytes. |
| V-3 | PASS. Linux + DejaVu: `npx playwright test --reporter=line,json` expands to 189, all passed in 452.5s. Windows: `npx playwright test inline-comment-regressions.spec.js inline-comments.spec.js tables.spec.js --reporter=line,json` expands to 41, all passed in 84.5s. No retries, skips or flaky results. |
| V-4 | PASS. `python tests/validate-export.py test-results/browser-review.mdpkg` and the same command for `browser-commit-target.mdpkg`: 14 independent checks each, 28 passed, zero failed. Files came from the completed Linux run and were preserved before Windows replaced test-results. |
| V-5 | Verification PASS; build-output cleanup blocked. Fresh JSON reports match the complete `--list --reporter=json` method inventory and the intended Windows subset; every method ran exactly once and passed, with nonzero counts below. Five local documentation links, the workflow audit and `git diff --check` pass (README's illustrative package links are not filesystem links). Final source is committed/pushed. All owned commands and containers finished; the Docker dependency volume was removed. Automatic approval review rejected deletion of the generated dist directory with “blocked by policy”; it is retained at the path below. |
| R-1 | PASS via V-3: inline-comment-regressions, 9 Linux + 9 Windows. |
| R-2 | PASS via V-3: inline-comments, 8 Linux + 8 Windows. |
| R-3 | PASS via V-3: tables, 24 Linux + 24 Windows. |
| R-4 | PASS via V-3/V-4: snapshot, 15 Linux, plus both independent export validations. The real original.mdpkg fixture has typed snapshot current and history none. |
| R-5 | PASS via V-3: persistence, 99 Linux. |

This repository's viewer uses Node/Playwright, not .NET test classes or TRX.
Fresh TAP and JSON are the native evidence; no TRX count is claimed.

| File | Chromium | Firefox | WebKit | Linux total | Windows affected run |
| --- | ---: | ---: | ---: | ---: | ---: |
| inline-comment-regressions.spec.js | 3 | 3 | 3 | 9 | 9 |
| inline-comments.spec.js | 8 | — | — | 8 | 8 |
| persistence.spec.js | 33 | 33 | 33 | 99 | — |
| preview.spec.js | 17 | — | — | 17 | — |
| review.spec.js | 4 | — | — | 4 | — |
| selection.spec.js | 13 | — | — | 13 | — |
| snapshot.spec.js | 5 | 5 | 5 | 15 | — |
| tables.spec.js | 24 | — | — | 24 | 24 |
| Total | 107 | 41 | 41 | 189 | 41 |

### Evidence index

All paths below are relative to the absolute raw evidence root stated above.

- `ci-history.json`, `ci-latest.json`, `ci-latest-failed.log`, and
  `ci-{table,overlap,hitsets}-introduced.log`: remote history and failure details.
- `base-windows.{json,log}`, `base-linux.{json,log}`,
  `base-linux-dejavu.{json,log}`: unchanged-base results.
- `geometry-linux-dejavu.log`, `geometry-linux-timing.log`,
  `geometry-linux-scroll.log`, `hover-diagnostic.{json,log}`: geometry/event probes.
- `final-unit.tap`, `final-build.log`, `final-build-report.json`.
- `final-inventory.json`, `intended-methods.json`,
  `final-linux.{json,log}`, `final-windows.{json,log}`,
  `final-{linux,windows}-method-audit.json`: complete ordinary test evidence.
- `final-export-{snapshot,commit}.log`; `linux-browser-artifacts/` preserves the
  fresh exported packages and Linux screenshots.
- `live-before-open.json`, `live-before.png`, `live-before-build-report.json`,
  `live-before-main.js`, `live-before.html`: actual live-site baseline.

For Linux reproduction, use local image `mcr.microsoft.com/playwright:v1.55.1-noble`,
mount this worktree at `/work`, mount the preserved evidence `fonts/` directory
read-only at `/usr/share/fonts/truetype/dejavu`, and give
`/work/src/web-viewer/node_modules` its own volume. From `/work/src/web-viewer`,
run `fc-cache -f`, `npm ci`, then the relevant Playwright command above with
`CI=true` and `PLAYWRIGHT_JSON_OUTPUT_NAME` naming a fresh evidence report.
Do not run Windows and Linux browser jobs concurrently against these same outputs.

## Live deployment and remaining obligations

At 2026-09-15 07:52:06 UTC, an actual Chromium file-picker check on the live
Pages URL rejected the real typed snapshot fixture with
`Invalid manifest: version 1 requires a SHA-1 current commit`.
Its main.js SHA-256 is
`991a4986b72854c79eff6ad175fa3c079285c9a7e7d53647d59cab3c73aa3934`,
matching the live build report and differing from the current local build.
The site is still stale; no successful deployment or live compatibility is claimed.

The Code-stage contract prohibits landing, deploying and dispatching Pages here.
Ordinary read-only Review is next. The caller must record the companion
verification obligation, land original Code task **98eb8a0a**, then verify the
exact landed commit's Pages build and deploy run and a successful live typed
snapshot open. `integration.spec.js`'s two fresh-CLI modes are opt-in and are
not part of the 189-case default matrix; the workflow's later Python
CLI/browser/Core/Reviews acceptance gate remains part of that landing obligation.
It was not rerun locally for this test-only change.

After deployment, run from this worktree:
`node .antiphon/evidence-98eb8a0a/live-check.mjs` (without `--expect-legacy`).
That positive check requires guide.md to render from the actual typed fixture.
Record the successful workflow run URL and live result together.

All PC-1 variants (hit-set identity, cancellation recovery), PC-2 (cycling),
and PC-3 variants (compact wrapper, table width floor) remain pending for
explicitly commissioned post-land SourceLanding Mutation. No deliberate mutants
were executed. See the plan for exact methods, the possible equivalent
width-floor variant, and missing-control discovery for the pointer helper.
Physical-device checks remain outside the existing browser matrix. Restart: none.

Cleanup exception: the generated, ignored directory
`C:\Antiphon\worktrees\card-task-98eb8a0a\src\web-viewer\dist`
remains after automatic approval review rejected recursive removal, including a
separate literal-path removal after the absolute path and absence of redirection
were checked. No `bin-*` directories were created. No process remains running.
