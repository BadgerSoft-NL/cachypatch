# CachyPatch

A patchbay and mixer for PipeWire on Linux. A tidier successor to qpwgraph,
and a sibling of [CachyMix](https://github.com/BadgerSoft-NL/cachymix-rme-ff-400).

CachyPatch is a plain PipeWire client: it reads nodes, ports and links, and
(soon) makes and removes links. WirePlumber stays in charge of policy; you
reach for CachyPatch when you want to deviate from what it auto-connects —
for example to record Spotify, a browser tab and a microphone at once.

## Status

Early. What works now:

- Live view of the PipeWire graph, reconnecting when the server restarts.
- Audio and MIDI patchbays, ordered: sources on the left, destinations on the
  right. Modules can be dragged; **Rearrange** puts them back.
- ALSA MIDI devices and apps are split out of the Midi-Bridge, one module each.
- Monitor ports and Midi Through are hidden.

Planned, per the design: making and removing links, an audio and a MIDI
mixer in TotalMix "edit mix" style, level and MIDI activity meters, and a
recorder (mixdown and multitrack WAV, Standard MIDI File) with internal or
external MIDI clock.

## Building

Needs Rust, Node.js, and the PipeWire development headers plus clang
(for `pipewire-rs`).

```bash
npm install
npm run tauri dev
```

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
