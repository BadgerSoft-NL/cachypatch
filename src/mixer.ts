// Het mixer-model: de graph gezien als TotalMix' "edit mix". Bronnen (apps
// die afspelen, hardware-ingangen) en bestemmingen (hardware-uitgangen, apps
// die opnemen) zijn strips; tussen een bron en een bestemming ligt een route
// die aan, uit of "aangepast" is. De mixer leidt dat af uit de links die er
// liggen: hij bewaart zelf niets.
//
// Een hardware-node met veel kanalen (de Fireface in pro-audio: AUX0…17) wordt
// in stereoparen geknipt, zodat "Out 3/4" een eigen bestemming is.

import {
  ontkoppel,
  verbind,
  zetDoel,
  type Graaf,
  type Kabel,
  type Knoop,
  type Poort,
} from "./api";
import { apparaatTitel, poortLabel } from "./indeling";

export type Rij = "apps" | "hardware" | "bestemmingen";

export interface Strip {
  sleutel: string;
  knoop: Knoop;
  /** De kanalen, op volgorde van de driver. */
  poorten: Poort[];
  naam: string;
  onder: string;
  rij: Rij;
  /** Welke plekken in `knoop.volume` bij deze strip horen. */
  kanalen: number[];
  /** De hele node, of zijn eerste paar: daar kan `target.object` heen. */
  doelbaar: boolean;
  stil: boolean;
}

export type RouteStand =
  | { soort: "uit" }
  | { soort: "aan"; handmatig: boolean }
  /** Een patch die de mixer niet als aan/uit kan tonen. */
  | { soort: "aangepast"; uitleg: string };

export interface Route {
  stand: RouteStand;
  kabels: Kabel[];
}

export interface Mixer {
  apps: Strip[];
  hardware: Strip[];
  bestemmingen: Strip[];
  route: (bron: Strip, best: Strip) => Route;
  /** Alles wat van WirePlumber afwijkt, voor "Back to auto". */
  handwerk: { kabels: number[]; doelen: number[]; los: number[] };
}

export function bouwMixer(g: Graaf): Mixer {
  const wp = new Set(g.wireplumber);
  const audio = g.poorten.filter((p) => p.soort === "audio" && !p.monitor);
  const perKnoop = new Map<number, Poort[]>();
  for (const p of audio) {
    if (!perKnoop.has(p.knoop)) perKnoop.set(p.knoop, []);
    perKnoop.get(p.knoop)!.push(p);
  }
  const poortIds = new Set(audio.map((p) => p.id));
  const kabels = g.kabels.filter((k) => poortIds.has(k.uit_poort) && poortIds.has(k.in_poort));

  const apps: Strip[] = [];
  const hardware: Strip[] = [];
  const bestemmingen: Strip[] = [];

  for (const k of g.knopen) {
    const ps = perKnoop.get(k.id);
    if (!ps) continue;
    const klasse = k.klasse ?? "";
    const volg = (a: Poort, b: Poort) => (a.volgnummer ?? a.id) - (b.volgnummer ?? b.id);
    const uit = ps.filter((p) => !p.ingang).sort(volg);
    const ins = ps.filter((p) => p.ingang).sort(volg);
    const stil = k.stand !== "running";

    if (klasse.startsWith("Stream/")) {
      const naam = k.app ?? k.beschrijving ?? k.naam;
      const onder = (k.media && k.media !== naam ? k.media : null) ?? (stil ? "silent" : "stereo");
      if (uit.length)
        apps.push(strip(k, uit, uit.map((_, i) => i), "apps", naam, onder, true, stil));
      if (ins.length)
        bestemmingen.push(
          strip(k, ins, ins.map((_, i) => i), "bestemmingen", naam, `app · ${k.media ?? "in"}`, true, stil),
        );
      continue;
    }
    if (!klasse.startsWith("Audio/")) continue;
    hardware.push(...knip(k, uit, "hardware", stil));
    bestemmingen.push(...knip(k, ins, "bestemmingen", stil));
  }

  const opNaam = (a: Strip, b: Strip) => a.naam.localeCompare(b.naam) || a.knoop.id - b.knoop.id;
  apps.sort(opNaam);
  // Hardware in apparaatvolgorde laten: Out 1/2 vóór Out 3/4.
  const hw = (a: Strip, b: Strip) =>
    a.onder.localeCompare(b.onder) || a.knoop.id - b.knoop.id || a.kanalen[0] - b.kanalen[0];
  hardware.sort(hw);
  bestemmingen.sort((a, b) => {
    const appA = a.knoop.klasse?.startsWith("Stream/") ? 1 : 0;
    const appB = b.knoop.klasse?.startsWith("Stream/") ? 1 : 0;
    return appA - appB || (appA ? opNaam(a, b) : hw(a, b));
  });
  uniek([...apps, ...hardware, ...bestemmingen]);

  const route = (bron: Strip, best: Strip): Route => {
    const van = new Set(bron.poorten.map((p) => p.id));
    const naar = new Set(best.poorten.map((p) => p.id));
    const liggen = kabels.filter((k) => van.has(k.uit_poort) && naar.has(k.in_poort));
    if (liggen.length === 0) return { stand: { soort: "uit" }, kabels: [] };
    const moet = verwacht(bron, best);
    const zelfde =
      liggen.length === moet.length &&
      moet.every(([s, d]) => liggen.some((k) => k.uit_poort === s && k.in_poort === d));
    if (!zelfde) return { stand: { soort: "aangepast", uitleg: beschrijf(liggen, audio) }, kabels: liggen };
    const handmatig =
      liggen.some((k) => k.client === null || !wp.has(k.client)) ||
      bron.knoop.doel !== null ||
      best.knoop.doel !== null;
    return { stand: { soort: "aan", handmatig }, kabels: liggen };
  };

  // Handwerk: links die WirePlumber niet legde, en streams met een doel.
  const handKabels = kabels.filter((k) => k.client === null || !wp.has(k.client));
  const streams = g.knopen.filter((k) => (k.klasse ?? "").startsWith("Stream/") && perKnoop.has(k.id));
  const doelen = streams.filter((k) => k.doel !== null).map((k) => k.id);
  const geraakt = new Set(handKabels.flatMap((k) => [k.uit_knoop, k.in_knoop]));
  // Streams die na het opruimen geen enkele WirePlumber-link meer hebben:
  // die moet WirePlumber een duw krijgen, anders blijven ze los staan.
  const los = streams
    .filter((k) => geraakt.has(k.id) || k.doel !== null)
    .filter(
      (k) =>
        !kabels.some(
          (c) => c.client !== null && wp.has(c.client) && (c.uit_knoop === k.id || c.in_knoop === k.id),
        ),
    )
    .map((k) => k.id);

  return {
    apps,
    hardware,
    bestemmingen,
    route,
    handwerk: { kabels: handKabels.map((k) => k.id), doelen, los },
  };
}

function strip(
  knoop: Knoop,
  poorten: Poort[],
  kanalen: number[],
  rij: Rij,
  naam: string,
  onder: string,
  doelbaar: boolean,
  stil: boolean,
): Strip {
  const sleutel = `${knoop.naam}|${rij}|${poorten.map((p) => p.naam).join(",")}`;
  return { sleutel, knoop, poorten, naam, onder, rij, kanalen, doelbaar, stil };
}

/** Een apparaat met genummerde kanalen in stereoparen, anders in één strip. */
function knip(k: Knoop, ps: Poort[], rij: Rij, stil: boolean): Strip[] {
  if (ps.length === 0) return [];
  const titel = apparaatTitel(k);
  const genummerd = ps.length > 2 && ps.every((p) => /^AUX\d+$/.test(p.kanaal ?? ""));
  if (!genummerd) {
    const onder = rij === "hardware" ? "capture" : "playback";
    return [strip(k, ps, ps.map((_, i) => i), rij, titel, onder, true, stil)];
  }
  const uit: Strip[] = [];
  for (let i = 0; i < ps.length; i += 2) {
    const paar = ps.slice(i, i + 2);
    const nrs = paar.map((p) => Number(p.kanaal!.slice(3)) + 1);
    const naam = `${rij === "hardware" ? "In" : "Out"} ${nrs.join("/")}`;
    uit.push(strip(k, paar, paar.map((_, j) => i + j), rij, naam, titel, i === 0, stil));
  }
  return uit;
}

/** Twee Firefox-tabbladen geven dezelfde sleutel; maak ze uniek. */
function uniek(strips: Strip[]) {
  const gezien = new Map<string, number>();
  for (const s of strips) {
    const n = gezien.get(s.sleutel) ?? 0;
    gezien.set(s.sleutel, n + 1);
    if (n > 0) s.sleutel += `#${n}`;
  }
}

/** De links die een gewone route tussen twee strips zou hebben. */
function verwacht(bron: Strip, best: Strip): [number, number][] {
  const s = bron.poorten;
  const d = best.poorten;
  if (s.length === 1) return d.map((q) => [s[0].id, q.id]);
  if (d.length === 1) return s.map((p) => [p.id, d[0].id]);
  // Op kanaalnaam waar dat kan (FL→FL), anders op volgorde (FL→AUX0).
  return s.flatMap((p, i): [number, number][] => {
    const q = d.find((q) => q.kanaal === p.kanaal) ?? d[i];
    return q ? [[p.id, q.id]] : [];
  });
}

/** "only FL → Out 3", of de lijst als het er meer zijn. */
function beschrijf(kabels: Kabel[], poorten: Poort[]): string {
  const label = (id: number) => {
    const p = poorten.find((p) => p.id === id);
    return p ? poortLabel(p, "audio") : "?";
  };
  const delen = kabels.map((k) => `${label(k.uit_poort)} → ${label(k.in_poort)}`);
  return delen.length === 1 ? `only ${delen[0]}` : delen.join(", ");
}

/**
 * De groene knop. Uit → aan gaat via `target.object` als dat kan (de stream
 * heeft nog geen route en de bestemming is een hele node), anders met
 * handmatige links. Aan → uit haalt de links weg en wist een doel dat
 * ernaartoe wees, zodat WirePlumber hem niet terugzet.
 */
export function schakel(m: Mixer, g: Graaf, bron: Strip, best: Strip) {
  const r = m.route(bron, best);
  if (r.stand.soort === "aangepast") return; // dat is werk voor de patchbay
  if (r.stand.soort === "aan") {
    ontkoppel(r.kabels.map((k) => k.id));
    if (bron.knoop.doel !== null && bron.knoop.doel === String(best.knoop.serial))
      zetDoel(bron.knoop.id, null);
    if (best.knoop.doel !== null && best.knoop.doel === String(bron.knoop.serial))
      zetDoel(best.knoop.id, null);
    return;
  }
  const poortenVan = (k: Knoop, ingang: boolean) =>
    new Set(g.poorten.filter((p) => p.knoop === k.id && p.ingang === ingang).map((p) => p.id));
  const bronUit = poortenVan(bron.knoop, false);
  const bestIn = poortenVan(best.knoop, true);
  const bronStream = (bron.knoop.klasse ?? "").startsWith("Stream/Output");
  const bestStream = (best.knoop.klasse ?? "").startsWith("Stream/Input");
  if (bronStream && best.doelbaar && best.knoop.serial !== null) {
    if (!g.kabels.some((k) => bronUit.has(k.uit_poort))) {
      zetDoel(bron.knoop.id, String(best.knoop.serial));
      return;
    }
  }
  if (bestStream && bron.doelbaar && bron.knoop.serial !== null) {
    if (!g.kabels.some((k) => bestIn.has(k.in_poort))) {
      zetDoel(best.knoop.id, String(bron.knoop.serial));
      return;
    }
  }
  for (const [s, d] of verwacht(bron, best)) verbind(s, d);
}

/** Hoeveel er weggaat bij "Back to auto". */
export function telHandwerk(m: Mixer): number {
  return m.handwerk.kabels.length + m.handwerk.doelen.length;
}

/**
 * Alles terug aan WirePlumber: handmatige links weg, doelen gewist. Een stream
 * die daarna los staat krijgt `target.object = -1` (terug naar de standaard)
 * en dan niets: alleen wissen laat WirePlumber hem niet opnieuw bekijken.
 */
export function terugNaarAuto(m: Mixer) {
  ontkoppel(m.handwerk.kabels);
  const duw = new Set([...m.handwerk.doelen, ...m.handwerk.los]);
  for (const k of duw) zetDoel(k, "-1");
  setTimeout(() => duw.forEach((k) => zetDoel(k, null)), 500);
}

// --- Volume ---

export const UIT_DB = -90;
export const MAX_DB = 6;

export function stripDb(s: Strip): number | null {
  const v = s.knoop.volume;
  if (!v) return null;
  const waarden = s.kanalen.map((i) => v[i]).filter((x) => x !== undefined);
  if (waarden.length === 0) return null;
  const gem = waarden.reduce((a, b) => a + b, 0) / waarden.length;
  return gem <= 0 ? UIT_DB : Math.max(UIT_DB, 20 * Math.log10(gem));
}

/** Het nieuwe volume van de hele node, met alleen de kanalen van de strip anders. */
export function metDb(s: Strip, db: number): number[] | null {
  const v = s.knoop.volume;
  if (!v) return null;
  const lin = db <= UIT_DB ? 0 : Math.pow(10, db / 20);
  const nieuw = [...v];
  for (const i of s.kanalen) if (i < nieuw.length) nieuw[i] = lin;
  return nieuw;
}
