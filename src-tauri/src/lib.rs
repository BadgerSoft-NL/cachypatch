pub mod graaf;

use tauri::{Emitter, Manager, State};

use graaf::{Graaf, Momentopname};

#[tauri::command]
fn haal_graaf(g: State<Graaf>) -> Momentopname {
    g.nu()
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(venster) = app.get_webview_window("main") {
                let _ = venster.unminimize();
                let _ = venster.set_focus();
            }
        }))
        .setup(|app| {
            let handle = app.handle().clone();
            app.manage(Graaf::start(Box::new(move |m| {
                let _ = handle.emit("graaf", m);
            })));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![haal_graaf])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
