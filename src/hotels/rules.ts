// OpsMatrix Hotels — the Scope rulebook defaults and the labor math built on
// the SAME per-square-foot idea as the hospital engine (src/pro/rules.ts is
// imported for computeMinutes-style math where it fits; anything hotel-shaped
// is copied here, never edited there).
import type { HotelState, RoomType, Space } from "./store";
import { typeOf } from "./store";

/**
 * Starting numbers — industry-typical, clearly editable, not gospel
 * (Josh may replace them). Departure = full checkout clean; stayover =
 * occupied refresh; turndown = evening service on luxury properties.
 */
export function defaultRoomTypes(): RoomType[] {
  const guest = (id: string, label: string, dep: number, stay: number, turn: number): RoomType =>
    ({ id, label, kind: "guest", departureMin: dep, stayoverMin: stay, turndownMin: turn, sqftPerMin: null, passesPerDay: 0, builtIn: true });
  const pub = (id: string, label: string, sqftPerMin: number, passes: number, kind: "public" | "boh" = "public"): RoomType =>
    ({ id, label, kind, departureMin: 0, stayoverMin: 0, turndownMin: 0, sqftPerMin, passesPerDay: passes, builtIn: true });
  return [
    guest("king", "King", 30, 18, 8),
    guest("queen", "Queen", 30, 18, 8),
    guest("double-queen", "Double Queen", 34, 20, 9),
    guest("accessible", "Accessible King", 32, 19, 8),
    guest("junior-suite", "Junior Suite", 42, 24, 10),
    guest("suite-bedroom", "Suite — bedroom", 30, 18, 8),
    guest("suite-parlor", "Suite — parlor", 22, 12, 4),
    pub("lobby", "Lobby", 250, 3),
    pub("elevator-lobby", "Elevator lobby", 200, 3),
    pub("corridor", "Guest corridor", 300, 2),
    pub("public-restroom", "Public restroom", 40, 4),
    pub("gym", "Fitness center", 180, 2),
    pub("pool-deck", "Pool deck", 220, 2),
    pub("meeting", "Meeting room", 200, 1),
    pub("linen", "Linen / housekeeping closet", 150, 1, "boh"),
    pub("ice-vending", "Ice / vending alcove", 120, 2, "boh"),
    pub("stairwell", "Stairwell", 300, 1, "boh")
  ];
}

export interface MinuteLine { label: string; minutes: number; }

/** minutes for ONE task on ONE space, as visible line items (plain English) */
export function spaceTaskMinutes(
  state: HotelState, sp: Space, task: "departure" | "stayover" | "turndown" | "public"
): { lines: MinuteLine[]; total: number } {
  const t = typeOf(state, sp);
  if (!t) return { lines: [{ label: "Room type not set — cannot price yet", minutes: 0 }], total: 0 };
  const lines: MinuteLine[] = [];
  if (t.kind === "guest") {
    const m = task === "departure" ? t.departureMin : task === "stayover" ? t.stayoverMin : task === "turndown" ? t.turndownMin : 0;
    lines.push({ label: `${t.label} ${task} — ${m} min (Scope)`, minutes: m });
  } else {
    const per = t.sqftPerMin ?? 0;
    const m = per > 0 ? sp.sqft / per : 0;
    lines.push({ label: `${t.label} — 1 min per ${per} sq ft × ${Math.round(sp.sqft)} sq ft`, minutes: m });
  }
  return { lines, total: Math.round(lines.reduce((s, l) => s + l.minutes, 0)) };
}

/** daily public-area minutes across the whole property (all passes) */
export function publicAreaDailyMinutes(state: HotelState): number {
  let total = 0;
  for (const sp of state.spaces) {
    const t = typeOf(state, sp);
    if (!t || t.kind === "guest" || !t.sqftPerMin) continue;
    total += (sp.sqft / t.sqftPerMin) * Math.max(0, t.passesPerDay);
  }
  return Math.round(total);
}

/** the property's average departure / stayover minutes, weighted by room mix */
export function roomMixMinutes(state: HotelState): { departure: number; stayover: number; turndown: number; guestRooms: number } {
  let dep = 0, stay = 0, turn = 0, n = 0;
  for (const sp of state.spaces) {
    const t = typeOf(state, sp);
    if (!t || t.kind !== "guest") continue;
    dep += t.departureMin; stay += t.stayoverMin; turn += t.turndownMin; n += 1;
  }
  if (!n) return { departure: 0, stayover: 0, turndown: 0, guestRooms: 0 };
  return { departure: dep / n, stayover: stay / n, turndown: turn / n, guestRooms: n };
}
