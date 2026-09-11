# CARD-0049 targeted verification of b819791

Outcome: both original defects are fixed, but one newly introduced hover regression remains. Return to code before closing CARD-0049. No application code was changed during verification.

## New regression: P2 — pending source preview is lost after quick reader exit/re-entry

Location: `src/web-viewer/src/ui/inline-comments.js:65`, `:200`, `:204`.

Reproduce with a real authored comment on `target` in the original fixture:

1. Collapse the fold and dismiss any tooltip.
2. Move onto the annotated word, starting the 250ms preview timer.
3. Before it opens, move outside the reader and return to the same annotated word within the 150ms dismissal grace period.
4. Stop moving. The tooltip never appears; another pointer movement is needed to restart it.

The new code records `hoverTarget` and `hoverIds` when scheduling. The reader's `pointerleave` handler then cancels that pending preview and substitutes a dismissal timer without clearing this identity. Returning to the same anchor matches the stored identity at line 200, so the preview is not rescheduled. The delayed dismissal fires even though the pointer is back over the anchor.

Confirmed three times each in Chromium, Firefox and WebKit: **9/9 current-code reproductions left the tooltip hidden** after 600ms. With the prior hover source from `903fab5` substituted into an isolated, in-memory browser bundle, **9/9 equivalent sequences showed the preview**. Gesture sequences were 9–102ms, below both relevant delays. The working-tree source and production assets were not altered for this comparison.

Fix cancellation/re-entry handling so a cancelled pending preview can restart on returning to the same hit set, and cancel a scheduled dismissal when appropriate. Add regression coverage for exit/re-entry while the preview is pending, retaining the adjacent/overlapping hit-set coverage.

## Confirmed fixed and retained

- Original adjacent-word preview: independent Chromium checks verified every step of `target -> words -> before -> words -> target -> before`, plus rapid five-transition movement and changing overlapping/non-overlapping hit sets. The preview followed the correct thread at each settled step. The committed regression additionally exercises equal-sized overlap sets and broad-anchor-only text in all three browsers.
- Original hidden draft: requesting another comment from Read reveals and focuses the original composer. Independent checks preserved author, kind, exact Unicode/whitespace body, quote and target. Keyboard typing then worked, and the updated draft survived autosave/reload at its original anchor. The committed regression covers toolbar, text and section actions and verifies that saving produces only one thread at the original anchor.
- The six additional browser cases are two substantive regression tests run in Chromium, Firefox and WebKit, not duplicated empty assertions or changed timeouts. Existing 165 cases remain configured.
- The production changes are confined to hover identity tracking and the existing-draft presentation call. Existing integration tests continue to cover v2 authoring/replies/export, preview selection isolation, persistence, gutter clearance/table sizing and thread-state filtering.
- `903fab5` adds eleven design/review documents only: seven design files and four review reports. No runtime code, tracked-file modifications or deletions occur in that commit. The prior review's findings/evidence and all named mockups remain present; the cleanup is separate from the actual fix, with no evidence of lost artifacts.

## Verification results

- Unit suite: 120 passed, 0 failed.
- Production build: V-1/V-2 passed at 143,382 / 145,000 counted gzip bytes, matching the claim; 1,618 bytes headroom.
- Full Playwright suite: 171 passed, 0 failed (101 Chromium, 35 Firefox, 35 WebKit; 5.7 minutes). All 165 prior cases and six new regression cases passed; no checkpoint timeout recurred.
- Export validation: 25 independent ZIP/Git checks passed, 0 failed.
- Independent original-fix/extra-pattern/draft probe: passed, no page errors.
- New pending-preview regression: reproduced 9/9 on current code; prior-hover comparison succeeded 9/9.
- `git diff --check`: passed.

Evidence: `.antiphon/task-23c58925-{unit,build,browser,probe,compare,compare-firefox,compare-webkit}.log`.

Reproduce the independent comparison after `npm run build` and starting `node tests/server.mjs` from `src/web-viewer`: run `node .antiphon/task-23c58925-compare.mjs` from the repository root; append `firefox` or `webkit` for those engines. The script routes an isolated prior-hover bundle only in its comparison browser page and makes no source changes. `.antiphon/task-23c58925-probe.mjs` checks the original fixes, three-anchor/overlap transitions and draft autosave continuity.
