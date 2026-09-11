# CARD-0049 hover-preview re-entry correction

The pending preview now restarts when the pointer briefly leaves the reader and returns to the same annotated word. The correction is confined to the hover lifecycle in `src/web-viewer/src/ui/inline-comments.js`; the retained-draft implementation is unchanged.

## Cause and correction

The previous fix recorded the target and thread IDs before the 250ms preview delay. Reader exit cancelled that delay but retained the identity until a separate 150ms dismissal expired. Same-anchor re-entry therefore skipped scheduling, and the dismissal then cleared the hover while the pointer was back over its anchor.

Pending cancellation now calls the full reset immediately, clearing the timer, identity, accessibility relationship and linked highlight. Visible previews retain a separate 150ms dismissal timer so the pointer can cross into the tooltip. Returning to an annotated source cancels that dismissal independently of the preview timer. Reader and comment-chip exit share the same cancellation helper; entering the tooltip cancels the dismissal timer.

## Regression coverage

`src/web-viewer/tests/inline-comment-regressions.spec.js` adds one case to each of Chromium, Firefox and WebKit. Real mouse events enter the annotated word, leave the reader after 50ms, return after another 50ms, and stop. A controlled browser clock confirms that the preview waits for its restarted delay and then opens without any further pointer movement. The case also covers leaving for unannotated text inside the same paragraph, returning while a visible preview awaits dismissal, and eventual dismissal when the pointer stays outside.

The new test failed against the unchanged production build from `b819791`: the tooltip remained hidden at the expected post-re-entry assertion. After the correction, all nine targeted cases passed across the three engines. The existing adjacent/overlapping-anchor test and retained-draft reveal/focus test remain unchanged and pass in that run.

## Validation

- Unit suite: 120 passed, 0 failed.
- Targeted browser suite: 9 passed, 0 failed.
- Production build: V-1/V-2 passed; 143,404 / 145,000 counted gzip bytes, leaving 1,596 bytes headroom. No ceiling change.
- Full browser suite: 174 passed, 0 failed (102 Chromium, 36 Firefox, 36 WebKit; 6.2 minutes). Includes all 171 existing cases and three new cross-browser cases.
- Independent export validation: 25 ZIP/Git checks passed, 0 failed.
- `git diff --check`: passed.

Run from `src/web-viewer`:

```powershell
npm test
npm run test:browser
python tests/validate-export.py test-results/browser-review.mdpkg
```

The formerly untracked review artifact, `docs/investigations/2026-09-11-card-0049-hover-draft-fixes-review.md`, is preserved in documentation-only commit `de48079`; only excess trailing blank lines were removed. The correction and this report are committed separately.
