// Wat je in de mixers en de patchbay doet, als stappen die ongedaan kunnen.
// Alles werkt op poortparen (uit → in), niet op link-ids: een link die terug
// komt, krijgt een nieuw id.

import {
  laatsteGraaf,
  ontkoppel,
  verbind,
  zetDoel,
  zetMute,
  zetVolume,
} from "./api";
import { doe, vastleggen } from "./geschiedenis";
import { bouwMixer, schakel, terugNaarAuto } from "./mixer";

type Paar = [number, number];

const g = laatsteGraaf;

function legPaar([uit, naar]: Paar) {
  if (!g().kabels.some((k) => k.uit_poort === uit && k.in_poort === naar)) verbind(uit, naar);
}

function haalPaar([uit, naar]: Paar) {
  ontkoppel(g().kabels.filter((k) => k.uit_poort === uit && k.in_poort === naar).map((k) => k.id));
}

function paren(kabels: number[]): Paar[] {
  return kabels.flatMap((id) => {
    const k = g().kabels.find((k) => k.id === id);
    return k ? [[k.uit_poort, k.in_poort] as Paar] : [];
  });
}

export function legKabel(uit: number, naar: number) {
  doe("Connect", () => legPaar([uit, naar]), () => haalPaar([uit, naar]));
}

export function haalKabelsWeg(kabels: number[]) {
  const p = paren(kabels);
  if (p.length === 0) return;
  doe(
    p.length === 1 ? "Disconnect" : `Disconnect ${p.length}`,
    () => p.forEach(haalPaar),
    () => p.forEach(legPaar),
  );
}

/** Een kabeleinde naar een andere poort: de oude link weg, de nieuwe erbij. */
export function verplaatsKabel(oud: Paar, nieuw: Paar) {
  doe(
    "Move cable",
    () => {
      haalPaar(oud);
      legPaar(nieuw);
    },
    () => {
      haalPaar(nieuw);
      legPaar(oud);
    },
  );
}

/** De groene knop in de audio-mixer. Elke kant zet de route op een vaste
 *  stand, en doet niets als hij daar al staat. */
export function schakelRoute(bron: string, best: string, aan: boolean) {
  const zet = (moet: boolean) => () => {
    const graaf = g();
    const m = bouwMixer(graaf);
    const b = [...m.apps, ...m.hardware].find((s) => s.sleutel === bron);
    const d = m.bestemmingen.find((s) => s.sleutel === best);
    if (!b || !d) return;
    const nu = m.route(b, d).stand.soort === "aan";
    if (nu !== moet) schakel(m, graaf, b, d);
  };
  doe(aan ? "Route off" : "Route on", zet(!aan), zet(aan));
}

export function terugNaarAutoStap() {
  const graaf = g();
  const m = bouwMixer(graaf);
  const weg = paren(m.handwerk.kabels);
  const doelen = m.handwerk.doelen.map((id) => [id, graaf.knopen.find((k) => k.id === id)?.doel ?? null] as const);
  const herstel = m.handwerk.herstel;
  doe(
    "Back to auto",
    () => terugNaarAuto(bouwMixer(g())),
    () => {
      herstel.forEach(haalPaar);
      weg.forEach(legPaar);
      doelen.forEach(([id, doel]) => zetDoel(id, doel));
    },
  );
}

/** Een fader die is losgelaten: het volume staat al, alleen onthouden. */
export function volumeVastleggen(knoop: number, oud: number[], nieuw: number[]) {
  if (oud.every((v, i) => Math.abs(v - (nieuw[i] ?? v)) < 1e-6)) return;
  vastleggen(
    "Volume",
    () => zetVolume(knoop, nieuw),
    () => zetVolume(knoop, oud),
  );
}

export function muteStap(knoop: number, mute: boolean) {
  doe(mute ? "Mute" : "Unmute", () => zetMute(knoop, mute), () => zetMute(knoop, !mute));
}

/** Een MIDI-route aan of uit: één link. */
export function schakelMidi(uit: number, naar: number, aan: boolean) {
  if (aan) doe("MIDI route off", () => haalPaar([uit, naar]), () => legPaar([uit, naar]));
  else legKabel(uit, naar);
}
