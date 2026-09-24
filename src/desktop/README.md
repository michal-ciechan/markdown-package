# Windows desktop viewer (W2)

The Tauri v2 shell serves the browser viewer's built files from
`../web-viewer/dist`. The shell lives in `src-tauri/`. The viewer's existing
**Open** button uses WebView2's file picker. Windows launch paths are queued
until the viewer acknowledges receipt, then read through `tauri-plugin-fs`.
The viewer checks the queue periodically to recover a missed notification.
A second
launch forwards its paths to the first window and focuses it.

## Prerequisites

- Windows with WebView2 Runtime and Visual Studio 2022 C++ build tools.
- Rust toolchain with the `x86_64-pc-windows-msvc` target. On the development
  machine, prepend `%USERPROFILE%\.cargo\bin` to `PATH` in each shell.
- Tauri CLI v2: `cargo install tauri-cli --version "^2" --locked`.
- Node.js and npm. Run `npm ci` in `src/web-viewer` once per new checkout.
  NSIS is downloaded and managed by Tauri when the installer is built.

From `src/desktop`, run `cargo tauri dev` for a live window or
`cargo tauri build --debug` for an executable and per-user NSIS installer.
Both commands run the viewer build before loading its `dist/` directory. The
debug executable is under `src-tauri/target/debug/`; the NSIS installer is
under `src-tauri/target/debug/bundle/nsis/`.

For a native restart smoke after building, package `examples/guide-and-notes`
with the CLI, then run `node tests/webview-smoke.mjs <package.mdpkg>
<evidence-directory>` from `src/desktop`. This attaches to the actual WebView2,
opens through the viewer's file-input route, saves a draft, restarts the process
and checks that recents and the draft return. The enhanced
`showOpenFilePicker` dialog needs a hands-on check because CDP cannot supply a
file to that Windows dialog.

For W2 entry-point verification after the debug build, run
`node tests/os-entry-smoke.mjs <evidence-directory>` from `src/desktop`.
It tests startup argv, relative-path forwarding, the unsaved-work Cancel
guard, WebView2 drop/paste events, and a copied file through Ctrl+V. It
restores the previous text clipboard. Install the debug NSIS bundle, then run
`node tests/association-smoke.mjs <evidence-directory>` to check the installed
`.mdpkg` shell association and the `.md` Open with registration. Uninstall
the debug app after that check. Physical Explorer drag and context-menu
selection still need a hands-on pass.

The `.mdpkg` association is configured in `tauri.conf.json`. The NSIS hook
adds `.md` as an **Open with** candidate only. File read permission has no
static directory scope: Rust grants a single-file scope for each existing,
canonical path supplied by a launch. The viewer cannot request arbitrary
paths from the filesystem plugin. Drag and paste continue through the
browser's HTML5 `File` routes.

Do not register `tauri-plugin-dialog` before W3a's browser dialog gate lands.
Its registration changes the behavior of the viewer's current synchronous
`window.confirm` guards and can discard unsaved work. The copied
`installer-hooks.nsh` is active for the `.md` association. Installer command
quoting and uninstall restoration are owned by W4b.

The product name is **Markdown Package Viewer**, identifier
`net.codeperf.mdpkg`, and binary `mdpkg-viewer`. Version `1.0.0` matches
`src/generator-cli/Mdpkg.Pack.props`; W4a automates synchronization. See
`docs/plans/2026-09-23-phase1-execution.md` sections 3.1 and 5 for these
defaults and milestone ownership.
