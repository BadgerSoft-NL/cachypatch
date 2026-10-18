// Kabels zoals qpwgraph, maar geordend: links wat levert, rechts wat
// ontvangt. Modules zijn vrij te verslepen; "Rearrange" in de kop gooit de
// versleepte plekken weg en zet alles terug in de beginindeling.
//
// Alle maten liggen vast, dus de plek van elke poort volgt uit de rekensom
// hieronder en niet uit het meten van de DOM. Zo lopen kabels nooit een
// frame achter op een module die versleept wordt.

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Indeling, Module } from "./indeling";
import { IcoonTegel } from "./iconen";

export const BREEDTE = 280;
const KOP = 45; // 44 + de rand eronder
const RIJ = 28;
const BINNEN = 4;
const RAND = 1;
const TUSSEN = 13;
const KOPJE = 26;
const NA_GROEP = 22;
const MARGE = 60;
const BOVEN = 22;
const MIN_MIDDEN = 300;

export type Plekken = Record<string, { x: number; y: number }>;

// De laatst aangeraakte module ligt bovenop.
let bovenste = 1;

const hoogte = (m: Module) => RAND + KOP + BINNEN + RIJ * m.poorten.length + BINNEN + RAND;
const poortY = (i: number) => RAND + KOP + BINNEN + RIJ * i + RIJ / 2;

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
  const [breedte, setBreedte] = useState(1200);

  useLayoutEffect(() => {
    const el = vlak.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBreedte(el.clientWidth));
    ro.observe(el);
    setBreedte(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // De beginindeling: twee kolommen, kopjes erboven, modules eronder.
  const { begin, kopjes } = useMemo(() => {
    const rechtsX = Math.max(MARGE + BREEDTE + MIN_MIDDEN, breedte - MARGE - BREEDTE);
    const y = { links: BOVEN, rechts: BOVEN };
    const begin: Plekken = {};
    const kopjes: { titel: string; x: number; y: number }[] = [];
    for (const g of indeling.groepen) {
      const x = g.kant === "links" ? MARGE : rechtsX;
      kopjes.push({ titel: g.titel, x, y: y[g.kant] });
      y[g.kant] += KOPJE;
      for (const m of g.modules) {
        begin[m.sleutel] = { x, y: y[g.kant] };
        y[g.kant] += hoogte(m) + TUSSEN;
      }
      y[g.kant] += NA_GROEP - TUSSEN;
    }
    return { begin, kopjes };
  }, [indeling, breedte]);

  const modules = indeling.groepen.flatMap((g) => g.modules);
  const plek = (m: Module) => plekken[m.sleutel] ?? begin[m.sleutel];

  // Waar elke poort zijn stip heeft.
  const stippen = new Map<number, { x: number; y: number }>();
  for (const m of modules) {
    const p = plek(m);
    m.poorten.forEach((r, i) =>
      stippen.set(r.id, { x: m.kant === "links" ? p.x + BREEDTE : p.x, y: p.y + poortY(i) }),
    );
  }

  const onderkant = Math.max(
    400,
    ...modules.map((m) => plek(m).y + hoogte(m) + 40),
    ...kopjes.map((k) => k.y + 40),
  );
  const rechterkant = Math.max(breedte, ...modules.map((m) => plek(m).x + BREEDTE + MARGE));

  return (
    <div className="patchbay" ref={vlak}>
      <div className="vlak" style={{ height: onderkant, width: rechterkant }}>
        <svg className="kabels" width={rechterkant} height={onderkant} aria-hidden="true">
          {indeling.kabels.map((k) => {
            const a = stippen.get(k.uit);
            const b = stippen.get(k.in);
            if (!a || !b) return null;
            const d = Math.max(60, Math.abs(b.x - a.x) / 2);
            return (
              <path
                key={k.id}
                d={`M${a.x} ${a.y} C ${a.x + d} ${a.y}, ${b.x - d} ${b.y}, ${b.x} ${b.y}`}
              />
            );
          })}
        </svg>
        {kopjes.map((k) => (
          <div key={k.titel} className="kopje" style={{ left: k.x, top: k.y }}>
            {k.titel}
          </div>
        ))}
        {modules.map((m) => (
          <ModuleKaart key={m.sleutel} m={m} plek={plek(m)} zetPlek={zetPlek} />
        ))}
      </div>
    </div>
  );
}

function ModuleKaart({
  m,
  plek,
  zetPlek,
}: {
  m: Module;
  plek: { x: number; y: number };
  zetPlek: (sleutel: string, plek: { x: number; y: number }) => void;
}) {
  const sleep = useRef<{ dx: number; dy: number } | null>(null);
  const [sleept, setSleept] = useState(false);
  const [laag, setLaag] = useState(1);

  return (
    <section
      className={`module${m.stil ? " stil" : ""}${sleept ? " sleept" : ""}`}
      style={{ left: plek.x, top: plek.y, width: BREEDTE, zIndex: laag }}
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
      </header>
      <ul className="poorten">
        {m.poorten.map((p) => (
          <li key={p.id} className={m.kant}>
            {p.label}
            <span className={`stip${p.verbonden ? " vol" : ""}`} />
          </li>
        ))}
      </ul>
    </section>
  );
}
