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
font, width threshold or timeout changes. Final verification pending.

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
The table failure is an exact reproduction. Final ordinary verification pending.
