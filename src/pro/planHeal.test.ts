import { describe, expect, it } from "vitest";
import { floorLevel, sortFloorsTopDown } from "./floorOrder";
import { healMissingPlans, rebuildMissingPlans } from "./planHeal";

const square = (x: number, y: number, s: number) => [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }];
const room = (id: string, planId: string, floor: string, x: number) => ({
  id, roomNumber: id.toUpperCase(), roomName: "OFFICE", roomType: "Office", squareFeet: 100,
  building: "fairview", floor, visualBuilding: "fairview", visualFloor: floor,
  visualPlanId: planId, visualW: 2000, visualH: 1000, visualPts: square(x, 100, 200)
});

describe("rebuildMissingPlans", () => {
  it("draws a floor's missing map again from its rooms — same id, size and outlines", () => {
    const spaces = [room("a1", "ai-fairview-4-old", "4", 100), room("a2", "ai-fairview-4-old", "4", 400), room("b1", "p3", "3", 100)];
    const plans = [{ id: "p3", building: "fairview", floor: "3", w: 2000, h: 1000, img: "x", rooms: [] }];
    const rebuilt = rebuildMissingPlans(spaces, plans, "2026-10-21T00:00:00Z");
    expect(rebuilt).toHaveLength(1);
    const p = rebuilt[0];
    expect(p).toMatchObject({ id: "ai-fairview-4-old", building: "fairview", floor: "4", w: 2000, h: 1000, source: "rebuilt-from-rooms" });
    expect(p.rooms).toEqual([{ spaceId: "a1", pts: square(100, 100, 200) }, { spaceId: "a2", pts: square(400, 100, 200) }]);
    expect(String(p.img)).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("leaves floors that have their map alone, and skips rooms without outlines", () => {
    const spaces = [room("b1", "p3", "3", 100), { ...room("c1", "gone", "9", 0), visualPts: [] }];
    expect(rebuildMissingPlans(spaces, [{ id: "p3" }])).toEqual([]);
  });
});

describe("healMissingPlans on the device", () => {
  it("saves the drawn map beside the others, once", () => {
    const m = new Map<string, string>([
      ["opsmatrix_v7", JSON.stringify({ spaces: [room("a1", "gone", "4", 100), room("b1", "p3", "3", 100)] })],
      ["opsmatrix_v7_plans", JSON.stringify([{ id: "p3", building: "fairview", floor: "3" }])]
    ]);
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
    expect(healMissingPlans(store)).toBe(1);
    expect(JSON.parse(m.get("opsmatrix_v7_plans")!).map((p: { id: string }) => p.id)).toEqual(["p3", "gone"]);
    expect(healMissingPlans(store)).toBe(0);
  });

  it("never throws on unreadable data", () => {
    const store = { getItem: () => "{broken", setItem: () => { throw new Error("no"); } };
    expect(healMissingPlans(store)).toBe(0);
  });
});

describe("floors top-down", () => {
  const order = (names: string[]) => sortFloorsTopDown(names.map((floor) => ({ floor }))).map((p) => p.floor);

  it("lists the building as it stands: top floor first, basements last", () => {
    expect(order(["1", "2", "3", "5", "6", "7", "B", "B2", "4"])).toEqual(["7", "6", "5", "4", "3", "2", "1", "B", "B2"]);
    expect(order(["1st Floor", "Basement", "3rd Floor", "Lower Level 2", "2nd Floor"])).toEqual(["3rd Floor", "2nd Floor", "1st Floor", "Basement", "Lower Level 2"]);
    expect(order(["Ground", "1", "Roof", "LL"])).toEqual(["Roof", "1", "Ground", "LL"]);
  });

  it("keeps floors with names that say nothing on top, in their own order", () => {
    expect(order(["East Wing", "2", "West Wing", "1"])).toEqual(["East Wing", "West Wing", "2", "1"]);
  });

  it("reads the usual floor names", () => {
    expect([floorLevel("Level 2"), floorLevel("L3"), floorLevel("3F"), floorLevel("B1"), floorLevel("P2"), floorLevel("Mezzanine")]).toEqual([2, 3, 3, -1, -2, 1.5]);
    expect(Number.isNaN(floorLevel(""))).toBe(true);
  });
});
