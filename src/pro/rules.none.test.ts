// A room type with NO General Clean (Josh, 2026-11-02: "you're not going to clean a corridor space like
// you would a nurse's station or a patient room… the standard for a corridor for a regular EVS cleaner
// should just be high dusting and trash pull and spot mopping").
import { describe, it, expect } from "vitest";
import {
  computeMinutes, defaultRules, gcFormula, gcFormulaText, gcMinutes, gcMinutesFor, gcText, hasGeneralClean,
  includedTasksFor, includedTasksForRoom, requiredTasks, type Rules
} from "./rules";
import { buildScheduleDoc } from "./scheduleDoc";
import { setCoverage, type ClassicData } from "./classicStore";

/** the default rulebook with corridors timed by their tasks alone, plus a spot-mopping task */
function corridorRules(): Rules {
  const r = defaultRules();
  const corridor = r.roomTypes.find((t) => t.id === "corridor")!;
  corridor.method = "none";
  corridor.includedTasks = [];
  r.tasks.push({ id: "spot-mop", label: "Spot Mopping", sqftPerMin: 300, flatMin: 0, autoFor: ["corridor"], addable: true });
  r.tasks.find((t) => t.id === "high-dusting")!.autoFor.push("corridor");
  r.tasks.find((t) => t.id === "trash-pull")!.autoFor.push("corridor");
  r.breaks = [];
  return r;
}
const corridor = { id: "c1", roomNumber: "C-1", roomName: "Corridor", roomType: "Corridor", floorType: "Hard floor — finished", squareFeet: 1200 };

describe("a room type with no General Clean", () => {
  it("prices a corridor by its tasks alone", () => {
    const rules = corridorRules();
    // high dusting 1,200/120 = 10, trash pull 2 flat, spot mopping 1,200/300 = 4 → 16; no General Clean line
    const m = computeMinutes(rules, { ...corridor, spaceTasks: ["high-dusting", "trash-pull", "spot-mop"] });
    expect(m.total).toBe(16);
    expect(m.lines.map((l) => l.label.split(" — ")[0])).toEqual(["High Dusting", "Trash Pull", "Spot Mopping"]);
    // with no tasks it is simply zero — nothing is cleaned, nothing is timed
    expect(computeMinutes(rules, { ...corridor, spaceTasks: [] }).total).toBe(0);
  });

  it("'includes' nothing, so Trash Pull is a real extra again", () => {
    const rules = corridorRules();
    expect(includedTasksFor(rules, "corridor")).toEqual([]);
    expect(includedTasksFor(rules, "patient-room")).toEqual(["trash-pull", "damp-mop", "vacuum"]);
    // the automatic list for a corridor carries its three tasks (plus the floor crew's, as before)
    expect(requiredTasks(rules, corridor)).toEqual(expect.arrayContaining(["high-dusting", "trash-pull", "spot-mop", "auto-scrub", "dust-mop"]));
  });

  it("says so in words, and hasGeneralClean knows", () => {
    const rules = corridorRules();
    const f = gcFormula(rules, rules.roomTypes.find((t) => t.id === "corridor")!);
    expect(f.method).toBe("none");
    expect(gcMinutes(f, 1200)).toBe(0);
    expect(gcText("Corridor", f, 1200)).toBe("Corridor: no General Clean — its tasks make up the time");
    expect(gcFormulaText(f)).toBe("no General Clean — tasks only");
    expect(hasGeneralClean(rules, corridor)).toBe(false);
    expect(hasGeneralClean(rules, { roomType: "Patient Room" })).toBe(true);
    expect(hasGeneralClean(rules, { roomType: "Something Unknown" })).toBe(true);
  });

  it("prints the corridor's tasks on the schedule, never 'General Clean'", () => {
    const rules = corridorRules();
    const data: ClassicData = {
      v7: {
        spaces: [{ ...corridor, spaceTasks: ["high-dusting", "trash-pull", "spot-mop"] }],
        schedules: [{ id: "s", num: "101", name: "East", shift: "1st Shift", color: "#22c55e", targetHours: 8, spaceOrder: [], roomTasks: {} }],
        employees: [], shifts: [{ id: "sh1", name: "1st Shift", start: "7:00 AM", end: "3:00 PM", active: true }]
      },
      plans: [], nonSpace: []
    };
    // a tap gives the schedule the room's base clean (there is none) and its cleaning tasks
    setCoverage(data, "c1", "s", true, ["high-dusting", "trash-pull", "spot-mop"]);
    const doc = buildScheduleDoc(data, rules, data.v7.schedules![0], { date: new Date(2026, 10, 2) });
    expect(doc.rows[0].tasks).toEqual(["High Dusting", "Trash Pull", "Spot Mopping"]);
    expect(doc.rows[0].generalClean).toBeUndefined();
    expect(doc.rows[0].minutes).toBe(16);
  });
});

describe("a General Clean timed by its tasks (Josh: 'General Clean is a category that includes all those tasks')", () => {
  function bundleRules(): Rules {
    const r = defaultRules();
    const corridor = r.roomTypes.find((t) => t.id === "corridor")!;
    corridor.method = "tasks";
    corridor.includedTasks = ["high-dusting", "trash-pull", "spot-mop"];
    r.tasks.push({ id: "spot-mop", label: "Spot Mopping", sqftPerMin: 300, flatMin: 0, autoFor: [], addable: true });
    r.breaks = [];
    return r;
  }

  it("adds up the included tasks at their own rates, worked out step by step", () => {
    const rules = bundleRules();
    const m = computeMinutes(rules, { ...corridor, spaceTasks: [] });
    // high dusting 1,200/120 = 10 + trash pull 2 + spot mopping 1,200/300 = 4 → 16
    expect(m.total).toBe(16);
    expect(m.lines).toHaveLength(1);
    expect(m.lines[0].label).toBe("General Clean — Corridor: High Dusting 10 + Trash Pull 2 + Spot Mopping 4 = 16 min");
    expect(hasGeneralClean(rules, corridor)).toBe(true);
    const f = gcFormula(rules, rules.roomTypes.find((t) => t.id === "corridor")!);
    expect(gcFormulaText(f)).toBe("the sum of its General Clean tasks");
    expect(gcMinutesFor(rules, rules.roomTypes.find((t) => t.id === "corridor")!, 1200)).toBe(16);
  });

  it("a floor-tied step only counts where the floor calls for it", () => {
    const rules = bundleRules();
    const patient = rules.roomTypes.find((t) => t.id === "patient-room")!;
    patient.method = "tasks"; // trash pull, mopping, vacuuming — the default list
    const hard = { roomType: "Patient Room", floorType: "Hard floor — finished", squareFeet: 240 };
    const carpet = { roomType: "Patient Room", floorType: "Carpet", squareFeet: 240 };
    expect(includedTasksForRoom(rules, hard).map((t) => t.id)).toEqual(["trash-pull", "damp-mop"]);
    expect(includedTasksForRoom(rules, carpet).map((t) => t.id)).toEqual(["trash-pull", "vacuum"]);
    // 2 + 240/68.67 = 5.5 → 5 on hard floor; 2 + 240/47.62 = 7.0 → 7 on carpet
    expect(computeMinutes(rules, hard).total).toBe(5);
    expect(computeMinutes(rules, carpet).total).toBe(7);
  });

  it("prints General Clean with its steps listed under it", () => {
    const rules = bundleRules();
    const data: ClassicData = {
      v7: {
        spaces: [
          { ...corridor, spaceTasks: [] },
          { id: "p1", roomNumber: "101", roomName: "", roomType: "Patient Room", floorType: "Hard floor — finished", squareFeet: 240, spaceTasks: ["high-dusting"] }
        ],
        schedules: [{ id: "s", num: "101", name: "East", shift: "1st Shift", color: "#22c55e", targetHours: 8, spaceOrder: [], roomTasks: {} }],
        employees: [], shifts: [{ id: "sh1", name: "1st Shift", start: "7:00 AM", end: "3:00 PM", active: true }]
      },
      plans: [], nonSpace: []
    };
    setCoverage(data, "c1", "s", true, []);
    setCoverage(data, "p1", "s", true, ["high-dusting"]);
    const doc = buildScheduleDoc(data, rules, data.v7.schedules![0], { date: new Date(2026, 10, 2) });
    expect(doc.rows[0].tasks).toEqual(["General Clean"]);
    expect(doc.rows[0].generalCleanTasks).toEqual(["High Dusting", "Trash Pull", "Spot Mopping"]);
    expect(doc.rows[0].generalClean).toBe("Corridor: High Dusting 10 + Trash Pull 2 + Spot Mopping 4 = 16 min");
    // a size-timed type lists the steps its General Clean stands for too — the ones this floor needs
    expect(doc.rows[1].tasks).toEqual(["General Clean", "High Dusting"]);
    expect(doc.rows[1].generalCleanTasks).toEqual(["Trash Pull", "Mopping"]);
  });
});
