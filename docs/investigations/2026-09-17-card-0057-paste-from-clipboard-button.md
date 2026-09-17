# CARD-0057: Web viewer paste-from-clipboard button next to Open

Date: 2026-09-17. Investigate task `312049b2`. Investigated at commit
`f9f8ffbc5b04ad9a45949af15ab79182db692d86`. No production code was changed.

## Outcome

**Confirmed, with a scope problem the owner must decide.** The viewer already loads an
OS-copied `.mdpkg` when the user presses Ctrl+V / Cmd+V: `src/web-viewer/src/main.js:266-271`
listens for `paste` on the document, takes `event.clipboardData.files[0]` and hands it to the
same `receive()` that the file picker and drag/drop use. That route has existed since commit
`cbc8c0d` (2026-09-09), is announced in the empty-state text (`main.js:21`, "Choose a file, or
drop or paste a package here") and is covered by a Playwright test
(`src/web-viewer/tests/persistence.spec.js:319-330`).

A **button** cannot reuse that route. `clipboardData.files` exists only on a real `paste`
event, and no engine lets page script raise one: `document.execCommand('paste')` returns
`false` in Chromium and Firefox, and in WebKit only fires when the test harness has granted
`clipboard-read` (measured below). The only API a button can call is
`navigator.clipboard.read()`, and on this machine it **never exposes an OS-copied file**:

| Engine (Playwright 1.55.1, Windows 10) | `paste` event, file copied in Explorer | `navigator.clipboard.read()`, same clipboard | `read()` with copied text |
|---|---|---|---|
| Chromium 140.0.7339.186, `clipboard-read` granted | `files: [original.mdpkg, 636 bytes]` | resolves: one `ClipboardItem` with **zero types**; identical result for an **empty** clipboard | one item, `['text/plain']` |
| Firefox 141.0 | `files: [original.mdpkg, 636 bytes]`, types `application/x-moz-file, Files` | **pending** after 5 s (Firefox paste-confirmation prompt; automation cannot click it) | pending, same prompt |
| WebKit 26.0 | `files: [original.mdpkg, 636 bytes]`, types `Files, text/uri-list, text/html` | rejects `NotAllowedError` with or without the Playwright grant | rejects `NotAllowedError` |

So the card's stated mechanism ("paste event listener using `clipboardData.files`" behind a
button) is not available to a button, and the secondary path (`navigator.clipboard.read()`)
cannot see a copied `.mdpkg` in any engine. In Chromium it cannot even distinguish "a file is on
the clipboard" from "the clipboard is empty" (both return one item with no types). A Paste
button can therefore only (a) load **text** content from the clipboard, which the viewer cannot
open today because `openContainer` accepts ZIP containers only
(`src/web-viewer/src/container/reader.js:157-164`; a bare `.md` fails with
`Could not open package: No complete EOCD ending at EOF`), or (b) act as a discoverability
affordance that inspects the clipboard where it can and otherwise tells the user to press
Ctrl+V / Cmd+V. Which of those the card wants is the decision recorded at the end.

Evidence files: `docs/investigations/paste-button/clipboard-probe.mjs` and
`clipboard-probe-results.json` (three engines, file and text), `webkit-exec-probe.mjs` and
`webkit-exec-probe-results.json` (WebKit `execCommand('paste')` with and without the grant),
`chromium-edge-probe.mjs` and `chromium-edge-probe-results.json` (empty clipboard; prompt
state, headed and headless). Fixture: `docs/spec/review-fixtures/original.mdpkg` placed on the
OS clipboard with PowerShell `Set-Clipboard -Path`, text with `Set-Clipboard -Value`.

## 1. The existing Open control and its load path

- Header markup `src/web-viewer/src/main.js:14-19`: `<div class="open-actions">` holds
  `#enhanced-open` (a `<button>`, rendered `hidden`) and the standard control, a
  `<label class="open-button">` wrapping `#standard-open-label` and `<input id="package-file"
  type="file">`. The input is visually hidden by `src/web-viewer/src/styles.css:14`; the label
  is the visible button (`styles.css:6,13`). `.open-actions` is `display:flex; flex-wrap:wrap;
  gap:.6rem` (`styles.css:15`), and the header stacks vertically under 640 px (`styles.css:81`).
- Enhanced picker wiring `src/web-viewer/src/persistence/session.js:144-152`: when
  `hasFilePicker()` (`src/web-viewer/src/inbound/file-access.js:1`, secure context plus
  `showOpenFilePicker`) the hidden button is revealed, the standard label is renamed
  "Choose file (standard picker)", and a click calls `choosePackage()` then `receive(source)`.
  Failure other than `AbortError` uses `ui.offer('The enhanced picker could not open a file.
  Use the standard picker.', 'Choose file again', () => fileInput.click())` (`session.js:149`).
- Standard input `main.js:251-256`: `change` reads `files[0]`, clears the input, and calls
  `receive(file, expected?.key, expected?.documentPath)` with the pending resume pick from
  `savedSessions.picked()` (`session.js:159`).
- Drag/drop `main.js:257-265`: `dragover` accepts only `Files`; `drop` with more than one file
  reports `Open one package at a time.` as an error, otherwise `receive(files[0])`.
- Paste `main.js:266-271`: ignores pastes with no files (so text pastes into the reference
  input keep working), reports `Paste one package at a time.` for several files, otherwise
  `receive(event.clipboardData.files[0])`. Neither multi-file message has a test
  (grep of `tests/` for "one package at a time" finds nothing).
- `receive(source, expectedKey, documentPath)` `main.js:104-163` is the single sink. A bare
  `Blob`/`File` is wrapped as `{blob, sourceKind: 'file'}` (`:105`), then
  `openPackage(blob)` (`src/web-viewer/src/inbound/open.js:8-9`, "The one inbound boundary for
  file input, drag/drop, paste and future routes"), then the persistence `prepare`/`attach`
  handshake, generation guards, and the package UI. The `name` shown comes from `blob.name`
  (`open.js:17`, default `Untitled package`).

## 2. What a button can and cannot read

Measured on this machine (scripts and raw output in `docs/investigations/paste-button/`):

- `document.execCommand('paste')`: Chromium `queryCommandSupported` false, returns false;
  Firefox false/false; WebKit supported but returns false, except when Playwright's
  `clipboard-read` grant is present, in which case it returns true **and fires a `paste` event
  carrying the copied file** (`webkit-exec-probe-results.json`). MDN documents the command as
  "disabled for web content" and `execCommand` as deprecated. Not a usable path.
- `navigator.clipboard.read()` for an OS-copied file: Chromium resolves one item with
  `types: []`; Firefox blocks on its paste prompt; WebKit rejects `NotAllowedError`. For an
  **empty** clipboard Chromium also resolves one item with `types: []`
  (`chromium-edge-probe-results.json`), so "file present" and "nothing copied" are the same
  observation. For copied **text** Chromium resolves `['text/plain']`.
- Permission state in Chromium without a grant: headed, `read()` stays pending behind the
  permission bubble; headless, it rejects `NotAllowedError: Failed to execute 'read' on
  'Clipboard': Read permission denied.` Playwright tests run headless, so the denied branch is
  reachable in tests with no stubbing at all.
- All three engines let a test replace `Clipboard.prototype.read` (resolving a stub
  `ClipboardItem`, or rejecting `NotAllowedError`) and remove the API with
  `Object.defineProperty(Navigator.prototype, 'clipboard', {get: () => undefined})`
  (`clipboard-probe-results.json`, `stubs`). That is how the unsupported and non-file cases can
  be driven deterministically.
- Playwright `context.grantPermissions(['clipboard-read'])`: Chromium accepts
  `clipboard-read`/`clipboard-write`; Firefox throws `Unknown permission: clipboard-read`;
  WebKit accepts `clipboard-read` and rejects `clipboard-write`. The existing clipboard test
  (`src/web-viewer/tests/preview.spec.js:111-121`) already runs only in the Chromium project
  (`src/web-viewer/playwright.config.js:5-8` limits Firefox/WebKit to five named specs).

Documented support, for the caveats section of the eventual plan:

- MDN browser-compat-data (`api/Clipboard.json`): `read()` Chrome 76 ("The user must grant the
  `clipboard-read` permission"), Firefox 127 ("must be called within user gesture event
  handlers"; "A paste prompt is displayed when the clipboard is read. If the clipboard contains
  same-origin content, the prompt is suppressed"), Safari 13.1. `readText()` Chrome 66,
  Firefox 125, Safari 13.1. Secure context required everywhere; the viewer README already
  states production serving needs HTTPS for clipboard access (`src/web-viewer/README.md:27-28`).
- W3C Clipboard API mandatory data types for `read()`/`write()`: `text/plain`, `text/html`,
  `image/png`. The spec has no requirement to expose OS file references.
- WebKit blog (Safari 13.1): `read()` outside a user gesture rejects immediately; otherwise iOS
  shows a callout with a single Paste option and macOS a context-menu item, and the promise
  rejects if the user taps elsewhere; supported representations are `text/plain`, `text/html`,
  `text/uri-list`, `image/png`.

## 3. Existing error and empty-state messaging

- `report(message, error)` `main.js:84-87` writes to `#activity` (`role="status"
  aria-live="polite"`, `main.js:21`) and toggles the `error` class (`styles.css:25`, red text;
  `styles.css:24` reserves its height). Every open-path outcome goes there: `Opening …`
  (`:108`), `Could not open package: <reason>` as error (`:161`), `Open one package at a time.`
  and `Paste one package at a time.` as errors (`:263,269`), `Package opened.` (`:147`).
- Clipboard write fallbacks already follow one pattern (`main.js:287-303`): try
  `navigator.clipboard.writeText`, and on any rejection fall back to selecting the text and
  reporting a plain-language instruction, `Select and copy the reference from the text box.`
  Not styled as an error. `src/web-viewer/src/ui/recent-view.js:59-61` does the same silently.
- Actionable recovery uses `ui.offer(message, label, action)`
  (`recent-view.js:42-47`), rendered in `.resume-offer` inside `#saved-sessions`, e.g. the
  enhanced-picker failure (`session.js:149`) and the identity mismatch (`session.js:160-161`).
  Save-status text uses `ui.notice` (`recent-view.js:13-17`).
- Unsupported-capability convention: the enhanced button is rendered `hidden` and revealed only
  when `hasFilePicker()` is true (`session.js:144-145`); the persistence host degrades with a
  sentence in `#saved-sessions` (`main.js:75`).

## 4. Existing Playwright patterns for file loading

- Picker: `page.locator('#package-file').setInputFiles(<path | {name, mimeType, buffer}>)` then
  `await expect(page.locator('.document-title')).not.toBeEmpty()` (helper `open()` at
  `persistence.spec.js:18-22`; the same call appears in every spec, e.g. `review.spec.js:7`,
  `snapshot.spec.js:16`, `unicode-roundtrip.spec.js:16`).
- Drop and paste: `persistence.spec.js:319-330` builds a `DataTransfer` with one `File` inside
  `page.evaluate`, creates `new Event('drop' | 'paste')`, defines `dataTransfer` /
  `clipboardData` on it with `Object.defineProperty`, dispatches it on `document`, and asserts
  `.document-title` is `guide.md`, then a draft round-trip.
- Error path: `persistence.spec.js:103-110` opens `not a zip` bytes as `broken.mdpkg` and
  asserts `#activity` contains `Could not open package`, the editor keeps its text and the
  IndexedDB `packages` rows are unchanged (read through the `/test-api.js` bundle served by
  `tests/server.mjs:6-11`).
- Clipboard permission: `preview.spec.js:111-121` uses
  `context.grantPermissions(['clipboard-read', 'clipboard-write'])` and
  `navigator.clipboard.readText()` inside `page.evaluate`; Chromium project only.
- Unit tests are `node --test tests/*.test.mjs` importing `src/` modules directly
  (`tests/links.test.mjs:1-14`); CI runs `npm test`, `npm run build`, then `npx playwright test`
  on all three engines (`.github/workflows/pages.yml:58-67`).

## 5. Plan under the stated default (Option A below)

Default assumed here: the button is an **affordance for the existing keyboard route**. It reads
the clipboard where the browser allows, never loads a file itself (no engine can hand it one),
loads nothing from text, and always ends in a status message. Files and functions:

- `src/web-viewer/src/main.js:17-18`: add `<button id="paste-package" type="button">Paste
  package</button>` inside `.open-actions` after the standard label, always visible (unlike
  `#enhanced-open`, its value is the guidance, which works everywhere). No extra ARIA wiring is
  needed; `#activity` is already a live region.
- New `src/web-viewer/src/inbound/clipboard.js` (pure, unit-testable): `classifyClipboard(items)`
  mapping the `ClipboardItem[]` from `read()` to one of `no-types` (Chromium file-or-empty),
  `text` (has `text/plain`), `other` (html/png only); and `readClipboard(scope = globalThis)`
  that returns `{status: 'unsupported'}` when `!scope.isSecureContext ||
  typeof scope.navigator?.clipboard?.read !== 'function'`, `{status: 'denied', error}` on
  `NotAllowedError`, `{status: 'failed', error}` otherwise, else `{status: 'ok', kind}`. Mirrors
  the `hasFilePicker`/`choosePackage` split in `file-access.js:1-6`, including the rule "call
  the native API before awaiting anything" because `read()` needs transient activation.
- `main.js` click handler next to the copy handlers (`:287-303`), all via `report()`:
  - `unsupported`: `Pasting from a button is not available in this browser. Copy the package
    file and press Ctrl+V (Cmd+V on Mac) on this page, or use Open package.` (not an error).
  - `denied`: `Clipboard access was not allowed. Press Ctrl+V (Cmd+V on Mac) on this page to
    paste the copied package, or use Open package.` (not an error).
  - `no-types`: `Nothing readable is on the clipboard. If you copied a package file, press
    Ctrl+V (Cmd+V on Mac) on this page.` (not an error; Chromium cannot tell the cases apart).
  - `text`/`other`: `The clipboard holds text, not a package file. Copy a .mdpkg file and press
    Ctrl+V, or use Open package.` as an error, package and editor untouched.
  - `failed`: `Could not read the clipboard: <message>` as an error, same shape as
    `Could not open package:` (`:161`).
  - The Firefox prompt is a real UX cost: every click shows the paste prompt, and even after
    the user accepts it the result for a copied file is unknown (not measurable here). The plan
    should say so in `README.md` next to line 298.
- `src/web-viewer/README.md:7` and `:298`: document the button and the fact that only
  Ctrl+V / Cmd+V can deliver a copied file.
- Unit test `tests/clipboard.test.mjs` for `classifyClipboard` and `readClipboard` with fake
  scopes (no secure context; no `read`; `read` rejecting `NotAllowedError`; `read` resolving
  `[{types: []}]`, `[{types: ['text/plain']}]`).
- Playwright `tests/paste-button.spec.js` (Chromium project only, like `preview.spec.js`, since
  Firefox cannot grant the permission and WebKit always rejects):
  1. **Successful paste-to-load stays the keyboard route.** Reuse the synthetic `paste` event
     from `persistence.spec.js:319-330` and add the untested multi-file case asserting
     `#activity` has `Paste one package at a time.` with class `error` and no package opened.
  2. **Empty or file-only clipboard.** `grantPermissions(['clipboard-read'])`, click the button
     with nothing loaded; Chromium returns an item with no types, so assert the `no-types`
     guidance and that `#browser` stays hidden.
  3. **Non-file clipboard.** Grant, `navigator.clipboard.writeText('# not a package')` in
     `page.evaluate`, click; assert the `text` message with class `error`, and, after opening
     `original.mdpkg` first, that `.document-title` and the draft editor text are unchanged
     (pattern of `persistence.spec.js:103-110`).
  4. **Permission denied.** No grant; headless Chromium rejects `NotAllowedError` natively
     (`chromium-edge-probe-results.json`, `headless: true, grant: false`); assert the `denied`
     message and no `error` class. A stub via `page.addInitScript` replacing
     `Clipboard.prototype.read` with a rejecting function is the deterministic alternative if
     the native behaviour changes.
  5. **Unsupported browser.** `page.addInitScript` defining `Navigator.prototype.clipboard` as
     `undefined` (verified to work in all three engines); click; assert the `unsupported`
     message and that Ctrl+V guidance is present. Optionally also run this one case in the
     Firefox/WebKit projects by adding the spec to `playwright.config.js:7-8`.

## 6. Decision required

The card's goal ("load a .mdpkg/.md file by pasting it from the clipboard" through a button)
cannot be met as written. Three live options; the plan above assumes A:

- **A. Guidance affordance** (default above). Cheapest; the button never loads anything, which
  may read as a broken button to users who copied a file in Chromium (the one engine where the
  keyboard route works with no prompt).
- **B. Accept pasted Markdown text.** Make the button, and the keyboard route with a `text/plain`
  paste while no editable element is focused, wrap clipboard text as a synthetic single-document
  package. This is a new feature outside `openPackage`: the persistence layer keys everything on
  `packageKey(pkg.manifest)` (`session.js:162`), the details panel prints
  `pkg.manifest.namespace` and `current.kind/id` (`main.js:131-133`), addressing reads the
  ledger, and export writes a delta against a real snapshot. A synthetic manifest would need a
  namespace, identity and history-free ledger, and the `.md` half of the card would also have to
  extend the picker and drop routes for consistency. Needs its own design pass.
- **C. No button.** Keep the existing keyboard route, add the missing multi-file test, and make
  the empty-state sentence spell out the shortcut (`main.js:21`: "… or press Ctrl+V / Cmd+V to
  paste a copied package file …"). Zero new API surface.

## Remaining uncertainties

- WebKit measurements are the Windows WebKit 26.0 build that Playwright ships; real Safari on
  macOS/iOS may expose different `paste`-event types for a copied Finder file, and its Paste
  callout behaviour for `read()` is documented (WebKit blog) but was not exercised here.
- Firefox: what `read()` resolves for an OS-copied file **after** the user accepts the paste
  prompt is unknown; automation could not click the prompt (both file and text runs stayed
  pending for 5 s). The `paste` event route in Firefox 141 exposes the file.
- Chromium was measured at 140.0.7339.186; a future Chromium could add file support to
  `read()` (the spec does not forbid it), which would make Option A's `no-types` branch
  distinguishable. No evidence of that today.
- Headed Chromium without a grant left `read()` pending behind the permission bubble; whether a
  user's explicit "Block" surfaces as `NotAllowedError` with the same message as headless was
  not measured (the message `Read permission denied.` is from headless).

## Not done, noted

- Fix idea (one line): implement Option A per section 5, or hand Option B to a design task;
  either way add the missing `Paste one package at a time.` / `Open one package at a time.`
  Playwright case.
- Nothing in production code was touched; the probe scripts live only under
  `docs/investigations/paste-button/` and import Playwright from `src/web-viewer/node_modules`.
