// De kleine tegels in de modulekop. Lijn-iconen, kleur per soort ding.

import type { ReactNode } from "react";
import type { Icoon } from "./indeling";

const KLEUR: Record<Icoon, [string, string]> = {
  noot: ["#26382c", "#7fd39a"],
  wereld: ["#3a2a1c", "#f0a36b"],
  speel: ["#22303d", "#7fb6e6"],
  praat: ["#2a2a40", "#a5a8f0"],
  opname: ["#3d2020", "#ef6b6b"],
  apparaat: ["#262a2e", "#b9bec3"],
  scherm: ["#262a2e", "#b9bec3"],
  toetsen: ["#2a2a40", "#a5a8f0"],
  golf: ["#3a2a1c", "#f0a36b"],
  app: ["#22303d", "#7fb6e6"],
};

const PAD: Record<Icoon, ReactNode> = {
  noot: (
    <>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </>
  ),
  wereld: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
    </>
  ),
  speel: <path d="M7 5l12 7-12 7z" strokeLinejoin="round" />,
  praat: <path d="M4 5h16v11H9l-5 4z" strokeLinejoin="round" />,
  opname: <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />,
  apparaat: (
    <>
      <rect x="3" y="7" width="18" height="10" rx="2" />
      <path d="M7 12h.01M11 12h.01" />
    </>
  ),
  scherm: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8" />
    </>
  ),
  toetsen: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M7 6v7M12 6v7M17 6v7" />
    </>
  ),
  golf: <path d="M3 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0" />,
  app: <rect x="4" y="4" width="16" height="16" rx="3" />,
};

export function IcoonTegel({ icoon }: { icoon: Icoon }) {
  const [achter, voor] = KLEUR[icoon];
  return (
    <div className="tegel" style={{ background: achter, color: voor }}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="round"
        aria-hidden="true"
      >
        {PAD[icoon]}
      </svg>
    </div>
  );
}
