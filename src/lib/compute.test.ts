import { describe, it, expect } from "vitest";
import { defaultState } from "./seeds";
import {
  findBaseRate, roomMinutesPerVisit, roomDailyMinutes, jobDailyMinutes,
  employeeAssignedMinutes, rollup, facilityFTE, roomStatus
} from "./compute";
import type { AppState, Room, NonSpaceJob } from "./types";

function mkRoom(over: Partial<Room>): Room {
  return {
    id: "r1", floorId: "f1", department: "Test", name: "Room", roomType: "Patient Room",
    floorType: "VCT", fixtures: 0, cleanableSqFt: 1000, ceilingHeight: "8' 0\"",
    perimeter: "", doorAreaSqFt: 0, windowAreaSqFt: 0, tasks: [], frequency: "7x",
    shiftId: null, employeeId: null, mapX: null, mapY: null, source: "test",
    ...over
  };
}

describe("workload math (known inputs → expected minutes)", () => {
  const s: AppState = defaultState();

  it("base rate lookup: exact, (any) floor, global fallback", () => {
    expect(findBaseRate(s, "Patient Room", "VCT")).toBe(34);
    expect(findBaseRate(s, "Patient Room", "Carpet")).toBe(25); // falls to global (any)
    expect(findBaseRate(s, "Nonexistent", "Nonexistent")).toBe(25);
  });

  it("1000 sq ft patient room on VCT at 7x/week = 34 min/visit and 34 min/day", () => {
    const r = mkRoom({});
    expect(roomMinutesPerVisit(s, r)).toBeCloseTo(34, 5);
    expect(roomDailyMinutes(s, r)).toBeCloseTo(34, 5);
  });

  it("fixtures add fixtureMinutes each (restroom: 45.88 sq ft tile + 3 fixtures)", () => {
    const r = mkRoom({ roomType: "Restroom", floorType: "Ceramic Tile", cleanableSqFt: 45.88, fixtures: 3 });
    // 45.88/1000*60 + 3*3 = 2.7528 + 9 = 11.7528
    expect(roomMinutesPerVisit(s, r)).toBeCloseTo(11.7528, 4);
  });

  it("frequency scales daily-equivalent minutes (5x/week office)", () => {
    const r = mkRoom({ roomType: "Office", floorType: "Carpet", cleanableSqFt: 143, frequency: "5x" });
    const perVisit = (143 / 1000) * 22;
    expect(roomDailyMinutes(s, r)).toBeCloseTo((perVisit * 5) / 7, 5);
  });

  it("workload math uses cleanableSqFt only (gross never enters)", () => {
    // identical rooms except a bigger \"gross\" concept doesn't exist on Room at all —
    // the type only carries cleanableSqFt, so assert the math scales with it alone.
    const a = mkRoom({ cleanableSqFt: 500 });
    const b = mkRoom({ cleanableSqFt: 1000 });
    expect(roomMinutesPerVisit(s, b)).toBeCloseTo(roomMinutesPerVisit(s, a) * 2, 5);
  });

  it("FTE = total daily minutes / productive minutes", () => {
    const st = defaultState();
    st.rooms = [mkRoom({ cleanableSqFt: 1000 })]; // 34 min/day
    st.jobs = [{ id: "j1", name: "Discharges", type: "discharge", mode: "unit", minutes: 0, unitsPerDay: 6, minutesPerUnit: 45, shiftId: null, employeeId: null }];
    // (34 + 270) / 420
    expect(facilityFTE(st)).toBeCloseTo(304 / 420, 5);
  });
});

describe("non-space jobs", () => {
  it("unit mode: units/day × minutes each", () => {
    const j: NonSpaceJob = { id: "j", name: "Discharges", type: "discharge", mode: "unit", minutes: 0, unitsPerDay: 6, minutesPerUnit: 45, shiftId: null, employeeId: null };
    expect(jobDailyMinutes(j)).toBe(270);
  });
  it("block mode: fixed minutes/day", () => {
    const j: NonSpaceJob = { id: "j", name: "Trash run", type: "trashlinen", mode: "block", minutes: 240, unitsPerDay: 0, minutesPerUnit: 0, shiftId: null, employeeId: null };
    expect(jobDailyMinutes(j)).toBe(240);
  });
});

describe("schedule capacity calculations", () => {
  it("employee load = assigned room daily minutes + assigned job minutes", () => {
    const st = defaultState();
    st.employees = [{ id: "e1", name: "A", role: "EVS Tech", shiftId: "sh_days", pattern: [false, true, true, true, true, true, false] }];
    st.rooms = [
      mkRoom({ id: "r1", employeeId: "e1", shiftId: "sh_days" }),                       // 34
      mkRoom({ id: "r2", cleanableSqFt: 500, employeeId: "e1", shiftId: "sh_days" }),   // 17
      mkRoom({ id: "r3", cleanableSqFt: 500 })                                          // unassigned
    ];
    st.jobs = [{ id: "j1", name: "Discharges", type: "discharge", mode: "unit", minutes: 0, unitsPerDay: 2, minutesPerUnit: 45, shiftId: "sh_days", employeeId: "e1" }];
    expect(employeeAssignedMinutes(st, "e1")).toBeCloseTo(34 + 17 + 90, 5);
  });

  it("room status: unscheduled → partial (shift only) → scheduled (employee)", () => {
    expect(roomStatus(mkRoom({}))).toBe("unscheduled");
    expect(roomStatus(mkRoom({ shiftId: "sh_days" }))).toBe("partial");
    expect(roomStatus(mkRoom({ shiftId: "sh_days", employeeId: "e1" }))).toBe("scheduled");
  });

  it("rollup counts statuses and totals sq ft + minutes", () => {
    const st = defaultState();
    const rooms = [
      mkRoom({ id: "r1", employeeId: "e1", shiftId: "sh_days" }),
      mkRoom({ id: "r2", shiftId: "sh_days" }),
      mkRoom({ id: "r3" })
    ];
    const ru = rollup(st, rooms);
    expect(ru.rooms).toBe(3);
    expect(ru.scheduled).toBe(1);
    expect(ru.partial).toBe(1);
    expect(ru.unscheduled).toBe(1);
    expect(ru.sqft).toBe(3000);
    expect(ru.dailyMin).toBeCloseTo(102, 5);
  });
});
