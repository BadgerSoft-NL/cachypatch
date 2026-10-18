//! De graph zoals CachyPatch hem ziet, als JSON op stdout. Schrijft niets.
//!
//! `cargo run --example graaf`

use std::sync::mpsc;
use std::time::Duration;

use cachypatch_lib::graaf::{Graaf, Melding};

fn main() {
    let (tx, rx) = mpsc::channel();
    let _g = Graaf::start(Box::new(move |m| {
        if let Melding::Graaf(m) = m {
            let _ = tx.send(m.clone());
        }
    }));
    // De eerste melding na het verbinden is al compleet, maar de node-info
    // druppelt na; even wachten tot het stil is.
    let mut laatste = None;
    while let Ok(m) = rx.recv_timeout(Duration::from_millis(500)) {
        laatste = Some(m);
    }
    println!("{}", serde_json::to_string_pretty(&laatste).unwrap());
}
