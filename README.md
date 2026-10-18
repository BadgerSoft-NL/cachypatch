# CachyPatch

A patchbay and mixer for PipeWire on Linux. A tidier successor to qpwgraph,
and a sibling of [CachyMix](https://github.com/BadgerSoft-NL/cachymix-rme-ff-400).

CachyPatch is a plain PipeWire client: it reads nodes, ports and links, and
makes and removes links. WirePlumber stays in charge of policy; you
reach for CachyPatch when you want to deviate from what it auto-connects —
for example to record Spotify, a browser tab and a microphone at once.

## Status

Early. What works now:

- **Audio mixer** in TotalMix "edit mix" style: pick a destination with
  *edit*, then switch each app or input on or off for it. Moving a stream uses
  `target.object`, like pavucontrol; extra routes become links. Patches the
  mixer can't show as on/off are marked *custom* and left alone. **Back to
  auto** removes every manual route and hands control back to WirePlumber.
  Faders set the stream's own volume; level meters show what each source and
  destination carries.
- **MIDI mixer** in the same style, with a MIDI meter per port instead of a
  fader: activity LED, events per second, the sixteen channels, message types
  (note, CC, pitch bend, clock) and the last event.
- **Audio and MIDI patchbays**, ordered: sources on the left, destinations on
  the right, with mini level meters and per-port MIDI activity. Drag between dots to connect, click a cable to disconnect. Modules
  can be dragged; **Rearrange** puts them back.
- Live view of the PipeWire graph, reconnecting when the server restarts.
- ALSA MIDI devices and apps are split out of the Midi-Bridge, one module each.
- Monitor ports and Midi Through are hidden.

- **Recorder**: *Rec buses* sit among the destinations, stereo or split into
  two mono buses, and you add more with **+ Bus**. Route sources to them like
  to any other destination, set their level, and arm them with **R**. Every
  armed bus becomes one WAV (32-bit float, sample-aligned), plus a Standard
  MIDI File with one track per MIDI source routed to the bus.
  The clock is internal (120 BPM) or follows an external MIDI Clock, with
  tempo changes written to the file and optional start/stop on MIDI Start.
  Files go to `~/Recordings/YYYY-MM-DD_HHMM/`.

## Building

Needs Rust, Node.js, and the PipeWire development headers plus clang
(for `pipewire-rs`).

```bash
npm install
npm run tauri dev
```

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
