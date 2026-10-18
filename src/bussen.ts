// De rec-bussen: hoe de kanalen van de Rec bus in bussen zijn ingedeeld, en
// per bus de fader, mute en of hij gewapend is. Zoals de uitgangen in
// CachyMix: per paar kanalen een stereobus, of gesplitst in twee mono's.
//
// Dit is configuratie, geen routing: het mag bewaard blijven. De Rust-kant
// krijgt het aantal kanalen en de gain per kanaal; wat er naar een bus gaat,
// staat gewoon in de graph.

import { zetBus } from "./api";

export interface Paar {
  gekoppeld: boolean;
}

export interface BusStand {
  db: number;
  mute: boolean;
  gewapend: boolean;
}

export interface BusConfig {
  paren: Paar[];
  stand: Record<string, BusStand>;
  /** De MIDI-ingang van de bus is gewapend. */
  midi: boolean;
}

export interface BusDef {
  sleutel: string;
  naam: string;
  /** Voor de bestandsnaam: "Rec 1-2". */
  bestand: string;
  /** Kanaalnummers op de Rec bus, vanaf 0. */
  kanalen: number[];
  /** Het paar waar hij bij hoort, en of hij de linker (of enige) is. */
  paar: number;
  links: boolean;
}

export const UIT_DB = -90;
const OPSLAG = "pecanpatch.bussen";
const BEGIN: BusConfig = {
  paren: [{ gekoppeld: true }],
  stand: { "rec-1-2": { db: 0, mute: false, gewapend: true } },
  midi: true,
};

export function leesBussen(): BusConfig {
  try {
    const c = JSON.parse(localStorage.getItem(OPSLAG) ?? "null");
    if (c && Array.isArray(c.paren) && c.paren.length) return { ...BEGIN, ...c };
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
  return c.paren.flatMap((p, i): BusDef[] => {
    const a = 2 * i + 1;
    const b = a + 1;
    if (p.gekoppeld)
      return [{ sleutel: `rec-${a}-${b}`, naam: `Rec ${a}/${b}`, bestand: `Rec ${a}-${b}`, kanalen: [a - 1, b - 1], paar: i, links: true }];
    return [
      { sleutel: `rec-${a}`, naam: `Rec ${a}`, bestand: `Rec ${a}`, kanalen: [a - 1], paar: i, links: true },
      { sleutel: `rec-${b}`, naam: `Rec ${b}`, bestand: `Rec ${b}`, kanalen: [b - 1], paar: i, links: false },
    ];
  });
}

export function standVan(c: BusConfig, sleutel: string): BusStand {
  return c.stand[sleutel] ?? { db: 0, mute: false, gewapend: false };
}

/** Stuurt het aantal kanalen en de gain per kanaal naar de Rec bus. */
export function stuurBussen(c: BusConfig) {
  const gain = Array(c.paren.length * 2).fill(1);
  for (const b of bussen(c)) {
    const s = standVan(c, b.sleutel);
    const g = s.mute || s.db <= UIT_DB ? 0 : Math.pow(10, s.db / 20);
    for (const k of b.kanalen) gain[k] = g;
  }
  zetBus(c.paren.length * 2, gain);
}

/** Een paar koppelen of splitsen; de stand gaat mee naar de nieuwe bus(sen). */
export function wisselKoppeling(c: BusConfig, paar: number): BusConfig {
  const oud = bussen(c).filter((b) => b.paar === paar);
  const paren = c.paren.map((p, i) => (i === paar ? { gekoppeld: !p.gekoppeld } : p));
  const nieuw = bussen({ ...c, paren }).filter((b) => b.paar === paar);
  const stand = { ...c.stand };
  const eerste = standVan(c, oud[0].sleutel);
  for (const b of nieuw) stand[b.sleutel] = stand[b.sleutel] ?? eerste;
  return { ...c, paren, stand };
}

export function busErbij(c: BusConfig): BusConfig {
  return { ...c, paren: [...c.paren, { gekoppeld: true }] };
}

export function busEraf(c: BusConfig): BusConfig {
  return c.paren.length > 1 ? { ...c, paren: c.paren.slice(0, -1) } : c;
}
