import { useEffect, useMemo, useState } from "react";
import { LEEG, volgGraaf, type Graaf } from "./api";
import { deelIn } from "./indeling";
import { Patchbay, type Plekken } from "./Patchbay";

type Tab = "audio" | "midi";
type Weergave = "mixer" | "patchbay";

export default function App() {
  const [graaf, setGraaf] = useState<Graaf>(LEEG);
  const [tab, setTab] = useState<Tab>("audio");
  const [weergave, setWeergave] = useState<Weergave>("patchbay");
  // Versleepte plekken, per tab. Alleen voor deze sessie: routing en indeling
  // zijn live, er wordt niets bewaard.
  const [plekken, setPlekken] = useState<Record<Tab, Plekken>>({ audio: {}, midi: {} });

  useEffect(() => volgGraaf(setGraaf), []);

  const indeling = useMemo(() => deelIn(graaf, tab), [graaf, tab]);

  return (
    <div className="app">
      <header className="kop">
        <div className="merk">
          <span className="naam">CachyPatch</span>
          <span className="pw">PipeWire</span>
        </div>
        <span className={`status${graaf.verbonden ? "" : " los"}`}>
          <span className="lamp" />
          {graaf.verbonden ? "Connected" : "Not connected"}
        </span>
        {graaf.rate && (
          <span className="klok">
            {(graaf.rate / 1000).toFixed(1)} kHz · quantum {graaf.quantum ?? "?"}
          </span>
        )}
        <Keuze
          label="Signal type"
          waarde={tab}
          opties={[
            ["audio", "Audio"],
            ["midi", "MIDI"],
          ]}
          kies={setTab}
        />
        <div className="vul" />
        <Keuze
          label="View"
          waarde={weergave}
          opties={[
            ["mixer", "Mixer"],
            ["patchbay", "Patchbay"],
          ]}
          kies={setWeergave}
        />
        {weergave === "patchbay" && (
          <button className="knop" onClick={() => setPlekken((p) => ({ ...p, [tab]: {} }))}>
            Rearrange
          </button>
        )}
      </header>

      {weergave === "patchbay" ? (
        <>
          <Patchbay
            indeling={indeling}
            plekken={plekken[tab]}
            zetPlek={(sleutel, plek) =>
              setPlekken((p) => ({ ...p, [tab]: { ...p[tab], [sleutel]: plek } }))
            }
          />
          <footer className="voet">
            <span className="legenda">
              <span className="lijn" /> connected
            </span>
            <span className="legenda">
              <span className="stip" /> not connected
            </span>
            <span className="vul" />
            {indeling.verborgen.length > 0 && (
              <span className="zacht">Hidden: {indeling.verborgen.join(", ")}</span>
            )}
          </footer>
        </>
      ) : (
        <main className="leeg">
          <p>The {tab === "audio" ? "audio" : "MIDI"} mixer is not built yet.</p>
          <p className="zacht">Use the patchbay to see the graph.</p>
        </main>
      )}
    </div>
  );
}

function Keuze<T extends string>({
  label,
  waarde,
  opties,
  kies,
}: {
  label: string;
  waarde: T;
  opties: [T, string][];
  kies: (w: T) => void;
}) {
  return (
    <nav className="keuze" aria-label={label}>
      {opties.map(([w, tekst]) => (
        <button key={w} aria-pressed={w === waarde} onClick={() => kies(w)}>
          {tekst}
        </button>
      ))}
    </nav>
  );
}
