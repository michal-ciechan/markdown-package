# CARD-0072 (W2): forwarded opens stall until a click

Hands-on testing on `18c502e` found a stall (task e3922461, notes `db19017` on
`feat/card-task-e3922461`). A second launch or Open with forwarded a path to
the running viewer, and the window came to the front. The page then did
nothing until the user clicked inside it. This happened in 4 of about 21
forwarded launches.

## Root cause

The single-instance callback called `WebviewWindow::set_focus()`. On Windows,
tao's `set_focus` (`tao-0.35.3/src/platform_impl/windows/window.rs`,
`force_window_active`) first tries `SetForegroundWindow`. If Windows refuses,
tao injects a synthetic Alt press and release with `SendInput`, then tries
again. Windows refuses when the second instance holds no foreground right: it
was started by a background process, or the user moved on while it started.

The window does reach the front, so the second `SetForegroundWindow`
succeeds. But the injected lone Alt reaches the newly focused WebView2. A
lone Alt press and release enters keyboard menu mode (`SC_KEYMENU`), a modal
loop on the window's thread. The loop ends on a click, a key press or a
focus change, but not on a mouse move.

While it runs, WebView2 stops delivering work. The `ipc://` replies queue up,
which is why the in-page 500 ms monitor got all its replies in one burst. The
native confirm and IndexedDB writes queue too. The JS queue drain itself was
correct: the launch event and the 1 s poll both fired. Their replies were
what was held back.

This matches every observation:

- **Intermittent:** only refused foreground requests take the Alt path, and
  the injected key must land after activation.
- **Cleared by a click or another window taking focus, not a mouse move:**
  that is how keyboard menu mode ends.
- **Never on cold start, drag or paste:** those paths do not call
  `set_focus`.
- **Hidden by the CDP smokes:** they observe through a debugger, and their
  launcher state differs.

A related upstream report is
[tauri-apps/tauri#13300](https://github.com/tauri-apps/tauri/issues/13300),
a WebView2 freeze triggered by Alt during periodic IPC.

## Change (`3b1f95a`)

- `src/desktop/src-tauri/src/lib.rs`: `bring_to_front` replaces `set_focus`
  on the forward path. It calls `unminimize`, `show`, then one plain
  `SetForegroundWindow` from `windows-sys` 0.60, which is already in the
  tree. No input is injected. If Windows refuses, it flashes the taskbar
  button and the page still drains and opens the file.
- `ack_launch_file` appends `<unix ms> <id>` to `MDPKG_ACK_LOG` in debug
  builds only, so a smoke can time opens without a debugger.
- `tauri-plugin-dialog` stays unregistered, and the JS queue drain is
  unchanged.

## Regression checks

- `tests/shell.test.mjs`: the forward path must not call `set_focus` or any
  input-injection API, and must call `SetForegroundWindow`. It fails on the
  previous `lib.rs` and passes on the fix.
- `tests/forward-focus-smoke.mjs <evidence-dir> [launches]` (default 20):
  1. Starts the debug exe without CDP and covers it with Notepad.
  2. Raises Notepad without input injection.
  3. Forwards alternating absolute and relative-plus-cwd launches from a
     process that does not own the foreground.
  4. Requires each acknowledgement within 5 s. On a stall it clicks the
     window and records how long the late acknowledgement took.

  `MDPKG_SMOKE_EXE` selects another build. If there is no foreground window
  (locked or disconnected session, or a minimized RDP client), the script
  exits 2 and reports skipped.

## Counts

| Build | Conditions | Forwarded | Opened | Stalled |
| --- | --- | --- | --- | --- |
| `18c502e` (before) | Hands-on, visible desktop (task e3922461) | ~21 | ~17 | 4 |
| Before variant (`set_focus`, plus ack log) | This session, no foreground window | 20 | 20 | 0 |
| `3b1f95a` (after) | This session, no foreground window | 20 | 20 | 0 |
| `3b1f95a` (after) | Visible desktop, smoke | not run | | |

This session ran in an RDP session whose client was minimized: there was no
foreground window and screen capture failed. Windows therefore never reached
the foreground refusal that triggers tao's injected Alt, and both builds open
every launch. Those 20/20 rows only show that forwarding still works. They do
not reproduce the stall.

The before-variant exe is kept at
`C:\Antiphon\evidence\card-task-0726e42d\before-exe\mdpkg-viewer-before.exe`.

## Still to run on a visible, unlocked desktop

From `src/desktop`, after `cargo tauri build --debug`:

```
$env:MDPKG_SMOKE_EXE = 'C:\Antiphon\evidence\card-task-0726e42d\before-exe\mdpkg-viewer-before.exe'
node tests/forward-focus-smoke.mjs C:\Antiphon\evidence\card-task-0726e42d\before 20   # expect stalls
Remove-Item env:MDPKG_SMOKE_EXE
node tests/forward-focus-smoke.mjs C:\Antiphon\evidence\card-task-0726e42d\after 20    # expect 0 stalled
```

Then run a manual matrix with the installed debug NSIS bundle, with the
viewer behind another window each time:

- 5 absolute-path launches from a terminal.
- 5 relative-path launches with a working directory.
- 5 Explorer double-clicks while the viewer is running.
- 5 right-click **Open with** on a `.md` file.
- 2 launches with an unsaved draft whose save failed. Inject the failure
  through DevTools, then close DevTools before launching.

Every case should open, or reach the confirm, without a click. If Windows
refuses the foreground request, a flashing taskbar button is acceptable.
