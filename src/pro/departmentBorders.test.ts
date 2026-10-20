// Department BORDERS: one contour per contiguous cluster of rooms — the
// wall-thickness gap between neighbours closes, a corridor someone else
// owns does not (Josh's administration-split-by-billing case).
import { describe, it, expect } from "vitest";
import {
  departmentBorders, departmentOutlineRuns, pointInPtsDept, colorForDept, type XY
} from "./departments";

const rect = (x: number, y: number, w: number, h: number): XY[] =>
  [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

const inside = (pts: XY[], x: number, y: number) => pointInPtsDept(pts, x, y);

const PLAN = { w: 1000, h: 600 };

describe("departmentBorders", () => {
  it("one room → one border that contains it", () => {
    const borders = departmentBorders(
      [{ dept: "Imaging", pts: rect(100, 100, 200, 150) }], PLAN.w, PLAN.h, {});
    expect(borders.length).toBe(1);
    expect(borders[0].dept).toBe("Imaging");
    expect(inside(borders[0].pts, 200, 175)).toBe(true);   // room center
    expect(inside(borders[0].pts, 600, 175)).toBe(false);  // far away
  });

  it("two rooms separated only by a wall gap merge into ONE border", () => {
    // 6px gap = inset walls between neighbours; join default closes it
    const borders = departmentBorders([
      { dept: "Admin", pts: rect(100, 100, 150, 150) },
      { dept: "Admin", pts: rect(256, 100, 150, 150) }
    ], PLAN.w, PLAN.h, {});
    expect(borders.length).toBe(1);
    expect(inside(borders[0].pts, 175, 175)).toBe(true);
    expect(inside(borders[0].pts, 330, 175)).toBe(true);
  });

  it("a department split by a wide corridor gets TWO borders", () => {
    // 60px corridor between the halves — far wider than any wall
    const borders = departmentBorders([
      { dept: "Admin", pts: rect(100, 100, 150, 150) },
      { dept: "Admin", pts: rect(310, 100, 150, 150) }
    ], PLAN.w, PLAN.h, {});
    expect(borders.length).toBe(2);
    const hitsA = borders.filter((b) => inside(b.pts, 175, 175)).length;
    const hitsB = borders.filter((b) => inside(b.pts, 385, 175)).length;
    expect(hitsA).toBe(1);
    expect(hitsB).toBe(1);
    // and neither border swallows the corridor's middle
    expect(borders.some((b) => inside(b.pts, 280, 175))).toBe(false);
  });

  it("departments never share a border", () => {
    const borders = departmentBorders([
      { dept: "Admin", pts: rect(100, 100, 150, 150) },
      { dept: "Billing", pts: rect(258, 100, 150, 150) } // wall-close neighbour
    ], PLAN.w, PLAN.h, {});
    expect(borders.length).toBe(2);
    const admin = borders.find((b) => b.dept === "Admin")!;
    expect(inside(admin.pts, 330, 175)).toBe(false); // Billing's room stays out
  });

  it("an L-shaped wing traces one concave border, not a bounding box", () => {
    const borders = departmentBorders([
      { dept: "ER", pts: rect(100, 100, 300, 100) },
      { dept: "ER", pts: rect(100, 204, 100, 200) } // touching via wall gap
    ], PLAN.w, PLAN.h, {});
    expect(borders.length).toBe(1);
    // the notch (inside the bounding box but outside the L) stays OUT
    expect(inside(borders[0].pts, 350, 350)).toBe(false);
    expect(inside(borders[0].pts, 150, 350)).toBe(true);
    expect(inside(borders[0].pts, 350, 150)).toBe(true);
  });

  it("the border sits ON the room's walls, not a halo around them", () => {
    const borders = departmentBorders(
      [{ dept: "Imaging", pts: rect(100, 100, 200, 150) }], PLAN.w, PLAN.h, {});
    expect(borders.length).toBe(1);
    // just inside each wall is IN, a few px outside each wall is OUT —
    // the old dilated halo would have swallowed the outside points
    expect(inside(borders[0].pts, 104, 175)).toBe(true);
    expect(inside(borders[0].pts, 296, 175)).toBe(true);
    expect(inside(borders[0].pts, 200, 104)).toBe(true);
    expect(inside(borders[0].pts, 200, 246)).toBe(true);
    expect(inside(borders[0].pts, 92, 175)).toBe(false);
    expect(inside(borders[0].pts, 308, 175)).toBe(false);
    expect(inside(borders[0].pts, 200, 92)).toBe(false);
    expect(inside(borders[0].pts, 200, 258)).toBe(false);
  });

  it("stored colors ride along; rooms without a department are ignored", () => {
    const borders = departmentBorders([
      { dept: "Imaging", pts: rect(0, 0, 100, 100) },
      { dept: "", pts: rect(300, 300, 100, 100) }
    ], PLAN.w, PLAN.h, { Imaging: "#123abc" });
    expect(borders.length).toBe(1);
    expect(borders[0].color).toBe("#123abc");
  });
});

describe("departmentOutlineRuns (shared walls hatch between the colors)", () => {
  it("a wall two departments share becomes ONE two-color midline run", () => {
    // Admin ends at x=250, Billing starts at x=256 — a 6px wall between
    const runs = departmentOutlineRuns([
      { dept: "Admin", pts: rect(100, 100, 150, 150) },
      { dept: "Billing", pts: rect(256, 100, 150, 150) }
    ], PLAN.w, PLAN.h, {});
    const admin = colorForDept("Admin", {})!;
    const billing = colorForDept("Billing", {})!;
    const hatched = runs.filter((r) => r.color2);
    expect(hatched.length).toBeGreaterThan(0);
    for (const h of hatched) {
      // carries BOTH departments' colors
      expect(new Set([h.color, h.color2])).toEqual(new Set([admin, billing]));
      // and sits ON the wall between them, not on either room's far side
      for (const p of h.pts) {
        expect(p.x).toBeGreaterThan(244);
        expect(p.x).toBeLessThan(262);
        expect(p.y).toBeGreaterThan(88);
        expect(p.y).toBeLessThan(262);
      }
    }
    // the rest of each department still draws solid in its own color
    expect(runs.some((r) => !r.color2 && r.color === admin)).toBe(true);
    expect(runs.some((r) => !r.color2 && r.color === billing)).toBe(true);
  });

  it("departments that don't touch stay two solid closed loops", () => {
    const runs = departmentOutlineRuns([
      { dept: "Admin", pts: rect(100, 100, 100, 100) },
      { dept: "Billing", pts: rect(500, 400, 100, 100) }
    ], PLAN.w, PLAN.h, {});
    expect(runs.length).toBe(2);
    expect(runs.every((r) => r.closed && !r.color2)).toBe(true);
  });

  it("a lone department is one solid closed loop", () => {
    const runs = departmentOutlineRuns(
      [{ dept: "Imaging", pts: rect(100, 100, 200, 150) }], PLAN.w, PLAN.h, {});
    expect(runs.length).toBe(1);
    expect(runs[0].closed).toBe(true);
    expect(runs[0].color2).toBeUndefined();
  });
});
