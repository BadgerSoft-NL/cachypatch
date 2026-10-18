//! MIDI-activiteit: wat er uit elke MIDI-uitgang komt.
//!
//! Eén eigen node (`cachypatch-meter-midi`, dus buiten de momentopname) met
//! per bronpoort een MIDI-ingang, gekoppeld met een eigen link. MIDI mag naar
//! meer plekken tegelijk, dus dat verandert niets aan de routing. De link
//! heeft geen `object.linger`: hij verdwijnt met CachyPatch.
//!
//! pipewire-rs heeft geen veilige filter-API, dus dit praat met `pw_filter`
//! zoals miau-core dat doet. Zonder `RT_PROCESS`: de process-callback draait
//! op de loop van de graph-draad, dezelfde draad die de poorten toevoegt en
//! weghaalt, dus er is geen slot nodig.
//!
//! Wat er per bron bijgehouden wordt is alleen voor het oog: hoeveel events,
//! op welke kanalen, welke soorten, en het laatste muzikale event als tekst.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::ffi::{c_void, CString};
use std::ptr;
use std::rc::Rc;
use std::time::{Duration, Instant};

use pipewire as pw;
use pw::spa;
use pw::sys as pw_sys;
use serde::Serialize;

use crate::meter::VOORVOEGSEL;
use crate::opname::{Klok, Opnemer};

pub const NAAM: &str = "cachypatch-meter-midi";

/// Vaste ABI-waarden van `spa_control_type`.
const SPA_CONTROL_MIDI: u32 = 2;
const SPA_CONTROL_UMP: u32 = 4;

/// Bits in [`Activiteit::soorten`].
pub const NOTE: u8 = 1;
pub const CC: u8 = 2;
pub const PB: u8 = 4;
pub const CLK: u8 = 8;

/// Wat er sinds de vorige oogst uit één bronpoort kwam.
#[derive(Clone, Debug, Default, Serialize)]
pub struct Activiteit {
    pub events: u32,
    /// Bit `n` = kanaal `n + 1`.
    pub kanalen: u16,
    pub soorten: u8,
    /// Het laatste muzikale event ("Note On E4 · vel 76"); klok telt niet mee.
    pub laatste: Option<String>,
}

struct Poort {
    bron: u32,
    data: *mut c_void,
}

struct Binnen {
    poorten: Vec<Poort>,
    activiteit: BTreeMap<u32, Activiteit>,
    opnemer: Opnemer,
    klok: Rc<RefCell<Klok>>,
}

pub struct MidiMeter {
    filter: *mut pw_sys::pw_filter,
    _haak: Box<spa::sys::spa_hook>,
    _events: Box<pw_sys::pw_filter_events>,
    binnen: Box<RefCell<Binnen>>,
    /// Link per bronpoort; de proxy weggooien haalt de link weg.
    links: BTreeMap<u32, pw::link::Link>,
}

impl MidiMeter {
    pub fn maak(core: &pw::core::CoreRc, opnemer: Opnemer, klok: Rc<RefCell<Klok>>) -> Option<Self> {
        let naam = CString::new(NAAM).ok()?;
        debug_assert!(NAAM.starts_with(VOORVOEGSEL));
        let props = pw::properties::properties! {
            *pw::keys::MEDIA_TYPE => "Midi",
            *pw::keys::MEDIA_CATEGORY => "Monitor",
            *pw::keys::MEDIA_ROLE => "DSP",
            *pw::keys::NODE_NAME => NAAM,
            *pw::keys::APP_NAME => "CachyPatch",
            "node.passive" => "true",
            "node.autoconnect" => "false",
        };
        // SAFETY: de core leeft zo lang als de sessie, en de meter wordt aan
        // het eind van de sessie weggegooid, vóór de core.
        let filter = unsafe { pw_sys::pw_filter_new(core.as_raw_ptr(), naam.as_ptr(), props.into_raw()) };
        if filter.is_null() {
            return None;
        }
        let events = Box::new(pw_sys::pw_filter_events {
            version: pw_sys::PW_VERSION_FILTER_EVENTS,
            process: Some(bij_process),
            // SAFETY: een nul-struct is een geldige "geen callback" voor de rest.
            ..unsafe { std::mem::zeroed() }
        });
        // SAFETY: idem, een lege haak.
        let mut haak: Box<spa::sys::spa_hook> = Box::new(unsafe { std::mem::zeroed() });
        let binnen = Box::new(RefCell::new(Binnen {
            poorten: Vec::new(),
            activiteit: BTreeMap::new(),
            opnemer,
            klok,
        }));
        // SAFETY: filter, haak, events en binnen leven allemaal tot Drop.
        unsafe {
            pw_sys::pw_filter_add_listener(
                filter,
                haak.as_mut(),
                events.as_ref(),
                ptr::from_ref(binnen.as_ref()).cast_mut().cast(),
            );
            if pw_sys::pw_filter_connect(filter, 0, ptr::null_mut(), 0) < 0 {
                pw_sys::pw_filter_destroy(filter);
                return None;
            }
        }
        Some(Self {
            filter,
            _haak: haak,
            _events: events,
            binnen,
            links: BTreeMap::new(),
        })
    }

    /// Maakt de poorten en links gelijk aan `bronnen` (de ids van alle
    /// MIDI-uitgangen). `eigen` zijn de poorten van onze node zoals het
    /// register ze kent: `in_<bron>` → poort-id, nodig om te kunnen linken.
    pub fn stem_af(
        &mut self,
        core: &pw::core::CoreRc,
        bronnen: &[u32],
        knoop: Option<u32>,
        eigen: &BTreeMap<String, u32>,
    ) {
        let mut b = self.binnen.borrow_mut();
        // Weg wat weg is.
        b.poorten.retain(|p| {
            let blijft = bronnen.contains(&p.bron);
            if !blijft {
                // SAFETY: `data` kwam van pw_filter_add_port op dit filter, en
                // process draait niet nu (zelfde draad).
                unsafe { pw_sys::pw_filter_remove_port(p.data) };
            }
            blijft
        });
        self.links.retain(|bron, _| bronnen.contains(bron));
        let Binnen { poorten, activiteit, .. } = &mut *b;
        activiteit.retain(|bron, _| bronnen.contains(bron));

        // Nieuw wat nieuw is.
        for &bron in bronnen {
            if !poorten.iter().any(|p| p.bron == bron) {
                let props = pw::properties::properties! {
                    *pw::keys::FORMAT_DSP => "8 bit raw midi",
                    *pw::keys::PORT_NAME => format!("in_{bron}"),
                };
                // SAFETY: het filter leeft; de props gaan naar PipeWire.
                let data = unsafe {
                    pw_sys::pw_filter_add_port(
                        self.filter,
                        spa::utils::Direction::Input.as_raw(),
                        pw_sys::pw_filter_port_flags_PW_FILTER_PORT_FLAG_MAP_BUFFERS,
                        std::mem::size_of::<usize>(),
                        props.into_raw(),
                        ptr::null_mut(),
                        0,
                    )
                };
                if !data.is_null() {
                    poorten.push(Poort { bron, data });
                }
            }
            // Linken zodra het register onze poort kent.
            if self.links.contains_key(&bron) {
                continue;
            }
            let (Some(knoop), Some(poort)) = (knoop, eigen.get(&format!("in_{bron}"))) else {
                continue;
            };
            let props = pw::properties::properties! {
                "link.output.port" => bron.to_string(),
                "link.input.node" => knoop.to_string(),
                "link.input.port" => poort.to_string(),
            };
            if let Ok(link) = core.create_object::<pw::link::Link>("link-factory", &props) {
                self.links.insert(bron, link);
            }
        }
    }

    /// Wat er sinds de vorige keer binnenkwam, en weer bij nul beginnen.
    pub fn oogst(&self) -> BTreeMap<u32, Activiteit> {
        std::mem::take(&mut self.binnen.borrow_mut().activiteit)
    }
}

impl Drop for MidiMeter {
    fn drop(&mut self) {
        self.links.clear();
        // SAFETY: het filter leeft nog en process draait niet (zelfde draad).
        unsafe {
            pw_sys::pw_filter_disconnect(self.filter);
            pw_sys::pw_filter_destroy(self.filter);
        }
    }
}

unsafe extern "C" fn bij_process(data: *mut c_void, positie: *mut spa::sys::spa_io_position) {
    // SAFETY: `data` is de `RefCell<Binnen>` uit `maak`, die leeft tot Drop.
    let binnen = unsafe { &*data.cast::<RefCell<Binnen>>() };
    let Ok(mut b) = binnen.try_borrow_mut() else {
        return;
    };
    // Wanneer elk event gebeurde: het einde van dit blok is ongeveer nu, en
    // een event ligt `duur - offset` samples daarvoor.
    let nu = Instant::now();
    let (duur, rate) = if positie.is_null() {
        (0, 48_000)
    } else {
        // SAFETY: PipeWire geeft een geldige positie mee.
        unsafe { ((*positie).clock.duration, (*positie).clock.rate.denom.max(1)) }
    };
    let wanneer = |offset: u32| {
        let terug = duur.saturating_sub(u64::from(offset)) as f64 / f64::from(rate);
        nu.checked_sub(Duration::from_secs_f64(terug)).unwrap_or(nu)
    };
    let Binnen { poorten, activiteit, opnemer, klok } = &mut *b;
    let mut op = opnemer.try_borrow_mut().ok();
    let mut klok = klok.try_borrow_mut().ok();
    for p in poorten.iter() {
        // SAFETY: `p.data` is een levende poort van dit filter.
        let buf = unsafe { pw_sys::pw_filter_dequeue_buffer(p.data) };
        if buf.is_null() {
            continue;
        }
        // SAFETY: een gedequeuede buffer heeft een spa_buffer; de andere kant
        // is een ander proces, dus offset en grootte worden begrensd.
        unsafe {
            let sb = (*buf).buffer;
            if !sb.is_null() && (*sb).n_datas > 0 {
                let d = &*(*sb).datas;
                if !d.data.is_null() && !d.chunk.is_null() {
                    let c = &*d.chunk;
                    let (o, n) = (c.offset as usize, c.size as usize);
                    if o.saturating_add(n) <= d.maxsize as usize {
                        let bytes = std::slice::from_raw_parts(d.data.cast::<u8>().add(o), n);
                        let a = activiteit.entry(p.bron).or_default();
                        lees_sequentie(bytes, |offset, soort, w| {
                            tel(a, soort, w);
                            let Some(raw) = als_bytes(soort, w) else { return };
                            let t = wanneer(offset);
                            // De klok volgen, en Start/Stop doorgeven.
                            if let Some(k) = klok.as_deref_mut().filter(|k| k.bron == Some(p.bron)) {
                                match raw.first() {
                                    Some(0xf8) => {
                                        k.puls(t);
                                        if let Some(a) = op.as_deref_mut().and_then(|o| o.as_mut()) {
                                            let s = a.sinds(t);
                                            a.pulsen.push(s);
                                        }
                                    }
                                    Some(0xfa | 0xfb) if k.start_stop => k.verzoek = Some(true),
                                    Some(0xfc) if k.start_stop => k.verzoek = Some(false),
                                    _ => {}
                                }
                            }
                            if let Some(a) = op.as_deref_mut().and_then(|o| o.as_mut()) {
                                if let Some(&spoor) = a.midi.get(&p.bron) {
                                    let s = a.sinds(t);
                                    a.midi_events.push((spoor, s, raw));
                                }
                            }
                        });
                    }
                }
            }
            pw_sys::pw_filter_queue_buffer(p.data, buf);
        }
    }
}

fn u32_op(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_ne_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

/// Een control als MIDI 1.0-bytes, ook als hij als UMP binnenkwam.
fn als_bytes(ctype: u32, w: &[u8]) -> Option<Vec<u8>> {
    match ctype {
        SPA_CONTROL_MIDI => Some(w.to_vec()),
        SPA_CONTROL_UMP => {
            let woord = u32_op(w, 0)?;
            let status = (woord >> 16) as u8;
            let (d1, d2) = ((woord >> 8) as u8 & 0x7f, woord as u8 & 0x7f);
            match (woord >> 28, status & 0xf0) {
                (0x1, _) if status >= 0xf8 => Some(vec![status]),
                (0x2, 0xc0 | 0xd0) => Some(vec![status, d1]),
                (0x2, _) => Some(vec![status, d1, d2]),
                _ => None,
            }
        }
        _ => None,
    }
}

/// Loopt een SPA-sequence-pod af, zoals miau-core's `for_each_control`.
fn lees_sequentie(pod: &[u8], mut f: impl FnMut(u32, u32, &[u8])) {
    let (Some(grootte), Some(soort)) = (u32_op(pod, 0), u32_op(pod, 4)) else {
        return;
    };
    if soort != spa::sys::SPA_TYPE_Sequence {
        return;
    }
    let eind = (8 + grootte as usize).min(pod.len());
    let mut c = 16;
    while c + 16 <= eind {
        let (Some(offset), Some(ctype), Some(n)) = (u32_op(pod, c), u32_op(pod, c + 4), u32_op(pod, c + 8)) else {
            break;
        };
        let start = c + 16;
        let n = n as usize;
        if start + n > eind {
            break;
        }
        f(offset, ctype, &pod[start..start + n]);
        c = start + n.next_multiple_of(8);
    }
}

/// Telt één control mee. Legacy-bytes en UMP komen op dezelfde drie bytes uit.
fn tel(a: &mut Activiteit, ctype: u32, w: &[u8]) {
    let (status, d1, d2) = match ctype {
        SPA_CONTROL_MIDI => match w {
            [s, d1, d2, ..] => (*s, *d1, *d2),
            [s, d1] => (*s, *d1, 0),
            [s] => (*s, 0, 0),
            _ => return,
        },
        SPA_CONTROL_UMP => {
            let Some(woord) = u32_op(w, 0) else { return };
            match woord >> 28 {
                0x1 | 0x2 => ((woord >> 16) as u8, (woord >> 8) as u8 & 0x7f, woord as u8 & 0x7f),
                _ => return,
            }
        }
        _ => return,
    };
    a.events = a.events.saturating_add(1);
    if status >= 0xf0 {
        match status {
            0xf8 => a.soorten |= CLK,
            0xfa => a.laatste = Some("Start".into()),
            0xfb => a.laatste = Some("Continue".into()),
            0xfc => a.laatste = Some("Stop".into()),
            _ => {}
        }
        return;
    }
    a.kanalen |= 1 << (status & 0x0f);
    a.laatste = Some(match status & 0xf0 {
        0x90 if d2 > 0 => {
            a.soorten |= NOTE;
            format!("Note On {} · vel {d2}", noot(d1))
        }
        0x80 | 0x90 => {
            a.soorten |= NOTE;
            format!("Note Off {}", noot(d1))
        }
        0xb0 => {
            a.soorten |= CC;
            format!("CC {d1} = {d2}")
        }
        0xe0 => {
            a.soorten |= PB;
            let v = ((d2 as i32) << 7 | d1 as i32) - 8192;
            format!("PB {v:+}")
        }
        0xa0 => format!("Aftertouch {}", noot(d1)),
        0xc0 => format!("Program {}", d1 + 1),
        0xd0 => format!("Pressure {d1}"),
        _ => return,
    });
}

/// 64 → "E4" (middelste C = C4).
fn noot(n: u8) -> String {
    const NAMEN: [&str; 12] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    format!("{}{}", NAMEN[(n % 12) as usize], n as i32 / 12 - 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noten_en_berichten() {
        let mut a = Activiteit::default();
        tel(&mut a, SPA_CONTROL_MIDI, &[0x90, 64, 76]);
        assert_eq!(a.laatste.as_deref(), Some("Note On E4 · vel 76"));
        tel(&mut a, SPA_CONTROL_MIDI, &[0xf8]);
        assert_eq!(a.laatste.as_deref(), Some("Note On E4 · vel 76"));
        tel(&mut a, SPA_CONTROL_MIDI, &[0xb9, 21, 64]);
        assert_eq!(a.laatste.as_deref(), Some("CC 21 = 64"));
        assert_eq!(a.kanalen, 1 | 1 << 9);
        assert_eq!(a.soorten, NOTE | CLK | CC);
        assert_eq!(a.events, 3);
        // UMP: type 2, groep 0, Note Off kanaal 2, C3.
        tel(&mut a, SPA_CONTROL_UMP, &0x2081_3000u32.to_ne_bytes());
        assert_eq!(a.laatste.as_deref(), Some("Note Off C3"));
        assert_eq!(a.kanalen & 2, 2);
    }
}
