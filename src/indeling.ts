// Van de kale graph naar wat de patchbay toont: welke modules er zijn, in
// welke kolom en in welke groep. Links staat alles wat levert, rechts alles
// wat ontvangt. Een node met in- én uitgangen wordt twee modules, net als
// PipeWire er voor een app die afspeelt en opneemt twee nodes van maakt.
//
// Audio en MIDI strikt gescheiden: een indeling is altijd voor één soort.

import type { Graaf, Knoop, Poort, Soort } from "./api";

export type Kant = "links" | "rechts";

export type Icoon =
  | "noot"
  | "wereld"
  | "speel"
  | "praat"
  | "opname"
  | "apparaat"
  | "scherm"
  | "toetsen"
  | "golf"
  | "app";

export interface PoortRij {
  id: number;
  label: string;
  verbonden: boolean;
}

export interface Module {
  soort: Soort;
  /** Stabiel over herstarts heen: hierop onthoudt de patchbay een versleepte plek. */
  sleutel: string;
  kant: Kant;
  titel: string;
  onder: string;
  icoon: Icoon;
  /** Niet actief: gedimd tekenen. */
  stil: boolean;
  /** De node, voor de meter. */
  knoop: number;
  /** Per meterbalkje de kanalen (plek in de node), of leeg: geen meter. */
  meter: number[][];
  poorten: PoortRij[];
}

export interface Groep {
  kant: Kant;
  titel: string;
  modules: Module[];
}

export interface Indeling {
  groepen: Groep[];
  /** Alleen kabels waarvan beide poorten in beeld zijn. */
  kabels: { id: number; uit: number; in: number }[];
  /** Wat standaard verborgen is, voor de voetregel. */
  verborgen: string[];
}

/** De volgorde van de groepen, per kant. De titels zijn alleen intern. */
/** Twee balkjes: de even en de oneven kanalen, of één bij mono. */
function balkjes(n: number): number[][] {
  const alle = Array.from({ length: n }, (_, i) => i);
  if (n < 2) return [alle];
  return [alle.filter((i) => i % 2 === 0), alle.filter((i) => i % 2 === 1)];
}

const VOLGORDE: Record<Soort, string[]> = {
  audio: [
    "Apps · playing",
    "Hardware in",
    "Virtual in",
    "Other · out",
    "Hardware out",
    "Virtual out",
    "Apps · recording",
    "Other · in",
  ],
  midi: ["Devices · out", "Apps · out", "Devices · in", "Apps · in"],
  anders: [],
};

export function deelIn(g: Graaf, soort: Soort): Indeling {
  const knopen = new Map(g.knopen.map((k) => [k.id, k]));
  const verborgen = new Set<string>();
  const modules: { groep: string; module: Module }[] = [];
  const zichtbaar = new Set<number>();

  const verbonden = new Set<number>();
  for (const k of g.kabels) {
    verbonden.add(k.uit_poort);
    verbonden.add(k.in_poort);
  }

  const voeg: Voeg = (groep, m, poorten, meter = false) => {
    if (poorten.length === 0) return;
    const rijen = [...poorten]
      .sort((a, b) => (a.volgnummer ?? a.id) - (b.volgnummer ?? b.id) || a.id - b.id)
      .map((p) => {
        zichtbaar.add(p.id);
        return { id: p.id, label: poortLabel(p, soort), verbonden: verbonden.has(p.id) };
      });
    const knoop = poorten[0].knoop;
    // De meter telt de kanalen in poortvolgorde, net als graaf.rs.
    modules.push({
      groep,
      module: { ...m, soort, poorten: rijen, knoop, meter: meter ? balkjes(rijen.length) : [] },
    });
  };

  // Poorten per node, alleen van deze soort.
  const perKnoop = new Map<number, Poort[]>();
  for (const p of g.poorten) {
    if (p.soort !== soort) continue;
    if (!perKnoop.has(p.knoop)) perKnoop.set(p.knoop, []);
    perKnoop.get(p.knoop)!.push(p);
  }

  for (const [id, poorten] of perKnoop) {
    const k = knopen.get(id);
    if (!k) continue;
    if (soort === "audio") audioModules(g, k, poorten, voeg, verborgen);
    else midiModules(k, poorten, voeg, verborgen);
  }

  // Twee Firefox-tabbladen heten hetzelfde; de sleutel moet toch uniek zijn.
  const gezien = new Map<string, number>();
  for (const { module } of modules) {
    const n = gezien.get(module.sleutel) ?? 0;
    gezien.set(module.sleutel, n + 1);
    if (n > 0) module.sleutel += `#${n}`;
  }

  const volgorde = VOLGORDE[soort];
  const groepen = new Map<string, Groep>();
  for (const { groep, module } of modules) {
    if (!groepen.has(groep)) groepen.set(groep, { kant: module.kant, titel: groep, modules: [] });
    groepen.get(groep)!.modules.push(module);
  }
  for (const gr of groepen.values()) {
    gr.modules.sort((a, b) => a.titel.localeCompare(b.titel) || a.sleutel.localeCompare(b.sleutel));
  }

  return {
    groepen: [...groepen.values()].sort(
      (a, b) => volgorde.indexOf(a.titel) - volgorde.indexOf(b.titel),
    ),
    kabels: g.kabels
      .filter((k) => zichtbaar.has(k.uit_poort) && zichtbaar.has(k.in_poort))
      .map((k) => ({ id: k.id, uit: k.uit_poort, in: k.in_poort })),
    verborgen: [...verborgen],
  };
}

type Voeg = (groep: string, m: Omit<Module, "poorten" | "knoop" | "meter" | "soort">, poorten: Poort[], meter?: boolean) => void;

function audioModules(g: Graaf, k: Knoop, poorten: Poort[], voeg: Voeg, verborgen: Set<string>) {
  const klasse = k.klasse ?? "";
  const monitors = poorten.filter((p) => p.monitor);
  if (monitors.length) verborgen.add("monitors");
  const uit = poorten.filter((p) => !p.ingang && !p.monitor);
  const ins = poorten.filter((p) => p.ingang);
  const stil = k.stand !== "running";
  // Een geluidskaart of HDMI-uitgang hangt aan een device; een null-sink of
  // loopback niet.
  const fysiek = k.apparaat !== null || poorten.some((p) => p.fysiek);

  if (klasse.startsWith("Stream/")) {
    const titel = k.app ?? k.beschrijving ?? k.naam;
    const icoon = appIcoon(titel, klasse.startsWith("Stream/Input"));
    const media = k.media && k.media !== titel ? k.media : null;
    voeg(
      "Apps · playing",
      {
        sleutel: `${k.naam}>`,
        kant: "links",
        titel,
        onder: [stil ? "silent" : "playing", media].filter(Boolean).join(" · "),
        icoon,
        stil,
      },
      uit,
      true,
    );
    voeg(
      "Apps · recording",
      {
        sleutel: `${k.naam}<`,
        kant: "rechts",
        titel,
        onder: [stil ? "idle" : "recording", media].filter(Boolean).join(" · "),
        icoon,
        stil,
      },
      ins,
    );
    return;
  }

  const apparaat = klasse.startsWith("Audio/");
  const titel = apparaatTitel(k);
  const icoon: Icoon = /hdmi|displayport/i.test(k.beschrijving ?? k.naam) ? "scherm" : "apparaat";
  const standaard = (n: string | null) => (n === k.naam ? " · default" : "");
  voeg(
    !apparaat ? "Other · out" : fysiek ? "Hardware in" : "Virtual in",
    {
      sleutel: `${k.naam}>`,
      kant: "links",
      titel,
      onder: "capture" + standaard(g.standaard_bron),
      icoon,
      stil,
    },
    uit,
    apparaat,
  );
  voeg(
    !apparaat ? "Other · in" : fysiek ? "Hardware out" : "Virtual out",
    {
      sleutel: `${k.naam}<`,
      kant: "rechts",
      titel,
      onder: "playback" + standaard(g.standaard_sink),
      icoon,
      stil,
    },
    ins,
    apparaat,
  );
}

/** Wat een MIDI-poort voor ding is: een apparaat of een app, met welke naam. */
export interface MidiDing {
  titel: string;
  isApp: boolean;
  /** Midi Through: standaard verborgen. */
  doorvoer: boolean;
  /** Stabiel: node-naam, bij de Midi-Bridge plus het apparaat. */
  sleutel: string;
}

/**
 * De Midi-Bridge is één node met alle ALSA-apparaten en -apps erin. Pas per
 * ALSA-client (`port.group`) wordt het wat je als ding herkent; clients onder
 * 128 zijn van de kernel (hardware), daarboven apps.
 */
export function midiDing(k: Knoop, p: Poort): MidiDing {
  const bridge = k.klasse === "Midi/Bridge" && k.naam === "Midi-Bridge";
  if (bridge) {
    const titel = midiApparaat(p);
    const client = Number(/client_(\d+)/.exec(p.groep ?? "")?.[1] ?? 0);
    return {
      titel,
      isApp: client >= 128,
      doorvoer: /^Midi Through/.test(titel),
      sleutel: `${k.naam}/${titel}`,
    };
  }
  return {
    titel: k.app ?? k.beschrijving ?? k.naam,
    isApp: k.klasse !== "Midi/Bridge",
    doorvoer: false,
    sleutel: k.naam,
  };
}

function midiModules(k: Knoop, poorten: Poort[], voeg: Voeg, verborgen: Set<string>) {
  const delen = new Map<string, { ding: MidiDing; ps: Poort[] }>();
  for (const p of poorten) {
    const ding = midiDing(k, p);
    if (!delen.has(ding.sleutel)) delen.set(ding.sleutel, { ding, ps: [] });
    delen.get(ding.sleutel)!.ps.push(p);
  }

  for (const { ding, ps } of delen.values()) {
    const { titel, isApp, sleutel } = ding;
    if (ding.doorvoer) {
      verborgen.add("Midi Through");
      continue;
    }
    const icoon: Icoon = isApp ? (/synth|surge|vital/i.test(titel) ? "golf" : "noot") : "toetsen";
    const bridge = sleutel !== k.naam;
    const onder = isApp ? "app" : bridge ? "ALSA MIDI" : "device";
    voeg(
      isApp ? "Apps · out" : "Devices · out",
      { sleutel: `${sleutel}>`, kant: "links", titel, onder, icoon, stil: false },
      ps.filter((p) => !p.ingang),
    );
    voeg(
      isApp ? "Apps · in" : "Devices · in",
      { sleutel: `${sleutel}<`, kant: "rechts", titel, onder, icoon, stil: false },
      ps.filter((p) => p.ingang),
    );
  }
}

/** "FP-30: MIDI 1 (capture)" → "FP-30". */
function midiApparaat(p: Poort): string {
  const uitAlias = p.alias?.split(":")[0];
  const uitNaam = p.naam.split(": ")[0];
  return (uitAlias || uitNaam).trim();
}

export function apparaatTitel(k: Knoop): string {
  const b = k.beschrijving;
  if (b && b.length <= 28) return b;
  return k.bijnaam ?? b ?? k.naam;
}

export function poortLabel(p: Poort, soort: Soort): string {
  if (soort === "midi") {
    const kaal = p.naam.replace(/ \((capture|playback)\)$/, "");
    return kaal.includes(": ") ? kaal.split(": ").slice(1).join(": ") : kaal;
  }
  // Een pro-audio-profiel nummert AUX0…; op de kast staat In 1 / Out 1.
  const aux = /^AUX(\d+)$/.exec(p.kanaal ?? "");
  if (aux) return `${p.ingang ? "Out" : "In"} ${Number(aux[1]) + 1}`;
  return p.kanaal ?? p.naam.replace(/^(output|input|playback|capture)_/, "");
}

function appIcoon(naam: string, opname: boolean): Icoon {
  const n = naam.toLowerCase();
  if (/discord|teams|zoom|slack|signal|webrtc|skype/.test(n)) return "praat";
  if (/firefox|chrom|brave|vivaldi|opera|edge|zen|librewolf/.test(n)) return "wereld";
  if (/mpv|vlc|totem|celluloid|haruna|smplayer|kodi/.test(n)) return "speel";
  if (opname) return "opname";
  return "noot";
}
