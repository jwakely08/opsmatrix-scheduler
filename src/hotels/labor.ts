// SPACE-BASED LABOR — housekeeping staffing from the actual plan: room mix,
// occupancy forecast, public areas, and TRAVEL between assignments. Boards
// are built as contiguous runs on a floor; every floor change costs the
// Scope travel penalty. The same math prices a hospital's discharges.
import type { HotelState, ForecastDay, Space, Staff } from "./store";
import { statusFor, typeOf, floorsOf } from "./store";
import { roomMixMinutes, publicAreaDailyMinutes } from "./rules";

export interface Demand {
  date: string;
  departures: number; stayovers: number;
  departureMin: number; stayoverMin: number; turndownMin: number; publicMin: number; travelMin: number;
  totalMin: number; attendantsExact: number; attendants: number;
}

/** minutes of travel for a contiguous run of n rooms across f guest floors */
export function contiguousTravel(state: HotelState, rooms: number, floorsTouched: number): number {
  const s = state.settings;
  return Math.max(0, rooms - 1) * s.travelBetweenRoomsMin + Math.max(0, floorsTouched - 1) * s.travelPerFloorChangeMin;
}

export function dailyDemand(state: HotelState, day: ForecastDay): Demand {
  const mix = roomMixMinutes(state);
  const s = state.settings;
  const departureMin = day.departures * mix.departure;
  const stayoverMin = day.stayovers * mix.stayover;
  const turndownMin = s.turndown ? (day.stayovers + day.arrivals) * mix.turndown : 0;
  const publicMin = publicAreaDailyMinutes(state);
  const rooms = day.departures + day.stayovers;
  const guestFloors = Math.max(1, floorsOf(state).filter((f) => state.spaces.some((sp) => sp.floor === f && typeOf(state, sp)?.kind === "guest")).length);
  const travelMin = contiguousTravel(state, rooms, Math.min(guestFloors, Math.max(1, Math.ceil(rooms / 12))));
  const totalMin = Math.round(departureMin + stayoverMin + turndownMin + publicMin + travelMin);
  const attendantsExact = totalMin / Math.max(1, s.productiveMinutes);
  return { date: day.date, departures: day.departures, stayovers: day.stayovers, departureMin: Math.round(departureMin), stayoverMin: Math.round(stayoverMin), turndownMin: Math.round(turndownMin), publicMin, travelMin: Math.round(travelMin), totalMin, attendantsExact: Math.round(attendantsExact * 10) / 10, attendants: Math.ceil(attendantsExact - 0.05) };
}

export function forecastPlan(state: HotelState, scale = 1): { days: Demand[]; weeklyMin: number; fte: number } {
  const days = state.forecast.map((d) => dailyDemand(state, { ...d, departures: Math.round(d.departures * scale), stayovers: Math.round(d.stayovers * scale), arrivals: Math.round(d.arrivals * scale) }));
  const weeklyMin = days.slice(0, 7).reduce((a, d) => a + d.totalMin, 0);
  const s = state.settings;
  return { days, weeklyMin, fte: Math.round((weeklyMin / Math.max(1, s.productiveMinutes * s.shiftsPerWeekPerFte)) * 10) / 10 };
}

/** paste a 14-day sheet: "date, arrivals, departures, stayovers" per line (header optional) */
export function parseForecast(text: string): ForecastDay[] {
  const out: ForecastDay[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(/[,\t;]/).map((c) => c.trim());
    if (cells.length < 4) continue;
    const d = new Date(cells[0]);
    if (Number.isNaN(d.getTime())) continue;
    const [a, dep, st] = cells.slice(1, 4).map((c) => Number(c.replace(/[^0-9.]/g, "")));
    if ([a, dep, st].some((n) => Number.isNaN(n))) continue;
    out.push({ date: d.toISOString().slice(0, 10), arrivals: a, departures: dep, stayovers: st });
  }
  return out;
}

// ── today's boards ──────────────────────────────────────────────────────────
export interface WorkItem { space: Space; task: "departure" | "stayover"; minutes: number; }
export interface Board { attendant?: Staff; items: WorkItem[]; cleanMin: number; travelMin: number; floorChanges: number; floors: string[]; }

/** what needs doing today, from the status layers */
export function todayWork(state: HotelState): WorkItem[] {
  const out: WorkItem[] = [];
  for (const sp of state.spaces) {
    const t = typeOf(state, sp); if (t?.kind !== "guest") continue;
    const st = statusFor(state, sp.id);
    const o = st.occupancy?.value; const c = st.condition?.value;
    if (st.engineering?.ooo) continue;
    if (o === "departing" || ((o === "arriving" || o === "vacant") && (c === "dirty" || c === "in_progress"))) out.push({ space: sp, task: "departure", minutes: t.departureMin });
    else if (o === "stayover" || o === "occupied") out.push({ space: sp, task: "stayover", minutes: t.stayoverMin });
  }
  return out;
}

const byRoom = (a: WorkItem, b: WorkItem) => a.space.floor.localeCompare(b.space.floor, undefined, { numeric: true }) || a.space.number.localeCompare(b.space.number, undefined, { numeric: true });

function priceBoard(state: HotelState, items: WorkItem[], attendant?: Staff): Board {
  const s = state.settings;
  let travel = 0, changes = 0;
  const floors: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const f = items[i].space.floor;
    if (!floors.includes(f)) floors.push(f);
    if (i === 0) continue;
    if (items[i - 1].space.floor !== f) { changes += 1; travel += s.travelPerFloorChangeMin; }
    travel += s.travelBetweenRoomsMin;
  }
  return { attendant, items, cleanMin: items.reduce((a, x) => a + x.minutes, 0), travelMin: travel, floorChanges: changes, floors };
}

/** CONTIGUOUS boards: sort by floor + number, fill each attendant up to the productive limit */
export function buildContiguousBoards(state: HotelState, work: WorkItem[], attendants: Staff[]): Board[] {
  const cap = state.settings.productiveMinutes;
  const sorted = [...work].sort(byRoom);
  const n = Math.max(1, attendants.length || Math.ceil(sorted.reduce((a, x) => a + x.minutes, 0) / cap));
  const target = sorted.reduce((a, x) => a + x.minutes, 0) / n;
  const boards: WorkItem[][] = [[]];
  let acc = 0;
  for (const w of sorted) {
    if (acc + w.minutes > target * 1.05 && boards.length < n) { boards.push([]); acc = 0; }
    boards[boards.length - 1].push(w); acc += w.minutes;
  }
  return boards.map((items, i) => priceBoard(state, items, attendants[i]));
}

/** SCATTERED boards: the way it happens without a plan — rooms dealt round-robin by request order */
export function buildScatteredBoards(state: HotelState, work: WorkItem[], attendants: Staff[]): Board[] {
  const n = Math.max(1, attendants.length || buildContiguousBoards(state, work, []).length);
  // "request order": by room number across floors (301, 401, 303, 403 …) — what a call-down list looks like
  const order = [...work].sort((a, b) => a.space.number.slice(-2).localeCompare(b.space.number.slice(-2), undefined, { numeric: true }) || a.space.floor.localeCompare(b.space.floor, undefined, { numeric: true }));
  const boards: WorkItem[][] = Array.from({ length: n }, () => []);
  order.forEach((w, i) => boards[i % n].push(w));
  return boards.map((items, i) => priceBoard(state, items, attendants[i]));
}

export function compareBoards(state: HotelState): { work: WorkItem[]; contiguous: Board[]; scattered: Board[]; contiguousTravel: number; scatteredTravel: number; savedMin: number; savedDollars: number } {
  const work = todayWork(state);
  const att = state.staff.filter((s) => s.role === "attendant");
  const contiguous = buildContiguousBoards(state, work, att);
  const scattered = buildScatteredBoards(state, work, att);
  const ct = contiguous.reduce((a, b) => a + b.travelMin, 0);
  const st = scattered.reduce((a, b) => a + b.travelMin, 0);
  const savedMin = st - ct;
  return { work, contiguous, scattered, contiguousTravel: ct, scatteredTravel: st, savedMin, savedDollars: Math.round((savedMin / 60) * state.settings.hourlyRate * 100) / 100 };
}

/** labor vs standard: what the plan says vs what was scheduled */
export function variance(state: HotelState, standardMin: number, actualHours: number): { standardHours: number; actualHours: number; deltaHours: number; deltaDollars: number; pct: number } {
  const standardHours = Math.round((standardMin / 60) * 10) / 10;
  const deltaHours = Math.round((actualHours - standardHours) * 10) / 10;
  return { standardHours, actualHours, deltaHours, deltaDollars: Math.round(deltaHours * state.settings.hourlyRate), pct: standardHours ? Math.round((deltaHours / standardHours) * 100) : 0 };
}
