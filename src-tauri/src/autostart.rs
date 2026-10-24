//! Starten bij het inloggen: een `.desktop`-bestand in `~/.config/autostart`,
//! zoals KDE en GNOME dat lezen. De app start dan verborgen in de tray, net
//! als CachyMix.

use std::path::PathBuf;

const BESTAND: &str = "nl.jetse.pecanmixer.desktop";

fn pad() -> Option<PathBuf> {
    let basis = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))?;
    Some(basis.join("autostart").join(BESTAND))
}

/// Het programma om te starten. In een AppImage is `current_exe` een pad in
/// een tijdelijke mount; het AppImage-bestand zelf staat dan in `$APPIMAGE`.
fn programma() -> Result<PathBuf, String> {
    if let Some(p) = std::env::var_os("APPIMAGE") {
        return Ok(PathBuf::from(p));
    }
    std::env::current_exe().map_err(|e| format!("Cannot find own executable: {e}"))
}

/// Een pad als argument in `Exec=`: tussen aanhalingstekens, met `"`, `` ` ``,
/// `$` en `\` ontsnapt (Desktop Entry Specification).
fn citeer(pad: &str) -> String {
    let mut s = String::from("\"");
    for c in pad.chars() {
        if matches!(c, '"' | '`' | '$' | '\\') {
            s.push('\\');
        }
        s.push(c);
    }
    s.push('"');
    s
}

fn inhoud(programma: &str) -> String {
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=Pecan Mixer\n\
         Comment=Patchbay and mixer for PipeWire\n\
         Exec={} --hidden\n\
         Icon=audio-card\n\
         Terminal=false\n\
         Categories=AudioVideo;Audio;Mixer;\n\
         X-GNOME-Autostart-enabled=true\n\
         X-KDE-autostart-after=panel\n",
        citeer(programma)
    )
}

pub fn staat_aan() -> bool {
    pad().is_some_and(|p| p.exists())
}

pub fn zet(aan: bool) -> Result<(), String> {
    let pad = pad().ok_or("No config directory")?;
    if aan {
        let programma = programma()?;
        if let Some(map) = pad.parent() {
            std::fs::create_dir_all(map).map_err(|e| format!("{}: {e}", map.display()))?;
        }
        std::fs::write(&pad, inhoud(&programma.to_string_lossy()))
            .map_err(|e| format!("{}: {e}", pad.display()))
    } else {
        match std::fs::remove_file(&pad) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                Err(format!("{}: {e}", pad.display()))
            }
            _ => Ok(()),
        }
    }
}

/// Wie het programma verplaatst (een nieuwe AppImage ergens anders) laat een
/// autostart achter die nergens heen wijst. Bij elke start dus even bijwerken.
/// Niet vanuit een debug-build: die laadt de schil van de Vite-server van
/// `tauri dev`, en na het inloggen draait die niet.
pub fn werk_bij() {
    if !cfg!(debug_assertions) && staat_aan() {
        let _ = zet(true);
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn pad_met_spaties_en_tekens() {
        assert_eq!(
            citeer("/home/x/Pecan Mixer/pecan$mixer"),
            "\"/home/x/Pecan Mixer/pecan\\$mixer\""
        );
        assert!(inhoud("/a b/c").contains("Exec=\"/a b/c\" --hidden\n"));
    }
}
