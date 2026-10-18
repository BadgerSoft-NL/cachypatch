// Niveaumeters. De pieken komen 25 keer per seconde binnen (event "pieken");
// één animatielus zet de balkjes direct in de DOM, zodat React daarvoor niet
// hoeft te hertekenen.
//
// Schaal in dB: −60 dBFS onderaan, 0 bovenaan. Vallen gaat met ongeveer
// 24 dB per seconde, de piek blijft een seconde staan.

import { listen } from "@tauri-apps/api/event";
import type { Graaf } from "./api";

const ONDER = -60;
const VAL_PER_S = 24;
const HOUD_MS = 1000;

/** Laatste piek per node, lineair, per kanaal. */
const binnen = new Map<number, number[]>();

interface Balk {
  el: HTMLElement;
  piek?: HTMLElement;
  knoop: number;
  /** Welke kanalen; bij meer dan één telt de hoogste. */
  kanalen: number[];
  stand: number; // 0..1
  houd: number; // 0..1
  houdTot: number;
}

const balken = new Set<Balk>();

export function dbStand(lin: number): number {
  if (lin <= 0) return 0;
  const db = 20 * Math.log10(lin);
  return Math.min(1, Math.max(0, (db - ONDER) / -ONDER));
}

/**
 * Hangt een balkje aan de meter van `knoop`. `el` krijgt zijn hoogte (of
 * breedte, met `liggend`) als percentage; `piek` de plek van de piekstreep.
 * Geeft een functie om weer los te koppelen.
 */
export function koppel(el: HTMLElement, knoop: number, kanalen: number[], piek?: HTMLElement) {
  const b: Balk = { el, piek, knoop, kanalen, stand: 0, houd: 0, houdTot: 0 };
  balken.add(b);
  start();
  return () => {
    balken.delete(b);
  };
}

let loopt = false;
let vorige = 0;

function start() {
  if (loopt) return;
  loopt = true;
  vorige = performance.now();
  requestAnimationFrame(tik);
}

function tik(nu: number) {
  const dt = Math.min(0.1, (nu - vorige) / 1000);
  vorige = nu;
  for (const b of balken) {
    const p = binnen.get(b.knoop);
    let lin = 0;
    if (p) for (const k of b.kanalen) lin = Math.max(lin, p[k] ?? 0);
    const doel = dbStand(lin);
    b.stand = doel >= b.stand ? doel : Math.max(doel, b.stand - (VAL_PER_S / -ONDER) * dt);
    if (doel >= b.houd || nu > b.houdTot) {
      b.houd = doel;
      b.houdTot = nu + HOUD_MS;
    }
    b.el.style.height = `${b.stand * 100}%`;
    b.el.classList.toggle("vol", b.stand >= 0.99);
    if (b.piek) {
      b.piek.style.bottom = `${b.houd * 100}%`;
      b.piek.style.opacity = b.houd > 0.02 ? "1" : "0";
    }
  }
  if (balken.size) requestAnimationFrame(tik);
  else loopt = false;
}

const inTauri = "__TAURI_INTERNALS__" in window;

/** Begint met luisteren; zonder Tauri bedenkt hij pieken voor wat speelt. */
export function volgPieken(graaf: () => Graaf): () => void {
  if (inTauri) {
    let stop: (() => void) | undefined;
    let weg = false;
    listen<Record<string, number[]>>("pieken", (e) => {
      for (const [id, v] of Object.entries(e.payload)) binnen.set(Number(id), v);
    }).then((s) => (weg ? s() : (stop = s)));
    return () => {
      weg = true;
      stop?.();
    };
  }
  // Nep: wat "running" is maakt geluid, met wat beweging erin.
  let t = 0;
  const id = setInterval(() => {
    t += 0.04;
    const g = graaf();
    binnen.clear();
    for (const k of g.knopen) {
      if (k.stand !== "running") continue;
      const n = g.poorten.filter((p) => p.knoop === k.id && p.soort === "audio" && !p.monitor).length;
      const basis = 0.25 + 0.2 * Math.sin(t * 1.3 + k.id) ** 2;
      binnen.set(
        k.id,
        Array.from({ length: n }, (_, i) => (i < 2 ? basis * (0.6 + 0.4 * Math.random()) * (k.volume?.[i] ?? 1) : 0)),
      );
    }
  }, 40);
  return () => clearInterval(id);
}
