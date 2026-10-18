//! De PipeWire-graph zoals hij nu is: nodes, poorten, links, en wat de
//! session manager als standaard aanwijst.
//!
//! Een eigen draad met een eigen verbinding met de server: een PipeWire-loop
//! is niet `Send`, en de UI mag nooit op graph-verkeer wachten. Wat de draad
//! ziet gaat als één [`Momentopname`] naar buiten, hooguit 25 keer per
//! seconde: bij het opstarten komen er honderden globals tegelijk binnen, en
//! de schil hoeft die niet een voor een te tekenen.
//!
//! Hier zit geen beleid in. Dit is een spiegel; wat er verborgen wordt, welke
//! kolom iets krijgt en wat "een app" is, beslist de schil.
//!
//! Object-ids zijn per sessie: een apparaat dat terugkomt krijgt nieuwe.
//! Herkennen gaat daarom via `node.name`, `port.name` en de serials, die hier
//! allemaal meekomen.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use pipewire as pw;
use pw::node::NodeState;
use pw::spa::utils::dict::DictRef;
use pw::types::ObjectType;
use serde::Serialize;

/// Wat PipeWire in `format.dsp` zet voor MIDI: oude bytes of UMP.
const DSP_MIDI: &str = "8 bit raw midi";
const DSP_UMP: &str = "32 bit raw UMP";
/// En voor één kanaal audio, de enige vorm die een DSP-poort heeft.
const DSP_AUDIO: &str = "32 bit float mono audio";

/// Hoe vaak de draad kijkt of er iets te melden is.
const MELD_INTERVAL: Duration = Duration::from_millis(40);
/// Hoe lang hij wacht voor hij opnieuw verbindt als de server weg is.
const OPNIEUW_NA: Duration = Duration::from_secs(2);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Soort {
    Audio,
    Midi,
    /// Video en wat er verder nog over een poort kan.
    Anders,
}

impl Soort {
    fn van_dsp(dsp: Option<&str>) -> Self {
        match dsp {
            Some(DSP_AUDIO) => Self::Audio,
            Some(DSP_MIDI | DSP_UMP) => Self::Midi,
            _ => Self::Anders,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct Knoop {
    pub id: u32,
    pub serial: Option<u64>,
    /// `node.name`: machineleesbaar en het stabielst, `alsa_output.…`.
    pub naam: String,
    /// `node.description`: "Fireface 400 Pro".
    pub beschrijving: Option<String>,
    /// `node.nick`: "Fireface400 PCM".
    pub bijnaam: Option<String>,
    /// `media.class`: `Audio/Sink`, `Stream/Output/Audio`, `Midi/Bridge`, …
    pub klasse: Option<String>,
    /// `device.id`: de node hoort bij een apparaat (een geluidskaart, HDMI).
    pub apparaat: Option<u32>,
    /// `application.name` van een stream: "Firefox".
    pub app: Option<String>,
    /// `media.name` van een stream: de titel van wat er speelt.
    pub media: Option<String>,
    /// `running`, `idle`, `suspended`, `creating` of `error`.
    pub stand: Option<&'static str>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Poort {
    pub id: u32,
    pub knoop: u32,
    /// `port.id`: de volgorde binnen de node, die van de driver.
    pub volgnummer: Option<u32>,
    /// `port.name`: `playback_FL`, `capture_AUX3`, `Fireface400: MIDI 1 (capture)`.
    pub naam: String,
    /// `port.alias`: `Fireface400:Fireface400 MIDI 1`.
    pub alias: Option<String>,
    /// `true` voor een ingang, `false` voor een uitgang.
    pub ingang: bool,
    pub soort: Soort,
    /// `audio.channel`: `FL`, `FR`, `MONO`, `AUX0`.
    pub kanaal: Option<String>,
    pub monitor: bool,
    pub fysiek: bool,
    /// `port.group`: bij de Midi-Bridge het ALSA-client-nummer, dus het apparaat.
    pub groep: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Kabel {
    pub id: u32,
    pub uit_knoop: u32,
    pub uit_poort: u32,
    pub in_knoop: u32,
    pub in_poort: u32,
}

/// Alles wat de schil nodig heeft om de graph te tekenen.
#[derive(Clone, Debug, Default, Serialize)]
pub struct Momentopname {
    pub verbonden: bool,
    /// Samplerate van de graph: de geforceerde als die er is, anders de standaard.
    pub rate: Option<u32>,
    pub quantum: Option<u32>,
    /// `node.name` van de standaard-uitgang en -ingang.
    pub standaard_sink: Option<String>,
    pub standaard_bron: Option<String>,
    pub knopen: Vec<Knoop>,
    pub poorten: Vec<Poort>,
    pub kabels: Vec<Kabel>,
}

/// Wordt aangeroepen met elke nieuwe stand, vanaf de graph-draad.
pub type Melder = Box<dyn Fn(&Momentopname) + Send + 'static>;

/// De levende spiegel. Leeft zo lang als de app; de draad stopt niet.
pub struct Graaf {
    laatste: Arc<Mutex<Momentopname>>,
}

impl Graaf {
    pub fn start(melder: Melder) -> Self {
        let laatste = Arc::new(Mutex::new(Momentopname::default()));
        let gedeeld = Arc::clone(&laatste);
        std::thread::Builder::new()
            .name("cachypatch-graaf".to_owned())
            .spawn(move || draad(gedeeld, melder))
            .expect("graph-draad starten");
        Self { laatste }
    }

    pub fn nu(&self) -> Momentopname {
        self.laatste.lock().unwrap().clone()
    }
}

/// Blijft verbinden: als de server herstart of even weg is, komt de spiegel
/// vanzelf terug.
fn draad(laatste: Arc<Mutex<Momentopname>>, melder: Melder) {
    pw::init();
    let meld: Rc<dyn Fn(Momentopname)> = Rc::new(move |m: Momentopname| {
        melder(&m);
        *laatste.lock().unwrap() = m;
    });
    loop {
        if let Err(fout) = sessie(Rc::clone(&meld)) {
            eprintln!("cachypatch: PipeWire: {fout}");
        }
        meld(Momentopname::default());
        std::thread::sleep(OPNIEUW_NA);
    }
}

/// Wat de draad bijhoudt tussen de callbacks door.
#[derive(Default)]
struct Staat {
    knopen: BTreeMap<u32, Knoop>,
    poorten: BTreeMap<u32, Poort>,
    kabels: BTreeMap<u32, Kabel>,
    /// Uit de `settings`-metadata.
    rate: Option<u32>,
    force_rate: Option<u32>,
    quantum: Option<u32>,
    force_quantum: Option<u32>,
    /// Uit de `default`-metadata.
    standaard_sink: Option<String>,
    standaard_bron: Option<String>,
    /// Er is iets veranderd sinds de laatste melding.
    vuil: bool,
}

impl Staat {
    fn momentopname(&self) -> Momentopname {
        Momentopname {
            verbonden: true,
            rate: self.force_rate.or(self.rate),
            quantum: self.force_quantum.or(self.quantum),
            standaard_sink: self.standaard_sink.clone(),
            standaard_bron: self.standaard_bron.clone(),
            knopen: self.knopen.values().cloned().collect(),
            poorten: self.poorten.values().cloned().collect(),
            kabels: self.kabels.values().cloned().collect(),
        }
    }

    /// Een global uit het register. Nodes worden daarnaast gebonden (zie
    /// [`sessie`]), omdat `application.name` en `media.name` alleen in de
    /// info staan, niet in de props van het register.
    fn global(&mut self, id: u32, soort: &ObjectType, props: &DictRef) {
        match soort {
            ObjectType::Node => {
                self.knopen.insert(
                    id,
                    Knoop {
                        id,
                        serial: getal(props, "object.serial"),
                        naam: tekst(props, "node.name").unwrap_or_default(),
                        beschrijving: tekst(props, "node.description"),
                        bijnaam: tekst(props, "node.nick"),
                        klasse: tekst(props, "media.class"),
                        apparaat: getal(props, "device.id"),
                        app: None,
                        media: None,
                        stand: None,
                    },
                );
            }
            ObjectType::Port => {
                let Some(knoop) = getal(props, "node.id") else {
                    return;
                };
                self.poorten.insert(
                    id,
                    Poort {
                        id,
                        knoop,
                        volgnummer: getal(props, "port.id"),
                        naam: tekst(props, "port.name").unwrap_or_default(),
                        alias: tekst(props, "port.alias"),
                        ingang: props.get("port.direction") == Some("in"),
                        soort: Soort::van_dsp(props.get("format.dsp")),
                        kanaal: tekst(props, "audio.channel"),
                        monitor: props.get("port.monitor") == Some("true"),
                        fysiek: props.get("port.physical") == Some("true"),
                        groep: tekst(props, "port.group"),
                    },
                );
            }
            ObjectType::Link => {
                let (Some(uit_knoop), Some(uit_poort), Some(in_knoop), Some(in_poort)) = (
                    getal(props, "link.output.node"),
                    getal(props, "link.output.port"),
                    getal(props, "link.input.node"),
                    getal(props, "link.input.port"),
                ) else {
                    return;
                };
                self.kabels.insert(
                    id,
                    Kabel {
                        id,
                        uit_knoop,
                        uit_poort,
                        in_knoop,
                        in_poort,
                    },
                );
            }
            _ => return,
        }
        self.vuil = true;
    }

    fn weg(&mut self, id: u32) {
        let was = self.knopen.remove(&id).is_some()
            | self.poorten.remove(&id).is_some()
            | self.kabels.remove(&id).is_some();
        self.vuil |= was;
    }

    fn node_info(&mut self, id: u32, info: &pw::node::NodeInfoRef) {
        let Some(k) = self.knopen.get_mut(&id) else {
            return;
        };
        k.stand = Some(match info.state() {
            NodeState::Running => "running",
            NodeState::Idle => "idle",
            NodeState::Suspended => "suspended",
            NodeState::Creating => "creating",
            NodeState::Error(_) => "error",
        });
        if let Some(props) = info.props() {
            k.app = tekst(props, "application.name");
            k.media = tekst(props, "media.name");
            // De info kan rijker zijn dan het register.
            if let Some(b) = tekst(props, "node.description") {
                k.beschrijving = Some(b);
            }
            if let Some(b) = tekst(props, "node.nick") {
                k.bijnaam = Some(b);
            }
        }
        self.vuil = true;
    }

    fn metadata(&mut self, metadata: &str, sleutel: &str, waarde: Option<&str>) {
        let getal = || waarde.and_then(|w| w.trim().parse::<u32>().ok()).filter(|&n| n > 0);
        match (metadata, sleutel) {
            ("settings", "clock.rate") => self.rate = getal(),
            ("settings", "clock.force-rate") => self.force_rate = getal(),
            ("settings", "clock.quantum") => self.quantum = getal(),
            ("settings", "clock.force-quantum") => self.force_quantum = getal(),
            ("default", "default.audio.sink") => self.standaard_sink = waarde.and_then(naam_uit_json),
            ("default", "default.audio.source") => self.standaard_bron = waarde.and_then(naam_uit_json),
            _ => return,
        }
        self.vuil = true;
    }
}

fn tekst(props: &DictRef, sleutel: &str) -> Option<String> {
    props.get(sleutel).filter(|s| !s.is_empty()).map(str::to_owned)
}

fn getal<T: std::str::FromStr>(props: &DictRef, sleutel: &str) -> Option<T> {
    props.get(sleutel).and_then(|s| s.parse().ok())
}

/// `{"name":"alsa_output.…"}` → `alsa_output.…`.
fn naam_uit_json(waarde: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(waarde)
        .ok()?
        .get("name")?
        .as_str()
        .map(str::to_owned)
}

/// Gebonden proxies met hun listener. Ze worden nooit gelezen: ze bewaren is
/// het luisteren, weggooien is ophouden.
#[allow(dead_code)]
enum Binding {
    Knoop(pw::node::Node, pw::node::NodeListener),
    Metadata(pw::metadata::Metadata, pw::metadata::MetadataListener),
}

/// Eén verbinding met de server, tot die wegvalt.
fn sessie(meld: Rc<dyn Fn(Momentopname)>) -> Result<(), pw::Error> {
    let mainloop = pw::main_loop::MainLoopRc::new(None)?;
    let context = pw::context::ContextRc::new(&mainloop, None)?;
    let core = context.connect_rc(None)?;
    let registry = core.get_registry_rc()?;

    let staat = Rc::new(RefCell::new(Staat::default()));
    let bindingen: Rc<RefCell<BTreeMap<u32, Binding>>> = Rc::default();

    // Fout op het core-object (id 0) betekent dat de server weg is: de loop
    // stopt en `draad` verbindt opnieuw.
    let _core_listener = core
        .add_listener_local()
        .error({
            let mainloop = mainloop.downgrade();
            move |id, _seq, _res, bericht| {
                if id == 0 {
                    eprintln!("cachypatch: PipeWire-core: {bericht}");
                    if let Some(l) = mainloop.upgrade() {
                        l.quit();
                    }
                }
            }
        })
        .register();

    let _registry_listener = registry
        .add_listener_local()
        .global({
            let staat = Rc::clone(&staat);
            let bindingen = Rc::clone(&bindingen);
            let registry = registry.downgrade();
            move |g| {
                let Some(props) = g.props else {
                    return;
                };
                staat.borrow_mut().global(g.id, &g.type_, props);
                let Some(registry) = registry.upgrade() else {
                    return;
                };
                let id = g.id;
                match g.type_ {
                    ObjectType::Node => {
                        let Ok(node) = registry.bind::<pw::node::Node, _>(g) else {
                            return;
                        };
                        let staat = Rc::clone(&staat);
                        let listener = node
                            .add_listener_local()
                            .info(move |info| staat.borrow_mut().node_info(id, info))
                            .register();
                        bindingen
                            .borrow_mut()
                            .insert(id, Binding::Knoop(node, listener));
                    }
                    ObjectType::Metadata => {
                        let Some(naam) = props.get("metadata.name").map(str::to_owned) else {
                            return;
                        };
                        if naam != "default" && naam != "settings" {
                            return;
                        }
                        let Ok(meta) = registry.bind::<pw::metadata::Metadata, _>(g) else {
                            return;
                        };
                        let staat = Rc::clone(&staat);
                        let listener = meta
                            .add_listener_local()
                            .property(move |subject, sleutel, _type, waarde| {
                                // Alleen globale instellingen; per-node
                                // metadata (target.object) komt later.
                                if subject == 0 {
                                    if let Some(sleutel) = sleutel {
                                        staat.borrow_mut().metadata(&naam, sleutel, waarde);
                                    }
                                }
                                0
                            })
                            .register();
                        bindingen
                            .borrow_mut()
                            .insert(id, Binding::Metadata(meta, listener));
                    }
                    _ => {}
                }
            }
        })
        .global_remove({
            let staat = Rc::clone(&staat);
            let bindingen = Rc::clone(&bindingen);
            move |id| {
                staat.borrow_mut().weg(id);
                bindingen.borrow_mut().remove(&id);
            }
        })
        .register();

    let timer = mainloop.loop_().add_timer({
        let staat = Rc::clone(&staat);
        move |_| {
            let mut s = staat.borrow_mut();
            if s.vuil {
                s.vuil = false;
                meld(s.momentopname());
            }
        }
    });
    timer.update_timer(Some(MELD_INTERVAL), Some(MELD_INTERVAL));
    // Ook een lege graph is een verbonden graph.
    staat.borrow_mut().vuil = true;

    mainloop.run();
    drop(timer);
    Ok(())
}
