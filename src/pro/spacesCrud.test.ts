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

// ── rectifyForDisplay: cosmetic straightening must never eat real geometry ──
// (Josh's "crooked rooms", 2026-09-12: a hospital floor shipped at 1400px
// stores rooms 3-26px wide; the old fixed 2.5px vertex merge welded a 2.3px
// CAD wall jog into a diagonal. Tolerances are proportional now.)
import { rectifyForDisplay } from "./classicStore";

describe("rectifyForDisplay", () => {
  it("still squares up a big, slightly sloppy hand-traced room", () => {
    const sloppy = [
      { x: 0, y: 1.5 }, { x: 100, y: 0 },      // 1.5px rise over 100 → flatten
      { x: 101, y: 80 }, { x: 0.5, y: 81 }
    ];
    const out = rectifyForDisplay(sloppy);
    expect(out[0].y).toBeCloseTo(out[1].y, 5);
    expect(out[2].y).toBeCloseTo(out[3].y, 5);
  });

  it("a tiny CAD room keeps its 2px wall jog instead of going diagonal", () => {
    // an L-jog like FV1-522's: 24px wide, jog of 2.3px — every vertex real
    const cad = [
      { x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 12 },
      { x: 10, y: 12 }, { x: 10, y: 14.3 }, { x: 0, y: 14.3 }
    ];
    const out = rectifyForDisplay(cad);
    expect(out.length).toBe(6); // nothing merged away
    // and every edge is still axis-aligned — no welded diagonals
    for (let i = 0; i < out.length; i++) {
      const a = out[i], b = out[(i + 1) % out.length];
      expect(Math.min(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBeLessThan(1e-6);
    }
  });

  it("never flattens a jog a quarter of the room deep", () => {
    // 100px room with a 24px-deep notch at slope < 0.22 would have been
    // flattened by the old ratio-only rule if drawn long enough
    const notch = [
      { x: 0, y: 0 }, { x: 120, y: 26 },        // ratio 0.216 but 26px deep
      { x: 120, y: 100 }, { x: 0, y: 100 }
    ];
    const out = rectifyForDisplay(notch);
    expect(Math.abs(out[1].y - out[0].y)).toBeGreaterThan(20); // survived
  });
});
