//! Proefopname: routeert de stream `cp-test-sinus` en MIDI-poort
//! `midi_out_0` naar de Rec bus, neemt drie seconden op en stopt. Met
//! `extern` volgt hij de MIDI Clock van `midi_out_0`. Voor de ontwikkeling.
//!
//! `cargo run --example opname [extern]`

use std::sync::mpsc;
use std::time::Duration;

use cachypatch_lib::graaf::{Graaf, Melding, Momentopname, Opdracht, Opties, TransportStand};

fn main() {
    let (tx, rx) = mpsc::channel::<Momentopname>();
    let (ttx, trx) = mpsc::channel::<TransportStand>();
    let g = Graaf::start(Box::new(move |m| match m {
        Melding::Graaf(m) => drop(tx.send(m.clone())),
        Melding::Transport(t) => drop(ttx.send(t.clone())),
        _ => {}
    }));
    let wacht = |d| {
        std::thread::sleep(Duration::from_millis(d));
        while rx.try_recv().is_ok() {}
        g.nu()
    };
    let m = wacht(1500);
    let bus = m.knopen.iter().find(|k| k.naam == "cachypatch-opname").expect("Rec bus");
    let sinus = m.knopen.iter().find(|k| k.naam == "cp-test-sinus").expect("cp-test-sinus");
    let volg_klok = std::env::args().any(|a| a == "extern");
    let klok = m.poorten.iter().find(|p| p.naam == "midi_out_0" && !p.ingang).map(|p| p.id).filter(|_| volg_klok);
    let poort = |knoop: u32, ingang: bool, naam: &str| {
        m.poorten.iter().find(|p| p.knoop == knoop && p.ingang == ingang && p.naam == naam).map(|p| p.id)
    };
    for (uit, naar) in [("output_FL", "input_FL"), ("output_FR", "input_FR")] {
        g.doe(Opdracht::Verbind { uit: poort(sinus.id, false, uit).unwrap(), naar: poort(bus.id, true, naar).unwrap() });
    }
    if let Some(midi) = m.poorten.iter().find(|p| p.naam == "midi_out_0" && !p.ingang) {
        g.doe(Opdracht::Verbind { uit: midi.id, naar: poort(bus.id, true, "midi_in").unwrap() });
    }
    wacht(800);
    g.doe(Opdracht::ZetTransport(Opties { mixdown: true, multitrack: true, midi: true, klok, start_stop: false }));
    g.doe(Opdracht::Start);
    std::thread::sleep(Duration::from_secs(3));
    while let Ok(t) = trx.try_recv() {
        if volg_klok {
            println!("klok tijdens opname: {:?}", t.klok);
        }
    }
    g.doe(Opdracht::Stop);
    std::thread::sleep(Duration::from_millis(1500));
    let mut laatste = None;
    while let Ok(t) = trx.try_recv() {
        laatste = Some(t);
    }
    println!("{laatste:?}");
}
