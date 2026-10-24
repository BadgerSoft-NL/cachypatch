// De audio-mixer: drie rijen strips. Onderin kies je welke bestemming je
// bewerkt (klik ergens in de strip); in de rijen erboven zet een groene knop
// per bron de route daarheen aan of uit. Andere routes blijven zoals ze zijn.
//
// De rec-bussen staan in een eigen vak tussen de bestemmingen, met de
// koppelknop (stereo of twee mono) zoals in CachyMix. Hun fader en M werken op
// de bus zelf; ● armt hem zoals in Ableton (klik = alleen deze, Ctrl+klik =
// erbij), × haalt hem weg. Rechts ernaast Record (alle gewapende bussen samen,
// sample-precies gelijk), + Bus en Folder (de map van de laatste take, of
// ~/Recordings). Een uitgang en een rec-bus kies je los van elkaar: de groene
// knop op een bron gaat naar de uitgang, R ernaast naar de bus.

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { openMap, startBus, startOpname, stopBus, stopOpname, zetVolume, type TransportStand } from "./api";
import {
  arm,
  busErbij,
  gewapend,
  standVan,
  wisselKoppeling,
  type BusConfig,
  type BusStand,
} from "./bussen";
import { muteStap, schakelRoute, volumeVastleggen } from "./handelingen";
import { MeterBalk } from "./Meter";
import { Looptijd } from "./Transport";
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
  bewerkteBus,
  kiesBewerkt,
  verborgen,
  verberg,
  naarPatchbay,
  transport,
  busConfig,
  zetBusConfig,
  busWeg,
}: {
  transport: TransportStand;
  busConfig: BusConfig;
  zetBusConfig: (f: (c: BusConfig) => BusConfig) => void;
  /** Haalt de bus op deze plek weg, met zijn routes. */
  busWeg: (plek: number) => void;
  mixer: MixerModel;
  /** De gekozen uitgang (groene knoppen) en de gekozen rec-bus (R). */
  bewerkt: Strip | null;
  bewerkteBus: Strip | null;
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
      bewerkteBus={bewerkteBus}
      verberg={verberg}
      naarPatchbay={naarPatchbay}
    />
  );

  const [gewicht, zetGewicht] = useRijGewichten();
  // Het rechtsklikmenu van de rijen, op de plek van de muis.
  const [menu, setMenu] = useState<{ x: number; y: number; rij?: { id: RijId; titel: string } } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const dicht = () => setMenu(null);
    const toets = (e: KeyboardEvent) => e.key === "Escape" && dicht();
    window.addEventListener("pointerdown", dicht);
    window.addEventListener("keydown", toets);
    window.addEventListener("blur", dicht);
    return () => {
      window.removeEventListener("pointerdown", dicht);
      window.removeEventListener("keydown", toets);
      window.removeEventListener("blur", dicht);
    };
  }, [menu]);
  const openMenu = (e: React.MouseEvent, rij?: { id: RijId; titel: string }) => {
    // Op een strip of een knop: het gewone menu van de webview.
    if ((e.target as Element).closest(".strip, .bus-erbij")) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, rij });
  };
  const bestemmingen = (() => {
          const kaart = (d: Strip) => {
            const gekozen = (d.bus ? bewerkteBus : bewerkt)?.sleutel === d.sleutel;
            const n = [...mixer.apps, ...mixer.hardware].filter(
              (b) => mixer.route(b, d).stand.soort !== "uit",
            ).length;
            const def = d.bus;
            const stand = def ? standVan(busConfig, def.sleutel) : null;
            const neemtOp = !!def && def.bestand in transport.bussen;
            const bus = def &&
              stand && {
                stand,
                zet: (w: Partial<BusStand>) =>
                  zetBusConfig((c) => ({
                    ...c,
                    stand: { ...c.stand, [def.sleutel]: { ...standVan(c, def.sleutel), ...w } },
                  })),
                koppel: def.koppel
                  ? {
                      gekoppeld: def.koppel === "splits",
                      wissel: () => zetBusConfig((c) => wisselKoppeling(c, def.plek)),
                    }
                  : undefined,
                neemtOp,
                gewapend: !!stand.gewapend,
                arm: (erbij: boolean) => {
                  const nieuw = arm(busConfig, def.sleutel, erbij);
                  // Tijdens een opname valt een bus die erbij komt meteen in,
                  // en stopt een bus die eraf gaat; de rest loopt door.
                  if (transport.bezig) {
                    const was = new Set(gewapend(busConfig).map((b) => b.sleutel));
                    const wordt = new Set(gewapend(nieuw).map((b) => b.sleutel));
                    for (const b of gewapend(nieuw)) if (!was.has(b.sleutel)) startBus({ naam: b.bestand, kanalen: b.kanalen });
                    for (const b of gewapend(busConfig)) if (!wordt.has(b.sleutel)) stopBus(b.bestand);
                  }
                  zetBusConfig(() => nieuw);
                },
                weg: busConfig.bussen.length > 1 ? () => busWeg(def.plek) : undefined,
              };
            return (
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
          };
          // Twee delen met een versleepbare scheiding: links de uitgangen
          // (hardware, dan apps die opnemen), rechts de rec-bussen met
          // Record, + Bus en Folder. Elk deel scrollt voor zich.
          const lijst = mixer.bestemmingen.filter(zichtbaar);
          if (!lijst.some((d) => d.bus)) return lijst.map(kaart);
          return [
            <Deling
              key="deling"
              links={lijst.filter((d) => !d.bus).map(kaart)}
              rechts={
                <div className="bus-vak" role="group" aria-label="Rec buses">
                  {lijst.filter((d) => d.bus).map(kaart)}
                  <div className="bus-erbij">
                    <Looptijd stand={transport} />
                    <button
                      className={"knop rec-alles" + (transport.bezig ? " aan" : "")}
                      aria-pressed={transport.bezig}
                      title={
                        transport.bezig
                          ? "Stop recording"
                          : "Record every armed bus at once, sample-aligned"
                      }
                      onClick={() => (transport.bezig ? stopOpname() : startOpname())}
                    >
                      <span className="rondje" aria-hidden="true" />
                      {transport.bezig ? "Stop" : "Record"}
                    </button>
                    <button className="knop" title="Add a stereo Rec bus" onClick={() => zetBusConfig(busErbij)}>
                      + Bus
                    </button>
                    <button
                      className="knop map-open"
                      title={`Open ${transport.map ?? "~/Recordings"} in the file manager`}
                      onClick={() => openMap(transport.map)}
                    >
                      Folder
                    </button>
                    {transport.fout && (
                      <span className="bus-fout" role="alert" title={transport.fout}>
                        {transport.fout}
                      </span>
                    )}
                  </div>
                </div>
              }
            />,
          ];
        })();

  const rijen: { id: RijId; titel: string; leeg: string; inhoud: ReactNode[] }[] = [
    { id: "apps", titel: "Apps", leeg: "No app is playing.", inhoud: mixer.apps.filter(zichtbaar).map(bron) },
    { id: "hardware", titel: "Hardware in", leeg: "No inputs.", inhoud: mixer.hardware.filter(zichtbaar).map(bron) },
    { id: "bestemmingen", titel: "Destinations", leeg: "No destinations.", inhoud: bestemmingen },
  ];
  const zichtbareRijen = rijen.filter((r) => !verborgen.has(rijSleutel(r.id)));

  return (
    <main className="rijen">
      {zichtbareRijen.map((r, i) => (
        <Fragment key={r.id}>
          {i > 0 && (
            <Greep
              boven={zichtbareRijen[i - 1].id}
              onder={r.id}
              gewicht={gewicht}
              zet={zetGewicht}
              menu={(e) => openMenu(e)}
            />
          )}
          <Rij
            titel={r.titel}
            leeg={r.leeg}
            gewicht={gewicht[r.id]}
            sluit={() => verberg(rijSleutel(r.id))}
            menu={(e) => openMenu(e, { id: r.id, titel: r.titel })}
          >
            {r.inhoud}
          </Rij>
        </Fragment>
      ))}
      {zichtbareRijen.length === 0 && <p className="zacht leeg-rij">All rows are hidden. Bring them back under Hidden.</p>}
      {menu && (
        <div
          className="menu contextmenu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          // Een klik in het menu zelf sluit het niet vóór de knop hem krijgt.
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            role="menuitem"
            disabled={zichtbareRijen.every((r) => gewicht[r.id] === gewicht[zichtbareRijen[0].id])}
            onClick={() => {
              zetGewicht(GELIJK);
              setMenu(null);
            }}
          >
            Equal row heights
          </button>
          {menu.rij && (
            <button
              role="menuitem"
              onClick={() => {
                verberg(rijSleutel(menu.rij!.id));
                setMenu(null);
              }}
            >
              Hide <strong>{menu.rij.titel}</strong> row
            </button>
          )}
        </div>
      )}
    </main>
  );
}

export type RijId = "apps" | "hardware" | "bestemmingen";

/** Een verborgen rij staat in dezelfde lijst als verborgen strips. */
export function rijSleutel(id: RijId): string {
  return `rij|${id}`;
}

// Hoe hoog de rijen zijn, als verhouding (flex-grow). Een voorkeur van de
// weergave, dus die mag blijven.
const HOOGTES = "pecanmixer.rijen";
const GELIJK: Record<RijId, number> = { apps: 1, hardware: 1, bestemmingen: 1 };
/** Zo laag mag een rij worden bij het slepen, in pixels. */
const MIN_HOOGTE = 110;

function useRijGewichten(): [Record<RijId, number>, (g: Record<RijId, number>) => void] {
  const [gewicht, zet] = useState<Record<RijId, number>>(() => {
    try {
      return { ...GELIJK, ...JSON.parse(localStorage.getItem(HOOGTES) ?? "{}") };
    } catch {
      return GELIJK;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(HOOGTES, JSON.stringify(gewicht));
    } catch {
      // Dan zijn ze na een herstart weer gelijk.
    }
  }, [gewicht]);
  return [gewicht, zet];
}

/** De greep tussen twee rijen: slepen verdeelt hun hoogte opnieuw,
 *  dubbelklik maakt ze even hoog. De andere rijen blijven zoals ze zijn. */
function Greep({
  boven,
  onder,
  gewicht,
  zet,
  menu,
}: {
  boven: RijId;
  onder: RijId;
  gewicht: Record<RijId, number>;
  zet: (g: Record<RijId, number>) => void;
  menu: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className="rij-greep"
      onContextMenu={menu}
      role="separator"
      aria-orientation="horizontal"
      title="Drag to resize, double-click to make both rows equal, right-click for more"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const el = e.currentTarget;
        const a = el.previousElementSibling?.getBoundingClientRect().height ?? 0;
        const b = el.nextElementSibling?.getBoundingClientRect().height ?? 0;
        const som = gewicht[boven] + gewicht[onder];
        if (a + b <= 0) return;
        el.setPointerCapture(e.pointerId);
        el.classList.add("sleept");
        const y0 = e.clientY;
        const beweeg = (ev: PointerEvent) => {
          const min = Math.min(MIN_HOOGTE, (a + b) / 2);
          const nieuw = Math.min(a + b - min, Math.max(min, a + ev.clientY - y0));
          const g = (som * nieuw) / (a + b);
          zet({ ...gewicht, [boven]: g, [onder]: som - g });
        };
        const los = () => {
          el.classList.remove("sleept");
          el.removeEventListener("pointermove", beweeg);
          el.removeEventListener("pointerup", los);
          el.removeEventListener("pointercancel", los);
        };
        el.addEventListener("pointermove", beweeg);
        el.addEventListener("pointerup", los);
        el.addEventListener("pointercancel", los);
      }}
      onDoubleClick={() => {
        const helft = (gewicht[boven] + gewicht[onder]) / 2;
        zet({ ...gewicht, [boven]: helft, [onder]: helft });
      }}
    />
  );
}

// Hoe breed het uitgangendeel van Destinations is, in pixels; null = zo
// breed als zijn strips (zolang dat past). Een voorkeur van de weergave.
const DELING = "pecanmixer.deling";
/** Zo smal mag een deel worden bij het slepen. */
const MIN_DEEL = 120;

/** Twee delen naast elkaar met een greep ertussen. Slepen zet de breedte
 *  van het linker deel, dubbelklik zet hem terug op "zo breed als nodig". */
function Deling({ links, rechts }: { links: ReactNode[]; rechts: ReactNode }) {
  const [breedte, zetBreedte] = useState<number | null>(() => {
    try {
      const b = JSON.parse(localStorage.getItem(DELING) ?? "null");
      return typeof b === "number" ? b : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(DELING, JSON.stringify(breedte));
    } catch {
      // Dan is hij na een herstart weer zo breed als nodig.
    }
  }, [breedte]);
  const linksRef = useRef<HTMLDivElement>(null);

  return (
    <div className="deling">
      <div
        ref={linksRef}
        className="deel deel-links"
        style={breedte === null ? undefined : { flex: `0 0 ${breedte}px` }}
      >
        {links.length ? links : <p className="zacht leeg-rij">No outputs.</p>}
      </div>
      <div
        className="deel-greep"
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize, double-click to fit the outputs"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          const el = e.currentTarget;
          const begin = linksRef.current?.getBoundingClientRect().width ?? 0;
          const totaal = el.parentElement?.getBoundingClientRect().width ?? 0;
          el.setPointerCapture(e.pointerId);
          el.classList.add("sleept");
          const x0 = e.clientX;
          const beweeg = (ev: PointerEvent) => {
            const max = Math.max(MIN_DEEL, totaal - MIN_DEEL - el.offsetWidth);
            zetBreedte(Math.round(Math.min(max, Math.max(MIN_DEEL, begin + ev.clientX - x0))));
          };
          const los = () => {
            el.classList.remove("sleept");
            el.removeEventListener("pointermove", beweeg);
            el.removeEventListener("pointerup", los);
            el.removeEventListener("pointercancel", los);
          };
          el.addEventListener("pointermove", beweeg);
          el.addEventListener("pointerup", los);
          el.addEventListener("pointercancel", los);
        }}
        onDoubleClick={() => zetBreedte(null)}
      />
      <div className="deel deel-rechts">{rechts}</div>
    </div>
  );
}

function Rij({
  titel,
  leeg,
  gewicht,
  sluit,
  menu,
  children,
}: {
  titel: string;
  leeg: string;
  /** Aandeel in de hoogte (flex-grow). */
  gewicht: number;
  sluit: () => void;
  /** Rechtsklik naast de strips. */
  menu: (e: React.MouseEvent) => void;
  children: ReactNode[];
}) {
  return (
    <section className="rij" aria-label={titel} style={{ flexGrow: gewicht }} onContextMenu={menu}>
      <div className="rij-kant">
        <button className="rij-sluit" aria-label={`Hide ${titel}`} title={`Hide the ${titel} row`} onClick={sluit}>
          ×
        </button>
        <div className="rij-titel">{titel}</div>
      </div>
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
  bewerkteBus,
  verberg,
  naarPatchbay,
}: {
  s: Strip;
  mixer: MixerModel;
  bewerkt: Strip | null;
  bewerkteBus: Strip | null;
  verberg: (sleutel: string) => void;
  naarPatchbay: () => void;
}) {
  const elders = mixer.bestemmingen
    .filter(
      (d) =>
        d.sleutel !== bewerkt?.sleutel &&
        d.sleutel !== bewerkteBus?.sleutel &&
        mixer.route(s, d).stand.soort !== "uit",
    )
    .map((d) => d.naam);

  let knop: ReactNode = <div className="kies-leeg" />;
  let regel: ReactNode = elders.length ? `also → ${elders.join(", ")}` : "";
  let amber = false;
  if (bewerkt) {
    const r = mixer.route(s, bewerkt);
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
  }

  // R, altijd naast M: de route naar de gekozen rec-bus. Gaat de bron naar
  // een andere rec-bus, dan is R gedimd rood.
  let rec: RecKnop | undefined;
  if (bewerkteBus) {
    const r = mixer.route(s, bewerkteBus);
    const aan = r.stand.soort === "aan";
    const andere = mixer.bestemmingen
      .filter((d) => d.bus && d.sleutel !== bewerkteBus.sleutel && mixer.route(s, d).stand.soort !== "uit")
      .map((d) => d.naam);
    const ook = andere.length ? ` (also recorded on ${andere.join(", ")})` : "";
    rec =
      r.stand.soort === "aangepast"
        ? { aan: false, aangepast: true, titel: `Custom patch to ${bewerkteBus.naam} — open in patchbay`, klik: naarPatchbay }
        : {
            aan,
            elders: andere.length > 0,
            titel: `${aan ? "Stop recording" : "Record"} on ${bewerkteBus.naam}${ook}`,
            klik: () => schakelRoute(s.sleutel, bewerkteBus.sleutel, aan),
          };
  }

  return (
    <Kaart s={s} verberg={verberg} rec={rec}>
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

/** R op een bron: de route naar de bewerkte rec-bus. */
interface RecKnop {
  aan: boolean;
  aangepast?: boolean;
  /** De bron gaat naar een andere rec-bus. */
  elders?: boolean;
  titel: string;
  klik: () => void;
}

function Kaart({
  s,
  gekozen,
  verberg,
  bestemming,
  opname,
  kies,
  bus,
  rec,
  children,
}: {
  opname?: boolean;
  rec?: RecKnop;
  /** Een rec-bus: fader en M gaan over de bus, met de koppelknop erbij. */
  bus?: {
    stand: BusStand;
    zet: (w: Partial<BusStand>) => void;
    koppel?: { gekoppeld: boolean; wissel: () => void };
    neemtOp: boolean;
    gewapend: boolean;
    /** Klik = alleen deze, `erbij` (Ctrl+klik) = deze erbij of eraf. */
    arm: (erbij: boolean) => void;
    /** Weghalen; ontbreekt bij de enige bus. */
    weg?: () => void;
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
        (bus ? " strip-bus" : "") +
        (kies ? " kiesbaar" : "") +
        (s.stil || gemute ? " strip-stil" : "")
      }
    >
      <div className="strip-kop" title={`${s.naam} — ${s.onder}`}>
        <div className="naam">{s.naam}</div>
        <div className="strip-onder">{s.onder}</div>
        {bus ? (
          bus.weg && (
            <button
              className="verberg"
              aria-label={`Remove ${s.naam}`}
              title="Remove this Rec bus; the buses after it move up"
              onClick={(e) => {
                e.stopPropagation();
                bus.weg!();
              }}
            >
              ×
            </button>
          )
        ) : (
          <button className="verberg" aria-label={`Hide ${s.naam}`} title="Hide" onClick={(e) => {
              e.stopPropagation();
              verberg(s.sleutel);
            }}>
            ×
          </button>
        )}
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
        {rec && (
          <button
            className={
              "knop knop-rec" + (rec.aan ? " aan" : rec.elders ? " elders" : "") + (rec.aangepast ? " aangepast" : "")
            }
            aria-pressed={rec.aan}
            title={rec.titel}
            onClick={rec.klik}
          >
            R
          </button>
        )}
        {bus && (
          <button
            className={"knop knop-opneem" + (bus.gewapend ? " aan" : "") + (bus.neemtOp ? " neemt-op" : "")}
            aria-pressed={bus.gewapend}
            aria-label={`${bus.gewapend ? "Disarm" : "Arm"} ${s.naam}`}
            title={`${bus.gewapend ? "Armed" : "Arm"} ${s.naam} for recording. Click arms only this bus, Ctrl+click adds or removes it.`}
            onClick={(e) => {
              e.stopPropagation();
              bus.arm(e.ctrlKey || e.metaKey);
            }}
          >
            <span className="rondje" aria-hidden="true" />
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
