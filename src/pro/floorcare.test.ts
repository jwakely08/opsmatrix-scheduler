import { describe, it, expect } from "vitest";
import { defaultRules } from "./rules";
import {
  floorCareTasks, fcEligible, fcTasksForSpace, stopMinutes, fcTiming,
  shipToSchedules, unship, type FcSchedule
} from "./floorcare";
import { EQUIPMENT, DUST_MOP_SIZES, brandsFor, modelsFor } from "./equipment";
import { scheduleMinutes, type ClassicData, type ClassicSpace } from "./classicStore";

const rules = defaultRules();

const corridor: ClassicSpace = {
  id: "c1", roomNumber: "E1-1000", roomType: "Corridor",
  floorType: "Hard floor — finished", squareFeet: 10000,
  spaceTasks: ["auto-scrub", "dust-mop"]
};
const carpetLounge: ClassicSpace = {
  id: "c2", roomNumber: "E2-100", roomType: "Lounge", floorType: "Carpet",
  squareFeet: 800, spaceTasks: []
};
const office: ClassicSpace = {
  id: "c3", roomNumber: "E2-200", roomType: "Office",
  floorType: "Hard floor — finished", squareFeet: 300, spaceTasks: []
};

describe("floor-care task identity and eligibility", () => {
  it("exactly five tasks are floor care", () => {
    expect(floorCareTasks(rules).map((t) => t.id).sort()).toEqual(
      ["auto-scrub", "burnish", "dust-mop", "machine-carpet", "machine-sweep"]);
  });
  it("corridors and carpet are eligible; a plain office is greyed out", () => {
    expect(fcEligible(rules, corridor)).toBe(true);
    expect(fcEligible(rules, carpetLounge)).toBe(true);   // machine carpet cleaning
    expect(fcEligible(rules, office)).toBe(false);
  });
  it("a carpet room offers carpet cleaning, never wet scrubbing", () => {
    const tasks = fcTasksForSpace(rules, carpetLounge);
    expect(tasks).toContain("machine-carpet");
    expect(tasks).not.toContain("auto-scrub");
    expect(tasks).not.toContain("burnish");
  });
});

describe("equipment catalog (manufacturer sheets)", () => {
  it("the four brands are present where the sheets cover them", () => {
    expect(brandsFor("machine-scrub").sort()).toEqual(["Advance", "TASKI", "Tennant"]);
    expect(brandsFor("burnish").sort()).toEqual(["Advance", "Clarke", "TASKI", "Tennant"]);
    expect(brandsFor("machine-carpet").sort()).toEqual(["Advance", "Clarke", "TASKI", "Tennant"]);
  });
  it("spot-checks against the published sheets", () => {
    const t7 = modelsFor("machine-scrub", "Tennant").find((m) => m.model === "T7")!;
    expect(t7.sqftPerHour).toBe(56320);
    const b7 = modelsFor("burnish", "Tennant").find((m) => m.model === "B7 (27 in)")!;
    expect(b7.sqftPerHour).toBe(25000);
    expect(b7.basis).toMatch(/overlap/);
    const pro30 = modelsFor("machine-carpet", "TASKI").find((m) => m.model.startsWith("procarpet 30"))!;
    expect(pro30.sqftPerHour).toBe(4359);
    expect(pro30.basis).toBe("OEM practical");
  });
  it("no sweeper sheet has been provided, so no invented sweeper rates", () => {
    expect(EQUIPMENT["machine-sweep"]).toEqual([]);
  });
  it("dust-mop widths carry editable starting rates from 18 to 72 inches", () => {
    expect(DUST_MOP_SIZES[0].widthIn).toBe(18);
    expect(DUST_MOP_SIZES.every((s) => s.sqftPerHour > 0)).toBe(true);
  });
});

describe("stop timing — equipment rate wins, Scope rate is the fallback", () => {
  it("a Tennant T7 scrubs 10,000 sq ft in ~11 minutes; the generic rate takes 50", () => {
    const withT7 = { "auto-scrub": { label: "Tennant T7", sqftPerHour: 56320 } };
    expect(stopMinutes(rules, corridor, "auto-scrub", withT7)).toBe(11);   // 10000/938.7
    expect(stopMinutes(rules, corridor, "auto-scrub", {})).toBe(50);       // 10000/200
  });
  it("equipment applies only to ITS task on this schedule", () => {
    const withT7 = { "auto-scrub": { label: "Tennant T7", sqftPerHour: 56320 } };
    expect(stopMinutes(rules, corridor, "dust-mop", withT7)).toBe(67);     // 10000/150 — unaffected
  });
  it("never zero minutes", () => {
    expect(stopMinutes(rules, { squareFeet: 10 } as never, "burnish",
      { burnish: { label: "x", sqftPerHour: 999999 } })).toBe(1);
  });
});

const fc: FcSchedule = {
  id: "fc1", name: "Night Floor Crew", shift: "3rd Shift",
  techs: [{ key: "T1", employeeId: "emp-1", name: "Robert Miller" }, { key: "T2" }],
  equipment: {
    "auto-scrub": { label: "Tennant T7", sqftPerHour: 56320, basis: "OEM max" },
    "dust-mop": { label: '36" dust mop', sqftPerHour: 20000 }
  },
  stops: [
    { spaceId: "c1", taskId: "dust-mop", techKey: "T1" },   // 10000/(20000/60)=30
    { spaceId: "c1", taskId: "auto-scrub", techKey: "T2" }, // 11
    { spaceId: "c2", taskId: "machine-carpet", techKey: "T2" } // scope 800/180 → 4
  ],
  createdAt: "2026-08-23", updatedAt: "2026-08-23"
};

describe("multi-technician timing", () => {
  it("each tech's minutes are their own stops; total is combined labor", () => {
    const t = fcTiming(rules, [corridor, carpetLounge, office], fc);
    expect(t.perTech.T1).toBe(30);
    expect(t.perTech.T2).toBe(11 + 4);
    expect(t.total).toBe(45);
    expect(t.longestTech).toBe(30);
  });
});

describe("shipping into Max Schedules", () => {
  it("creates a real schedule with rooms in click order, floor-care tasks only, no base clean", () => {
    const data: ClassicData = { v7: { spaces: [corridor, carpetLounge, office], schedules: [] }, plans: [], nonSpace: [] };
    const sched = shipToSchedules(data, rules, { ...fc, stops: [...fc.stops] });
    expect(data.v7.schedules!.length).toBe(1);
    expect(sched.spaceOrder).toEqual(["c1", "c2"]);
    expect(sched.roomTasks!["c1"]).not.toContain("general-cleaning"); // never the base clean
    expect(sched.roomTasks!["c1"]).toContain("floor-scrub");          // classic vocab bridge
    expect(sched.roomTasks!["c1"]).toContain("dust-mop");
    expect(sched.floorCareId).toBe("fc1");
    expect(sched.employee).toBe("2 floor technicians");
    // Max Schedules shows the equipment-priced total, not the generic rate
    expect(scheduleMinutes(data, rules, sched)).toBe(45);
  });
  it("re-shipping updates the same schedule; unship removes it", () => {
    const data: ClassicData = { v7: { spaces: [corridor, carpetLounge], schedules: [] }, plans: [], nonSpace: [] };
    const live = { ...fc, stops: [...fc.stops] };
    shipToSchedules(data, rules, live);
    live.name = "Night Floor Crew A";
    shipToSchedules(data, rules, live);
    expect(data.v7.schedules!.length).toBe(1);
    expect(data.v7.schedules![0].name).toBe("Night Floor Crew A");
    unship(data, live);
    expect(data.v7.schedules!.length).toBe(0);
  });
});
