// Floors listed the way the building stands (Josh, 2026-10-21): the top floor first, down through the
// ground floor, then the basements — 7 · 6 · … · 1 · B · B2 — instead of in upload order (a floor
// uploaded again jumped to the top and looked missing from its place).

/** a floor's height in the building; NaN when the name doesn't say */
export function floorLevel(name: unknown): number {
  const s = String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return NaN;
  // below ground: B, B1, B2, Basement, Basement 2, LL, LL2, Lower Level, P1 (parking), SB (sub-basement)
  let m = /^(?:b|basement|bsmt|ll|lower level|p|parking|sub-?basement|sb)\s*-?\s*(\d*)(?:\s*(?:floor|level))?$/.exec(s);
  if (m) return -(Number(m[1]) || 1) - (/^s/.test(s) ? 0.5 : 0);
  if (/^(?:g|gf|ground|ground floor|lobby|street|main|main floor)$/.test(s)) return 0.5;
  if (/^(?:m|mezz|mezzanine)/.test(s)) return 1.5;
  if (/^(?:roof|rooftop|penthouse|ph)\b/.test(s)) return 1000;
  // above ground: 1, 1st Floor, Floor 3, Level 2, L3, 3F, 2nd
  m = /(\d+)/.exec(s);
  return m ? Number(m[1]) : NaN;
}

/** top floor first, basements last; floors whose name says nothing keep their order, on top */
export function sortFloorsTopDown<T extends { floor?: unknown }>(plans: T[]): T[] {
  return plans
    .map((p, i) => ({ p, i, level: floorLevel(p.floor) }))
    .sort((a, b) => {
      const la = Number.isNaN(a.level) ? Infinity : a.level, lb = Number.isNaN(b.level) ? Infinity : b.level;
      return lb - la || a.i - b.i;
    })
    .map((x) => x.p);
}
