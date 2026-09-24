# Native shells for the Markdown Package viewer: investigation and phased plan

Date: 2026-09-18. Investigate task `ee9102ad`; decisions recorded by task
`359a2a42` (CARD-0059). Investigated at commit `ca2dc7f` (master). No
production code was changed by either task.

**Status: DECIDED 2026-09-18.** The user signed off on the five decisions in
§9. This plan is delivered; the phase 0 spike and everything after it are
follow-on work under new cards, not part of CARD-0059.

**Amended 2026-09-20 with the phase 0 spike results** (CARD-0060,
`docs/plans/2026-09-19-phase0-windows-spike.md`, commit `f088f2a`). A working
Tauri v2 shell was built, installed and uninstalled on this Windows 10 machine
and answered phase 0 items 1, 2, 4, 5, 6, 7, 8 and 9. Where this plan
previously stated an assumption it now states the measurement; where a
measurement contradicted the assumption the text says so. The four changes
that move work: **D5 is closed** (keep the default origin), **R2 is closed**
(`plugin-fs` `readFile`), **item F is now a phase 1 blocker** rather than a
macOS portability nicety, and item L's handler gains three rules (§2.7). The
spike note holds the raw numbers; this plan holds only the conclusions.

Revision history, kept because the rejected path is part of the record:

1. First draft recommended Tauri v2 for every target.
2. A refinement asked for the .NET ecosystem to be preferred, so the second
   draft was rebuilt around .NET MAUI hosting the viewer in a `HybridWebView`.
   That investigation found two things the refinement had not assumed: MAUI
   has no Linux target (the only backend is an experimental, unsupported GTK4
   project), and no single .NET tool covers desktop plus iOS from one codebase
   without a second shell for Linux (§3).
3. The user was shown that trade-off and chose Tauri v2 for all platforms,
   despite the .NET preference. This revision records that decision, restores
   the Tauri-based plan, keeps the MAUI evaluation in §3 as the rejection
   rationale, and folds in the other four decisions (§9).

## 0. Outcome

**Shell: Tauri v2 (2.11.x stable; pin 2.x) for every target, one project, one
codebase.** The existing `src/web-viewer/dist/` output is loaded unchanged
inside the platform's system webview (WebView2 on Windows, WebKitGTK on Linux,
WKWebView on macOS, iOS and iPadOS, the Android System WebView on Android).
The viewer gains one small "host adapter" module (§5) so the same build keeps
working on GitHub Pages.

| Platform | Decided | Notes |
| --- | --- | --- |
| Windows (phase 1) | Tauri v2, NSIS per-user installer, `bundle.fileAssociations` for `.mdpkg`; `.md` registered as an "Open with" candidate only (§9 D2); single-instance plugin; updater plugin over GitHub Releases; **unsigned for v1** (§9 D4) | Origin scheme settled by the spike: the default `http://tauri.localhost` is a secure context, so `useHttpsScheme` is **not** set (§9 D5). Blocker before the dialog plugin is registered: item F (§2.4) |
| Windows (phase 1.5) | Native file watcher on an opened loose `.md`, "file changed" notice, and a what-changed diff on reload (§9 D3, §6) | New viewer code; see §1.4 for why it is not free |
| Linux and macOS (phase 2) | Same Tauri project: AppImage/deb; `.app`/dmg with Developer ID signing and notarization | Apple Developer Program needed for macOS |
| iPhone and iPad (phases 3 and 4) | Same Tauri project via `tauri ios init`; one adaptive app. Fallback: a hand-written Swift WKWebView wrapper hosting the same `dist/` if the phase 3 gate fails | Capacitor rejected: its desktop platform is unmaintained, so it would mean two shells |
| Android (phase 5) | Same Tauri project, `androidIntentActionFilters: [View, Send]` | Lowest priority |

Two findings that change the scope the brief assumed:

1. **The viewer cannot open a bare `.md` today.** Every inbound route ends in
   `openPackage()` → `openContainer()`, which parses a ZIP. Reproduced on
   2026-09-18 with Node 24.6.0: a `text/markdown` Blob fails with
   `No complete EOCD ending at EOF`. Opening `.md` files therefore needs a
   small, shell-independent "loose document" synthesizer (§5, item I). The JS
   already contains every building block (ZIP writer, canonical JSON, snapshot
   identity), so this is roughly 40 lines plus tests, and the browser viewer
   gains it too. Decision D3 confirms this route.
2. **Reading a local file's bytes needs no per-platform code path in the
   viewer.** The reader consumes a `Blob` through `blobSource()`
   (`src/container/source.js:23`) and `receive()` already accepts a
   `{blob, sourceKind}` object (`src/main.js:107`). One Rust command that
   returns the file's bytes serves all five targets; only the *delivery of the
   path* differs per OS (argv on Windows/Linux, `RunEvent::Opened` on macOS,
   iOS and Android). See §7 R2 for the IPC size question.

One finding made while recording decision D3, stated up front because it
changes that decision's cost:

3. **The viewer has no history or diff machinery to reuse.** D3 assumed the
   "file changed" diff could reuse "the viewer's existing history/diff
   machinery, the same mechanism used for packaged file history". The web
   viewer reads snapshot packages only; history-dependent references return
   `unsupported / history-reader-required`, and the only diff-related code is
   the profile string used to *parse* diff references. Packaged history is
   produced by the C# generator CLI, which shells out to a real `git`
   process. What the viewer *does* have, and what the plan reuses, is the
   saved-work reattachment flow that already handles "same package, different
   snapshot". The diff itself is new JavaScript. Evidence and consequences in
   §1.4, §5 items L and M, §6 phase 1.5, §7 R15 and R16.

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

| Capability | Where | Browser behaviour today | In a Tauri (system-webview) shell |
| --- | --- | --- | --- |
| Standard file picker | `<input type="file">` with no `accept` (`main.js:19`, `253-258`) | Works everywhere; iOS needs no `accept` so `public.data` is selectable | Works in WebView2, WebKitGTK and WKWebView unchanged. A native picker (`plugin-dialog`) can filter `.md`/`.mdpkg` and return a path for recents |
| Enhanced picker | `showOpenFilePicker` + `FileSystemFileHandle` `queryPermission`/`requestPermission` (`src/inbound/file-access.js:1-16`); handles persisted in the IDB `handles` store (`session.js:215`) | Chromium only, secure context only | WebView2 is Chromium, so it may work as-is (verify, phase 0). In the shell a remembered *path* replaces the handle: `reopen()` (`session.js:31-55`) needs a path branch |
| Drag and drop | HTML5 `drop` with `dataTransfer.files` (`main.js:259-267`) | Works | **Tauri intercepts OS drops by default.** `dragDropEnabled` must be `false` ("Disabling it is required to use HTML5 drag and drop on the frontend on Windows", tauri-utils `WindowConfig` docs) |
| Keyboard paste | `paste` event, `clipboardData.files` (`main.js:268-273`) | Works in every engine (CARD-0057) | Expected to work in WebView2 (same engine). Unverified in WKWebView/WebKitGTK |
| Paste button | `navigator.clipboard.read()` (`src/inbound/clipboard.js:27-38`) | Never yields an OS-copied file in any engine (CARD-0057) | Same in the webview. The shell has a real path to files on the clipboard (§2.6); optional, not in phase 1 |
| Copy reference | `navigator.clipboard.writeText` (`main.js:306`, `316`; `src/ui/recent-view.js:60`) | Secure context + user gesture | Works in WebView2/WKWebView under a secure origin (R1) |
| Package bytes | `blobSource(blob)` slices a `Blob` (`source.js:23-33`); `bytesSource(Uint8Array)` also exists (`:12`) | `File` from picker/drop/paste | Shell reads bytes natively and hands `new Blob([bytes])` to `receive()` |
| Inflate | `DecompressionStream('deflate-raw')` with a lazy fflate fallback (`src/container/inflate.js:2-33`) | Native from Chrome 103 / Safari 16.4 | WebView2 native; WKWebView native on iOS 16.4+; WebKitGTK 2.40+ expected; fallback covers the rest |
| Deflate on export | `CompressionStream('deflate-raw')` with STORE fallback (`src/container/writer.js:9-43`) | Same | Same |
| Web Crypto | `crypto.subtle.digest` (`src/address/digest.js:10-12`), `crypto.randomUUID` (`review-view.js`, `store.js`) | Secure context required; the code throws "serve the app over HTTPS or localhost" otherwise | **Origin must be a secure context.** Confirmed on Windows 2026-09-19: the default `http://tauri.localhost` is one (R1, §2.1, D5); Apple and Linux unmeasured |
| Persistence | IndexedDB (`store.js`), `sessionStorage` tab pointer (`session.js:12-13`), `localStorage` author name (`src/ui/author-name.js:8-16`) | Per origin | All available in WebView2/WKWebView/WebKitGTK. Origin = the shell's scheme; changing the scheme later orphans the data (R1) |
| Export review | `<a download>` on a blob URL (`src/review/out.js:6-15`) | Browser download UI | Works in WebView2 and Chromium; **no-op in Tauri on macOS** (tauri-apps/tauri#6171, closed "not planned"). Route through a native save dialog behind the adapter |
| Share review | `navigator.share({files})` / `canShare` (`src/ui/review-view.js:129, 142-144, 160`) | On by default on Cocoa WebKit (repo evidence `viewer-app/ios-evidence.json`) | WKWebView: expected but never measured on a device. Adapter can call the native share sheet instead |
| Unsaved-work guards | `window.confirm` ×3 (`main.js:121`, `session.js:63`, `189`); `beforeunload` (`main.js:80-81`, `session.js:14-20`); `pagehide`/`visibilitychange` flush (`session.js:142-143`) | Native dialogs | WebView2: **broken once `tauri-plugin-dialog` is registered** — the plugin replaces `window.confirm` with a truthy, always-rejecting Promise, so the guard silently answers yes (measured 2026-09-19, §2.4; item F is a phase 1 blocker). **WKWebView under wry: `confirm()` reported to return `false` with no dialog** (tauri-apps/wry#584; downstream report 2026). Native window close does not raise `beforeunload`; the shell must hook close-requested and call `flush()` |
| External links | `http(s):`/`mailto:` get `target="_blank"` (`src/ui/markdown-surface.js:11-13`) | New tab | Tauri needs the `opener` plugin and an ACL entry to open the system browser |
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

### 1.4 What the viewer has for "history" and "changed version" today

Checked on 2026-09-18 because decision D3 depends on it.

| Claim in D3 | What the code says | Where |
| --- | --- | --- |
| The viewer has history/diff machinery for packaged files | No. `verifySnapshot()` throws `Git verification requires a history backend` for anything but `history.mode: none`. `conformance.js` only recognises `.mdpkg/history/*` entry names when checking a package's shape. The README records that "retained Git history remains deferred" and that commit, diff and hunk references "are parsed and validated but return the application capability result `unsupported / history-reader-required`" | `src/container/snapshot.js:28`; `src/container/conformance.js:26-29, 119`; `src/web-viewer/README.md` "CARD-0021 shipped browse and current addressing" paragraph |
| Something computes diffs | No. `DIFF = 'git-myers-u3-v1'` in `format.js:5` is a profile name used to *parse and validate* `mdpkg://…/v2/diff/…` and `hunk` references (`src/address/reference.js:41-66`). No Myers or any other diff implementation exists under `src/web-viewer/src` | `grep -rn -i diff src/` finds only the profile constant, reference parsing and unrelated comments |
| The packaged-file history mechanism | Lives in the C# generator CLI: `mdpkg update --materialize` emits bootstrap history and `update --tree … --message` appends to a Git-mode lineage; the engine runs a real `git` executable (`EngineSettings.GitExecutable = "git"`, `GitProcess.cs`). The spec's diff profile is Git's own Myers output with three context lines (spec §6.4). None of this runs in a webview, and shipping .NET plus `git` inside a viewer app is not a "free" reuse | `src/generator-cli/README.md`; `src/generator-cli/src/Mdpkg.Core/Contracts.cs:103`; `src/generator-cli/src/Mdpkg.Core/Internal/Git/GitProcess.cs` |
| Something already handles "same file, new content" | Yes, and this is the reusable part. Saved work is keyed by (namespace, state kind, state id); opening a package whose identity differs from the saved one goes through `prepare()` and, when the user expected a specific version, the `mismatch()` offer: "This is a different package/version. Saved work for the expected package has been retained." with an "Open as separate package" action. Reattachment "checks normalized document digests and exact review/draft selectors" and keeps changed or missing text in recovery with copy/discard controls (README, CARD-0046) | `src/persistence/session.js:160-161` (`mismatch`), `:162-200` (`prepare`); `src/ui/recent-view.js:42-48` (`offer`/`clearOffer`) |

Consequence: a re-synthesized loose `.md` gets a new snapshot id (the id is
the SHA-256 over the document bytes and header, `snapshot.js:14-25`), so the
existing keying and reattachment take care of saved comments and drafts
across the change. The notice ("file changed, reload to see what changed")
can reuse the existing offer UI. The *diff view* is new code (§5 item M).

## 2. Tauri v2 as the shell: how each need is met

Versions as published on 2026-09-18: Tauri crate 2.11.5 stable (3.0.0-alpha.1
exists; pin 2.x), `@tauri-apps/cli` 2.11.4, `@tauri-apps/plugin-fs` 2.5.2,
`@tauri-apps/plugin-clipboard-manager` 2.3.3, community
`tauri-plugin-clipboard-api` 2.1.11.

### 2.1 Hosting

`frontendDist` points at `src/web-viewer/dist/`; nothing in the viewer build
changes. The web layer detects the host through the injected
`window.__TAURI__` and dynamically imports the adapter; without it the current
browser behaviour stays, so GitHub Pages ships the same build.

Origin: on Windows the default is `http://tauri.localhost`, switchable to
`https://tauri.localhost` with `useHttpsScheme` ("alters where IndexedDB,
cookies, and localStorage are stored", Tauri docs); on macOS, Linux, iOS and
Android it is the custom `tauri://localhost` scheme.

**Measured on Windows (phase 0, 2026-09-19; WebView2 153.0.4234.32):** under
the default `http://tauri.localhost`, `window.isSecureContext` is `true`,
`crypto.subtle.digest` returns the correct SHA-256, `crypto.randomUUID`
works, and IndexedDB and `localStorage` both persist across app restarts
(`storage.persisted()` is `false`, i.e. evictable, exactly as in a browser).
`showOpenFilePicker`/`showSaveFilePicker` exist and work, and the real viewer
opened a fixture package through its own picker unmodified. **D5 is therefore
closed: keep the default scheme and do not set `useHttpsScheme`** — there is
no storage-origin migration and nothing in the viewer's crypto or persistence
code to change. `useHttpsScheme` was deliberately not measured, as it is only
needed if the default had failed. The Apple and Linux `tauri://localhost`
origins remain unmeasured (R1, phase 2). One Windows aside for the adapter:
`navigator.clipboard.readText()` raises a native WebView2 permission prompt
that blocks the promise until the user answers; the grant then persists.
`writeText` does not prompt.

### 2.2 File associations and launch

`bundle.fileAssociations` (ext, name, description, mimeType, role, rank,
exportedType, androidIntentActionFilters) is honoured on Windows, macOS,
Linux, iOS and Android. Windows and Linux deliver opened paths in argv;
macOS, iOS and Android deliver them through `RunEvent::Opened { urls }`
(Tauri `examples/file-associations/src-tauri/src/main.rs`; iOS support in
commit `753900d`). `tauri-plugin-single-instance` forwards `argv` and `cwd`
from a second launch to the running instance and must be the first plugin
registered.

On Windows the NSIS `FileAssociation.nsh` macro writes
`Software\Classes\.ext` default = ProgID (backing up the previous value and
restoring it on uninstall), the ProgID's `DefaultIcon` and
`shell\open\command`, in HKCU or HKLM by install mode. It does not write
`OpenWithProgids` and does not call `SHChangeNotify`. Decision D2 therefore
maps to: `.mdpkg` through `fileAssociations`; `.md` **not** through
`fileAssociations` but through an `installerHooks` NSIS fragment that writes
the ProgID and `HKCU\Software\Classes\.md\OpenWithProgids\<ProgID>` plus a
`SHChangeNotify(SHCNE_ASSOCCHANGED)`, so the app appears under "Open with"
without touching the extension's default (R3). Windows 10 protects a user's
chosen default with the `UserChoice` hash anyway, so an installer could not
take `.md` from a user who already picked another editor.

**Both routes were verified end to end in phase 0** on this Windows 10
machine, whose `.md` default was already Typora. `.mdpkg` through
`fileAssociations`: double-click launched the installed app with the path as
`argv[1]`; a second double-click while it ran was forwarded by
`tauri-plugin-single-instance` and the second process exited. `.md` through
the `installerHooks` fragment: the app appeared in Explorer's "Open with"
chooser with its icon, marked *New*, immediately and without a logoff, while
`UserChoice` stayed on Typora and shell-executing a `.md` did not launch the
app. Uninstall restored `.md` byte-for-byte. Two defects in the Tauri NSIS
template, both carried into W4 as checklist lines: (1) the `fileAssociations`
`shell\open\command` is written with the **program path unquoted**
(`C:\…\app.exe "%1"`), which breaks for a user whose account name contains a
space, so phase 1 must quote it through a hook or confirm upstream has fixed
it; (2) uninstall restores the extension's previous *value* but leaves an
orphan `HKCU\Software\Classes\.mdpkg` key holding a stale `…_backup` value,
so "the uninstaller restores the backup" should be read as "restores the
value, leaves an empty key".

### 2.3 Bytes into the viewer

**Settled by the phase 0 spike (R2 closed): use `@tauri-apps/plugin-fs`
`readFile`.** No Rust command is written at all, and the plugin is a
dependency anyway for `watch` (§2.7). Release-build times for a 20 MiB
`.mdpkg`, best of three: `plugin-fs` `readFile` 530 ms, raw-bytes command
(`tauri::ipc::Response`) 522 ms, `fetch` on the asset protocol 522 ms —
against **3016 ms** for the default `Vec<u8>` JSON IPC and 1072 ms for
base64. So the three good routes are within 2 % of one another and the
default one is six times slower: the rule is simply *never return `Vec<u8>`
over IPC*. `new Blob([arrayBuffer])` adds 15 ms at that size. (Benchmark
under a release build: the debug build inflates the JSON route to 12.4 s and
would mislead.)

The asset protocol stays the documented upgrade path, not the phase 1
choice: it is the only route that supports range requests, so it is what
would make `blobSource`'s slicing genuinely lazy (§8) rather than slicing a
`Blob` already fully in memory.

### 2.4 Export, share, dialogs, links, close

`plugin-dialog` save dialog plus `plugin-fs` write behind `host.saveFile()`
(required on macOS, tauri#6171); native share on iOS through a small custom
command or `navigator.share` if the device test passes; `plugin-dialog`
`confirm` behind `host.confirm()`; `plugin-opener` behind
`host.openExternal()`; the window's close-requested event calls the adapter's
`flush()` and, if work is unsaved, vetoes through the confirm above. Each is
a few lines behind the adapter; each needs a capability entry.

**`window.confirm` is a phase 1 blocker on Windows too, and the failure is
silent (measured, phase 0).** The plan assumed wry#584 — a macOS/WKWebView
no-op — and that Windows was safe. It is not, and the reason is Tauri's own
plugin, not the webview:

- Bare WebView2 with no dialog plugin registered: `confirm`, `alert` and
  `prompt` are native code, show real *blocking* "tauri.localhost says"
  dialogs, and `confirm()` returns a proper boolean.
- With `tauri_plugin_dialog::init()` registered — which phase 1 does, for
  `host.saveFile()` — the crate injects a script that replaces
  `window.alert` and `window.confirm`. The crate registers only the `open`,
  `save` and `message` commands, so **`window.confirm()` returns a `Promise`
  that always rejects** with `dialog.confirm not allowed. Command not found`.
  A pending Promise is truthy, so every `if (window.confirm(…))` takes the
  "yes" branch with no dialog and no error the user can see — at
  `main.js:121`, `session.js:63` and `session.js:189` that means silently
  discarding unsaved review work. `window.alert()` returns in about 0.5 ms
  with its dialog appearing afterwards; `window.prompt` is left untouched and
  still blocks.

So item F must land *before* the dialog plugin is registered, and W3 carries
an explicit gate for it. What to call instead: the plugin's own
`confirm()`/`message()` JS APIs, which open a real top-level Win32 dialog and
work correctly. Capability note: both are served by the `message` command, so
the permission is `dialog:allow-message` (or `dialog:default`) —
`dialog:allow-confirm` and `dialog:allow-ask` are deprecated aliases for it,
not separate permissions.

### 2.5 Updates, signing, distribution (decision D4)

`tauri-plugin-updater` supports NSIS/MSI on Windows, `.app.tar.gz` on macOS
and AppImage on Linux; artifacts are signed with a minisign key and listed in
a `latest.json` that `tauri-action` publishes to GitHub Releases. Losing the
private key means no further updates, ever (key in CI secrets plus an
offline copy). On Windows the updater exits the app while the installer
runs.

v1 ships **without** Authenticode signing. Consequences, recorded so nobody
is surprised: the downloaded installer shows SmartScreen's "Windows
protected your PC" and the user clicks "More info" → "Run anyway"; the README
documents that. The updater's minisign signature is unrelated to Authenticode
and is still mandatory. Whether an updater-launched (not browser-downloaded)
install also trips SmartScreen is verified on the clean VM in W4 (R7). A
certificate (OV, or Azure Artifact Signing if the publisher qualifies) is
revisited after v1 proves out; Apple Developer Program enrolment is needed
by phase 2 regardless.

### 2.6 Clipboard: the native path exists (decision D1 confirmation)

Three layers, verified 2026-09-18:

- Official `@tauri-apps/plugin-clipboard-manager` 2.3.3: `readText`,
  `writeText`, `readImage`, `writeImage`, `writeHtml`, `clear`; platforms
  "windows, linux, macos, android (plain-text only), ios (plain-text only)";
  no file support; every permission off by default.
- Community `tauri-plugin-clipboard` (CrossCopy; npm `tauri-plugin-clipboard-api`
  2.1.11, Tauri v2 branch): text, rich text, HTML, image, **files**
  (`readFiles`, `readFilesURIs`, `writeFilesURIs`; on Linux and macOS URIs
  must start with `file://`), and a clipboard monitor (`startListening`,
  `onClipboardUpdate`). Desktop only for files.
- Custom Rust commands over IPC for anything else (for example `CF_HDROP`
  directly through `clipboard-win`).

This is what makes CARD-0057's Paste button able to open an OS-copied file
in the desktop app (item H). It stays optional and out of phase 1.

### 2.7 File watching (decision D3)

`@tauri-apps/plugin-fs` 2.5.2 exposes `watch` (debounced; `delayMs`) and
`watchImmediate`, behind the crate's `watch` feature, which pulls
`notify = "8"` and `notify-debouncer-full = "0.6"`. It needs the
`fs:allow-watch`/`fs:allow-unwatch` permissions and an explicit scope, or the
call fails with "forbidden path". The plan watches the opened file's *parent
directory* non-recursively and filters events by file name, rather than the
file itself, because editors that save by writing a temporary file and
renaming it over the original replace the watched inode (R15). A scope of
`[dir, dir/**]` plus `fs:allow-watch` was enough in the spike.

**Measured against 11 real save patterns (phase 0, `delayMs: 500`), including
Notepad, VS Code 1.138, Vim 9.1 in both backup modes and `git checkout`.** A
save produces 1 to 4 debounced callbacks, collapsing up to 15 raw OS events,
with no duplicate batch. The parent-directory shape survives contact with
reality and stays the choice, but for a different reason than the plan gave,
and the handler needs three rules the plan did not state:

1. **Never key on `modify`.** This is the finding that would otherwise have
   become a bug. A real Vim save and a `File.Replace`-style atomic save
   deliver **no `modify` event for the document** to a directory watcher —
   only a `create` (plus a `remove` of a backup file). Treat `create`,
   `remove`, `modify` and rename events identically: "something touched this
   name, re-read and compare".
2. **A `remove` is not a deletion.** `Move-Item -Force` and `git checkout`
   both deliver `remove` immediately before `create`. Re-stat after the
   debounce rather than reacting to `remove`; that ordering is what makes
   R17's "a missing file shows a notice, not an error" safe.
3. **Filename filtering is mandatory**, as the plan said: one Vim save alone
   also emits `.watched.md.swp`, `.watched.md.swx`, `4913` and `watched.md~`
   in the same directory, and the atomic patterns emit `*.tmp` and
   `*~RF….TMP`.

Snapshot-identity gating stays mandatory for the reason D3 assumed: a
metadata-only touch is *indistinguishable* from a real in-place save at the
event level (one `modify(any)` either way), so only recomputing the snapshot
id separates them.

Two corrections to R15's premises, recorded so nobody designs around them
again: on Windows a watch on the *file path* does **not** go stale across a
rename or delete-and-create (notify's backend is `ReadDirectoryChangesW` on
the parent with a name filter, so there is no inode to lose), and VS Code
writes **in place** on Windows rather than using a safe-write temp file.
Parent-directory watching is still right — the Linux and macOS backends do
lose the inode, one code path is cheaper than two, and a file watch cannot be
armed before the file exists — but it is a portability choice, not a Windows
necessity.

### 2.8 Testing

The Playwright suite keeps running against `dist/` over HTTP and stays the
regression gate for the viewer. The shell lane tests only the adapter and OS
entry points: `tauri-driver` (Edge WebDriver) on Windows and Linux; there is
no macOS driver, so macOS and iOS use the manual checklists.

## 3. Alternatives, and why .NET MAUI was rejected

### 3.1 .NET MAUI, evaluated in full at the user's request

The second draft investigated MAUI as the primary shell (MAUI docs, the
`dotnet/maui` source and the Windows App SDK docs, all read 2026-09-18).
What it would have looked like, kept as the record:

- Hosting: `HybridWebView` (.NET 9+) serving `dist/` as raw assets from
  `https://0.0.0.x` on Windows/Android and `app://0.0.0.x` on iOS/Mac
  Catalyst; `WebResourceRequested` (.NET 10) to serve opened files on the app
  origin; `InvokeDotNet`/`InvokeJavaScriptAsync` as the bridge.
- Windows: unpackaged publish (`WindowsPackageType=None`) with a Velopack
  per-user installer, because MSIX cannot be installed unsigned;
  `ActivationRegistrationManager.RegisterForFileTypeActivation` for the file
  types; `AppInstance` redirection for single instance, which on .NET 10 needs
  a custom `Main` (the clean `OnAppInstanceActivated` hook is .NET 11, GA
  2026-11-10); a native drop target because Explorer drops into WebView2
  inside WinUI 3 have been broken since 2022 (microsoft-ui-xaml#7366).
- Apple: Mac Catalyst with Developer ID signing and a notarized `.pkg`; iOS
  document types in `Info.plist` with `OpenUrl`/`SceneOpenUrl` lifecycle
  delegates; `Share`, `FilePicker`, CommunityToolkit `FileSaver` behind the
  adapter; no `WKUIDelegate` in the iOS handler, so `confirm()` shows nothing.
- Secure context on iOS/Mac: `app://` should be trusted by WebKit's
  scheme-handler rule (`SecurityOrigin.cpp`), unproven on a device.

Why it was rejected, and the user agreed:

1. **No Linux.** Microsoft's supported-platforms page (2026-09-08) lists
   Android, iOS, Mac Catalyst and Windows. The GTK4 backend in
   `dotnet/maui-labs` says "This backend is experimental and will change
   between releases. It is not officially supported by Microsoft", and lists
   WebKitGTK as "Blazor only". Rollout item 2 asks for Linux on the same shell
   as Windows.
2. **No single .NET tool covers desktop plus iOS from one codebase.** Closing
   the Linux gap meant a second shell (Photino.NET over WebKitGTK), or moving
   everything to Uno Platform, or dropping Linux. Tauri covers all five
   targets from one `src-tauri/` crate.
3. Secondary: MSIX signing is mandatory and the Azure signing service has
   publisher-eligibility gates; the WinUI 3 drop bug; installed size in the
   tens of MB versus a few MB; the MAUI workload is not installed here.

What MAUI would have given that Tauri does not: C# shared with
`src/generator-cli`, and no Rust toolchain. Those were weighed and judged
smaller than one codebase for every target.

### 3.2 Comparison

| Criterion | Tauri v2 (decided) | .NET MAUI (rejected) | Electron | Capacitor |
| --- | --- | --- | --- | --- |
| Reuse `dist/` as-is | Yes, `frontendDist` | Yes, `HybridWebView` raw assets | Yes | Yes |
| Engine | System webview | System webview | Bundled Chromium | System webview (mobile) |
| Windows installer size | A few MB (WebView2 present on Windows 10 1803+; `webviewInstallMode` otherwise) | Tens of MB self-contained, or runtime prerequisites | ~100 MB class | As Electron on desktop |
| Linux | Yes (deb, rpm, AppImage) | **No** | Yes | Unmaintained community platform |
| macOS | Yes | Mac Catalyst | Yes | As Electron |
| iOS / Android | Yes, same project | Yes, same project | No | Yes |
| File associations | `bundle.fileAssociations` on all five targets | Activation API / appxmanifest / Info.plist by hand | electron-builder `fileAssociations` | Info.plist by hand |
| Second launch | `tauri-plugin-single-instance` | `AppInstance` redirection (custom `Main` on .NET 10) | `requestSingleInstanceLock` | Manual |
| Auto-update | `tauri-plugin-updater` + GitHub Releases | Velopack or App Installer | `electron-updater` | As Electron |
| Clipboard files | Community plugin or Rust command (§2.6) | `Clipboard.GetContent()` on Windows | Native | Plugin |
| Known webview gaps | macOS `<a download>` no-op; `confirm()` no-op on WKWebView; drop interception | `confirm()`/`<a download>` on WKWebView; WinUI drop bug | None relevant | None relevant |
| Toolchain here | Rust installed 2026-09-19 (1.98.1); VS 2019 Build Tools present | .NET 10 SDK present; MAUI workload not installed | Node only | Node only |
| Language | Rust | C# | JS | JS + Swift/Kotlin |

Electron is excluded by size and by having no iOS story; Capacitor by its
dead desktop platform (its README points to a Capawesome fork).

### 3.3 iOS shell within the Tauri decision

| Criterion | Tauri iOS (decided) | Swift WKWebView wrapper (fallback) |
| --- | --- | --- |
| Document types | Generated from `bundle.fileAssociations`; `exportedType` is "required on Apple platforms when associating with non-standard file extensions", so `.mdpkg` declares an exported UTI and `.md` imports the public Markdown UTI | Hand-written `CFBundleDocumentTypes` + `UTExportedTypeDeclarations` |
| Opened file delivery | `RunEvent::Opened { urls }` (commit `753900d`; docs "File Associations on Mobile") | `application(_:open:options:)` / scene delegate |
| Bytes into the webview | Rust reads the path, returns bytes over IPC (R2) | Swift reads, hands to JS via a `WKURLSchemeHandler` |
| Maturity | Documented; tauri-apps/tauri#13844 (closed) called iOS support "experimental (or partial)" in 2025. Phase 3 opens with a spike on a Mac | Boring and proven; costs a second language |

The adapter contract (§5) is identical for both, so the JS does not change if
the shell does.

## 4. One codebase for desktop and iOS?

Yes, with Tauri v2: one `src-tauri/` crate, one `tauri.conf.json`, targets
added with `tauri ios init` and `tauri android init`. What is *not* shared:
platform config blocks (NSIS hooks, `.app` entitlements, Info.plist additions
under `src-tauri/gen/apple`), signing material, and the device checklists.

## 5. Changes the viewer needs (design input, not implemented)

Each item names the code it touches. Estimates are for the plan stage to
refine.

| # | Change | Touches | Notes |
| --- | --- | --- | --- |
| A | Host adapter module, e.g. `src/host/`: `detect()`, `launchFiles()`, `onOpenFile(cb)`, `readFile(path) → Blob`, `pickFile()`, `saveFile(file)`, `confirm(text)`, `openExternal(url)`, `share(file)`, `onCloseRequested(cb)`, and from phase 1.5 `watchFile(path, cb)`/`unwatch()`. Browser implementation reproduces today's behaviour | new files; `main.js` wiring | Load the Tauri implementation with a dynamic `import()` so the browser eager graph grows by a detection stub only (R9) |
| B | Accept a host source in `receive()` | `main.js:106-107` | `{blob, sourceKind: 'host', path, name}` |
| C | Reopen recents by path | `session.js:31-55` (`reopen`), `:215` (`saveHandle`), `file-access.js` | Store `{path}` in the existing `handles` store; the permission branch stays for browsers |
| D | Export through `saveFile` when hosted | `out.js:6-15`, `review-view.js:134-138` | Required for macOS (tauri#6171); harmless elsewhere |
| E | Share through the host when hosted | `review-view.js:129-144, 160` | iOS native sheet |
| F | **Phase 1 BLOCKER (raised from "portability nicety" by the phase 0 spike).** Replace `window.confirm`/`window.alert` with `await host.confirm` / `host.message`, and hook window close | `main.js:121`, `session.js:63`, `189`, `14-20`, `142-143` | Registering `tauri-plugin-dialog` (which phase 1 needs for `saveFile`) replaces `window.confirm` with a Promise that is **truthy and always rejects**, so every existing `if (window.confirm(…))` silently takes the "yes" branch and discards unsaved work — measured, §2.4. Must land *before* the plugin is registered; W3 gates on a grep. Also the WKWebView no-op (wry#584) and native close bypassing `beforeunload`. Flush on close-requested, then confirm if unsaved. Capability: `dialog:allow-message`, not `dialog:allow-confirm` |
| G | External links through `openExternal` | `markdown-surface.js:11-13` | Tauri `opener` plugin + ACL |
| H | (Optional, later) Paste button reads a copied file natively | `main.js:284-289`, `clipboard.js` | §2.6; would make CARD-0057's button do what its label says |
| I | **Loose document synthesizer** (decision D3): wrap a single `.md` into an in-memory conforming snapshot: manifest per spec §4 (`mdpkg`, `addressing {anchor, digest, coverage: complete, overrides: null}`, `current {kind: snapshot, id}`, `history {mode: none}`, `namespace`), LF-normalize the text (`snapshotIdentity` rejects CR), compute `current.id` with `snapshotIdentity()` (`src/container/snapshot.js:14-25`), write with `writePackage()` (`writer.js`), then hand the bytes to `openPackage()` | new `src/inbound/loose.js` (name TBD), `main.js` inbound routes, tests | Pattern already exists in `emitReview()` (`src/review/emit.js:8-22`). Open design question R11: how the namespace is derived, because saved work is keyed by (namespace, snapshot id) and the watcher (item L) relies on the namespace staying stable across edits |
| J | Tauri config | `src-tauri/tauri.conf.json` | `dragDropEnabled: false`; **no `useHttpsScheme`** — the default origin is confirmed a secure context (D5 closed, §2.1); CSP allowing `blob:` object URLs; capabilities for `dialog` (`dialog:allow-message`, §2.4), `fs` (`fs:allow-read-file`, and for `watch` `fs:allow-watch`/`fs:allow-unwatch` scoped `[dir, dir/**]` of the opened path), `opener`, `single-instance`, `updater`; `bundle.fileAssociations` for `mdpkg` only, `.md` via `installerHooks` (§2.2) |
| K | Build/CI | `.github/workflows/`, `src/web-viewer/build.mjs` V-2 budget | New `desktop.yml` using `tauri-action` on a Windows runner (later a matrix); the Pages workflow is untouched. **Measured build budget (phase 0, this machine):** release `tauri build` **~18 min cold** (template profile, `lto = true`, `codegen-units = 1`), `cargo build` debug 7 min cold and 17–55 s incremental; installer ~1.6 MiB, installed exe ~5 MiB, cold start ~1.9 s. The workflow must cache `~/.cargo` and `target/` from the first commit or every run pays the 18 minutes; W4's association work cannot be iterated without a full release build each time. Any eager-graph growth needs the plan §4 + `APP_BUDGETS` amendment the README requires |
| L | **Loose-file watcher and change notice** (decision D3, phase 1.5): after a loose `.md` opens from a path, the shell watches its parent directory (`plugin-fs` `watch`, `delayMs` about 500, non-recursive, filtered to the file name). **Three handler rules the spike proved necessary (§2.7): do not key on `modify` — a Vim or atomic save delivers only `create` for the document; do not treat a bare `remove` as a deletion, because `remove` precedes `create` in rename-based saves, so re-stat after the debounce; filter the filename, because one Vim save also emits `.swp`/`.swx`/`4913`/`file~` in the same directory.** On an event the adapter re-reads the file, LF-normalizes, and computes the would-be snapshot id with the item I code; if it equals the current one the event is dropped (touch, metadata-only save, duplicate event). Otherwise the viewer shows the existing offer strip ("This file changed on disk. Reload to see what changed." with a Reload action) and keeps the current view untouched. Reload re-synthesizes through item I and opens it as the same namespace with a new snapshot id, so `prepare()` and the CARD-0046 reattachment carry saved comments and drafts across | adapter (item A); `main.js` receive path; `recent-view.js` offer UI (`:42-48`); `session.js` `prepare`/`mismatch`; tests | Reuses: synthesizer, identity, offer UI, keying and reattachment. New: the watch wiring and the notice text. Not offered on a package (`.mdpkg`) in phase 1.5; watching packages is a later extension |
| M | **What-changed view on reload** (decision D3, phase 1.5): the viewer keeps the previous document text in memory (and in the package record, so a restart survives), and on Reload renders a unified diff between the previous and new text. **This is new code**, because the viewer has no diff machinery (§1.4). Default: a line-based Myers diff with three lines of context, in a lazily imported chunk so the eager graph does not grow (R9); the Myers/three-context choice mirrors the spec's `git-myers-u3-v1` profile so a later Git-mode integration can present the same hunks. Size estimate 150 to 250 lines of JS plus a renderer panel and tests. The view is read-only and lives beside the document, not inside the review model | new `src/history/` or `src/ui/changes-view.js` (names TBD); `main.js`; tests | If the diff is dropped, item L still delivers the notice and reattachment; item M is what makes "see what changed" true. Alternative rejected: running the CLI's Git-mode append from the app, which would ship .NET and `git` inside the viewer |

Nothing in the container reader, addressing, review or persistence *logic*
changes; the adapter sits at the edges. Items L and M are the only ones that
add user-visible behaviour beyond "the browser viewer, in a window".

## 6. Phased delivery

### Phase 0: Windows spike — DONE 2026-09-20 (CARD-0060)

Answered the unknowns that decide the design; the evidence note is
`docs/plans/2026-09-19-phase0-windows-spike.md` (commit `f088f2a`), and the
throwaway shell lived in a gitignored `.spike-tauri/`. No product code
changed. Item status:

1. **Answered.** `rustup` + VS 2019 Build Tools; a hand-written Tauri v2
   project (crate 2.11.5) loaded `src/web-viewer/dist/` unchanged, and the
   real viewer opened `docs/spec/review-fixtures/original.mdpkg` through its
   own picker (conforming tier, 1 document, 2 entries).
2. **Answered — D5 closed.** Default `http://tauri.localhost`:
   `isSecureContext` true, `crypto.subtle` and `randomUUID` correct,
   IndexedDB and `localStorage` persist across restarts. Keep the default;
   `useHttpsScheme` not set and not measured (§2.1).
3. **Still open.** HTML5 drop and Ctrl+V with `dragDropEnabled: false` were
   not exercised; they move to W2 (R13).
4. **Answered.** `showOpenFilePicker`/`showSaveFilePicker` exist and work in
   WebView2. Whether a grant persists across restarts is still open (W1).
5. **Answered — R2 closed.** `plugin-fs` `readFile` (§2.3).
6. **Answered — R3 closed for Windows.** Both association routes verified on
   a machine whose `.md` default was already Typora, including icon refresh
   without logoff and uninstall restoration; two NSIS template defects found
   (§2.2, W4).
7. **Answered, and it changed the plan.** `window.confirm` is a silent
   truthy-Promise trap once the dialog plugin is registered — item F is now a
   blocker (§2.4). `<a download>` and `target="_blank"` were not exercised;
   they ride along with W3's adapter items D and G.
8. **Answered.** Installer 1.6 MiB, installed exe 5 MiB, cold start ~1.9 s,
   release build ~18 min (item K).
9. **Answered.** 11 save patterns measured; three handler rules added to
   item L (§2.7); R15's inode and safe-write premises corrected.

Exit criteria met for R1 (Windows), R2 and R3; R4 is macOS/iOS and remains
for phase 2. Still open after the spike: phase 0 item 3, File System Access
grant persistence, half-written large saves, a file-only `fs:scope` for
`watch`, and everything about signing/updater/SmartScreen (W4).

### Phase 1: Windows desktop (2 to 3 weeks after the spike)
Execution: docs/plans/2026-09-23-phase1-execution.md (2026-09-23, CARD-0070; sub-cards CARD-0071 to CARD-0079).

| Milestone | Delivers |
| --- | --- |
| W1 Shell boots | `src-tauri/` in the repo; `dist/` loads; native picker opens `.mdpkg`; IndexedDB persistence; the 108 Playwright tests unchanged in the browser lane |
| W2 OS entry points | Double-click, "Open with", drag onto the window, and launch with a path all open the file; second launch while running goes to the existing instance and, if work is unsaved, through the existing confirm flow |
| W3 `.md` and adapter | Loose-document synthesizer (item I) with unit tests in the Node suite and a Playwright case in the browser lane; adapter items B to G wired; recents reopen by path. **Gate (item F, blocking):** a repo grep for `window.confirm` and for `window.alert` under `src/web-viewer/src` returns zero matches before `tauri-plugin-dialog` is registered, and a shell smoke proves a cancelled confirm actually cancels — without this the desktop build silently discards unsaved work (§2.4) |
| W4 Installer and updates | NSIS per-user installer with icons, unsigned (D4), SmartScreen steps documented in the README; `.mdpkg` association and the `.md` "Open with" hook (D2); uninstaller restores the previous association; `tauri-action` release workflow; updater with a minisign key held outside the repo; an actual 0.1.0 → 0.1.1 update performed on a clean Windows 10 VM, including whether the updater-launched install trips SmartScreen (R7). **Two fixes the spike found in the Tauri NSIS template (§2.2):** quote the program path in the `fileAssociations` `shell\open\command` (unquoted upstream; breaks for an account name containing a space — test with such a profile), and have the uninstaller delete the orphan `HKCU\Software\Classes\.mdpkg` key it leaves behind with a stale `…_backup` value |
| W5 Acceptance | Manual checklist executed and recorded under `docs/investigations/`; `tauri-driver` smoke on the Windows runner covering the adapter points; README section for the desktop app |

**Definition of done for Windows (phase 1).** An installable per-user package
that needs no admin rights; `.mdpkg` associated by default and `.md` listed
under "Open with" (D2); both file types open by double-click, "Open with",
in-app picker, drag onto the window and Ctrl+V; every existing feature
(reading, references, previews, tables, review authoring, inline comments,
export, recents, autosave and recovery) behaves as in the browser, evidenced
by the unchanged Playwright suite on the same `dist/` plus the shell checklist
for the adapter points; auto-update proven once end to end; the SmartScreen
warning documented.

### Phase 1.5: live loose-file changes (about 1 week; scope addition from D3)

Called out as its own phase because it adds roughly a week (items L and M)
to the 2 to 3 week phase 1 estimate, and because item M is new viewer code
rather than a shell concern. It ships in the same Windows release train,
after W5, and before phase 2 starts.

| Milestone | Delivers |
| --- | --- |
| L1 Watch and notice | Item L: watcher on the parent directory of an opened loose `.md`; identity-gated change detection; offer strip with Reload; reload re-synthesizes and goes through reattachment; unit tests for the identity gate and debouncing in the Node suite (the watcher itself is shell-side, so its test is a `tauri-driver` smoke: edit the file, see the strip); no auto-reload |
| L2 What changed | Item M: unified line diff between the previous and new text, lazily loaded, rendered beside the document after Reload; a Playwright case in the browser lane using the synthesizer with two texts (no shell needed); eager-graph budget unchanged (R9) |

Definition of done: editing an opened `.md` in an external editor shows the
notice within about a second and never reloads by itself; a temp-file-and-
rename save produces one notice, not two and not a "file deleted" state; a
metadata-only touch produces none; Reload shows the diff and keeps saved
comments and drafts attached where the text is unchanged, with the CARD-0046
recovery behaviour where it is not.

### Phase 2: Linux and macOS (1 to 2 weeks, plus Apple enrolment lead time)

- Linux: deb and AppImage; `MimeType=` in the desktop entry from
  `fileAssociations.mimeType`; shared-mime-info XML for `.mdpkg` if Tauri does
  not emit one (unknown, verify); WebKitGTK parity for `DecompressionStream`,
  `CompressionStream` and the CSS range syntax on Ubuntu 24.04 (R8); `xdg-open`
  for external links; `notify` inotify behaviour for the watcher.
- macOS: `RunEvent::Opened` path; `.app` + dmg; Developer ID signing and
  notarization through `tauri-action` secrets; adapter branches for save and
  confirm exercised (this is where R4 bites); secure context of
  `tauri://localhost` on WKWebView measured (R1).
- Updater platforms added to `latest.json`.

### Phase 3: iPhone (3 to 4 weeks including review)

Gate first: on a Mac, `tauri ios init`, declare the document types, open a
`.mdpkg` from Files and from a Mail attachment into the app, read its bytes
through the adapter, export through the native share sheet. If any step is
not achievable within a week, switch to the Swift wrapper (§3.3) with the
same adapter contract. Then: in-app picker (the existing `<input type="file">`
already opens the document picker in WKWebView), persistence, TestFlight,
App Store submission with guideline 4.2 mitigations (owned file type with
icon, "Open in", offline-only, native share, no web content beyond the
viewer). Reuse the device checklist in the CARD-0018 build plan §6. Minimum
iOS 16.4 (native inflate and CSS range syntax). The file watcher is desktop
only; iOS apps do not keep a watch on a file in another app's container.

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
| R1 | The viewer needs a secure context (`digest.js:10`). Tauri on Windows serves `http://tauri.localhost` by default; `*.localhost` hosts are "potentially trustworthy" per the W3C Secure Contexts algorithm in agents that resolve them locally, and WebView2 is Chromium, so it is *expected* to pass. A community report shows a non-localhost custom origin failing. Switching later to `useHttpsScheme` "alters where IndexedDB, cookies, and localStorage are stored". On Apple and Linux the origin is `tauri://localhost`; WebKit's scheme-handler rule should make it trustworthy, unmeasured | W3C spec; Tauri `WindowConfig` docs; hoppscotch#6287; WebKit `SecurityOrigin.cpp`; **phase 0 spike §2** | **CLOSED for Windows 2026-09-19:** the expectation held — `isSecureContext` true, `crypto.subtle` correct, IndexedDB and `localStorage` persist, under the default `http://tauri.localhost`. Origin fixed, `useHttpsScheme` not set (§2.1, D5). Apple and Linux `tauri://localhost` still unmeasured: carried to phase 2 |
| R2 | Bytes from disk into the webview. Tauri IPC serialises JSON by default; large arrays are slow. Options: raw-binary `invoke` responses, or `fetch` on the asset protocol which supports range requests and would fit `blobSource`'s slicing | Tauri IPC docs; `source.js`; **phase 0 spike §6** | **CLOSED 2026-09-19: `@tauri-apps/plugin-fs` `readFile` for all platforms.** At 20 MiB, release build: `readFile` 530 ms, raw `ipc::Response` 522 ms, asset protocol 522 ms, base64 1072 ms, default `Vec<u8>` JSON **3016 ms**. No Rust command needed; the plugin is a `watch` dependency anyway. Never return `Vec<u8>` over IPC. Asset protocol remains the upgrade path if lazy slicing is wanted (§2.3, §8) |
| R3 | Windows default handler. Tauri's NSIS macro writes the extension default (with backup); it does not write `OpenWithProgids` or call `SHChangeNotify`. Windows 10 protects a user's chosen default through the `UserChoice` hash | Tauri `FileAssociation.nsh`; Windows `UserChoice` behaviour; **phase 0 spike §3** | **CLOSED for Windows 2026-09-19:** D2's route works exactly as designed — `.mdpkg` owned and launched with `argv[1]`, `.md` added to "Open with" with its icon and no logoff, the user's Typora `UserChoice` untouched, uninstall restoring `.md` byte-for-byte. Two template defects carried into W4: the open command is written unquoted, and uninstall orphans `HKCU\Software\Classes\.mdpkg` (§2.2) |
| R4 | macOS/iOS webview gaps: `<a download>` no-op (tauri#6171), `window.confirm` no-op (wry#584 and a 2026 downstream report), native close bypassing `beforeunload` | Issues cited | Adapter items D and F; verified in phase 2. **Note (phase 0):** `window.confirm` is not only a macOS problem — under `tauri-plugin-dialog` it is a silent truthy-Promise trap on Windows too, which is why item F is a phase 1 blocker (§2.4) |
| R5 | Tauri iOS file-open maturity ("experimental (or partial)" in tauri#13844), security-scoped URL access for in-place opens, and `navigator.share({files})` inside WKWebView never measured on a device | Issues and prior investigation | Phase 3 gate on a Mac with a device; Swift fallback |
| R6 | App Store guideline 4.2 rejection | `viewer-app.md` §2.6 | Native affordances listed in phase 3; TestFlight/ad-hoc as fallback distribution |
| R7 | Unsigned v1 (D4): SmartScreen on the downloaded installer is accepted; whether the updater-launched silent install also trips it is unknown; a false-positive antivirus flag on an unsigned NSIS installer is possible; updater key custody (loss means no further updates) | Tauri signing and updater docs | W4 verifies on a clean VM; key in CI secrets plus an offline copy; certificate revisited after v1 |
| R8 | WebKitGTK parity on Linux for streams and CSS range media queries | Not measured | Phase 2 spike |
| R9 | Eager-graph budget: adapter and diff code count toward the 145,000-byte gate and the README says a gate failure alone does not justify a raise | README "Deployment"; `build.mjs` | Dynamic import of the host implementation and of the diff chunk; measure |
| R10 | One window, one package: opening a second file replaces the first (existing confirm at `main.js:121`) | Code | Accepted for phase 1; tabs/windows out of scope |
| R11 | Loose `.md` identity: saved reviews and positions are keyed by (namespace, snapshot id); the id changes whenever the file changes, which the existing reattachment already handles, but the *namespace* for a file that never had one must be chosen (derived from the absolute path, from content, a fixed constant, or random per open). Item L requires it to be stable across edits of the same path, which rules out content-derived and random-per-open | `session.js` `prepare()`; spec §4 | Plan-stage design decision for W3; path-derived is the working default |
| R12 | Tauri 3.0.0-alpha.1 is out; pin 2.11.x and revisit after phase 2 | crates.io | Pin |
| R13 | Keyboard paste and `showOpenFilePicker` in WebView2 are assumed, not measured | Phase 0 spike §2 | **Partly closed 2026-09-19:** `showOpenFilePicker`/`showSaveFilePicker` exist and work in WebView2, and the viewer opened a real package through its own picker. Still open and moved to W1/W2: whether a File System Access grant persists across restarts, and Ctrl+V of an Explorer-copied file with `dragDropEnabled: false` (phase 0 item 3, not exercised) |
| R14 | No Mac, no iOS device and no Linux desktop are attached to this machine; Rust is not installed | Toolchain check | **Rust installed 2026-09-19** (rustc/cargo 1.98.1, MSVC linker from VS 2019 Build Tools, Windows SDK 10.0.19041.0) and a full release bundle built, so the Windows toolchain is no longer a risk. Phases 2 and 3 still need hardware |
| R15 | **Watcher false positives and misses (D3).** Editors that save through a temporary file and a rename (Vim with `backupcopy=no`/`auto`, Emacs, Sublime with `atomic_save`, many IDE "safe write" modes, and `git checkout`) emit remove/rename plus create events and replace the inode, so a watch on the file itself goes stale on Linux/macOS; editors that write in place emit several modify events per save; some tools touch mtime without changing content; a large save can be observed half-written | `notify` crate documented behaviour; `notify-debouncer-full` | Watch the parent directory and filter by name; `delayMs` debounce; gate every event on the recomputed snapshot id so a no-op write is dropped and a half-written file (id computed, then the final event arrives) is superseded by the next event; never auto-reload. **Measured 2026-09-19 across 11 patterns (spike §5): mostly confirmed, two premises wrong and one new rule.** Wrong: a file-path watch does *not* go stale on Windows (notify uses `ReadDirectoryChangesW` on the parent), and VS Code writes **in place**, not through a safe-write temp file. New and load-bearing: **the handler must not key on `modify`** — a Vim or `File.Replace` save delivers only `create` for the document to a directory watcher. Confirmed: filename filtering is mandatory (a Vim save also emits `.swp`/`.swx`/`4913`/`file~`), a `remove` precedes `create` in rename saves so is not a deletion, a metadata touch is event-indistinguishable from a real save so the snapshot-id gate is mandatory, and `delayMs: 500` collapses up to 15 raw events into 1–4 callbacks with no duplicate batch. A half-written large save was not reproduced (fixtures were small) and stays open (§2.7) |
| R16 | **D3's reuse premise does not hold for the diff.** The viewer has no history or diff code (§1.4); the "what changed" view is new JavaScript; the packaged-history machinery is C# plus `git` and cannot be embedded | §1.4 evidence | Phase 1.5 as an explicit scope addition (about 1 week); item L works without item M if the diff slips |
| R17 | Watching is desktop only; a watched file on a removable or network drive can vanish; the `fs` scope must include the parent directory or `watch` fails with "forbidden path" | Tauri fs plugin docs; phase 0 spike §5 | Capability scope written from the opened path at runtime; a missing file shows a notice, not an error. **Measured 2026-09-19:** `fs:allow-watch` with a scope of `[dir, dir/**]` is sufficient; whether a *file-only* scope also works was not tested. The "notice, not an error" behaviour depends on rule 2 in §2.7 — `remove` arrives before `create` in every rename-based save |

## 8. Not done, noted

- The clipboard route in §2.6 would let the Paste button open a copied file
  on the desktop (item H); not scheduled.
- Serving the opened file through the asset protocol with range support would
  let `blobSource` read only the bytes it needs, matching the format's
  bounded-read design (`viewer-app.md` §3.1). Phase 0 measured it at the same
  cost as `readFile` for a whole-file read (§2.3), so the win here is
  laziness, not throughput.
- The loose-document synthesizer could later take a dropped folder and
  produce the same package `mdpkg pack` would, giving the viewer a no-CLI
  packaging route.
- A shared-mime-info registration and an icon for `.mdpkg` on Linux.
- Watching an opened `.mdpkg` (not only a loose `.md`) is a small extension of
  item L once the identity gate exists.
- Retaining the sequence of loose-file snapshots as real Git-mode history
  would need the CLI's materialize/append path; out of scope for the viewer.

## 9. Decisions (decided 2026-09-18, CARD-0059)

The user signed off on the following. Each entry records what was decided,
why, and where the plan changed as a result. Nothing here is an open
question.

**D1. Shell technology: Tauri v2, for all platforms** (Windows, Linux, macOS,
iOS, iPad, and Android later). .NET MAUI was rejected despite the user's
initial .NET preference, because MAUI has no Linux story and no single .NET
tool covers desktop plus iOS with one codebase; the user was shown this
trade-off (§3.1) and explicitly chose Tauri. Confirmed as part of the
decision: Tauri has a path to real native clipboard access through the
official `tauri-plugin-clipboard-manager` (text, image, HTML) and the richer
community `tauri-plugin-clipboard` (files), plus custom Rust commands over
IPC for anything else needed later (§2.6). *Plan effect:* §0, §2, §4, §5
items A, J, K and every phase are Tauri-based; §3.1 keeps the MAUI record.

**D2. `.md` file association: "Open with" registration only,** not a forced
default handler (Windows 10 `UserChoice` cannot be overridden anyway).
`.mdpkg` is fully owned. *Plan effect:* §2.2 `installerHooks` route instead
of `fileAssociations` for `.md`; phase 0 item 6; W4; R3. *Verified
2026-09-19:* the spike installed both routes on a machine whose `.md`
default was already Typora and confirmed D2 behaves exactly as decided —
"Open with" entry present, existing default untouched, uninstall clean
(§2.2). Two NSIS template defects go to W4.

**D3. Loose `.md` handling: build the snapshot synthesizer** (in-memory wrap
into a conforming snapshot on open, item I) **and add a native file watcher**
(Tauri `plugin-fs` `watch`, the `notify` crate) on the source `.md` path. On
each detected change: synthesize a new snapshot, compare it with the last
one, and surface a "file changed, reload to see what changed" notice rather
than silently reloading, so loose `.md` editing gets live change visibility.
*Recorded qualification:* the decision assumed the comparison could reuse the
viewer's existing history/diff machinery. The viewer has none (§1.4); what
it reuses is the synthesizer, snapshot identity, the offer UI and the
CARD-0046 reattachment. The diff view is new code. *Plan effect:* items L
and M; **phase 1.5** (about 1 week) as an explicit scope addition, called out
separately because it changes the phase 1 estimate; risks R15 (watcher
false positives from temp-file-and-rename saves, debouncing), R16 (reuse
premise), R17 (scope and desktop-only). *Verified 2026-09-19:* the watcher
half of D3 is feasible as decided — 11 real save patterns produce 1 to 4
debounced callbacks each — but item L's handler needs the three rules in
§2.7, chiefly that it must **not** key on the `modify` event, and the
snapshot-id gate is confirmed as the only thing that separates a real save
from a metadata touch.

**D4. Phase 1 signing and updates: ship unsigned for v1,** accepting the
one-time SmartScreen warning, using Tauri's built-in updater against GitHub
Releases. Revisit a signing certificate once this proves out. Apple
Developer Program enrolment remains necessary for phase 2 (notarization) and
phase 3. *Plan effect:* §2.5; W4; Windows definition of done; R7.

**D5. Windows origin scheme (http vs https for the webview): not a product
decision.** It is a technical spike question, left as an explicit phase 0
task to resolve empirically (verify `isSecureContext` and `crypto.subtle`
under whichever scheme Tauri uses) without asking the user. *Plan effect:*
phase 0 item 2; R1; item J.

> **CONFIRMED and closed 2026-09-19 by the phase 0 spike (§2.1; spike note
> §2).** Under Tauri's default Windows origin `http://tauri.localhost`,
> `window.isSecureContext` is `true`, `crypto.subtle.digest` returns the
> correct SHA-256, `crypto.randomUUID` works, and IndexedDB and
> `localStorage` persist across app restarts. **Keep the default scheme; do
> not set `useHttpsScheme`.** No storage-origin migration, no change to the
> viewer's crypto or persistence code, and no further spike work on this
> point. `useHttpsScheme` was deliberately not measured, being needed only
> if the default had failed. This closes D5 for Windows; the Apple and Linux
> `tauri://localhost` origins are a phase 2 measurement under R1.

Subsumed by the above and no longer open: Linux approach (same Tauri
project, D1); Windows packaging (Tauri NSIS per-user installer, D1 and D4);
distribution (GitHub Releases plus the updater, D4); .NET version (moot,
D1). Still to be settled at the plan stage of the relevant card, not by the
user: the loose-file namespace derivation (R11). The IPC bytes route, listed
here as open on 2026-09-18, was settled by measurement on 2026-09-19:
`plugin-fs` `readFile` (R2, §2.3).

## 10. Evidence and reproduction

Commands run on 2026-09-18 from `src/web-viewer` at `ca2dc7f`:

```text
node --input-type=module -e "import {openPackage} from './src/inbound/open.js'; ..."
  -> bare text/markdown Blob: "No complete EOCD ending at EOF"
  -> docs/spec/review-fixtures/original.mdpkg: tier conforming, documents guide.md,
     manifest keys mdpkg,addressing,current,history,namespace
node -e "require('./dist/build-report.json')" -> eager 95,766 gzip bytes of 145,000
grep -rn -i 'history\|diff' src/ -> snapshot.js:28 (history backend rejected),
     conformance.js:26-29,119 (entry-name checks only), format.js:5 (DIFF profile
     constant), reference.js:41-66 (diff/hunk reference parsing); no diff implementation
grep -rn -i 'myers\|"git"' src/generator-cli/src -> Contracts.cs:103 GitExecutable = "git",
     Internal/Git/GitProcess.cs (ProcessStartInfo); FormatValidation.cs:174 profile check
npm view: @tauri-apps/cli 2.11.4, @tauri-apps/plugin-fs 2.5.2,
     @tauri-apps/plugin-clipboard-manager 2.3.3, tauri-plugin-clipboard-api 2.1.11
node -v 24.6.0; dotnet --version 10.0.300; dotnet workload list -> (none); cargo/rustc: not found
vswhere -> Visual Studio Community 2022, 2019, Build Tools 2019
WebView2 runtime: C:\Program Files (x86)\Microsoft\EdgeWebView\Application\153.0.4234.32
```

Superseded on 2026-09-19 by the phase 0 spike, which installed the missing
toolchain and measured everything this plan had assumed:
`rustc`/`cargo` 1.98.1 with the VS 2019 Build Tools MSVC linker and Windows
SDK 10.0.19041.0; a Tauri 2.11.5 shell built, installed, exercised and
uninstalled on Windows 10 Pro 19045 against WebView2 153.0.4234.32. Every
number quoted in §2.1, §2.2, §2.3, §2.7, item K and the amended R1/R2/R3/R13/
R14/R15/R17 rows comes from
`docs/plans/2026-09-19-phase0-windows-spike.md` (commit `f088f2a`), which
holds the raw traces, the registry dumps, the NSIS fragment and the full
benchmark and watcher tables. The throwaway shell was gitignored under
`.spike-tauri/` and the machine was returned to its pre-spike state.

Sources consulted (all fetched 2026-09-18):

- Tauri: `v2.tauri.app/learn/mobile-file-associations/`, `/plugin/updater/`,
  `/plugin/single-instance/`, `/plugin/deep-linking/`, `/plugin/file-system/`
  (`watch`/`watchImmediate`, `delayMs`, `recursive`, `fs:allow-watch`,
  "forbidden path" without a scope), `/plugin/clipboard/` (function list,
  "android (plain-text only), ios (plain-text only)", permissions off by
  default), `/start/prerequisites/`, `/distribute/sign/windows/`,
  `/distribute/sign/macos/`, `/distribute/app-store/`,
  `/develop/tests/webdriver/`, `/reference/config/`; docs.rs
  `tauri_utils::config::WindowConfig` (`drag_drop_enabled`, `use_https_scheme`);
  `tauri-apps/tauri` `examples/file-associations/src-tauri/src/main.rs`,
  `crates/tauri-bundler/.../nsis/FileAssociation.nsh`, issues #6171, #13844,
  commit `753900d` (iOS `RunEvent::Opened`); `tauri-apps/wry#584`;
  `tauri-apps/plugins-workspace` `plugins/fs/Cargo.toml` (`notify = "8"`,
  `notify-debouncer-full = "0.6"`, feature `watch`); `tauri-apps/tauri-action`
  README; crates.io `tauri` (2.11.5 stable, 3.0.0-alpha.1 newest); npm
  versions above.
- `CrossCopy/tauri-plugin-clipboard` README (text, rich text, HTML, files,
  image; `readFiles`/`readFilesURIs`/`writeFilesURIs`; `file://` prefix on
  Linux/macOS; `startListening`/`onClipboardUpdate`; Tauri v2 default).
- .NET MAUI docs on learn.microsoft.com: Supported platforms (2026-09-08);
  HybridWebView (2026-07-08); App lifecycle (2026-08-11); Linux GTK4 backend
  (2026-05-07); Publish unpackaged Windows apps; Publish a Mac Catalyst app
  outside the Mac App Store; File picker; Share; Community Toolkit FileSaver.
  `dotnet/maui` `HybridWebViewHandler.cs` and `HybridWebViewHandler.iOS.cs`.
  Windows App SDK Rich activation (2026-09-10) and Sign an MSIX package
  (2026-04-14); `mattleibow/MauiSingleInstanceApp`; microsoft-ui-xaml#7366,
  WebView2Feedback#2546, #4908; Velopack docs; Photino.NET 4.0.16; Uno
  Platform WebView docs; .NET 11 schedule (GA 2026-11-10).
- Electron 44.4.2 (npm); `electronjs.org/docs/latest/api/app`;
  electron-builder `FileAssociation` interface docs.
- Capacitor `@capacitor/core` 8.5.2 (npm); `capacitor-community/electron`
  README (unmaintained notice).
- W3C Secure Contexts, "Is origin potentially trustworthy?" localhost step;
  WebKit `Source/WebCore/page/SecurityOrigin.cpp`.
- Windows `UserChoice` hash behaviour (community write-ups; not Microsoft
  primary documentation).
- Repository: `docs/investigations/viewer-app.md` and
  `viewer-app/ios-evidence.json`;
  `docs/investigations/2026-09-17-card-0057-paste-from-clipboard-button.md`;
  `docs/spec.md` §3.1, §4, §5, §6.4, §11.1; `src/web-viewer/README.md`
  ("Browser history and resume (CARD-0046)", "CARD-0021 shipped browse and
  current addressing"); `src/generator-cli/README.md`.
