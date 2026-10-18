// De transportbalk onder de kop, in beide mixers. Eén opname: start je hem in
// de ene tab, dan loopt hij ook in de andere. Wat er meedoet zijn de bussen
// waarop R aan staat: elke bus één WAV, en de MIDI-ingang één .mid.

import { useEffect, useState } from "react";
import { startOpname, stopOpname, type Graaf, type TransportStand } from "./api";
import type { KlokKeuze } from "./App";
import { midiDing, poortLabel } from "./indeling";

export function Transport({
  tab,
  graaf,
  stand,
  klok,
  zetKlok,
  gewapend,
  midiGewapend,
  midiNaarBus,
}: {
  tab: "audio" | "midi";
  graaf: Graaf;
  stand: TransportStand;
  klok: KlokKeuze;
  zetKlok: (k: KlokKeuze) => void;
  /** Namen van de gewapende audiobussen. */
  gewapend: string[];
  midiGewapend: boolean;
  /** Namen van de MIDI-bronnen die nu naar de Rec bus gaan. */
  midiNaarBus: string[];
}) {
  const tijd = useLopendeTijd(stand);
  const knopen = new Map(graaf.knopen.map((k) => [k.id, k]));
  const klokbronnen = graaf.poorten
    .filter((p) => p.soort === "midi" && !p.ingang && knopen.has(p.knoop))
    .map((p) => {
      const ding = midiDing(knopen.get(p.knoop)!, p);
      return { id: p.id, naam: ding.titel, poort: poortLabel(p, "midi"), doorvoer: ding.doorvoer };
    })
    .filter((b) => !b.doorvoer);
  const extern = klok.klok !== null;
  const zet = (o: Partial<KlokKeuze>) => zetKlok({ ...klok, ...o });
  const rate = graaf.rate ? `${Math.round(graaf.rate / 1000)}k` : "?";

  return (
    <section className="transport" aria-label="Recording">
      <button
        className={`opneem${stand.bezig ? " bezig" : ""}`}
        aria-pressed={stand.bezig}
        onClick={() => (stand.bezig ? stopOpname() : startOpname())}
      >
        <span className="rondje" aria-hidden="true" />
        {stand.bezig ? "Stop" : "Record"}
      </button>
      <div className="tijd-vak">
        <span className={`tijd${stand.bezig ? " bezig" : ""}`}>{tijd}</span>
        <span className="map">{stand.map ?? "~/Recordings/"}</span>
      </div>
      {tab === "audio" && (
        <div className="groep" role="group" aria-label="Armed buses">
          <span className="label">Armed</span>
          <span className={gewapend.length ? "gewapend" : "zacht"}>{gewapend.join(", ") || "none"}</span>
          <span className="mono zacht">WAV · 32f · {rate}</span>
        </div>
      )}
      <div className="groep" role="group" aria-label="MIDI">
        <span className="label">MIDI</span>
        <span className={midiGewapend ? "gewapend" : "zacht"}>{midiGewapend ? "armed" : "off"}</span>
        <span className="mono zacht">
          {midiGewapend ? midiNaarBus.join(", ") || "nothing routed" : "SMF type 1 · track per source"}
        </span>
      </div>
      <div className="groep" role="group" aria-label="Clock">
        <label className="label" htmlFor="klok">
          Clock
        </label>
        <select
          id="klok"
          value={klok.klok ?? ""}
          onChange={(e) => zet({ klok: e.target.value === "" ? null : Number(e.target.value) })}
        >
          <option value="">Internal</option>
          {klokbronnen.map((b) => (
            <option key={b.id} value={b.id}>
              External: {b.naam}
              {b.poort && !/^(out|in)$/.test(b.poort) ? ` · ${b.poort}` : ""}
            </option>
          ))}
        </select>
        {extern ? (
          <>
            <span className="bpm">{stand.klok.bpm ? stand.klok.bpm.toFixed(1) : "—"}</span>
            <span className="zacht">BPM</span>
            <span className={`lock${stand.klok.lock ? " aan" : ""}`}>{stand.klok.lock ? "lock" : "no clock"}</span>
            <Vinkje aan={klok.start_stop} zet={(v) => zet({ start_stop: v })} tekst="Start/stop on MIDI Start" />
          </>
        ) : (
          <>
            <span className="bpm">120.0</span>
            <span className="zacht">BPM · fixed tempo</span>
          </>
        )}
      </div>
      {stand.fout && <span className="fout">{stand.fout}</span>}
    </section>
  );
}

function Vinkje({ aan, zet, tekst }: { aan: boolean; zet: (v: boolean) => void; tekst: string }) {
  return (
    <label className="vinkje">
      <input type="checkbox" checked={aan} onChange={(e) => zet(e.target.checked)} />
      {tekst}
    </label>
  );
}

/** De lopende tijd, tussen twee meldingen door bijgeteld. */
function useLopendeTijd(stand: TransportStand): string {
  const [, tik] = useState(0);
  const [ontvangen, setOntvangen] = useState(() => performance.now());
  useEffect(() => setOntvangen(performance.now()), [stand]);
  useEffect(() => {
    if (!stand.bezig) return;
    const id = setInterval(() => tik((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [stand.bezig]);
  const s = stand.bezig ? stand.seconden + (performance.now() - ontvangen) / 1000 : stand.seconden;
  const u = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(u).padStart(2, "0")}:${String(m).padStart(2, "0")}:${sec.toFixed(1).padStart(4, "0")}`;
}
