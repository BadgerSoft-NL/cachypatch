import { useEffect, useMemo, useRef, useState } from "react";
import { version } from "../package.json";
import { LEEG, volgGraaf, type Graaf } from "./api";
import { deelIn } from "./indeling";
import { Mixer } from "./Mixer";
import { bouwMixer, telHandwerk, terugNaarAuto } from "./mixer";
import { volgPieken } from "./meters";
import { volgMidi } from "./midi";
import { bouwMidiMixer, MidiMixer } from "./MidiMixer";
import { ontkoppel } from "./api";
import { Patchbay, type Plekken } from "./Patchbay";

type Tab = "audio" | "midi";
type Weergave = "mixer" | "patchbay";

// Welke strips je in de mixer hebt verborgen. Dat is een voorkeur van de
// weergave, geen routing, dus die mag blijven.
const VERBORGEN = "cachypatch.verborgen";

function leesVerborgen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(VERBORGEN) ?? "[]"));
  } catch {
    return new Set();
  }
}

export default function App() {
  const [graaf, setGraaf] = useState<Graaf>(LEEG);
  const [tab, setTab] = useState<Tab>("audio");
  const [weergave, setWeergave] = useState<Weergave>("mixer");
  // Versleepte plekken, per tab. Alleen voor deze sessie.
  const [plekken, setPlekken] = useState<Record<Tab, Plekken>>({ audio: {}, midi: {} });
  const [bewerktSleutel, setBewerktSleutel] = useState<string | null>(null);
  const [midiBewerktSleutel, setMidiBewerktSleutel] = useState<string | null>(null);
  const [verborgen, setVerborgen] = useState<Set<string>>(leesVerborgen);
  const [toonVerborgen, setToonVerborgen] = useState(false);
  const [bevestig, setBevestig] = useState(false);

  useEffect(() => volgGraaf(setGraaf), []);
  // De nep-pieken willen de huidige graph weten; een ref houdt die bij.
  const graafRef = useRef(graaf);
  graafRef.current = graaf;
  useEffect(() => volgPieken(() => graafRef.current), []);
  useEffect(() => volgMidi(() => graafRef.current), []);
  useEffect(() => {
    try {
      localStorage.setItem(VERBORGEN, JSON.stringify([...verborgen]));
    } catch {
      // Zonder opslag vergeet hij het na een herstart; geen ramp.
    }
  }, [verborgen]);

  const indeling = useMemo(() => deelIn(graaf, tab), [graaf, tab]);
  const mixer = useMemo(() => bouwMixer(graaf), [graaf]);
  const midiMixer = useMemo(() => bouwMidiMixer(graaf), [graaf]);
  const midiBewerkt =
    midiMixer.bestemmingen.find((d) => d.sleutel === midiBewerktSleutel) ??
    midiMixer.bestemmingen[0] ??
    null;

  // De bewerkte bestemming: wat je koos, anders de standaard-uitgang.
  const bewerkt =
    mixer.bestemmingen.find((d) => d.sleutel === bewerktSleutel) ??
    mixer.bestemmingen.find((d) => d.knoop.naam === graaf.standaard_sink && d.doelbaar) ??
    mixer.bestemmingen[0] ??
    null;
  const handwerk = telHandwerk(mixer);
  const alleStrips =
    tab === "audio"
      ? [...mixer.apps, ...mixer.hardware, ...mixer.bestemmingen]
      : [...midiMixer.bronnen, ...midiMixer.bestemmingen];
  const nuVerborgen = alleStrips.filter((s) => verborgen.has(s.sleutel));
  const opMixer = weergave === "mixer";
  const doelNaam = tab === "audio" ? bewerkt?.naam : midiBewerkt?.naam;
  // Wat de knop "Back to auto" / "Disconnect all" zou weghalen.
  const weg = tab === "audio" ? handwerk : midiMixer.kabels.length;

  const verberg = (sleutel: string) => setVerborgen((v) => new Set(v).add(sleutel));
  const toon = (sleutel: string) =>
    setVerborgen((v) => {
      const n = new Set(v);
      n.delete(sleutel);
      return n;
    });

  return (
    <div className="app">
      <header className="kop">
        <div className="merk">
          <span className="naam">CachyPatch</span>
          <span className="merk-versie">{version}</span>
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
          kies={(t) => {
            setTab(t);
            setBevestig(false);
            setToonVerborgen(false);
          }}
        />
        <div className="vul" />
        {opMixer && doelNaam && (
          <span className="zacht">
            Routing to <strong className="groen">{doelNaam}</strong>
          </span>
        )}
        {opMixer && (
          <button className="knop-tekst" disabled={weg === 0} onClick={() => setBevestig(true)}>
            {tab === "audio" ? "Back to auto" : "Disconnect all"}
          </button>
        )}
        {opMixer && (
          <div className="uitklap">
            <button
              className="knop-tekst"
              aria-expanded={toonVerborgen}
              disabled={nuVerborgen.length === 0}
              onClick={() => setToonVerborgen((t) => !t)}
            >
              Hidden ({nuVerborgen.length})
            </button>
            {toonVerborgen && nuVerborgen.length > 0 && (
              <div className="menu" role="menu">
                {nuVerborgen.map((s) => (
                  <button key={s.sleutel} role="menuitem" onClick={() => toon(s.sleutel)}>
                    Show <strong>{s.naam}</strong> <span className="zacht">{s.onder}</span>
                  </button>
                ))}
                <button
                  role="menuitem"
                  onClick={() => {
                    setVerborgen(new Set());
                    setToonVerborgen(false);
                  }}
                >
                  Show all
                </button>
              </div>
            )}
          </div>
        )}
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
          <button className="knop-tekst" onClick={() => setPlekken((p) => ({ ...p, [tab]: {} }))}>
            Rearrange
          </button>
        )}
      </header>

      {opMixer && bevestig && (
        <div className="bevestig" role="alertdialog" aria-label="Confirm">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f2a541" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l9 16H3z" />
            <path d="M12 10v4M12 17h.01" />
          </svg>
          {tab === "audio" ? (
            <span>
              <strong>
                {handwerk} manual {handwerk === 1 ? "route" : "routes"}
              </strong>{" "}
              will be removed, including links you made in the patchbay. WirePlumber takes over
              again.
            </span>
          ) : (
            <span>
              <strong>
                {weg} MIDI {weg === 1 ? "link" : "links"}
              </strong>{" "}
              will be removed. WirePlumber does not put MIDI links back, so everything will be
              disconnected.
            </span>
          )}
          <span className="vul" />
          <button className="knop-amber-rand" onClick={() => setBevestig(false)}>
            Cancel
          </button>
          <button
            className="knop-amber"
            onClick={() => {
              if (tab === "audio") terugNaarAuto(mixer);
              else ontkoppel(midiMixer.kabels.map((k) => k.id));
              setBevestig(false);
            }}
          >
            {tab === "audio" ? "Remove" : "Disconnect"}
          </button>
        </div>
      )}

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
            <span className="zacht">Drag between dots to connect · click a cable to disconnect</span>
            <span className="vul" />
            {indeling.verborgen.length > 0 && (
              <span className="zacht">Hidden: {indeling.verborgen.join(", ")}</span>
            )}
          </footer>
        </>
      ) : tab === "audio" ? (
        <Mixer
          graaf={graaf}
          mixer={mixer}
          bewerkt={bewerkt}
          kiesBewerkt={setBewerktSleutel}
          verborgen={verborgen}
          verberg={verberg}
          naarPatchbay={() => setWeergave("patchbay")}
        />
      ) : (
        <MidiMixer
          model={midiMixer}
          bewerkt={midiBewerkt}
          kiesBewerkt={setMidiBewerktSleutel}
          verborgen={verborgen}
          verberg={verberg}
        />
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
