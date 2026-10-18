// Ongedaan maken en opnieuw doen. Elke stap is een paar handelingen: opnieuw
// en terug. Die kijken pas bij het uitvoeren naar de graph zoals hij dan is,
// want link-ids veranderen: een link die terugkomt is een nieuwe link.
//
// Alleen wat CachyPatch zelf deed staat erin. Verandert iets anders de graph
// intussen (een app sluit), dan doet terug wat nog kan.

import { useSyncExternalStore } from "react";

interface Stap {
  naam: string;
  opnieuw: () => void;
  terug: () => void;
}

const MAX = 200;
const terugLijst: Stap[] = [];
const vooruitLijst: Stap[] = [];
const luisteraars = new Set<() => void>();
let versie = 0;

function meld() {
  versie++;
  luisteraars.forEach((f) => f());
}

/** Voert `opnieuw` uit en onthoudt hoe het terug moet. */
export function doe(naam: string, opnieuw: () => void, terug: () => void) {
  opnieuw();
  vastleggen(naam, opnieuw, terug);
}

/** Onthoudt een stap die al gebeurd is (een fader die is losgelaten). */
export function vastleggen(naam: string, opnieuw: () => void, terug: () => void) {
  terugLijst.push({ naam, opnieuw, terug });
  if (terugLijst.length > MAX) terugLijst.shift();
  vooruitLijst.length = 0;
  meld();
}

// Undo en redo kijken naar de graph zoals die binnenkwam. Twee keer snel na
// elkaar zou de tweede een graph zien waarin de eerste nog niet verwerkt is;
// daarom in een rij, met even tijd ertussen.
const RUST_MS = 250;
const rij: (() => void)[] = [];
let bezig = false;

function plan(f: () => void) {
  rij.push(f);
  if (!bezig) volgende();
}

function volgende() {
  const f = rij.shift();
  if (!f) {
    bezig = false;
    return;
  }
  bezig = true;
  f();
  setTimeout(volgende, RUST_MS);
}

export function maakOngedaan() {
  plan(() => {
    const s = terugLijst.pop();
    if (!s) return;
    s.terug();
    vooruitLijst.push(s);
    meld();
  });
}

export function herhaal() {
  plan(() => {
    const s = vooruitLijst.pop();
    if (!s) return;
    s.opnieuw();
    terugLijst.push(s);
    meld();
  });
}

export interface Stand {
  terug: string | null;
  vooruit: string | null;
}

let stand: Stand = { terug: null, vooruit: null };
let standVersie = -1;

function lees(): Stand {
  if (standVersie !== versie) {
    standVersie = versie;
    stand = {
      terug: terugLijst[terugLijst.length - 1]?.naam ?? null,
      vooruit: vooruitLijst[vooruitLijst.length - 1]?.naam ?? null,
    };
  }
  return stand;
}

export function useGeschiedenis(): Stand {
  return useSyncExternalStore(
    (f) => {
      luisteraars.add(f);
      return () => luisteraars.delete(f);
    },
    lees,
  );
}
