pub mod graaf;
pub mod meter;

use tauri::{Emitter, Manager, State};

use graaf::{Graaf, Melding, Momentopname, Opdracht};

#[tauri::command]
fn haal_graaf(g: State<Graaf>) -> Momentopname {
    g.nu()
}

#[tauri::command]
fn verbind(g: State<Graaf>, uit: u32, naar: u32) {
    g.doe(Opdracht::Verbind { uit, naar });
}

#[tauri::command]
fn ontkoppel(g: State<Graaf>, kabels: Vec<u32>) {
    for kabel in kabels {
        g.doe(Opdracht::Ontkoppel { kabel });
    }
}

/// `doel` is een serial, of `null` om het aan WirePlumber terug te geven.
#[tauri::command]
fn zet_doel(g: State<Graaf>, knoop: u32, doel: Option<String>) {
    g.doe(Opdracht::ZetDoel { knoop, doel });
}

#[tauri::command]
fn zet_volume(g: State<Graaf>, knoop: u32, volume: Vec<f32>) {
    let volume = volume.into_iter().map(|v| v.clamp(0.0, 4.0)).collect();
    g.doe(Opdracht::ZetVolume { knoop, volume });
}

#[tauri::command]
fn zet_mute(g: State<Graaf>, knoop: u32, mute: bool) {
    g.doe(Opdracht::ZetMute { knoop, mute });
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
            app.manage(Graaf::start(Box::new(move |m| match m {
                Melding::Graaf(g) => {
                    let _ = handle.emit("graaf", g);
                }
                Melding::Pieken(p) => {
                    let _ = handle.emit("pieken", p);
                }
            })));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            haal_graaf,
            verbind,
            ontkoppel,
            zet_doel,
            zet_volume,
            zet_mute,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
