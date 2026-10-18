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
//!
//! Veranderen gaat via [`Opdracht`]: een link leggen of weghalen, een stream
//! verplaatsen met `target.object`, volume en mute. Ook dat is uitvoeren, geen
//! beslissen.

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use pipewire as pw;
use pw::node::NodeState;
use pw::spa::param::ParamType;
use pw::spa::pod::{Object, Pod, Property, Value, ValueArray};
use pw::spa::utils::dict::DictRef;
use pw::types::ObjectType;
use serde::Serialize;

use crate::meter::{self, Meter};
use crate::midimeter::{Activiteit, MidiMeter};
use crate::opname::{self, Actief, Bericht, Bus, Klok, KlokStand, MidiBestand, Opnemer, Spoor};

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
    /// `target.object` uit de `default`-metadata: waar de stream naartoe is
    /// verplaatst. Een serial of een `node.name`; `None` = WirePlumber kiest.
    pub doel: Option<String>,
    /// Volume per kanaal, lineair (1.0 = 0 dB), uit de Props van de node.
    pub volume: Option<Vec<f32>>,
    pub mute: Option<bool>,
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
    /// De client die de link legde. Is dat WirePlumber, dan is het beleid;
    /// anders handwerk.
    pub client: Option<u32>,
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
    /// De client-ids van WirePlumber (meestal één).
    pub wireplumber: Vec<u32>,
    pub knopen: Vec<Knoop>,
    pub poorten: Vec<Poort>,
    pub kabels: Vec<Kabel>,
}

/// Piek per kanaal sinds de vorige melding, lineair, per node-id. De
/// kanalen staan in de volgorde van de poorten (`port.id`).
pub type Pieken = BTreeMap<u32, Vec<f32>>;

/// Wat de draad meldt: een nieuwe stand van de graph, of nieuwe pieken.
/// Apart, want pieken komen 25 keer per seconde en de graph zelden.
pub enum Melding<'a> {
    Graaf(&'a Momentopname),
    Pieken(&'a Pieken),
    /// MIDI-activiteit per bronpoort (poort-id), sinds de vorige melding.
    Midi(&'a BTreeMap<u32, Activiteit>),
    /// Hoe het met de opname en de klok staat; vijf keer per seconde.
    Transport(&'a TransportStand),
}

/// Eén gewapende bus: een WAV met deze kanalen van de Rec bus.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct BusOpname {
    pub naam: String,
    pub kanalen: Vec<usize>,
}

/// Wat de opname moet doen als hij start.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct Opties {
    /// De gewapende audiobussen.
    pub bussen: Vec<BusOpname>,
    /// De MIDI-ingang van de bus is gewapend.
    pub midi: bool,
    /// De MIDI-bronpoort van de externe klok; `None` = intern.
    pub klok: Option<u32>,
    /// Starten en stoppen op MIDI Start/Stop van de klok.
    pub start_stop: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct TransportStand {
    pub bezig: bool,
    /// De map van de lopende (of laatste) opname.
    pub map: Option<String>,
    pub seconden: f64,
    pub klok: KlokStand,
    /// Wat er misging bij de laatste opname.
    pub fout: Option<String>,
}

/// Wordt aangeroepen vanaf de graph-draad.
pub type Melder = Box<dyn Fn(Melding) + Send + 'static>;

/// Wat de schil de graph kan laten doen. Alles op object-id: de schil werkt
/// met de momentopname van zojuist, en een id die intussen weg is doet niets.
#[derive(Clone, Debug)]
pub enum Opdracht {
    /// Een link van een uitgangspoort naar een ingangspoort. Blijft bestaan
    /// als Pecan Patch sluit (`object.linger`): wat je patcht, blijft gepatcht.
    Verbind { uit: u32, naar: u32 },
    /// Een link weghalen, van wie hij ook is.
    Ontkoppel { kabel: u32 },
    /// `target.object` van een node zetten (een serial) of wissen. Dan
    /// verplaatst WirePlumber de stream, zoals bij pavucontrol.
    ZetDoel { knoop: u32, doel: Option<String> },
    /// Volume per kanaal, lineair.
    ZetVolume { knoop: u32, volume: Vec<f32> },
    ZetMute { knoop: u32, mute: bool },
    /// Opties voor de volgende opname, en welke klok.
    ZetTransport(Opties),
    /// Hoeveel kanalen de Rec bus heeft, en hun gain (lineair, 0 = mute).
    ZetBus { kanalen: usize, gain: Vec<f32> },
    Start,
    Stop,
}

/// De levende spiegel. Leeft zo lang als de app; de draad stopt niet.
pub struct Graaf {
    laatste: Arc<Mutex<Momentopname>>,
    opdrachten: Mutex<pw::channel::Sender<Opdracht>>,
}

impl Graaf {
    pub fn start(melder: Melder) -> Self {
        let laatste = Arc::new(Mutex::new(Momentopname::default()));
        let gedeeld = Arc::clone(&laatste);
        let (tx, rx) = pw::channel::channel();
        std::thread::Builder::new()
            .name("pecanpatch-graaf".to_owned())
            .spawn(move || draad(gedeeld, melder, rx))
            .expect("graph-draad starten");
        Self {
            laatste,
            opdrachten: Mutex::new(tx),
        }
    }

    pub fn nu(&self) -> Momentopname {
        self.laatste.lock().unwrap().clone()
    }

    /// Geeft de opdracht door aan de graph-draad en wacht niet.
    pub fn doe(&self, o: Opdracht) {
        let _ = self.opdrachten.lock().unwrap().send(o);
    }
}

/// Blijft verbinden: als de server herstart of even weg is, komt de spiegel
/// vanzelf terug.
fn draad(
    laatste: Arc<Mutex<Momentopname>>,
    melder: Melder,
    mut rx: pw::channel::Receiver<Opdracht>,
) {
    pw::init();
    let melder = Rc::new(melder);
    let meld: Rc<dyn Fn(Momentopname)> = Rc::new({
        let melder = Rc::clone(&melder);
        move |m: Momentopname| {
            melder(Melding::Graaf(&m));
            *laatste.lock().unwrap() = m;
        }
    });
    let overig: Rc<dyn Fn(Melding)> = Rc::new(move |m: Melding| melder(m));
    loop {
        rx = match sessie(Rc::clone(&meld), Rc::clone(&overig), rx) {
            (Ok(()), rx) => rx,
            (Err(fout), rx) => {
                eprintln!("pecanpatch: PipeWire: {fout}");
                rx
            }
        };
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
    /// Client-id → `application.name`.
    clients: BTreeMap<u32, String>,
    /// `target.object` per node-id, uit de `default`-metadata. Apart van de
    /// knopen, want de metadata kan eerder binnenkomen dan de node.
    doelen: BTreeMap<u32, String>,
    /// Uit de `settings`-metadata.
    rate: Option<u32>,
    force_rate: Option<u32>,
    quantum: Option<u32>,
    force_quantum: Option<u32>,
    /// Uit de `default`-metadata.
    standaard_sink: Option<String>,
    standaard_bron: Option<String>,
    /// Onze eigen meter-nodes: die horen niet in de graph van de gebruiker.
    eigen: BTreeSet<u32>,
    /// De poorten van onze eigen nodes: (node, poortnaam) → id, om te linken.
    eigen_poorten: BTreeMap<(u32, String), u32>,
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
            wireplumber: self
                .clients
                .iter()
                .filter(|(_, naam)| naam.as_str() == "WirePlumber")
                .map(|(id, _)| *id)
                .collect(),
            knopen: self
                .knopen
                .values()
                .map(|k| Knoop {
                    doel: self.doelen.get(&k.id).cloned(),
                    ..k.clone()
                })
                .collect(),
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
                if props.get("node.name").is_some_and(|n| n.starts_with(meter::VOORVOEGSEL)) {
                    self.eigen.insert(id);
                    return;
                }
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
                        doel: None,
                        volume: None,
                        mute: None,
                    },
                );
            }
            ObjectType::Port => {
                let Some(knoop) = getal(props, "node.id") else {
                    return;
                };
                if self.eigen.contains(&knoop) {
                    if let Some(n) = tekst(props, "port.name") {
                        self.eigen_poorten.insert((knoop, n), id);
                    }
                    return;
                }
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
                if self.eigen.contains(&uit_knoop) || self.eigen.contains(&in_knoop) {
                    return;
                }
                self.kabels.insert(
                    id,
                    Kabel {
                        id,
                        uit_knoop,
                        uit_poort,
                        in_knoop,
                        in_poort,
                        client: getal(props, "client.id"),
                    },
                );
            }
            ObjectType::Client => {
                self.clients
                    .insert(id, tekst(props, "application.name").unwrap_or_default());
            }
            _ => return,
        }
        self.vuil = true;
    }

    fn weg(&mut self, id: u32) {
        let was = self.knopen.remove(&id).is_some()
            | self.poorten.remove(&id).is_some()
            | self.kabels.remove(&id).is_some()
            | self.clients.remove(&id).is_some()
            | self.doelen.remove(&id).is_some();
        self.eigen.remove(&id);
        self.eigen_poorten.retain(|(k, _), p| *p != id && *k != id);
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

    /// De Props van een node: volume en mute. Streams sturen er soms een
    /// zonder volume tussendoor; alleen wat er staat wordt overgenomen.
    fn props(&mut self, id: u32, pod: &Pod) {
        let Some(k) = self.knopen.get_mut(&id) else {
            return;
        };
        let Ok((_, Value::Object(obj))) =
            pw::spa::pod::deserialize::PodDeserializer::deserialize_any_from(pod.as_bytes())
        else {
            return;
        };
        for p in obj.properties {
            match (p.key, p.value) {
                (pw::spa::sys::SPA_PROP_channelVolumes, Value::ValueArray(ValueArray::Float(v))) => {
                    k.volume = Some(v);
                    self.vuil = true;
                }
                (pw::spa::sys::SPA_PROP_mute, Value::Bool(m)) => {
                    k.mute = Some(m);
                    self.vuil = true;
                }
                _ => {}
            }
        }
    }

    /// `target.object` van één node, of het wissen ervan.
    fn doel(&mut self, knoop: u32, waarde: Option<&str>) {
        match waarde.map(|w| w.trim_matches('"')) {
            Some(w) if !w.is_empty() => self.doelen.insert(knoop, w.to_owned()),
            _ => self.doelen.remove(&knoop),
        };
        self.vuil = true;
    }

    /// Welke nodes een meter horen te hebben: id → (serial, is sink, kanalen).
    fn meterbaar(&self) -> BTreeMap<u32, (u64, bool, Vec<String>)> {
        let mut uit = BTreeMap::new();
        for k in self.knopen.values() {
            let klasse = k.klasse.as_deref().unwrap_or_default();
            let sink = klasse.starts_with("Audio/Sink");
            let ok = sink
                || klasse == "Stream/Output/Audio"
                || klasse.starts_with("Audio/Source")
                || klasse == "Audio/Duplex";
            let Some(serial) = k.serial.filter(|_| ok) else {
                continue;
            };
            let mut ps: Vec<&Poort> = self
                .poorten
                .values()
                .filter(|p| {
                    p.knoop == k.id && p.soort == Soort::Audio && !p.monitor && p.ingang == sink
                })
                .collect();
            ps.sort_by_key(|p| (p.volgnummer.unwrap_or(p.id), p.id));
            let kanalen: Option<Vec<String>> = ps.iter().map(|p| p.kanaal.clone()).collect();
            if let Some(kanalen) = kanalen.filter(|k| !k.is_empty()) {
                uit.insert(k.id, (serial, sink, kanalen));
            }
        }
        uit
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

/// Een Props-pod met één eigenschap, om naar een node te sturen.
fn props_pod(eigenschap: Property) -> Option<Vec<u8>> {
    let obj = Object {
        type_: pw::spa::utils::SpaTypes::ObjectParamProps.as_raw(),
        id: ParamType::Props.as_raw(),
        properties: vec![eigenschap],
    };
    pw::spa::pod::serialize::PodSerializer::serialize(
        std::io::Cursor::new(Vec::new()),
        &Value::Object(obj),
    )
    .ok()
    .map(|(c, _)| c.into_inner())
}

/// Gebonden proxies met hun listener. Ze worden nooit gelezen: ze bewaren is
/// het luisteren, weggooien is ophouden.
#[allow(dead_code)]
enum Binding {
    Knoop(pw::node::Node, pw::node::NodeListener),
    /// Met de naam: `default` of `settings`.
    Metadata(pw::metadata::Metadata, pw::metadata::MetadataListener, String),
}

/// Eén verbinding met de server, tot die wegvalt. Geeft de ontvanger van de
/// opdrachten terug, want die gaat mee naar de volgende sessie.
fn sessie(
    meld: Rc<dyn Fn(Momentopname)>,
    meld_overig: Rc<dyn Fn(Melding)>,
    rx: pw::channel::Receiver<Opdracht>,
) -> (Result<(), pw::Error>, pw::channel::Receiver<Opdracht>) {
    let opzet = || -> Result<_, pw::Error> {
        let mainloop = pw::main_loop::MainLoopRc::new(None)?;
        let context = pw::context::ContextRc::new(&mainloop, None)?;
        let core = context.connect_rc(None)?;
        let registry = core.get_registry_rc()?;
        Ok((mainloop, context, core, registry))
    };
    let (mainloop, _context, core, registry) = match opzet() {
        Ok(v) => v,
        Err(fout) => return (Err(fout), rx),
    };

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
                    eprintln!("pecanpatch: PipeWire-core: {bericht}");
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
                if staat.borrow().eigen.contains(&g.id) {
                    return;
                }
                let Some(registry) = registry.upgrade() else {
                    return;
                };
                let id = g.id;
                match g.type_ {
                    ObjectType::Node => {
                        let Ok(node) = registry.bind::<pw::node::Node, _>(g) else {
                            return;
                        };
                        let listener = node
                            .add_listener_local()
                            .info({
                                let staat = Rc::clone(&staat);
                                move |info| staat.borrow_mut().node_info(id, info)
                            })
                            .param({
                                let staat = Rc::clone(&staat);
                                move |_seq, soort, _index, _next, pod| {
                                    if let (ParamType::Props, Some(pod)) = (soort, pod) {
                                        staat.borrow_mut().props(id, pod);
                                    }
                                }
                            })
                            .register();
                        node.subscribe_params(&[ParamType::Props]);
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
                        let naam_ook = naam.clone();
                        let listener = meta
                            .add_listener_local()
                            .property(move |subject, sleutel, _type, waarde| {
                                let mut s = staat.borrow_mut();
                                match sleutel {
                                    // Alles wissen.
                                    None => {
                                        if naam == "default" {
                                            s.doelen.clear();
                                            s.vuil = true;
                                        }
                                    }
                                    Some("target.object") if naam == "default" && subject != 0 => {
                                        s.doel(subject, waarde)
                                    }
                                    Some(sleutel) if subject == 0 => {
                                        s.metadata(&naam, sleutel, waarde)
                                    }
                                    _ => {}
                                }
                                0
                            })
                            .register();
                        bindingen
                            .borrow_mut()
                            .insert(id, Binding::Metadata(meta, listener, naam_ook));
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

    // Links die wij legden. Ze blijven bestaan zonder proxy (linger), maar de
    // proxy moet leven tot de server hem heeft gemaakt; een handvol bewaren
    // is ruim genoeg.
    let gelegd: Rc<RefCell<std::collections::VecDeque<pw::link::Link>>> = Rc::default();

    // De opname: wat er loopt, de klok, en de Rec bus zelf.
    let opnemer: Opnemer = Rc::default();
    let klok: Rc<RefCell<Klok>> = Rc::default();
    let transport: Rc<RefCell<Transport>> = Rc::default();
    let bus = Rc::new(Bus::maak(&core, Rc::clone(&opnemer), 2));

    let ontvanger = rx.attach(mainloop.loop_(), {
        let core = core.clone();
        let registry = registry.clone();
        let bindingen = Rc::clone(&bindingen);
        let gelegd = Rc::clone(&gelegd);
        let staat = Rc::clone(&staat);
        let opnemer = Rc::clone(&opnemer);
        let klok = Rc::clone(&klok);
        let transport = Rc::clone(&transport);
        let bus = Rc::clone(&bus);
        move |o| match o {
            Opdracht::ZetBus { kanalen, gain } => {
                if let Some(b) = bus.as_ref() {
                    b.zet_kanalen(kanalen);
                    b.zet_gain(&gain);
                }
            }
            Opdracht::ZetTransport(opties) => {
                let mut k = klok.borrow_mut();
                if k.bron != opties.klok {
                    k.recent.clear();
                }
                k.bron = opties.klok;
                k.start_stop = opties.start_stop;
                transport.borrow_mut().opties = Some(opties);
            }
            Opdracht::Start => begin(
                &staat.borrow(),
                &mut transport.borrow_mut(),
                &opnemer,
                bus.as_ref().as_ref().and_then(Bus::knoop_id),
            ),
            Opdracht::Stop => eindig(&mut transport.borrow_mut(), &opnemer, &klok.borrow()),
            o => uitvoeren(o, &core, &registry, &bindingen.borrow(), &gelegd),
        }
    });

    // Eén meter per node die geluid maakt of ontvangt.
    let meters: Rc<RefCell<BTreeMap<u32, Meter>>> = Rc::default();
    // En één node die alle MIDI-uitgangen afluistert.
    let midi = Rc::new(RefCell::new(MidiMeter::maak(&core, Rc::clone(&opnemer), Rc::clone(&klok))));
    let tikken = std::cell::Cell::new(0u32);

    let timer = mainloop.loop_().add_timer({
        let staat = Rc::clone(&staat);
        let meters = Rc::clone(&meters);
        let midi = Rc::clone(&midi);
        let core = core.clone();
        let opnemer = Rc::clone(&opnemer);
        let klok = Rc::clone(&klok);
        let transport = Rc::clone(&transport);
        let bus = Rc::clone(&bus);
        move |_| {
            // Start of Stop van de externe klok.
            let verzoek = klok.borrow_mut().verzoek.take();
            match verzoek {
                Some(true) if opnemer.borrow().is_none() => begin(
                    &staat.borrow(),
                    &mut transport.borrow_mut(),
                    &opnemer,
                    bus.as_ref().as_ref().and_then(Bus::knoop_id),
                ),
                Some(false) if opnemer.borrow().is_some() => {
                    eindig(&mut transport.borrow_mut(), &opnemer, &klok.borrow())
                }
                _ => {}
            }
            tikken.set(tikken.get().wrapping_add(1));
            if tikken.get().is_multiple_of(5) {
                let mut t = transport.borrow_mut();
                t.ruim_op();
                let stand = TransportStand {
                    bezig: opnemer.borrow().is_some(),
                    map: t.map.as_ref().map(|m| m.display().to_string()),
                    seconden: opnemer.borrow().as_ref().map_or(0.0, |a| a.t0.elapsed().as_secs_f64()),
                    klok: klok.borrow().stand(),
                    fout: t.fout.clone(),
                };
                meld_overig(Melding::Transport(&stand));
            }
            if let Some(mm) = midi.borrow_mut().as_mut() {
                let s = staat.borrow();
                let bronnen: Vec<u32> = s
                    .poorten
                    .values()
                    .filter(|p| p.soort == Soort::Midi && !p.ingang)
                    .map(|p| p.id)
                    .collect();
                mm.stem_af(&core, &bronnen, &s.eigen_poorten);
                let activiteit = mm.oogst();
                if !activiteit.is_empty() {
                    meld_overig(Melding::Midi(&activiteit));
                }
            }
            let mut s = staat.borrow_mut();
            if s.vuil {
                s.vuil = false;
                meld(s.momentopname());
                // Meters bijwerken: weg wat weg is, nieuw wat nieuw is.
                let moet = s.meterbaar();
                drop(s);
                let mut m = meters.borrow_mut();
                m.retain(|id, meter| moet.get(id).is_some_and(|(_, _, k)| *k == meter.kanalen));
                for (id, (serial, sink, kanalen)) in moet {
                    if let std::collections::btree_map::Entry::Vacant(plek) = m.entry(id) {
                        if let Some(meter) = meter::maak(&core, id, serial, sink, kanalen) {
                            plek.insert(meter);
                        }
                    }
                }
            } else {
                drop(s);
            }
            let m = meters.borrow();
            let mut pieken: Pieken = m.iter().map(|(id, meter)| (*id, meter.oogst())).collect();
            // De Rec bus meet zichzelf, onder zijn eigen node-id.
            if let Some((b, id)) = bus.as_ref().as_ref().and_then(|b| b.knoop_id().map(|id| (b, id))) {
                pieken.insert(id, b.oogst());
            }
            if !pieken.is_empty() {
                meld_overig(Melding::Pieken(&pieken));
            }
        }
    });
    timer.update_timer(Some(MELD_INTERVAL), Some(MELD_INTERVAL));
    // Ook een lege graph is een verbonden graph.
    staat.borrow_mut().vuil = true;

    mainloop.run();
    drop(timer);
    // Een opname die nog liep, netjes afsluiten.
    eindig(&mut transport.borrow_mut(), &opnemer, &klok.borrow());
    meters.borrow_mut().clear();
    midi.borrow_mut().take();
    (Ok(()), ontvanger.deattach())
}

/// Wat de graph-draad over de opname bijhoudt.
#[derive(Default)]
struct Transport {
    opties: Option<Opties>,
    map: Option<std::path::PathBuf>,
    fout: Option<String>,
    /// De schrijfdraad van de laatste opname, tot hij klaar is.
    schrijver: Option<std::thread::JoinHandle<Result<(), String>>>,
    /// Namen van de MIDI-sporen, voor het bestand.
    midi_namen: Vec<String>,
}

impl Transport {
    /// Een klaar schrijvertje oogsten, zodat een fout op het scherm komt.
    fn ruim_op(&mut self) {
        if self.schrijver.as_ref().is_some_and(|d| d.is_finished()) {
            if let Some(Err(e)) = self.schrijver.take().map(|d| d.join().unwrap_or(Err("writer panicked".into()))) {
                self.fout = Some(e);
            }
        }
    }
}

/// Start een opname met wat er nu naar de Rec bus gerouteerd is.
fn begin(s: &Staat, t: &mut Transport, opnemer: &Opnemer, bus: Option<u32>) {
    if opnemer.borrow().is_some() {
        return;
    }
    t.fout = None;
    let opties = t.opties.clone().unwrap_or(Opties {
        bussen: vec![BusOpname { naam: "Rec 1-2".into(), kanalen: vec![0, 1] }],
        midi: true,
        klok: None,
        start_stop: false,
    });
    match plan(s, &opties, bus) {
        Err(e) => t.fout = Some(e),
        Ok((sporen, bussen, midi, midi_namen)) => {
            let map = opname::nieuwe_map();
            let rate = s.force_rate.or(s.rate).unwrap_or(48_000);
            match opname::schrijver(&map, sporen, rate) {
                Err(e) => t.fout = Some(format!("{}: {e}", map.display())),
                Ok((tx, draad)) => {
                    *opnemer.borrow_mut() = Some(Actief {
                        tx,
                        t0: std::time::Instant::now(),
                        bussen,
                        midi,
                        midi_events: Vec::new(),
                        pulsen: Vec::new(),
                    });
                    t.map = Some(map);
                    t.schrijver = Some(draad);
                    t.midi_namen = midi_namen;
                }
            }
        }
    }
}

type Plan = (Vec<Spoor>, Vec<(usize, Vec<usize>)>, BTreeMap<u32, usize>, Vec<String>);

/// Welke sporen er komen: per gewapende bus een WAV, en per MIDI-bron die
/// naar de bus gaat een spoor in het MIDI-bestand.
fn plan(s: &Staat, o: &Opties, bus: Option<u32>) -> Result<Plan, String> {
    let bus = s.knopen.get(&bus.ok_or("The Rec bus is not there")?).ok_or("The Rec bus is not there")?;
    let midi_in: BTreeSet<u32> = s
        .poorten
        .values()
        .filter(|p| p.knoop == bus.id && p.soort == Soort::Midi)
        .map(|p| p.id)
        .collect();

    let mut sporen = Vec::new();
    let mut bussen = Vec::new();
    for b in &o.bussen {
        if b.kanalen.is_empty() {
            continue;
        }
        bussen.push((sporen.len(), b.kanalen.clone()));
        sporen.push(Spoor { naam: b.naam.clone(), kanalen: b.kanalen.len() as u16 });
    }

    // MIDI: per bronpoort die naar de bus gaat.
    let mut midi = BTreeMap::new();
    let mut midi_namen = Vec::new();
    if o.midi {
        for k in s.kabels.values().filter(|k| midi_in.contains(&k.in_poort)) {
            if midi.contains_key(&k.uit_poort) {
                continue;
            }
            let p = s.poorten.get(&k.uit_poort);
            let knoop = s.knopen.get(&k.uit_knoop);
            let naam = match (p, knoop) {
                (Some(p), Some(n)) if n.naam == "Midi-Bridge" => p
                    .alias
                    .as_deref()
                    .and_then(|a| a.split(':').next())
                    .unwrap_or(&p.naam)
                    .to_owned(),
                (_, Some(n)) => n.app.clone().or(n.beschrijving.clone()).unwrap_or(n.naam.clone()),
                _ => format!("MIDI {}", k.uit_poort),
            };
            midi.insert(k.uit_poort, midi_namen.len());
            midi_namen.push(naam);
        }
    }

    if sporen.is_empty() && midi.is_empty() {
        return Err("Nothing armed: press R on a Rec bus".into());
    }
    Ok((sporen, bussen, midi, midi_namen))
}

/// Stopt de opname: de schrijfdraad maakt de bestanden af.
fn eindig(t: &mut Transport, opnemer: &Opnemer, klok: &Klok) {
    let Some(a) = opnemer.borrow_mut().take() else { return };
    let midi = (!t.midi_namen.is_empty()).then(|| MidiBestand {
        namen: std::mem::take(&mut t.midi_namen),
        events: a.midi_events,
        pulsen: klok.bron.is_some().then_some(a.pulsen),
    });
    let _ = a.tx.send(Bericht::Stop(midi));
}

fn uitvoeren(
    o: Opdracht,
    core: &pw::core::CoreRc,
    registry: &pw::registry::RegistryRc,
    bindingen: &BTreeMap<u32, Binding>,
    gelegd: &RefCell<std::collections::VecDeque<pw::link::Link>>,
) {
    match o {
        Opdracht::Verbind { uit, naar } => {
            let props = pw::properties::properties! {
                "link.output.port" => uit.to_string(),
                "link.input.port" => naar.to_string(),
                "object.linger" => "true",
            };
            match core.create_object::<pw::link::Link>("link-factory", &props) {
                Ok(link) => {
                    let mut g = gelegd.borrow_mut();
                    g.push_back(link);
                    while g.len() > 64 {
                        g.pop_front();
                    }
                }
                Err(fout) => eprintln!("pecanpatch: link {uit} → {naar}: {fout}"),
            }
        }
        Opdracht::Ontkoppel { kabel } => {
            registry.destroy_global(kabel);
        }
        Opdracht::ZetDoel { knoop, doel } => {
            let Some(meta) = bindingen.values().find_map(|b| match b {
                Binding::Metadata(m, _, naam) if naam == "default" => Some(m),
                _ => None,
            }) else {
                return;
            };
            meta.set_property(knoop, "target.object", None, doel.as_deref());
        }
        Opdracht::ZetVolume { knoop, volume } => {
            let eigenschap = Property::new(
                pw::spa::sys::SPA_PROP_channelVolumes,
                Value::ValueArray(ValueArray::Float(volume)),
            );
            stuur_props(bindingen, knoop, eigenschap);
        }
        Opdracht::ZetMute { knoop, mute } => {
            let eigenschap = Property::new(pw::spa::sys::SPA_PROP_mute, Value::Bool(mute));
            stuur_props(bindingen, knoop, eigenschap);
        }
        // Die handelt de ontvanger in `sessie` zelf af.
        Opdracht::ZetTransport(_) | Opdracht::ZetBus { .. } | Opdracht::Start | Opdracht::Stop => {}
    }
}

fn stuur_props(bindingen: &BTreeMap<u32, Binding>, knoop: u32, eigenschap: Property) {
    let Some(Binding::Knoop(node, _)) = bindingen.get(&knoop) else {
        return;
    };
    let Some(bytes) = props_pod(eigenschap) else {
        return;
    };
    if let Some(pod) = Pod::from_bytes(&bytes) {
        node.set_param(ParamType::Props, 0, pod);
    }
}
