// THE SCHEDULE MATRIX (Josh, 2026-09-27): every schedule as one colored
// block — 101, 102, 103 … — recolorable by load, shift, department or
// worker, click a block to open that schedule. Pure logic lives here (and is
// tested); ScheduleMatrix.tsx only draws it.
//
// Load uses the SAME totaler and the SAME target as the Schedules tab —
// scheduleMinutes() against the schedule's own targetHours × 60 — so a block
// can never disagree with the card and bar a manager sees in the list.

export type LoadBandId = "way-under" | "under" | "on" | "heavy" | "way-over";

export interface LoadBand {
  id: LoadBandId;
  label: string;
  /** legend wording, plain English */
  range: string;
  color: string;
}

// blue → green → red, the way Josh described it: cooler = under-scheduled,
// green = where you want it, hotter = over. Every step also differs in
// lightness so the scale still reads for color-blind managers.
export const LOAD_BANDS: LoadBand[] = [
  { id: "way-under", label: "Way under", range: "below 80%", color: "#5b8cff" },
  { id: "under", label: "Under", range: "80–95%", color: "#38bdf8" },
  { id: "on", label: "On target", range: "95–105%", color: "#22c55e" },
  { id: "heavy", label: "Heavy", range: "105–115%", color: "#f59e0b" },
  { id: "way-over", label: "Way over", range: "above 115%", color: "#ef4444" }
];

/** percent of target → its band (edges: 95 and 105 are on target) */
export function loadBand(pct: number): LoadBand {
  if (!(pct >= 80)) return LOAD_BANDS[0];
  if (pct < 95) return LOAD_BANDS[1];
  if (pct <= 105) return LOAD_BANDS[2];
  if (pct <= 115) return LOAD_BANDS[3];
  return LOAD_BANDS[4];
}

export type ShiftKey = "1st" | "2nd" | "3rd" | "split" | "other";

export interface ShiftStyle { key: ShiftKey; label: string; short: string; color: string }

export const SHIFT_STYLES: ShiftStyle[] = [
  { key: "1st", label: "1st Shift", short: "1ST", color: "#fbbf24" },
  { key: "2nd", label: "2nd Shift", short: "2ND", color: "#a78bfa" },
  { key: "3rd", label: "3rd Shift", short: "3RD", color: "#60a5fa" },
  { key: "split", label: "Split Shift", short: "SPLIT", color: "#f472b6" },
  { key: "other", label: "Other / not set", short: "—", color: "#94a3b8" }
];

/** a schedule's free-text shift ("1st Shift", "days", "Split") → its key */
export function shiftKey(shift: string | undefined): ShiftKey {
  const s = String(shift ?? "").toLowerCase();
  if (s.includes("split")) return "split";
  if (/\b1(st)?\b|first|day/.test(s)) return "1st";
  if (/\b2(nd)?\b|second|evening|swing/.test(s)) return "2nd";
  if (/\b3(rd)?\b|third|night|overnight/.test(s)) return "3rd";
  return "other";
}

export function shiftStyle(shift: string | undefined): ShiftStyle {
  const k = shiftKey(shift);
  return SHIFT_STYLES.find((x) => x.key === k)!;
}

const SHIFT_ORDER: Record<ShiftKey, number> = { "1st": 0, "2nd": 1, "3rd": 2, split: 3, other: 4 };

/** one schedule, flattened for the matrix */
export interface MatrixItem {
  id: string;
  num: string;
  name: string;
  shift: ShiftKey;
  minutes: number;
  target: number;
  /** schedules built in Floor Care / Sanitation / Policing move rooms there */
  lockedTo?: string;
  /** rooms in cleaning order, with the minutes THIS schedule spends in each */
  rooms: { id: string; label: string; minutes: number }[];
}

export function loadPct(it: Pick<MatrixItem, "minutes" | "target">): number {
  return it.target > 0 ? Math.round((it.minutes / it.target) * 100) : 0;
}

export type MatrixSort = "num" | "load" | "shift";

/** numeric-aware schedule-number compare: 101 < 102 < 110 < P01 */
function numCompare(a: string, b: string): number {
  const na = Number(a), nb = Number(b);
  const fa = Number.isFinite(na) && a !== "", fb = Number.isFinite(nb) && b !== "";
  if (fa && fb) return na - nb;
  if (fa) return -1;
  if (fb) return 1;
  return a.localeCompare(b);
}

export function sortItems<T extends MatrixItem>(items: T[], sort: MatrixSort): T[] {
  const out = items.slice();
  if (sort === "load") out.sort((a, b) => loadPct(b) - loadPct(a) || numCompare(a.num, b.num));
  else if (sort === "shift") out.sort((a, b) => SHIFT_ORDER[a.shift] - SHIFT_ORDER[b.shift] || numCompare(a.num, b.num));
  else out.sort((a, b) => numCompare(a.num, b.num));
  return out;
}

export interface MatrixSummary {
  count: number;
  totalMinutes: number;
  /** total workload ÷ productive minutes per shift (the Scope constant) */
  fte: number;
  avgPct: number;
  on: number;
  under: number;
  over: number;
}

export function summarize(items: MatrixItem[], productiveMinutes: number): MatrixSummary {
  let total = 0, pctSum = 0, on = 0, under = 0, over = 0;
  for (const it of items) {
    total += it.minutes;
    const p = loadPct(it);
    pctSum += p;
    if (p < 95) under++;
    else if (p > 105) over++;
    else on++;
  }
  return {
    count: items.length,
    totalMinutes: total,
    fte: productiveMinutes > 0 ? Math.round((total / productiveMinutes) * 10) / 10 : 0,
    avgPct: items.length ? Math.round(pctSum / items.length) : 0,
    on, under, over
  };
}

/**
 * The rebalance hint for one schedule. An over-scheduled schedule looks for
 * the LIGHTEST schedule on the same shift and names a real room of its own
 * that fits the gap; an under-scheduled one looks for the HEAVIEST partner
 * and names one of that partner's rooms. Always same-shift: moving a room to
 * a different shift is a staffing decision, not a rebalance. Plain English —
 * the manager reads this sentence, not a number.
 */
export function rebalanceHint(item: MatrixItem, all: MatrixItem[]): string {
  const pct = loadPct(item);
  if (item.lockedTo) return `Built in ${item.lockedTo} — rebalance it there.`;
  if (pct >= 95 && pct <= 105) return "Balanced — no change needed.";
  const partners = all.filter((x) => x.id !== item.id && x.shift === item.shift && !x.lockedTo);
  const shiftName = SHIFT_STYLES.find((s) => s.key === item.shift)!.label;
  if (pct > 105) {
    const excess = item.minutes - item.target;
    const light = partners.filter((x) => x.minutes < x.target).sort((a, b) => loadPct(a) - loadPct(b))[0];
    if (!light) return `Every other ${shiftName} schedule is full — this shift may need more coverage.`;
    const room = bestFit(item.rooms, Math.min(excess, light.target - light.minutes));
    const what = room ? `${room.label} (${room.minutes} min)` : `about ${excess} min of work`;
    return `Move ${what} to Schedule ${light.num || light.name} (${loadPct(light)}%) — both land closer to target.`;
  }
  const room0 = item.target - item.minutes;
  const heavy = partners.filter((x) => x.minutes > x.target).sort((a, b) => loadPct(b) - loadPct(a))[0];
  if (!heavy) return `Room for about ${room0} more minutes of work.`;
  const room = bestFit(heavy.rooms, Math.min(room0, heavy.minutes - heavy.target));
  const what = room ? `${room.label} (${room.minutes} min)` : `about ${Math.min(room0, heavy.minutes - heavy.target)} min`;
  return `Take ${what} from Schedule ${heavy.num || heavy.name} (${loadPct(heavy)}%) to even out the shift.`;
}

/** the room whose minutes come closest to `gap` without going over (else the smallest) */
function bestFit(rooms: MatrixItem["rooms"], gap: number): MatrixItem["rooms"][number] | null {
  const priced = rooms.filter((r) => r.minutes > 0);
  if (!priced.length || gap <= 0) return null;
  const fits = priced.filter((r) => r.minutes <= gap).sort((a, b) => b.minutes - a.minutes);
  if (fits.length) return fits[0];
  return priced.slice().sort((a, b) => a.minutes - b.minutes)[0];
}
