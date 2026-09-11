# CARD-0049 review: 9435faa / 73db858

Outcome: two confirmed UI defects; return to code before closing CARD-0049. No application code was changed during this review.

## Defects (both P2)

1. **Adjacent source anchors can show the wrong thread's hover preview.** `src/web-viewer/src/ui/inline-comments.js:194` identifies the current hover by `event.target`, but separate ranges in the same text node share their parent paragraph as that target. Author separate real comments on `target` and `words` in the original fixture, hover `target` until the preview opens, then move directly onto `words`. The preview still says `Comment #1 / Feedback for target`; it should show thread #2. Reproduced in Chromium, Firefox and WebKit. Track the hit thread/range set as well as the DOM target, including changes between overlapping and non-overlapping portions. Add a browser regression covering two different hit sets in the same paragraph.

2. **Requesting another comment cannot recover an existing draft hidden by Read mode.** `src/web-viewer/src/ui/review-view.js:37` returns after `body.focus()` when a draft already exists. It never calls the presentation hook that exits Read mode (`inline-comments.js:93`). Start a draft, click Read, select another phrase and invoke Review selected text (the toolbar routes to the same action). The original editor stays invisible and unfocused while the status says to save or cancel it. Manually clicking Review recovers the retained text; this is an access/focus defect, not data loss. Reveal and focus the existing draft without replacing its context or contents, and cover this sequence in a browser test.

## Confirmed working

- Real data path: selection toolbar -> reader anchor verifier -> shared review editor -> `newComment` / `newThread` / `validateComments` -> v2 `review.threads` -> moved existing thread sections and composer -> `emitReview` -> `.mdpkg/review/comments.json`. There is no copied mockup data store. Replies retain their parent IDs; state updates and exported review data use the existing model.
- Feedback and composer nodes remain outside the main article. Empty spacers do not add text to source selection. Existing preview isolation and navigation checks pass, including an active table fold and paragraph fold while a cross-reference preview is open.
- Autosave and restored new-comment/reply drafts, source/render switches, namespace/ID preservation, Cancel, storage denial and export remain exercised through the persistence suite. The Read-mode defect above preserves the draft's contents.
- Two independently authored table threads keep two folds open. Additional measurements at 1280px and 390px, with wrap toggled, found no page overflow; both folds remained below their respective tables and below their gutter buttons. Fold widths were 724.78125px and 318px respectively. Existing table sizing tests also run in the full suite.
- Real overlapping comment/change-request threads cycle and have separate numbered chips; adjacent threads are directly reachable. Comment/change-request labels and colours, resolved/obsolete states, filtering and obsolete history work in the acceptance cases, subject to the hover defect above.
- Inspected the 390px composer screenshot: fields, feedback and actions stay within the fold. Existing tests also cover 200% CSS zoom at a 1280px viewport; this does not establish physical-device or native-zoom behaviour.
- README describes the shipped inline UI, source fallback, limits, persistence/export continuity and deferred imported-review attachment. The 145,000-byte constant has an adjacent explanation of the 4,748-byte measured feature cost, prior 138,609-byte checkpoint, app-only allocation and 1,643-byte headroom, matching the CARD-0046 documentation pattern.

## Verification

- `npm test`: 120 passed, 0 failed.
- `npm run build`: passed; 143,357 / 145,000 counted gzip bytes, V-1/V-2 and deployment-path checks passed.
- Full production-build Playwright run: 165 passed, 0 failed (99 Chromium, 33 Firefox, 33 WebKit; 5.6 minutes), including all 8 inline acceptance cases. The existing suite remains green despite the two independently reproduced defects above.
- `python tests/validate-export.py test-results/browser-review.mdpkg`: 25 independent ZIP/Git checks passed, 0 failed.
- WebKit checkpoint reproduction: 10/10 passed using the original 5-second assertion deadline. Measured reattachment-to-restored-text times were 980–1,234ms. The checkpoint also passed in this full browser run. No restoration failure or fold animation race was reproduced; there is no fold animation in this implementation. These results support treating the earlier isolated timeout as unconfirmed timing flakiness, but do not prove an environmental root cause.
- `git diff --check`: passed.

Evidence under `.antiphon/`: `task-f8ca7ce0-unit.log`, `task-f8ca7ce0-build.log`, `task-f8ca7ce0-browser.log`, `task-f8ca7ce0-checkpoint.log`, `task-f8ca7ce0-probe.log`; reproduction scripts `task-f8ca7ce0-hover.mjs`, `task-f8ca7ce0-probe.mjs`, and `task-f8ca7ce0-checkpoint.mjs`. Scripts use the existing test server at port 8138; launch it from `src/web-viewer` with `node tests/server.mjs`, then run scripts from the repository root.

Scope: reviewed both requested commits against the supplied brief, selected Mockup B files and implementation report. A separate full CARD-0049 card record was not present in the supplied files or available connector tools; no additional unseen card criteria are certified. Imported delta-review attachment remains explicitly deferred.
