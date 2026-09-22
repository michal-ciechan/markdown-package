# Inline comment composer lands off-screen on long documents: plan

Task `4d63c88b` (Plan stage). Date 2026-09-22. Base: master `d6f4d2a`.
Workspace: `C:\src\markdown-package` (shared). **No production code is changed by
this commit.** The fix in §6 was applied locally as a prototype, measured (§3, §7),
and reverted; the Code stage applies it for real, test-first, as the slices in §5 say.

## 1. Outcome

The bug is real. It reproduces in Playwright in all three engines, and it has two
independent causes. Neither is the "fixed/absolute positioning relative to the
trigger element without clamping to viewport bounds" the card guesses, and the fix
is not clamping: the composer is an in-document element that belongs next to the
quoted text, so the *viewport* has to be moved to it, correctly.

1. **Chromium and Firefox: the composer is placed at a stale position for one
   frame, and `focus()` scrolls to that stale position.** `layout()` in
   `src/web-viewer/src/ui/inline-comments.js` measures the `#reader` rect once,
   then sets every spacer's height, then measures each spacer's rect. Setting the
   spacer heights forces a layout, and during that layout the browser's scroll
   anchoring (`overflow-anchor: auto`, Chromium and Firefox only) moves the
   viewport whenever the anchored content is *below* the spacer that just grew.
   The host rect was measured before that adjustment and the spacer rect after
   it, so `top` is wrong by the anchoring delta (588 px in the probe). `edit()` in
   `review-view.js` then calls `body.focus()`, which scrolls to the wrong place;
   the anchoring scroll event schedules a `requestAnimationFrame` relayout that
   moves the composer to the right place one frame later, out of the viewport.
   This needs the viewport to be below the insertion point when the composer
   opens, which is exactly the review panel's own "Review selected text" /
   "Review selected section" buttons (the panel sits under the document), on a
   document long enough to scroll.
2. **WebKit: the position is right, but `focus()` does not reveal the editor.**
   WebKit reveals only the caret line, asynchronously (a scroll event ~25 ms after
   `focus()` returns), aligned to the nearest viewport edge. On the selection
   toolbar's "Leave comment" path the textarea ends with 34 px visible at the
   bottom of a 720 px viewport (rect 686–806); on the panel path the caret is
   aligned to the top edge and the form's header, name and kind fields are above
   the viewport (form rect −339–201).

Fix (§6): measure host and spacer rects from the same layout, and reveal the
editor explicitly (`focus({preventScroll: true})`, then `scrollIntoView` on the
form and the textarea) with a small `scroll-margin`. Prototype result: 27/27 probe
combinations green (12/27 before), 150 existing browser checks across the three
engines and 216 unit tests still green.

## 2. Ground truth: what the card assumes vs what the code does

| # | Card assumes | Code / measurement |
| --- | --- | --- |
| G1 | The input box is positioned fixed/absolute relative to the trigger element, unclamped. | The input box is the review panel's `<form class="review-editor">` (`ui/review-view.js:31`). `inlineComments.update()` (`ui/inline-comments.js:162-176`) moves it into an absolutely positioned `.inline-group` inside `.inline-layer` (`position:absolute; inset:0` of `#reader`, `styles.css:152-155`) placed over a zero-content spacer inserted after the anchor block. It is document-positioned next to the quote, not viewport-positioned, and must not be clamped to the viewport: existing tests assert fold geometry against the paragraph and the next heading (`inline-comments.spec.js:59-63`). |
| G2 | "Clicking leave comment" is one flow. | Three triggers reach the same code: the selection toolbar's **Leave comment** (`ui/selection-toolbar.js:134-137`, which programmatically clicks the panel's **Review selected text** via `main.js` `onComment`), the panel's **Review selected text** / **Review selected section** buttons (`review-view.js:101-109`), and **Reply** in a fold (`review-view.js:92`). All call `edit()`, which runs `notify('edit')` (placing the composer inline) and then `body.focus()` (`review-view.js:68`). |
| G3 | Long documents cause it. | Length only matters because the page must scroll. The Chromium/Firefox cause needs the viewport *below* the insertion point at placement time (panel buttons; the toolbar path is green there because the toolbar only shows while the selection is visible, so the scroll anchor is above the spacer). The WebKit cause needs nothing but a composer that does not already fit in view. |
| G4 | The positioning code lacks viewport clamping. | The only viewport-clamped elements are the selection toolbar (`selection-toolbar.js:46-60`) and the tooltip (`inline-comments.js:77-81`), both `position: fixed` and both already correct. The composer's `top` is computed from two `getBoundingClientRect()` calls taken across a forced layout (`inline-comments.js:34-42`); that gap is the defect. Trace: first placement `top: 5983.76px`, corrected next frame to `6571.99px` (Chromium), `5986.09px` → `6573.37px` (Firefox); WebKit computed `6488.29px` once, correctly. |
| G5 | After the fix the box is "always positioned within the visible viewport". | The viewport must be scrolled to the box. Measured `focus()` reveal behaviour: Chromium centres the element synchronously; Firefox aligns to the nearest edge synchronously; WebKit reveals only the caret line, asynchronously. So the reveal must be explicit, and it must happen after placement (`notify('edit')` returns with the composer laid out; `layout()` forces layout synchronously). |
| G6 | `toBeVisible()`-style checks suffice. | Playwright's `toBeVisible()` does not check the viewport, which is why `inline-comments.spec.js` never caught this. The precedent for a bounds assertion is the tooltip check at `inline-comments.spec.js:130-133`. |
| G7 | The full lane runs the new test in chromium, firefox and webkit. | `playwright.config.js` runs firefox and webkit only for five listed spec files. A new spec file must be added to both `testMatch` lists or WebKit (the engine that fails the card's literal flow) never runs it. |
| G8 | A long fixture is needed. | Not on disk: the viewer opens a loose `.md` via `setInputFiles({name, mimeType, buffer})` (precedent `loose.spec.js:28-31`), so the spec generates the document inline. |
| G9 | The composer stays wrong. | It self-heals one frame later (scroll → `schedule()` → rAF `layout()`, `inline-comments.js:213`), which is why the symptom is "the box jumped away", not "the box is in the wrong place". |
| G10 | Existing behaviour elsewhere is unaffected by an explicit reveal. | `edit(…, focus = false)` (saved-draft restore, `review-view.js:181,184`) deliberately does not focus; the saved reading position owns the viewport there. The fix leaves that branch alone. |

## 3. Reproduction evidence (RED against `d6f4d2a`)

Probe: a generated loose `long.md` (40 `##` sections, ~9,900 px tall at 1280 px
wide), target paragraph in section 30 ("deep target words"), selection made
programmatically or by real mouse drag, then one of three triggers. Assertion:
the Feedback textarea's client rect lies within `[0, innerWidth] × [0, innerHeight]`
400 ms after the editor becomes visible.

| Engine | 1280×720 toolbar | drag | panel button | 390×844 toolbar | drag | panel | 1280×400 toolbar | drag | panel |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| chromium | pass | pass | **fail** | pass | pass | **fail** | pass | pass | **fail** |
| firefox | pass | pass | **fail** | pass | pass | **fail** | pass | pass | **fail** |
| webkit | **fail** | **fail** | **fail** | **fail** | **fail** | **fail** | **fail** | **fail** | **fail** |

Key numbers (viewport-relative px, viewport 1280×720 unless stated):

| Case | After the click |
| --- | --- |
| chromium, panel button | textarea 926–1046, form 603–1139, target paragraph 542–567 visible; scrollY 6703 → 6543 |
| firefox, panel button | textarea 887–1007, form 565–1101 |
| webkit, toolbar | textarea 686–806 (34 px visible), form 359–899; scrollY moved only +84, 25 ms after `focus()` |
| webkit, panel button | textarea −12–108, form −339–201 (header/name/kind above the viewport) |
| webkit, 390×844 toolbar | textarea 810–931 (34 px visible) |

Trace of the Chromium panel-button case (in-page instrumentation, one line per
event; `grp.top` is the `.inline-group` inline style):

```
focus:TEXTAREA BEFORE  scrollY=9782 grp.top=5983.76px ta.top=-2902
focus:TEXTAREA AFTER   scrollY=6543 grp.top=5983.76px ta.top=337    <- centred on the stale position
rAF layout()           scrollY=6543 grp.top=6571.99px ta.top=926    <- corrected, now below the fold
```

Same trace with fix A alone: `grp.top=6571.99px` before `focus()`, textarea at
337 after it (Chromium) and 300 (Firefox); WebKit unchanged until fix B.

## 4. Decisions

- **D-1 Fix the measurement, do not disable scroll anchoring.** Measure the host
  rect in the same loop iteration as each spacer rect (no DOM writes between the
  two reads), so both come from one layout. Rejected: `overflow-anchor: none` on
  the page, which would also stop the browser keeping the reading position stable
  when a fold above the viewport expands or collapses, and does nothing for WebKit.
  Rejected: computing `top` from `offsetTop` chains (scroll-independent, but the
  CSS `zoom` semantics of `offset*` differ across engines and the existing 200 %
  zoom test relies on client rects divided by `scale`).
- **D-2 Reveal explicitly, in `edit()`, after `notify('edit')`.** `body.focus({preventScroll: true})`,
  then `form.scrollIntoView({block, inline: 'nearest'})`, then `body.scrollIntoView({block: 'nearest'})`
  as a guard. `review-view.js` is the right owner: it already owns the focus
  call, both focus branches (`composing` re-entry and new edit) need it, and the
  composer is guaranteed to be placed because `notify()` runs `presentation()`
  synchronously. Rejected: revealing inside `inlineComments.update()`, which also
  runs for `draw`, `restore`, filter changes and Read toggles, where moving the
  viewport would be wrong. Rejected: keeping bare `focus()` (engine-divergent; that
  is the WebKit bug). Rejected: clamping the composer to the viewport (G1).
- **D-3 `block: 'nearest'` when the form fits, `'end'` when it is taller than the
  viewport.** `nearest` keeps the quoted paragraph on screen when there is room
  (form 176–712 in a 720 px viewport on the toolbar path). When the 536 px form
  cannot fit (400 px viewport), `nearest` puts the header on screen and leaves the
  Save/Cancel row 8–70 px below the fold; `end` shows the textarea and the buttons
  (textarea 179–299, Save visible) and hides the name/kind fields instead, which
  the user fills less often. Measured in all three engines (§7).
- **D-4 `scroll-margin: .5rem` on `.review-editor` and its textarea.** Without it
  the nearest-edge alignment lands the textarea's bottom exactly on
  `innerHeight` with sub-pixel overshoot in Firefox and WebKit (bottom 400.x in a
  400 px viewport), which a strict bounds assertion rejects and which looks
  clipped. `scroll-margin` is honoured by `scrollIntoView` in all three engines.
- **D-5 New spec file, added to the firefox/webkit lists.** `tests/inline-composer-viewport.spec.js`,
  registered in both `testMatch` arrays in `playwright.config.js`. Rejected:
  appending to `inline-comments.spec.js` (Chromium-only, so the WebKit failure
  would never run) or to `inline-comment-regressions.spec.js` (three engines, but
  its helpers assume `original.mdpkg` and `p.firstChild.data`).
- **D-6 The test covers both triggers.** The toolbar's **Leave comment** with the
  selection visible is the card's literal flow and is RED today only on WebKit;
  the panel's **Review selected text** with the viewport scrolled to the panel is
  RED today on all three engines and guards the Chromium/Firefox cause. Both are
  ordinary user flows (the panel text says "Select text in the reader, or review
  the selected section").
- **D-7 Assert the textarea and the Save button, strictly.** The card asks for
  the input box; the button is what the user needs next. With D-4 the strict
  check `top >= 0 && bottom <= innerHeight && left >= 0 && right <= innerWidth`
  passes with an 8 px margin, so no tolerance is added. Also assert the textarea
  is focused and, at the fitting viewports, that the whole form is within the
  viewport.
- **D-8 Three viewports.** 1280×720 (desktop), 390×844 (phone), 1280×400 (form
  taller than the viewport, exercises the `end` branch of D-3). Cost is one page
  load per case.
- **D-9 The Reply path and the saved-draft restore are out of scope for the
  test.** Reply goes through the same `reveal()` and is covered by the existing
  reply tests staying green; restore deliberately does not move the viewport (G10).

## 5. Slices

| Slice | Files | Done when |
| --- | --- | --- |
| S1 RED test | `src/web-viewer/tests/inline-composer-viewport.spec.js` (new), `src/web-viewer/playwright.config.js` (two `testMatch` entries) | Spec written per §7.1; `npx playwright test inline-composer-viewport.spec.js` against the unchanged base fails: at least the three panel-button cases in every engine and every WebKit case, with the failure output captured (counts and rects) in the commit message and in §8 of this document. Commit before S2. |
| S2 Fix A | `src/web-viewer/src/ui/inline-comments.js` `layout()` | Diff from §6 applied; the panel-button cases go green in Chromium and Firefox; WebKit still red. Commit. |
| S3 Fix B | `src/web-viewer/src/ui/review-view.js` (`reveal()`), `src/web-viewer/src/styles.css` (`scroll-margin`) | Diff from §6 applied; the new spec is green in all three engines. Commit. |
| S4 Lane | none | `npm test`, `npm run build`, full `npx playwright test` (all projects) green, or every red shown to be pre-existing at `d6f4d2a` by re-running the exact failing test there. Counts recorded in the commit message. |
| S5 Record | this document (§8 status block) | Red evidence, root cause, fix and lane counts recorded; the card's request for a fix summary under `docs/plans/` is satisfied by a one-line pointer in `docs/plans/` only if the caller wants one there; otherwise this plan is the record. |

## 6. The change (validated prototype, apply in S2 and S3)

`src/web-viewer/src/ui/inline-comments.js`, in `layout()`:

```diff
     for (const g of groups) {
-      const rect = g.spacer.getBoundingClientRect();
-      g.node.style.left = (rect.left - root.left) / scale + 'px'; g.node.style.top = (rect.top - root.top) / scale + 'px';
+      // Measure host and spacer from the same layout. Resizing the spacers above
+      // lets scroll anchoring move the viewport, which would leave a host rect
+      // taken earlier measured against the old scroll position.
+      const origin = host.getBoundingClientRect(), rect = g.spacer.getBoundingClientRect();
+      g.node.style.left = (rect.left - origin.left) / scale + 'px'; g.node.style.top = (rect.top - origin.top) / scale + 'px';
     }
```

`root` stays for the `scale` computation on the first line of `layout()`.

`src/web-viewer/src/ui/review-view.js`:

```diff
   function closeEditor() { composing = undefined; form.hidden = true; body.value = ''; }
+  // Engines disagree on what focus() reveals: Chromium centres the field,
+  // Firefox reveals its nearest edge, WebKit reveals only the caret line and
+  // does so asynchronously. Reveal the editor explicitly once it is placed.
+  function reveal() {
+    body.focus({preventScroll: true});
+    // A form taller than the viewport cannot fit; show its end (feedback and Save) rather than its header.
+    form.scrollIntoView({block: form.getBoundingClientRect().height > innerHeight ? 'end' : 'nearest', inline: 'nearest'});
+    body.scrollIntoView({block: 'nearest', inline: 'nearest'});
+  }
   function edit(target, fields, focus = true) {
     if (deferredDraft) { status('Resume or cancel your saved draft before starting another comment.', true); return; }
-    if (composing) { presentation('edit'); body.focus(); status('Save or cancel your current comment first.', true); return; }
+    if (composing) { presentation('edit'); reveal(); status('Save or cancel your current comment first.', true); return; }
@@
-    if (focus) { revision++; prepared = artifact = undefined; action('download').hidden = action('share').hidden = true; notify('edit'); body.focus(); }
+    if (focus) { revision++; prepared = artifact = undefined; action('download').hidden = action('share').hidden = true; notify('edit'); reveal(); }
     else presentation('restore');
```

`src/web-viewer/src/styles.css`:

```diff
-.review-editor { padding: 1rem; background: #f0f5fa; border-radius: .4rem; }
+.review-editor { padding: 1rem; background: #f0f5fa; border-radius: .4rem; scroll-margin: .5rem; }
+.review-editor textarea { scroll-margin: .5rem; }
```

Bundle cost: +50 eager gzip bytes (96,665 → 96,715 of the 145,000 budget).

## 7. Verification design

### 7.1 The regression spec (`tests/inline-composer-viewport.spec.js`)

- **Fixture.** Generate the document in the test: `# Long guide`, an intro
  paragraph, then 40 sections of `## Section N` with three paragraphs each; the
  second paragraph of section 30 contains the unique phrase `deep target words`.
  Open it as a loose file: `page.locator('#package-file').setInputFiles({name: 'long.md', mimeType: 'text/markdown', buffer})`
  and wait for `.document-title` to read `long.md`. Skip the author-name step
  unless a later assertion needs a saved comment (the composer opens without it).
- **Selection.** Locate `#reader article > p` with `hasText: 'deep target words'`,
  `scrollIntoViewIfNeeded()`, then set the DOM selection to that phrase and
  dispatch `selectionchange`, the pattern of `inline-comments.spec.js` `select()`.
  One case per engine should instead select by real mouse drag (`page.mouse`
  down / move in steps / up across the phrase's first and last glyph rects) so the
  toolbar path is exercised the way a user drives it; the prototype showed both
  selection methods behave identically.
- **Triggers.**
  1. *Toolbar:* `getByRole('toolbar', {name: 'Text selection'}).getByRole('button', {name: 'Leave comment'}).click()`
     with the selection visible.
  2. *Panel button with the viewport below the target:* `getByRole('button', {name: 'Review selected text', exact: true}).click()`.
     Playwright scrolls the panel into view before clicking, which is the
     scroll-anchoring precondition; make that explicit with
     `page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))`
     before the click so the precondition does not depend on Playwright's
     scrolling behaviour.
- **Viewports.** `setViewportSize` to 1280×720, 390×844 and 1280×400 (D-8);
  build the cases with a `for` over viewports × triggers, as `inline-comments.spec.js`
  does for zoom levels.
- **Assertions.** After `expect(page.locator('.review-editor')).toBeVisible()`
  and a `waitForTimeout(400)` (WebKit's caret reveal arrives ~25 ms after focus;
  the wait makes the RED evidence show the settled state, and `expect.poll` may
  replace it in the GREEN version):
  - `getByLabel('Feedback', {exact: true})` is focused;
  - its client rect satisfies `top >= 0 && left >= 0 && bottom <= innerHeight && right <= innerWidth`;
  - the same for `getByRole('button', {name: 'Save comment', exact: true})`;
  - at 1280×720 and 390×844, the same for `.review-editor` as a whole;
  - the editor is inline (`.inline-group .review-editor` count 1) so the test
    fails loudly if placement is ever skipped rather than passing because the
    form stayed in the panel.
  Print the rects in the failure message (`expect(rectInView, JSON.stringify(rect)).toBe(true)`)
  so the RED run's output is the evidence the card asks for.
- **Registration.** Add `'inline-composer-viewport.spec.js'` to both the firefox
  and the webkit `testMatch` arrays in `playwright.config.js`.
- **Expected RED at `d6f4d2a`** (from the probe, which used the same flows):
  panel-button cases fail in every engine at every viewport (9), every WebKit
  case fails (9, 3 overlapping) → 15 of 27 red, 12 green; the Save-button
  assertion adds no new red cases. If the Code stage's spec differs in case
  count, record its own numbers.
- **Expected GREEN after §6:** 27 of 27, all three engines, measured with the
  prototype (this session, `d6f4d2a` + §6).

### 7.2 Lane

| ID | Command (from `src/web-viewer`) | Expectation / measured cost |
| --- | --- | --- |
| V-1 | `npm test` | 216 pass; 22 s at `d6f4d2a` |
| V-2 | `npm run build` | V-1/V-2 build checks pass; gzip budget 96,715/145,000 with the fix |
| V-3 | `npx playwright test inline-composer-viewport.spec.js --reporter=line` at `d6f4d2a` (built) | RED as in §7.1; keep the output |
| V-4 | same after S2 | Chromium/Firefox panel cases green; WebKit still red (proves fix A is the Chromium/Firefox cause) |
| V-5 | same after S3 | all green, three engines |
| V-6 | `npx playwright test inline-comments.spec.js inline-comment-regressions.spec.js persistence.spec.js review.spec.js selection.spec.js preview.spec.js --reporter=line` | 150 pass in 5.2 min with the prototype (this session) |
| V-7 | `npx playwright test --reporter=line` (full lane, all projects) | 249 tests in 12 files at `d6f4d2a` (`--list`: chromium 143, firefox 53, webkit 53), plus the new spec's cases; all green or pre-existing red proven at base by re-running the exact test there. Foreground windows are 10 minutes: run per project (`--project=chromium`, then firefox, then webkit) if the whole lane does not fit one window |
| V-8 | `git status` clean apart from intended files; no `probe*` files; `dist/` rebuilt from the committed source before every Playwright run (plain `npx playwright test` serves the existing `dist/`, it does not rebuild) |

Do not edit source while a lane is running. Commit before V-6 and V-7.

## 8. Residual risks and out of scope

- **iOS on-screen keyboard.** Desktop WebKit is what Playwright runs; on iOS the
  keyboard shrinks the visual viewport after focus and Safari re-reveals the
  field itself. The explicit reveal happens before that and does not fight it,
  but it is unmeasured.
- **Chromium no longer centres the textarea** on the toolbar path (it sits at
  499–619 in a 720 px viewport with the quoted paragraph still visible above).
  Intentional (D-3), but a visible behaviour change worth a sentence in the
  commit message.
- **CSS zoom.** The existing 200 % zoom test in `inline-comments.spec.js` stayed
  green with the prototype; `scale` handling is untouched.
- **Fold resize while composing.** The rAF relayout path is unchanged; fix A only
  makes the synchronous placement agree with it.
- The selection toolbar's and tooltip's own viewport clamping were checked and
  are not involved.

### Status

Plan stage complete (this commit). RED evidence and root cause are recorded above
from probe runs in this session; the committed regression spec, the fix and the
lane counts belong to the Code stage, which should append its results here.
