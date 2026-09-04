// The 3D showcase projection: orthographic, affine, and EXACT — a tap on a
// roof must land on the same plan coordinates the 2D map would report.
import { describe, it, expect } from "vitest";
import {
  isoProject, isoUnproject, isoGroundMatrix, isoDepth, extrudeRoom,
  drawOrder, introPose, easeOutBack, easeOutCubic, hexRgb, shadeHex,
  pointInPoly, centroidOf, REST_TILT, REST_SPIN, type IsoPose
} from "./iso3d";

const POSE: IsoPose = { spin: REST_SPIN, tilt: REST_TILT, cx: 500, cy: 400 };

describe("isoProject / isoUnproject", () => {
  it("tilt 0, spin 0 is the identity (the 2D map)", () => {
    const p: IsoPose = { spin: 0, tilt: 0, cx: 500, cy: 400 };
    expect(isoProject(p, 123, 456)).toEqual({ x: 123, y: 456 });
  });

  it("round-trips exactly at any height", () => {
    for (const z of [0, 40]) {
      const s = isoProject(POSE, 321, 654, z);
      const back = isoUnproject(POSE, s.x, s.y, z);
      expect(back.x).toBeCloseTo(321, 8);
      expect(back.y).toBeCloseTo(654, 8);
    }
  });

  it("height moves points straight UP the screen, never sideways", () => {
    const flat = isoProject(POSE, 700, 300, 0);
    const tall = isoProject(POSE, 700, 300, 50);
    expect(tall.x).toBeCloseTo(flat.x, 8);
    expect(tall.y).toBeLessThan(flat.y);
  });

  it("the pivot stays put", () => {
    expect(isoProject(POSE, 500, 400, 0)).toEqual({ x: 500, y: 400 });
  });

  it("preserves parallelism (orthographic — no perspective warp)", () => {
    // two parallel plan segments stay parallel on screen
    const d1a = isoProject(POSE, 0, 0), d1b = isoProject(POSE, 100, 30);
    const d2a = isoProject(POSE, 400, 500), d2b = isoProject(POSE, 500, 530);
    const v1 = { x: d1b.x - d1a.x, y: d1b.y - d1a.y };
    const v2 = { x: d2b.x - d2a.x, y: d2b.y - d2a.y };
    expect(v1.x * v2.y - v1.y * v2.x).toBeCloseTo(0, 8);
  });
});

describe("isoGroundMatrix", () => {
  it("agrees with isoProject on the floor everywhere", () => {
    const m = isoGroundMatrix(POSE);
    for (const [x, y] of [[0, 0], [1000, 0], [0, 800], [777, 333]]) {
      const viaMatrix = { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
      const direct = isoProject(POSE, x, y, 0);
      expect(viaMatrix.x).toBeCloseTo(direct.x, 8);
      expect(viaMatrix.y).toBeCloseTo(direct.y, 8);
    }
  });
});

describe("extrudeRoom + painter's order", () => {
  const room = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 180 }, { x: 100, y: 180 }];

  it("roof floats exactly wallH above the base, one wall per edge", () => {
    const ex = extrudeRoom(POSE, room, 40);
    expect(ex.top.length).toBe(4);
    expect(ex.sides.length).toBe(4);
    const baseC = isoProject(POSE, 150, 140, 0);
    const roofC = centroidOf(ex.top);
    expect(roofC.x).toBeCloseTo(baseC.x, 6);
    expect(baseC.y - roofC.y).toBeCloseTo(40 * Math.sin(REST_TILT), 6);
  });

  it("walls are sorted far-to-near within the room", () => {
    const ex = extrudeRoom(POSE, room, 40);
    for (let i = 1; i < ex.sides.length; i++) {
      expect(ex.sides[i].depth).toBeGreaterThanOrEqual(ex.sides[i - 1].depth);
    }
  });

  it("face light stays in [0,1] whatever the edge direction", () => {
    const jag = [{ x: 0, y: 0 }, { x: 50, y: -30 }, { x: 90, y: 40 }, { x: 20, y: 70 }, { x: -40, y: 20 }];
    for (const s of extrudeRoom(POSE, jag, 30).sides) {
      expect(s.light).toBeGreaterThanOrEqual(0);
      expect(s.light).toBeLessThanOrEqual(1);
    }
  });

  it("rooms further up-plan paint before rooms below (viewer at screen-bottom)", () => {
    const north = [{ x: 480, y: 100 }, { x: 520, y: 100 }, { x: 520, y: 140 }, { x: 480, y: 140 }];
    const south = [{ x: 480, y: 700 }, { x: 520, y: 700 }, { x: 520, y: 740 }, { x: 480, y: 740 }];
    const ordered = drawOrder({ ...POSE, spin: 0 }, [
      { pts: south, item: "south" }, { pts: north, item: "north" }
    ]);
    expect(ordered.map((r) => r.item)).toEqual(["north", "south"]);
  });

  it("depth is consistent with the projection: closer rooms sit lower on screen", () => {
    const a = { x: 300, y: 200 }, b = { x: 600, y: 650 };
    const da = isoDepth(POSE, a.x, a.y), db = isoDepth(POSE, b.x, b.y);
    const sa = isoProject(POSE, a.x, a.y), sb = isoProject(POSE, b.x, b.y);
    expect(db > da).toBe(sb.y > sa.y);
  });
});

describe("the spin-and-settle intro", () => {
  it("starts flat, pulled back, and over-rotated", () => {
    const p0 = introPose(0);
    expect(p0.tilt).toBeCloseTo(0, 6);
    expect(p0.zoom).toBeLessThan(1);
    expect(Math.abs(p0.spin - REST_SPIN)).toBeGreaterThan(1);
  });

  it("lands exactly on the resting pose", () => {
    const p1 = introPose(1);
    expect(p1.spin).toBeCloseTo(REST_SPIN, 6);
    expect(p1.tilt).toBeCloseTo(REST_TILT, 6);
    expect(p1.zoom).toBeCloseTo(1, 6);
  });

  it("clamps outside [0,1]", () => {
    expect(introPose(1.7)).toEqual(introPose(1));
    expect(introPose(-0.3)).toEqual(introPose(0));
  });

  it("easings hit their endpoints; back overshoots on the way", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutBack(0)).toBeCloseTo(0, 6);
    expect(easeOutBack(1)).toBeCloseTo(1, 6);
    expect(easeOutBack(0.85)).toBeGreaterThan(1); // the spring's overshoot
  });
});

describe("color + hit helpers", () => {
  it("hexRgb parses and falls back on junk", () => {
    expect(hexRgb("#0d9488")).toEqual({ r: 13, g: 148, b: 136 });
    expect(hexRgb("teal-ish")).toEqual({ r: 51, g: 64, b: 77 });
  });

  it("shadeHex darkens below 1 and lightens above", () => {
    expect(shadeHex("#808080", 0.5)).toBe("#404040");
    expect(shadeHex("#808080", 1.5)).toBe("#c0c0c0");
    expect(shadeHex("#ff0000", 0)).toBe("#000000");
  });

  it("pointInPoly hits roofs and misses the sky", () => {
    const roof = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(pointInPoly(roof, 5, 5)).toBe(true);
    expect(pointInPoly(roof, 15, 5)).toBe(false);
  });
});
