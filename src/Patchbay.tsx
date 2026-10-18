// Kabels zoals qpwgraph, maar geordend: links wat levert, rechts wat
// ontvangt. Modules zijn vrij te verslepen; "Rearrange" in de kop gooit de
// versleepte plekken weg en zet alles terug in de beginindeling.
//
// Een kabel leg je door van een stip naar een stip te slepen (welke kant op
// maakt niet uit); de stip waar je boven hangt licht op als loslaten mag.
// Klikken kiest een kabel (Shift: erbij), Delete haalt hem weg. Een bestaande
// kabel pak je bij zijn ingang op en zet je ergens anders neer; laat je hem
// in het niets los, dan is hij weg. Alles kan terug met Ctrl+Z.
//
// Alle maten liggen vast, dus de plek van elke poort volgt uit de rekensom
// hieronder en niet uit het meten van de DOM. Zo lopen kabels nooit een
// frame achter op een module die versleept wordt.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { haalKabelsWeg, legKabel, verplaatsKabel } from "./handelingen";
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

type Trek = {
  /** De vaste kant: de poort waar de kabel aan blijft hangen. */
  van: number;
  /** Of `van` een ingang is (dan sleep je het uitgangseinde). */
  ingang: boolean;
  x: number;
  y: number;
  /** De poort waar je nu boven hangt en die past: loslaten verbindt. */
  doel: number | null;
  /** Een bestaande kabel die je verplaatst: zijn oude ingang. */
  verplaatst: { kabel: number; oudIn: number } | null;
};

export function Patchbay({
  indeling,
  soort,
  plekken,
  zetPlek,
}: {
  indeling: Indeling;
  soort: "audio" | "midi";
  plekken: Plekken;
  zetPlek: (sleutel: string, plek: { x: number; y: number }) => void;
}) {
  const vlak = useRef<HTMLDivElement>(null);
  const tekenvlak = useRef<HTMLDivElement>(null);
  const [vlakBreedte, setBreedte] = useState(1200);
  const [boven, setBoven] = useState<number | null>(null);
  const [gekozen, setGekozen] = useState<Set<number>>(new Set());
  const [trek, setTrek] = useState<Trek | null>(null);

  useLayoutEffect(() => {
    const el = vlak.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBreedte(el.clientWidth));
    ro.observe(el);
    setBreedte(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Gekozen kabels die niet meer bestaan, vergeten.
  const bestaand = new Set(indeling.kabels.map((k) => k.id));
  const nuGekozen = [...gekozen].filter((id) => bestaand.has(id));

  // Delete of Backspace haalt de gekozen kabels weg, Escape kiest niets.
  useEffect(() => {
    const toets = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && nuGekozen.length) {
        e.preventDefault();
        haalKabelsWeg(nuGekozen);
        setGekozen(new Set());
      } else if (e.key === "Escape") {
        setGekozen(new Set());
        setTrek(null);
      }
    };
    window.addEventListener("keydown", toets);
    return () => window.removeEventListener("keydown", toets);
  });

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

  const onderkant = Math.max(400, ...modules.map((m) => plek(m).y + hoogte(m) + 40));
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

  /** De poort onder de muis, als je daar mag loslaten. */
  const doelOnder = (e: { clientX: number; clientY: number }, t: Trek): number | null => {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-poort]");
    if (!el) return null;
    const naar = Number(el.dataset.poort);
    if ((el.dataset.ingang === "true") === t.ingang) return null;
    if (t.verplaatst && naar === t.verplaatst.oudIn) return null;
    const [uit, ingang] = t.ingang ? [naar, t.van] : [t.van, naar];
    if (indeling.kabels.some((k) => k.uit === uit && k.in === ingang)) return null;
    return naar;
  };

  const pak = (e: React.PointerEvent, poort: number, ingang: boolean) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    tekenvlak.current!.setPointerCapture(e.pointerId);
    // Bij een ingang pak je een bestaande kabel op: de gekozen, of de enige.
    if (ingang) {
      const hier = indeling.kabels.filter((k) => k.in === poort);
      const k = hier.find((k) => gekozen.has(k.id)) ?? (hier.length === 1 ? hier[0] : undefined);
      if (k) {
        setTrek({ van: k.uit, ingang: false, ...binnen(e), doel: null, verplaatst: { kabel: k.id, oudIn: poort } });
        return;
      }
    }
    setTrek({ van: poort, ingang, ...binnen(e), doel: null, verplaatst: null });
  };

  const los = () => {
    if (!trek) return;
    setTrek(null);
    const { doel, verplaatst } = trek;
    if (verplaatst) {
      // Losgelaten op een andere ingang: verplaatsen. Ergens anders: los.
      if (doel !== null) verplaatsKabel([trek.van, verplaatst.oudIn], [trek.van, doel]);
      else haalKabelsWeg([verplaatst.kabel]);
      return;
    }
    if (doel === null) return;
    const [uit, ingang] = trek.ingang ? [doel, trek.van] : [trek.van, doel];
    legKabel(uit, ingang);
  };

  const losEinde = trek && (trek.doel !== null ? stippen.get(trek.doel)! : { x: trek.x, y: trek.y });

  return (
    <div className="patchbay" ref={vlak}>
      <div
        className={`vlak${trek ? " trekt" : ""}`}
        ref={tekenvlak}
        style={{ height: onderkant, width: rechterkant }}
        onPointerDown={(e) => {
          // Klikken op lege ruimte: niets meer gekozen.
          if (e.target === e.currentTarget || (e.target as Element).tagName === "svg") setGekozen(new Set());
        }}
        onPointerMove={(e) => {
          if (!trek) return;
          setTrek({ ...trek, ...binnen(e), doel: doelOnder(e, trek) });
        }}
        onPointerUp={los}
        onPointerCancel={() => setTrek(null)}
      >
        <svg className={`kabels ${soort}`} width={rechterkant} height={onderkant}>
          {indeling.kabels.map((k) => {
            if (trek?.verplaatst?.kabel === k.id) return null;
            const a = stippen.get(k.uit);
            const b = stippen.get(k.in);
            if (!a || !b) return null;
            const d = pad(a, b);
            const klas = [boven === k.id && "boven", gekozen.has(k.id) && "gekozen"].filter(Boolean).join(" ");
            return (
              <g key={k.id} className={klas || undefined}>
                <path className="lijn" d={d} />
                <path
                  className="raak"
                  d={d}
                  onPointerEnter={() => setBoven(k.id)}
                  onPointerLeave={() => setBoven((b) => (b === k.id ? null : b))}
                  onClick={(e) => {
                    setGekozen((g) => {
                      if (!e.shiftKey) return g.has(k.id) && g.size === 1 ? new Set() : new Set([k.id]);
                      const n = new Set(g);
                      if (n.has(k.id)) n.delete(k.id);
                      else n.add(k.id);
                      return n;
                    });
                  }}
                >
                  <title>Click to select, Delete to disconnect</title>
                </path>
              </g>
            );
          })}
          {trek && losEinde && stippen.get(trek.van) && (
            <path
              className={`nieuw${trek.doel !== null ? " raakt" : ""}`}
              d={trek.ingang ? pad(losEinde, stippen.get(trek.van)!) : pad(stippen.get(trek.van)!, losEinde)}
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
            doel={trek?.doel ?? null}
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
  doel,
}: {
  m: Module;
  plek: { x: number; y: number };
  zetPlek: (sleutel: string, plek: { x: number; y: number }) => void;
  pak: (e: React.PointerEvent, poort: number, ingang: boolean) => void;
  bronnen: (poort: number) => number[];
  /** De poort waar een kabel nu naartoe wil. */
  doel: number | null;
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
              className={`stip${p.verbonden ? " vol" : ""}${doel === p.id ? " doelwit" : ""}`}
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
