# Native shells for the Markdown Package viewer: investigation and phased plan

Date: 2026-09-18. Investigate task `ee9102ad`. Investigated at commit
`ca2dc7f` (master). No production code was changed. This document is a plan for
sign-off, not a build record: nothing below has been implemented.

Revision note: the first draft of this document recommended Tauri v2. A
refinement from the caller on the same day asked for the .NET ecosystem to be
preferred, with .NET MAUI hosting the existing web-viewer JavaScript as the
primary recommendation for desktop and iOS/iPad unless a hard blocker exists.
This revision is built around .NET MAUI; the Tauri, Electron and Capacitor
findings are kept in §3 as the comparison.

## 0. Outcome and recommendation

**Recommended shell: .NET MAUI (targeting .NET 10, moving to .NET 11 after its
2026-11-10 GA) hosting the unmodified `src/web-viewer/dist/` in a
`HybridWebView`, for Windows, macOS (Mac Catalyst), iPhone, iPad and later
Android.** One MAUI project, one C# host, one small JavaScript "host adapter"
in the viewer so the same build keeps working on GitHub Pages.

**Two blockers, called out explicitly:**

1. **Linux is a hard blocker for MAUI.** Microsoft's supported-platforms page
   (updated 2026-09-08) lists Android, iOS, Mac Catalyst and Windows, plus
   Tizen from Samsung. The only Linux route is the GTK4 backend in
   `dotnet/maui-labs`, whose own page says: "This backend is experimental and
   will change between releases. It is not officially supported by
   Microsoft." Its prerequisites list WebKitGTK as "Blazor only", so there is
   no evidence `HybridWebView` exists there. Rollout item 2 asks for Linux on
   "the same shell/tech as Windows if possible"; with MAUI it is not possible
   today. The plan therefore covers Linux with a second, thin .NET shell
   (Photino.NET, WebKitGTK, same `dist/`, same adapter contract) in phase 2,
   and lists switching the whole project to Uno Platform as the alternative
   if one .NET codebase including Linux matters more than MAUI (§2.9, §9).
2. **No iOS blocker was found on paper, but one item must be proven on a
   device before phase 3 starts.** MAUI serves `HybridWebView` content on iOS
   and Mac Catalyst from a custom `app://` scheme (the `https` scheme is
   reserved there). The viewer needs a secure context for `crypto.subtle`
   and `crypto.randomUUID`. WebKit's `SecurityOrigin.cpp` treats a scheme
   handled by a `WKURLSchemeHandler` as potentially trustworthy, so it is
   expected to work, and iOS file association, "Open in", share sheet and
   document picker are all reachable from MAUI (§2.5). If the device test
   fails, the documented fallback is a custom handler serving from
   `app://localhost`, which WebKit trusts by the localhost rule.

Two findings that change the scope the brief assumed, unchanged from the
first draft:

- **The viewer cannot open a bare `.md` today.** Every inbound route ends in
  `openPackage()` → `openContainer()`, which parses a ZIP. Reproduced on
  2026-09-18 with Node 24.6.0: a `text/markdown` Blob fails with
  `No complete EOCD ending at EOF`. Opening `.md` files needs a small,
  shell-independent "loose document" synthesizer (§5, item I). The JS already
  contains every building block (ZIP writer, canonical JSON, snapshot
  identity), so this is roughly 40 lines plus tests, and the browser viewer
  gains it too.
- **Reading a local file's bytes needs no per-platform code path in the
  viewer.** The reader consumes a `Blob` through `blobSource()`
  (`src/container/source.js:23`) and `receive()` already accepts a
  `{blob, sourceKind}` object (`src/main.js:107`). In MAUI the host serves
  the opened file's bytes through `HybridWebView.WebResourceRequested`
  (.NET 10) at a URL on the app origin; the adapter does `fetch(url).blob()`.
  Only the *delivery of the path* differs per OS (§2.3).

Per platform:

| Platform | Recommendation | Notes |
| --- | --- | --- |
| Windows (phase 1) | MAUI, **unpackaged** (`WindowsPackageType=None`), Velopack per-user installer and updater from GitHub Releases, file types registered with `ActivationRegistrationManager`, single instance through `AppInstance` redirection | MSIX packaging is the alternative; it needs a trusted signing certificate before it will install at all (§2.4) |
| macOS (phase 2) | Same MAUI project, Mac Catalyst, Developer ID signing, notarized `.pkg` | Apple Developer Program required |
| Linux (phase 2) | **Not MAUI.** Photino.NET 4.0.x thin shell over WebKitGTK hosting the same `dist/` | Or Uno Platform for everything; or defer Linux to the browser (§9) |
| iPhone and iPad (phases 3 and 4) | Same MAUI project; one adaptive app | Device gate on secure context first (§6) |
| Android (phase 5) | Same MAUI project | Lowest priority |

## 1. Ground truth: what the viewer depends on today

Evidence is the source at `ca2dc7f`; line numbers are from that commit.

### 1.1 Shape of the deployable

- `src/web-viewer/index.html` is a 13-line shell: one `<div id="app">`, one
  `<link>` to `dist/main.css`, one `<script type="module">` to `dist/main.js`.
- `npm run build` (esbuild 0.25.9, `build.mjs`) writes `dist/index.html`,
  `dist/main.js`, `dist/main.css`, one lazily imported inflate fallback chunk
  and `build-report.json`. Gate D-1 fails the build if any asset path is
  absolute, so `dist/` is a self-contained root that a custom origin can serve.
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

| Capability | Where | Browser behaviour today | In a MAUI `HybridWebView` |
| --- | --- | --- | --- |
| Standard file picker | `<input type="file">` with no `accept` (`main.js:19`, `253-258`) | Works everywhere; iOS needs no `accept` so `public.data` is selectable | Native in WebView2 and WKWebView. On Android the Blazor variant needed a fix to open a chooser (dotnet/maui#4483); the adapter uses MAUI `FilePicker` instead, with UTType/extension/MIME filters per platform |
| Enhanced picker | `showOpenFilePicker` + `FileSystemFileHandle` `queryPermission`/`requestPermission` (`src/inbound/file-access.js:1-16`); handles persisted in the IDB `handles` store (`session.js:215`) | Chromium only, secure context only | WebView2 is Chromium, so it may work as-is (phase 0). In the shell a remembered *path* replaces the handle: `reopen()` (`session.js:31-55`) needs a path branch |
| Drag and drop | HTML5 `drop` with `dataTransfer.files` (`main.js:259-267`) | Works | **Broken in WinUI 3 WebView2**: files from Explorer show a "no drop" cursor (microsoft-ui-xaml#7366, open since 2022; WebView2Feedback#2546, #4908). Handle the drop natively at the MAUI/WinUI level and pass the path to the adapter |
| Keyboard paste | `paste` event, `clipboardData.files` (`main.js:268-273`) | Works in every engine (CARD-0057) | Expected in WebView2 (same engine). Unverified in WKWebView |
| Paste button | `navigator.clipboard.read()` (`src/inbound/clipboard.js:27-38`) | Never yields an OS-copied file in any engine (CARD-0057) | Same. The host *could* do better: on Windows `Clipboard.GetContent()` storage items give the button a real file. Optional, not in phase 1 |
| Copy reference | `navigator.clipboard.writeText` (`main.js:306`, `316`; `src/ui/recent-view.js:60`) | Secure context + user gesture | Works under the shell's secure origin (R1) |
| Package bytes | `blobSource(blob)` slices a `Blob` (`source.js:23-33`); `bytesSource(Uint8Array)` also exists (`:12`) | `File` from picker/drop/paste | Host serves bytes on the app origin via `WebResourceRequested`; adapter builds a `Blob` from `fetch()` |
| Inflate | `DecompressionStream('deflate-raw')` with a lazy fflate fallback (`src/container/inflate.js:2-33`) | Native from Chrome 103 / Safari 16.4 | WebView2 native; WKWebView native on iOS 16.4+; Android System WebView native; fallback covers the rest |
| Deflate on export | `CompressionStream('deflate-raw')` with STORE fallback (`src/container/writer.js:9-43`) | Same | Same |
| Web Crypto | `crypto.subtle.digest` (`src/address/digest.js:10-12`), `crypto.randomUUID` (`review-view.js`, `store.js`) | Secure context required; the code throws "serve the app over HTTPS or localhost" otherwise | Windows/Android origin is `https://0.0.0.x/`, secure by scheme. iOS/Mac origin is `app://0.0.0.x/`, trusted by WebKit's scheme-handler rule; **verify on device** (R1) |
| Persistence | IndexedDB (`store.js`), `sessionStorage` tab pointer (`session.js:12-13`), `localStorage` author name (`src/ui/author-name.js:8-16`) | Per origin | Available in all three engines. On Windows, WebView2 writes its user data next to the exe unless `WEBVIEW2_USER_DATA_FOLDER` is set (MAUI docs recommend `FileSystem.AppDataDirectory`) |
| Export review | `<a download>` on a blob URL (`src/review/out.js:6-15`) | Browser download UI | Works in WebView2. WKWebView has no download delegate in `HybridWebView`; route through CommunityToolkit `FileSaver.SaveAsync` behind the adapter |
| Share review | `navigator.share({files})` / `canShare` (`src/ui/review-view.js:129, 142-144, 160`) | On by default on Cocoa WebKit (repo evidence `viewer-app/ios-evidence.json`) | Adapter calls MAUI `Share.Default.RequestAsync(new ShareFileRequest)` (native sheet on iOS/Mac, Share UI on Windows) |
| Unsaved-work guards | `window.confirm` ×3 (`main.js:121`, `session.js:63`, `189`); `beforeunload` (`main.js:80-81`, `session.js:14-20`); `pagehide`/`visibilitychange` flush (`session.js:142-143`) | Native dialogs | WebView2: works. MAUI's iOS `HybridWebViewHandler` sets no `WKUIDelegate`, so `confirm()` has no panel on iOS/Mac. Native window close does not raise `beforeunload`; hook MAUI `Window.Destroying`/WinUI `OnClosed` and call `flush()` |
| External links | `http(s):`/`mailto:` get `target="_blank"` (`src/ui/markdown-surface.js:11-13`) | New tab | WebView2 raises `NewWindowRequested`; WKWebView needs `createWebViewWith`. Adapter calls MAUI `Launcher.OpenAsync` |
| Images | Never requested from packages (`src/ui/markdown-renderer.js:22-23`) | | Nothing to allow |
| Layout | `@media (max-width: 700px)`, `(width < 700px)`, 44 px touch targets (`styles.css:80-129`) | | Range syntax needs Chrome 104 / Safari 16.4; sets the iOS floor, which matches MAUI Blazor's iOS 16.4 minimum |

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
- The seven-day script-storage cap applies to Safari, not to a home-screen
  app (§3.4); a WKWebView data store inside an app is not Safari either.
- The build plan `docs/superpowers/plans/2026-09-09-card-0018-viewer-app-build-plan.md`
  §6 already holds a real-device iOS checklist to reuse in phase 3.

## 2. .NET MAUI as the shell: how each need is met

Versions as of 2026-09-18: .NET SDK 10.0.300 is installed on this machine;
the `maui` workload is **not** (`dotnet workload list` is empty); Visual Studio
2022 Community is present; WebView2 runtime 153.0.4234.32 is present. .NET 11
is at release candidate with GA scheduled for 2026-11-10.

### 2.1 Hosting control: `HybridWebView`, not `BlazorWebView`

`HybridWebView` (.NET 9+) exists precisely to "host arbitrary HTML/JS/CSS
content in a web view": raw assets under `Resources/Raw/wwwroot` with
`index.html` as the entry, served from an app origin the handler intercepts.
`BlazorWebView` would require Blazor bootstrapping and root components the
viewer does not have. A one-line MSBuild target copies
`src/web-viewer/dist/` into `Resources/Raw/wwwroot` at build time so the
viewer build stays the single source.

Engines per platform (MAUI docs): WebView2 on Windows, `WKWebView` on iOS and
Mac Catalyst, `android.webkit.WebView` on Android.

Origin (from `HybridWebViewHandler.cs` on `dotnet/maui` main and the docs):
`AppHostScheme` is `app` on iOS/Mac Catalyst and `https` elsewhere;
`AppHostAddress` is `0.0.0.1` on main (`0.0.0.0` in the docs); the comment
explains "this isn't real HTTP traffic, since we intercept all the requests
within this origin". Consequence for R1: `https://0.0.0.x` is a secure
context by scheme on Windows and Android; `app://0.0.0.x` on iOS/Mac relies
on WebKit's rule that a scheme handled by a scheme handler is potentially
trustworthy (`SecurityOrigin.cpp`, `shouldTreatAsPotentiallyTrustworthy`).

Bridge: `window.HybridWebView.InvokeDotNet(name, params)` (JS → C#, JSON) and
`hybridWebView.InvokeJavaScriptAsync` / `SendRawMessage` (C# → JS). The .NET
10 `WebResourceRequested` event lets C# answer a request on the app origin
with `SetResponse(status, description, contentType, Task<Stream>)`; its
platform table says intercepting custom schemes works on iOS/Mac Catalyst and
HTTPS on Windows and Android, which is exactly the scheme each platform uses.

### 2.2 Windows: file types, activation, single instance

Two packaging models, both supported by MAUI:

| | Unpackaged (`WindowsPackageType=None`) | Packaged (MSIX) |
| --- | --- | --- |
| Publish | `dotnet publish -f net10.0-windows10.0.19041.0 -c Release -p:RuntimeIdentifierOverride=win-x64 -p:WindowsPackageType=None [-p:WindowsAppSDKSelfContained=true]` → a folder with the exe (MAUI docs) | `.msix` |
| File types | `ActivationRegistrationManager.RegisterForFileTypeActivation(types, icon, displayName, verbs, exePath)`; registrations are per-user (Windows App SDK rich activation docs) | `<uap:FileTypeAssociation>` in `Package.appxmanifest` |
| Activation args | `AppInstance.GetCurrent().GetActivatedEventArgs()`, `Kind == ExtendedActivationKind.File`, `IFileActivatedEventArgs.Files` | Same, plus `AppInstance.Activated` |
| Second launch | `AppInstance.FindOrRegisterForKey` + `RedirectActivationToAsync`; on .NET 10 this needs a custom `Main` (`DISABLE_XAML_GENERATED_MAIN`; `mattleibow/MauiSingleInstanceApp`); .NET 11 adds the `OnAppInstanceActivated` lifecycle hook that returns before a window is created | Same |
| Signing | Optional for the exe (SmartScreen warning if unsigned) | **Required**: "Windows requires MSIX packages to be signed with a valid code signing certificate" that chains to a trusted root |
| Installer/updates | Velopack: `Setup.exe` installs per-user to `%LocalAppData%\{packId}` with no elevation; updates from GitHub Releases; signing "very recommended (but not required)" | App Installer / Store |
| Runtime | Framework-dependent needs the .NET and Windows App SDK runtimes; `WindowsAppSDKSelfContained=true` bundles them | Bundled |

Recommendation for phase 1: **unpackaged + Velopack**, because MSIX cannot be
installed unsigned and the signing options have identity gates (Azure
Artifact Signing public-trust is for organizations in the USA, Canada, EU and
UK, and individual developers in the USA and Canada only; an OV certificate
is USD 300 to 500 per year; the Store signs for free). Register `.mdpkg` with
the `open` verb; register `.md` the same way (Windows lists the app under
"Open with" and the user promotes it in Settings; a user's existing
`UserChoice` cannot be overridden programmatically, R3).

Drag and drop from Explorer into WebView2 inside WinUI 3 is a known open bug
(§1.2), so the MAUI page takes the drop natively (a `DropGestureRecognizer`
or WinUI `AllowDrop` on the root) and hands the path to the adapter.

### 2.3 Bytes into the viewer

The adapter asks the host to open a path; C# reads the file (or the
`FileResult.OpenReadAsync()` stream on Android, where `FullPath` may be a
`content://` URI) and registers it under a token; `WebResourceRequested`
serves `https://0.0.0.x/opened/<token>` (or `app://…` on Apple) as
`application/octet-stream`; the adapter does
`new File([await (await fetch(url)).blob()], name)` and calls `receive()`.
Fallback if interception misbehaves on a platform: `InvokeJavaScriptAsync`
with a base64 string (4/3 overhead, fine for the size class the reader
allows).

### 2.4 Export, share, dialogs, links

- Export: CommunityToolkit.Maui `FileSaver.Default.SaveAsync(fileName,
  stream)` (Windows `FileSavePicker`, iOS/Mac document picker, Android).
- Share: `Share.Default.RequestAsync(new ShareFileRequest { File = new
  ShareFile(path) })`; the file is first written to `FileSystem.CacheDirectory`.
- Confirm: `Application.Current.MainPage.DisplayAlert(title, text, ok, cancel)`
  behind `host.confirm()`, because WKWebView shows no panel for
  `window.confirm` under MAUI's handler.
- Links: `Launcher.OpenAsync(uri)` from `NewWindowRequested` (WebView2) or the
  WKWebView `createWebViewWith` delegate.
- Close: MAUI `Window.Destroying` plus WinUI `OnClosed`/Catalyst
  `WillTerminate` call the adapter's `flush()` and, if work is unsaved, veto
  through the confirm above.

### 2.5 iOS and iPad

- Document types: `Platforms/iOS/Info.plist` gets `CFBundleDocumentTypes`
  (`LSItemContentTypes`, `CFBundleTypeRole` Viewer, `LSHandlerRank`),
  `UTExportedTypeDeclarations` for `.mdpkg` (conforming to `public.data` and
  `public.zip-archive`) and `UTImportedTypeDeclarations` for Markdown
  (`net.daringfireball.markdown`), optionally
  `LSSupportsOpeningDocumentsInPlace`. Files "opened in" or "copied to" the
  app arrive through the MAUI lifecycle delegates `OpenUrl` or
  `SceneOpenUrl` (`ConfigureLifecycleEvents(events => events.AddiOS(...))`).
  Copies land in `Documents/Inbox` and are plain `File.ReadAllBytes`; in-place
  opens need `NSUrl.StartAccessingSecurityScopedResource()`.
- In-app picker: MAUI `FilePicker` with a `FilePickerFileType` keyed by
  `DevicePlatform.iOS` listing UTType identifiers including `public.data`
  (the picker doc: "use Uniform Type Identifiers"); `OpenReadAsync()` for the
  bytes. The existing `<input type="file">` also opens the document picker in
  WKWebView and can stay as the in-page route.
- Share out: `Share.Default.RequestAsync(new ShareFileRequest)`; on iPadOS set
  `PresentationSourceBounds` so the popover anchors to the button.
- Store: Apple Developer Program, App Store Connect record with the bundle
  identifier, TestFlight; guideline 4.2 mitigations as in phase 3.
- Build: iOS needs a Mac with Xcode ("a networked Mac is required for iOS
  development" per MAUI docs). None is attached to this machine.

### 2.6 macOS via Mac Catalyst

`dotnet publish -f net10.0-maccatalyst` with `CreatePackage`,
`EnableCodeSigning`, `EnablePackageSigning`, a Developer ID Application
certificate, a Developer ID Installer certificate, a Developer ID
provisioning profile and `UseHardenedRuntime=true`, then `xcrun notarytool
submit … --wait` and `xcrun stapler staple`. The MAUI page documents a
`_SkipCodesignVerify` target workaround for a `codesign` exit-3 verification
failure. App Sandbox is optional outside the Store; if enabled, the file
picker needs the `files.user-selected` entitlements. Document types go in
`Platforms/MacCatalyst/Info.plist`; opened files arrive through the same
`OpenUrl`/`SceneOpenUrl` delegates. The Catalyst app defaults to the iPad UI
idiom; `UIDeviceFamily` 6 selects the Mac idiom.

### 2.7 Android (later)

Intent filters for `VIEW`/`SEND` on `application/zip` and `text/markdown`
(a `.mdpkg` sniffs as ZIP), `OnNewIntent` lifecycle delegate, `content://`
URIs read via `FileResult.OpenReadAsync()`/`ContentResolver`, `READ_MEDIA_*`
permissions as the picker doc lists. The origin is `https://0.0.0.x`.

### 2.8 Testing

The Playwright suite keeps running against `dist/` over HTTP and stays the
regression gate for the viewer. The shell lane tests only the adapter and OS
entry points: on Windows, either Appium/WinAppDriver or Playwright attached
to WebView2 over CDP (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=…`
plus `chromium.connectOverCDP`), to be chosen in phase 0; on iOS, the
device checklist.

### 2.9 Linux: the gap and the .NET options

| Option | What it is | Fit |
| --- | --- | --- |
| Photino.NET 4.0.16 (NuGet) | .NET desktop shell over WebView2 / WKWebView / WebKitGTK; loads local static files; active (a 2026-03 maintenance notice) | Smallest: a second ~200-line C# host reusing the same `dist/` and JS adapter contract; no file-association or updater machinery of its own (a `.desktop` entry with `MimeType=` and Velopack's AppImage cover that) |
| MAUI GTK4 backend (`dotnet/maui-labs`) | Experimental, "not officially supported by Microsoft", "will change between releases"; WebKitGTK listed as "Blazor only" | Not a basis for a shipped Linux build in this plan |
| Uno Platform | .NET UI framework whose `WebView2` control "is supported on all Uno Platform targets", including Linux X11 via WebKit2GTK (with `WebResourceRequested` unsupported there) | Would replace MAUI on every platform; a different decision (§9) |
| Defer | Linux users keep the GitHub Pages viewer | Zero cost; fails rollout item 2 |

Recommendation: Photino.NET for Linux in phase 2, unless the user prefers Uno
for everything.

## 3. Comparison with the non-.NET shells

Versions on 2026-09-18: Tauri crate 2.11.5 stable (3.0.0-alpha.1 exists),
`@tauri-apps/cli` 2.11.4, Electron 44.4.2, `@capacitor/core` 8.5.2.

| Criterion | .NET MAUI (recommended) | Tauri v2 | Electron | Capacitor |
| --- | --- | --- | --- | --- |
| Reuse `dist/` as-is | Yes, `HybridWebView` raw assets | Yes, `frontendDist` | Yes | Yes |
| Engine | System webview | System webview | Bundled Chromium | System webview (mobile) |
| Windows installer size | Tens of MB self-contained (measure in phase 0); framework-dependent needs .NET + Windows App SDK runtimes | A few MB (WebView2 already present) | ~100 MB class | As Electron on desktop |
| Linux | **No** (experimental backend only) | Yes | Yes | Unmaintained community platform |
| macOS | Mac Catalyst | Yes | Yes | As Electron |
| iOS / Android | Yes, same project | Yes, same project (`tauri ios init`) | No | Yes |
| File associations | Unpackaged: `ActivationRegistrationManager`; packaged: appxmanifest; iOS/Mac: Info.plist by hand | `bundle.fileAssociations` on all five targets; argv on Windows/Linux, `RunEvent::Opened` elsewhere | electron-builder `fileAssociations`; `open-file` on macOS, argv on Windows | Info.plist by hand, `appUrlOpen` |
| Drag/drop into the page | WinUI 3 WebView2 bug (open since 2022); handle natively | Must set `dragDropEnabled: false` | Works | Works on mobile |
| Auto-update | Velopack (unpackaged) or App Installer (MSIX) | `tauri-plugin-updater`, minisign-signed `latest.json` on GitHub Releases | `electron-updater` | As Electron |
| Known webview gaps | `confirm()` and `<a download>` on WKWebView; WebView2 user-data folder | macOS `<a download>` no-op (tauri#6171), `confirm()` no-op on WKWebView (wry#584) | None relevant | None relevant |
| Toolchain here | .NET 10 SDK present; MAUI workload to install; Mac needed for Apple targets | Rust not installed; VS 2019 Build Tools present | Node only | Node only |
| Language | C# (matches `src/generator-cli`) | Rust | JS | JS + Swift/Kotlin |

Tauri would have been the choice on size and on Linux coverage; the caller's
.NET preference and the shared language with the generator CLI decide for
MAUI, with Linux handled separately. Electron is excluded by size and by
having no iOS story; Capacitor by its dead desktop platform.

## 4. One codebase for desktop and iOS?

With MAUI: one project covers Windows, macOS, iPhone, iPad and Android, with
per-platform folders under `Platforms/` for Info.plist, appxmanifest and
lifecycle hooks. Linux needs the separate Photino host (§2.9). The JavaScript
adapter contract (§5) is identical for every host, so the viewer does not
know which shell it is in beyond `window.HybridWebView` or a Photino-injected
object being present.

## 5. Changes the viewer needs (design input, not implemented)

| # | Change | Touches | Notes |
| --- | --- | --- | --- |
| A | Host adapter module, e.g. `src/host/`: `detect()`, `launchFiles()`, `onOpenFile(cb)`, `readFile(token) → Blob`, `pickFile()`, `saveFile(file)`, `confirm(text)`, `openExternal(url)`, `share(file)`, `onCloseRequested(cb)`. Browser implementation reproduces today's behaviour; MAUI implementation wraps `window.HybridWebView.InvokeDotNet` and listens for `HybridWebViewMessageReceived` | new files; `main.js` wiring | Load the host implementation with a dynamic `import()` so the browser eager graph grows by a detection stub only (R9) |
| B | Accept a host source in `receive()` | `main.js:106-107` | `{blob, sourceKind: 'host', path, name}` |
| C | Reopen recents by path | `session.js:31-55` (`reopen`), `:215` (`saveHandle`), `file-access.js` | Store `{path}` in the existing `handles` store; the permission branch stays for browsers |
| D | Export through `saveFile` when hosted | `out.js:6-15`, `review-view.js:134-138` | Required on iOS/Mac; harmless elsewhere |
| E | Share through the host when hosted | `review-view.js:129-144, 160` | Native sheet |
| F | Replace `window.confirm` with `await host.confirm` and hook window close | `main.js:121`, `session.js:63`, `189`, `14-20`, `142-143` | WKWebView has no confirm panel under MAUI; native close skips `beforeunload`. Flush on close-requested, then confirm if unsaved |
| G | External links through `openExternal` | `markdown-surface.js:11-13` | `Launcher.OpenAsync` |
| H | (Optional, later) Paste button reads a copied file natively on Windows | `main.js:284-289`, `clipboard.js` | Would make CARD-0057's button do what its label says |
| I | **Loose document synthesizer**: wrap a single `.md` into an in-memory conforming snapshot: manifest per spec §4 (`mdpkg`, `addressing {anchor, digest, coverage: complete, overrides: null}`, `current {kind: snapshot, id}`, `history {mode: none}`, `namespace`), LF-normalize the text (`snapshotIdentity` rejects CR), compute `current.id` with `snapshotIdentity()` (`src/container/snapshot.js:14-25`), write with `writePackage()` (`writer.js`), then hand the bytes to `openPackage()` | new `src/inbound/loose.js` (name TBD), `main.js` inbound routes, tests | Pattern already exists in `emitReview()` (`src/review/emit.js:8-22`). Open design question R10: how the namespace is derived, because saved work is keyed by (namespace, snapshot id) |
| J | MAUI project | new `src/desktop-app/` (name TBD): MAUI app, `HybridWebView` page, MSBuild copy of `dist/`, `WebResourceRequested` file server, activation/lifecycle hooks per platform, `WEBVIEW2_USER_DATA_FOLDER`, Velopack integration, Photino host for Linux in phase 2 | C#; roughly 300 to 500 lines across platforms |
| K | Build/CI | `.github/workflows/`, `src/web-viewer/build.mjs` V-2 budget | New `desktop.yml` on a Windows runner (later a macOS runner for Catalyst/iOS); the Pages workflow is untouched. Any eager-graph growth needs the plan §4 + `APP_BUDGETS` amendment the README requires |

Nothing in the container reader, addressing, review or persistence *logic*
changes; the adapter sits at the edges.

## 6. Phased delivery

### Phase 0: Windows spike (3 to 5 days, throwaway branch)

Answers the unknowns that decide the design; produces a short evidence note,
not product code.

1. `dotnet workload install maui`; MAUI app with a `HybridWebView` whose
   `wwwroot` is a copy of `dist/`; fixture packages open.
2. `window.isSecureContext`, `crypto.subtle`, `crypto.randomUUID`,
   `navigator.clipboard.writeText`, IndexedDB persistence across restarts
   under `https://0.0.0.x/` with `WEBVIEW2_USER_DATA_FOLDER` set (R1).
3. `<input type="file">`, Ctrl+V paste, and HTML5 drop inside the WinUI
   WebView2; expect drop to fail (R4) and prove the native `DropGestureRecognizer`
   route instead.
4. `showOpenFilePicker` behaviour inside WebView2 (works? persists grants?).
5. Bytes over `WebResourceRequested`: time a 20 MB `.mdpkg` through
   `fetch().blob()` versus base64 `InvokeJavaScriptAsync` (R2).
6. Unpackaged publish; `RegisterForFileTypeActivation` for `.mdpkg` and `.md`;
   what Explorer shows for a user whose `.md` already has a chosen default
   (R3); activation args on double-click and "Open with"; single-instance
   redirection on .NET 10 with a custom `Main` (R8).
7. `window.confirm`, `<a download>`, `NewWindowRequested` inside WebView2, so
   the adapter's Windows branch is known before phase 1.
8. Velopack `Setup.exe`: per-user install, size (framework-dependent and
   self-contained), cold start time, an update from a local feed.
9. Pick the Windows shell test approach (§2.8).

Exit: every row answered with a measurement, and R1 through R4 resolved for
Windows.

### Phase 1: Windows desktop (2 to 3 weeks after the spike)

| Milestone | Delivers |
| --- | --- |
| W1 Shell boots | `src/desktop-app/` in the repo; `dist/` copied at build; native picker opens `.mdpkg`; IndexedDB persistence; the 108 Playwright tests unchanged in the browser lane |
| W2 OS entry points | Double-click, "Open with", drop onto the window, and launch with a path all open the file; second launch while running redirects to the running instance and, if work is unsaved, goes through the existing confirm flow |
| W3 `.md` and adapter | Loose-document synthesizer (item I) with unit tests in the Node suite and a Playwright case in the browser lane; adapter items B to G wired; recents reopen by path |
| W4 Installer and updates | Velopack `Setup.exe` with icons; uninstaller unregisters the file types; signing configured (or the unsigned decision recorded, §9); GitHub Actions release workflow; an actual 0.1.0 → 0.1.1 update performed on a clean Windows 10 VM |
| W5 Acceptance | Manual checklist executed and recorded under `docs/investigations/`; shell smoke tests on the Windows runner covering the seven adapter points; README section for the desktop app |

**Definition of done for Windows.** An installable per-user package that
needs no admin rights; `.mdpkg` and `.md` registered so both open by
double-click, "Open with", in-app picker, drop onto the window and Ctrl+V
(default-app promotion for `.md` left to the user, §9); every existing
feature (reading, references, previews, tables, review authoring, inline
comments, export, recents, autosave and recovery) behaves as in the browser,
evidenced by the unchanged Playwright suite on the same `dist/` plus the
shell checklist for the adapter points; auto-update proven once end to end.

### Phase 2: macOS and Linux (2 to 3 weeks, plus Apple enrolment lead time)

- macOS (Mac Catalyst): `OpenUrl`/`SceneOpenUrl` path; Developer ID
  certificates, provisioning profile, hardened runtime, notarized `.pkg`
  (§2.6); adapter branches for save, share, confirm and links exercised
  (this is where the WKWebView gaps bite). Requires a Mac and Apple
  Developer Program membership. Velopack's macOS support against a Catalyst
  bundle is unverified; App Store or a plain download page are the
  fallbacks.
- Linux (Photino.NET): second host over WebKitGTK loading the same `dist/`;
  `.desktop` entry with `MimeType=` and a shared-mime-info XML for `.mdpkg`;
  WebKitGTK parity for `DecompressionStream`, `CompressionStream` and the CSS
  range syntax on Ubuntu 24.04 (R11); AppImage via Velopack.

### Phase 3: iPhone (3 to 4 weeks including review)

Gate first, on a Mac with a device: `HybridWebView` under `app://` reports
`isSecureContext === true` and `crypto.subtle` works (R1); a `.mdpkg` opens
from Files and from a Mail attachment through `OpenUrl`/`SceneOpenUrl`; bytes
reach the adapter; export goes through the native share sheet. If the secure
context fails, apply the `app://localhost` custom-handler fallback and
re-test before continuing. Then: document types with icons, in-app picker
(`FilePicker` with `public.data`), persistence, TestFlight, App Store
submission with guideline 4.2 mitigations (owned file type with icon, "Open
in", offline-only, native share, no web content beyond the viewer). Reuse
the device checklist in the CARD-0018 build plan §6. Minimum iOS 16.4.

### Phase 4: iPad (about 1 week)

Same binary. The layout already adapts below 700 px; add multitasking window
sizes, hardware keyboard shortcuts and pointer hover states, and anchor the
share popover with `PresentationSourceBounds`. No new shell work.

### Phase 5: Android (later)

Intent filters, `OnNewIntent`, `content://` reads, Play signing (§2.7).

## 7. Risks and unknowns

| # | Risk | Evidence | How it is resolved |
| --- | --- | --- | --- |
| R1 | Secure context. Windows/Android serve `https://0.0.0.x` (secure by scheme). iOS/Mac serve `app://0.0.0.x`; WebKit's `shouldTreatAsPotentiallyTrustworthy` returns true when "the scheme is handled by a scheme handler", so it should pass, but no device measurement exists. The viewer throws without `crypto.subtle` (`digest.js:10`) | `HybridWebViewHandler.cs`; WebKit `SecurityOrigin.cpp`; MAUI docs | Phase 0 item 2 (Windows) and the phase 3 gate (iOS). Fallback: custom handler on `app://localhost` |
| R2 | Bytes from disk into the webview through `WebResourceRequested`; Android "replaces the whole request" rather than intercept-and-continue, which is fine for our own URL but untested | MAUI docs restriction table | Phase 0 item 5; base64 `InvokeJavaScriptAsync` fallback |
| R3 | Windows default handler: per-user registration lists the app under "Open with"; a user's `UserChoice` for `.md` is hash-protected and cannot be taken over programmatically; whether `RegisterForFileTypeActivation` makes an *unowned* `.mdpkg` open by double-click without a Settings step needs measuring | Windows App SDK docs; `UserChoice` write-ups | Phase 0 item 6 |
| R4 | Drag and drop from Explorer into WebView2 inside WinUI 3 is an open bug since 2022 (microsoft-ui-xaml#7366) | Issue | Native drop at the MAUI level; verified in phase 0 item 3 |
| R5 | WKWebView under MAUI: no `WKUIDelegate` for `confirm()`, no download delegate, `target="_blank"` needs a delegate | `HybridWebViewHandler.iOS.cs` | Adapter items D, F, G; verified in phases 2 and 3 |
| R6 | MSIX must be signed with a trusted certificate to install; Azure Artifact Signing public trust is limited by publisher location and type; OV certificates cost USD 300 to 500 per year | MSIX signing docs | Phase 1 ships unpackaged + Velopack; the signing decision is §9 item 4 |
| R7 | **Linux is outside MAUI's support** | MAUI supported-platforms and GTK4 backend pages | Photino.NET host in phase 2, or Uno, or defer (§9 item 2) |
| R8 | Single-instance redirection on .NET 10 needs a custom `Main`; the clean `OnAppInstanceActivated` hook is .NET 11 (GA 2026-11-10). A transient window may flash on .NET 10 | MAUI lifecycle docs (net-maui-11.0 moniker) | Phase 0 item 6; move to .NET 11 after GA |
| R9 | Eager-graph budget: adapter code counts toward the 145,000-byte gate and the README says a gate failure alone does not justify a raise | README "Deployment"; `build.mjs` | Dynamic import of the host implementation; measure |
| R10 | Loose `.md` identity: saved reviews and positions are keyed by (namespace, snapshot id); the id changes whenever the file changes, which the existing reattachment logic already handles, but the *namespace* for a file that never had one must be chosen (derived from the absolute path, from content, a fixed constant, or random per open) | `session.js` `prepare()`; spec §4 | Plan-stage design decision; affects recents and reattachment |
| R11 | WebKitGTK parity on Linux for streams and CSS range media queries; Photino's own file-drop and custom-scheme support | Not measured | Phase 2 spike |
| R12 | App Store guideline 4.2 rejection | `viewer-app.md` §2.6 | Native affordances listed in phase 3; TestFlight/ad-hoc as fallback distribution |
| R13 | Installed size and cold start of a self-contained MAUI Windows app versus the few-MB Tauri baseline; framework-dependent builds add a runtime prerequisite | Not measured | Phase 0 item 8 |
| R14 | No Mac, no iOS device and no Linux desktop are attached to this machine; the MAUI workload is not installed | Toolchain check | Phase 0 installs the workload; phases 2 and 3 need hardware |
| R15 | Velopack with Windows App SDK/MAUI unpackaged apps is not documented explicitly (examples cover generic C#, WPF, Uno) | Velopack docs | Phase 0 item 8 |
| R16 | One window, one package: opening a second file replaces the first (existing confirm at `main.js:121`) | Code | Accepted for phase 1; tabs/windows out of scope |

## 8. Not done, noted

- A Windows clipboard read (`Clipboard.GetContent()` storage items) would let
  the Paste button open a copied file (item H).
- Serving the opened file with HTTP range support through
  `WebResourceRequested` would let `blobSource` read only the bytes it
  needs, matching the format's bounded-read design (`viewer-app.md` §3.1).
- The loose-document synthesizer could later take a dropped folder and
  produce the same package `mdpkg pack` would, giving the viewer a no-CLI
  packaging route.
- The Photino Linux host and the MAUI host could share one C# "host core"
  library (file token registry, loose-file helpers) once both exist.

## 9. Decisions to bring to the user before build work starts

1. **Shell:** .NET MAUI for Windows, macOS, iOS, iPad and Android
   (recommended, per the refinement), accepting that Linux is separate.
2. **Linux:** Photino.NET thin shell in phase 2 (recommended), Uno Platform
   for everything instead of MAUI, or defer Linux to the browser.
3. **Windows packaging:** unpackaged + Velopack per-user installer
   (recommended) or MSIX (requires a trusted signing certificate before
   anyone can install it).
4. **Signing for phase 1:** ship the unpackaged exe unsigned behind a
   documented SmartScreen warning, buy an OV certificate, or use Azure
   Artifact Signing if the publisher qualifies. Apple Developer Program
   enrolment is needed by phase 2 (macOS notarization) and phase 3 regardless.
5. **`.md` on Windows:** register as a handler and let the user promote it in
   Settings (recommended); there is no supported way to take an existing
   default.
6. **Bare `.md` handling:** synthesize a conforming in-memory snapshot
   (recommended; every feature works, browser gains it too) or a read-only
   plain mode without review features.
7. **.NET version:** start on .NET 10 now with the custom-`Main`
   single-instance workaround, or wait for .NET 11 GA (2026-11-10) and its
   activation hook before phase 1 W2.

## 10. Evidence and reproduction

Commands run on 2026-09-18 from `src/web-viewer` at `ca2dc7f`:

```text
node --input-type=module -e "import {openPackage} from './src/inbound/open.js'; ..."
  -> bare text/markdown Blob: "No complete EOCD ending at EOF"
  -> docs/spec/review-fixtures/original.mdpkg: tier conforming, documents guide.md,
     manifest keys mdpkg,addressing,current,history,namespace
node -e "require('./dist/build-report.json')" -> eager 95,766 gzip bytes of 145,000
node -v 24.6.0; dotnet --version 10.0.300; dotnet workload list -> (none installed)
dotnet --list-sdks -> 10.0.300 present; vswhere -> Visual Studio Community 2022, 2019, Build Tools 2019
cargo/rustc: not found
WebView2 runtime: C:\Program Files (x86)\Microsoft\EdgeWebView\Application\153.0.4234.32
```

Sources consulted (all fetched 2026-09-18):

- .NET MAUI docs on learn.microsoft.com: Supported platforms (ms.date
  2026-09-08); HybridWebView (2026-07-08; browser engines, raw assets,
  `InvokeDotNet`/`InvokeJavaScriptAsync`, `WebResourceRequested` and its
  restriction table, `WEBVIEW2_USER_DATA_FOLDER`); App lifecycle (2026-08-11;
  iOS `OpenUrl`/`SceneOpenUrl`, Windows `OnAppInstanceActivated` under the
  net-maui-11.0 moniker); Linux GTK4 backend (2026-05-07); Publish
  unpackaged Windows apps with the CLI (2026-01-15); Publish a Mac Catalyst
  app outside the Mac App Store; File picker; Share; Community Toolkit
  FileSaver.
- `dotnet/maui` source on main: `HybridWebViewHandler.cs` (`AppHostScheme`,
  `AppHostAddress = "0.0.0.1"`), `HybridWebViewHandler.iOS.cs`
  (`SetUrlSchemeHandler(…, "app")`, no `WKUIDelegate`).
- Windows App SDK: Rich activation (2026-09-10;
  `ActivationRegistrationManager`, `GetActivatedEventArgs`, per-user
  registrations); Sign an MSIX package (2026-04-14; signing required, Azure
  Artifact Signing eligibility and costs); `mattleibow/MauiSingleInstanceApp`.
- WinUI 3 WebView2 drop bug: microsoft-ui-xaml#7366, WebView2Feedback#2546
  and #4908.
- WebKit `Source/WebCore/page/SecurityOrigin.cpp`
  (`shouldTreatAsPotentiallyTrustworthy`, `isLocalHostOrLoopbackIPAddress`).
- Velopack docs (Windows overview, installers, signing) and getting-started
  for C#; Photino.NET README and NuGet versions (4.0.16); Uno Platform
  WebView docs; .NET 11 schedule (GA 2026-11-10).
- Tauri: `v2.tauri.app/learn/mobile-file-associations/`, `/plugin/updater/`,
  `/plugin/single-instance/`, `/plugin/deep-linking/`, `/start/prerequisites/`,
  `/distribute/sign/windows/`, `/distribute/sign/macos/`, `/distribute/app-store/`,
  `/develop/tests/webdriver/`, `/reference/config/`; docs.rs
  `tauri_utils::config::WindowConfig`; `tauri-apps/tauri`
  `examples/file-associations`, `nsis/FileAssociation.nsh`, issues #6171,
  #13844, commit `753900d`; `tauri-apps/wry#584`; crates.io `tauri` 2.11.5.
- Electron 44.4.2 (npm); `electronjs.org/docs/latest/api/app`;
  electron-builder `FileAssociation` interface docs.
- Capacitor `@capacitor/core` 8.5.2 (npm); `capacitor-community/electron`
  README (unmaintained notice).
- W3C Secure Contexts, "Is origin potentially trustworthy?" localhost step.
- Repository: `docs/investigations/viewer-app.md` and
  `viewer-app/ios-evidence.json`;
  `docs/investigations/2026-09-17-card-0057-paste-from-clipboard-button.md`;
  `docs/spec.md` §3.1, §4, §11.1; `src/web-viewer/README.md`.
