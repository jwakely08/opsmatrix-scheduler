// Workload math engine (v2): base rate + floor-finish modifier + room-type
// qualifiers, per task frequency. Fully transparent — every number can be
// broken down into plain-English lines via roomBreakdown().
// cleanableSqFt is the ONLY area used in workload math; gross is reference only.
import type { AppState, Room, NonSpaceJob, Scope, RoomTypeTemplate } from "./types";
import { FLOOR_FINISH_SHORT } from "./types";

export function byId<T extends { id: string }>(list: T[], id: string | null): T | null {
  if (!id) return null;
  return list.find((x) => x.id === id) ?? null;
}

export function templateForRoom(state: AppState, room: Room): RoomTypeTemplate | null {
  return state.roomTypes.find((t) => t.name === room.roomType) ?? null;
}

export function freqPerWeek(state: AppState, freqId: string): number {
  const f = state.frequencies.find((x) => x.id === freqId);
  return f ? f.perWeek : 7;
}

export interface BreakdownLine {
  label: string;
  /** additive minutes (absent for multiplier lines) */
  minutes?: number;
  /** multiplier factor (absent for additive lines) */
  factor?: number;
}

export interface RoomBreakdown {
  lines: BreakdownLine[];
  perVisit: number;
  perWeek: number;
  daily: number;
  freqLabel: string;
}

/** The whole math for one room, as plain-English line items. */
export function roomBreakdown(state: AppState, room: Room): RoomBreakdown {
  const k = (room.cleanableSqFt || 0) / 1000;
  const lines: BreakdownLine[] = [];
  let subtotal = 0;

  const base = k * state.rates.baseMinutesPer1000;
  lines.push({ label: "Base clean", minutes: base });
  subtotal += base;

  const finishAdj = state.rates.floorFinishAdjust[room.floorFinish] ?? 0;
  if (finishAdj !== 0) {
    const m = k * finishAdj;
    lines.push({ label: FLOOR_FINISH_SHORT[room.floorFinish], minutes: m });
    subtotal += m;
  }

  const tpl = templateForRoom(state, room);
  const multipliers: BreakdownLine[] = [];
  for (const qual of tpl?.qualifiers ?? []) {
    if (qual.kind === "per1000") {
      const m = k * qual.value;
      lines.push({ label: qual.label, minutes: m });
      subtotal += m;
    } else if (qual.kind === "perFixture") {
      if ((room.fixtures || 0) > 0) {
        const m = room.fixtures * qual.value;
        lines.push({ label: `${qual.label} (${room.fixtures} × ${qual.value})`, minutes: m });
        subtotal += m;
      }
    } else if (qual.kind === "flatPerVisit") {
      lines.push({ label: qual.label, minutes: qual.value });
      subtotal += qual.value;
    } else if (qual.kind === "multiplier") {
      multipliers.push({ label: qual.label, factor: qual.value });
    }
  }
  let perVisit = subtotal;
  for (const m of multipliers) {
    lines.push(m);
    perVisit *= m.factor!;
  }

  const perWeek = freqPerWeek(state, room.frequency);
  const f = state.frequencies.find((x) => x.id === room.frequency);
  return {
    lines,
    perVisit,
    perWeek,
    daily: (perVisit * perWeek) / 7,
    freqLabel: f ? f.label : "Every day"
  };
}

export function roomMinutesPerVisit(state: AppState, room: Room): number {
  return roomBreakdown(state, room).perVisit;
}

/** daily-equivalent minutes: per-visit minutes spread over the week by frequency */
export function roomDailyMinutes(state: AppState, room: Room): number {
  return roomBreakdown(state, room).daily;
}

export function jobDailyMinutes(job: NonSpaceJob): number {
  if (job.mode === "unit") return (job.unitsPerDay || 0) * (job.minutesPerUnit || 0);
  return job.minutes || 0;
}

export type RoomStatus = "scheduled" | "partial" | "unscheduled";
export function roomStatus(room: Room): RoomStatus {
  if (room.employeeId) return "scheduled";
  if (room.shiftId) return "partial";
  return "unscheduled";
}

export function employeeAssignedMinutes(state: AppState, empId: string): number {
  let total = 0;
  for (const r of state.rooms) if (r.employeeId === empId) total += roomDailyMinutes(state, r);
  for (const j of state.jobs) if (j.employeeId === empId) total += jobDailyMinutes(j);
  return total;
}

/** Plain-English load description for a capacity bar. */
export function loadWord(assigned: number, capacity: number): string {
  const pct = capacity > 0 ? assigned / capacity : 0;
  if (pct > 1) return "overloaded";
  if (pct > 0.85) return "full day";
  if (pct > 0.6) return "steady day";
  return "light day";
}

export function scopedRooms(state: AppState, scope: Scope | null): Room[] {
  if (!scope) return state.rooms.slice();
  return state.rooms.filter((r) => {
    const fl = byId(state.floors, r.floorId);
    if (!fl) return false;
    switch (scope.type) {
      case "building": return fl.buildingId === scope.buildingId;
      case "floor": return r.floorId === scope.floorId;
      case "dept": return r.floorId === scope.floorId && (r.department || "Unassigned") === scope.dept;
      case "room": return r.id === scope.roomId;
    }
  });
}

export interface Rollup {
  rooms: number; sqft: number; dailyMin: number;
  scheduled: number; partial: number; unscheduled: number;
}
export function rollup(state: AppState, rooms: Room[]): Rollup {
  const out: Rollup = { rooms: rooms.length, sqft: 0, dailyMin: 0, scheduled: 0, partial: 0, unscheduled: 0 };
  for (const r of rooms) {
    out.sqft += r.cleanableSqFt || 0;
    out.dailyMin += roomDailyMinutes(state, r);
    const st = roomStatus(r);
    if (st === "scheduled") out.scheduled++;
    else if (st === "partial") out.partial++;
    else out.unscheduled++;
  }
  return out;
}

export function facilityFTE(state: AppState): number {
  let total = 0;
  for (const r of state.rooms) total += roomDailyMinutes(state, r);
  for (const j of state.jobs) total += jobDailyMinutes(j);
  return total / Math.max(1, state.rates.productiveMinutes);
}

export function deptKey(room: Room): string {
  return room.department || "Unassigned";
}

export function deptColor(state: AppState, name: string): string {
  const d = state.departments.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return d ? d.color : "#c9d4db";
}
