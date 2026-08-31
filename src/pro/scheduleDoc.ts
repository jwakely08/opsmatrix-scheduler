// The printed daily schedule, derived entirely from data OpsMatrix already
// holds. Nothing here is typed in by hand and nothing is boilerplate:
//
//   • the ROOM ORDER is the order rooms were tapped onto the schedule
//     (sched.spaceOrder) — room 1 on paper is the first room tapped
//   • the TASKS for each room come from the task-ownership model: what THIS
//     schedule covers in THAT room (general clean + its extras), in the
//     manager's own vocabulary from the rules engine
//   • the MINUTES come from the rules engine, same numbers as the map
//   • the TIME column walks the clock from the shift's start through those
//     minutes, so the times are a consequence of the workload, not a guess
//   • PRIORITY is the room's own field, set during Max Space validation
//
// This module is pure (no DOM, no storage) so the numbers can be tested.
import {
  coverageForSpace, coverageMinutes, spacePriority, nonSpaceTaskMinutes,
  type ClassicData, type ClassicSchedule, type ClassicSpace, type Priority
} from "./classicStore";
import { type Rules, type BreakRule } from "./rules";

export interface DocRow {
  spaceId: string;
  /** 1-based running order — the order the rooms were tapped in */
  order: number;
  startTime: string;
  roomNumber: string;
  roomName: string;
  roomType: string;
  /** plain-English task names for this room ON THIS SCHEDULE */
  tasks: string[];
  priority: Priority;
  minutes: number;
}

export interface DocBreak {
  id: string;
  startTime: string;
  endTime: string;
  label: string;
  minutes: number;
  /** this break falls after this many rooms (index into rows) */
  afterRow: number;
}

export interface DocNonSpace {
  id: string;
  name: string;
  minutes: number;
  linkedRooms: string[];
}

export interface ScheduleDoc {
  num: string;
  name: string;
  shift: string;
  shiftStart: string;
  shiftEnd: string;
  unit: string;
  building: string;
  floor: string;
  date: string;
  color: string;
  rows: DocRow[];
  breaks: DocBreak[];
  /** when the room-by-room run finishes */
  roomsEnd: string;
  nonSpace: DocNonSpace[];
  nonSpaceWindow: { start: string; end: string } | null;
  totals: {
    rooms: number;
    roomMinutes: number;
    nonSpaceMinutes: number;
    totalMinutes: number;
    shiftMinutes: number;
    breakMinutes: number;
    overShift: boolean;
    priority: Record<Priority, number>;
    /** how many rooms carry each task, most common first */
    taskCounts: { label: string; count: number }[];
  };
}

// ── clock helpers (12-hour, matching the way EVS schedules are written) ──────

/** "7:00 AM" / "07:00" / "3:30 PM" → minutes since midnight (null if unusable) */
export function parseClock(text: string | undefined): number | null {
  if (!text) return null;
  const m = /^\s*(\d{1,2})[:.](\d{2})\s*([AaPp][Mm])?\s*$/.exec(text);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const ampm = m[3]?.toLowerCase();
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  return h * 60 + min;
}

export function formatClock(minutes: number): string {
  const wrapped = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h24 = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/** shift length in minutes, handling shifts that cross midnight (3rd shift) */
function shiftSpan(start: number, end: number): number {
  return end > start ? end - start : end + 1440 - start;
}

interface ClassicShift { id?: string; name?: string; start?: string; end?: string; active?: boolean }

/** the shift record this schedule runs on, by name, with sane fallbacks */
export function shiftFor(data: ClassicData, sched: ClassicSchedule): { name: string; start: number; end: number } {
  const shifts = ((data.v7 as { shifts?: ClassicShift[] }).shifts ?? []).filter((s) => s.active !== false);
  const name = String(sched.shift ?? "").trim();
  const hit = shifts.find((s) => String(s.name ?? "").trim().toLowerCase() === name.toLowerCase());
  const fallback: Record<string, [string, string]> = {
    "1st shift": ["7:00 AM", "3:00 PM"],
    "2nd shift": ["3:00 PM", "11:00 PM"],
    "3rd shift": ["11:00 PM", "7:00 AM"]
  };
  const fb = fallback[name.toLowerCase()] ?? ["7:00 AM", "3:00 PM"];
  const start = parseClock(hit?.start) ?? parseClock(fb[0])!;
  const end = parseClock(hit?.end) ?? parseClock(fb[1])!;
  return { name: name || (hit?.name ?? "1st Shift"), start, end };
}

// ── breaks: the account's, unless this schedule says otherwise ──────────────

/** a break as it applies to one schedule, in minutes-since-shift-start */
export interface ResolvedBreak { id: string; label: string; minutes: number; offset: number }

/** per-schedule break override, stored on the schedule itself */
export interface SchedBreak { id: string; start?: string; minutes?: number; off?: boolean }

/**
 * Which breaks this schedule takes and when. Account settings supply the
 * defaults; a schedule may move one, shorten it, or switch it off. A break is
 * skipped when it does not land inside this schedule's shift — that is what
 * keeps a 1st-shift lunch off a 3rd-shift sheet without anyone configuring it.
 */
export function resolveBreaks(
  rules: Rules,
  sched: ClassicSchedule,
  shift: { start: number; end: number }
): ResolvedBreak[] {
  const overrides = (sched.breaks ?? []) as SchedBreak[];
  const span = shiftSpan(shift.start, shift.end);
  const out: ResolvedBreak[] = [];

  for (const b of rules.breaks ?? []) {
    const ov = overrides.find((o) => o.id === b.id);
    if (ov?.off) continue;
    const minutes = Number(ov?.minutes ?? b.minutes) || 0;
    if (minutes <= 0) continue;
    const at = parseClock(ov?.start ?? b.start);
    if (at === null) continue;
    // measured from the shift's own start, so shifts crossing midnight work
    const offset = ((at - shift.start) % 1440 + 1440) % 1440;
    if (offset >= span) continue;
    out.push({ id: b.id, label: b.label, minutes, offset });
  }
  return out.sort((a, b) => a.offset - b.offset);
}

/** the account breaks that would apply, for showing in the schedule editor */
export function breakChoices(rules: Rules): BreakRule[] {
  return rules.breaks ?? [];
}

// ── the builder ─────────────────────────────────────────────────────────────

export interface DocOptions {
  /** printed date; defaults to today */
  date?: Date;
}

/**
 * Turn one schedule into the document that gets printed. Every field traces
 * back to something a manager set in OpsMatrix.
 */
export function buildScheduleDoc(
  data: ClassicData,
  rules: Rules,
  sched: ClassicSchedule,
  opts: DocOptions = {}
): ScheduleDoc {
  const spaces = data.v7.spaces ?? [];
  const shift = shiftFor(data, sched);

  const span = shiftSpan(shift.start, shift.end);
  const pending = resolveBreaks(rules, sched, shift);

  const rows: DocRow[] = [];
  const breaks: DocBreak[] = [];
  // absolute minutes, counted forward from the shift start so a shift that
  // runs past midnight keeps moving forward instead of wrapping backwards
  let clock = shift.start;

  /** take any breaks that are now due — always between rooms, never inside one */
  const takeBreaksDue = (force = false) => {
    while (pending.length) {
      const b = pending[0];
      const due = shift.start + b.offset;
      if (!force && clock < due) break;
      pending.shift();
      const at = Math.max(clock, due);
      breaks.push({
        id: b.id, label: b.label, minutes: b.minutes, afterRow: rows.length,
        startTime: formatClock(at), endTime: formatClock(at + b.minutes)
      });
      clock = at + b.minutes;
    }
  };

  const ordered = (sched.spaceOrder ?? [])
    .map((id) => spaces.find((s) => s.id === id))
    .filter(Boolean) as ClassicSpace[];

  // Sanitation/Policing routes aren't cleaning coverage — their per-stop
  // minutes ride on the schedule itself (routeStopMinutes), and the printed
  // running order uses them directly
  const routeMinutes = (sched.routeOnly
    ? (sched.routeStopMinutes as Record<string, number> | undefined)
    : undefined) ?? null;

  for (const sp of ordered) {
    const cov = coverageForSpace(data, sp.id).find((c) => c.scheduleId === sched.id);
    if (!cov && !routeMinutes) continue;

    takeBreaksDue();

    const minutes = routeMinutes
      ? Math.round(Number(routeMinutes[sp.id]) || 0)
      : coverageMinutes(rules, sp, cov!);
    rows.push({
      spaceId: sp.id,
      order: rows.length + 1,
      startTime: formatClock(clock),
      roomNumber: String(sp.roomNumber ?? ""),
      roomName: String(sp.roomName ?? sp.roomNumber ?? ""),
      roomType: String(sp.roomType ?? ""),
      tasks: cov ? coverageTaskLabels(rules, cov) : ["Route stop"],
      priority: spacePriority(sp),
      minutes
    });
    clock += minutes;
  }

  // a short list of rooms can finish before a break comes round — the worker
  // still gets it, so it prints at its proper time rather than vanishing
  if (rows.length) takeBreaksDue(true);

  const roomsEnd = formatClock(clock);
  const roomMinutes = rows.reduce((s, r) => s + r.minutes, 0);

  const nonSpace: DocNonSpace[] = data.nonSpace
    .filter((t) => t.scheduleId === sched.id)
    .map((t) => ({
      id: t.id,
      // counted tasks print the count so the worker knows the volume planned
      name: Number(t.count) > 0 ? `${t.name} × ${t.count}` : t.name,
      minutes: Math.round(nonSpaceTaskMinutes(t)),
      linkedRooms: t.roomIds
        .map((id) => spaces.find((s) => s.id === id))
        .filter(Boolean)
        .map((sp) => String((sp as ClassicSpace).roomNumber ?? (sp as ClassicSpace).roomName ?? ""))
    }));
  const nonSpaceMinutes = nonSpace.reduce((s, t) => s + t.minutes, 0);

  const priority: Record<Priority, number> = { High: 0, Medium: 0, Low: 0 };
  for (const r of rows) priority[r.priority]++;

  const counts = new Map<string, number>();
  for (const r of rows) for (const t of r.tasks) counts.set(t, (counts.get(t) ?? 0) + 1);

  const breakMinutes = breaks.reduce((s, b) => s + b.minutes, 0);
  const totalMinutes = roomMinutes + nonSpaceMinutes + breakMinutes;
  const plan = spaces.find((s) => s.id === rows[0]?.spaceId);

  return {
    num: String(sched.num ?? ""),
    name: String(sched.name ?? "Schedule"),
    shift: shift.name,
    shiftStart: formatClock(shift.start),
    shiftEnd: formatClock(shift.end),
    unit: String(sched.name ?? ""),
    building: String(plan?.building ?? ""),
    floor: String(plan?.floor ?? ""),
    date: (opts.date ?? new Date()).toLocaleDateString(undefined,
      { month: "long", day: "numeric", year: "numeric" }),
    color: String(sched.color ?? "#0d9488"),
    rows,
    breaks,
    roomsEnd,
    nonSpace,
    nonSpaceWindow: nonSpace.length ? { start: roomsEnd, end: formatClock(shift.end) } : null,
    totals: {
      rooms: rows.length,
      roomMinutes,
      nonSpaceMinutes,
      totalMinutes,
      shiftMinutes: span,
      breakMinutes,
      overShift: totalMinutes > span,
      priority,
      taskCounts: [...counts.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    }
  };
}

/**
 * The tasks one schedule performs in one room, in plain English. The base
 * clean always leads, then the room's extras in the rules engine's own order
 * so every printed schedule reads the same way.
 */
export function coverageTaskLabels(
  rules: Rules,
  cov: { primary: boolean; tasks: string[] }
): string[] {
  const out: string[] = [];
  if (cov.primary) out.push("General Clean");
  for (const t of rules.tasks) {
    if (cov.tasks.includes(t.id)) out.push(t.label);
  }
  // anything the rules engine no longer knows about still prints, never drops
  for (const id of cov.tasks) {
    if (!rules.tasks.some((t) => t.id === id)) out.push(id);
  }
  return out;
}
