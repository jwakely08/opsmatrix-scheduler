// Room List actions: delete removes the room EVERYWHERE it is referenced;
// duplicate copies the data but never the geometry or the schedule.
import { describe, it, expect } from "vitest";
import { deleteSpace, duplicateSpace, type ClassicData } from "./classicStore";

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
