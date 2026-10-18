//! Drie seconden MIDI-activiteit per bronpoort. Schrijft niets.
//!
//! `cargo run --example midi`

use std::sync::mpsc;
use std::time::{Duration, Instant};

use pecanpatch_lib::graaf::{Graaf, Melding};

fn main() {
    let (tx, rx) = mpsc::channel();
    let g = Graaf::start(Box::new(move |m| {
        if let Melding::Midi(a) = m {
            let _ = tx.send(a.clone());
        }
    }));
    let eind = Instant::now() + Duration::from_secs(3);
    let mut totaal = std::collections::BTreeMap::new();
    while let Ok(a) = rx.recv_timeout(eind.saturating_duration_since(Instant::now())) {
        for (poort, act) in a {
            let t: &mut (u32, u16, u8, Option<String>) = totaal.entry(poort).or_default();
            t.0 += act.events;
            t.1 |= act.kanalen;
            t.2 |= act.soorten;
            if act.laatste.is_some() {
                t.3 = act.laatste;
            }
        }
    }
    let nu = g.nu();
    for (poort, (n, k, s, l)) in totaal {
        let naam = nu.poorten.iter().find(|p| p.id == poort).map(|p| p.naam.clone()).unwrap_or_default();
        println!("{naam} ({poort}): {n} events, kanalen {k:016b}, soorten {s:04b}, laatste {l:?}");
    }
    println!("knopen met pecanpatch in naam: {}", nu.knopen.iter().filter(|k| k.naam.starts_with("pecanpatch")).count());
}
