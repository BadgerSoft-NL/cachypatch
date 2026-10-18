//! Proeft de opdrachten op een stream met deze `node.name`: verplaatsen,
//! een extra link, weghalen, volume. Voor de ontwikkeling, niet voor gebruik.
//!
//! `cargo run --example proef -- <node.name> <node.name van een sink>`

use std::sync::mpsc;
use std::time::Duration;

use cachypatch_lib::graaf::{Graaf, Melding, Momentopname, Opdracht};

fn main() {
    let mut args = std::env::args().skip(1);
    let (stream, sink) = (args.next().expect("stream"), args.next().expect("sink"));
    let (tx, rx) = mpsc::channel::<Momentopname>();
    let g = Graaf::start(Box::new(move |m| {
        if let Melding::Graaf(m) = m {
            let _ = tx.send(m.clone());
        }
    }));
    let wacht = || {
        let mut m = None;
        while let Ok(n) = rx.recv_timeout(Duration::from_millis(600)) {
            m = Some(n);
        }
        m.unwrap_or_else(|| g.nu())
    };
    let toon = |m: &Momentopname, wat: &str| {
        let s = m.knopen.iter().find(|k| k.naam == stream).expect("stream");
        let naar: Vec<_> = m
            .kabels
            .iter()
            .filter(|k| k.uit_knoop == s.id)
            .map(|k| {
                let n = m.knopen.iter().find(|n| n.id == k.in_knoop).map(|n| n.naam.as_str());
                let wp = k.client.is_some_and(|c| m.wireplumber.contains(&c));
                format!("{}{}", n.unwrap_or("?"), if wp { " (wp)" } else { " (hand)" })
            })
            .collect();
        println!("{wat}: doel={:?} volume={:?} mute={:?} → {naar:?}", s.doel, s.volume, s.mute);
    };
    let m = wacht();
    toon(&m, "begin");
    let s = m.knopen.iter().find(|k| k.naam == stream).unwrap().clone();
    let d = m.knopen.iter().find(|k| k.naam == sink).unwrap().clone();
    let poort = |knoop: u32, ingang: bool, kanaal: &str| {
        m.poorten
            .iter()
            .find(|p| p.knoop == knoop && p.ingang == ingang && p.kanaal.as_deref() == Some(kanaal))
            .map(|p| p.id)
            .unwrap()
    };

    for kanaal in ["FL", "FR"] {
        g.doe(Opdracht::Verbind { uit: poort(s.id, false, kanaal), naar: poort(d.id, true, kanaal) });
    }
    let m = wacht();
    toon(&m, "extra link");

    for k in m.kabels.iter().filter(|k| k.uit_knoop == s.id && k.in_knoop == d.id) {
        g.doe(Opdracht::Ontkoppel { kabel: k.id });
    }
    toon(&wacht(), "weer weg");

    g.doe(Opdracht::ZetDoel { knoop: s.id, doel: d.serial.map(|n| n.to_string()) });
    toon(&wacht(), "verplaatst");
    g.doe(Opdracht::ZetDoel { knoop: s.id, doel: Some("-1".into()) });
    wacht();
    g.doe(Opdracht::ZetDoel { knoop: s.id, doel: None });
    toon(&wacht(), "terug naar auto");

    g.doe(Opdracht::ZetVolume { knoop: s.id, volume: vec![0.5, 0.25] });
    g.doe(Opdracht::ZetMute { knoop: s.id, mute: true });
    toon(&wacht(), "volume");
}
