// The Plan Studio's snap engine (ported from the archive editor Josh trusts):
// rough corner taps land ON the drawn walls, and enclosed regions can be
// found straight from the lines. All pure over a synthetic luminance grid.
import { describe, it, expect } from "vitest";
import {
  grayFromPixels, snapToWalls, rectify, rdp, autoDetectRooms, shoelacePx, type Gray
} from "./planSnap";

/** synthetic plan: white ground, black wall rectangles drawn in a pixel grid */
function makePlan(w: number, h: number, walls: [number, number, number, number][]): Gray {
  const px = new Uint8ClampedArray(w * h * 4).fill(255);
  const ink = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    px[i] = px[i + 1] = px[i + 2] = 0;
  };
  for (const [x0, y0, x1, y1] of walls) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) ink(x, y);
  }
  return grayFromPixels(px, w, h);
}

/** a 600×600 plan with one room: walls (3px thick) at x=100/400, y=100/300 */
function oneRoomPlan(): Gray {
  return makePlan(600, 600, [
    [100, 100, 400, 103], // top
    [100, 297, 400, 300], // bottom
    [100, 100, 103, 300], // left
    [397, 100, 400, 300]  // right
  ]);
}

describe("grayFromPixels", () => {
  it("reads dark ink on light ground", () => {
    const g = oneRoomPlan();
    expect(g.dark).toBe(true); // mostly white → mean high → ink is the dark part
    expect(g.w).toBe(600);
  });
});

describe("snapToWalls", () => {
  it("pulls rough corner taps onto the drawn walls", () => {
    const g = oneRoomPlan();
    // taps ~12px off every true corner (true room ~ (101.5,101.5)-(398.5,298.5))
    const rough = [
      { x: 112, y: 90 }, { x: 388, y: 112 }, { x: 410, y: 288 }, { x: 92, y: 310 }
    ];
    const snapped = snapToWalls(g, rough);
    expect(snapped.length).toBe(4);
    for (const p of snapped) {
      // every snapped corner sits within a few pixels of a wall line
      const nearX = Math.min(Math.abs(p.x - 101.5), Math.abs(p.x - 398.5));
      const nearY = Math.min(Math.abs(p.y - 101.5), Math.abs(p.y - 298.5));
      expect(nearX, `x of ${JSON.stringify(p)}`).toBeLessThan(7);
      expect(nearY, `y of ${JSON.stringify(p)}`).toBeLessThan(7);
    }
    // and the snapped area is close to the true room area (~297×197)
    const area = shoelacePx(snapped);
    expect(Math.abs(area - 297 * 197) / (297 * 197)).toBeLessThan(0.08);
  });

  it("leaves the polygon alone with no grid", () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(snapToWalls(null, pts)).toBe(pts);
  });
});

describe("rectify / rdp", () => {
  it("straightens near-axis edges", () => {
    const out = rectify([{ x: 0, y: 0 }, { x: 100, y: 3 }, { x: 101, y: 100 }, { x: -2, y: 99 }]);
    expect(Math.abs(out[0].y - out[1].y)).toBeLessThan(0.01);
    expect(Math.abs(out[1].x - out[2].x)).toBeLessThan(0.01);
  });

  it("rdp simplifies collinear chains", () => {
    const pts = Array.from({ length: 21 }, (_, i) => ({ x: i * 10, y: 0 }));
    expect(rdp(pts, 2).length).toBe(2);
  });
});

describe("autoDetectRooms", () => {
  it("finds the enclosed room from the plan's own lines", () => {
    const g = oneRoomPlan();
    const rooms = autoDetectRooms(g);
    expect(rooms.length).toBe(1);
    const area = shoelacePx(rooms[0]);
    // interior ~ 293×193 after dilation/expand round trip — generous window
    expect(area).toBeGreaterThan(240 * 150);
    expect(area).toBeLessThan(330 * 230);
  });
});
