use std::{path::Path, sync::Mutex};
use serde::Serialize;
use tauri::{Emitter, Manager, WebviewWindow};
use tauri_plugin_fs::FsExt;

#[derive(Default)]
struct PendingFiles(Mutex<LaunchQueue>);

#[derive(Clone, Serialize)]
struct LaunchFile {
    id: u64,
    path: String,
}

#[derive(Default)]
struct LaunchQueue {
    next_id: u64,
    files: Vec<LaunchFile>,
}

impl LaunchQueue {
    fn enqueue(&mut self, paths: Vec<String>) {
        for path in paths {
            self.next_id += 1;
            self.files.push(LaunchFile { id: self.next_id, path });
        }
    }

    fn acknowledge(&mut self, id: u64) -> bool {
        let Some(index) = self.files.iter().position(|file| file.id == id) else { return false };
        self.files.remove(index);
        true
    }
}

fn queue_and_notify<E>(pending: &PendingFiles, paths: Vec<String>, notify: impl FnOnce() -> Result<(), E>) -> Result<(), E> {
    if paths.is_empty() { return Ok(()) }
    pending.0.lock().unwrap().enqueue(paths);
    notify()
}

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
    if let Err(error) = queue_and_notify(&app.state::<PendingFiles>(), accepted, || app.emit("host-open-file", ())) {
        eprintln!("Could not notify viewer of queued launch: {error}");
    }
}

#[tauri::command]
fn pending_launch_files(window: WebviewWindow) -> Vec<LaunchFile> {
    window.state::<PendingFiles>().0.lock().unwrap().files.clone()
}

#[tauri::command]
fn ack_launch_file(window: WebviewWindow, id: u64) -> bool {
    window.state::<PendingFiles>().0.lock().unwrap().acknowledge(id)
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
        .invoke_handler(tauri::generate_handler![pending_launch_files, ack_launch_file])
        .setup(|app| {
            app.manage(PendingFiles::default());
            let cwd = std::env::current_dir()?;
            queue_files(app.handle(), std::env::args().skip(1), &cwd);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_notification_keeps_enqueued_files_until_acknowledged() {
        let pending = PendingFiles::default();
        let result = queue_and_notify(&pending, vec!["first.mdpkg".into(), "second.mdpkg".into()], || Err("notification failed"));
        assert_eq!(result, Err("notification failed"));
        let mut queue = pending.0.lock().unwrap();
        assert_eq!(queue.files.iter().map(|file| file.path.as_str()).collect::<Vec<_>>(), ["first.mdpkg", "second.mdpkg"]);
        assert_ne!(queue.files[0].id, queue.files[1].id);
        let second_id = queue.files[1].id;
        assert!(queue.acknowledge(second_id));
        assert_eq!(queue.files.len(), 1);
        assert_eq!(queue.files[0].path, "first.mdpkg");
    }
}
