# CARD-0047 review of a89e8f9

Outcome: one confirmed P2 defect; return to implementation before closing the card.
No application code changed. Temporary browser probes were removed after execution.

## P2 — Mobile-to-desktop resize leaves a nowrap table's toggle over its header

In `src/web-viewer/src/ui/table-controls.js:5-13`, `--gutter-offset` is refreshed
only by the first row's ResizeObserver callback. A wide nowrap table retains its
row dimensions when its scrollport changes width. Crossing the gutter breakpoint
therefore changes the container's position without notifying this observer.

Reproduction with the real reader and styles:

1. At a 699px viewport, open a Markdown table with a header containing `wide`
   repeated 150 times, followed by a second column. Include a normal body row.
2. Turn wrapping off. Wait for the layout/observer update.
3. Resize to 700px, then 701px or 900px.

The article acquires 44px of left padding, and `container.offsetLeft` becomes 44,
but the inline `--gutter-offset` remains `0px`. The absolute toolbar is placed
at the table's left edge, covering its first header characters instead of sitting
in the gutter. A screenshot at 701px visually confirmed the overlap.

| Viewport | Button right | Table left | Cached offset | Actual container offset |
| --- | ---: | ---: | ---: | ---: |
| 700px | 117.1875 | 85.1875 | 0px | 44px |
| 701px | 396.390625 | 364.390625 | 0px | 44px |
| 900px | 402.375 | 370.375 | 0px | 44px |

Fix: update horizontal positioning when the surface layout/breakpoint changes,
independently of row-size notifications, or express the gutter offset in CSS so
the breakpoint cannot stale it. Preserve nested-table alignment and observer
cleanup. Add a regression starting below the breakpoint with a wide nowrap table
and resizing above it; existing tests only exercise fresh boundary layouts and
resizes where row dimensions change.

## Confirmed working

- Independent fresh-load probes at **699, 700 and 701px** measured 32×32px visual
  controls. All four corners at ±21.5px from the centre hit the actual button,
  confirming its 44×44px pseudo-element target. At 699px article padding is zero
  and the button is above the table; at 700/701px padding is 44px and the button
  sits left of the table. Desktop centre alignment error was 0.5078125px.
- Existing browser tests activate the invisible hit extension, verify the plain
  default state and quiet `rgb(226, 236, 245)` tint when wrapping is off, and
  exercise Enter/Space and independent per-table state.
- Wrapped/multiline headers align within 1px and update on wrapping, resizing and
  CSS zoom when row dimensions change. Missing ResizeObserver uses top alignment.
- Nested quote/list tables share the article gutter in the tested layouts.
- Reader redraw/source/navigation/clear and preview nested replacement/close
  explicitly abort their surfaces; the abort handlers disconnect their row
  observers. Instrumented browser tests confirm old observed rows are released.
- Preview table controls remain isolated. The preview, table, comment selection,
  exact quote and export regression suites pass.
- README describes the locked 32/44px sizes, quiet tint, below-700px fallback and
  observer lifecycle accurately, subject to the transition defect above.

## Validation

- `npm test`: **111 passed, 0 failed**.
- `npm run test:browser`: **52 passed, 0 failed**.
- `python tests/validate-export.py test-results/browser-review.mdpkg`:
  **25 checks passed, 0 failed** (run before the isolated probes cleared the
  Playwright output directory).
- Independent browser probes: **3 fresh-boundary cases passed, 1 transition case
  failed**, with overlap reproduced at all three desktop widths above.
- Build gates passed. No .NET changes; .NET tests were not rerun for this CSS/JS
  review. Physical-device/native-zoom testing was not performed.

Pre-existing untracked design files and the CARD-0044 review document were left
untouched. This review adds only this report. Sticky controls remain out of scope.
