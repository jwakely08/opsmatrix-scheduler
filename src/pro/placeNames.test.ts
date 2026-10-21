import { describe, expect, it } from "vitest";
import { knownPlaces, mergePlaceNames, nextFloorName, placeKey, repairPlaceNames, type PlaceStores } from "./placeNames";

const sp = (id: string, system: string, building: string, floor: string) =>
  ({ id, system, building, floor, visualBuilding: building, visualFloor: floor });

/** Josh's case: FV-02 typed into "fairview" beside FV-01's "Fairview" */
function twins(): PlaceStores {
  return {
    spaces: [
      sp("a1", "Cleveland Clinic", "Fairview", "1st Floor"),
      sp("a2", "Cleveland Clinic", "Fairview", "1st Floor"),
      sp("a3", "Cleveland Clinic", "Fairview", "1st Floor"),
      sp("b1", "cleveland clinic ", "fairview", "2nd floor"),
      sp("b2", "Cleveland Clinic", " fairview", "2nd Floor"),
      sp("c1", "Summa Health", "Fairview", "1st Floor") // same building name, other account: stays its own
    ],
    plans: [
      { id: "p1", building: "Fairview", floor: "1st Floor", rooms: [{ spaceId: "a1" }] },
      { id: "p2", building: "fairview", floor: "2nd floor", rooms: [{ spaceId: "b1" }, { spaceId: "b2" }] }
    ],
    sets: [{ account: "cleveland clinic", building: "fairview", floor: "2nd floor", planId: "p2" }],
    routes: { sanitation: [{ building: "fairview", planId: "p2" }], policing: [] }
  };
}

describe("mergePlaceNames", () => {
  it("gives every place the spelling most rooms use — rooms, plans, sets and routes", () => {
    const st = twins();
    expect(mergePlaceNames(st)).toBeGreaterThan(0);
    const cc = st.spaces.filter((s) => s.id !== "c1");
    expect(new Set(cc.map((s) => s.system))).toEqual(new Set(["Cleveland Clinic"]));
    expect(new Set(cc.map((s) => s.building))).toEqual(new Set(["Fairview"]));
    expect(new Set(cc.map((s) => s.visualBuilding))).toEqual(new Set(["Fairview"]));
    expect(st.spaces.find((s) => s.id === "b1")!.floor).toBe("2nd Floor"); // 1 vs 1: the one with capitals wins
    expect(st.spaces.find((s) => s.id === "b2")!.floor).toBe("2nd Floor");
    expect(st.plans.map((p) => p.building)).toEqual(["Fairview", "Fairview"]);
    expect(st.sets[0]).toMatchObject({ account: "Cleveland Clinic", building: "Fairview", floor: "2nd Floor" });
    expect(st.routes.sanitation![0].building).toBe("Fairview");
    expect(st.spaces.find((s) => s.id === "c1")).toMatchObject({ system: "Summa Health", building: "Fairview" });
  });

  it("leaves data with nothing to merge alone", () => {
    const st: PlaceStores = { spaces: [sp("a", "X", "One", "1"), sp("b", "X", "Two", "1")], plans: [], sets: [], routes: {} };
    expect(mergePlaceNames(st)).toBe(0);
  });
});

describe("knownPlaces", () => {
  it("lists accounts → buildings → floors with room counts, one entry per place", () => {
    const st = twins();
    mergePlaceNames(st);
    const places = knownPlaces(st.spaces);
    expect(places.map((a) => a.name)).toEqual(["Cleveland Clinic", "Summa Health"]);
    const fv = places[0].buildings;
    expect(fv.map((b) => [b.name, b.rooms])).toEqual([["Fairview", 5]]);
    expect(fv[0].floors.map((f) => [f.name, f.rooms])).toEqual([["1st Floor", 3], ["2nd Floor", 2]]);
  });

  it("ignores rooms without an account or building", () => {
    expect(knownPlaces([{ system: "", building: "A" }, { system: "X", building: "" }])).toEqual([]);
  });
});

describe("nextFloorName", () => {
  it("suggests the floor after the highest one", () => {
    expect(nextFloorName([{ name: "1st Floor" }, { name: "2nd Floor" }])).toBe("3rd Floor");
    expect(nextFloorName([{ name: "10th Floor" }])).toBe("11th Floor");
    expect(nextFloorName([{ name: "Level 2" }])).toBe("Level 3");
    expect(nextFloorName([{ name: "Basement" }])).toBe("");
  });
  it("matches names in all but capitals and spacing", () => {
    expect(placeKey("  Fair   View ")).toBe(placeKey("fair view"));
  });
});

describe("repairPlaceNames on the device", () => {
  it("saves the merged names, and only the stores that changed", () => {
    const st = twins();
    const m = new Map<string, string>([
      ["opsmatrix_v7", JSON.stringify({ spaces: st.spaces, settings: { orgName: "Demo" } })],
      ["opsmatrix_v7_plans", JSON.stringify(st.plans)],
      ["opsmatrix_fusion_planstudio", JSON.stringify(st.sets)],
      ["opsmatrix_fusion_routes", JSON.stringify(st.routes)]
    ]);
    const writes: string[] = [];
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { writes.push(k); m.set(k, v); } };
    expect(repairPlaceNames(store)).toBeGreaterThan(0);
    expect(writes.sort()).toEqual(["opsmatrix_fusion_planstudio", "opsmatrix_fusion_routes", "opsmatrix_v7", "opsmatrix_v7_plans"]);
    const v7 = JSON.parse(m.get("opsmatrix_v7")!);
    expect(v7.settings.orgName).toBe("Demo");
    expect(knownPlaces(v7.spaces)[0].buildings).toHaveLength(1);
    writes.length = 0;
    expect(repairPlaceNames(store)).toBe(0); // second start: nothing left to do
    expect(writes).toEqual([]);
  });

  it("does nothing to a device without rooms or with unreadable data", () => {
    const store = { getItem: (k: string) => (k === "opsmatrix_v7" ? "{broken" : null), setItem: () => { throw new Error("no writes expected"); } };
    expect(repairPlaceNames(store)).toBe(0);
  });
});
