// The extracted Calibration-Editor ingest chain: scale-aware snap reach and
// the no-overlap rule. The regression that matters (Franciscan benchmark):
// on a dense sheet the sheet-sized default snap reach EQUALS a room pitch,
// so a correctly placed AI box teleported onto the strong wall next door.
import { describe, it, expect } from "vitest";
import { grayFromPixels, snapReachFor, defaultSnapReach, labelBubbles, eraseBubbles, lineResp, autoDetectRooms, type Gray } from "./planSnap";
import { ingestAiSeeds, cleanSnapPts } from "./studioIngest";
import { defaultRules } from "./rules";

function makeGray(w: number, h: number, paint: (set: (x: number, y: number, v: number) => void) => void): Gray {
  const px = new Uint8ClampedArray(w * h * 4).fill(255);
  paint((x, y, v) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4;
    px[i] = px[i + 1] = px[i + 2] = v;
  });
  return grayFromPixels(px, w, h);
}

const vwall = (set: (x: number, y: number, v: number) => void, x0: number, x1: number, y0: number, y1: number, v: number) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, v);
};

describe("snapReachFor — scale-aware reach", () => {
  it("a small seed gets a reach that is a fraction of ITSELF, not the sheet", () => {
    const seed = [{ x: 100, y: 100 }, { x: 140, y: 100 }, { x: 140, y: 160 }, { x: 100, y: 160 }];
    // sheet-sized default on a 1600px grid would be 55px — more than the room
    expect(defaultSnapReach(1600)).toBe(55);
    const r = snapReachFor(seed, 1600);
    expect(r).toBe(10); // 25% of the 40px short side
  });

  it("a big room keeps the default reach", () => {
    const seed = [{ x: 100, y: 100 }, { x: 700, y: 100 }, { x: 700, y: 500 }, { x: 100, y: 500 }];
    expect(snapReachFor(seed, 1600)).toBe(defaultSnapReach(1600));
  });
});

describe("ingestAiSeeds — the teleport regression", () => {
  /** dense-sheet scene: a STRONG wall one room-pitch left of a correctly
   *  placed seed, faint (but real) walls where the seed belongs */
  function denseScene(): Gray {
    return makeGray(1600, 400, (set) => {
      vwall(set, 60, 63, 40, 360, 0);      // the neighbour's strong wall
      vwall(set, 100, 103, 40, 360, 120);  // the seed's own left wall (faint)
      vwall(set, 143, 146, 40, 360, 120);  // the seed's own right wall (faint)
      for (let x = 60; x <= 146; x++) { set(x, 40, 120); set(x, 41, 120); set(x, 359, 120); set(x, 360, 120); }
    });
  }

  it("a correctly placed seed STAYS between its own walls", () => {
    const g = denseScene();
    const seed = {
      name: "2101", roomNumber: "2101", roomType: "Office",
      polygon: [[105 / 1600, 60 / 400], [141 / 1600, 60 / 400], [141 / 1600, 340 / 400], [105 / 1600, 340 / 400]]
    };
    const { shapes } = ingestAiSeeds([seed], [], g, 1600, 400, defaultRules());
    expect(shapes.length).toBe(1);
    const minX = Math.min(...shapes[0].pts.map((p) => p.x));
    // seats on its own faint wall (~103), never the strong wall at ~62
    expect(minX).toBeGreaterThan(90);
    expect(minX).toBeLessThan(115);
  });

  it("the OLD sheet-sized reach really did teleport (documents the bug)", () => {
    const g = denseScene();
    const pts = [{ x: 105, y: 60 }, { x: 141, y: 60 }, { x: 141, y: 340 }, { x: 105, y: 340 }];
    const old = cleanSnapPts(g, 1600, pts, [], {}); // no reach → default 55px
    const minX = Math.min(...old.map((p) => p.x));
    expect(minX).toBeLessThan(90); // the left edge left its room for the strong wall
  });

  it("overlapping duplicate readings are dropped largest-first", () => {
    const g = makeGray(800, 800, (set) => vwall(set, 0, 0, 0, 0, 255));
    const big = { name: "A", roomNumber: "1", roomType: "Office", polygon: [[0.1, 0.1], [0.6, 0.1], [0.6, 0.6], [0.1, 0.6]] };
    const dupe = { name: "B", roomNumber: "", roomType: "Office", polygon: [[0.15, 0.15], [0.5, 0.15], [0.5, 0.5], [0.15, 0.5]] };
    const { shapes, dropped } = ingestAiSeeds([dupe, big], [], g, 800, 800, defaultRules());
    expect(shapes.length).toBe(1);
    expect(shapes[0].roomNumber).toBe("1");
    expect(dropped).toBe(1);
  });

  it("two DIFFERENT printed numbers both survive an overlap (distinct rooms)", () => {
    const g = makeGray(800, 800, (set) => vwall(set, 0, 0, 0, 0, 255));
    const room = { name: "2106", roomNumber: "2106", roomType: "Office", polygon: [[0.1, 0.1], [0.6, 0.1], [0.6, 0.6], [0.1, 0.6]] };
    const annex = { name: "2106A", roomNumber: "2106A", roomType: "Other", polygon: [[0.15, 0.15], [0.5, 0.15], [0.5, 0.5], [0.15, 0.5]] };
    const { shapes } = ingestAiSeeds([annex, room], [], g, 800, 800, defaultRules());
    expect(shapes.map((s) => s.roomNumber).sort()).toEqual(["2106", "2106A"]);
  });
});

describe("labelBubbles / eraseBubbles", () => {
  /** a room with a printed number bubble inside: stadium outline + glyph ink */
  function bubbleScene(): Gray {
    return makeGray(600, 600, (set) => {
      // the room's walls
      vwall(set, 100, 103, 100, 400, 0);
      vwall(set, 400, 403, 100, 400, 0);
      for (let x = 100; x <= 403; x++) { for (const y of [100, 101, 102, 103, 398, 399, 400]) set(x, y, 0); }
      // the label bubble: 90x34 rounded box at (200,230) with digit strokes
      for (let x = 200; x <= 290; x++) { set(x, 230, 0); set(x, 231, 0); set(x, 263, 0); set(x, 264, 0); }
      for (let y = 230; y <= 264; y++) { set(200, y, 0); set(201, y, 0); set(289, y, 0); set(290, y, 0); }
      for (let d = 0; d < 4; d++) { // four "digits"
        for (let y = 238; y <= 256; y++) { set(215 + d * 18, y, 0); set(216 + d * 18, y, 0); }
      }
    });
  }

  it("finds the bubble, not the room", () => {
    const bubbles = labelBubbles(bubbleScene());
    expect(bubbles.length).toBe(1);
    const b = bubbles[0];
    expect(b.maxx - b.minx).toBeGreaterThan(80);
    expect(b.maxy - b.miny).toBeLessThan(40);
  });

  it("an empty enclosed box (a closet-sized shape) is NOT a bubble", () => {
    const g = makeGray(600, 600, (set) => {
      for (let x = 200; x <= 290; x++) { set(x, 230, 0); set(x, 264, 0); }
      for (let y = 230; y <= 264; y++) { set(200, y, 0); set(290, y, 0); }
    });
    expect(labelBubbles(g).length).toBe(0); // no text ink inside
  });

  it("eraseBubbles wipes the bubble ink so nothing can snap to it", () => {
    const g = bubbleScene();
    expect(lineResp(g, 245, 230.5)).toBeGreaterThan(0.5); // bubble outline is ink
    const e = eraseBubbles(g);
    expect(lineResp(e, 245, 230.5)).toBe(0);              // gone
    expect(lineResp(e, 101.5, 250)).toBeGreaterThan(0.5); // the real wall stays
  });

  it("autoDetectRooms finds exactly the real room once bubbles are erased", () => {
    const clean = autoDetectRooms(bubbleScene());
    expect(clean.length).toBe(1); // the real room — no bubble fake, no severing
  });
});
