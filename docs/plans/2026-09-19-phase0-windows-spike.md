# Phase 0 Windows spike: Tauri v2 shell for the Markdown Package viewer

Date: 2026-09-19/20. Investigate task `93c5b4e1`, follow-on to CARD-0059
(`docs/plans/2026-09-18-native-viewer-shells.md`, closed). This note answers the
five questions the spike brief asked, which map onto that plan's
§6 "Phase 0: Windows spike" items 1, 2, 4, 5, 6, 7 and 9, decision **D5**, and
risks **R1**, **R2**, **R3**, **R15**, **R17**.

Everything below was measured on this machine on 2026-09-19/20. No production
code changed. The throwaway shell lives in the gitignored `.spike-tauri/`
directory (`.gitignore` gained `/.spike-tauri/`); the parts worth keeping are
quoted inline here. The installed app, its ProgIDs and its registry keys were
removed again at the end (§3.4).

## 0. Answers in one line each

| # | Question | Answer |
| --- | --- | --- |
| 1 | Secure context / `crypto.subtle` under the default Windows origin | **Yes.** `http://tauri.localhost` reports `isSecureContext = true`; `crypto.subtle.digest`, `crypto.randomUUID`, IndexedDB and `localStorage` all work and persist across restarts. **No origin-scheme change needed** — D5 resolves to "keep the default, do not set `useHttpsScheme`" |
| 2 | Fastest/cleanest way to get file bytes into the viewer | **Anything except the default JSON IPC.** For a 20 MiB package: raw-bytes command (`tauri::ipc::Response`) 522 ms, `plugin-fs` `readFile` 530 ms, `fetch` on the asset protocol 522 ms — versus **3016 ms** for `Vec<u8>` as a JSON array and 1072 ms for base64. Recommendation: `plugin-fs` `readFile` (no extra Rust, the plugin is already needed for `watch`), or the asset protocol if `blobSource`'s slicing should become lazy |
| 3 | Windows file association / "Open with" | **Both work end to end.** `bundle.fileAssociations` for `.mdpkg`: double-click launches the app with the path as `argv[1]`, and a second double-click while running is forwarded by the single-instance plugin. The `installerHooks` + `OpenWithProgids` fragment puts the app in `.md`'s "Open with" list (screenshot evidence) **without** touching the user's existing default (Typora). Uninstall restores `.md` exactly; two small defects found in the Tauri NSIS template (§3.3) |
| 4 | `window.confirm()` / `alert()` under WebView2 | **Not no-ops — and worse than no-ops once `tauri-plugin-dialog` is registered.** Bare WebView2 shows real blocking dialogs and `confirm()` returns a boolean. With the dialog plugin registered, its injected script replaces both: `window.confirm()` returns a **Promise that always rejects** (`dialog.confirm not allowed. Command not found`) — a truthy value, so `if (window.confirm(...))` silently takes the "yes" branch — and `window.alert()` returns immediately while the dialog appears asynchronously. Every call site must be replaced (§4) |
| 5 | Watcher behaviour on real save patterns | Measured for 11 patterns including Notepad, VS Code, Vim (two configs) and `git checkout`. At `delayMs: 500` a save is **1 to 4 events**. Watching the **file path** works on Windows for every pattern including temp-file-and-rename, so the parent-directory watch is not strictly required here — but two rules are: never key on `modify` (a Vim save delivers only `create` to a directory watcher), and always gate on the recomputed snapshot id (§5) |

## 1. What was built, and what it cost

```
.spike-tauri/
  app/
    frontend/            # copy of src/web-viewer/dist/ + spike.html + spike.js (harness)
    spike-src/spike.js   # harness source, bundled with esbuild 0.25.9
    src-tauri/           # Cargo.toml, tauri.conf.json, installer-hooks.nsh,
                         # capabilities/default.json, src/lib.rs
  data/                  # watched.md plus small/mid/big .mdpkg fixtures
  out/                   # every measurement, written by the app itself
```

Toolchain installed for the spike, recorded because the plan's §10 listed
`cargo/rustc: not found`:

```text
rustup-init x86_64-pc-windows-msvc -> rustc 1.98.1 (48a229cea 2026-09-01), cargo 1.98.1
MSVC linker: VS 2019 Build Tools (vswhere -requires VC.Tools.x86.x64); Windows SDK 10.0.19041.0
node 24.6.0, npm 11.5.1, esbuild 0.25.9
npm: @tauri-apps/cli 2.11.4, @tauri-apps/api 2.11.1, @tauri-apps/plugin-fs 2.5.2,
     @tauri-apps/plugin-dialog 2.7.3
crates: tauri 2.11.5, tauri-plugin-fs 2.5.2 (feature "watch"), tauri-plugin-dialog 2.7.3,
     tauri-plugin-opener 2.x, tauri-plugin-single-instance 2.4.4
WebView2 runtime 153.0.4234.32 (UA: Chrome/153.0.0.0 Edg/153.0.0.0)
Windows 10 Pro 19045, display scaled, 3840x2160
```

Times and sizes, for the phase 1 estimate and for CI (item K, phase 0 item 8):

| Measurement | Value |
| --- | --- |
| `cargo build` (debug), cold registry | 7 min 08 s |
| `cargo build` (debug), one source file changed | 17 s to 55 s |
| `npm run tauri build` (release, template profile `lto = true`, `codegen-units = 1`), cold | **17 min 59 s** |
| Release `mdpkg-spike.exe` | 5,212,672 bytes (4.97 MiB) |
| NSIS installer `MdpkgSpike_0.1.0_x64-setup.exe` | 1,680,210 bytes (1.60 MiB) |
| Silent per-user install (`/S`) | 3 s, into `%LOCALAPPDATA%\MdpkgSpike` (app + `uninstall.exe`, 79,330 bytes) |
| Cold start of the release build: process start → first line of JS executing | ≈1.9 s (23:10:46.216 launch → 23:10:48.110 first log line) |

The window loads `spike.html`, which runs the measurements and writes its
results through a `write_report` command, so the numbers below came out of the
running app rather than off the screen. Screenshots referenced below are in
`.spike-tauri/out/`.

**Phase 0 item 1 is also answered: the real viewer runs unmodified in the
shell.** With `frontendDist` pointing at a copy of `src/web-viewer/dist/`,
navigating to `index.html` renders the viewer, and its own
"Choose file (standard picker)" button (`showOpenFilePicker`) opened
`docs/spec/review-fixtures/original.mdpkg` inside the app: 1 document,
2 entries, conforming typing tier, `guide.md` rendered, snapshot
`sha256-857f8766f3c5acefee20bd29bebada7a7bd75ef953a09e905dcd4b6fb13826da`
(`out/viewer2.png`).

## 2. Question 1 — webview origin and secure context (plan D5, R1)

Default configuration, no `useHttpsScheme`. Verbatim from
`.spike-tauri/out/report-run.txt`:

```text
href                = http://tauri.localhost/spike.html
origin              = http://tauri.localhost
protocol            = http:
isSecureContext     = true
crypto              = object
crypto.subtle       = object
subtle.digest       = function
SHA-256("hello")    = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
  expected            2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
randomUUID()        = f464dd44-07c4-4de4-803a-7bf4e2cf2878
userAgent           = Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0
showOpenFilePicker  = function
showSaveFilePicker  = function
navigator.clipboard = object writeText= function read= function
clipboard.writeText  = ok
localStorage prev   = null
localStorage now    = 1
indexedDB prev      =
indexedDB now       = 1
storage.persisted() = false
storage.estimate()  = {"quota":10737420021,"usage":1781,"usageDetails":{"indexedDB":1781}}
```

Later launches of the same binary show the storage origin surviving restarts —
by the last run the counters had reached `localStorage prev = "7"` and
`indexedDB prev = {"id":1,"n":7,...,"origin":"http://tauri.localhost"}`, and
the clipboard *permission grant* persisted too (`clipboard.readText` returned
the string written by the previous run). `navigator.storage.persisted()` is
`false`, i.e. the data is evictable under storage pressure exactly as in a
browser — the viewer's existing "site-data clearing or eviction can remove
saved work" warning stays true on the desktop.

**Conclusion (D5): keep Tauri's default `http://tauri.localhost`; do not set
`useHttpsScheme`.** R1's expectation holds — WebView2 treats `*.localhost` as
potentially trustworthy, so `digest.js:10` and everything else needing
`crypto.subtle` works unchanged. Because the scheme *is* the storage origin,
this is also the cheap answer: changing nothing changes no data. The
`useHttpsScheme: true` variant was therefore not measured; it is only needed
if the default had failed, and it did not.

Two related facts from the same runs, both relevant to phase 1:

- `window.showOpenFilePicker` and `showSaveFilePicker` exist and work
  (phase 0 item 4) — the viewer's standard-picker path opened a real package
  (§1). Whether a File System Access *grant* persists across restarts was not
  tested; the plan uses the `dialog` plugin for the app's own picker anyway.
- `navigator.clipboard.readText()` triggers a **native WebView2 permission
  prompt** ("http://tauri.localhost wants to / See text and images copied to
  the clipboard", Block / Allow) and the promise does not settle until it is
  answered (`out/shot.png`). Once allowed, the grant is remembered across
  restarts. `writeText` needs no prompt. Unanswered and unfocused, it rejects
  with `NotAllowedError: Document is not focused`. For CARD-0057's Paste
  button in the desktop shell (plan §2.6, item H) this is the argument for the
  native clipboard route over the web API.

## 3. Question 3 — file associations and "Open with" (plan §2.2, D2, R3)

The machine is the exact R3 test case the plan wanted: before installing,
`.md` already had a user-chosen default and three other handlers.

```text
BEFORE INSTALL
[HKCU\Software\Classes\.md\OpenWithProgids]     VSCode.md, Typora.md, Toolbox.WebStorm.ch-0
[HKCU\...\Explorer\FileExts\.md\UserChoice]     ProgId = Typora.md   Hash = n7ZYwMJJ3X8=
[HKCU\Software\Classes\.mdpkg]                  ABSENT
```

Configuration used (the whole of it):

```json
"fileAssociations": [
  { "ext": ["mdpkg"], "name": "MdpkgSpikePackage",
    "description": "Markdown Package (spike)", "mimeType": "application/zip", "role": "Editor" }
],
"windows": { "nsis": { "installMode": "currentUser", "installerHooks": "installer-hooks.nsh" } }
```

```nsis
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\MdpkgSpike.md" "" "Markdown document (spike)"
  WriteRegStr SHCTX "Software\Classes\MdpkgSpike.md\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\MdpkgSpike.md\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  WriteRegStr SHCTX "Software\Classes\.md\OpenWithProgids" "MdpkgSpike.md" ""
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue SHCTX "Software\Classes\.md\OpenWithProgids" "MdpkgSpike.md"
  DeleteRegKey SHCTX "Software\Classes\MdpkgSpike.md"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
```

`installerHooks` is honoured by `tauri build` with no extra flags, and
`SHCTX` and `${MAINBINARYNAME}` are both defined by the template in
`currentUser` mode.

### 3.1 `.mdpkg` through `fileAssociations`: works

```text
AFTER INSTALL
[HKCU\Software\Classes\.mdpkg]   (default) = MdpkgSpikePackage   MdpkgSpikePackage_backup = (empty)
[HKCU\Software\Classes\MdpkgSpikePackage\shell\open\command]
    (default) = C:\Users\lndco\AppData\Local\MdpkgSpike\mdpkg-spike.exe "%1"
```

Behaviour, from `out/launch-argv.log` (the app logs its own `argv` at start
and whatever the single-instance plugin forwards):

```text
PRIMARY argv=["...\MdpkgSpike\mdpkg-spike.exe", "...\data\open-test.mdpkg"]          <- double-click
PRIMARY argv=["...\MdpkgSpike\mdpkg-spike.exe", "...\data\second-launch.mdpkg"]      <- second double-click
SECOND-INSTANCE argv=["...\MdpkgSpike\mdpkg-spike.exe", "...\data\second-launch.mdpkg"]
                cwd="C:\src\markdown-package\.spike-tauri\out"
```

So: shell-invoked open delivers the path as `argv[1]`; a second launch while
the app is running is forwarded to the running instance by
`tauri-plugin-single-instance` (registered first) and the second process
exits — one process remained afterwards. Plan §2.2 and W2 are confirmed for
Windows.

### 3.2 `.md` through `installerHooks` + `OpenWithProgids`: works, default untouched

```text
AFTER INSTALL
[HKCU\Software\Classes\.md\OpenWithProgids]  VSCode.md, Typora.md, Toolbox.WebStorm.ch-0, MdpkgSpike.md
[HKCU\...\Explorer\FileExts\.md\UserChoice]  ProgId = Typora.md   (unchanged)
```

Shell-executing a `.md` file after the install did **not** start the spike
app. Windows showed its "How do you want to open this .md file?" chooser with
**Typora** under "Keep using this app" and **MdpkgSpike**, marked *New*, under
"Other options", with the app's icon already rendered — no logoff, no icon
cache reset (`out/openwith.png`). That is decision D2 working exactly as
specified, and R3 answered: an installer using this route cannot take `.md`
from a user who already chose a default.

### 3.3 Two defects in the Tauri NSIS output, both worth knowing before W4

1. **The `fileAssociations` open command is not quoted.**
   `MdpkgSpikePackage\shell\open\command` is written as
   `C:\Users\lndco\AppData\Local\MdpkgSpike\mdpkg-spike.exe "%1"` — the
   program path has no quotes, while the hand-written hook above produced a
   quoted one. On this machine the path has no spaces, so it worked; a user
   whose account name contains a space (`C:\Users\Anne Smith\AppData\...`)
   would get a broken association. Phase 1 should either quote it via a hook
   or verify upstream has fixed it.
2. **Uninstall leaves the extension key behind.** After `uninstall.exe /S`
   the ProgIDs and the `.md` `OpenWithProgids` entry were gone and `.md` was
   byte-for-byte as before, but `HKCU\Software\Classes\.mdpkg` remained, with
   an empty `(default)` and a stale `MdpkgSpikePackage_backup` value. The
   backup/restore logic restores the *value* (here: "there was none") but does
   not delete the key it created. Harmless, but "the uninstaller restores the
   backup" in W4 should be read as "restores the value, leaves an orphan key".

### 3.4 Clean-up

`uninstall.exe /S` returned 0, `%LOCALAPPDATA%\MdpkgSpike` is gone, no Start
Menu entry remained, and the orphan `.mdpkg` key from 3.3 was deleted by hand,
so the machine is back to its pre-spike state.

## 4. Question 4 — `window.confirm()` / `alert()` in WebView2 (plan item F)

This is the question whose answer differs most from the plan's assumption
(item F cites wry#584: "WKWebView `confirm()` no-op"). On Windows the story is
the opposite, and the dialog plugin makes it worse rather than better. Two
builds were compared, identical except for one line in `lib.rs`.

### 4.1 Without `tauri_plugin_dialog::init()` — plain WebView2

```text
window.confirm.toString() = function confirm() { [native code] }
window.alert.toString()   = function alert() { [native code] }
window.prompt.toString()  = function prompt() { [native code] }
window.confirm() returned type=boolean ctor=Boolean isPromise=false value=true after 49617.0ms
window.alert()   returned type=undefined isPromise=false after 30658.8ms
```

All three are real, **blocking** WebView2 dialogs drawn inside the window,
headed "tauri.localhost says", with OK/Cancel (`out/nodlg1.png`,
`out/nodlg2.png`). The elapsed times are how long the spike took to click OK.
`window.confirm()` returns a correct boolean.

### 4.2 With `tauri_plugin_dialog::init()` — what phase 1 would actually ship

```text
window.confirm.toString() = async function(i){return await n("plugin:dialog|confirm",{message:i.toString()})}
window.alert.toString()   = function(i){n("plugin:dialog|message",{message:i.toString()})}
window.prompt.toString()  = function prompt() { [native code] }

window.confirm() returned type=object ctor=Promise isPromise=true value=[object Promise] after 0.6ms
confirm() promise settled with "REJECTED dialog.confirm not allowed. Command not found" after 13.2ms
window.alert()   returned type=undefined isPromise=false after 0.5ms   (dialog appears asynchronously)
```

Cause, found in the crate: `tauri-plugin-dialog` 2.7.3 ships
`src/init-iife.js`, injected into every page, which does

```js
window.alert = function (i) { n("plugin:dialog|message", { message: i.toString() }) };
window.confirm = async function (i) { return await n("plugin:dialog|confirm", { message: i.toString() }) };
```

but the crate's `invoke_handler` registers only `open`, `save` and `message`
(`src/lib.rs:204-207`; `permissions/autogenerated/commands/` contains exactly
`message.toml`, `open.toml`, `save.toml`). There is no `confirm` command, so
the injected `window.confirm` can only ever reject. Consequences for the
viewer, in order of severity:

1. **`if (window.confirm(...))` becomes an unconditional yes.** The return
   value is a pending `Promise`, which is truthy. `main.js:121`,
   `session.js:63` and `session.js:189` would proceed as though the user had
   confirmed, and the rejection surfaces only as an unhandled promise
   rejection in the console. This is a silent data-loss-shaped bug (discard
   unsaved work without asking), not a cosmetic one.
2. **`window.alert()` no longer blocks.** It returns in ~0.5 ms and the native
   dialog (titled with the product name, `out/dlg3-crop.png`) appears
   asynchronously, so any code that assumed the user had seen it before the
   next statement runs is wrong.
3. **`window.prompt()` is not patched** and stays a blocking native WebView2
   dialog (`out/dialog-shot.png`). The viewer does not use it today; it should
   stay that way.

The replacement works: `dialog.confirm()` from `@tauri-apps/plugin-dialog`
(which is implemented over `plugin:dialog|message`, not the missing `confirm`
command) shows a real native Win32 dialog — its own top-level window, centred
on screen rather than inside the webview — and resolves `true`/`false`
(`out/nd2.png`). `dialog.message()` likewise (`out/nd3.png`). Both are served
by the `message` command, so the capability needs `dialog:allow-message` (or
just `dialog:default`, which is `allow-message`, `allow-save`, `allow-open`).
`dialog:allow-confirm` and `dialog:allow-ask` still validate, but
`permissions/confirm.toml` shows they are deprecated aliases that grant
`message` — there is no `confirm` command left to grant.

**Action for phase 1, item F:** replacing `window.confirm` with
`await host.confirm()` is not a portability nicety, it is required on Windows
day one, and a lint/grep gate for `window.confirm|window.alert` in
`src/web-viewer/src` is worth adding so a later call site cannot reintroduce
it.

## 5. Question 5 — file watcher against real save patterns (plan D3, R15, R17)

Setup: the shell starts three watchers over the same directory through
`@tauri-apps/plugin-fs` 2.5.2 and logs every callback with a timestamp:

- `DIR-500` — `watch(dir, cb, { delayMs: 500, recursive: false })`, the plan's
  recommended shape (§2.7, item L);
- `FILE-500` — `watch(file, cb, { delayMs: 500 })`, watching the document path
  itself, the shape the plan expected to be unreliable;
- `DIR-IMM` — `watchImmediate(dir, cb, { recursive: false })`, undebounced, to
  count the raw OS events behind each save.

Each pattern ran once, four seconds apart, against
`.spike-tauri/data/watched.md`:

| Save pattern | raw events | `DIR-500` | `FILE-500` |
| --- | --- | --- | --- |
| (a) in-place write, `File.WriteAllText` (truncate/write/close) | 2 | 1 `modify(any)` | 1 `modify(any)` |
| (a) **Notepad (Windows 10), real save** | 1 | 1 `modify(any)` | 1 `modify(any)` |
| (c) **VS Code 1.138, real Ctrl+S** | 2 | 1 `modify(any)` | 1 `modify(any)` |
| append, `File.AppendAllText` | 1 | 1 `modify(any)` | 1 `modify(any)` |
| (b) temp file + `File.Replace` (`ReplaceFile`) | 11 | 2: `create(watched.md)`, `remove(watched.md~RF….TMP)` | 3: `rename-from`, `rename-to`, `modify(any)` |
| (b) temp file + `Move-Item -Force` (`MoveFileEx REPLACE_EXISTING`) | 7 | 3: `remove`, `create`, `modify(any)` | 3: `remove`, `rename-to`, `modify(any)` |
| (c) **Vim 9.1, real save, `backupcopy=auto`** (default) | 15 | 2: `create(watched.md)`, `remove(watched.md~)` | 3: `rename-from`, `create`, `modify(any)` |
| (c) **Vim 9.1, real save, `backupcopy=no`** | 15 | 2: `create(watched.md)`, `remove(watched.md~)` | 3: `rename-from`, `create`, `modify(any)` |
| (c) **`git checkout -- watched.md`** | 5 | 4: `remove`, `create`, `modify`, plus `modify(.git)` | 3: `remove`, `create`, `modify(any)` |
| metadata-only touch (`LastWriteTime`, content unchanged) | 1 | 1 `modify(any)` | 1 `modify(any)` |

Two of the three brief-mandated patterns therefore come from editors people
actually use here: Notepad and VS Code both write **in place** on Windows
(VS Code does *not* do a temp-file-and-rename by default, contrary to the
"many IDE safe write modes" wording in R15), while Vim does the classic
rename dance in both of its backup modes.

Raw (undebounced) trace of one real Vim save, i.e. what the 500 ms debounce
absorbs:

```text
create .watched.md.swp / create .watched.md.swx / remove .swx / remove .swp /
create .watched.md.swp / modify .watched.md.swp / create 4913 / remove 4913 /
rename-from watched.md / rename-to watched.md~ / create watched.md /
modify watched.md / remove watched.md~ / modify .swp / remove .swp
```

("4913" is Vim's writability probe file.) `File.Replace` similarly leaves a
`watched.md~RF34d2e17b.TMP` backup for a few milliseconds.

### 5.1 Findings

1. **Every pattern is caught by both shapes.** Contrary to the plan's premise,
   on Windows `watch(file)` does not go stale when the file is replaced by a
   rename or a delete-and-create: notify's Windows backend is
   `ReadDirectoryChangesW` on the parent directory with a path filter, so
   there is no inode to lose. All rename-based patterns, and `git checkout`,
   kept producing events afterwards.
2. **Parent-directory watching is therefore not *required* on Windows**, but
   it stays the right implementation: the Linux and macOS backends do lose the
   inode, one code path is cheaper than two, and a file watch cannot be armed
   before the file exists.
3. **If the parent directory is watched, filename filtering is mandatory**, as
   the plan says: one Vim save alone produced `.watched.md.swp`,
   `.watched.md.swx`, `4913` and `watched.md~` events in the same directory,
   and the atomic-save patterns produced `watched.md.tmp` and
   `watched.md~RF….TMP`.
4. **Do not key the handler on `modify`.** This is the finding that would
   otherwise have become a bug: a real Vim save and a `File.Replace` save
   deliver **no `modify` event for `watched.md`** to the directory watcher —
   only `create` (plus a `remove` of a backup file). Treat `create`, `remove`,
   `modify` and `modify(rename, …)` identically: "something touched this name,
   re-read and compare".
5. **A `remove` event does not mean the file is gone.** `Move-Item -Force` and
   `git checkout` both deliver `remove` immediately before `create`. Re-stat
   after the debounce instead of reacting to `remove` — that ordering is what
   makes R17's "a missing file shows a notice, not an error" safe.
6. **Content gating is mandatory, as D3/R15 assumed.** A metadata-only touch
   is indistinguishable from an in-place save at the event level (1 ×
   `modify(any)` either way). Only recomputing the snapshot id separates them.
7. **One batch per save at `delayMs: 500`** — 1 to 4 callbacks, collapsing up
   to 15 raw events. No duplicate batches, and no half-written read was
   observed; the fixtures are small, so R15's "large save observed
   half-written" is still unmeasured and its mitigation still needed.
8. **Scope.** `fs:scope { allow: [<dir>, <dir>/**] }` plus `fs:allow-watch`
   was enough for both `watch(dir)` and `watch(file)`. Whether a file-only
   scope entry suffices was not isolated, so R17's "the scope must include the
   parent directory" is neither confirmed nor refuted; scope the parent
   directory and the question does not arise.

## 6. Question 2 — bytes from Rust into the viewer (plan §2.3, R2)

Six routes, three repetitions each, against a 636-byte fixture
(`docs/spec/review-fixtures/original.mdpkg`), a 2 MiB package and a 20 MiB
package (both genuine stored-mode zips built with `fflate`). `min` is the
figure to read; the first repetition carries warm-up cost.

**Release build** (what ships):

| Route | 636 B | 2 MiB | 20 MiB |
| --- | --- | --- | --- |
| `invoke` → `tauri::ipc::Response` (raw bytes → `ArrayBuffer`) | 2.7 ms | 51.7 ms | **522 ms** |
| `invoke` → `Vec<u8>` (default JSON-array IPC) | 2.5 ms | 269 ms | **3016 ms** |
| `invoke` → base64 `String` + `atob` | 2.3 ms | 93 ms | 1072 ms |
| `@tauri-apps/plugin-fs` `readFile` | 4.2 ms | 51.8 ms | 530 ms |
| `fetch(convertFileSrc(path))` → `arrayBuffer()` | 2.9 ms | 52.7 ms | 551 ms |
| `fetch(convertFileSrc(path))` → `blob()` | 2.8 ms | 49.7 ms | 523 ms |

Debug build of the Rust side, kept because it shows how misleading a
`tauri dev` measurement is: the same 20 MiB file took 498 ms raw, **12411 ms**
as a JSON array and 3121 ms as base64 — the JSON and base64 routes are 4× and
3× worse unoptimised, the raw and asset-protocol routes barely move.

Turning the result into what the viewer consumes (`blobSource()` takes a
`Blob`): `new Blob([arrayBuffer])` 0.4 / 1.6 / 14.6 ms, and
`blob.slice(0, 1024).arrayBuffer()` 1.2 / 4.7 / 30.9 ms.

### 6.1 Recommendation for R2

**Use `plugin-fs` `readFile` unless lazy slicing is wanted; then use the asset
protocol. Never return `Vec<u8>` from a command.**

- `readFile` is within 2 % of a hand-written raw-bytes command (it already
  uses `ipc::Response` internally), needs no Rust code, and the plugin is a
  dependency anyway because D3 needs `watch`. It is the cheapest correct
  answer and the one to write into the plan.
- `fetch(convertFileSrc(path))` is equally fast and can hand `blobSource()` a
  `Blob` with no intermediate `Uint8Array` and no `new Blob([...])` copy; it
  also supports range requests, so a 20 MiB package could be sliced without
  ever being fully materialised. The cost is an `assetProtocol.scope` entry
  covering user-picked paths. Worth revisiting only if memory or lazy reads
  become a concern.
- A custom `ipc::Response` command remains the fallback if the adapter needs
  something `readFile` cannot express (for example returning bytes plus
  metadata in one round trip).
- The default JSON IPC is the one real trap: 3 s of main-thread work for a
  20 MiB package in release, 12 s in debug, and base64 only halves it.

## 7. What this changes in the phase 1 plan

Ordered by how much it moves the plan.

1. **Item F is now a phase 1 blocker, not a portability nicety.** The
   `window.confirm` call sites must be replaced *before* the dialog plugin is
   registered, or the desktop build silently treats every confirm as "yes"
   (§4.2). Add a grep gate for `window.confirm|window.alert` in the viewer
   source. The replacement to wire is `dialog.confirm` / `dialog.message`
   behind `host.confirm()`, with `dialog:allow-message` in the capability —
   note `dialog:allow-confirm` is not the permission these use.
2. **Item J loses a decision.** `tauri.conf.json` keeps the default origin: no
   `useHttpsScheme`, no storage-origin migration, nothing to change in the
   viewer's crypto or persistence code. D5 is closed by measurement (§2).
3. **Item L's watcher needs three rules the plan did not state** (§5.1): treat
   `create`/`remove`/`rename` exactly like `modify`; never treat a `remove` as
   a deletion until the post-debounce re-stat says so; keep the snapshot-id
   gate. The parent-directory shape is confirmed as the right choice for
   cross-platform reasons, not because a file watch fails on Windows.
4. **R2 can be closed at plan time**: `plugin-fs` `readFile`, with the asset
   protocol as the upgrade path if slicing matters (§6.1).
5. **W4 gets two extra checklist lines** (§3.3): quote the `fileAssociations`
   open command (or verify upstream has), and expect an orphan
   `HKCU\Software\Classes\.mdpkg` key after uninstall.
6. **Build-time budget for CI (item K).** Release `tauri build` is ~18 minutes
   cold on this machine and `cargo build` 7 minutes; the desktop workflow must
   cache `~/.cargo` and `target/` from the first commit, and W4's
   install/association work cannot be iterated without a full release build
   each time.
7. **No surprises for the rest.** The viewer itself runs unmodified in the
   shell, opens a real package through its existing picker, keeps IndexedDB
   and `localStorage` across restarts, and the single-instance + argv path
   behaves as W2 assumes.

## 8. Still open after this spike

- `useHttpsScheme` was deliberately not measured (§2): only needed if the
  default had failed.
- Drag-and-drop with `dragDropEnabled: false`, and Ctrl+V of an
  Explorer-copied file (phase 0 item 3), were not exercised.
- Whether a File System Access grant from `showOpenFilePicker` persists across
  restarts.
- Half-written large saves (R15) and a file-only `fs:scope` for `watch`
  (R17, §5.1 item 8).
- Everything about signing, the updater and SmartScreen (D4, R7) — that is W4
  on a clean VM, not this spike.
