//! Niveaumeters: per node een passieve capture-stream die alleen de pieken
//! per kanaal bijhoudt.
//!
//! Zoals pavucontrol het doet: een stream met `target.object` op de node, en
//! voor een sink `stream.capture.sink`, zodat WirePlumber de monitorpoorten
//! eraan hangt. `node.passive` houdt de graph niet wakker, `node.dont-reconnect`
//! voorkomt dat de meter naar de standaard springt als zijn node verdwijnt.
//!
//! Deze nodes heten `pecanpatch-meter-…`; [`super::graaf`] laat ze weg uit de
//! momentopname, want het zijn geen routes van de gebruiker.
//!
//! Geen `RT_PROCESS`: de process-callback draait dan op de gewone loop van de
//! graph-draad, waar de pieken zonder slot in een `Rc` kunnen.

use std::cell::RefCell;
use std::rc::Rc;

use pipewire as pw;
use pw::spa;
use pw::spa::pod::{Object, Pod, Value};
use pw::stream::{StreamFlags, StreamListener, StreamRc};

/// Het voorvoegsel van de eigen meter-nodes.
pub const VOORVOEGSEL: &str = "pecanpatch-meter-";

pub struct Meter {
    _stream: StreamRc,
    _listener: StreamListener<()>,
    /// Hoogste piek per kanaal sinds de laatste keer uitlezen, lineair.
    pieken: Rc<RefCell<Vec<f32>>>,
    /// De kanalen waarmee hij gemaakt is; veranderen die, dan opnieuw.
    pub kanalen: Vec<String>,
}

impl Meter {
    /// Geeft de pieken sinds de vorige keer en begint opnieuw bij nul.
    pub fn oogst(&self) -> Vec<f32> {
        let mut p = self.pieken.borrow_mut();
        let uit = p.clone();
        p.iter_mut().for_each(|x| *x = 0.0);
        uit
    }
}

/// Een meter op node `serial`. `kanalen` zijn de `audio.channel`-namen in de
/// volgorde waarin de pieken terug moeten komen.
pub fn maak(
    core: &pw::core::CoreRc,
    knoop: u32,
    serial: u64,
    sink: bool,
    kanalen: Vec<String>,
) -> Option<Meter> {
    if kanalen.is_empty() || kanalen.len() > spa::sys::SPA_AUDIO_MAX_CHANNELS as usize {
        return None;
    }
    let mut props = pw::properties::properties! {
        *pw::keys::MEDIA_TYPE => "Audio",
        *pw::keys::MEDIA_CATEGORY => "Monitor",
        *pw::keys::MEDIA_ROLE => "DSP",
        *pw::keys::NODE_NAME => format!("{VOORVOEGSEL}{knoop}"),
        *pw::keys::MEDIA_NAME => "Level meter",
        *pw::keys::APP_NAME => "Pecan Patch",
        "target.object" => serial.to_string(),
        "node.passive" => "true",
        "node.dont-reconnect" => "true",
        "stream.dont-remix" => "true",
    };
    if sink {
        props.insert("stream.capture.sink", "true");
    }
    let stream = StreamRc::new(core.clone(), &format!("{VOORVOEGSEL}{knoop}"), props).ok()?;

    let n = kanalen.len();
    let pieken = Rc::new(RefCell::new(vec![0.0f32; n]));
    let listener = stream
        .add_local_listener_with_user_data(())
        .process({
            let pieken = Rc::clone(&pieken);
            move |stream, _| {
                let Some(mut buffer) = stream.dequeue_buffer() else {
                    return;
                };
                let Some(data) = buffer.datas_mut().first_mut() else {
                    return;
                };
                let grootte = data.chunk().size() as usize;
                let Some(bytes) = data.data() else {
                    return;
                };
                let bytes = &bytes[..grootte.min(bytes.len())];
                let mut p = pieken.borrow_mut();
                for (i, s) in bytes.chunks_exact(4).enumerate() {
                    let v = f32::from_le_bytes([s[0], s[1], s[2], s[3]]).abs();
                    let c = i % n;
                    if v > p[c] {
                        p[c] = v;
                    }
                }
            }
        })
        .register()
        .ok()?;

    let mut info = spa::param::audio::AudioInfoRaw::new();
    info.set_format(spa::param::audio::AudioFormat::F32LE);
    info.set_channels(n as u32);
    let mut positie = [0u32; spa::sys::SPA_AUDIO_MAX_CHANNELS as usize];
    for (i, k) in kanalen.iter().enumerate() {
        positie[i] = kanaal_id(k);
    }
    info.set_position(positie);
    let obj = Object {
        type_: spa::utils::SpaTypes::ObjectParamFormat.as_raw(),
        id: spa::param::ParamType::EnumFormat.as_raw(),
        properties: info.into(),
    };
    let bytes = spa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &Value::Object(obj),
    )
    .ok()?
    .0
    .into_inner();
    let mut params = [Pod::from_bytes(&bytes)?];
    stream
        .connect(
            spa::utils::Direction::Input,
            None,
            StreamFlags::AUTOCONNECT | StreamFlags::MAP_BUFFERS,
            &mut params,
        )
        .ok()?;

    Some(Meter {
        _stream: stream,
        _listener: listener,
        pieken,
        kanalen,
    })
}

/// `"FL"` → `SPA_AUDIO_CHANNEL_FL`, `"AUX3"` → `SPA_AUDIO_CHANNEL_AUX0 + 3`.
fn kanaal_id(naam: &str) -> u32 {
    use spa::sys::*;
    if let Some(n) = naam.strip_prefix("AUX").and_then(|n| n.parse::<u32>().ok()) {
        return SPA_AUDIO_CHANNEL_AUX0 + n;
    }
    match naam {
        "MONO" => SPA_AUDIO_CHANNEL_MONO,
        "FL" => SPA_AUDIO_CHANNEL_FL,
        "FR" => SPA_AUDIO_CHANNEL_FR,
        "FC" => SPA_AUDIO_CHANNEL_FC,
        "LFE" => SPA_AUDIO_CHANNEL_LFE,
        "SL" => SPA_AUDIO_CHANNEL_SL,
        "SR" => SPA_AUDIO_CHANNEL_SR,
        "RL" => SPA_AUDIO_CHANNEL_RL,
        "RR" => SPA_AUDIO_CHANNEL_RR,
        _ => SPA_AUDIO_CHANNEL_UNKNOWN,
    }
}
