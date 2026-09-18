# Native shells for the Markdown Package viewer: investigation and phased plan

Date: 2026-09-18. Investigate task `ee9102ad`. Investigated at commit
`ca2dc7f` (master). No production code was changed. This document is a plan for
sign-off, not a build record: nothing below has been implemented.

## 0. Outcome and recommendation

**Recommended shell: Tauri v2 (2.11.x stable) for every target, one project,
one codebase.** The existing `src/web-viewer/dist/` output is loaded unchanged
inside the platform's system webview (WebView2 on Windows, WebKitGTK on Linux,
WKWebView on macOS, iOS and iPadOS, the Android System WebView on Android).
The viewer gains one small "host adapter" module with seven touchpoints (§5) so
the same build keeps working on GitHub Pages. Per platform:

| Platform | Recommendation | Why not the alternatives |
| --- | --- | --- |
| Windows (phase 1) | Tauri v2, NSIS per-user installer, `bundle.fileAssociations` for `.mdpkg` and `.md`, single-instance plugin, updater plugin over GitHub Releases | Electron ships a 100 MB+ Chromium for a 300 KB app and has no mobile story; .NET MAUI has no Linux target, so it fails rollout item 2 before it starts |
| Linux and macOS (phase 2) | Same Tauri project: AppImage/deb, `.app`/dmg with Developer ID signing and notarization | Same as above |
| iPhone and iPad (phases 3 and 4) | Same Tauri project via `tauri ios init`; one adaptive app. **Fallback:** a hand-written Swift WKWebView wrapper hosting the same `dist/` if the iOS spike (§6, phase 3 gate) shows Tauri's iOS file-open route is not yet reliable | Capacitor is a fine iOS shell but its desktop platform is unmaintained, so choosing it means two shells |
| Android (phase 5) | Same Tauri project, `androidIntentActionFilters: [View, Send]` | Lowest priority; nothing decided beyond the shell |

Two findings change the scope the brief assumed:

1. **The viewer cannot open a bare `.md` today.** Every inbound route ends in
   `openPackage()` → `openContainer()`, which parses a ZIP. Reproduced on
   2026-09-18 with Node 24.6.0: a `text/markdown` Blob fails with
   `No complete EOCD ending at EOF`. Opening `.md` files therefore needs a
   small, shell-independent "loose document" synthesizer (§5, item I). The JS
   already contains every building block (ZIP writer, canonical JSON, snapshot
   identity), so this is roughly 40 lines plus tests, and the browser viewer
   gains it too.
2. **Reading a local file's bytes needs no per-platform code path in the
   viewer.** The reader consumes a `Blob` through `blobSource()`
   (`src/container/source.js:23`) and `receive()` already accepts a
   `{blob, sourceKind}` object (`src/main.js:107`). One Rust command that
   returns the file's bytes serves all five targets; only the *delivery of the
   path* differs per OS (argv on Windows/Linux, `RunEvent::Opened` on macOS,
   iOS and Android). See §7 R2 for the IPC size question.

## 1. Ground truth: what the viewer depends on today

Evidence is the source at `ca2dc7f`; line numbers are from that commit.

### 1.1 Shape of the deployable

- `src/web-viewer/index.html` is a 13-line shell: one `<div id="app">`, one
  `<link>` to `dist/main.css`, one `<script type="module">` to `dist/main.js`.
- `npm run build` (esbuild 0.25.9, `build.mjs`) writes `dist/index.html`,
  `dist/main.js`, `dist/main.css`, one lazily imported inflate fallback chunk
  and `build-report.json`. Gate D-1 fails the build if any asset path is
  absolute, so `dist/` is a self-contained root that a custom scheme can serve.
- Measured at the current `dist/build-report.json`:

  | File | Bytes | gzip |
  | --- | --- | --- |
  | `main.js` | 285,477 | 91,715 |
  | `main.css` | 12,794 | 3,713 |
  | `inflate-fallback-*.js` (lazy) | 4,658 | 2,327 |
  | `chunk-*.js` | 544 | 338 |
  | Eager graph (gate V-2) | | 95,766 of a 145,000 ceiling |

- No service worker, no web-app manifest, no `fetch()` to any origin, no
  `import.meta`, no `new URL()` of assets. The only URL-derived state is the
  IndexedDB database name, which is keyed on `location.href`'s path
  (`src/persistence/model.js:12`, `store.js:7`, `session.js:11`).
- Tests: 75 Node `test()` calls in `tests/*.test.mjs` and 108 Playwright
  `test()` calls across 12 spec files, run against `dist/` served over
  `http://127.0.0.1:8138` by `tests/server.mjs` (plain static server, no
  special headers). Chromium runs everything; Firefox and WebKit run five
  specs (`playwright.config.js`).

### 1.2 Every browser API the viewer uses, and what a shell must provide

| Capability | Where | Browser behaviour today | In a system-webview shell |
| --- | --- | --- | --- |
| Standard file picker | `<input type="file">` with no `accept` (`main.js:19`, `253-258`) | Works everywhere; iOS needs no `accept` so `public.data` is selectable | Works in WebView2, WebKitGTK and WKWebView unchanged. A native picker (Tauri `plugin-dialog`) can filter `.md`/`.mdpkg` and return a path for recents |
| Enhanced picker | `showOpenFilePicker` + `FileSystemFileHandle` `queryPermission`/`requestPermission` (`src/inbound/file-access.js:1-16`); handles persisted in the IDB `handles` store (`session.js:215`) | Chromium only, secure context only | WebView2 is Chromium, so it may work as-is (verify, §6 phase 0). In the shell a remembered *path* replaces the handle: `reopen()` (`session.js:31-55`) needs a path branch |
| Drag and drop | HTML5 `drop` with `dataTransfer.files` (`main.js:259-267`) | Works | **Tauri intercepts OS drops by default.** `dragDropEnabled` must be `false` ("Disabling it is required to use HTML5 drag and drop on the frontend on Windows", tauri-utils `WindowConfig` docs). Electron passes them through |
| Keyboard paste | `paste` event, `clipboardData.files` (`main.js:268-273`) | Works in every engine (CARD-0057) | Expected to work in WebView2 (same engine). Unverified in WKWebView/WebKitGTK |
| Paste button | `navigator.clipboard.read()` (`src/inbound/clipboard.js:27-38`) | Never yields an OS-copied file in any engine (CARD-0057) | Same. A shell *could* do better: a Rust command reading `CF_HDROP` on Windows would give the button a real file. Optional, not in phase 1 |
| Copy reference | `navigator.clipboard.writeText` (`main.js:306`, `316`; `src/ui/recent-view.js:60`) | Secure context + user gesture | Works in WebView2/WKWebView under a secure origin (R1) |
| Package bytes | `blobSource(blob)` slices a `Blob` (`source.js:23-33`); `bytesSource(Uint8Array)` also exists (`:12`) | `File` from picker/drop/paste | Shell reads bytes natively and hands `new Blob([bytes])` to `receive()` |
| Inflate | `DecompressionStream('deflate-raw')` with a lazy fflate fallback (`src/container/inflate.js:2-33`) | Native from Chrome 103 / Safari 16.4 | WebView2 native; WKWebView native on iOS 16.4+; WebKitGTK 2.40+ expected; fallback covers the rest |
| Deflate on export | `CompressionStream('deflate-raw')` with STORE fallback (`src/container/writer.js:9-43`) | Same | Same |
| Web Crypto | `crypto.subtle.digest` (`src/address/digest.js:10-12`), `crypto.randomUUID` (`review-view.js`, `store.js`) | Secure context required; the code throws "serve the app over HTTPS or localhost" otherwise | **Origin must be a secure context** (R1) |
| Persistence | IndexedDB (`store.js`), `sessionStorage` tab pointer (`session.js:12-13`), `localStorage` author name (`src/ui/author-name.js:8-16`) | Per origin | All available in WebView2/WKWebView/WebKitGTK. Origin = the shell's custom scheme; changing the scheme later orphans the data (R1) |
| Export review | `<a download>` on a blob URL (`src/review/out.js:6-15`) | Browser download UI | Works in WebView2 and Chromium; **no-op in Tauri on macOS** (tauri-apps/tauri#6171, closed "not planned"). Route through a native save dialog behind the adapter |
| Share review | `navigator.share({files})` / `canShare` (`src/ui/review-view.js:129, 142-144, 160`) | On by default on Cocoa WebKit (repo evidence `viewer-app/ios-evidence.json`) | WKWebView: expected but never measured on a device. Adapter can call the native share sheet instead |
| Unsaved-work guards | `window.confirm` ×3 (`main.js:121`, `session.js:63`, `189`); `beforeunload` (`main.js:80-81`, `session.js:14-20`); `pagehide`/`visibilitychange` flush (`session.js:142-143`) | Native dialogs | WebView2: works. **WKWebView under wry: `confirm()` reported to return `false` with no dialog** (tauri-apps/wry#584; downstream report 2026). Native window close does not raise `beforeunload`; the shell must hook close-requested and call `flush()` |
| External links | `http(s):`/`mailto:` get `target="_blank"` (`src/ui/markdown-surface.js:11-13`) | New tab | Tauri needs the `opener` plugin and an ACL entry to open the system browser; Electron needs `setWindowOpenHandler` |
| Images | Never requested from packages (`src/ui/markdown-renderer.js:22-23`) | | Nothing to allow in CSP |
| Layout | `@media (max-width: 700px)`, `(width < 700px)`, 44 px touch targets (`styles.css:80-129`) | | Range syntax needs Chrome 104 / Safari 16.4; sets the iOS floor |

### 1.3 What the earlier investigation already settled

`docs/investigations/viewer-app.md` (2026-09-09) measured the iOS side from
WebKit source and Apple documentation, without a device:

- Web Share Target and `file_handlers` are absent from WebKit, so "tap a
  `.mdpkg` in Files and it opens in the viewer" needs an app bundle that
  declares the type (§2.5); a WKWebView wrapper "buys the UTI declaration, a
  Share Extension and `LSSupportsOpeningDocumentsInPlace`" (§2.6).
- App Store guideline 4.2 (minimum functionality) is the named risk for a
  wrapper whose only content is the web app (§2.6).
- Outbound sharing through `navigator.share({files})` is on by default on
  Cocoa (§2.2). The inbound picker works only with no `accept` (§2.3).
- The seven-day script-storage cap applies to Safari, not to a home-screen app
  (§3.4); a WKWebView data store inside an app is not Safari either.
- The build plan `docs/superpowers/plans/2026-09-09-card-0018-viewer-app-build-plan.md`
  §6 already holds a real-device iOS checklist to reuse in phase 3.

## 2. Desktop shell options, weighed

Versions as published on 2026-09-18: Tauri crate 2.11.5 stable (3.0.0-alpha.1
exists; pin 2.x), `@tauri-apps/cli` 2.11.4, Electron 44.4.2, `@capacitor/core`
8.5.2.

| Criterion | Tauri v2 | Electron | .NET MAUI + WebView2 | Capacitor + Electron platform |
| --- | --- | --- | --- | --- |
| Reuse `dist/` as-is | Yes: `frontendDist` points at it | Yes | Yes (BlazorWebView or raw WebView2 loading files) | Yes |
| Engine | System webview (WebView2 / WebKitGTK / WKWebView) | Bundled Chromium | WebView2 on Windows; WKWebView on Apple | Bundled Chromium on desktop |
| Windows installer size | Small (a few MB; WebView2 is already on this machine, version 153, and on Windows 10 1803+ generally; `webviewInstallMode` downloads the bootstrapper otherwise). Measure in phase 0 | ~100 MB class (Chromium inside). Measure if chosen | Framework-dependent WinUI 3 app plus Windows App SDK runtime; tens of MB | As Electron |
| Linux | Yes (deb, rpm, AppImage) | Yes | **No** | Via unmaintained community platform |
| macOS | Yes (`.app`, dmg) | Yes | Mac Catalyst | As Electron |
| iOS / iPadOS | Yes, same project (`tauri ios init`) | No | Yes | Yes (first-class) |
| Android | Yes, same project | No | Yes | Yes |
| File associations | `bundle.fileAssociations` on Windows, macOS, Linux, iOS, Android; Windows/Linux deliver paths in argv; macOS/iOS/Android through `RunEvent::Opened { urls }` (Tauri file-associations example, `examples/file-associations/src-tauri/src/main.rs`) | electron-builder `fileAssociations` for NSIS, MSI and macOS; `open-file` event on macOS, `process.argv` on Windows, `second-instance` for a running app | Needs MSIX packaging or hand-written registry work | Community platform |
| Second launch while running | `tauri-plugin-single-instance` forwards `argv` and `cwd` to the running instance; must be the first plugin registered | `requestSingleInstanceLock()` + `second-instance` | Manual | Manual |
| Auto-update | `tauri-plugin-updater`: NSIS/MSI on Windows, `.app.tar.gz` on macOS, AppImage on Linux; minisign-signed `latest.json`, which `tauri-action` can publish to GitHub Releases. Losing the private key means no further updates, ever | `electron-updater` with the GitHub provider | None built in (MSIX App Installer) | As Electron |
| Code signing | Windows: OV/EV certificate, Azure Trusted/Artifact Signing or any tool via `signCommand`; unsigned builds trip SmartScreen. macOS: Apple Developer Program, Developer ID, notarization; unsigned apps show "damaged" warnings | Same certificates; `win.certificateFile`, `mac.notarize` | Same | Same |
| Tests | Playwright suite keeps running against `dist/` over HTTP. Shell smoke: `tauri-driver` on Windows/Linux (Edge WebDriver); no macOS driver | Playwright's Electron support ("experimental" per its docs, widely used) | Appium/WinAppDriver | As Electron |
| Toolchain on this machine | Rust **not installed** (rustup, ~10 min); VS 2019 Build Tools present (needs the C++ workload); Node 24.6.0 present | Node only | .NET 10 SDK 10.0.300 present | Node only |
| Known gaps | macOS `<a download>` no-op; `window.confirm` no-op on WKWebView; drag/drop interception; WebKitGTK parity on Linux | Size; no mobile | No Linux; heavy for a viewer | Desktop platform unmaintained (its README points to a Capawesome fork) |

**Decision rationale.** The viewer is 300 KB of platform-neutral JS whose only
native needs are "give me the bytes of the file the OS handed you", "save this
file", "confirm", and "open this link". Tauri's cost is Rust on the build
machine and four known webview gaps, each of which is a few lines behind the
adapter. Electron's cost is a permanent 100 MB engine plus a second shell for
iOS. MAUI cannot do Linux. Capacitor's desktop story is dead.

## 3. iOS and iPad shell options, weighed

All three candidates are the same WKWebView loading the same `dist/`; they
differ in who writes roughly 150 lines of native glue.

| Criterion | Tauri iOS | Swift WKWebView wrapper | Capacitor |
| --- | --- | --- | --- |
| Document types | Generated from `bundle.fileAssociations`; `exportedType` is "required on Apple platforms when associating with non-standard file extensions", so `.mdpkg` declares an exported UTI and `.md` imports the public Markdown UTI | Hand-written `CFBundleDocumentTypes` + `UTExportedTypeDeclarations` | Hand-written in the Xcode project |
| Opened file delivery | `RunEvent::Opened { urls }` on iOS (feat commit `753900d`; docs "File Associations on Mobile") | `application(_:open:options:)` / scene delegate | `App.addListener('appUrlOpen')` then `Filesystem.readFile` (base64 across the bridge) |
| Bytes into the webview | Rust reads the path, returns bytes over IPC (R2) | Swift reads, hands to JS via a `WKURLSchemeHandler` or `evaluateJavaScript` | Base64 string, 4/3 overhead |
| Share out | Native sheet via a custom command, or `navigator.share` if it works in WKWebView | `UIActivityViewController` | `@capacitor/share` |
| Maturity | Mobile file associations are documented; issue tauri-apps/tauri#13844 (closed) described iOS support as "experimental (or partial)" when opened in 2025. **Phase 3 opens with a spike on a Mac** | Boring and proven; costs a second language | Proven on iOS; desktop is the problem |
| Store constraints | Guideline 4.2 applies equally to all three | Same | Same |

**Recommendation:** Tauri iOS first, because it keeps one project and one
adapter. The Swift wrapper is the named fallback and is not a large loss: the
adapter contract (§5) is identical, so the JS side does not change if the
shell does. Capacitor is not recommended because it would be a second shell
next to a Tauri desktop.

## 4. One codebase for desktop and iOS?

Yes, with Tauri v2: one `src-tauri/` crate, one `tauri.conf.json`, targets
added with `tauri ios init` and `tauri android init`. The web layer detects a
host through the injected `window.__TAURI__` and loads the adapter; without it
the current browser behaviour stays, so GitHub Pages keeps shipping the same
build. What is *not* shared: platform config blocks (NSIS, `.app` entitlements,
Info.plist additions under `src-tauri/gen/apple`), signing material, and the
device checklists.

## 5. Changes the viewer needs (design input, not implemented)

Each item names the code it touches. Estimates are for the plan stage to
refine.

| # | Change | Touches | Notes |
| --- | --- | --- | --- |
| A | Host adapter module, e.g. `src/host/`: `detect()`, `launchFiles()`, `onOpenFile(cb)`, `readFile(path) → Blob`, `pickFile()`, `saveFile(file)`, `confirm(text)`, `openExternal(url)`, `share(file)`, `onCloseRequested(cb)`. Browser implementation reproduces today's behaviour | new files; `main.js` wiring | Load the Tauri implementation with a dynamic `import()` so the browser eager graph grows by a detection stub only (R9) |
| B | Accept a host source in `receive()` | `main.js:106-107` | `{blob, sourceKind: 'host', path, name}` |
| C | Reopen recents by path | `session.js:31-55` (`reopen`), `:215` (`saveHandle`), `file-access.js` | Store `{path}` in the existing `handles` store; the permission branch stays for browsers |
| D | Export through `saveFile` when hosted | `out.js:6-15`, `review-view.js:134-138` | Required for macOS (tauri#6171); harmless elsewhere |
| E | Share through the host when hosted | `review-view.js:129-144, 160` | iOS native sheet |
| F | Replace `window.confirm` with `await host.confirm` and hook window close | `main.js:121`, `session.js:63`, `189`, `14-20`, `142-143` | WKWebView `confirm()` no-op; native close bypasses `beforeunload`. Flush on close-requested, then confirm if unsaved |
| G | External links through `openExternal` | `markdown-surface.js:11-13` | Tauri `opener` plugin + ACL |
| H | (Optional, later) Paste button reads a copied file natively on Windows | `main.js:284-289`, `clipboard.js` | Would finally make CARD-0057's button do what its label says |
| I | **Loose document synthesizer**: wrap a single `.md` (or a dropped folder later) into an in-memory conforming snapshot: manifest per spec §4 (`mdpkg`, `addressing {anchor, digest, coverage: complete, overrides: null}`, `current {kind: snapshot, id}`, `history {mode: none}`, `namespace`), LF-normalize the text (`snapshotIdentity` rejects CR), compute `current.id` with `snapshotIdentity()` (`src/container/snapshot.js:14-25`), write with `writePackage()` (`writer.js`), then hand the bytes to `openPackage()` | new `src/inbound/loose.js` (name TBD), `main.js` inbound routes, tests | Pattern already exists in `emitReview()` (`src/review/emit.js:8-22`). Open design question R11: how the namespace is derived, because saved work is keyed by (namespace, snapshot id) |
| J | Tauri config | `src-tauri/tauri.conf.json` | `dragDropEnabled: false`; `useHttpsScheme` decided before first release (R1); CSP allowing `blob:` object URLs; capabilities for `dialog`, `fs` (scoped to picked/opened paths), `opener`, `single-instance`, `updater`; `bundle.fileAssociations` for `mdpkg` and `md`/`markdown` |
| K | Build/CI | `.github/workflows/`, `src/web-viewer/build.mjs` V-2 budget | New `desktop.yml` using `tauri-action` on a Windows runner (later a matrix); the Pages workflow is untouched. Any eager-graph growth needs the plan §4 + `APP_BUDGETS` amendment the README requires |

Nothing in the container reader, addressing, review or persistence *logic*
changes; the adapter sits at the edges.

## 6. Phased delivery

### Phase 0: Windows spike (3 to 5 days, throwaway branch)

Answers the unknowns that decide the design; produces a short evidence note,
not product code.

1. `rustup` + C++ workload; `tauri init` against `../dist`; app boots and opens
   the fixture packages.
2. `window.isSecureContext`, `crypto.subtle`, `crypto.randomUUID`,
   `navigator.clipboard.writeText` under the default `http://tauri.localhost`
   origin (R1). If false, switch `useHttpsScheme` now.
3. HTML5 drop and Ctrl+V with `dragDropEnabled: false`.
4. `showOpenFilePicker` behaviour inside WebView2 (works? persists grants?).
5. Bytes over IPC: time a 20 MB `.mdpkg` through `invoke` returning raw bytes
   (`tauri::ipc::Response`) versus `fetch` on the asset protocol (R2).
6. `bundle.fileAssociations` for both extensions: what the NSIS installer
   writes on Windows 10 for a user whose `.md` already has a chosen default
   (R3); whether Explorer shows the app under "Open with"; whether icons
   refresh without logoff.
7. `window.confirm`, `<a download>` and `target="_blank"` inside WebView2, so
   the adapter's Windows branch is known before phase 1.
8. Installer size and cold start time, recorded.

Exit: every row answered with a measurement, and R1 through R4 resolved for
Windows.

### Phase 1: Windows desktop (2 to 3 weeks after the spike)

| Milestone | Delivers |
| --- | --- |
| W1 Shell boots | `src-tauri/` in the repo; `dist/` loads; native picker opens `.mdpkg`; IndexedDB persistence and the 108 Playwright tests unchanged in the browser lane |
| W2 OS entry points | Double-click, "Open with", drag onto the window, and launch with a path all open the file; second launch while running goes to the existing instance and, if work is unsaved, through the existing confirm flow |
| W3 `.md` and adapter | Loose-document synthesizer (item I) with unit tests in the Node suite and a Playwright case in the browser lane; adapter items B to G wired; recents reopen by path |
| W4 Installer and updates | NSIS per-user installer with icons; uninstaller restores the previous association; signing configured (or the unsigned decision recorded, §9); `tauri-action` release workflow; updater with a minisign key held outside the repo; an actual 0.1.0 → 0.1.1 update performed on a clean Windows 10 VM |
| W5 Acceptance | Manual checklist executed and recorded under `docs/investigations/`; `tauri-driver` smoke on the Windows runner covering the seven adapter points; README section for the desktop app |

**Definition of done for Windows.** An installable per-user package that
needs no admin rights; `.mdpkg` associated by default and `.md` at least
listed under "Open with" (default or not per §9); both file types open by
double-click, "Open with", in-app picker, drag onto the window and Ctrl+V;
every existing feature (reading, references, previews, tables, review
authoring, inline comments, export, recents, autosave and recovery) behaves as
in the browser, evidenced by the unchanged Playwright suite on the same
`dist/` plus the shell checklist for the adapter points; auto-update proven
once end to end.

### Phase 2: Linux and macOS (1 to 2 weeks, plus Apple enrolment lead time)

- Linux: deb and AppImage; `MimeType=` in the desktop entry from
  `fileAssociations.mimeType`; shared-mime-info XML for `.mdpkg` if Tauri does
  not emit one (unknown, verify); WebKitGTK parity for `DecompressionStream`,
  `CompressionStream` and the CSS range syntax on Ubuntu 24.04 (R8); `xdg-open`
  for external links.
- macOS: `RunEvent::Opened` path; `.app` + dmg; Developer ID signing and
  notarization through `tauri-action` secrets; adapter branches for save and
  confirm exercised (this is where R4 bites). Requires a Mac and Apple
  Developer Program membership.
- Updater platforms added to `latest.json`.

### Phase 3: iPhone (3 to 4 weeks including review)

Gate first: on a Mac, `tauri ios init`, declare the document types, open a
`.mdpkg` from Files and from a Mail attachment into the app, read its bytes
through the adapter, export through the native share sheet. If any step is
not achievable within a week, switch to the Swift wrapper (§3) with the same
adapter contract. Then: in-app picker (the existing `<input type="file">`
already opens the document picker in WKWebView), persistence, TestFlight,
App Store submission with guideline 4.2 mitigations (owned file type with
icon, "Open in", offline-only, native share, no web content beyond the
viewer). Reuse the device checklist in the CARD-0018 build plan §6. Minimum
iOS 16.4 (native inflate and CSS range syntax).

### Phase 4: iPad (about 1 week)

Same binary. The layout already adapts below 700 px; add multitasking window
sizes, hardware keyboard shortcuts and pointer hover states, and consider a
document-browser start screen. No new shell work.

### Phase 5: Android (later)

`tauri android init`; `mimeType` is required on Android (`.mdpkg` sniffs as
`application/zip`, so expect to also accept that); `View` and `Send` intent
filters; `content://` URIs need a Rust or Kotlin read path; Play signing.

## 7. Risks and unknowns

| # | Risk | Evidence | How it is resolved |
| --- | --- | --- | --- |
| R1 | The viewer needs a secure context (`digest.js:10`). Tauri on Windows serves `http://tauri.localhost` by default; `*.localhost` hosts are "potentially trustworthy" per the W3C Secure Contexts algorithm in agents that resolve them locally, and WebView2 is Chromium, so it is *expected* to pass. A community report shows a non-localhost custom origin failing. Switching later to `useHttpsScheme` "alters where IndexedDB, cookies, and localStorage are stored" (Tauri docs) | W3C spec; Tauri `WindowConfig` docs; hoppscotch#6287 | Phase 0 item 2; the origin is fixed before the first public build |
| R2 | Bytes from disk into the webview. Tauri IPC serialises JSON by default; large arrays are slow. Options: raw-binary `invoke` responses, or `fetch` on the asset protocol which supports range requests and would fit `blobSource`'s slicing | Tauri IPC docs; `source.js` | Phase 0 item 5 with a 20 MB package; pick one command for all platforms |
| R3 | Windows default handler. Tauri's NSIS macro writes `Software\Classes\.ext` default = ProgID (with a backup, restored on uninstall), the ProgID icon and `shell\open\command`, in HKCU or HKLM by install mode; it does not write `OpenWithProgids` and does not call `SHChangeNotify`. Windows 10 protects a user's chosen default through the `UserChoice` hash, so an installer cannot take `.md` from a user who already picked VS Code, and must not try | Tauri `FileAssociation.nsh`; Windows `UserChoice` behaviour | Phase 0 item 6. Recommended default: `.mdpkg` fully owned; `.md` registered as an "Open with" candidate through an `installerHooks` registry addition, and the user promotes it in Settings. Add the `SHChangeNotify` call in the same hook |
| R4 | macOS/iOS webview gaps: `<a download>` no-op (tauri#6171), `window.confirm` no-op (wry#584 and a 2026 downstream report), native close bypassing `beforeunload` | Issues cited | Adapter items D and F; verified in phase 2 |
| R5 | Tauri iOS file-open maturity ("experimental (or partial)" in tauri#13844), security-scoped URL access for in-place opens, and `navigator.share({files})` inside WKWebView never measured on a device (`viewer-app.md` §7.1 had no device either) | Issues and prior investigation | Phase 3 gate on a Mac with a device; Swift fallback |
| R6 | App Store guideline 4.2 rejection | `viewer-app.md` §2.6 | Native affordances listed in phase 3; TestFlight/ad-hoc as fallback distribution |
| R7 | Signing and identity costs: Windows certificate or Azure signing service (individual eligibility not verified here); Apple Developer Program required for notarization and iOS; updater key custody | Tauri signing docs | Decision §9; keys in CI secrets with an offline backup |
| R8 | WebKitGTK parity on Linux for streams and CSS range media queries | Not measured | Phase 2 spike |
| R9 | Eager-graph budget: adapter code counts toward the 145,000-byte gate and the README says a gate failure alone does not justify a raise | README "Deployment"; `build.mjs` | Dynamic import of the host implementation; measure |
| R10 | One window, one package: opening a second file replaces the first (existing confirm at `main.js:121`) | Code | Accepted for phase 1; tabs/windows out of scope |
| R11 | Loose `.md` identity: saved reviews and positions are keyed by (namespace, snapshot id); the id changes whenever the file changes, which the existing reattachment logic already handles, but the *namespace* for a file that never had one must be chosen (derived from the absolute path, from content, a fixed constant, or random per open) | `session.js` `prepare()`; spec §4 | Plan-stage design decision; affects recents and reattachment |
| R12 | Tauri 3.0.0-alpha.1 is out; pin 2.11.x and revisit after phase 2 | crates.io | Pin |
| R13 | Keyboard paste and `showOpenFilePicker` in WebView2 are assumed, not measured | | Phase 0 items 3 and 4 |
| R14 | No Mac, no iOS device and no Linux desktop are attached to this machine; Rust is not installed | Toolchain check | Phase 0 installs Rust; phases 2 and 3 need hardware |

## 8. Not done, noted

- A Rust `CF_HDROP` clipboard reader would let the Paste button open a copied
  file on Windows (item H).
- Serving the opened file through the asset protocol with range support would
  let `blobSource` read only the bytes it needs, matching the format's
  bounded-read design (`viewer-app.md` §3.1).
- The loose-document synthesizer could later take a dropped folder and
  produce the same package `mdpkg pack` would, giving the viewer a no-CLI
  packaging route.
- A shared-mime-info registration and an icon for `.mdpkg` on Linux.

## 9. Decisions to bring to the user before build work starts

1. **Shell:** Tauri v2 for all platforms (recommended), or Electron for a
   faster desktop-only phase 1 that leaves iOS to a second shell.
2. **`.md` on Windows:** register as "Open with" candidate only (recommended),
   or also claim the default for users who have none.
3. **Bare `.md` handling:** synthesize a conforming in-memory snapshot
   (recommended; every feature works, browser gains it too) or a read-only
   plain mode without review features.
4. **Signing for phase 1:** buy an OV certificate, use an Azure signing
   service, or ship unsigned behind a documented SmartScreen warning.
   Apple Developer Program enrolment is needed by phase 2 (macOS
   notarization) and phase 3 regardless.
5. **Distribution:** GitHub Releases plus the Tauri updater (recommended);
   winget or the Microsoft Store can come later.
6. **Origin scheme on Windows:** `http://tauri.localhost` or `https://`, fixed
   at first release because it is the storage origin.

## 10. Evidence and reproduction

Commands run on 2026-09-18 from `src/web-viewer` at `ca2dc7f`:

```text
node --input-type=module -e "import {openPackage} from './src/inbound/open.js'; ..."
  -> bare text/markdown Blob: "No complete EOCD ending at EOF"
  -> docs/spec/review-fixtures/original.mdpkg: tier conforming, documents guide.md,
     manifest keys mdpkg,addressing,current,history,namespace
node -e "require('./dist/build-report.json')" -> eager 95,766 gzip bytes of 145,000
node -v 24.6.0; dotnet --version 10.0.300; cargo/rustc: not found
vswhere -> C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools
WebView2 runtime: C:\Program Files (x86)\Microsoft\EdgeWebView\Application\153.0.4234.32
```

Sources consulted (all fetched 2026-09-18):

- Tauri: `v2.tauri.app/learn/mobile-file-associations/`, `/plugin/updater/`,
  `/plugin/single-instance/`, `/plugin/deep-linking/`, `/start/prerequisites/`,
  `/distribute/sign/windows/`, `/distribute/sign/macos/`, `/distribute/app-store/`,
  `/develop/tests/webdriver/`, `/reference/config/`; docs.rs
  `tauri_utils::config::WindowConfig` (`drag_drop_enabled`, `use_https_scheme`);
  `tauri-apps/tauri` `examples/file-associations/src-tauri/src/main.rs`,
  `crates/tauri-bundler/.../nsis/FileAssociation.nsh`, issues #6171, #13844,
  commit `753900d` (iOS `RunEvent::Opened`); `tauri-apps/wry#584`;
  `tauri-apps/tauri-action` README; crates.io `tauri` (2.11.5 stable,
  3.0.0-alpha.1 newest, updated 2026-09-15); npm `@tauri-apps/cli` 2.11.4.
- Electron 44.4.2 (npm); `electronjs.org/docs/latest/api/app` (`open-file`,
  `second-instance`); electron-builder `FileAssociation` interface docs.
- Capacitor `@capacitor/core` 8.5.2 (npm); `capacitor-community/electron`
  README (unmaintained notice).
- W3C Secure Contexts, "Is origin potentially trustworthy?" localhost step.
- Playwright `class-electron` (experimental).
- Windows `UserChoice` hash behaviour (community write-ups; not Microsoft
  primary documentation).
- Repository: `docs/investigations/viewer-app.md` and
  `viewer-app/ios-evidence.json`;
  `docs/investigations/2026-09-17-card-0057-paste-from-clipboard-button.md`;
  `docs/spec.md` §3.1, §4, §11.1; `src/web-viewer/README.md`.
