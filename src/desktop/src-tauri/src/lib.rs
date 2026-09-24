use std::{path::Path, sync::Mutex};
use tauri::{Emitter, Manager, WebviewWindow};
use tauri_plugin_fs::FsExt;

#[derive(Default)]
struct PendingFiles(Mutex<Vec<String>>);

// Grant only files delivered by the OS, and hand their absolute paths to JS
// after its listener is ready. No directory-wide fs permission is installed.
fn queue_files<I>(app: &tauri::AppHandle, args: I, cwd: &Path)
where
    I: IntoIterator<Item = String>,
{
    let mut accepted = Vec::new();
    for arg in args {
        let path = Path::new(&arg);
        let path = if path.is_absolute() { path.to_path_buf() } else { cwd.join(path) };
        let Ok(path) = path.canonicalize() else { continue };
        if !path.is_file() || app.fs_scope().allow_file(&path).is_err() { continue }
        accepted.push(path.to_string_lossy().into_owned());
    }
    if accepted.is_empty() { return }
    app.state::<PendingFiles>().0.lock().unwrap().extend(accepted);
    let _ = app.emit("host-open-file", ());
}

#[tauri::command]
fn take_launch_files(window: WebviewWindow) -> Vec<String> {
    std::mem::take(&mut *window.state::<PendingFiles>().0.lock().unwrap())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            queue_files(app, args.into_iter().skip(1), Path::new(&cwd));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![take_launch_files])
        .setup(|app| {
            app.manage(PendingFiles::default());
            let cwd = std::env::current_dir()?;
            queue_files(app.handle(), std::env::args().skip(1), &cwd);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
