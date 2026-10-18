// Eén meterkanaal, zoals in CachyMix: clip-lampje, baan met een vast
// verloop waarvan de stand de bovenkant wegknipt, en een piekstreep. De stand
// zet meters.ts rechtstreeks; React tekent alleen het kader.

import { useEffect, useRef } from "react";
import { koppel } from "./meters";

export function MeterBalk({
  knoop,
  kanalen,
  klein,
}: {
  knoop: number;
  kanalen: number[];
  klein?: boolean;
}) {
  const balk = useRef<HTMLDivElement>(null);
  const piek = useRef<HTMLDivElement>(null);
  const clip = useRef<HTMLDivElement>(null);
  const sleutel = kanalen.join(",");
  useEffect(
    () => koppel(balk.current!, knoop, kanalen, piek.current ?? undefined, clip.current ?? undefined),
    [knoop, sleutel],
  );
  if (klein) {
    return (
      <div className="meter-baan klein" aria-hidden="true">
        <div className="meter-balk" ref={balk} />
      </div>
    );
  }
  return (
    <div className="meter-kanaal" aria-hidden="true">
      <div className="meter-clip" ref={clip} />
      <div className="meter-baan">
        <div className="meter-balk" ref={balk} />
        <div className="meter-piek" ref={piek} />
      </div>
    </div>
  );
}
