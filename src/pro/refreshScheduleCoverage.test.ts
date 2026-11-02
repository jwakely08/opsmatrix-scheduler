// Schedules follow their rooms (Josh, 2026-11-02: "I made the changes in Scope… the cleaning time
// should have changed, but it didn't").
import { describe, it, expect } from "vitest";
import { coverageForSpace, coverageMinutes, refreshScheduleCoverage, setCoverage, type ClassicData } from "./classicStore";
import { defaultRules, type Rules } from "./rules";

function fixture(): ClassicData {
  return {
    v7: {
      spaces: [
        { id: "c1", roomNumber: "C-1", roomName: "Corridor", roomType: "Corridor", floorType: "Hard floor — finished", squareFeet: 1200, spaceTasks: ["auto-scrub", "dust-mop"] },
        { id: "p1", roomNumber: "101", roomName: "", roomType: "Patient Room", floorType: "Hard floor — finished", squareFeet: 240, spaceTasks: [] }
      ],
      schedules: [
        { id: "a", num: "101", name: "A", shift: "1st Shift", color: "#22c55e", targetHours: 8, spaceOrder: [], roomTasks: {} },
        { id: "b", num: "102", name: "B", shift: "1st Shift", color: "#3b82f6", targetHours: 8, spaceOrder: [], roomTasks: {} },
        { id: "fc", num: "FC", name: "Floor crew", shift: "3rd Shift", color: "#06b6d4", targetHours: 8, spaceOrder: [], roomTasks: {}, floorCareId: "fc-1" }
      ],
      employees: []
    },
    plans: [], nonSpace: []
  };
}

/** Josh's corridor recipe: à la carte with high dusting, trash pull and spot mopping */
function corridorAlaCarte(): Rules {
  const r = defaultRules();
  r.roomTypes.find((t) => t.id === "corridor")!.method = "none";
  for (const id of ["high-dusting", "trash-pull", "spot-mop"]) r.tasks.find((t) => t.id === id)!.autoFor.push("corridor");
  return r;
}

describe("refreshScheduleCoverage", () => {
  it("the schedule that owns a room picks up the tasks Scope gave it, and its minutes move", () => {
    const data = fixture();
    const before = defaultRules();
    setCoverage(data, "c1", "a", true, []); // tapped on when the corridor had only floor care
    expect(coverageMinutes(before, data.v7.spaces![0], coverageForSpace(data, "c1")[0])).toBe(13); // 1,200 at 5,500/hr
    const after = corridorAlaCarte();
    data.v7.spaces![0].spaceTasks = ["auto-scrub", "dust-mop", "high-dusting", "trash-pull", "spot-mop"]; // what refreshAutoTasks does
    expect(refreshScheduleCoverage(data, after)).toBe(1);
    const cov = coverageForSpace(data, "c1")[0];
    expect(cov.tasks.sort()).toEqual(["high-dusting", "spot-mop", "trash-pull"]);
    // high dusting 10 + trash 2 + spot mopping 4; no General Clean on an à la carte type; floor care stays out
    expect(coverageMinutes(after, data.v7.spaces![0], cov)).toBe(16);
  });

  it("drops a task the room no longer carries, keeps a helper schedule's share, lets an idle helper go", () => {
    const data = fixture();
    const rules = defaultRules();
    data.v7.spaces![1].spaceTasks = ["high-dusting"];
    setCoverage(data, "p1", "a", true, []);              // A owns the room
    setCoverage(data, "p1", "b", false, ["high-dusting"]); // B does the high dusting
    expect(refreshScheduleCoverage(data, rules)).toBe(0); // nothing to do: B covers it
    data.v7.spaces![1].spaceTasks = [];                   // the manager took high dusting off the room
    expect(refreshScheduleCoverage(data, rules)).toBe(1);
    expect(coverageForSpace(data, "p1").map((c) => c.scheduleId)).toEqual(["a"]); // B had nothing left and let the room go
    expect(data.v7.schedules![1].spaceOrder).toEqual([]);
  });

  it("never touches a Floor Care schedule, and only the rooms it is asked about", () => {
    const data = fixture();
    const rules = corridorAlaCarte();
    data.v7.spaces![0].spaceTasks = ["auto-scrub", "dust-mop", "high-dusting", "trash-pull", "spot-mop"];
    setCoverage(data, "c1", "fc", false, ["auto-scrub", "dust-mop"]); // the floor crew's own coverage
    setCoverage(data, "c1", "a", true, []);
    setCoverage(data, "p1", "a", true, []);
    data.v7.spaces![1].spaceTasks = ["high-dusting"];
    expect(refreshScheduleCoverage(data, rules, ["p1"])).toBe(1); // asked about the patient room only
    expect(coverageForSpace(data, "c1").find((c) => c.scheduleId === "a")!.tasks).toEqual([]);
    expect(coverageForSpace(data, "c1").find((c) => c.scheduleId === "fc")!.tasks.sort()).toEqual(["auto-scrub", "dust-mop"]);
    expect(refreshScheduleCoverage(data, rules)).toBe(1); // now the corridor's owner catches up
    expect(coverageForSpace(data, "c1").find((c) => c.scheduleId === "fc")!.tasks.sort()).toEqual(["auto-scrub", "dust-mop"]);
  });
});
