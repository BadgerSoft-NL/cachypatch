// De audio-mixer: drie rijen strips. Onderin kies je met "edit" welke
// bestemming je bewerkt; in de rijen erboven zet een groene knop per bron de
// route daarheen aan of uit. Andere routes blijven zoals ze zijn.

import { useRef, type ReactNode } from "react";
import { zetMute, zetVolume, type Graaf } from "./api";
import {
  MAX_DB,
  UIT_DB,
  metDb,
  schakel,
  stripDb,
  type Mixer as MixerModel,
  type Strip,
} from "./mixer";

export function Mixer({
  graaf,
  mixer,
  bewerkt,
  kiesBewerkt,
  verborgen,
  verberg,
  naarPatchbay,
}: {
  graaf: Graaf;
  mixer: MixerModel;
  bewerkt: Strip | null;
  kiesBewerkt: (sleutel: string) => void;
  verborgen: Set<string>;
  verberg: (sleutel: string) => void;
  naarPatchbay: () => void;
}) {
  const zichtbaar = (s: Strip) => !verborgen.has(s.sleutel);
  const bron = (s: Strip) => (
    <BronStrip
      key={s.sleutel}
      s={s}
      mixer={mixer}
      graaf={graaf}
      bewerkt={bewerkt}
      verberg={verberg}
      naarPatchbay={naarPatchbay}
    />
  );

  return (
    <main className="mixer">
      <Rij titel="Apps" leeg="No app is playing.">
        {mixer.apps.filter(zichtbaar).map(bron)}
      </Rij>
      <Rij titel="Hardware in" leeg="No inputs.">
        {mixer.hardware.filter(zichtbaar).map(bron)}
      </Rij>
      <Rij titel="Destinations" leeg="No destinations." laatste>
        {mixer.bestemmingen.filter(zichtbaar).map((d) => {
          const gekozen = bewerkt?.sleutel === d.sleutel;
          const n = [...mixer.apps, ...mixer.hardware].filter(
            (b) => mixer.route(b, d).stand.soort !== "uit",
          ).length;
          return (
            <Kaart key={d.sleutel} s={d} gekozen={gekozen} verberg={verberg}>
              <button
                className={`route${gekozen ? " aan" : " bewerk"}`}
                aria-pressed={gekozen}
                onClick={() => kiesBewerkt(d.sleutel)}
              >
                {gekozen ? "editing" : "edit"}
              </button>
              <div className="regel">{n === 1 ? "1 source" : `${n} sources`}</div>
            </Kaart>
          );
        })}
      </Rij>
    </main>
  );
}

function Rij({
  titel,
  leeg,
  laatste,
  children,
}: {
  titel: string;
  leeg: string;
  laatste?: boolean;
  children: ReactNode[];
}) {
  return (
    <section className={`rij${laatste ? " laatste" : ""}`} aria-label={titel}>
      <div className="rij-titel">{titel}</div>
      <div className="strips">
        {children.length ? children : <p className="zacht leeg-rij">{leeg}</p>}
      </div>
    </section>
  );
}

function BronStrip({
  s,
  mixer,
  graaf,
  bewerkt,
  verberg,
  naarPatchbay,
}: {
  s: Strip;
  mixer: MixerModel;
  graaf: Graaf;
  bewerkt: Strip | null;
  verberg: (sleutel: string) => void;
  naarPatchbay: () => void;
}) {
  if (!bewerkt) {
    return <Kaart s={s} verberg={verberg} />;
  }
  const r = mixer.route(s, bewerkt);
  const elders = mixer.bestemmingen
    .filter((d) => d.sleutel !== bewerkt.sleutel && mixer.route(s, d).stand.soort !== "uit")
    .map((d) => d.naam);

  let knop: ReactNode;
  let regel: ReactNode = elders.length ? `also → ${elders.join(", ")}` : "";
  let amber = false;
  if (r.stand.soort === "aangepast") {
    knop = (
      <button className="route aangepast" onClick={naarPatchbay} title="Custom patch — open in patchbay">
        custom
      </button>
    );
    regel = r.stand.uitleg;
    amber = true;
  } else {
    const aan = r.stand.soort === "aan";
    knop = (
      <button
        className={`route${aan ? " aan" : ""}`}
        aria-pressed={aan}
        onClick={() => schakel(mixer, graaf, s, bewerkt)}
      >
        {bewerkt.naam}
      </button>
    );
    if (r.stand.soort === "aan" && r.stand.handmatig) {
      regel = "manual";
      amber = true;
    }
  }

  return (
    <Kaart s={s} verberg={verberg}>
      {knop}
      <div className={`regel${amber ? " amber" : ""}`} title={typeof regel === "string" ? regel : undefined}>
        {regel}
      </div>
    </Kaart>
  );
}

// Wat een pair-strip was voor hij gemute werd. Een paar van een apparaat kan
// niet los gemute worden in PipeWire, dus dat gaat via het volume.
const voorMute = new Map<string, number>();

function Kaart({
  s,
  gekozen,
  verberg,
  children,
}: {
  s: Strip;
  gekozen?: boolean;
  verberg: (sleutel: string) => void;
  children?: ReactNode;
}) {
  const db = stripDb(s);
  const heel = s.kanalen.length === (s.knoop.volume?.length ?? -1);
  const gemute = heel ? !!s.knoop.mute : voorMute.has(s.sleutel) && db !== null && db <= UIT_DB;

  const zetDb = (nieuw: number) => {
    const v = metDb(s, nieuw);
    if (v) zetVolume(s.knoop.id, v);
    if (!heel) voorMute.delete(s.sleutel);
  };
  const mute = () => {
    if (heel) return zetMute(s.knoop.id, !s.knoop.mute);
    if (gemute) {
      const terug = voorMute.get(s.sleutel) ?? 0;
      voorMute.delete(s.sleutel);
      const v = metDb(s, terug);
      if (v) zetVolume(s.knoop.id, v);
    } else if (db !== null) {
      voorMute.set(s.sleutel, db);
      const v = metDb(s, UIT_DB);
      if (v) zetVolume(s.knoop.id, v);
    }
  };

  return (
    <article className={`strip${gekozen ? " gekozen" : ""}${s.stil ? " stil" : ""}`}>
      <div className="strip-kop" title={`${s.naam} — ${s.onder}`}>
        <div className="strip-naam">{s.naam}</div>
        <div className="strip-onder">{s.onder}</div>
        <button className="verberg" aria-label={`Hide ${s.naam}`} title="Hide" onClick={() => verberg(s.sleutel)}>
          ×
        </button>
      </div>
      {children ?? <div className="route-leeg" />}
      <div className="fader-vak">
        {db === null ? <div className="geen-volume">no volume</div> : <Fader db={db} onChange={zetDb} uit={gemute} />}
      </div>
      <div className="db">{db === null ? "" : toonDb(db)}</div>
      <button className={`mute${gemute ? " aan" : ""}`} aria-pressed={gemute} aria-label="Mute" onClick={mute} disabled={db === null}>
        M
      </button>
    </article>
  );
}

// --- Fader, de wet van CachyMix: bovenin fijn rond 0 dB, onderin grof ---

const WET: [number, number][] = [
  [0, UIT_DB],
  [0.04, -60],
  [0.2, -40],
  [0.42, -20],
  [0.62, -10],
  [0.76, -4],
  [0.86, 0],
  [1, MAX_DB],
];

function standNaarDb(stand: number): number {
  const s = Math.min(1, Math.max(0, stand));
  if (s <= 0.005) return UIT_DB;
  for (let i = 1; i < WET.length; i++) {
    const [s1, d1] = WET[i];
    if (s <= s1) {
      const [s0, d0] = WET[i - 1];
      return d0 + ((s - s0) / (s1 - s0)) * (d1 - d0);
    }
  }
  return MAX_DB;
}

function dbNaarStand(db: number): number {
  if (db <= UIT_DB) return 0;
  for (let i = 1; i < WET.length; i++) {
    const [s1, d1] = WET[i];
    if (db <= d1) {
      const [s0, d0] = WET[i - 1];
      return s0 + ((db - d0) / (d1 - d0)) * (s1 - s0);
    }
  }
  return 1;
}

function toonDb(db: number): string {
  if (db <= UIT_DB) return "−∞";
  const r = Math.round(db * 10) / 10;
  return (r > 0 ? "+" : r < 0 ? "−" : "") + Math.abs(r).toFixed(1);
}

/** Sleept relatief, dus een klik geeft nooit een sprong. Shift = fijn,
 *  dubbelklik = 0 dB, wiel = 1 dB. */
function Fader({ db, onChange, uit }: { db: number; onChange: (db: number) => void; uit: boolean }) {
  const baan = useRef<HTMLDivElement>(null);
  // Tijdens het slepen telt de eigen stand, niet de dB die terugkomt uit de
  // graph: die loopt een beetje achter.
  const stand = useRef(dbNaarStand(db));
  const sleept = useRef(false);
  if (!sleept.current) stand.current = dbNaarStand(db);

  const zet = (s: number) => {
    stand.current = Math.min(1, Math.max(0, s));
    const nieuw = Math.round(standNaarDb(stand.current) * 10) / 10;
    onChange(nieuw <= UIT_DB + 0.05 ? UIT_DB : nieuw);
  };

  return (
    <div
      className={`fader${uit ? " uit" : ""}`}
      ref={baan}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        sleept.current = true;
        let y = e.clientY;
        const beweeg = (ev: PointerEvent) => {
          const dy = ev.clientY - y;
          y = ev.clientY;
          const h = baan.current?.clientHeight ?? 160;
          zet(stand.current - (dy / (h - 18)) * (ev.shiftKey ? 0.2 : 1));
        };
        const los = () => {
          sleept.current = false;
          el.removeEventListener("pointermove", beweeg);
          el.removeEventListener("pointerup", los);
          el.removeEventListener("pointercancel", los);
        };
        el.addEventListener("pointermove", beweeg);
        el.addEventListener("pointerup", los);
        el.addEventListener("pointercancel", los);
      }}
      onDoubleClick={() => onChange(0)}
      onWheel={(e) => {
        const stap = e.shiftKey ? 0.1 : 1;
        const huidig = db <= UIT_DB ? -61 : db;
        const nieuw = Math.min(MAX_DB, huidig + (e.deltaY < 0 ? stap : -stap));
        onChange(nieuw < -60 ? UIT_DB : Math.round(nieuw * 10) / 10);
      }}
      title="Drag, wheel, Shift for fine, double-click for 0 dB"
    >
      <div className="gleuf" />
      <div className="nul" style={{ bottom: `calc((100% - 18px) * ${dbNaarStand(0)} + 9px)` }} />
      <div className="knop-fader" style={{ bottom: `calc((100% - 18px) * ${stand.current})` }} />
    </div>
  );
}
