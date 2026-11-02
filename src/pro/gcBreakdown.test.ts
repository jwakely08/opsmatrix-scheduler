// The General Clean divided up (Josh, 2026-11-02: "an algorithm with general clean times, using the tasks
// as qualifiers… divvy it out and come up with a baseline at the bottom, so when you add all these tasks
// together it comes out the same… I want to be able to take things away and put them back").
import { describe, it, expect } from "vitest";
import { computeMinutes, defaultRules, gcBreakdown, generalCleanLine } from "./rules";
import { buildScheduleDoc } from "./scheduleDoc";
import { setCoverage, type ClassicData } from "./classicStore";

const rules = defaultRules();
const patient = { roomType: "Patient Room", floorType: "Hard floor — finished", squareFeet: 240, spaceTasks: [] as string[] };

describe("gcBreakdown", () => {
  it("the ISSA time is the whole; each step takes its share; the rest is the baseline; all on = ISSA", () => {
    const b = gcBreakdown(rules, patient);
    // 240 sq ft at 2,150 sq ft/hr = 6.70; trash pull 2 + mopping 240/68.67 = 3.49 → baseline 1.20
    expect(b.full).toBeCloseTo(6.70, 2);
    expect(b.steps.map((s) => [s.id, Math.round(s.minutes * 100) / 100, s.on])).toEqual([["trash-pull", 2, true], ["damp-mop", 3.49, true]]);
    expect(b.baseline).toBeCloseTo(1.20, 2);
    expect(b.minutes).toBeCloseTo(6.70, 2);
    expect(b.scaled).toBe(false);
    expect(computeMinutes(rules, patient).total).toBe(7);
  });

  it("a step switched off in a room takes exactly its share off", () => {
    const noMop = { ...patient, stepsOff: ["damp-mop"] };
    const b = gcBreakdown(rules, noMop);
    expect(b.steps.find((s) => s.id === "damp-mop")!.on).toBe(false);
    expect(b.minutes).toBeCloseTo(6.70 - 3.50, 2);
    expect(computeMinutes(rules, noMop).total).toBe(3);
    expect(generalCleanLine(rules, noMop).text).toBe("Patient Room: 240 sq ft ÷ 2,150 sq ft/hr = 6.7 min − Mopping 3.5 = 3.2 min");
    // and the lines say so: the baseline, then the steps the room does
    expect(computeMinutes(rules, noMop).lines.map((l) => l.label.split(" — ")[0])).toEqual(["General Clean baseline", "Trash Pull"]);
  });

  it("when the steps' own rates add to more than the whole, they are scaled to fit — the whole still holds", () => {
    const office = { roomType: "Office", floorType: "Hard floor — finished", squareFeet: 130 };
    const b = gcBreakdown(rules, office);
    // 130 sq ft at 4,250/hr = 1.84; trash 2 + mopping 1.9 = 3.9 > 1.84 → scaled, no baseline
    expect(b.full).toBeCloseTo(1.84, 2);
    expect(b.scaled).toBe(true);
    expect(b.baseline).toBe(0);
    expect(b.minutes).toBeCloseTo(1.84, 2);
    expect(computeMinutes(rules, office).total).toBe(2);
    // switching mopping off takes its (scaled) share
    expect(gcBreakdown(rules, { ...office, stepsOff: ["damp-mop"] }).minutes).toBeCloseTo(1.84 * 2 / 3.9, 1);
  });

  it("a type timed by its tasks has no baseline — the steps are the whole", () => {
    const r = defaultRules();
    r.roomTypes.find((t) => t.id === "corridor")!.method = "tasks";
    r.general.includedTasks = ["high-dusting", "trash-pull", "spot-mop"];
    const b = gcBreakdown(r, { roomType: "Corridor", floorType: "Hard floor — finished", squareFeet: 1200 });
    expect(b.baseline).toBe(0);
    expect(b.full).toBe(16);
    expect(b.minutes).toBe(16);
  });

  it("an à la carte type has no General Clean at all", () => {
    const r = defaultRules();
    r.roomTypes.find((t) => t.id === "corridor")!.method = "none";
    expect(gcBreakdown(r, { roomType: "Corridor", squareFeet: 1200 })).toMatchObject({ full: 0, baseline: 0, steps: [], minutes: 0 });
  });

  it("on the printed sheet a step switched off is not listed, and the room's minutes drop by it", () => {
    const data: ClassicData = {
      v7: {
        spaces: [
          { id: "a", roomNumber: "101", roomName: "", ...patient },
          { id: "b", roomNumber: "102", roomName: "", ...patient, stepsOff: ["damp-mop"] }
        ],
        schedules: [{ id: "s", num: "101", name: "East", shift: "1st Shift", color: "#22c55e", targetHours: 8, spaceOrder: [], roomTasks: {} }],
        employees: [], shifts: [{ id: "sh1", name: "1st Shift", start: "7:00 AM", end: "3:00 PM", active: true }]
      },
      plans: [], nonSpace: []
    };
    setCoverage(data, "a", "s", true, []);
    setCoverage(data, "b", "s", true, []);
    const doc = buildScheduleDoc(data, { ...rules, breaks: [] }, data.v7.schedules![0], { date: new Date(2026, 10, 2) });
    expect(doc.rows[0]).toMatchObject({ tasks: ["Trash Pull", "Mopping"], minutes: 7 });
    expect(doc.rows[1]).toMatchObject({ tasks: ["Trash Pull"], minutes: 3 });
  });
});
