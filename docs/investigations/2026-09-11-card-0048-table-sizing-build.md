# CARD-0048 compact no-wrap sizing implementation

Implemented the measured no-wrap width-floor and compact-wrapper fix against
master `2fec61f`, including the landed preview, persistence and gutter changes.

## Change

In `src/web-viewer/src/styles.css`, no-wrap tables retain automatic layout and
max-content width, with `min-width: 0` replacing the forced 100% minimum. Only
their `.table-container.table-nowrap` wrappers use `width: fit-content`; the
existing zero minimum, 100% maximum and horizontal scrollport remain in force.
Wrapped tables keep full-width fixed layout. No JavaScript or parser change is
needed.

The earlier investigation predates CARD-0047's left gutter. The implementation
preserves that current control placement: desktop controls stay in the shared
article gutter, including nested tables. Below 700px, the control above the
table follows the compact wrapper's right edge. README explains content-sized
columns, compact wrappers and scrolling for genuinely wide one-line content.
Selective per-column wrapping remains outside this change.

## Focused regression coverage

Four Chromium cases reuse the investigation's eight-table Markdown fixture and
the existing real reader/production-layout test harness:

- At 1280, 800 and 390px, every column matches its widest rendered header/body
  content plus existing padding and collapsed borders, within 1px. These cases
  include dominant headers, empty cells, bold/link/code content, twelve columns,
  a single column and a nested table.
- Compact wrappers match natural content or mobile toolbar needs, bounded by
  available width. Wide tables can scroll to their last cell without page-level
  overflow. All cells stay on one line and row heights match the old sizing.
- Growing then shortening a body value expands/shrinks only the affected
  column. Natural widths and row heights stay stable across viewport changes.
- Compact and nested source selections still return exact quotes. Enter/Space
  retain focus on the same control after resizing, including at 200% CSS zoom.

The existing suite supplies independent toggle state, mobile tap/44px target,
source/render navigation, review selection, preview and observer-lifecycle
coverage. An isolated negative control with the old production CSS failed the
new desktop sizing test as expected: its first column exceeded its measured
natural width by about 72.9px. The fixed focused run passed all four cases.

## Validation

Build V-1/V-2 passes at **138,609 / 140,000 gzip bytes**, leaving 1,391 bytes
headroom. The approved CARD-0046 ceiling is retained; this CSS change adds seven
gzip bytes to the previous measured build.

- `npm test`: **118 passed, 0 failed**.
- `npm run test:browser`: **157 passed, 0 failed**, in one 5.1-minute run:
  Chromium 91/91, Firefox 33/33, WebKit 33/33. Sizing cases are Chromium-only;
  Firefox/WebKit run the existing persistence suite.
- `python tests/validate-export.py test-results/browser-review.mdpkg`:
  **25 independent ZIP/Git checks passed, 0 failed**.
- Negative control: **1 expected failure** with the old CSS, as described above.
- Visually inspected compact tables at desktop/narrow widths and 200% CSS zoom,
  plus wide and nested tables at 1280/390px. Compact content, bounded wide
  scrollports, shared desktop gutters and mobile controls render as intended.
  Focus remains visible after toggling; nested text selection retains its exact
  quote and existing selection toolbar.

Rerun from `C:\src\markdown-package\src\web-viewer`:

```powershell
npm test
npm run test:browser
python tests/validate-export.py test-results/browser-review.mdpkg
```

Focused sizing only, after building:

```powershell
npx playwright test tables.spec.js --project chromium -g 'no-wrap column'
```

The tests produce compact, wide and nested screenshots as
`test-results/table-sizing-{1280,800,390}.png`,
`table-sizing-{wide,nested}-{1280,800,390}.png`, and
`table-sizing-zoom.png`. Viewport/touch emulation and CSS zoom are browser
automation, not physical-device acceptance. No physical-device run is claimed.

Pre-existing untracked design and CARD-0044/0046/0047 review documents are left
untouched. Only this task's CSS, focused tests, README and this report are committed.
