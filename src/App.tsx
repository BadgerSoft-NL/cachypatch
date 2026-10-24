import { useEffect, useMemo, useRef, useState } from "react";
import { version } from "../package.json";
import {
  isBus,
  LEEG,
  MIDI_AAN,
  STIL,
  volgGraaf,
  volgTransport,
  zetTransport,
  type Graaf,
  type TransportStand,
} from "./api";
import { Transport } from "./Transport";
import { herhaal, maakOngedaan, useGeschiedenis } from "./geschiedenis";
import { haalKabelsWeg, terugNaarAutoStap } from "./handelingen";
import { deelIn } from "./indeling";
import { Mixer, rijSleutel } from "./Mixer";
import { bouwMixer, telHandwerk, zetBusDefs } from "./mixer";
import { bewaarBussen, bussen, busWeg, gewapend, leesBussen, stuurBussen, type BusConfig } from "./bussen";
import { volgPieken } from "./meters";
import { volgMidi } from "./midi";
import { bouwMidiMixer, MidiMixer } from "./MidiMixer";
import { Patchbay, type Plekken } from "./Patchbay";

type Tab = "audio" | "midi";
type Weergave = "mixer" | "patchbay";

// Welke strips je in de mixer hebt verborgen. Dat is een voorkeur van de
// weergave, geen routing, dus die mag blijven.
const VERBORGEN = "pecanmixer.verborgen";

// De klok-keuzes van de transportbalk; ook een voorkeur, geen routing.
const KLOK = "pecanmixer.klok";
export interface KlokKeuze {
  klok: number | null;
  start_stop: boolean;
}

function leesKlok(): KlokKeuze {
  try {
    // De klok wijst naar een poort-id, en die geldt maar één sessie.
    return { start_stop: false, ...JSON.parse(localStorage.getItem(KLOK) ?? "{}"), klok: null };
  } catch {
    return { klok: null, start_stop: false };
  }
}

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
  // Per soort de laatst gekozen weergave, voor een klik op het label.
  const [laatste, setLaatste] = useState<Record<Tab, Weergave>>({ audio: "mixer", midi: "mixer" });
  const kiesWeergave = (t: Tab, w: Weergave) => {
    setTab(t);
    setWeergave(w);
    setLaatste((l) => ({ ...l, [t]: w }));
    setBevestig(false);
    setToonVerborgen(false);
  };
  // Versleepte plekken, per tab. Alleen voor deze sessie.
  const [plekken, setPlekken] = useState<Record<Tab, Plekken>>({ audio: {}, midi: {} });
  const [bewerktSleutel, setBewerktSleutel] = useState<string | null>(null);
  const [busSleutel, setBusSleutel] = useState<string | null>(null);
  const [midiBewerktSleutel, setMidiBewerktSleutel] = useState<string | null>(null);
  const [verborgen, setVerborgen] = useState<Set<string>>(leesVerborgen);
  const [toonVerborgen, setToonVerborgen] = useState(false);
  const [bevestig, setBevestig] = useState(false);
  const [transport, setTransport] = useState<TransportStand>(STIL);
  const [klok, setKlok] = useState<KlokKeuze>(leesKlok);
  const [busConfig, setBusConfig] = useState<BusConfig>(leesBussen);
  const busDefs = useMemo(() => bussen(busConfig), [busConfig]);

  useEffect(() => volgGraaf(setGraaf), []);
  // De nep-pieken willen de huidige graph weten; een ref houdt die bij.
  const graafRef = useRef(graaf);
  graafRef.current = graaf;
  useEffect(() => volgPieken(() => graafRef.current), []);
  useEffect(() => volgMidi(() => graafRef.current), []);
  useEffect(() => volgTransport(setTransport), []);
  const geschiedenis = useGeschiedenis();
  // Ctrl+Z en Ctrl+Shift+Z (of Ctrl+Y), behalve in een invoerveld.
  useEffect(() => {
    const toets = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        maakOngedaan();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        herhaal();
      }
    };
    window.addEventListener("keydown", toets);
    return () => window.removeEventListener("keydown", toets);
  }, []);
  // Het aantal kanalen en de gain van de Rec bus. Opnieuw na een herverbinding.
  useEffect(() => {
    if (graaf.verbonden) stuurBussen(busConfig);
  }, [busConfig, graaf.verbonden]);
  useEffect(() => bewaarBussen(busConfig), [busConfig]);
  useEffect(() => {
    try {
      localStorage.setItem(KLOK, JSON.stringify(klok));
    } catch {
      // Geen opslag: dan de standaard na een herstart.
    }
  }, [klok]);
  useEffect(() => {
    try {
      localStorage.setItem(VERBORGEN, JSON.stringify([...verborgen]));
    } catch {
      // Zonder opslag vergeet hij het na een herstart; geen ramp.
    }
  }, [verborgen]);

  const indeling = useMemo(() => deelIn(graaf, tab), [graaf, tab]);
  const mixer = useMemo(() => {
    zetBusDefs(busDefs);
    return bouwMixer(graaf);
  }, [graaf, busDefs]);
  // Wat Record opneemt: de gewapende bussen (● op de bus).
  const armSet = gewapend(busConfig);
  const armSleutel = armSet.map((b) => b.sleutel).join(" ");
  // Wat de Rust-kant moet weten: die bussen, de MIDI-ingang en de klok.
  // Opnieuw na een herverbinding.
  useEffect(() => {
    if (!graaf.verbonden) return;
    zetTransport({
      bussen: armSet.map((b) => ({ naam: b.bestand, kanalen: b.kanalen })),
      midi: MIDI_AAN && busConfig.midi,
      ...(MIDI_AAN ? klok : { klok: null, start_stop: false }),
    });
  }, [armSleutel, busConfig.midi, klok, graaf.verbonden]);
  const midiMixer = useMemo(() => bouwMidiMixer(graaf), [graaf]);
  const midiBewerkt =
    midiMixer.bestemmingen.find((d) => d.sleutel === midiBewerktSleutel) ??
    midiMixer.bestemmingen[0] ??
    null;

  // Twee keuzes naast elkaar: de bewerkte uitgang (de groene knoppen) en de
  // bewerkte rec-bus (R). Zonder keuze de standaard-uitgang en de eerste bus.
  const uitgangen = mixer.bestemmingen.filter((d) => !d.bus);
  const bewerkt =
    uitgangen.find((d) => d.sleutel === bewerktSleutel) ??
    uitgangen.find((d) => d.knoop.naam === graaf.standaard_sink && d.doelbaar) ??
    uitgangen[0] ??
    null;
  const bewerkteBus =
    mixer.bestemmingen.find((d) => d.bus && d.sleutel === busSleutel) ??
    mixer.bestemmingen.find((d) => d.bus) ??
    null;
  const kiesBewerkt = (sleutel: string) => {
    if (mixer.bestemmingen.find((d) => d.sleutel === sleutel)?.bus) setBusSleutel(sleutel);
    else setBewerktSleutel(sleutel);
  };
  const handwerk = telHandwerk(mixer);
  const alleStrips =
    tab === "audio"
      ? [...mixer.apps, ...mixer.hardware, ...mixer.bestemmingen]
      : [...midiMixer.bronnen, ...midiMixer.bestemmingen];
  const nuVerborgen = alleStrips.filter((s) => verborgen.has(s.sleutel));
  // Verborgen rijen (alleen in de audio-mixer) staan bovenaan in het menu.
  const verborgenRijen = (
    [
      ["apps", "Apps"],
      ["hardware", "Hardware in"],
      ["bestemmingen", "Destinations"],
    ] as const
  ).filter(([id]) => tab === "audio" && verborgen.has(rijSleutel(id)));
  const aantalVerborgen = nuVerborgen.length + verborgenRijen.length;
  const opMixer = weergave === "mixer";
  const doelNaam = tab === "audio" ? bewerkt?.naam : midiBewerkt?.naam;
  const midiBus = midiMixer.bestemmingen.find((d) => graaf.knopen.some((k) => k.id === d.poort.knoop && isBus(k)));
  const midiNaarBus = midiBus
    ? midiMixer.bronnen.filter((b) => midiMixer.route(b, midiBus)).map((b) => b.naam)
    : [];
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
          <span className="naam">Pecan Mixer</span>
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
        <nav className="weergaven" aria-label="View">
          {(["audio", "midi"] as const).map((t) => {
            // MIDI is er nog niet: de knoppen staan er, maar doen niets.
            const uit = t === "midi" && !MIDI_AAN;
            return (
              <div
                key={t}
                className={`keuze ${t}${uit ? " keuze-uit" : ""}`}
                role="group"
                aria-label={t === "audio" ? "Audio" : "MIDI"}
                title={uit ? "MIDI is not available yet" : undefined}
              >
                <button
                  className="keuze-label"
                  title={uit ? undefined : `${t === "audio" ? "Audio" : "MIDI"} ${laatste[t]}`}
                  disabled={uit}
                  onClick={() => kiesWeergave(t, laatste[t])}
                >
                  {t === "audio" ? "Audio" : "MIDI"}
                </button>
                {(["mixer", "patchbay"] as const).map((w) => (
                  <button
                    key={w}
                    aria-pressed={tab === t && weergave === w}
                    disabled={uit}
                    onClick={() => kiesWeergave(t, w)}
                  >
                    {w === "mixer" ? "Mixer" : "Patchbay"}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="keuze" role="group" aria-label="History">
          <button
            disabled={!geschiedenis.terug}
            onClick={maakOngedaan}
            title={geschiedenis.terug ? `Undo ${geschiedenis.terug} (Ctrl+Z)` : "Nothing to undo"}
            aria-label="Undo"
          >
            ↶
          </button>
          <button
            disabled={!geschiedenis.vooruit}
            onClick={herhaal}
            title={geschiedenis.vooruit ? `Redo ${geschiedenis.vooruit} (Ctrl+Shift+Z)` : "Nothing to redo"}
            aria-label="Redo"
          >
            ↷
          </button>
        </div>
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
              disabled={aantalVerborgen === 0}
              onClick={() => setToonVerborgen((t) => !t)}
            >
              Hidden ({aantalVerborgen})
            </button>
            {toonVerborgen && aantalVerborgen > 0 && (
              <div className="menu" role="menu">
                {verborgenRijen.map(([id, naam]) => (
                  <button key={id} role="menuitem" onClick={() => toon(rijSleutel(id))}>
                    Show <strong>{naam}</strong> <span className="zacht">row</span>
                  </button>
                ))}
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
              if (tab === "audio") terugNaarAutoStap();
              else haalKabelsWeg(midiMixer.kabels.map((k) => k.id));
              setBevestig(false);
            }}
          >
            {tab === "audio" ? "Remove" : "Disconnect"}
          </button>
        </div>
      )}

      {/* De tijd en fouten staan in het Rec-vak; deze balk is er alleen
          voor MIDI. */}
      {opMixer && MIDI_AAN && (
        <Transport
          graaf={graaf}
          stand={transport}
          klok={klok}
          zetKlok={setKlok}
          midiGewapend={busConfig.midi}
          midiNaarBus={midiNaarBus}
        />
      )}

      {weergave === "patchbay" ? (
        <>
          <Patchbay
            indeling={indeling}
            soort={tab}
            plekken={plekken[tab]}
            zetPlek={(sleutel, plek) =>
              setPlekken((p) => ({ ...p, [tab]: { ...p[tab], [sleutel]: plek } }))
            }
          />
          <footer className="voet">
            <span className="legenda">
              <span className={`lijn ${tab}`} /> connected
            </span>
            <span className="legenda">
              <span className="stip" /> not connected
            </span>
            <span className="zacht">
              Drag between dots to connect · click a cable, then Delete · grab a cable at its input to move it
            </span>
            <span className="vul" />
            {indeling.verborgen.length > 0 && (
              <span className="zacht">Hidden: {indeling.verborgen.join(", ")}</span>
            )}
          </footer>
        </>
      ) : tab === "audio" ? (
        <Mixer
          mixer={mixer}
          bewerkt={bewerkt}
          bewerkteBus={bewerkteBus}
          kiesBewerkt={kiesBewerkt}
          verborgen={verborgen}
          verberg={verberg}
          naarPatchbay={() => setWeergave("patchbay")}
          transport={transport}
          busConfig={busConfig}
          zetBusConfig={setBusConfig}
          busWeg={(plek) => setBusConfig(busWeg(busConfig, plek, graaf))}
        />
      ) : (
        <MidiMixer
          model={midiMixer}
          bewerkt={midiBewerkt}
          kiesBewerkt={setMidiBewerktSleutel}
          verborgen={verborgen}
          verberg={verberg}
          opnemen={transport.bezig}
          midiGewapend={busConfig.midi}
          zetMidiGewapend={(midi: boolean) => setBusConfig((c) => ({ ...c, midi }))}
        />
      )}
    </div>
  );
}
