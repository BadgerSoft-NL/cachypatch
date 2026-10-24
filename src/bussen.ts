// De rec-bussen: hoe de kanalen van de Rec bus in bussen zijn ingedeeld, en
// per bus de fader, mute en of hij gewapend is. Zoals de uitgangen in
// CachyMix: een stereobus, of gesplitst in twee mono's. Armen gaat zoals in
// Ableton (zie `arm`); Record neemt alle gewapende bussen samen op.
//
// Dit is configuratie, geen routing: het mag bewaard blijven. De Rust-kant
// krijgt het aantal kanalen en de gain per kanaal; wat er naar een bus gaat,
// staat gewoon in de graph.

import { isBus, ontkoppel, verbind, zetBus, type Graaf } from "./api";

export interface BusStand {
  db: number;
  mute: boolean;
  /** Klaar om op te nemen: Record neemt hem mee. */
  gewapend?: boolean;
}

export interface BusConfig {
  /** Per bus het aantal kanalen (2 = stereo, 1 = mono), op volgorde over de
   *  kanalen van de Rec bus. */
  bussen: number[];
  stand: Record<string, BusStand>;
  /** De MIDI-ingang van de bus is gewapend. */
  midi: boolean;
}

export interface BusDef {
  sleutel: string;
  naam: string;
  /** Voor de bestandsnaam, en zo kent de Rust-kant hem: "Rec 1-2". */
  bestand: string;
  /** Kanaalnummers op de Rec bus, vanaf 0. */
  kanalen: number[];
  /** Plek in `BusConfig.bussen`. */
  plek: number;
  /** Wat de koppelknop doet: een stereobus splitsen, of deze mono met de
   *  volgende koppelen. Geen = geen knop. */
  koppel?: "splits" | "koppel";
}

export const UIT_DB = -90;
const OPSLAG = "pecanmixer.bussen";
const BEGIN: BusConfig = {
  bussen: [2],
  // Een nieuwe gebruiker kan meteen op Record drukken.
  stand: { "rec-1-2": { db: 0, mute: false, gewapend: true } },
  midi: true,
};

export function leesBussen(): BusConfig {
  try {
    const c = JSON.parse(localStorage.getItem(OPSLAG) ?? "null");
    if (c && Array.isArray(c.bussen) && c.bussen.length) return { ...BEGIN, ...c };
    // Van voor de losse bussen: paren, gekoppeld of niet.
    if (c && Array.isArray(c.paren) && c.paren.length) {
      const bussen = c.paren.flatMap((p: { gekoppeld: boolean }) => (p.gekoppeld ? [2] : [1, 1]));
      return { ...BEGIN, stand: c.stand ?? {}, midi: c.midi ?? true, bussen };
    }
  } catch {
    // Geen opslag: de beginstand.
  }
  return BEGIN;
}

export function bewaarBussen(c: BusConfig) {
  try {
    localStorage.setItem(OPSLAG, JSON.stringify(c));
  } catch {
    // Dan vergeet hij het na een herstart.
  }
}

export function bussen(c: BusConfig): BusDef[] {
  const uit: BusDef[] = [];
  let k = 0;
  c.bussen.forEach((breed, plek) => {
    const a = k + 1;
    if (breed === 2) {
      uit.push({ sleutel: `rec-${a}-${a + 1}`, naam: `Rec ${a}/${a + 1}`, bestand: `Rec ${a}-${a + 1}`, kanalen: [k, k + 1], plek, koppel: "splits" });
    } else {
      // Twee mono's naast elkaar kun je koppelen; telkens de linker van een
      // paar, zodat drie mono's niet twee knoppen voor de middelste geven.
      const vorige = uit[uit.length - 1];
      const isRechter = vorige?.koppel === "koppel";
      const koppel = !isRechter && c.bussen[plek + 1] === 1 ? "koppel" : undefined;
      uit.push({ sleutel: `rec-${a}`, naam: `Rec ${a}`, bestand: `Rec ${a}`, kanalen: [k], plek, koppel });
    }
    k += breed;
  });
  return uit;
}

export function standVan(c: BusConfig, sleutel: string): BusStand {
  return c.stand[sleutel] ?? { db: 0, mute: false };
}

/** De bussen die gewapend zijn, in volgorde. */
export function gewapend(c: BusConfig): BusDef[] {
  return bussen(c).filter((b) => standVan(c, b.sleutel).gewapend);
}

/**
 * Armen zoals in Ableton: een klik armt alleen deze bus en zet de andere uit
 * (of zet hem zelf uit als hij de enige was); met `erbij` (Ctrl+klik) gaat
 * alleen deze aan of uit en blijven de andere zoals ze zijn.
 */
export function arm(c: BusConfig, sleutel: string, erbij: boolean): BusConfig {
  const alle = bussen(c);
  const aan = new Set(gewapend(c).map((b) => b.sleutel));
  if (erbij) {
    if (aan.has(sleutel)) aan.delete(sleutel);
    else aan.add(sleutel);
  } else {
    const alleenDeze = aan.size === 1 && aan.has(sleutel);
    aan.clear();
    if (!alleenDeze) aan.add(sleutel);
  }
  const stand = { ...c.stand };
  for (const b of alle) stand[b.sleutel] = { ...standVan(c, b.sleutel), gewapend: aan.has(b.sleutel) };
  return { ...c, stand };
}

function kanaalTal(c: BusConfig): number {
  return c.bussen.reduce((a, b) => a + b, 0);
}

/** Stuurt het aantal kanalen en de gain per kanaal naar de Rec bus. */
export function stuurBussen(c: BusConfig) {
  const gain = Array(kanaalTal(c)).fill(1);
  for (const b of bussen(c)) {
    const s = standVan(c, b.sleutel);
    const g = s.mute || s.db <= UIT_DB ? 0 : Math.pow(10, s.db / 20);
    for (const k of b.kanalen) gain[k] = g;
  }
  zetBus(kanaalTal(c), gain);
}

/** Nieuwe indeling; de stand (fader, mute) gaat mee met zijn bus. `van`
 *  zegt per nieuwe plek van welke oude bus hij de stand krijgt. */
function herindeel(c: BusConfig, nieuw: number[], van: (plek: number) => number | undefined): BusConfig {
  const oud = bussen(c);
  const volgend = { ...c, bussen: nieuw };
  const stand: Record<string, BusStand> = {};
  for (const b of bussen(volgend)) {
    const o = van(b.plek);
    const s = o === undefined ? undefined : c.stand[oud.find((x) => x.plek === o)?.sleutel ?? ""];
    if (s) stand[b.sleutel] = s;
  }
  return { ...volgend, stand };
}

/** Een stereobus splitsen, of een mono met de volgende koppelen. */
export function wisselKoppeling(c: BusConfig, plek: number): BusConfig {
  const n = c.bussen;
  if (n[plek] === 2) {
    const nieuw = [...n.slice(0, plek), 1, 1, ...n.slice(plek + 1)];
    return herindeel(c, nieuw, (p) => (p <= plek ? p : p === plek + 1 ? plek : p - 1));
  }
  if (n[plek] === 1 && n[plek + 1] === 1) {
    const nieuw = [...n.slice(0, plek), 2, ...n.slice(plek + 2)];
    return herindeel(c, nieuw, (p) => (p <= plek ? p : p + 1));
  }
  return c;
}

export function busErbij(c: BusConfig): BusConfig {
  return { ...c, bussen: [...c.bussen, 2] };
}

/**
 * Haalt een bus weg. Wat erheen ging, wordt ontkoppeld; de bussen erna
 * schuiven op (Rec 5/6 wordt Rec 3/4), en hun routes schuiven mee naar de
 * nieuwe kanalen. Eerst de nieuwe links, dan de oude weg, dan pas minder
 * kanalen: zo hangt een bron nooit even nergens aan.
 */
export function busWeg(c: BusConfig, plek: number, g: Graaf): BusConfig {
  if (c.bussen.length <= 1) return c;
  const breed = c.bussen[plek];
  const eerste = bussen(c).find((b) => b.plek === plek)?.kanalen[0];
  const knoop = g.knopen.find(isBus);
  if (eerste !== undefined && knoop) {
    const poorten = g.poorten.filter((p) => p.knoop === knoop.id && p.ingang);
    const kanaal = (id: number) => {
      const m = /^rec_(\d+)$/.exec(poorten.find((p) => p.id === id)?.naam ?? "");
      return m ? Number(m[1]) - 1 : null;
    };
    const naar = (k: number) => poorten.find((p) => p.naam === `rec_${k + 1}`);
    const weg: number[] = [];
    for (const kabel of g.kabels.filter((k) => k.in_knoop === knoop.id)) {
      const k = kanaal(kabel.in_poort);
      if (k === null || k < eerste) continue;
      weg.push(kabel.id);
      if (k >= eerste + breed) {
        const doel = naar(k - breed);
        if (doel) verbind(kabel.uit_poort, doel.id);
      }
    }
    ontkoppel(weg);
  }
  const nieuw = c.bussen.filter((_, i) => i !== plek);
  return herindeel(c, nieuw, (p) => (p < plek ? p : p + 1));
}
