// De brug naar de Rust-kant. Zonder Tauri (npm run dev in een gewone browser)
// valt alles terug op een nagemaakte graph, zodat de schil te bekijken is
// zonder PipeWire.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Soort = "audio" | "midi" | "anders";

export interface Knoop {
  id: number;
  serial: number | null;
  naam: string;
  beschrijving: string | null;
  bijnaam: string | null;
  klasse: string | null;
  /** `device.id`: de node hoort bij een apparaat (een geluidskaart, HDMI). */
  apparaat: number | null;
  app: string | null;
  media: string | null;
  stand: "running" | "idle" | "suspended" | "creating" | "error" | null;
}

export interface Poort {
  id: number;
  knoop: number;
  volgnummer: number | null;
  naam: string;
  alias: string | null;
  ingang: boolean;
  soort: Soort;
  kanaal: string | null;
  monitor: boolean;
  fysiek: boolean;
  groep: string | null;
}

export interface Kabel {
  id: number;
  uit_knoop: number;
  uit_poort: number;
  in_knoop: number;
  in_poort: number;
}

export interface Graaf {
  verbonden: boolean;
  rate: number | null;
  quantum: number | null;
  standaard_sink: string | null;
  standaard_bron: string | null;
  knopen: Knoop[];
  poorten: Poort[];
  kabels: Kabel[];
}

export const LEEG: Graaf = {
  verbonden: false,
  rate: null,
  quantum: null,
  standaard_sink: null,
  standaard_bron: null,
  knopen: [],
  poorten: [],
  kabels: [],
};

const inTauri = "__TAURI_INTERNALS__" in window;

/** Roept `bij` aan met de huidige graph en daarna met elke verandering. */
export function volgGraaf(bij: (g: Graaf) => void): () => void {
  if (!inTauri) {
    // ?graaf=/pad/naar.json laadt een echte momentopname, zoals
    // `cargo run --example graaf` die schrijft.
    const bestand = new URLSearchParams(location.search).get("graaf");
    if (bestand) {
      fetch(bestand)
        .then((r) => r.json())
        .then(bij);
    } else {
      bij(nepGraaf());
    }
    return () => {};
  }
  let weg = false;
  let stop: (() => void) | undefined;
  listen<Graaf>("graaf", (e) => bij(e.payload)).then((s) => {
    if (weg) s();
    else stop = s;
  });
  invoke<Graaf>("haal_graaf").then((g) => {
    if (!weg) bij(g);
  });
  return () => {
    weg = true;
    stop?.();
  };
}

// --- De nagemaakte graph, ongeveer die van de ontwerpschermen ---

function nepGraaf(): Graaf {
  const knopen: Knoop[] = [];
  const poorten: Poort[] = [];
  const kabels: Kabel[] = [];
  let id = 100;

  const knoop = (k: Partial<Knoop> & { naam: string }) => {
    const n: Knoop = {
      id: id++,
      serial: null,
      beschrijving: null,
      bijnaam: null,
      klasse: null,
      apparaat: null,
      app: null,
      media: null,
      stand: "running",
      ...k,
    };
    n.serial = n.id;
    knopen.push(n);
    return n;
  };
  const poort = (k: Knoop, naam: string, ingang: boolean, p: Partial<Poort> = {}) => {
    const r: Poort = {
      id: id++,
      knoop: k.id,
      volgnummer: poorten.filter((x) => x.knoop === k.id).length,
      naam,
      alias: null,
      ingang,
      soort: "audio",
      kanaal: null,
      monitor: false,
      fysiek: false,
      groep: null,
      ...p,
    };
    poorten.push(r);
    return r;
  };
  const kabel = (uit: Poort, naar: Poort) =>
    kabels.push({
      id: id++,
      uit_knoop: uit.knoop,
      uit_poort: uit.id,
      in_knoop: naar.knoop,
      in_poort: naar.id,
    });
  const stereo = (k: Knoop, voor: string, ingang: boolean) =>
    ["FL", "FR"].map((c) => poort(k, `${voor}_${c}`, ingang, { kanaal: c }));

  const ff = "alsa_output.firewire-0x000a35011d39c945.pro-output-0";
  const ffUit = knoop({ naam: ff, beschrijving: "Fireface 400 Pro", bijnaam: "Fireface400 PCM", klasse: "Audio/Sink", apparaat: 47 });
  const ffOut = [0, 1, 2, 3].map((i) =>
    poort(ffUit, `playback_AUX${i}`, true, { kanaal: `AUX${i}`, fysiek: true }),
  );
  [0, 1, 2, 3].forEach((i) =>
    poort(ffUit, `monitor_AUX${i}`, false, { kanaal: `AUX${i}`, monitor: true }),
  );
  const ffIn = knoop({
    naam: "alsa_input.firewire-0x000a35011d39c945.pro-input-0",
    beschrijving: "Fireface 400 Pro",
    bijnaam: "Fireface400 PCM",
    klasse: "Audio/Source",
    apparaat: 47,
  });
  const ffCap = [0, 1, 2, 3].map((i) =>
    poort(ffIn, `capture_AUX${i}`, false, { kanaal: `AUX${i}`, fysiek: true }),
  );
  const hdmi = knoop({
    naam: "alsa_output.pci-0000_0f_00.1.hdmi-stereo-extra3",
    beschrijving: "Radeon High Definition Audio Controller Digital Stereo (HDMI 4) [LG ULTRAFINE]",
    bijnaam: "LG ULTRAFINE",
    klasse: "Audio/Sink",
    apparaat: 48,
    stand: "suspended",
  });
  const hdmiIn = stereo(hdmi, "playback", true);
  stereo(hdmi, "monitor", false).forEach((p) => (p.monitor = true));

  const spotify = knoop({ naam: "spotify", app: "Spotify", media: "Spotify", klasse: "Stream/Output/Audio" });
  const spUit = stereo(spotify, "output", false);
  const firefox = knoop({ naam: "Firefox", app: "Firefox", media: "YouTube", klasse: "Stream/Output/Audio" });
  const ffxUit = stereo(firefox, "output", false);
  const mpv = knoop({ naam: "mpv", app: "mpv", media: "concert.mkv", klasse: "Stream/Output/Audio", stand: "idle" });
  const mpvUit = stereo(mpv, "output", false);
  const discord = knoop({ naam: "WEBRTC VoiceEngine", app: "Discord", media: "playStream", klasse: "Stream/Output/Audio", stand: "idle" });
  const dcUit = stereo(discord, "output", false);
  const recorder = knoop({ naam: "recorder", app: "Recorder", media: "Recording", klasse: "Stream/Input/Audio" });
  const recIn = stereo(recorder, "input", true);
  const discordMic = knoop({ naam: "WEBRTC VoiceEngine", app: "Discord", media: "recStream", klasse: "Stream/Input/Audio" });
  const dcMic = poort(discordMic, "input_MONO", true, { kanaal: "MONO" });

  spUit.forEach((p, i) => kabel(p, ffOut[i]));
  spUit.forEach((p, i) => kabel(p, recIn[i]));
  ffxUit.forEach((p, i) => kabel(p, ffOut[i]));
  mpvUit.forEach((p, i) => kabel(p, hdmiIn[i]));
  dcUit.forEach((p, i) => kabel(p, ffOut[i]));
  kabel(ffCap[0], dcMic);

  // MIDI: alle ALSA-apparaten en -apps zitten samen in de Midi-Bridge.
  const bridge = knoop({ naam: "Midi-Bridge", klasse: "Midi/Bridge" });
  const midi = (naam: string, apparaat: string, client: number, ingang: boolean) =>
    poort(bridge, `${apparaat}: ${naam} (${ingang ? "playback" : "capture"})`, ingang, {
      soort: "midi",
      alias: `${apparaat}:${apparaat} ${naam}`,
      fysiek: true,
      groep: `client_${client}`,
    });
  midi("Port-0", "Midi Through", 14, true);
  midi("Port-0", "Midi Through", 14, false);
  const fpUit = midi("MIDI 1", "FP-30", 24, false);
  const fpIn = midi("MIDI 1", "FP-30", 24, true);
  const tutorUit = midi("out", "Composition Tutor", 130, false);
  const tutorIn = midi("in", "Composition Tutor", 130, true);
  const vkbdUit = midi("out", "Virtual Keyboard", 131, false);
  const surge = knoop({ naam: "Surge XT", app: "Surge XT", klasse: "Midi/Sink" });
  const surgeIn = poort(surge, "in", true, { soort: "midi" });
  kabel(fpUit, surgeIn);
  kabel(fpUit, tutorIn);
  kabel(vkbdUit, surgeIn);
  kabel(tutorUit, fpIn);

  return {
    verbonden: true,
    rate: 48000,
    quantum: 256,
    standaard_sink: ff,
    standaard_bron: ffIn.naam,
    knopen,
    poorten,
    kabels,
  };
}
