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

/** De node-naam van de eigen opname-ingang van Pecan Mixer. */
export const BUS = "pecanmixer-opname";

/** MIDI staat voorlopig uit: nog niet getest met echte apparaten. De knoppen
 *  blijven als placeholder staan. Aan de Rust-kant is het `graaf::MIDI`. */
export const MIDI_AAN = false;

export function isBus(k: { naam: string }): boolean {
  return k.naam === BUS;
}

// --- Opname ---

/** Eén bus: een WAV met deze kanalen van de Rec bus. De naam is ook de
 *  bestandsnaam, en zo stop je hem weer. */
export interface BusOpname {
  naam: string;
  kanalen: number[];
}

export interface Opties {
  /** Wat Record start: de gewapende bussen. */
  bussen: BusOpname[];
  /** De MIDI-ingang van de bus is gewapend. */
  midi: boolean;
  /** MIDI-bronpoort van de externe klok; null = intern. */
  klok: number | null;
  start_stop: boolean;
}

export interface TransportStand {
  bezig: boolean;
  /** De map van de laatst gestarte take. */
  map: string | null;
  /** Hoe lang de oudste lopende take al loopt. */
  seconden: number;
  /** Per bus die opneemt (op `BusOpname.naam`): hoe lang al. */
  bussen: Record<string, number>;
  klok: { bpm: number | null; lock: boolean };
  fout: string | null;
}

export const STIL: TransportStand = {
  bezig: false,
  map: null,
  seconden: 0,
  bussen: {},
  klok: { bpm: null, lock: false },
  fout: null,
};

let nepTransportVolger: ((t: TransportStand) => void) | undefined;
// Nep: per lopende bus wanneer hij begon, en wat Record zou starten.
const nepBussen = new Map<string, number>();
let nepOpties: Opties | null = null;
let nepMap: string | null = null;

function nepStand(): TransportStand {
  const nu = performance.now();
  const bussen = Object.fromEntries([...nepBussen].map(([n, t]) => [n, (nu - t) / 1000]));
  return {
    ...STIL,
    bezig: nepBussen.size > 0,
    map: nepMap,
    seconden: Math.max(0, ...Object.values(bussen)),
    bussen,
  };
}

function nepMeld() {
  nepTransportVolger?.(nepStand());
}

function nepNeemOp(bussen: BusOpname[]) {
  const nieuw = bussen.filter((b) => !nepBussen.has(b.naam));
  if (!nieuw.length) return;
  const t = performance.now();
  for (const b of nieuw) nepBussen.set(b.naam, t);
  nepMap = `~/Recordings/2026-10-18_1043${nepMap ? `-${nepBussen.size}` : ""}`;
  nepMeld();
}

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
  const id = setInterval(() => bij(nepStand()), 200);
  return () => clearInterval(id);
}

export function zetTransport(opties: Opties) {
  if (inTauri) invoke("zet_transport", { opties });
  else nepOpties = opties;
}

/** Hoeveel kanalen de Rec bus heeft, en de gain per kanaal (0 = mute). */
export function zetBus(kanalen: number, gain: number[]) {
  if (inTauri) return void invoke("zet_bus", { kanalen, gain });
  // Nep: de bus krijgt zoveel rec_N-poorten.
  nepWijzig((g) => {
    const bus = g.knopen.find(isBus);
    if (!bus) return;
    const nu = g.poorten.filter((p) => p.knoop === bus.id && p.soort === "audio");
    for (const p of nu.slice(kanalen)) {
      g.poorten = g.poorten.filter((q) => q.id !== p.id);
      g.kabels = g.kabels.filter((k) => k.in_poort !== p.id);
    }
    for (let i = nu.length; i < kanalen; i++) {
      g.poorten.push({
        id: nepId++, knoop: bus.id, volgnummer: i + 1, naam: `rec_${i + 1}`, alias: null, ingang: true,
        soort: "audio", kanaal: `AUX${i}`, monitor: false, fysiek: false, groep: null,
      });
    }
  });
}

/** Record: alle gewapende bussen (en MIDI) samen, in één take. */
export function startOpname() {
  if (inTauri) return void invoke("start_opname");
  nepNeemOp(nepOpties?.bussen ?? []);
}

/** Alles stoppen. */
export function stopOpname() {
  if (inTauri) return void invoke("stop_opname");
  nepBussen.clear();
  nepMeld();
}

/** Eén bus in een eigen take. */
export function startBus(bus: BusOpname) {
  if (inTauri) return void invoke("start_bus", { bus });
  nepNeemOp([bus]);
}

/** Opent de map van de laatste take (of `~/Recordings`) in de
 *  bestandsbeheerder. Zonder Tauri kan dat niet. */
export function openMap(map: string | null) {
  if (inTauri) invoke("open_map", { map });
  else console.info("open folder:", map ?? "~/Recordings");
}

export function stopBus(naam: string) {
  if (inTauri) return void invoke("stop_bus", { naam });
  nepBussen.delete(naam);
  nepMeld();
}

let laatste: Graaf = LEEG;

/** De graph zoals hij het laatst binnenkwam; voor ongedaan maken. */
export function laatsteGraaf(): Graaf {
  return laatste;
}

/** Roept `bij` aan met de huidige graph en daarna met elke verandering. */
export function volgGraaf(volger: (g: Graaf) => void): () => void {
  const bij = (g: Graaf) => {
    laatste = g;
    volger(g);
  };
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

/**
 * Wat WirePlumber 0.5 doet bij een `target.object` (zie CLAUDE.md): alleen als
 * het doel echt verandert, verplaatst hij de stream; wissen na een echt doel
 * zet hem terug op de standaard; een doel dat niet verandert doet niets.
 */
function nepDoel(knoop: number, doel: string | null) {
  nepWijzig((g) => {
    const k = g.knopen.find((k) => k.id === knoop);
    if (!k) return;
    const uitgang = (k.klasse ?? "").startsWith("Stream/Output");
    const standaard = g.knopen.find((n) => n.naam === (uitgang ? g.standaard_sink : g.standaard_bron));
    const vind = (d: string | null) =>
      d === null || d === "-1" ? standaard : g.knopen.find((n) => String(n.serial) === d || n.naam === d);
    const was = vind(k.doel);
    const wordt = vind(doel);
    k.doel = doel === "-1" ? null : doel;
    if (!wordt || was?.id === wordt.id) return;
    g.kabels = g.kabels.filter(
      (c) => !(c.client === WP && (uitgang ? c.uit_knoop : c.in_knoop) === knoop),
    );
    const eigen = g.poorten.filter((p) => p.knoop === knoop && p.ingang !== uitgang && !p.monitor);
    const ander = g.poorten.filter((p) => p.knoop === wordt.id && p.ingang === uitgang && !p.monitor && p.soort === "audio");
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

  const bus = knoop({ naam: BUS, app: "Pecan Mixer", beschrijving: "Rec bus", klasse: "Stream/Input/Audio" });
  const busIn = [0, 1].map((i) => poort(bus, `rec_${i + 1}`, true, { kanaal: `AUX${i}` }));
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
