// De MIDI-meter: activiteits-LED met events per seconde, de zestien kanalen,
// de berichtsoorten en het laatste event. Als blok in de mixer, als regel in
// de patchbay.

import { beeld, SOORTEN, useTik } from "./midi";

export function MidiBlok({ poorten, bestemming }: { poorten: number[]; bestemming?: boolean }) {
  useTik();
  const b = beeld(poorten);
  const tekst = bestemming
    ? b.actief || b.perSeconde > 0
      ? "receiving"
      : "silent"
    : b.perSeconde > 0
      ? `${Math.round(b.perSeconde)} ev/s`
      : "silent";
  const kanalen = b.kanalen.flatMap((aan, i) => (aan ? [i + 1] : []));
  return (
    <div
      className="midi-blok"
      role="img"
      aria-label={kanalen.length ? `Activity on channel ${kanalen.join(", ")}` : "No activity"}
    >
      <div className="midi-kop">
        <span className={`led${b.actief ? " aan" : ""}`} />
        <span className="mono zacht">{tekst}</span>
      </div>
      <div className="kanaalraster">
        {b.kanalen.map((aan, i) => (
          <span key={i} className={aan ? "aan" : undefined}>
            {i + 1}
          </span>
        ))}
      </div>
      <div className="soortraster">
        {SOORTEN.map((s, i) => (
          <span key={s} className={b.soorten[i] ? "aan" : undefined}>
            {s}
          </span>
        ))}
      </div>
      <div className="midi-laatste">{b.laatste ?? "—"}</div>
    </div>
  );
}

export function MidiRegel({ poort, label, ingang }: { poort: number[]; label: string; ingang: boolean }) {
  useTik();
  const b = beeld(poort);
  return (
    <div className={`midi-regel${ingang ? " in" : ""}`}>
      <div className="regel-boven">
        <span className={`led${b.actief ? " aan" : ""}`} />
        <span className="poortnaam">{label}</span>
        <span className="vul" />
        <span className="midi-laatste">{b.laatste ?? "—"}</span>
      </div>
      <div className="regel-onder">
        <div className="kanaalbalk" aria-hidden="true">
          {b.kanalen.map((aan, i) => (
            <span key={i} className={aan ? "aan" : undefined} />
          ))}
        </div>
        <span className="vul" />
        <div className="soortbalk">
          {SOORTEN.map((s, i) => (
            <span key={s} className={b.soorten[i] ? "aan" : undefined}>
              {s}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
