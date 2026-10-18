// Kabels zoals qpwgraph, maar geordend: links wat levert, rechts wat
// ontvangt. Modules zijn vrij te verslepen; "Rearrange" in de kop gooit de
// versleepte plekken weg en zet alles terug in de beginindeling.
//
// Een kabel leg je door van een stip naar een stip te slepen (welke kant op
// maakt niet uit); klikken op een kabel haalt hem weg.
//
// Alle maten liggen vast, dus de plek van elke poort volgt uit de rekensom
// hieronder en niet uit het meten van de DOM. Zo lopen kabels nooit een
// frame achter op een module die versleept wordt.

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ontkoppel, verbind } from "./api";
import type { Indeling, Module } from "./indeling";
import { IcoonTegel } from "./iconen";
import { MeterBalk } from "./Meter";
import { MidiRegel } from "./MidiMeter";

const KOP = 45; // 44 + de rand eronder
// MIDI-modules zijn breder en hoger: elke poort heeft een eigen meterregel.
const MAAT = {
  audio: { breedte: 280, rij: 28, stip: 14 },
  midi: { breedte: 340, rij: 56, stip: 17 },
  anders: { breedte: 280, rij: 28, stip: 14 },
};
const BINNEN = 4;
const RAND = 1;
const TUSSEN = 13;
// Tussen twee soorten (apps, hardware) iets meer lucht. Geen kopjes: modules
// zijn versleepbaar, dus een vast label zou al snel boven het verkeerde staan.
const NA_GROEP = 34;
const MARGE = 60;
const BOVEN = 22;
const MIN_MIDDEN = 300;

export type Plekken = Record<string, { x: number; y: number }>;

// De laatst aangeraakte module ligt bovenop.
let bovenste = 1;

const hoogte = (m: Module) =>
  RAND + KOP + BINNEN + MAAT[m.soort].rij * m.poorten.length + BINNEN + RAND;
const poortY = (m: Module, i: number) => RAND + KOP + BINNEN + MAAT[m.soort].rij * i + MAAT[m.soort].stip;
const breedte = (m: Module) => MAAT[m.soort].breedte;

export function Patchbay({
  indeling,
  plekken,
  zetPlek,
}: {
  indeling: Indeling;
  plekken: Plekken;
  zetPlek: (sleutel: string, plek: { x: number; y: number }) => void;
}) {
  const vlak = useRef<HTMLDivElement>(null);
  const tekenvlak = useRef<HTMLDivElement>(null);
  const [vlakBreedte, setBreedte] = useState(1200);
  const [boven, setBoven] = useState<number | null>(null);
  // Een kabel in de maak: van welke poort, en waar de muis nu is.
  const [trek, setTrek] = useState<{ van: number; ingang: boolean; x: number; y: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    const el = vlak.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBreedte(el.clientWidth));
    ro.observe(el);
    setBreedte(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // De beginindeling: twee kolommen, per soort onder elkaar.
  const begin = useMemo(() => {
    const kolom = Math.max(280, ...indeling.groepen.flatMap((g) => g.modules.map(breedte)));
    const rechtsX = Math.max(MARGE + kolom + MIN_MIDDEN, vlakBreedte - MARGE - kolom);
    const y = { links: BOVEN, rechts: BOVEN };
    const begin: Plekken = {};
    for (const g of indeling.groepen) {
      const x = g.kant === "links" ? MARGE : rechtsX;
      for (const m of g.modules) {
        begin[m.sleutel] = { x, y: y[g.kant] };
        y[g.kant] += hoogte(m) + TUSSEN;
      }
      y[g.kant] += NA_GROEP - TUSSEN;
    }
    return begin;
  }, [indeling, vlakBreedte]);

  const modules = indeling.groepen.flatMap((g) => g.modules);
  const plek = (m: Module) => plekken[m.sleutel] ?? begin[m.sleutel];

  // Waar elke poort zijn stip heeft.
  const stippen = new Map<number, { x: number; y: number }>();
  for (const m of modules) {
    const p = plek(m);
    m.poorten.forEach((r, i) =>
      stippen.set(r.id, { x: m.kant === "links" ? p.x + breedte(m) : p.x, y: p.y + poortY(m, i) }),
    );
  }

  const onderkant = Math.max(
    400,
    ...modules.map((m) => plek(m).y + hoogte(m) + 40),
  );
  const rechterkant = Math.max(vlakBreedte, ...modules.map((m) => plek(m).x + breedte(m) + MARGE));

  // Wat er bij een ingang binnenkomt: de uitgangen die erheen gaan.
  const bronnen = (poort: number) =>
    indeling.kabels.filter((k) => k.in === poort).map((k) => k.uit);

  const binnen = (e: { clientX: number; clientY: number }) => {
    const r = tekenvlak.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pad = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const d = Math.max(60, Math.abs(b.x - a.x) / 2);
    return `M${a.x} ${a.y} C ${a.x + d} ${a.y}, ${b.x - d} ${b.y}, ${b.x} ${b.y}`;
  };

  const pak = (e: React.PointerEvent, van: number, ingang: boolean) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    tekenvlak.current!.setPointerCapture(e.pointerId);
    setTrek({ van, ingang, ...binnen(e) });
  };
  const los = (e: React.PointerEvent) => {
    if (!trek) return;
    setTrek(null);
    const doel = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-poort]");
    if (!doel) return;
    const naar = Number(doel.dataset.poort);
    if ((doel.dataset.ingang === "true") === trek.ingang) return;
    const [uit, ingang] = trek.ingang ? [naar, trek.van] : [trek.van, naar];
    if (indeling.kabels.some((k) => k.uit === uit && k.in === ingang)) return;
    verbind(uit, ingang);
  };

  return (
    <div className="patchbay" ref={vlak}>
      <div
        className={`vlak${trek ? " trekt" : ""}`}
        ref={tekenvlak}
        style={{ height: onderkant, width: rechterkant }}
        onPointerMove={(e) => trek && setTrek({ ...trek, ...binnen(e) })}
        onPointerUp={los}
        onPointerCancel={() => setTrek(null)}
      >
        <svg className="kabels" width={rechterkant} height={onderkant}>
          {indeling.kabels.map((k) => {
            const a = stippen.get(k.uit);
            const b = stippen.get(k.in);
            if (!a || !b) return null;
            const d = pad(a, b);
            return (
              <g key={k.id} className={boven === k.id ? "boven" : undefined}>
                <path d={d} />
                <path
                  className="raak"
                  d={d}
                  onPointerEnter={() => setBoven(k.id)}
                  onPointerLeave={() => setBoven((b) => (b === k.id ? null : b))}
                  onClick={() => {
                    setBoven(null);
                    ontkoppel([k.id]);
                  }}
                >
                  <title>Click to disconnect</title>
                </path>
              </g>
            );
          })}
          {trek && stippen.get(trek.van) && (
            <path
              className="nieuw"
              d={
                trek.ingang
                  ? pad({ x: trek.x, y: trek.y }, stippen.get(trek.van)!)
                  : pad(stippen.get(trek.van)!, { x: trek.x, y: trek.y })
              }
            />
          )}
        </svg>
        {modules.map((m) => (
          <ModuleKaart
            key={m.sleutel}
            m={m}
            plek={plek(m)}
            zetPlek={zetPlek}
            pak={pak}
            bronnen={bronnen}
          />
        ))}
      </div>
    </div>
  );
}

function ModuleKaart({
  m,
  plek,
  zetPlek,
  pak,
  bronnen,
}: {
  m: Module;
  plek: { x: number; y: number };
  zetPlek: (sleutel: string, plek: { x: number; y: number }) => void;
  pak: (e: React.PointerEvent, poort: number, ingang: boolean) => void;
  bronnen: (poort: number) => number[];
}) {
  const sleep = useRef<{ dx: number; dy: number } | null>(null);
  const [sleept, setSleept] = useState(false);
  const [laag, setLaag] = useState(1);

  return (
    <section
      className={`module${m.stil ? " stil" : ""}${sleept ? " sleept" : ""}`}
      style={{ left: plek.x, top: plek.y, width: breedte(m), zIndex: laag }}
      aria-label={m.titel}
    >
      <header
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          sleep.current = { dx: e.clientX - plek.x, dy: e.clientY - plek.y };
          setSleept(true);
          setLaag(++bovenste);
        }}
        onPointerMove={(e) => {
          const s = sleep.current;
          if (!s) return;
          zetPlek(m.sleutel, {
            x: Math.max(0, e.clientX - s.dx),
            y: Math.max(0, e.clientY - s.dy),
          });
        }}
        onPointerUp={() => {
          sleep.current = null;
          setSleept(false);
        }}
      >
        <IcoonTegel icoon={m.icoon} />
        <div className="namen">
          <div className="titel">{m.titel}</div>
          <div className="onder">{m.onder}</div>
        </div>
        {m.meter.length > 0 && (
          <div className="mini-meters" aria-hidden="true">
            {m.meter.map((k, i) => (
              <MeterBalk key={i} knoop={m.knoop} kanalen={k} klein />
            ))}
          </div>
        )}
      </header>
      <ul className="poorten">
        {m.poorten.map((p) => (
          <li key={p.id} className={`${m.kant} ${m.soort}`}>
            {m.soort === "midi" ? (
              <MidiRegel
                poort={m.kant === "rechts" ? bronnen(p.id) : [p.id]}
                label={p.label}
                ingang={m.kant === "rechts"}
              />
            ) : (
              p.label
            )}
            <span
              className={`stip${p.verbonden ? " vol" : ""}`}
              data-poort={p.id}
              data-ingang={m.kant === "rechts"}
              onPointerDown={(e) => pak(e, p.id, m.kant === "rechts")}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
