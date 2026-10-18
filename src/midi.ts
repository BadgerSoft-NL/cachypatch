// MIDI-activiteit per bronpoort, zoals de graph-draad die meldt (event
// "midi"). Kanalen en berichtsoorten gloeien ongeveer 150 ms na, anders zie
// je een losse aanslag niet. Een bestemming toont wat er binnenkomt: alles
// van de bronnen die erheen gaan, samengevoegd.

import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { Graaf } from "./api";

export const SOORTEN = ["NOTE", "CC", "PB", "CLK"] as const;
const NAGLOEI = 150;
const VENSTER = 1000;

interface Spoor {
  /** Per kanaal (0–15) en soort: wanneer laatst gezien. */
  kanalen: number[];
  soorten: number[];
  /** Tijdstempels en aantallen van het laatste venster, voor ev/s. */
  tellingen: [number, number][];
  laatste: string | null;
  laatsteTijd: number;
}

const sporen = new Map<number, Spoor>();

interface Melding {
  events: number;
  kanalen: number;
  soorten: number;
  laatste: string | null;
}

function neem(poort: number, a: Melding, nu: number) {
  let s = sporen.get(poort);
  if (!s) {
    s = { kanalen: Array(16).fill(0), soorten: Array(4).fill(0), tellingen: [], laatste: null, laatsteTijd: 0 };
    sporen.set(poort, s);
  }
  for (let i = 0; i < 16; i++) if (a.kanalen & (1 << i)) s.kanalen[i] = nu;
  for (let i = 0; i < 4; i++) if (a.soorten & (1 << i)) s.soorten[i] = nu;
  s.tellingen.push([nu, a.events]);
  if (a.laatste) s.laatste = a.laatste;
  if (a.events) s.laatsteTijd = nu;
}

/** Wat een meter toont, voor één of meer poorten samen. */
export interface Beeld {
  actief: boolean;
  perSeconde: number;
  kanalen: boolean[];
  soorten: boolean[];
  laatste: string | null;
}

export function beeld(poorten: number[]): Beeld {
  const nu = performance.now();
  const uit: Beeld = {
    actief: false,
    perSeconde: 0,
    kanalen: Array(16).fill(false),
    soorten: Array(4).fill(false),
    laatste: null,
  };
  let laatsteTijd = 0;
  for (const p of poorten) {
    const s = sporen.get(p);
    if (!s) continue;
    while (s.tellingen.length && s.tellingen[0][0] < nu - VENSTER) s.tellingen.shift();
    uit.perSeconde += s.tellingen.reduce((n, [, x]) => n + x, 0) * (1000 / VENSTER);
    s.kanalen.forEach((t, i) => (uit.kanalen[i] ||= nu - t < NAGLOEI));
    s.soorten.forEach((t, i) => (uit.soorten[i] ||= nu - t < NAGLOEI));
    uit.actief ||= nu - s.laatsteTijd < NAGLOEI;
    if (s.laatste && s.laatsteTijd >= laatsteTijd) {
      uit.laatste = s.laatste;
      laatsteTijd = s.laatsteTijd;
    }
  }
  return uit;
}

/** Hertekent het onderdeel ongeveer 15 keer per seconde. */
export function useTik() {
  const [, zet] = useState(0);
  useEffect(() => {
    const id = setInterval(() => zet((n) => n + 1), 66);
    return () => clearInterval(id);
  }, []);
}

const inTauri = "__TAURI_INTERNALS__" in window;

/** Begint met luisteren; zonder Tauri speelt een nagemaakte FP-30 en Tutor. */
export function volgMidi(graaf: () => Graaf): () => void {
  if (inTauri) {
    let stop: (() => void) | undefined;
    let weg = false;
    listen<Record<string, Melding>>("midi", (e) => {
      const nu = performance.now();
      for (const [poort, a] of Object.entries(e.payload)) neem(Number(poort), a, nu);
    }).then((s) => (weg ? s() : (stop = s)));
    return () => {
      weg = true;
      stop?.();
    };
  }
  const NOTEN = ["C3", "E4", "G4", "A3", "D4"];
  let t = 0;
  const id = setInterval(() => {
    t++;
    const nu = performance.now();
    const g = graaf();
    for (const p of g.poorten) {
      if (p.soort !== "midi" || p.ingang) continue;
      const naam = p.alias ?? p.naam;
      if (/FP-30/.test(naam) && t % 5 === 0) {
        const n = NOTEN[(t / 5) % NOTEN.length];
        neem(p.id, { events: 2, kanalen: 1, soorten: 1, laatste: `Note On ${n} · vel ${60 + (t % 40)}` }, nu);
      } else if (/Tutor/.test(naam)) {
        // Klok, 48 per seconde, en af en toe een noot op kanaal 2.
        neem(p.id, { events: 2, kanalen: t % 12 === 0 ? 2 : 0, soorten: t % 12 === 0 ? 9 : 8, laatste: t % 12 === 0 ? "Note Off C3" : null }, nu);
      } else if (/Launchkey/.test(naam) && t % 25 === 0) {
        neem(p.id, { events: 1, kanalen: 1 << 9, soorten: 2, laatste: `CC 21 = ${t % 128}` }, nu);
      }
    }
  }, 40);
  return () => clearInterval(id);
}
