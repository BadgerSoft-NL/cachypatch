# CachyPatch

Patchbay en mixer voor PipeWire, als Tauri-app: React-schil, Rust-kant die
een gewone PipeWire-client is. Betere opvolger van qpwgraph; zusje van
[CachyMix](https://github.com/BadgerSoft-NL/cachymix-rme-ff-400).

Concept en ontwerp staan in Nokta (`CachyPatch.nokta`, notities **Concept** en
**Screenshots**). De bronnen van de vier ontwerpschermen staan in
`docs/ontwerp/project/*.dc.html`: kleuren en maten komen daaruit.

## Uitgangspunten

- **Niet tegen WirePlumber in zwemmen.** WirePlumber doet het beleid; CachyPatch
  is er voor als je ervan wilt afwijken.
- Routes verplaatsen via `target.object` in de `default`-metadata, zoals
  pavucontrol. Handmatige links alleen waar dat niet volstaat.
- **Routing is puur live.** Niets opslaan of herstellen.
- Audio en MIDI strikt gescheiden, elk met een mixer- en een patchbay-view.
  Mixer en patchbay tonen dezelfde graph.

## Hoe het in elkaar zit

- `src-tauri/src/graaf.rs` — eigen draad met eigen PipeWire-verbinding. Spiegelt
  nodes, poorten, links en de `default`/`settings`-metadata, en meldt hooguit
  25× per seconde een complete `Momentopname` (event `graaf`). Nodes worden
  gebonden omdat `application.name` en `media.name` alleen in de node-info
  staan. Valt de server weg, dan verbindt hij na 2 s opnieuw. Geen beleid.
- `src/indeling.ts` — van graph naar modules: links wat levert, rechts wat
  ontvangt, een node met beide wordt twee modules. Monitors en Midi Through
  verborgen. De Midi-Bridge is één node met alle ALSA-MIDI erin; die wordt per
  `port.group` (ALSA-client) gesplitst, clients ≥ 128 zijn apps.
- `src/Patchbay.tsx` — vaste maten, dus poortposities zijn rekenwerk en geen
  DOM-meting. Versleepte plekken alleen in het geheugen.
- Node-ids zijn per sessie; herkennen via `node.name`, `port.name`, serials.

`pipewire` 0.10, dezelfde versie als miau-core (`~/code/miau-core`). Die kan
later de Opname-bus (`io::Client`), MIDI-parsing en SMF leveren, maar is nog
privé en CachyPatch is publiek.

## Twee talen

Wat op het scherm komt is Engels; identifiers, commentaar en commits Nederlands.

## Commando's

```bash
npm run dev                          # alleen de schil, met nagemaakte graph (api.ts)
npm run tauri dev                    # de hele app
npm run tauri build -- --no-bundle   # src-tauri/target/release/cachypatch
cargo run --example graaf            # vanuit src-tauri/: de graph als JSON, schrijft niets
```

Een echte graph in de schil zonder Tauri: schrijf de uitvoer van het voorbeeld
naar `src-tauri/target/echt.json` en open
`http://localhost:1420/?graaf=/src-tauri/target/echt.json`.

## Nog te verifiëren

- Accepteert WirePlumber stream-naar-stream via `target.object`? Zo niet: een
  virtuele sink per opnamebron.
- Levert PipeWire 1.6 MIDI als UMP of als MIDI 1.0-bytes? Op deze machine meldt
  `format.dsp` nu `8 bit raw midi`.
- Legt WirePlumber echt geen MIDI-links?
