# CARD-0049: real inline review conversations

Implemented the selected Mockup B interaction in the web viewer using the
existing authored/restored v2 review. The user approved a 145,000-byte V-2 ceiling
for the measured 143,357-byte graph, leaving 1,643 gzip bytes of headroom.
The build constant, plan §4 and README now record that decision. Graph accounting
and library baselines remain unchanged.

## Implementation

- `src/web-viewer/src/ui/inline-comments.js` positions the real review sections
  and shared editor below their source blocks. Numbered type/state buttons,
  hover/focus previews, overlapping-mark cycling, independent block folds,
  state filters, Read/Review and collapse controls use the existing review data.
- `src/web-viewer/src/ui/comment-anchor.js` checks the original locator and exact
  selector evidence, maps literal source offsets to DOM ranges and calls the
  existing authoring verifier. It never relocates a quote by text search alone.
  Transformed or ambiguous rendered endpoints receive a labelled block fallback.
- Reader/review presentation hooks connect drawing, state changes and draft
  restoration. The existing persistence listener remains separate. The shared
  composer and state/reply/export handlers are reused, including single-draft
  protection. No schema, selector, comments model, export writer or selection
  toolbar implementation changed.
- CSS Custom Highlights decorate source ranges without rewriting text nodes.
  All feedback text, buttons and forms live outside the main article; empty
  spacers alone reserve vertical room. Heading IDs, fragments, source selection,
  cross-reference previews and table gutter controls retain their own surfaces.
  Table folds use the reading-column width even when their table is compact.
- Inline button mouse gestures retain editor focus until activation. This avoids
  a reproduced WebKit failure where blur flushed denied storage, reflowed the
  page between pointer-down and pointer-up, and lost Save's click. Keyboard focus
  remains native. The existing storage-denial test passed three consecutive
  reruns after the fix. Hover previews account for CSS zoom, and focus previews
  wait for the browser's focus-driven scroll before positioning.
- README documents behavior, keyboard/touch access, source fallback, resource
  limits, persistence/export continuity and deferred imported-review attachment.

Source/render switching and navigating away/back preserve open conversations.
Threads in other documents remain available in the original navigable Review
list. Drafts remain intact while browsing threads, filters and Read/Review.
Resolved/obsolete states stay explicit review states, not inferred resolution
or an assertion that a change request was applied.

## Bounds and deliberate limits

The first 200 threads are eligible for inline placement. Additional threads and
unavailable anchors remain in the existing Review list. Mapping caches are
discarded when the reader redraws. Browsers without CSS Custom Highlights retain
block bars and numbered buttons. Large-document mapping on physical phones,
physical touch and native browser zoom have not been measured.

Imported delta-review attachment/resolution is still deferred, as it was before
this work and as the chosen mockup explicitly notes. This implementation displays
the real locally authored/browser-restored comments document. It does not insert
simulation data or claim to resolve imported feedback against changed originals.

## Verification

- After budget approval, `npm run build` passes V-1, V-2 and deployment-path
  checks with zero failures: 143,357 / 145,000 gzip bytes. Production assets are
  emitted normally. This follow-up changes only the ceiling and documentation;
  the prior behavioral test results below remain the recorded feature validation.
- Node suite: 120 tests passed, zero failures, including two new exact-interval
  tests for repeated text, UTF-16 offsets, corrupted evidence and foreign paths.
- Eight new Chromium acceptance cases pass: authoring/reflow/text isolation;
  overlap cycling; filters and draft retention; feedback selection exclusion;
  reload/source-mode reply restoration; narrow layout and zoom; independent
  table/paragraph folds with previews/navigation; transformed-source fallback
  and obsolete history.
- Final full browser run: 164 passed, one WebKit five-second assertion timeout
  in `committed checkpoint survives closing a page`. Its failure snapshot
  already contained the restored checkpoint text; all three direct reruns passed.
  This is consistent with late restoration under the test deadline, not missing
  saved text. Counts: 99 Chromium passed; 33 Firefox passed; 32 WebKit passed and
  that one timeout, followed by three passing WebKit checkpoint reruns.
- The earlier reproducible WebKit storage-denied Save failure was fixed in the
  inline mouse-gesture handling. It passed three targeted reruns and the final
  full suite. No persistence model or test timeout was changed.
- Independent exported review validation: 25 ZIP/Git checks passed, zero failures.
- Inspected desktop and 390px composer screenshots. Controls and long feedback
  stay inside their folds. Tests use 390px at normal zoom and a 1280px viewport
  at 200% CSS zoom; this is not a claim about native zoom or a 195px viewport.
- `git diff --check`: passed.

The behavioral runs above used a local esbuild harness with production bundling
options while the former 140,000-byte gate blocked asset emission. Following
budget approval, use the normal production build to reproduce verification.

## Bundle decision

The prior CARD-0048 build was 138,609 gzip bytes. This implementation adds 4,748 bytes
of fully counted app/display code and CSS, totaling 143,357. V-1 calibration and
the deployment-path checks pass. The former 140,000-byte ceiling was exceeded
by 3,357 bytes. Git remains behind the existing on-export boundary, and the conditional
DEFLATE fallback is still the only excluded entry point.

The user explicitly approved 145,000 bytes for this feature. The resulting
1,643-byte headroom retains the selected interaction, with the additional 5,000
bytes allocated entirely to owned app code. `build.mjs`, build-plan §4 and README
record the measured cost and approval.

From `src/web-viewer`, rerun `npm test`, `npm run build`, then `npx playwright test` and
`python tests/validate-export.py test-results/browser-review.mdpkg`.
