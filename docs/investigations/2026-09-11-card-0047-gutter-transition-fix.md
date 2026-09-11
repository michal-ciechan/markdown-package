# CARD-0047 gutter breakpoint transition fix

The wrap control now moves into the gutter when a wide, unwrapped table crosses
from 699px to 700px, even when the first row's dimensions do not change.

## Change

- `src/web-viewer/src/ui/table-controls.js` shares the existing offset calculation
  between row-size notifications and a `(width < 700px)` media-query change
  listener, matching the CSS breakpoint. The rendered surface's abort signal
  removes the listener when the reader or preview replaces or closes its surface.
- Containers are captured before the rendered fragment is inserted into the DOM.
  With ResizeObserver unavailable, no new listener or inline offset is installed;
  the existing CSS top-aligned fallback remains in use.
- `src/web-viewer/tests/tables.spec.js` adds two transition regressions, with and
  without ResizeObserver. Both disable wrapping at 699px and resize through
  700, 701, 900, 699 and 700px. They assert unchanged row dimensions, gutter/above
  placement, and the appropriate vertical alignment and offset behavior.

No CSS, hit-target, pressed-style, preview navigation or row-observer lifecycle
behavior was changed.

## Validation

The new ResizeObserver-enabled test failed against the original implementation
with the reported overlap; the fallback test passed. Both pass after the fix.
The review's temporary reproduction scripts were removed according to its report;
the new regression recreates its wide-table input and resize sequence.

Commands run from `src/web-viewer`:

- `npm test`: 111 passed, 0 failed.
- `npm run test:browser`: 54 passed, 0 failed (52 existing plus 2 new).
- `python tests/validate-export.py test-results/browser-review.mdpkg`:
  25 checks passed, 0 failed.
- Build gates passed: 130,019 / 133,145 eager gzip bytes.
- `git diff --check`: passed.

Existing browser coverage for hit targets, fresh breakpoint layouts, nested
tables, row alignment, observer cleanup and preview isolation passed. No .NET
code changed; .NET tests were not rerun.

Pre-existing untracked `docs/design/`, the CARD-0044 preview review and the
CARD-0047 gutter review were preserved and excluded from this fix's commit.
