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
- `src-tauri/src/meter.rs` — per audio-node een passieve capture-stream
  (`target.object`, bij sinks `stream.capture.sink`) die pieken per kanaal
  verzamelt. Event `pieken`, 25×/s, kanalen in `port.id`-volgorde.
- `src-tauri/src/midimeter.rs` — één `pw_filter`-node met per MIDI-uitgang een
  ingang en een eigen link (zonder linger). Telt events, kanalen, soorten en
  het laatste muzikale event. Event `midi`. Raw `pw_sys`, zoals miau-core.
- `src-tauri/src/opname.rs` — de Rec bus (`cachypatch-opname`, een zichtbare
  `pw_filter`-node met `input_FL`/`input_FR`/`midi_in`, `media.class`
  `Stream/Input/Audio`, `node.autoconnect=false`), de schrijfdraad (`hound`,
  32-bit float) en de klok/MIDI-bestand (`midly`, type 1, 480 PPQ). Mixdown =
  wat op de bus binnenkomt; multitrack komt uit de meter-streams, MIDI per
  bronpoort uit de MIDI-meter. Wat meedoet = wat bij Start naar de bus gaat.
  Uitvoer in `~/Recordings/JJJJ-MM-DD_UUMM/`. Externe klok: pulsen tellen
  (24 ppq) met interpolatie, tempo per tel, nieuw tempo-event bij > 0,5 %
  verschil; lock als de pulsen < 20 % afwijken.
- Eigen nodes heten `cachypatch-meter-…` en blijven met hun poorten en links
  buiten de momentopname.
- `src/indeling.ts` — van graph naar modules: links wat levert, rechts wat
  ontvangt, een node met beide wordt twee modules. Monitors en Midi Through
  verborgen. De Midi-Bridge is één node met alle ALSA-MIDI erin; die wordt per
  `port.group` (ALSA-client) gesplitst, clients ≥ 128 zijn apps.
- `src/Patchbay.tsx` — vaste maten, dus poortposities zijn rekenwerk en geen
  DOM-meting. Van stip naar stip slepen = link (de doelpoort licht op), klik =
  kabel kiezen (Shift erbij), Delete = weg. Bij een ingang pak je een
  bestaande kabel op (de gekozen of de enige) en zet je hem ergens anders
  neer; in het niets loslaten = weg. Audio rood, MIDI geel. Geen
  groepskopjes: modules zijn versleepbaar. Plekken alleen in het geheugen.
- `src/mixer.ts` — het "edit mix"-model. Hardware met AUX-kanalen wordt in
  stereoparen geknipt. Route bron→bestemming: geen links = uit, precies de
  verwachte (FL→FL, of op volgorde) = aan, al het andere = aangepast (alleen
  tonen, klik opent de patchbay). Een link is "auto" als hij ligt waar
  WirePlumber hem zou leggen (stream zonder doel → standaard, eerste paar),
  wie hem ook legde; al het andere is "manual".
  Aanzetten van een losstaande stream: naar zijn WirePlumber-doel legt
  CachyPatch de links zelf, naar een andere hele node gaat het via
  `target.object`; anders handmatige links. Uitzetten: alleen links weg (een
  doel wissen zou de stream meteen terugsturen).
  Back to auto: handmatige links weg, doelen wissen, losstaande streams zelf
  op de standaard zetten.
- `src/geschiedenis.ts`, `src/handelingen.ts` — undo/redo. Elke stap werkt op
  poortparen en de graph van dat moment; stappen zetten een vaste stand
  (niet "keer om"), en undo/redo lopen in een rij met 250 ms ertussen.
- `src/Mixer.tsx` — de strips; fader is de faderwet van CachyMix. Mute van een
  paar (geen hele node) gaat via volume 0. Verborgen strips in `localStorage`.
- `src/meters.ts` — één animatielus zet de meterbalkjes direct in de DOM
  (−60…0 dBFS, val 24 dB/s, piek 1 s), zodat React niet 25×/s hertekent.
- `src/midi.ts`, `src/MidiMeter.tsx` — MIDI-activiteit met 150 ms nagloei; een
  bestemming toont de samengevoegde activiteit van wat erheen gaat.
- `src/Transport.tsx` — de transportbalk in beide mixers; keuzes in
  `localStorage` (de klokpoort niet: ids gelden één sessie).
- `src/MidiMixer.tsx` — edit-mix per MIDI-poort; aan/uit = link leggen/weghalen.
  "Disconnect all" in plaats van "Back to auto".
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
cargo run --example meters           # drie seconden pieken per node
cargo run --example midi             # drie seconden MIDI-activiteit per poort
cargo run --example opname [extern]  # proefopname van cp-test-sinus en midi_out_0
```

Zonder Tauri bootst `api.ts` WirePlumber na, zodat de mixer in de browser te
testen is. Een echte graph in de schil zonder Tauri: schrijf de uitvoer van het voorbeeld
naar `src-tauri/target/echt.json` en open
`http://localhost:1420/?graaf=/src-tauri/target/echt.json`.

## Hoe WirePlumber 0.5 reageert (geverifieerd, 18 okt 2026)

- `target.object` werkt met de **serial** als gewone string; met een
  JSON-gequote `node.name` gebeurt niets.
- Een `target.object` dat niet verandert doet niets, ook als de stream intussen
  los staat. Wissen na een echt doel zet hem terug op de standaard.
- `-1` zet terug naar de standaard, maar niet meer zodra er een andere link aan
  de stream hangt (zoals onze meter). Daarom gebruikt CachyPatch het niet.
- Links van WirePlumber weghalen: hij legt ze niet terug. Zo zet de mixer een
  route uit.
- Stream-naar-stream via `target.object` werkt (recorder volgt speler).
- Een doel wordt niet per app onthouden (`~/.local/state/wireplumber`).
- MIDI komt hier als `8 bit raw midi`, niet als UMP.
- WirePlumber linkt een MIDI-stream nergens heen (`pw-midiplay`: "no target
  node available", ook met de Midi-Bridge als doel).
- Een passieve meter houdt een gesuspende sink (HDMI) niet wakker.

Zelf proberen zonder je eigen audio te raken: `pw-play --volume 0` op een
stille WAV en `cargo run --example proef -- <stream> <sink>`.

Opnemen testen zonder geluid: `pw-play -P '{ node.name = cp-test-sinus
node.autoconnect = false }' sinus.wav` plus miau-core's `midi_out`, dan
`cargo run --example opname [extern]`.

Let op: WirePlumber onthoudt volume en mute **per applicatie**
(`~/.local/state/wireplumber/stream-properties`). Wie met `proef` op een
`pw-play`-stream test, verandert dus het volume van elke volgende `pw-play`.

MIDI testen zonder je apparaten: `target/debug/examples/midi_out` uit
miau-core geeft een arpeggio op een eigen poort; `cargo run --example midi`
toont wat de meter ziet.
