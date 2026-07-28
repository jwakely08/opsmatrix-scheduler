// Workload math engine — ported unchanged in behavior from opsmatrix-scheduler.html.
// cleanableSqFt is the ONLY area used in workload math; gross is reference only.
import type { AppState, Room, NonSpaceJob, Scope } from "./types";

export function byId<T extends { id: string }>(list: T[], id: string | null): T | null {
  if (!id) return null;
  return list.find((x) => x.id === id) ?? null;
}

export function findBaseRate(state: AppState, roomType: string, floorType: string): number {
  const rows = state.rates.baseRates;
  const exact = rows.find((r) => r.roomType === roomType && r.floorType === floorType);
  if (exact) return exact.minutesPer1000;
  const anyFloor = rows.find((r) => r.roomType === roomType && r.floorType === "(any)");
  if (anyFloor) return anyFloor.minutesPer1000;
  const fallback = rows.find((r) => r.roomType === "(any)");
  if (fallback) return fallback.minutesPer1000;
  return 25;
}

export function freqPerWeek(state: AppState, freqId: string): number {
  const f = state.frequencies.find((x) => x.id === freqId);
  return f ? f.perWeek : 7;
}

export function roomMinutesPerVisit(state: AppState, room: Room): number {
  const base = (room.cleanableSqFt / 1000) * findBaseRate(state, room.roomType, room.floorType);
  const fix = (room.fixtures || 0) * state.rates.fixtureMinutes;
  return base + fix;
}

/** daily-equivalent minutes: per-visit minutes spread over the week by frequency */
export function roomDailyMinutes(state: AppState, room: Room): number {
  return (roomMinutesPerVisit(state, room) * freqPerWeek(state, room.frequency)) / 7;
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
