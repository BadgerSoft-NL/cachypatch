// De audio-mixer: drie rijen strips. Onderin kies je welke bestemming je
// bewerkt (klik ergens in de strip); in de rijen erboven zet een groene knop
// per bron de route daarheen aan of uit. Andere routes blijven zoals ze zijn.
//
// De rec-bussen staan tussen de bestemmingen, met R om te wapenen, de
// koppelknop (stereo of twee mono) zoals in CachyMix, en + / − om een paar
// bij te maken of weg te halen. Hun fader en M werken op de bus zelf.

import { useRef, type ReactNode } from "react";
import { zetVolume } from "./api";
import {
  busEraf,
  busErbij,
  standVan,
  wisselKoppeling,
  type BusConfig,
  type BusStand,
} from "./bussen";
import { muteStap, schakelRoute, volumeVastleggen } from "./handelingen";
import { MeterBalk } from "./Meter";
import {
  MAX_DB,
  UIT_DB,
  metDb,
  stripDb,
  type Mixer as MixerModel,
  type Strip,
} from "./mixer";

export function Mixer({
  mixer,
  bewerkt,
  kiesBewerkt,
  verborgen,
  verberg,
  naarPatchbay,
  opnemen,
  busConfig,
  zetBusConfig,
}: {
  opnemen: boolean;
  busConfig: BusConfig;
  zetBusConfig: (f: (c: BusConfig) => BusConfig) => void;
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
      bewerkt={bewerkt}
      verberg={verberg}
      naarPatchbay={naarPatchbay}
    />
  );

  return (
    <main className="rijen">
      <Rij titel="Apps" leeg="No app is playing.">
        {mixer.apps.filter(zichtbaar).map(bron)}
      </Rij>
      <Rij titel="Hardware in" leeg="No inputs.">
        {mixer.hardware.filter(zichtbaar).map(bron)}
      </Rij>
      <Rij titel="Destinations" leeg="No destinations." laatste>
        {mixer.bestemmingen.filter(zichtbaar).flatMap((d, i, lijst) => {
          const gekozen = bewerkt?.sleutel === d.sleutel;
          const n = [...mixer.apps, ...mixer.hardware].filter(
            (b) => mixer.route(b, d).stand.soort !== "uit",
          ).length;
          const def = d.bus;
          const stand = def ? standVan(busConfig, def.sleutel) : null;
          const neemtOp = opnemen && !!stand?.gewapend;
          const bus = def &&
            stand && {
              stand,
              zet: (w: Partial<BusStand>) =>
                zetBusConfig((c) => ({
                  ...c,
                  stand: { ...c.stand, [def.sleutel]: { ...standVan(c, def.sleutel), ...w } },
                })),
              koppel: def.links
                ? {
                    gekoppeld: busConfig.paren[def.paar]?.gekoppeld ?? true,
                    wissel: () => zetBusConfig((c) => wisselKoppeling(c, def.paar)),
                  }
                : undefined,
            };
          const kaart = (
            <Kaart
              key={d.sleutel}
              s={d}
              gekozen={gekozen}
              verberg={verberg}
              bestemming
              opname={neemtOp}
              bus={bus || undefined}
              kies={() => kiesBewerkt(d.sleutel)}
            >
              <button
                className={`kies${gekozen ? " aan" : ""}`}
                aria-pressed={gekozen}
                onClick={() => kiesBewerkt(d.sleutel)}
              >
                {gekozen ? "editing" : "edit"}
              </button>
              <div className={`regel${neemtOp ? " rood" : ""}`}>
                {neemtOp ? "● rec · " : ""}
                {n === 1 ? "1 source" : `${n} sources`}
              </div>
            </Kaart>
          );
          // Na de laatste bus: een paar bij of eraf.
          const laatsteBus = def && !lijst.slice(i + 1).some((x) => x.bus);
          if (!laatsteBus) return [kaart];
          return [
            kaart,
            <div key="bus-erbij" className="bus-erbij">
              <button className="knop" title="Add a Rec bus pair" onClick={() => zetBusConfig(busErbij)}>
                + Bus
              </button>
              <button
                className="knop"
                title="Remove the last Rec bus pair"
                disabled={busConfig.paren.length <= 1}
                onClick={() => zetBusConfig(busEraf)}
              >
                − Bus
              </button>
            </div>,
          ];
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
      <div className="rij-strips">
        {children.length ? children : <p className="zacht leeg-rij">{leeg}</p>}
      </div>
    </section>
  );
}

function BronStrip({
  s,
  mixer,
  bewerkt,
  verberg,
  naarPatchbay,
}: {
  s: Strip;
  mixer: MixerModel;
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
      <button className="kies aangepast" onClick={naarPatchbay} title="Custom patch — open in patchbay">
        custom
      </button>
    );
    regel = r.stand.uitleg;
    amber = true;
  } else {
    const aan = r.stand.soort === "aan";
    knop = (
      <button
        className={`kies${aan ? " aan" : ""}`}
        aria-pressed={aan}
        title={`${aan ? "Remove" : "Add"} route to ${bewerkt.naam}`}
        onClick={() => schakelRoute(s.sleutel, bewerkt.sleutel, aan)}
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
  bestemming,
  opname,
  kies,
  bus,
  children,
}: {
  opname?: boolean;
  /** Een rec-bus: fader en M gaan over de bus, met R en de koppelknop erbij. */
  bus?: {
    stand: BusStand;
    zet: (w: Partial<BusStand>) => void;
    koppel?: { gekoppeld: boolean; wissel: () => void };
  };
  /** Een bestemming: klik ergens in de strip om hem te bewerken, zoals in CachyMix. */
  kies?: () => void;
  s: Strip;
  gekozen?: boolean;
  verberg: (sleutel: string) => void;
  bestemming?: boolean;
  children?: ReactNode;
}) {
  const db = bus ? bus.stand.db : stripDb(s);
  const heel = s.kanalen.length === (s.knoop.volume?.length ?? -1);
  const gemute = bus
    ? bus.stand.mute
    : heel
      ? !!s.knoop.mute
      : voorMute.has(s.sleutel) && db !== null && db <= UIT_DB;

  const zetDb = (nieuw: number) => {
    if (bus) return bus.zet({ db: nieuw });
    const v = metDb(s, nieuw);
    if (v) zetVolume(s.knoop.id, v);
    if (!heel) voorMute.delete(s.sleutel);
  };
  // Het volume van voor een beweging, om die als één stap te onthouden.
  const voor = useRef<number[] | null>(null);
  const begin = () => (voor.current = s.knoop.volume ? [...s.knoop.volume] : null);
  const klaar = (db: number) => {
    if (bus) return;
    const nieuw = metDb(s, db);
    if (voor.current && nieuw) volumeVastleggen(s.knoop.id, voor.current, nieuw);
    voor.current = null;
  };
  const mute = () => {
    if (bus) return bus.zet({ mute: !bus.stand.mute });
    if (heel) return muteStap(s.knoop.id, !s.knoop.mute);
    const oud = s.knoop.volume ? [...s.knoop.volume] : null;
    let nieuw: number[] | null = null;
    if (gemute) {
      const terug = voorMute.get(s.sleutel) ?? 0;
      voorMute.delete(s.sleutel);
      nieuw = metDb(s, terug);
    } else if (db !== null) {
      voorMute.set(s.sleutel, db);
      nieuw = metDb(s, UIT_DB);
    }
    if (nieuw) zetVolume(s.knoop.id, nieuw);
    if (oud && nieuw) volumeVastleggen(s.knoop.id, oud, nieuw);
  };

  return (
    <article
      onClick={kies}
      className={
        "strip" +
        (bestemming ? " strip-uit" : s.kanalen.length > 1 ? " strip-stereo" : "") +
        (gekozen ? " gekozen" : "") +
        (opname ? " opname" : "") +
        (kies ? " kiesbaar" : "") +
        (s.stil || gemute ? " strip-stil" : "")
      }
    >
      <div className="strip-kop" title={`${s.naam} — ${s.onder}`}>
        <div className="naam">{s.naam}</div>
        <div className="strip-onder">{s.onder}</div>
        <button className="verberg" aria-label={`Hide ${s.naam}`} title="Hide" onClick={(e) => {
            e.stopPropagation();
            verberg(s.sleutel);
          }}>
          ×
        </button>
      </div>
      {children ?? <div className="kies-leeg" />}
      <div className="strip-midden">
        <div className="meter">
          {s.kanalen.map((k) => (
            <MeterBalk key={k} knoop={s.knoop.id} kanalen={[k]} />
          ))}
        </div>
        {db === null ? <div className="geen-volume">no volume</div> : <Fader db={db} onChange={zetDb} uit={gemute} begin={begin} klaar={klaar} />}
      </div>
      <div className={"db-label" + (db !== null && db > 0 ? " db-boven" : "")}>{db === null ? "" : toonDb(db)}</div>
      <div className="knoppen">
        <button
          className={"knop knop-mute" + (gemute ? " aan" : "")}
          aria-pressed={gemute}
          title="Mute"
          onClick={mute}
          disabled={db === null}
        >
          M
        </button>
        {bus && (
          <button
            className={"knop knop-rec" + (bus.stand.gewapend ? " aan" : "")}
            aria-pressed={bus.stand.gewapend}
            title={bus.stand.gewapend ? "Armed: recorded on Record" : "Arm for recording"}
            onClick={(e) => {
              e.stopPropagation();
              bus.zet({ gewapend: !bus.stand.gewapend });
            }}
          >
            R
          </button>
        )}
        {bus?.koppel && (
          <button
            className={"knop knop-koppel" + (bus.koppel.gekoppeld ? " aan" : "")}
            title={bus.koppel.gekoppeld ? "Split into two mono buses" : "Link as a stereo bus"}
            onClick={(e) => {
              e.stopPropagation();
              bus.koppel!.wissel();
            }}
          >
            {bus.koppel.gekoppeld ? "∞" : "–"}
          </button>
        )}
      </div>
    </article>
  );
}

// --- Fader, zoals in CachyMix: bovenin fijn rond 0 dB, onderin grof ---

const SCHAALSTREPEN = [6, 0, -6, -12, -20, -30, -40, -60];

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
function Fader({
  db,
  onChange,
  uit,
  begin,
  klaar,
}: {
  db: number;
  onChange: (db: number) => void;
  uit: boolean;
  /** Voor en na een beweging, voor ongedaan maken. */
  begin: () => void;
  klaar: (db: number) => void;
}) {
  // Wielstappen die snel achter elkaar komen, tellen als één beweging.
  const wiel = useRef<number | null>(null);
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
      className={`fader${uit ? " fader-uit" : ""}`}
      ref={baan}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        sleept.current = true;
        begin();
        let y = e.clientY;
        const beweeg = (ev: PointerEvent) => {
          const dy = ev.clientY - y;
          y = ev.clientY;
          const h = baan.current?.clientHeight ?? 160;
          zet(stand.current - (dy / (h - 24)) * (ev.shiftKey ? 0.2 : 1));
        };
        const los = () => {
          sleept.current = false;
          klaar(standNaarDb(stand.current) <= UIT_DB + 0.05 ? UIT_DB : Math.round(standNaarDb(stand.current) * 10) / 10);
          el.removeEventListener("pointermove", beweeg);
          el.removeEventListener("pointerup", los);
          el.removeEventListener("pointercancel", los);
        };
        el.addEventListener("pointermove", beweeg);
        el.addEventListener("pointerup", los);
        el.addEventListener("pointercancel", los);
      }}
      onDoubleClick={() => {
        begin();
        onChange(0);
        klaar(0);
      }}
      onWheel={(e) => {
        const stap = e.shiftKey ? 0.1 : 1;
        const huidig = db <= UIT_DB ? -61 : db;
        const nieuw = Math.min(MAX_DB, huidig + (e.deltaY < 0 ? stap : -stap));
        const waarde = nieuw < -60 ? UIT_DB : Math.round(nieuw * 10) / 10;
        if (wiel.current === null) begin();
        else clearTimeout(wiel.current);
        onChange(waarde);
        wiel.current = window.setTimeout(() => {
          wiel.current = null;
          klaar(waarde);
        }, 600);
      }}
      title="Drag, wheel, Shift for fine, double-click for 0 dB"
    >
      <div className="fader-schaal">
        {SCHAALSTREPEN.map((d) => (
          <div key={d} className="fader-streep" style={{ bottom: `calc((100% - 24px) * ${dbNaarStand(d)} + 12px)` }}>
            <span>{d > 0 ? `+${d}` : d}</span>
          </div>
        ))}
      </div>
      <div className="fader-gleuf" />
      <div className="fader-knop" style={{ bottom: `calc((100% - 24px) * ${stand.current})` }} />
    </div>
  );
}
