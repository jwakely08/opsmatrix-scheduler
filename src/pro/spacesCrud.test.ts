// Room List actions: delete removes the room EVERYWHERE it is referenced;
// duplicate copies the data but never the geometry or the schedule.
import { describe, it, expect } from "vitest";
import {
  deleteSpace, duplicateSpace, deleteBuilding, buildingFootprint, type ClassicData
} from "./classicStore";

function fixture(): ClassicData {
  return {
    v7: {
      spaces: [
        {
          id: "sp1", roomNumber: "101", roomName: "Med Room", building: "A", floor: "1",
          squareFeet: 200, fixtureCount: 2, assignedScheduleId: "s1",
          visualPts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], visualPlanId: "plan1",
          spaceTasks: ["trash-pull"], source: { row: 4 }
        },
        { id: "sp2", roomNumber: "102", squareFeet: 100 }
      ],
      schedules: [
        { id: "s1", num: "101", name: "East", spaceOrder: ["sp1", "sp2"], roomTasks: { sp1: ["general-cleaning"], sp2: [] } }
      ]
    },
    plans: [],
    nonSpace: [{ id: "n1", name: "Route", hours: 2, scheduleId: "s1", roomIds: ["sp1", "sp2"] }]
  };
}

describe("deleteSpace", () => {
  it("removes the room from spaces, schedule order, task maps and routes", () => {
    const d = fixture();
    deleteSpace(d, "sp1");
    expect((d.v7.spaces ?? []).map((s) => s.id)).toEqual(["sp2"]);
    expect(d.v7.schedules![0].spaceOrder).toEqual(["sp2"]);
    expect(d.v7.schedules![0].roomTasks).not.toHaveProperty("sp1");
    expect(d.nonSpace[0].roomIds).toEqual(["sp2"]);
  });
});

describe("duplicateSpace", () => {
  it("copies data, marks the number, drops geometry and scheduling", () => {
    const d = fixture();
    const copy = duplicateSpace(d, "sp1")!;
    expect(copy.roomNumber).toBe("101-copy");
    expect(copy.roomName).toBe("Med Room");
    expect(copy.squareFeet).toBe(200);
    expect(copy.fixtureCount).toBe(2);
    expect(copy.spaceTasks).toEqual(["trash-pull"]);
    expect(copy.visualPts).toBeUndefined();
    expect(copy.visualPlanId).toBeUndefined();
    expect(copy.assignedScheduleId).toBe("");
    expect(copy.source).toBeUndefined();
    expect(copy.id).not.toBe("sp1");
    expect((d.v7.spaces ?? []).length).toBe(3);
  });

  it("returns null for a room that does not exist", () => {
    const d = fixture();
    expect(duplicateSpace(d, "ghost")).toBeNull();
    expect((d.v7.spaces ?? []).length).toBe(2);
  });
});

// the ✕ on Explorer's building tiles: everything the building owns goes,
// and nothing else even flinches
function twoBuildingFixture(): ClassicData {
  return {
    v7: {
      spaces: [
        // filed under A by name
        { id: "a1", roomNumber: "101", building: "A", squareFeet: 100 },
        // NOT filed under A, but drawn on A's plan — still A's room
        { id: "a2", roomNumber: "102", building: "", visualPlanId: "planA", squareFeet: 50 },
        { id: "b1", roomNumber: "201", building: "B", visualPlanId: "planB", squareFeet: 80 }
      ],
      schedules: [
        {
          id: "s1", name: "Mixed", spaceOrder: ["a1", "a2", "b1"],
          roomTasks: { a1: ["general-cleaning"], b1: [] },
          routeStopMinutes: { a2: 3, b1: 4 }
        }
      ],
      settings: { buildingArt: { A: "preset:1", B: "preset:2" } }
    },
    plans: [
      { id: "planA", building: "A" },
      { id: "planB", building: "B" }
    ] as ClassicData["plans"],
    nonSpace: [{ id: "n1", name: "Discharges", hours: 2, scheduleId: "s1", roomIds: ["a1", "b1"] }]
  };
}

describe("buildingFootprint", () => {
  it("counts the plans and rooms the delete prompt warns about", () => {
    expect(buildingFootprint(twoBuildingFixture(), "A")).toEqual({ plans: 1, rooms: 2 });
    expect(buildingFootprint(twoBuildingFixture(), "B")).toEqual({ plans: 1, rooms: 1 });
  });
});

describe("deleteBuilding", () => {
  it("removes the building's plans and rooms — by name AND by plan", () => {
    const d = twoBuildingFixture();
    deleteBuilding(d, "A");
    expect((d.v7.spaces ?? []).map((s) => s.id)).toEqual(["b1"]);
    expect(d.plans.map((p) => p.id)).toEqual(["planB"]);
  });

  it("scrubs every schedule and task reference", () => {
    const d = twoBuildingFixture();
    deleteBuilding(d, "A");
    const s = d.v7.schedules![0];
    expect(s.spaceOrder).toEqual(["b1"]);
    expect(s.roomTasks).not.toHaveProperty("a1");
    expect(s.roomTasks).toHaveProperty("b1");
    expect(s.routeStopMinutes).toEqual({ b1: 4 });
    expect(d.nonSpace[0].roomIds).toEqual(["b1"]);
  });

  it("drops the building's saved picture, keeps the neighbour's", () => {
    const d = twoBuildingFixture();
    deleteBuilding(d, "A");
    const art = (d.v7.settings as { buildingArt?: Record<string, string> }).buildingArt!;
    expect(art).not.toHaveProperty("A");
    expect(art.B).toBe("preset:2");
  });

  it("the other building is untouched end to end", () => {
    const d = twoBuildingFixture();
    deleteBuilding(d, "A");
    expect(buildingFootprint(d, "B")).toEqual({ plans: 1, rooms: 1 });
  });
});
