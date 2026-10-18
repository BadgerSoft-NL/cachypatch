//! Twee seconden lang de pieken per node, in dBFS. Schrijft niets.
//!
//! `cargo run --example meters`

use std::sync::mpsc;
use std::time::{Duration, Instant};

use pecanpatch_lib::graaf::{Graaf, Melding};

fn main() {
    let (tx, rx) = mpsc::channel();
    let g = Graaf::start(Box::new(move |m| {
        if let Melding::Pieken(p) = m {
            let _ = tx.send(p.clone());
        }
    }));
    let mut hoogste = std::collections::BTreeMap::<u32, Vec<f32>>::new();
    let eind = Instant::now() + Duration::from_secs(3);
    while let Ok(p) = rx.recv_timeout(eind.saturating_duration_since(Instant::now())) {
        for (id, v) in p {
            let h = hoogste.entry(id).or_insert_with(|| vec![0.0; v.len()]);
            h.resize(v.len(), 0.0);
            for (a, b) in h.iter_mut().zip(v) {
                *a = a.max(b);
            }
        }
    }
    let nu = g.nu();
    for (id, v) in hoogste {
        let naam = nu.knopen.iter().find(|k| k.id == id).map(|k| k.naam.clone()).unwrap_or_default();
        let db: Vec<String> = v
            .iter()
            .map(|x| if *x > 0.0 { format!("{:.0}", 20.0 * x.log10()) } else { "-∞".into() })
            .collect();
        println!("{naam}: {}", db.join(" "));
    }
    println!("knopen in graph: {}, met pecanpatch-meter in naam: {}", nu.knopen.len(),
        nu.knopen.iter().filter(|k| k.naam.starts_with("pecanpatch")).count());
}
