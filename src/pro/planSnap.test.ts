// The Plan Studio's snap engine (ported from the archive editor Josh trusts):
// rough corner taps land ON the drawn walls, and enclosed regions can be
// found straight from the lines. All pure over a synthetic luminance grid.
import { describe, it, expect } from "vitest";
import {
  grayFromPixels, stretchGray, snapToWalls, rectify, rdp, autoDetectRooms,
  shoelacePx, overlapRatio, unionPolygons, alignEdgesToNeighbors, snapCollapsed,
  dropSpikes, avgWidth,
  type Gray
} from "./planSnap";

const sq = (x: number, y: number, w: number, h: number) => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }
];

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

describe("stretchGray (faint plans)", () => {
  it("makes light-gray walls read as full ink", () => {
    // walls drawn at 60% gray on white — barely registers unstretched
    const w = 200, h = 200;
    const px = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let x = 40; x <= 160; x++) {
      for (const y of [40, 41, 42, 158, 159, 160]) {
        const i = (y * w + x) * 4;
        px[i] = px[i + 1] = px[i + 2] = 200; // faint
      }
    }
    const raw = grayFromPixels(px, w, h);
    const rawResp = raw.dark ? 1 - raw.data[41 * w + 100] : raw.data[41 * w + 100];
    expect(rawResp).toBeLessThan(0.4); // too faint for the snap threshold
    const g = stretchGray(raw);
    const resp = g.dark ? 1 - g.data[41 * w + 100] : g.data[41 * w + 100];
    expect(resp).toBeGreaterThan(0.6); // now solid ink
  });
});

describe("overlapRatio — the hard no-overlap rule", () => {
  it("a box inside another reads ~1; neighbours read ~0", () => {
    const big = sq(0, 0, 200, 200);
    const inner = sq(50, 50, 80, 80);
    const neighbour = sq(210, 0, 100, 100);
    expect(overlapRatio(big, inner)).toBeGreaterThan(0.9);
    expect(overlapRatio(big, neighbour)).toBeLessThan(0.05);
    const halfIn = sq(150, 0, 100, 100); // half over the edge
    const r = overlapRatio(big, halfIn);
    expect(r).toBeGreaterThan(0.4);
    expect(r).toBeLessThan(0.6);
  });
});

describe("unionPolygons — the merge tool", () => {
  it("two adjacent rooms merge into one outline with the combined area", () => {
    const a = sq(0, 0, 100, 100);
    const b = sq(100, 0, 80, 100); // shares the x=100 wall
    const merged = unionPolygons(a, b)!;
    expect(merged).toBeTruthy();
    const area = shoelacePx(merged);
    expect(Math.abs(area - 180 * 100) / (180 * 100)).toBeLessThan(0.06);
  });

  it("refuses rooms that don't touch", () => {
    expect(unionPolygons(sq(0, 0, 50, 50), sq(200, 200, 50, 50))).toBeNull();
  });

  it("an L-shaped union keeps the notch (no convex-hull cheating)", () => {
    const a = sq(0, 0, 200, 100);
    const b = sq(0, 100, 100, 100); // L overall
    const merged = unionPolygons(a, b)!;
    const area = shoelacePx(merged);
    // L area = 200×100 + 100×100 = 30000; a hull would be ~40000
    expect(Math.abs(area - 30000) / 30000).toBeLessThan(0.08);
  });
});

describe("re-snap is a refinement, not a re-detection", () => {
  it("a tight maxOffset stays on the near line instead of reverting to the old wall", () => {
    // two vertical walls: the OLD one at x=100, the one the user moved to at x=140
    const g = makePlan(400, 300, [
      [100, 50, 103, 250],
      [140, 50, 143, 250],
      [98, 50, 145, 53],   // top cap so corners have something to grab
      [98, 247, 145, 250]
    ]);
    // the user reshaped the left edge to ~x=134 (near the NEW wall)
    const shape = [{ x: 134, y: 55 }, { x: 300, y: 55 }, { x: 300, y: 245 }, { x: 134, y: 245 }];
    const tight = snapToWalls(g, shape, { maxOffset: 12 });
    const minXTight = Math.min(...tight.map((p) => p.x));
    expect(Math.abs(minXTight - 141.5)).toBeLessThan(5); // seats on the NEW wall
    expect(minXTight).toBeGreaterThan(120);              // never reverts to x=100
  });
});

describe("corridor traces must not collapse (Josh's sliver bug, 2026-09-02)", () => {
  /** a corridor: STRONG left wall (black), FAINT right wall (light gray).
   *  Each snapped edge picks the strongest line in reach, so both vertical
   *  edges of a traced box pile onto the same dark wall — the box collapses
   *  to a sliver. snapCollapsed() is the guard that catches it. */
  function corridorPlan(): Gray {
    const w = 600, h = 400;
    const px = new Uint8ClampedArray(w * h * 4).fill(255);
    const paint = (x0: number, x1: number, v: number) => {
      for (let y = 60; y <= 340; y++) for (let x = x0; x <= x1; x++) {
        const i = (y * w + x) * 4;
        px[i] = px[i + 1] = px[i + 2] = v;
      }
    };
    paint(200, 202, 0);    // strong wall — solid black
    paint(214, 216, 190);  // faint wall — light gray, below the snap threshold
    return grayFromPixels(px, w, h);
  }

  const trace = [
    { x: 197, y: 100 }, { x: 217, y: 100 },
    { x: 217, y: 300 }, { x: 197, y: 300 }
  ];

  it("documents the mechanism: both edges snap onto the one strong wall", () => {
    const snapped = snapToWalls(corridorPlan(), trace);
    const xs = snapped.map((p) => p.x);
    const width = Math.max(...xs) - Math.min(...xs);
    expect(width).toBeLessThan(6); // the 20px-wide trace became a sliver
  });

  it("snapCollapsed flags the sliver", () => {
    const snapped = snapToWalls(corridorPlan(), trace);
    expect(snapCollapsed(trace, snapped)).toBe(true);
  });

  it("snapCollapsed passes an honest refinement", () => {
    const g = oneRoomPlan();
    const rough = [
      { x: 112, y: 90 }, { x: 388, y: 112 }, { x: 410, y: 288 }, { x: 92, y: 310 }
    ];
    expect(snapCollapsed(rough, snapToWalls(g, rough))).toBe(false);
  });

  it("snapCollapsed passes the neighbour-seating nudges too", () => {
    const b = sq(205, 100, 100, 100);
    const seated = alignEdgesToNeighbors(b, [sq(100, 100, 100, 100)], 12);
    expect(snapCollapsed(b, seated)).toBe(false);
  });

  it("degenerate output always reads as collapsed", () => {
    expect(snapCollapsed(sq(0, 0, 100, 100), [{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBe(true);
  });
});

describe("alignEdgesToNeighbors — border to border, no gaps, no overlaps", () => {
  it("closes a sliver gap onto the neighbour's border", () => {
    const a = sq(100, 100, 100, 100);        // right edge at x=200
    const b = sq(205, 100, 100, 100);        // 5px gap
    const aligned = alignEdgesToNeighbors(b, [a], 12);
    const minX = Math.min(...aligned.map((p) => p.x));
    expect(Math.abs(minX - 200)).toBeLessThan(0.5);
  });

  it("pulls a slight overlap back to the shared border", () => {
    const a = sq(100, 100, 100, 100);
    const b = sq(194, 100, 100, 100);        // 6px overlap
    const aligned = alignEdgesToNeighbors(b, [a], 12);
    const minX = Math.min(...aligned.map((p) => p.x));
    expect(Math.abs(minX - 200)).toBeLessThan(0.5);
  });

  it("leaves far or unrelated edges alone", () => {
    const a = sq(100, 100, 100, 100);
    const b = sq(400, 100, 100, 100);        // nowhere near
    const aligned = alignEdgesToNeighbors(b, [a], 12);
    expect(aligned.map((p) => Math.round(p.x))).toEqual(b.map((p) => Math.round(p.x)));
  });
});

describe("dropSpikes / avgWidth (staging artifacts)", () => {
  it("removes the doorway needle, keeps real corners", () => {
    // a rectangle with a needle fired out of the top edge
    const spiky = [
      { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 52, y: -80 }, { x: 54, y: 0 },
      { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }
    ];
    const clean = dropSpikes(spiky);
    expect(clean.length).toBeLessThan(spiky.length);
    expect(Math.min(...clean.map((p) => p.y))).toBeGreaterThanOrEqual(0); // needle gone
    // an honest L-shape is untouched
    const L = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 },
      { x: 50, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 100 }
    ];
    expect(dropSpikes(L)).toEqual(L);
  });

  it("avgWidth separates rooms from wall traces", () => {
    const roomish = sq(0, 0, 200, 150);
    const ribbon = sq(0, 0, 400, 7);
    expect(avgWidth(roomish)).toBeGreaterThan(60);
    expect(avgWidth(ribbon)).toBeLessThan(8);
  });
});
