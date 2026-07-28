import { describe, it, expect } from "vitest";
import { defaultState } from "./seeds";
import { migrateState } from "./migrate";
import {
  roomMinutesPerVisit, roomDailyMinutes, roomBreakdown, jobDailyMinutes,
  employeeAssignedMinutes, rollup, facilityFTE, roomStatus, loadWord
} from "./compute";
import type { AppState, Room, NonSpaceJob } from "./types";

function mkRoom(over: Partial<Room>): Room {
  return {
    id: "r1", floorId: "f1", department: "Test", name: "Room", roomType: "Patient Room",
    floorFinish: "hard", fixtures: 0, cleanableSqFt: 1000, ceilingHeight: "8' 0\"",
    perimeter: "", doorAreaSqFt: 0, windowAreaSqFt: 0, tasks: [], frequency: "7x",
    shiftId: null, employeeId: null, mapX: null, mapY: null, source: "test",
    ...over
  };
}

describe("layered workload math: base + floor finish + qualifiers", () => {
  const s: AppState = defaultState();
  // seeds: base 15/1000; finish adjust hard 0 / other +3 / carpet +6
  // Patient Room quals: high-touch +12/1000, +3/fixture

  it("plain room on hard floor = base only", () => {
    const r = mkRoom({ roomType: "(untyped)", fixtures: 0 });
    expect(roomMinutesPerVisit(s, r)).toBeCloseTo(15, 5);
  });

  it("floor finish adds per-1000 minutes (carpet +6, other +3)", () => {
    expect(roomMinutesPerVisit(s, mkRoom({ roomType: "(untyped)", floorFinish: "carpet" }))).toBeCloseTo(21, 5);
    expect(roomMinutesPerVisit(s, mkRoom({ roomType: "(untyped)", floorFinish: "other" }))).toBeCloseTo(18, 5);
  });

  it("room-type qualifiers add on top (patient room: high-touch + fixtures)", () => {
    const r = mkRoom({ fixtures: 1 }); // Patient Room, hard, 1000 ft²
    // 15 (base) + 12 (high-touch) + 1×3 (fixture) = 30
    expect(roomMinutesPerVisit(s, r)).toBeCloseTo(30, 5);
  });

  it("perFixture scales with fixture count (restroom, 3 fixtures)", () => {
    const r = mkRoom({ roomType: "Restroom", cleanableSqFt: 45.88, fixtures: 3 });
    // 45.88/1000 × (15 + 25) + 3×3 = 1.8352 + 9 = 10.8352
    expect(roomMinutesPerVisit(s, r)).toBeCloseTo(10.8352, 3);
  });

  it("multiplier qualifiers apply after additive lines (corridor ×0.6)", () => {
    const r = mkRoom({ roomType: "Corridor", cleanableSqFt: 1000 });
    expect(roomMinutesPerVisit(s, r)).toBeCloseTo(15 * 0.6, 5);
  });

  it("frequency spreads per-visit minutes over the week", () => {
    const r = mkRoom({ roomType: "(untyped)", frequency: "5x" });
    expect(roomDailyMinutes(s, r)).toBeCloseTo((15 * 5) / 7, 5);
  });

  it("breakdown lines sum to the per-visit total (transparency, no black boxes)", () => {
    const r = mkRoom({ roomType: "Restroom", cleanableSqFt: 500, fixtures: 2, floorFinish: "carpet" });
    const b = roomBreakdown(s, r);
    let additive = 0;
    let factor = 1;
    for (const line of b.lines) {
      if (line.minutes !== undefined) additive += line.minutes;
      if (line.factor !== undefined) factor *= line.factor;
    }
    expect(additive * factor).toBeCloseTo(b.perVisit, 6);
    expect(b.lines[0].label).toBe("Base clean");
    expect(b.lines.some((l) => l.label.includes("fixture"))).toBe(true);
  });

  it("math scales with cleanableSqFt only (gross never enters)", () => {
    const a = mkRoom({ roomType: "(untyped)", cleanableSqFt: 500 });
    const b = mkRoom({ roomType: "(untyped)", cleanableSqFt: 1000 });
    expect(roomMinutesPerVisit(s, b)).toBeCloseTo(roomMinutesPerVisit(s, a) * 2, 5);
  });

  it("FTE = total daily minutes / productive minutes", () => {
    const st = defaultState();
    st.rooms = [mkRoom({ roomType: "(untyped)" })]; // 15/day
    st.jobs = [{ id: "j1", name: "Discharges", type: "discharge", mode: "unit", minutes: 0, unitsPerDay: 6, minutesPerUnit: 45, shiftId: null, employeeId: null }];
    expect(facilityFTE(st)).toBeCloseTo(285 / 420, 5);
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

describe("schedule capacity", () => {
  it("employee load = assigned room daily minutes + job minutes", () => {
    const st = defaultState();
    st.employees = [{ id: "e1", name: "A", role: "EVS Tech", shiftId: "sh_days", pattern: [false, true, true, true, true, true, false] }];
    st.rooms = [
      mkRoom({ id: "r1", roomType: "(untyped)", employeeId: "e1", shiftId: "sh_days" }),                      // 15
      mkRoom({ id: "r2", roomType: "(untyped)", cleanableSqFt: 500, employeeId: "e1", shiftId: "sh_days" }),  // 7.5
      mkRoom({ id: "r3", roomType: "(untyped)", cleanableSqFt: 500 })                                          // unassigned
    ];
    st.jobs = [{ id: "j1", name: "Discharges", type: "discharge", mode: "unit", minutes: 0, unitsPerDay: 2, minutesPerUnit: 45, shiftId: "sh_days", employeeId: "e1" }];
    expect(employeeAssignedMinutes(st, "e1")).toBeCloseTo(15 + 7.5 + 90, 5);
  });

  it("room status: unscheduled → partial (shift only) → scheduled (employee)", () => {
    expect(roomStatus(mkRoom({}))).toBe("unscheduled");
    expect(roomStatus(mkRoom({ shiftId: "sh_days" }))).toBe("partial");
    expect(roomStatus(mkRoom({ shiftId: "sh_days", employeeId: "e1" }))).toBe("scheduled");
  });

  it("plain-English load words at the right thresholds", () => {
    expect(loadWord(100, 420)).toBe("light day");
    expect(loadWord(300, 420)).toBe("steady day");
    expect(loadWord(400, 420)).toBe("full day");
    expect(loadWord(500, 420)).toBe("overloaded");
  });

  it("rollup counts statuses and totals sq ft + minutes", () => {
    const st = defaultState();
    const rooms = [
      mkRoom({ id: "r1", roomType: "(untyped)", employeeId: "e1", shiftId: "sh_days" }),
      mkRoom({ id: "r2", roomType: "(untyped)", shiftId: "sh_days" }),
      mkRoom({ id: "r3", roomType: "(untyped)" })
    ];
    const ru = rollup(st, rooms);
    expect(ru.rooms).toBe(3);
    expect(ru.scheduled).toBe(1);
    expect(ru.partial).toBe(1);
    expect(ru.unscheduled).toBe(1);
    expect(ru.sqft).toBe(3000);
    expect(ru.dailyMin).toBeCloseTo(45, 5);
  });
});

describe("v1 → v2 migration", () => {
  it("maps legacy floor types onto the three finishes and keeps room data", () => {
    const v1 = {
      version: 1,
      rooms: [
        { id: "r1", floorId: "f1", department: "West", name: "PR 101", roomType: "Patient Room", floorType: "VCT", fixtures: 1, cleanableSqFt: 220, ceilingHeight: "", perimeter: "", doorAreaSqFt: 0, windowAreaSqFt: 0, tasks: ["Daily clean"], frequency: "7x", shiftId: null, employeeId: null, mapX: 1, mapY: 2, source: "magicplan" },
        { id: "r2", floorId: "f1", department: "West", name: "Office", roomType: "Office", floorType: "Carpet", fixtures: 0, cleanableSqFt: 143, ceilingHeight: "", perimeter: "", doorAreaSqFt: 0, windowAreaSqFt: 0, tasks: [], frequency: "5x", shiftId: null, employeeId: null, mapX: null, mapY: null, source: "magicplan" },
        { id: "r3", floorId: "f1", department: "East", name: "Store", roomType: "Utility / Storage", floorType: "Concrete", fixtures: 0, cleanableSqFt: 80, ceilingHeight: "", perimeter: "", doorAreaSqFt: 0, windowAreaSqFt: 0, tasks: [], frequency: "1x", shiftId: null, employeeId: null, mapX: null, mapY: null, source: "magicplan" }
      ],
      rates: { baseRates: [{ id: "x", roomType: "(any)", floorType: "(any)", minutesPer1000: 25 }], fixtureMinutes: 3, modifiers: [], productiveMinutes: 400 },
      shifts: [{ id: "sh_days", name: "Days", start: "07:00", end: "15:30" }],
      ui: { view: "map", colorBy: "department" }
    };
    const st = migrateState(v1);
    expect(st.version).toBe(2);
    expect(st.rooms[0].floorFinish).toBe("hard");
    expect(st.rooms[1].floorFinish).toBe("carpet");
    expect(st.rooms[2].floorFinish).toBe("other");
    expect(st.rooms[0].cleanableSqFt).toBe(220);
    expect(st.rates.productiveMinutes).toBe(400);         // carried over
    expect(st.rates.baseMinutesPer1000).toBeGreaterThan(0); // new model in place
    // departments extracted with colors
    const names = st.departments.map((d) => d.name);
    expect(names).toContain("West");
    expect(names).toContain("East");
    expect(new Set(st.departments.map((d) => d.color)).size).toBe(st.departments.length);
    // shifts gained colors
    expect(st.shifts[0].color).toBeTruthy();
    // math works on migrated rooms
    expect(roomDailyMinutes(st, st.rooms[0])).toBeGreaterThan(0);
  });

  it("passes v2 state through and fills anything missing", () => {
    const st = migrateState(defaultState());
    expect(st.version).toBe(2);
    expect(st.ui.mapColorBy).toBe("department");
  });
});
