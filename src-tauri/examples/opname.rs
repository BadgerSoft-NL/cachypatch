//! Proefopname: geeft de Rec bus drie kanalen, routeert de stream
//! `cp-test-sinus` naar de stereobus Rec 1-2 en zijn linkerkanaal naar de
//! monobus Rec 3 (op halve gain), en MIDI-poort `midi_out_0` naar de
//! MIDI-ingang. Neemt drie seconden op en stopt. Met `extern` volgt hij de
//! MIDI Clock van `midi_out_0`. Voor de ontwikkeling.
//!
//! `cargo run --example opname [extern]`

use std::sync::mpsc;
use std::time::Duration;

use pecanpatch_lib::graaf::{BusOpname, Graaf, Melding, Momentopname, Opdracht, Opties, TransportStand};

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
    let g0 = wacht(1500);
    let _ = g0;
    g.doe(Opdracht::ZetBus { kanalen: 3, gain: vec![1.0, 1.0, 0.5] });
    // Wachten tot de derde ingang er is.
    let mut m = wacht(300);
    for _ in 0..20 {
        if m.poorten.iter().any(|p| p.naam == "rec_3") {
            break;
        }
        m = wacht(200);
    }
    // De bus met drie ingangen: de app kan ook draaien, met een eigen bus.
    let bus = m
        .knopen
        .iter()
        .filter(|k| k.naam == "pecanpatch-opname")
        .find(|k| m.poorten.iter().any(|p| p.knoop == k.id && p.naam == "rec_3"))
        .expect("Rec bus met drie kanalen");
    let sinus = m.knopen.iter().find(|k| k.naam == "cp-test-sinus").expect("cp-test-sinus");
    let volg_klok = std::env::args().any(|a| a == "extern");
    let klok = m.poorten.iter().find(|p| p.naam == "midi_out_0" && !p.ingang).map(|p| p.id).filter(|_| volg_klok);
    let poort = |knoop: u32, ingang: bool, naam: &str| {
        m.poorten.iter().find(|p| p.knoop == knoop && p.ingang == ingang && p.naam == naam).map(|p| p.id)
    };
    for (uit, naar) in [("output_FL", "rec_1"), ("output_FR", "rec_2"), ("output_FL", "rec_3")] {
        g.doe(Opdracht::Verbind { uit: poort(sinus.id, false, uit).unwrap(), naar: poort(bus.id, true, naar).unwrap() });
    }
    if let Some(midi) = m.poorten.iter().find(|p| p.naam == "midi_out_0" && !p.ingang) {
        g.doe(Opdracht::Verbind { uit: midi.id, naar: poort(bus.id, true, "midi_in").unwrap() });
    }
    wacht(800);
    g.doe(Opdracht::ZetTransport(Opties {
        bussen: vec![
            BusOpname { naam: "Rec 1-2".into(), kanalen: vec![0, 1] },
            BusOpname { naam: "Rec 3".into(), kanalen: vec![2] },
        ],
        midi: true,
        klok,
        start_stop: false,
    }));
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
