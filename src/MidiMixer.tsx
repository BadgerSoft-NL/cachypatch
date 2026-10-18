// De MIDI-mixer: hetzelfde "edit mix"-model als audio, met poorten als
// strips. Geen fader (MIDI heeft in PipeWire geen volume); op die plek de
// MIDI-meter. WirePlumber legt geen MIDI-links, dus geen "manual" en geen
// "Back to auto": wat er ligt, heb jij gelegd.

import type { ReactNode } from "react";
import { ontkoppel, verbind, type Graaf, type Kabel, type Poort } from "./api";
import { midiDing, poortLabel } from "./indeling";
import { MidiBlok } from "./MidiMeter";

export interface MidiStrip {
  sleutel: string;
  poort: Poort;
  naam: string;
  onder: string;
}

export interface MidiMixerModel {
  bronnen: MidiStrip[];
  bestemmingen: MidiStrip[];
  /** Alle MIDI-links, voor "Disconnect all". */
  kabels: Kabel[];
  route: (bron: MidiStrip, best: MidiStrip) => Kabel | undefined;
}

export function bouwMidiMixer(g: Graaf): MidiMixerModel {
  const knopen = new Map(g.knopen.map((k) => [k.id, k]));
  const midi = g.poorten.filter((p) => p.soort === "midi");
  const ids = new Set(midi.map((p) => p.id));
  const kabels = g.kabels.filter((k) => ids.has(k.uit_poort) && ids.has(k.in_poort));

  const strips = (ingang: boolean): MidiStrip[] => {
    const ps = midi.filter((p) => p.ingang === ingang && knopen.has(p.knoop));
    const dingen = ps
      .map((p) => ({ p, ding: midiDing(knopen.get(p.knoop)!, p) }))
      .filter(({ ding }) => !ding.doorvoer);
    const perDing = new Map<string, number>();
    for (const { ding } of dingen) perDing.set(ding.sleutel, (perDing.get(ding.sleutel) ?? 0) + 1);
    return dingen
      .map(({ p, ding }) => ({
        sleutel: `midi|${ding.sleutel}|${p.naam}`,
        poort: p,
        naam: ding.titel,
        onder:
          (ding.isApp ? "app" : "device") +
          ((perDing.get(ding.sleutel) ?? 0) > 1 ? ` · ${poortLabel(p, "midi")}` : ""),
      }))
      .sort((a, b) => a.naam.localeCompare(b.naam) || a.onder.localeCompare(b.onder));
  };

  return {
    bronnen: strips(false),
    bestemmingen: strips(true),
    kabels,
    route: (b, d) => kabels.find((k) => k.uit_poort === b.poort.id && k.in_poort === d.poort.id),
  };
}

export function MidiMixer({
  model,
  bewerkt,
  kiesBewerkt,
  verborgen,
  verberg,
}: {
  model: MidiMixerModel;
  bewerkt: MidiStrip | null;
  kiesBewerkt: (sleutel: string) => void;
  verborgen: Set<string>;
  verberg: (sleutel: string) => void;
}) {
  const zichtbaar = (s: MidiStrip) => !verborgen.has(s.sleutel);
  return (
    <main className="mixer">
      <section className="rij" aria-label="MIDI sources">
        <div className="rij-titel">Sources</div>
        <div className="strips">
          {model.bronnen.filter(zichtbaar).map((b) => {
            const kabel = bewerkt ? model.route(b, bewerkt) : undefined;
            const elders = model.bestemmingen
              .filter((d) => d.sleutel !== bewerkt?.sleutel && model.route(b, d))
              .map((d) => d.naam);
            return (
              <Kaart key={b.sleutel} s={b} verberg={verberg}>
                {bewerkt ? (
                  <button
                    className={`route${kabel ? " aan" : ""}`}
                    aria-pressed={!!kabel}
                    onClick={() =>
                      kabel ? ontkoppel([kabel.id]) : verbind(b.poort.id, bewerkt.poort.id)
                    }
                  >
                    {bewerkt.naam}
                  </button>
                ) : (
                  <div className="route-leeg" />
                )}
                <div className="regel">{elders.length ? `also → ${elders.join(", ")}` : ""}</div>
                <MidiBlok poorten={[b.poort.id]} />
              </Kaart>
            );
          })}
          {model.bronnen.length === 0 && <p className="zacht leeg-rij">No MIDI sources.</p>}
        </div>
      </section>
      <section className="rij laatste" aria-label="MIDI destinations">
        <div className="rij-titel">Destinations</div>
        <div className="strips">
          {model.bestemmingen.filter(zichtbaar).map((d) => {
            const gekozen = bewerkt?.sleutel === d.sleutel;
            const van = model.bronnen.filter((b) => model.route(b, d));
            return (
              <Kaart key={d.sleutel} s={d} verberg={verberg} gekozen={gekozen}>
                <button
                  className={`route${gekozen ? " aan" : " bewerk"}`}
                  aria-pressed={gekozen}
                  onClick={() => kiesBewerkt(d.sleutel)}
                >
                  {gekozen ? "editing" : "edit"}
                </button>
                <div className="regel">{van.length === 1 ? "1 source" : `${van.length} sources`}</div>
                <MidiBlok poorten={van.map((b) => b.poort.id)} bestemming />
              </Kaart>
            );
          })}
          {model.bestemmingen.length === 0 && <p className="zacht leeg-rij">No MIDI destinations.</p>}
        </div>
      </section>
    </main>
  );
}

function Kaart({
  s,
  gekozen,
  verberg,
  children,
}: {
  s: MidiStrip;
  gekozen?: boolean;
  verberg: (sleutel: string) => void;
  children: ReactNode;
}) {
  return (
    <article className={`strip midi${gekozen ? " gekozen" : ""}`}>
      <div className="strip-kop" title={`${s.naam} — ${s.onder}`}>
        <div className="strip-naam">{s.naam}</div>
        <div className="strip-onder">{s.onder}</div>
        <button className="verberg" aria-label={`Hide ${s.naam}`} title="Hide" onClick={() => verberg(s.sleutel)}>
          ×
        </button>
      </div>
      {children}
    </article>
  );
}
