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
  type ClassicData, type ClassicSchedule, type ClassicSpace, type NonSpaceTask, type Priority
} from "./classicStore";
import {
  generalCleanLine, includedTasksFor, typeIdFromLabel,
  type Rules, type BreakRule, type DutyPosition, type ProcedureStep
} from "./rules";

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
  /**
   * The General Clean worked out, when this schedule does it here:
   * "Office: 152 sq ft ÷ 4,250 sq ft/hr = 2.1 min" — printed beside it
   */
  generalClean?: string;
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
  /** unpaid: it lengthens the day rather than coming out of the paid shift */
  unpaid: boolean;
}

export interface DocNonSpace {
  id: string;
  name: string;
  minutes: number;
  linkedRooms: string[];
}

/** a start- or end-of-shift duty (cart setup, cart teardown): a real stop */
export interface DocDuty extends DocNonSpace {
  position: "start" | "end";
  startTime: string;
  endTime: string;
}

/** one line of the printed running order, in the order the day happens */
export type DocStop =
  | { kind: "duty"; duty: DocDuty }
  | { kind: "room"; row: DocRow }
  | { kind: "break"; brk: DocBreak };

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
  /** start duties, rooms, breaks and end duties, in clock order */
  timeline: DocStop[];
  startDuties: DocDuty[];
  endDuties: DocDuty[];
  /** when the room-by-room run finishes */
  roomsEnd: string;
  /** when the last stop finishes (the end duties, when there are any) */
  dayEnd: string;
  /** the "anytime" duties, worked around the rooms */
  nonSpace: DocNonSpace[];
  nonSpaceWindow: { start: string; end: string } | null;
  /** the account's cleaning procedure, or null when hidden / empty */
  procedure: { steps: ProcedureStep[]; example: boolean } | null;
  totals: {
    rooms: number;
    roomMinutes: number;
    /** every non-space task on the schedule, start/end duties included */
    nonSpaceMinutes: number;
    /** just the start- and end-of-shift duties */
    shiftDutyMinutes: number;
    /** rooms + non-space work + every break: the whole day, start to finish */
    totalMinutes: number;
    /** the whole day the worker is there: paid shift + unpaid breaks */
    shiftMinutes: number;
    breakMinutes: number;
    paidBreakMinutes: number;
    unpaidBreakMinutes: number;
    /** rooms + non-space work + paid breaks — what the shift pays for */
    paidMinutes: number;
    /** the paid shift itself (the shift record's hours) */
    paidShiftMinutes: number;
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

export interface ShiftHours {
  name: string;
  start: number;
  /** when the day ends — after any unpaid breaks, when rules were given */
  end: number;
  /** the paid shift, in minutes (the shift record's own hours) */
  paidMinutes: number;
  /** unpaid break minutes this schedule takes, added on to the day */
  unpaidMinutes: number;
}

/**
 * The hours this schedule works. The shift record is the PAID shift; with
 * the account's rules, unpaid breaks are added on to the end of the day —
 * 1st Shift 7:00 AM – 3:00 PM with a 30-minute unpaid lunch runs to 3:30 PM.
 */
export function shiftFor(data: ClassicData, sched: ClassicSchedule, rules?: Rules): ShiftHours {
  const paid = paidShiftFor(data, sched);
  const paidMinutes = shiftSpan(paid.start, paid.end);
  const unpaidMinutes = rules
    ? resolveBreaks(rules, sched, paid).filter((b) => b.unpaid).reduce((s, b) => s + b.minutes, 0)
    : 0;
  return { ...paid, end: (paid.end + unpaidMinutes) % 1440, paidMinutes, unpaidMinutes };
}

/** the shift record this schedule runs on, by name, with sane fallbacks */
function paidShiftFor(data: ClassicData, sched: ClassicSchedule): { name: string; start: number; end: number } {
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
export interface ResolvedBreak { id: string; label: string; minutes: number; offset: number; unpaid: boolean }

/** per-schedule break override, stored on the schedule itself */
export interface SchedBreak { id: string; start?: string; minutes?: number; off?: boolean; unpaid?: boolean }

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
    out.push({ id: b.id, label: b.label, minutes, offset, unpaid: Boolean(ov?.unpaid ?? b.unpaid) });
  }
  return out.sort((a, b) => a.offset - b.offset);
}

/**
 * How much work one schedule can hold (Josh, 2026-10-12): the paid shift
 * (targetHours, 8 by default) less its paid breaks. Non-space duties count
 * as work against it, like rooms; unpaid breaks don't touch it.
 */
export function scheduleCapacity(data: ClassicData, rules: Rules, sched: ClassicSchedule): {
  paidMinutes: number; paidBreakMinutes: number; unpaidBreakMinutes: number; workMinutes: number;
} {
  const paidMinutes = (Number(sched.targetHours) || 8) * 60;
  const breaks = resolveBreaks(rules, sched, paidShiftFor(data, sched));
  const paidBreakMinutes = breaks.filter((b) => !b.unpaid).reduce((s, b) => s + b.minutes, 0);
  const unpaidBreakMinutes = breaks.filter((b) => b.unpaid).reduce((s, b) => s + b.minutes, 0);
  return { paidMinutes, paidBreakMinutes, unpaidBreakMinutes, workMinutes: paidMinutes - paidBreakMinutes };
}

/** the account breaks that would apply, for showing in the schedule editor */
export function breakChoices(rules: Rules): BreakRule[] {
  return rules.breaks ?? [];
}

// ── start / end-of-shift duties ─────────────────────────────────────────────

/** when in the shift a schedule's non-space task happens, from its Scope def */
export function dutyPosition(rules: Rules, t: Pick<NonSpaceTask, "defId" | "name">): DutyPosition {
  const def = rules.nonSpaceDefs.find((d) => d.id === t.defId)
    ?? (t.defId ? undefined : rules.nonSpaceDefs.find((d) => d.label === t.name));
  return def?.position ?? "anytime";
}

/**
 * The summary-strip wording for the start/end duties, said the way a
 * supervisor would: ["Cart Setup", "Cart Teardown"] → "cart setup & teardown".
 */
export function shiftDutyPhrase(names: string[]): string {
  const words = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))]
    .map((n) => n.split(/\s+/));
  const list = (xs: string[]) =>
    xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} & ${xs[xs.length - 1]}`;
  const lead = words[0]?.[0];
  if (words.length > 1 && words.every((w) => w.length > 1 && w[0] === lead)) {
    return `${lead} ${list(words.map((w) => w.slice(1).join(" ")))}`;
  }
  return list(words.map((w) => w.join(" ")));
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
  const shift = shiftFor(data, sched, rules);

  // the whole day: the paid shift plus any unpaid breaks
  const span = shift.paidMinutes + shift.unpaidMinutes;
  // breaks belong to the paid shift's hours — the same ones shiftFor added up
  const pending = resolveBreaks(rules, sched, { start: shift.start, end: shift.start + shift.paidMinutes });

  const rows: DocRow[] = [];
  const breaks: DocBreak[] = [];
  const timeline: DocStop[] = [];
  // absolute minutes, counted forward from the shift start so a shift that
  // runs past midnight keeps moving forward instead of wrapping backwards
  let clock = shift.start;

  /** take any breaks that are now due — always between stops, never inside one */
  const takeBreaksDue = (force = false) => {
    while (pending.length) {
      const b = pending[0];
      const due = shift.start + b.offset;
      if (!force && clock < due) break;
      pending.shift();
      const at = Math.max(clock, due);
      const brk: DocBreak = {
        id: b.id, label: b.label, minutes: b.minutes, afterRow: rows.length, unpaid: b.unpaid,
        startTime: formatClock(at), endTime: formatClock(at + b.minutes)
      };
      breaks.push(brk);
      timeline.push({ kind: "break", brk });
      clock = at + b.minutes;
    }
  };

  // this schedule's non-space work, each sorted by WHEN in the shift it falls
  const tasks = data.nonSpace
    .filter((t) => t.scheduleId === sched.id)
    .map((t) => ({ t, position: dutyPosition(rules, t) }))
    .map(({ t, position }) => ({
      position,
      item: {
        id: t.id,
        // counted tasks print the count so the worker knows the volume planned
        // (a once-a-shift duty like cart setup is just its name)
        name: Number(t.count) > 0 && !(position !== "anytime" && Number(t.count) === 1)
          ? `${t.name} × ${t.count}` : t.name,
        minutes: Math.round(nonSpaceTaskMinutes(t)),
        linkedRooms: t.roomIds
          .map((id) => spaces.find((s) => s.id === id))
          .filter(Boolean)
          .map((sp) => String((sp as ClassicSpace).roomNumber ?? (sp as ClassicSpace).roomName ?? ""))
      } as DocNonSpace
    }));
  const startDuties: DocDuty[] = [];
  const endDuties: DocDuty[] = [];
  const runDuty = (item: DocNonSpace, position: "start" | "end", out: DocDuty[]) => {
    const duty: DocDuty = {
      ...item, position, startTime: formatClock(clock), endTime: formatClock(clock + item.minutes)
    };
    out.push(duty);
    timeline.push({ kind: "duty", duty });
    clock += item.minutes;
  };

  // start-of-shift duties (cart setup) are the first stops: rooms begin after
  for (const t of tasks) {
    if (t.position !== "start") continue;
    takeBreaksDue();
    runDuty(t.item, "start", startDuties);
  }

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
    const row: DocRow = {
      spaceId: sp.id,
      order: rows.length + 1,
      startTime: formatClock(clock),
      roomNumber: String(sp.roomNumber ?? ""),
      roomName: String(sp.roomName ?? sp.roomNumber ?? ""),
      roomType: String(sp.roomType ?? ""),
      // a task the type's General Clean includes is part of that line, not an extra
      tasks: cov ? coverageTaskLabels(rules, {
        ...cov, tasks: cov.tasks.filter((t) => !includedTasksFor(rules, typeIdFromLabel(rules, String(sp.roomType ?? ""))).includes(t))
      }) : ["Route stop"],
      ...(cov?.primary && !rules.general.formulaOff ? { generalClean: generalCleanLine(rules, sp).text } : {}),
      priority: spacePriority(sp),
      minutes
    };
    rows.push(row);
    timeline.push({ kind: "room", row });
    clock += minutes;
  }

  // when the last room is done — before any breaks still to come
  const roomsEnd = formatClock(clock);

  const ends = tasks.filter((t) => t.position === "end");
  // a short list of rooms can finish before a break comes round — the worker
  // still gets it, so it prints at its proper time rather than vanishing
  if (rows.length || startDuties.length || ends.length) takeBreaksDue(true);
  const roomMinutes = rows.reduce((s, r) => s + r.minutes, 0);

  // end-of-shift duties (cart teardown) are the last stops: they finish as
  // the shift ends, or straight after the rooms when the rooms run long
  const endTotal = ends.reduce((s, t) => s + t.item.minutes, 0);
  const endsStart = Math.max(clock, shift.start + span - endTotal);
  if (ends.length) clock = endsStart;
  for (const t of ends) runDuty(t.item, "end", endDuties);

  const nonSpace: DocNonSpace[] = tasks.filter((t) => t.position === "anytime").map((t) => t.item);
  const nonSpaceMinutes = tasks.reduce((s, t) => s + t.item.minutes, 0);
  const shiftDutyMinutes = [...startDuties, ...endDuties].reduce((s, t) => s + t.minutes, 0);

  const priority: Record<Priority, number> = { High: 0, Medium: 0, Low: 0 };
  for (const r of rows) priority[r.priority]++;

  const counts = new Map<string, number>();
  for (const r of rows) for (const t of r.tasks) counts.set(t, (counts.get(t) ?? 0) + 1);

  const breakMinutes = breaks.reduce((s, b) => s + b.minutes, 0);
  const unpaidBreakMinutes = breaks.filter((b) => b.unpaid).reduce((s, b) => s + b.minutes, 0);
  const paidBreakMinutes = breakMinutes - unpaidBreakMinutes;
  const totalMinutes = roomMinutes + nonSpaceMinutes + breakMinutes;
  const plan = spaces.find((s) => s.id === rows[0]?.spaceId);

  const proc = rules.procedure;
  const steps = (proc?.steps ?? []).filter((s) => String(s.title ?? "").trim());

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
    timeline,
    startDuties,
    endDuties,
    roomsEnd,
    dayEnd: formatClock(clock),
    nonSpace,
    nonSpaceWindow: nonSpace.length
      ? { start: roomsEnd, end: formatClock(ends.length ? endsStart : shift.end) }
      : null,
    procedure: proc && proc.show !== false && steps.length
      ? { steps, example: proc.example === true }
      : null,
    totals: {
      rooms: rows.length,
      roomMinutes,
      nonSpaceMinutes,
      shiftDutyMinutes,
      totalMinutes,
      shiftMinutes: span,
      breakMinutes,
      paidBreakMinutes,
      unpaidBreakMinutes,
      paidMinutes: totalMinutes - unpaidBreakMinutes,
      paidShiftMinutes: shift.paidMinutes,
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
