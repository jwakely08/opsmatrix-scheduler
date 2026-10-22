import { describe, expect, it } from "vitest";
import { mergeRooms, type MergeStores } from "./mergeRooms";
import { defaultRules, computeMinutes } from "./rules";
import { drawRoomsPicture } from "../bridge/aiPlanImport";
import type { ClassicSpace } from "./classicStore";
import type { StudioSet } from "./studioSets";

type P = { x: number; y: number };
const rect = (x0: number, y0: number, x1: number, y1: number): P[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const rules = defaultRules();
const NOW = "2026-10-22T12:00:00.000Z";

// a floor drawn at 5 px per foot: 101 (10×10 ft) and 101A (6×10 ft) a 6-inch wall apart,
// 102 across a 20 ft corridor, and 201 on another floor
function world(): MergeStores {
  const room = (id: string, num: string, name: string, pts: P[], extra: Partial<ClassicSpace> = {}): ClassicSpace => ({
    id, roomNumber: num, roomName: name, building: "Fairview", floor: "4", department: "4 East",
    roomType: "Patient Room", floorType: "Hard floor — finished", squareFeet: 0, fixtureCount: 0,
    spaceTasks: [], visualPlanId: "p4", visualW: 1000, visualH: 600, visualPts: pts, ...extra
  });
  const spaces = [
    room("a", "101", "PATIENT", rect(100, 100, 150, 150), { squareFeet: 100, fixtureCount: 1, spaceTasks: ["high-dusting"], assignedScheduleId: "s1", notes: "keys at desk" }),
    room("b", "101A", "TOILET", rect(152.5, 100, 182.5, 150), { squareFeet: 60, fixtureCount: 2, roomType: "Restroom", spaceTasks: ["trash-pull", "burnish"], assignedScheduleId: "s2", department: "" }),
    room("c", "102", "OFFICE", rect(100, 250, 150, 300), { squareFeet: 100 }),
    room("d", "201", "OFFICE", rect(100, 100, 150, 150), { floor: "2", visualPlanId: "p2", squareFeet: 100 })
  ];
  return {
    data: {
      v7: {
        spaces,
        schedules: [
          { id: "s1", num: "101", spaceOrder: ["c", "a"], roomTasks: { a: ["general-cleaning", "wet-mop", "high-dusting"], c: ["general-cleaning", "wet-mop"] } },
          { id: "s2", num: "102", spaceOrder: ["b"], roomTasks: { b: ["general-cleaning", "wet-mop", "trash-pull", "high-dusting"] } },
          { id: "s3", num: "103", spaceOrder: ["b", "c"], roomTasks: { b: ["high-dusting"], c: ["high-dusting"] }, routeOnly: true, routeStopMinutes: { b: 3, c: 4 } }
        ],
        inspections: [{ id: "i1", spaceId: "b", roomNum: "101A", roomName: "TOILET", dept: "" }, { id: "i2", spaceId: "c", roomNum: "102" }],
        notes: [{ id: "n1", linkedSpaceId: "b" }, { id: "n2", linkedSpaceId: "c" }]
      },
      plans: [
        {
          id: "p4", building: "Fairview", floor: "4", w: 1000, h: 600, ratio: 5, source: "ai-plan-read",
          img: drawRoomsPicture([rect(100, 100, 150, 150), rect(152.5, 100, 182.5, 150), rect(100, 250, 150, 300)], 1000, 600, 5),
          rooms: [{ spaceId: "a", pts: rect(100, 100, 150, 150) }, { spaceId: "b", pts: rect(152.5, 100, 182.5, 150) }, { spaceId: "c", pts: rect(100, 250, 150, 300) }]
        },
        { id: "p2", building: "Fairview", floor: "2", w: 1000, h: 600, img: "data:image/png;base64,xx", rooms: [{ spaceId: "d", pts: rect(100, 100, 150, 150) }] }
      ],
      nonSpace: [{ id: "t1", name: "Discharges", hours: 1, scheduleId: "s1", roomIds: ["b", "a", "c"] }]
    },
    routes: {
      sanitation: [{ id: "r1", name: "Soiled", shift: "1st", building: "Fairview", planId: "p4", dock: null, seq: ["b", "DOCK", "a", "DOCK", "c"], createdAt: NOW, updatedAt: NOW }],
      policing: [{ id: "r2", name: "Porter", shift: "1st", building: "Fairview", planId: "p4", stops: [{ spaceId: "a", taskId: "trash-pull" }, { spaceId: "b", taskId: "trash-pull" }, { spaceId: "c", taskId: "trash-pull" }], createdAt: NOW, updatedAt: NOW }]
    },
    floorCare: {
      schedules: [{ id: "f1", name: "Scrub", shift: "3rd", techs: [], equipment: {}, stops: [{ spaceId: "a", taskId: "auto-scrub", techKey: "T1" }, { spaceId: "b", taskId: "auto-scrub", techKey: "T2" }, { spaceId: "b", taskId: "burnish", techKey: "T2" }], createdAt: NOW, updatedAt: NOW }],
      projects: [{ id: "pr1", task: "Scrub", date: "2026-10-30", hours: 2, teamMembers: 1, manHours: 2, spaceId: "b", location: "101A TOILET", createdAt: NOW }]
    },
    sets: [{
      id: "set4", account: "Cleveland Clinic", building: "Fairview", floor: "4", planId: "p4", readMode: true,
      picture: { dataUrl: "data:,", width: 2000, height: 1200, aspect: 2000 / 1200 },
      shapes: [
        { id: "sa", pts: rect(200, 200, 300, 300), roomNumber: "101", roomName: "PATIENT", roomType: "Patient Room", floorType: "", fixtureCount: 1, department: "4 East", knownSqFt: 100, source: "traced" },
        { id: "sb", pts: rect(305, 200, 365, 300), roomNumber: "101A", roomName: "TOILET", roomType: "Restroom", floorType: "", fixtureCount: 2, department: "", knownSqFt: 60, source: "traced" },
        { id: "sc", pts: rect(200, 500, 300, 600), roomNumber: "102", roomName: "OFFICE", roomType: "Office", floorType: "", fixtureCount: 0, department: "", knownSqFt: 100, source: "traced" }
      ],
      spaceIdByShape: { sa: "a", sb: "b", sc: "c" },
      createdAt: NOW, updatedAt: NOW
    } as StudioSet]
  };
}

describe("mergeRooms — two rooms become one, in all the data", () => {
  it("the first room stays and takes on the second room's floor, fixtures and tasks", () => {
    const w = world();
    const res = mergeRooms(w, "a", ["b"], rules, NOW);
    expect(res.ok).toBe(true);
    const spaces = w.data.v7.spaces!;
    expect(spaces.map((s) => s.id)).toEqual(["a", "c", "d"]);
    const a = spaces[0];
    expect(a).toMatchObject({ roomNumber: "101", roomName: "PATIENT", roomType: "Patient Room", department: "4 East", squareFeet: 160, fixtureCount: 3 });
    // trash pull is in a patient room's General Clean — never an extra
    expect(a.spaceTasks).toEqual(["high-dusting", "burnish"]);
    expect(a.notes).toBe("keys at desk");
    expect(a.estimatedCleaningMinutes).toBe(computeMinutes(rules, a).total);
    // one outline: both rooms and the wall between them
    expect(a.visualPts).toEqual([{ x: 100, y: 100 }, { x: 182.5, y: 100 }, { x: 182.5, y: 150 }, { x: 100, y: 150 }]);
  });

  it("schedules: one stop where the rooms were, one schedule with the base clean, extras kept", () => {
    const w = world();
    mergeRooms(w, "a", ["b"], rules, NOW);
    const [s1, s2, s3] = w.data.v7.schedules!;
    expect(s1.spaceOrder).toEqual(["c", "a"]);
    expect(s1.roomTasks!.a).toEqual(["general-cleaning", "wet-mop", "high-dusting"]);
    // 101A's schedule keeps its high dusting in the merged room, but not a second base clean
    // (and not the trash pull a patient room's General Clean already does)
    expect(s2.spaceOrder).toEqual(["a"]);
    expect(s2.roomTasks).toEqual({ a: ["high-dusting"] });
    expect(w.data.v7.spaces![0].assignedScheduleId).toBe("s1");
    // a route's stop minutes follow the room
    expect(s3.spaceOrder).toEqual(["a", "c"]);
    expect(s3.routeStopMinutes).toEqual({ c: 4, a: 3 });
  });

  it("inspections, notes and non-space tasks point at the merged room", () => {
    const w = world();
    mergeRooms(w, "a", ["b"], rules, NOW);
    expect(w.data.v7.inspections).toEqual([
      { id: "i1", spaceId: "a", roomNum: "101", roomName: "PATIENT", dept: "4 East" },
      { id: "i2", spaceId: "c", roomNum: "102" }
    ]);
    expect(w.data.v7.notes).toEqual([{ id: "n1", linkedSpaceId: "a" }, { id: "n2", linkedSpaceId: "c" }]);
    expect(w.data.nonSpace[0].roomIds).toEqual(["a", "c"]);
  });

  it("the floor map: one outline for the room, and a picture without the wall between", () => {
    const w = world();
    const before = String(w.data.plans[0].img);
    const res = mergeRooms(w, "a", ["b"], rules, NOW);
    expect(res.ok && res.plansChanged).toBe(true);
    const p4 = w.data.plans[0];
    expect(p4.rooms).toEqual([
      { spaceId: "a", pts: [{ x: 100, y: 100 }, { x: 182.5, y: 100 }, { x: 182.5, y: 150 }, { x: 100, y: 150 }] },
      { spaceId: "c", pts: rect(100, 250, 150, 300) }
    ]);
    expect(p4.img).toBe(drawRoomsPicture(p4.rooms!.map((r) => r.pts), 1000, 600, 5));
    expect(p4.img).not.toBe(before);
    // other floors are left alone
    expect(w.data.plans[1].img).toBe("data:image/png;base64,xx");
  });

  it("routes and Floor Care: the merged room is visited once per task", () => {
    const w = world();
    const res = mergeRooms(w, "a", ["b"], rules, NOW);
    expect(res.ok && res.routesChanged && res.floorCareChanged).toBe(true);
    expect(w.routes.sanitation[0].seq).toEqual(["a", "DOCK", "c"]);
    expect(w.routes.policing[0].stops).toEqual([{ spaceId: "a", taskId: "trash-pull" }, { spaceId: "c", taskId: "trash-pull" }]);
    expect(w.floorCare.schedules[0].stops).toEqual([
      { spaceId: "a", taskId: "auto-scrub", techKey: "T1" },
      { spaceId: "a", taskId: "burnish", techKey: "T2" }
    ]);
    expect(w.floorCare.projects[0]).toMatchObject({ spaceId: "a", location: "101 PATIENT" });
  });

  it("the Calibration Editor's drawing: one shape, so re-shipping lands on the merged room", () => {
    const w = world();
    const res = mergeRooms(w, "a", ["b"], rules, NOW);
    expect(res.ok && res.setsChanged.map((s) => s.id)).toEqual(["set4"]);
    const set = w.sets[0];
    expect(set.shapes.map((s) => s.id)).toEqual(["sa", "sc"]);
    expect(set.spaceIdByShape).toEqual({ sa: "a", sc: "c" });
    expect(set.shapes[0]).toMatchObject({ roomNumber: "101", knownSqFt: 160, fixtureCount: 3 });
    expect(set.shapes[0].pts).toEqual([{ x: 200, y: 200 }, { x: 365, y: 200 }, { x: 365, y: 300 }, { x: 200, y: 300 }]);
  });

  it("rooms that aren't right next to each other don't merge, and nothing changes", () => {
    const w = world();
    const snapshot = JSON.stringify(w);
    const res = mergeRooms(w, "a", ["c"], rules, NOW);
    expect(res).toEqual({ ok: false, reason: "101 and 102 aren't right next to each other — only rooms that share a wall can merge." });
    const other = mergeRooms(w, "a", ["d"], rules, NOW);
    expect(other.ok).toBe(false);
    expect(!other.ok && other.reason).toMatch(/different floors/);
    expect(JSON.stringify(w)).toBe(snapshot);
  });

  it("the second room's schedule becomes the merged room's when the first had none", () => {
    const w = world();
    const a = w.data.v7.spaces![0];
    a.assignedScheduleId = "";
    w.data.v7.schedules![0].spaceOrder = ["c"];
    delete w.data.v7.schedules![0].roomTasks!.a;
    mergeRooms(w, "a", ["b"], rules, NOW);
    const s2 = w.data.v7.schedules![1];
    expect(s2.spaceOrder).toEqual(["a"]);
    expect(s2.roomTasks!.a).toEqual(["general-cleaning", "wet-mop", "high-dusting"]);
    expect(w.data.v7.spaces![0].assignedScheduleId).toBe("s2");
  });
});
