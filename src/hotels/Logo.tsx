// The OpsMatrix mark, reworked for Hotels: the gear silhouette in gold with a
// stylized key where the hospital mark carries the cross.
import React from "react";

export function LogoMark({ size = 40 }: { size?: number }) {
  // twelve-tooth gear ring
  const teeth: string[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const a1 = a - 0.11, a2 = a + 0.11;
    const r1 = 40, r2 = 47;
    teeth.push(`M ${50 + r1 * Math.cos(a1)} ${50 + r1 * Math.sin(a1)} L ${50 + r2 * Math.cos(a1)} ${50 + r2 * Math.sin(a1)} L ${50 + r2 * Math.cos(a2)} ${50 + r2 * Math.sin(a2)} L ${50 + r1 * Math.cos(a2)} ${50 + r1 * Math.sin(a2)} Z`);
  }
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 100 100" aria-label="OpsMatrix Hotels">
      <defs>
        <linearGradient id="hx-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#D4B77A" />
          <stop offset="1" stopColor="#B8945A" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="40" fill="none" stroke="url(#hx-gold)" strokeWidth="7" />
      <path d={teeth.join(" ")} fill="url(#hx-gold)" />
      {/* the key */}
      <circle cx="50" cy="36" r="9" fill="none" stroke="url(#hx-gold)" strokeWidth="5" />
      <path d="M50 45 V70 M50 60 H58 M50 67 H56" fill="none" stroke="url(#hx-gold)" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="wordmark">
      <LogoMark size={compact ? 32 : 40} />
      <div className="wm-text">
        <span className="wm-name">OpsMatrix</span>
        <span className="wm-tag">Hotels</span>
      </div>
    </div>
  );
}

/** monochrome line icons for the nav — never emoji */
export const ICONS: Record<string, React.ReactNode> = {
  map: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 10v10M15 4v6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  walk: <><circle cx="12" cy="5" r="2" /><path d="M10 9l-2 6 3 1 1 4M10 9l4 1 2 4M12 15l-3 4" /></>,
  labor: <><path d="M4 20V10M10 20V4M16 20v-8M22 20H2" /></>,
  handover: <><path d="M6 4h9l4 4v12H6z" /><path d="M9 12h7M9 16h7" /></>,
  scar: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  desk: <><path d="M3 18h18M5 18V9h14v9" /><path d="M9 9V6h6v3" /></>,
  rooms: <><path d="M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16" /><path d="M9 21v-6h6v6M8 7h2M14 7h2M8 11h2M14 11h2" /></>,
  scope: <><circle cx="12" cy="12" r="9" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /><circle cx="12" cy="12" r="3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.3 3h-4.6l-.3 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.3 2.6h4.6l.3-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z" /></>,
  design: <><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" /></>,
  check: <path d="M5 12l5 5L20 7" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  back: <path d="M15 5l-7 7 7 7" />,
  print: <><path d="M6 9V3h12v6M6 18H4v-7h16v7h-2" /><rect x="6" y="14" width="12" height="7" /></>,
  share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></>,
  key: <><circle cx="8" cy="12" r="4" /><path d="M12 12h9M18 12v3M15 12v2" /></>
};

export function Icon({ name }: { name: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[name] ?? ICONS.map}</svg>;
}
