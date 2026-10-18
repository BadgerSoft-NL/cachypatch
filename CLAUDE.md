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
  gebonden omdat `application.name`, `media.name` en de Props (volume, mute)
  alleen daar staan. Valt de server weg, dan verbindt hij na 2 s opnieuw.
  Wijzigen gaat via `Opdracht`: link leggen (`object.linger`, blijft na
  sluiten) of weghalen, `target.object` zetten/wissen, volume, mute. Geen
  beleid.
- `src/indeling.ts` — van graph naar modules: links wat levert, rechts wat
  ontvangt, een node met beide wordt twee modules. Monitors en Midi Through
  verborgen. De Midi-Bridge is één node met alle ALSA-MIDI erin; die wordt per
  `port.group` (ALSA-client) gesplitst, clients ≥ 128 zijn apps.
- `src/Patchbay.tsx` — vaste maten, dus poortposities zijn rekenwerk en geen
  DOM-meting. Van stip naar stip slepen = link, klik op kabel = weg. Geen
  groepskopjes: modules zijn versleepbaar. Plekken alleen in het geheugen.
- `src/mixer.ts` — het "edit mix"-model. Hardware met AUX-kanalen wordt in
  stereoparen geknipt. Route bron→bestemming: geen links = uit, precies de
  verwachte (FL→FL, of op volgorde) = aan, al het andere = aangepast (alleen
  tonen, klik opent de patchbay). "manual" = een link niet van WirePlumber
  (`client.id`) of een `target.object` op een van beide nodes.
  Aanzetten: stream zonder routes naar een hele node (of het eerste paar) →
  `target.object`; anders handmatige links. Uitzetten: links weg en een doel
  dat ernaar wees wissen.
- `src/Mixer.tsx` — de strips; fader is de faderwet van CachyMix. Mute van een
  paar (geen hele node) gaat via volume 0. Verborgen strips in `localStorage`.
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
cargo run --example proef -- <stream> <sink>   # probeert alle opdrachten op een stream
```

Zonder Tauri bootst `api.ts` WirePlumber na, zodat de mixer in de browser te
testen is. Een echte graph in de schil zonder Tauri: schrijf de uitvoer van het voorbeeld
naar `src-tauri/target/echt.json` en open
`http://localhost:1420/?graaf=/src-tauri/target/echt.json`.

## Hoe WirePlumber 0.5 reageert (geverifieerd, 18 okt 2026)

- `target.object` werkt met de **serial** als gewone string; met een
  JSON-gequote `node.name` gebeurt niets.
- `target.object = -1` koppelt niet los maar zet terug naar de standaard.
- Alleen wissen doet niets met een stream die los staat. Terug naar auto =
  eerst `-1`, dan wissen.
- Links van WirePlumber weghalen: hij legt ze niet terug. Zo zet de mixer een
  route uit.
- Stream-naar-stream via `target.object` werkt (recorder volgt speler).
- Een doel wordt niet per app onthouden (`~/.local/state/wireplumber`).
- MIDI komt hier als `8 bit raw midi`, niet als UMP.

Zelf proberen zonder je eigen audio te raken: `pw-play --volume 0` op een
stille WAV en `cargo run --example proef -- <stream> <sink>`.

## Nog te verifiëren

- Legt WirePlumber echt geen MIDI-links?
