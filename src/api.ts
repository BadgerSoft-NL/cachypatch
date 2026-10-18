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
  /** `target.object`: waar de stream heen is verplaatst. `null` = WirePlumber kiest. */
  doel: string | null;
  /** Volume per kanaal, lineair (1 = 0 dB). */
  volume: number[] | null;
  mute: boolean | null;
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
  /** De client die hem legde; een van `Graaf.wireplumber` = beleid. */
  client: number | null;
}

export interface Graaf {
  verbonden: boolean;
  rate: number | null;
  quantum: number | null;
  standaard_sink: string | null;
  standaard_bron: string | null;
  wireplumber: number[];
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
  wireplumber: [],
  knopen: [],
  poorten: [],
  kabels: [],
};

const inTauri = "__TAURI_INTERNALS__" in window;

/** De node-naam van CachyPatch' eigen opname-ingang. */
export const BUS = "cachypatch-opname";

export function isBus(k: { naam: string }): boolean {
  return k.naam === BUS;
}

// --- Opname ---

export interface Opties {
  mixdown: boolean;
  multitrack: boolean;
  midi: boolean;
  /** MIDI-bronpoort van de externe klok; null = intern. */
  klok: number | null;
  start_stop: boolean;
}

export interface TransportStand {
  bezig: boolean;
  map: string | null;
  seconden: number;
  klok: { bpm: number | null; lock: boolean };
  fout: string | null;
}

export const STIL: TransportStand = {
  bezig: false,
  map: null,
  seconden: 0,
  klok: { bpm: null, lock: false },
  fout: null,
};

let nepTransport: TransportStand = STIL;
let nepTransportVolger: ((t: TransportStand) => void) | undefined;
let nepStart = 0;

export function volgTransport(bij: (t: TransportStand) => void): () => void {
  if (inTauri) {
    let stop: (() => void) | undefined;
    let weg = false;
    listen<TransportStand>("transport", (e) => bij(e.payload)).then((s) => (weg ? s() : (stop = s)));
    return () => {
      weg = true;
      stop?.();
    };
  }
  nepTransportVolger = bij;
  const id = setInterval(() => {
    if (nepTransport.bezig) nepTransport = { ...nepTransport, seconden: (performance.now() - nepStart) / 1000 };
    bij(nepTransport);
  }, 200);
  return () => clearInterval(id);
}

export function zetTransport(opties: Opties) {
  if (inTauri) invoke("zet_transport", { opties });
}

export function startOpname() {
  if (inTauri) return void invoke("start_opname");
  nepStart = performance.now();
  nepTransport = { ...STIL, bezig: true, map: "~/Recordings/2026-10-18_1043" };
  nepTransportVolger?.(nepTransport);
}

export function stopOpname() {
  if (inTauri) return void invoke("stop_opname");
  nepTransport = { ...nepTransport, bezig: false };
  nepTransportVolger?.(nepTransport);
}

/** Roept `bij` aan met de huidige graph en daarna met elke verandering. */
export function volgGraaf(bij: (g: Graaf) => void): () => void {
  if (!inTauri) {
    nepVolger = bij;
    // ?graaf=/pad/naar.json laadt een echte momentopname, zoals
    // `cargo run --example graaf` die schrijft.
    const bestand = new URLSearchParams(location.search).get("graaf");
    if (bestand) {
      fetch(bestand)
        .then((r) => r.json())
        .then((g: Graaf) => {
          nep = g;
          bij(g);
        });
    } else {
      nep = nepGraaf();
      bij(nep);
    }
    return () => (nepVolger = undefined);
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

/** Een link van een uitgangspoort naar een ingangspoort. Blijft na sluiten. */
export function verbind(uit: number, naar: number) {
  if (inTauri) invoke("verbind", { uit, naar });
  else nepVerbind(uit, naar);
}

export function ontkoppel(kabels: number[]) {
  if (kabels.length === 0) return;
  if (inTauri) invoke("ontkoppel", { kabels });
  else nepWijzig((g) => (g.kabels = g.kabels.filter((k) => !kabels.includes(k.id))));
}

/**
 * Laat WirePlumber de stream naar `doel` (een serial) verplaatsen, of met
 * `null` het doel wissen. Alleen wissen laat een losgekoppelde stream los
 * staan; `"-1"` dwingt hem terug naar de standaard. Zie CLAUDE.md.
 */
export function zetDoel(knoop: number, doel: string | null) {
  if (inTauri) invoke("zet_doel", { knoop, doel });
  else nepDoel(knoop, doel);
}

export function zetVolume(knoop: number, volume: number[]) {
  if (inTauri) invoke("zet_volume", { knoop, volume });
  else nepWijzig((g) => {
    const k = g.knopen.find((k) => k.id === knoop);
    if (k) k.volume = volume;
  });
}

export function zetMute(knoop: number, mute: boolean) {
  if (inTauri) invoke("zet_mute", { knoop, mute });
  else nepWijzig((g) => {
    const k = g.knopen.find((k) => k.id === knoop);
    if (k) k.mute = mute;
  });
}

// --- Zonder Tauri: een nagemaakte graph met een nagebootste WirePlumber ---

let nep: Graaf = LEEG;
let nepVolger: ((g: Graaf) => void) | undefined;
const WP = 33;
const WIJ = 999;
let nepId = 10_000;

function nepWijzig(f: (g: Graaf) => void) {
  const g: Graaf = structuredClone(nep);
  f(g);
  nep = g;
  // Zoals de echte draad: even later, niet midden in de klik.
  setTimeout(() => nepVolger?.(nep), 30);
}

function nepVerbind(uit: number, naar: number, client = WIJ) {
  nepWijzig((g) => {
    const a = g.poorten.find((p) => p.id === uit);
    const b = g.poorten.find((p) => p.id === naar);
    if (!a || !b) return;
    if (g.kabels.some((k) => k.uit_poort === uit && k.in_poort === naar)) return;
    g.kabels.push({ id: nepId++, uit_knoop: a.knoop, uit_poort: uit, in_knoop: b.knoop, in_poort: naar, client });
  });
}

/** Wat WirePlumber doet bij een nieuw `target.object`: zijn eigen links van
 *  die stream weghalen en naar het doel (of de standaard) leggen. */
function nepDoel(knoop: number, doel: string | null) {
  nepWijzig((g) => {
    const k = g.knopen.find((k) => k.id === knoop);
    if (!k) return;
    k.doel = doel === "-1" ? "-1" : doel;
    if (doel === null) return; // alleen wissen: WirePlumber doet niets
    if (doel === "-1") k.doel = null;
    const uitgang = (k.klasse ?? "").startsWith("Stream/Output");
    const naam = doel === "-1" ? (uitgang ? g.standaard_sink : g.standaard_bron) : null;
    const d = g.knopen.find((n) => (naam ? n.naam === naam : String(n.serial) === doel));
    g.kabels = g.kabels.filter(
      (c) => !(c.client === WP && (uitgang ? c.uit_knoop : c.in_knoop) === knoop),
    );
    if (!d) return;
    const eigen = g.poorten.filter((p) => p.knoop === knoop && p.ingang !== uitgang && !p.monitor);
    const ander = g.poorten.filter((p) => p.knoop === d.id && p.ingang === uitgang && !p.monitor && p.soort === "audio");
    eigen.forEach((p, i) => {
      const q = ander.find((q) => q.kanaal === p.kanaal) ?? ander[i];
      if (!q) return;
      const [uit, naar] = uitgang ? [p, q] : [q, p];
      g.kabels.push({ id: nepId++, uit_knoop: uit.knoop, uit_poort: uit.id, in_knoop: naar.knoop, in_poort: naar.id, client: WP });
    });
  });
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
      doel: null,
      volume: [1, 1],
      mute: false,
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
  const kabel = (uit: Poort, naar: Poort, client = WP) =>
    kabels.push({
      id: id++,
      uit_knoop: uit.knoop,
      uit_poort: uit.id,
      in_knoop: naar.knoop,
      in_poort: naar.id,
      client,
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

  const bus = knoop({ naam: BUS, app: "CachyPatch", beschrijving: "Rec bus", klasse: "Stream/Input/Audio" });
  const busIn = ["FL", "FR"].map((c) => poort(bus, `input_${c}`, true, { kanaal: c }));
  const busMidi = poort(bus, "midi_in", true, { soort: "midi" });

  spUit.forEach((p, i) => kabel(p, ffOut[i]));
  spUit.forEach((p, i) => kabel(p, busIn[i], WIJ));
  spUit.forEach((p, i) => kabel(p, recIn[i], WIJ));
  ffxUit.forEach((p, i) => kabel(p, ffOut[i]));
  mpvUit.forEach((p, i) => kabel(p, hdmiIn[i]));
  mpv.doel = String(hdmi.serial);
  firefox.volume = [0.5, 0.5];
  discord.volume = [0.71, 0.71];
  dcUit.forEach((p, i) => kabel(p, ffOut[i]));
  kabel(ffCap[0], dcMic);
  // Een patch die de mixer niet kan tonen: alleen links naar Out 3.
  const webcam = knoop({ naam: "alsa_input.usb-webcam", beschrijving: "Webcam", klasse: "Audio/Source", apparaat: 50, stand: "idle" });
  poort(webcam, "capture_MONO", false, { kanaal: "MONO", fysiek: true });
  kabel(ffCap[1], ffOut[2], WIJ);

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
  midi("MIDI 1", "Launchkey", 28, false);
  const surge = knoop({ naam: "Surge XT", app: "Surge XT", klasse: "Midi/Sink" });
  const surgeIn = poort(surge, "in", true, { soort: "midi" });
  kabel(fpUit, surgeIn, WIJ);
  kabel(fpUit, tutorIn, WIJ);
  kabel(vkbdUit, surgeIn, WIJ);
  kabel(tutorUit, fpIn, WIJ);
  kabel(fpUit, busMidi, WIJ);
  kabel(tutorUit, busMidi, WIJ);

  // Eén volume per kanaal, zoals een echte node dat meldt.
  for (const k of knopen) {
    const n = poorten.filter((p) => p.knoop === k.id && p.soort === "audio" && !p.monitor).length;
    const v = k.volume?.[0] ?? 1;
    k.volume = n ? Array(n).fill(v) : null;
  }

  return {
    verbonden: true,
    rate: 48000,
    quantum: 256,
    standaard_sink: ff,
    standaard_bron: ffIn.naam,
    wireplumber: [WP],
    knopen,
    poorten,
    kabels,
  };
}
