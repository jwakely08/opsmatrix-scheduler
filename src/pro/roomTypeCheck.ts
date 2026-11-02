// Checking the numbers (Josh, 2026-11-02: "patient rooms similar in square footage are off from each
// other by a minute or two… a small utility room gets 11 minutes but the break room gets 1… one
// labeled nurse's station is 52 minutes… we need to look through these room types and the algorithm").
//
// Two views of the same engine (rules.ts computeMinutes), nothing new invented:
//   • a ROOM's minutes, split into what EVS cleans (the General Clean formula + its extras) and the
//     floor-care tasks riding on it (Max Floor Care's time, which the map label still counts);
//   • a ROOM TYPE's rooms side by side — how big they run, how many minutes they get, the rate that
//     implies, and the rooms that stand out from the rest, each with the reason in plain words
//     (far bigger or smaller than the typical room, extra tasks, fixed minutes).
// Pure and unit-tested; Scope's room-type cards and Max Space's room sidebar show it.
import type { ClassicSpace } from "./classicStore";
import {
  autoTasksFor, computeMinutes, gcFormula, isFloorCareTask, requiredTasks, typeIdFromLabelStrict, type Rules
} from "./rules";

export interface MinuteLine { label: string; minutes: number; floorCare: boolean }

export interface RoomMinutes {
  /** what the map label shows: everything, rounded */
  total: number;
  /** the General Clean formula + the extras EVS does — what a schedule gets */
  cleaning: number;
  /** floor-care tasks on the room — priced in Max Floor Care */
  floorCare: number;
  lines: MinuteLine[];
}

/** one room's minutes, each line labelled as the engine words it, floor care told apart */
export function roomMinutes(rules: Rules, sp: ClassicSpace): RoomMinutes {
  const req = requiredTasks(rules, sp);
  const clean = computeMinutes(rules, sp, { tasks: req.filter((t) => !isFloorCareTask(rules, t)), includeBase: true });
  const fc = computeMinutes(rules, sp, { tasks: req.filter((t) => isFloorCareTask(rules, t)), includeBase: false });
  return {
    total: computeMinutes(rules, sp).total,
    cleaning: clean.total,
    floorCare: fc.total,
    lines: [
      ...clean.lines.map((l) => ({ ...l, floorCare: false })),
      ...fc.lines.map((l) => ({ ...l, floorCare: true }))
    ]
  };
}

export interface RoomNote {
  id: string;
  roomNumber: string;
  roomName: string;
  sqft: number;
  /** cleaning minutes (floor care left out) */
  minutes: number;
  floorCare: number;
  reasons: string[];
}

export interface TypeCheck {
  rooms: number;
  sqft: { min: number; median: number; max: number } | null;
  minutes: { min: number; median: number; max: number } | null;
  /** cleaning minutes a typical room of this type gets per 100 sq ft, from the rooms themselves */
  perHundred: number | null;
  /** rooms far from the rest, worst first */
  unusual: RoomNote[];
  /** rooms carrying floor-care tasks, and those tasks' minutes in all — Max Floor Care's, not EVS's */
  floorCareRooms: number;
  floorCareMinutes: number;
}

export const EMPTY_CHECK: TypeCheck = { rooms: 0, sqft: null, minutes: null, perHundred: null, unusual: [], floorCareRooms: 0, floorCareMinutes: 0 };
const EMPTY = EMPTY_CHECK;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * The rooms of one type, looked at together. A room stands out when it is far bigger or smaller
 * than the typical room (2.5× / under 0.4× the median, once there are 8 rooms to judge by), or
 * when its minutes aren't what the rulebook gives a room of its size and type — the type's formula
 * plus the extras the type and its floor hand out automatically: a task added by hand, a usual
 * task taken off, or a formula that doesn't fit.
 */
export function checkType(rules: Rules, spaces: ClassicSpace[], typeId: string): TypeCheck {
  const rt = rules.roomTypes.find((x) => x.id === typeId);
  const rooms = spaces.filter((sp) => typeIdFromLabelStrict(rules, sp.roomType) === typeId);
  if (!rt || !rooms.length) return { ...EMPTY, rooms: rooms.length };
  const label = (id: string) => rules.tasks.find((t) => t.id === id)?.label ?? id;
  const rows = rooms.map((sp) => {
    const m = roomMinutes(rules, sp);
    const sqft = Number(sp.squareFeet) || 0;
    // what the rulebook alone would give this room: its type's formula + the type's/floor's automatic tasks
    const auto = autoTasksFor(rules, rt.id, sp.floorType).filter((t) => !isFloorCareTask(rules, t));
    const expected = computeMinutes(rules, { ...sp, spaceTasks: auto }, { tasks: auto, includeBase: true }).total;
    const own = requiredTasks(rules, sp).filter((t) => !isFloorCareTask(rules, t));
    return { sp, sqft, m, expected, added: own.filter((t) => !auto.includes(t)), missing: auto.filter((t) => !own.includes(t)) };
  });
  const sqfts = rows.map((r) => r.sqft), mins = rows.map((r) => r.m.cleaning);
  const medSqft = median(sqfts), medMin = median(mins);
  const judgeSize = rows.length >= 8 && medSqft > 0;

  const unusual: RoomNote[] = [];
  for (const r of rows) {
    const reasons: string[] = [];
    if (judgeSize && r.sqft > medSqft * 2.5) reasons.push(`${fmt(r.sqft)} sq ft — ${Math.round(r.sqft / medSqft)}× the typical ${fmt(medSqft)} sq ft`);
    else if (judgeSize && r.sqft > 0 && r.sqft < medSqft * 0.4) reasons.push(`${fmt(r.sqft)} sq ft — well under the typical ${fmt(medSqft)} sq ft; is the shape right?`);
    if (r.sqft <= 0) reasons.push("no square footage yet");
    const diff = r.m.cleaning - r.expected;
    if (Math.abs(diff) >= 2) {
      if (r.added.length) reasons.push(`${diff > 0 ? "+" : ""}${fmt(diff)} min: added by hand — ${r.added.map(label).join(", ")}`);
      else if (r.missing.length) reasons.push(`${fmt(diff)} min: without the usual ${r.missing.map(label).join(", ")}`);
      else reasons.push(`${r.m.cleaning} min — the rulebook gives ${fmt(r.expected)} for a ${rt.label} this size`);
    } else if (!reasons.length && r.added.length && r.m.lines.some((l) => !l.floorCare && r.added.some((t) => l.label.startsWith(label(t))))) {
      // a small added task still deserves a mention, so nothing is hidden
      reasons.push(`added by hand — ${r.added.map(label).join(", ")}`);
    }
    if (!reasons.length) continue;
    unusual.push({
      id: r.sp.id, roomNumber: String(r.sp.roomNumber ?? ""), roomName: String(r.sp.roomName ?? ""),
      sqft: r.sqft, minutes: r.m.cleaning, floorCare: r.m.floorCare, reasons
    });
  }
  unusual.sort((a, b) => Math.abs(b.minutes - medMin) - Math.abs(a.minutes - medMin) || b.sqft - a.sqft);

  const fcRows = rows.filter((r) => r.m.floorCare > 0);
  return {
    rooms: rows.length,
    sqft: { min: Math.min(...sqfts), median: medSqft, max: Math.max(...sqfts) },
    minutes: { min: Math.min(...mins), median: medMin, max: Math.max(...mins) },
    perHundred: medSqft > 0 ? Math.round((medMin / medSqft) * 100 * 10) / 10 : null,
    unusual,
    floorCareRooms: fcRows.length,
    floorCareMinutes: fcRows.reduce((s, r) => s + r.m.floorCare, 0)
  };
}

/** every type's check at once — one pass over the rooms */
export function checkAllTypes(rules: Rules, spaces: ClassicSpace[]): Map<string, TypeCheck> {
  const out = new Map<string, TypeCheck>();
  for (const rt of rules.roomTypes) out.set(rt.id, checkType(rules, spaces, rt.id));
  return out;
}
