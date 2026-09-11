# CARD-0049: adjacent hover and hidden draft fixes

Addresses both confirmed P2 findings in
[the inline-comment review](2026-09-11-card-0049-inline-comments-review.md).

## Changes

- Hover identity now includes the ordered hit-thread IDs as well as the DOM
  target. The identity is recorded when scheduling a preview, so both pending
  and visible previews follow transitions between adjacent/overlapping ranges
  within the same paragraph. Dismissal clears that identity with the timer.
- The existing-draft guard calls the presentation hook before focusing the
  editor. Read mode therefore exits and reveals the retained composer before
  asking the reviewer to save or cancel it. The draft's context, fields and
  revision are not replaced or advanced by this reveal.
- Two new browser regressions run in Chromium, Firefox and WebKit. Hover checks
  cover adjacent words, pending previews, equal-sized overlapping hit sets and
  transitions to a single broader anchor. Draft checks cover the selection
  toolbar, Review selected text and Review selected section; they preserve the
  author, kind, exact body, original quote and target, then save one thread at
  that original anchor.

No changes to the selection verifier, v2 model/writer, persistence, cross-reference
preview, table/gutter code, README or bundle ceiling were needed.

## Verification

- Before the fix: both new Chromium tests failed at the reported stale-preview
  and hidden-editor assertions.
- After the fix: all six regression cases passed across the three engines.
- `npm test`: 120 passed, zero failures.
- `npm run build`: V-1, V-2 and deployment-path checks pass; 143,382 / 145,000
  gzip bytes, leaving 1,618 bytes of headroom. The fix adds 25 counted gzip bytes.
- Independent export validation: 25 ZIP/Git checks passed, zero failures.
- `npm run test:browser`: 171 passed, zero failures in one full production-build
  run (101 Chromium, 35 Firefox, 35 WebKit). This includes all 165 existing cases
  and the two new regressions in each of the three engines.
- `git diff --check`: passed.

Run from `src/web-viewer`: `npm test`, `npm run test:browser`, then
`python tests/validate-export.py test-results/browser-review.mdpkg`.
For only the new regressions, use
`npx playwright test inline-comment-regressions.spec.js` after building.

The previous isolated WebKit checkpoint timeout did not recur in this full run
and has no newly established cause.
The review's ten successful reruns do not prove an environmental root cause;
no timeout setting or unrelated restoration behavior was changed here.

## Working-tree cleanup

The brief explicitly required resolving earlier uncommitted artifacts and a
clean working tree. Commit `903fab5` tracks the eleven existing design/review
documents separately from this fix, including the CARD-0049 review. Their content
was preserved, apart from removing excess trailing blank lines in that review.
