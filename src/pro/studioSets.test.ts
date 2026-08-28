// Calibration sets: shipping files rooms into the full hierarchy
// (account → building → floor → department → room), attaches to rooms that
// already exist, and RE-shipping an edited set updates the SAME rooms — the
// promise that keeps schedules alive through a remodel.
import { describe, it, expect, beforeEach } from "vitest";
import {
  applyStudioShip, applyStudioUpdate, loadStudioSets, saveStudioSet, deleteStudioSet,
  type StudioShapeData, type StudioSet
} from "./studioSets";
import { buildPlanFromRooms } from "../bridge/aiPlanImport";
import { defaultRules } from "./rules";
import type { ClassicData } from "./classicStore";

const rules = defaultRules();
const W = 1000, H = 600;

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); }
  };
});

const rect = (x: number, y: number, w: number, h: number) => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }
];

function shapesFixture(): StudioShapeData[] {
  return [
    {
      id: "shA", pts: rect(100, 100, 300, 200), roomNumber: "101", roomName: "Exam A",
      roomType: "Exam Room", floorType: "Carpet", fixtureCount: 2,
      department: "Oncology", knownSqFt: 600, source: "traced"
    },
    {
      id: "shB", pts: rect(400, 100, 200, 200), roomNumber: "102", roomName: "Exam B",
      roomType: "Exam Room", floorType: "Hard floor — finished", fixtureCount: 1,
      department: "Oncology", knownSqFt: null, source: "ai"
    }
  ];
}

function buildResult(shapes: StudioShapeData[]) {
  return buildPlanFromRooms({
    buildingName: "", floorName: "",
    rooms: shapes.map((s) => ({
      name: s.roomName || s.roomNumber, roomNumber: s.roomNumber,
      squareFeet: s.knownSqFt ?? 400, roomType: s.roomType,
      polygon: s.pts.map((p) => [p.x / W, p.y / H])
    }))
  }, { building: "Crawfordsville", floor: "2nd Floor", aspect: W / H });
}

const emptyData = (): ClassicData => ({ v7: { spaces: [] }, plans: [], nonSpace: [] });

describe("applyStudioShip", () => {
  it("files every room into the full hierarchy with its details", () => {
    const data = emptyData();
    const shapes = shapesFixture();
    const map = applyStudioShip(data, buildResult(shapes), shapes, "Summa Health", rules);
    expect(Object.keys(map).sort()).toEqual(["shA", "shB"]);
    const a = data.v7.spaces!.find((s) => s.roomNumber === "101")!;
    expect(a.system).toBe("Summa Health");
    expect(a.building).toBe("Crawfordsville");
    expect(a.floor).toBe("2nd Floor");
    expect(a.department).toBe("Oncology");
    expect(a.roomType).toBe("Exam Room");
    expect(a.floorType).toBe("Carpet");
    expect(a.fixtureCount).toBe(2);
    expect(Number(a.squareFeet)).toBe(600);
    expect(Number(a.estimatedCleaningMinutes)).toBeGreaterThan(0); // Scope-priced
    expect(data.plans.length).toBe(1);
    expect((data.plans[0].rooms ?? []).map((r) => r.spaceId).sort())
      .toEqual(Object.values(map).sort());
  });

  it("attaches to a room that already exists instead of duplicating it", () => {
    const data = emptyData();
    data.v7.spaces!.push({
      id: "sp-existing", roomNumber: "101", roomName: "Exam A (from the CAD list)",
      building: "Crawfordsville", floor: "2nd Floor", notes: "keys at desk"
    });
    const shapes = shapesFixture();
    const map = applyStudioShip(data, buildResult(shapes), shapes, "Summa Health", rules);
    expect(map.shA).toBe("sp-existing");                 // same room, now drawn
    expect(data.v7.spaces!.length).toBe(2);              // 1 attached + 1 new, no dupe
    const attached = data.v7.spaces!.find((s) => s.id === "sp-existing")!;
    expect((attached.visualPts ?? []).length).toBeGreaterThan(2);
    expect(attached.notes).toBe("keys at desk");         // its data survived
  });
});

describe("applyStudioUpdate (the remodel)", () => {
  function shipped() {
    const data = emptyData();
    const shapes = shapesFixture();
    const result = buildResult(shapes);
    const map = applyStudioShip(data, result, shapes, "Summa Health", rules);
    const set: StudioSet = {
      id: "set-1", account: "Summa Health", building: "Crawfordsville", floor: "2nd Floor",
      picture: { dataUrl: "data:image/png;base64,x", width: W, height: H, aspect: W / H },
      shapes, spaceIdByShape: map,
      planId: String((result.plan as { id?: string }).id),
      createdAt: "t0", updatedAt: "t0"
    };
    return { data, set };
  }

  it("same rooms, new drawing — schedules never lose their target", () => {
    const { data, set } = shipped();
    const idA = set.spaceIdByShape.shA;
    // the remodel: room A moved and grew, department renamed, room C added,
    // room B demolished
    const edited: StudioShapeData[] = [
      { ...set.shapes[0], pts: rect(120, 120, 340, 220), department: "Oncology (7 East)" },
      {
        id: "shC", pts: rect(700, 100, 150, 150), roomNumber: "103", roomName: "New Office",
        roomType: "Office", floorType: "Carpet", fixtureCount: 0,
        department: "Oncology (7 East)", knownSqFt: null, source: "traced"
      }
    ];
    const map2 = applyStudioUpdate(data, set, buildResult(edited), edited, rules);

    expect(map2.shA).toBe(idA);                                   // SAME room id
    const a = data.v7.spaces!.find((s) => s.id === idA)!;
    expect(a.department).toBe("Oncology (7 East)");
    const c = data.v7.spaces!.find((s) => s.roomNumber === "103")!;
    expect(c.id).toBe(map2.shC);
    expect(c.visualPlanId).toBe(set.planId);                      // same plan
    const b = data.v7.spaces!.find((s) => s.id === set.spaceIdByShape.shB)!;
    expect(b.visualPts).toBeUndefined();                          // drawing gone…
    expect(b.roomNumber).toBe("102");                             // …data kept
    const plan = data.plans.find((p) => p.id === set.planId)!;
    expect((plan.rooms ?? []).map((r) => r.spaceId).sort())
      .toEqual([idA, c.id].sort());                               // plan matches
  });
});

describe("the set store", () => {
  it("saves, lists newest state, deletes", () => {
    const set = { id: "s1", updatedAt: "t1" } as StudioSet;
    expect(saveStudioSet(set)).toBe(true);
    expect(saveStudioSet({ ...set, updatedAt: "t2" })).toBe(true);
    expect(loadStudioSets().length).toBe(1);
    expect(loadStudioSets()[0].updatedAt).toBe("t2");
    deleteStudioSet("s1");
    expect(loadStudioSets()).toEqual([]);
  });
});
