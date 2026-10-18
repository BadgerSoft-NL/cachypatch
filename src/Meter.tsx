// Eén meterbalkje. De hoogte zet meters.ts rechtstreeks; React tekent alleen
// het kader.

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
  const vul = useRef<HTMLDivElement>(null);
  const piek = useRef<HTMLDivElement>(null);
  const sleutel = kanalen.join(",");
  useEffect(
    () => koppel(vul.current!, knoop, kanalen, klein ? undefined : piek.current!),
    [knoop, sleutel, klein],
  );
  return (
    <div className={`meter${klein ? " klein" : ""}`} aria-hidden="true">
      <div className="meter-vul" ref={vul} />
      {!klein && <div className="meter-piek" ref={piek} />}
    </div>
  );
}
