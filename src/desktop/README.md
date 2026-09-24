# Windows desktop viewer (W1)

The Tauri v2 shell serves the browser viewer's built files from
`../web-viewer/dist`. The shell lives in `src-tauri/`; it has no plugins or
native file commands yet. The viewer's existing **Open** button uses WebView2's
file picker. Path-based entry points arrive in W2.

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

Do not register `tauri-plugin-dialog` before W3a's browser dialog gate lands.
Its registration changes the behavior of the viewer's current synchronous
`window.confirm` guards and can discard unsaved work. The copied
`installer-hooks.nsh` is also inactive until W2 adds associations.

The product name is **Markdown Package Viewer**, identifier
`net.codeperf.mdpkg`, and binary `mdpkg-viewer`. Version `1.0.0` matches
`src/generator-cli/Mdpkg.Pack.props`; W4a automates synchronization. See
`docs/plans/2026-09-23-phase1-execution.md` sections 3.1 and 5 for these
defaults and milestone ownership.
