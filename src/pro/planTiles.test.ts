// Tiled reading of dense sheets: the tile layout comes from the printed
// label-bubble size, blank tiles are dropped, and per-tile readings merge
// back into whole-sheet coordinates with overlap dedupe (the Franciscan
// benchmark architecture).
import { describe, it, expect } from "vitest";
import { tileGrid, dropEmptyTiles, tileInkFraction, mergeTileRooms, TILE_RENDER_EDGE, type TileBox } from "./planTiles";
import { grayFromPixels } from "./planSnap";
import type { AiRoom } from "../bridge/aiPlanImport";

const room = (num: string, poly: number[][], extra?: Partial<AiRoom>): AiRoom => ({
  name: num, roomNumber: num, squareFeet: 0, roomType: "Office", polygon: poly, ...extra
});
const rect = (x0: number, y0: number, x1: number, y1: number) =>
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

describe("tileGrid", () => {
  it("small readable print → one whole-sheet tile", () => {
    expect(tileGrid(2000, 1500, 40)).toEqual([{ x0: 0, y0: 0, x1: 1, y1: 1 }]);
    expect(tileGrid(2000, 1500, null)).toEqual([{ x0: 0, y0: 0, x1: 1, y1: 1 }]);
  });

  it("tiny print on a big sheet → an overlapping grid", () => {
    // the benchmark: ~17px bubbles on a 1910x2576 crop → ~2.6x zoom needed
    const tiles = tileGrid(1910, 2576, 17);
    expect(tiles.length).toBeGreaterThan(4);
    // tiles cover the whole sheet
    expect(Math.min(...tiles.map((t) => t.x0))).toBe(0);
    expect(Math.max(...tiles.map((t) => t.x1))).toBe(1);
    expect(Math.min(...tiles.map((t) => t.y0))).toBe(0);
    expect(Math.max(...tiles.map((t) => t.y1))).toBe(1);
    // neighbouring tiles overlap (a room on a seam is whole in one of them)
    const xs = [...new Set(tiles.map((t) => t.x0))].sort((a, b) => a - b);
    if (xs.length > 1) {
      const first = tiles.find((t) => t.x0 === xs[0])!;
      const second = tiles.find((t) => t.x0 === xs[1])!;
      expect(second.x0).toBeLessThan(first.x1); // they share a band
    }
    // every tile renders at a real zoom-in (covers less than half the sheet)
    for (const t of tiles) {
      expect((t.x1 - t.x0) * 1910).toBeLessThanOrEqual(TILE_RENDER_EDGE / 1.3 + 1);
    }
  });

  it("never zooms past the cap however tiny the print", () => {
    const tiles = tileGrid(2000, 2000, 2);
    // zoom capped at 4 → tile covers >= TILE_RENDER_EDGE/4 source px
    for (const t of tiles) {
      expect((t.x1 - t.x0) * 2000).toBeGreaterThanOrEqual(TILE_RENDER_EDGE / 4 - 1);
    }
  });
});

describe("dropEmptyTiles", () => {
  it("drops blank margin tiles, keeps inked ones", () => {
    // 200x100 gray: ink only on the left half
    const px = new Uint8ClampedArray(200 * 100 * 4).fill(255);
    for (let y = 10; y < 90; y++) {
      for (let x = 10; x < 90; x += 3) {
        const i = (y * 200 + x) * 4;
        px[i] = px[i + 1] = px[i + 2] = 0;
      }
    }
    const g = grayFromPixels(px, 200, 100);
    const left: TileBox = { x0: 0, y0: 0, x1: 0.5, y1: 1 };
    const right: TileBox = { x0: 0.5, y0: 0, x1: 1, y1: 1 };
    expect(tileInkFraction(g, left)).toBeGreaterThan(0.05);
    expect(tileInkFraction(g, right)).toBe(0);
    expect(dropEmptyTiles(g, [left, right])).toEqual([left]);
  });
});

describe("mergeTileRooms", () => {
  const W = 2000, H = 1000;

  it("maps tile-local polygons into whole-sheet coordinates", () => {
    const tile: TileBox = { x0: 0.5, y0: 0, x1: 1, y1: 0.5 };
    const merged = mergeTileRooms([{ box: tile, rooms: [room("2101", rect(0.2, 0.2, 0.6, 0.8))] }], W, H);
    expect(merged.length).toBe(1);
    const xs = merged[0].polygon.map((p) => p[0]);
    const ys = merged[0].polygon.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(0.5 + 0.2 * 0.5, 2);
    expect(Math.max(...ys)).toBeCloseTo(0 + 0.8 * 0.5, 2);
  });

  it("the same room read in two overlapping tiles survives ONCE", () => {
    // two tiles overlapping in the middle; the same room visible in both
    const a: TileBox = { x0: 0, y0: 0, x1: 0.6, y1: 1 };
    const b: TileBox = { x0: 0.4, y0: 0, x1: 1, y1: 1 };
    // room global ≈ x 0.45..0.55, y 0.4..0.6
    const inA = rect((0.45 - 0) / 0.6, 0.4, (0.55 - 0) / 0.6, 0.6);
    const inB = rect((0.45 - 0.4) / 0.6, 0.4, (0.55 - 0.4) / 0.6, 0.6);
    const merged = mergeTileRooms([
      { box: a, rooms: [room("2107", inA)] },
      { box: b, rooms: [room("2107", inB)] }
    ], W, H);
    expect(merged.filter((r) => r.roomNumber === "2107").length).toBe(1);
  });

  it("a reading clipped by its tile edge loses to the whole one", () => {
    const a: TileBox = { x0: 0, y0: 0, x1: 0.6, y1: 1 };
    const b: TileBox = { x0: 0.4, y0: 0, x1: 1, y1: 1 };
    // the room really spans global 0.55..0.72 — tile a only sees it to 0.6
    const clippedInA = rect((0.55) / 0.6, 0.3, 1.0, 0.7);        // hugs a's right edge
    const wholeInB = rect((0.55 - 0.4) / 0.6, 0.3, (0.72 - 0.4) / 0.6, 0.7);
    const merged = mergeTileRooms([
      { box: a, rooms: [room("", clippedInA, { name: "Storage" })] },
      { box: b, rooms: [room("", wholeInB, { name: "Storage" })] }
    ], W, H);
    expect(merged.length).toBe(1);
    // the surviving polygon reaches the room's true right edge (~0.72)
    expect(Math.max(...merged[0].polygon.map((p) => p[0]))).toBeGreaterThan(0.7);
  });

  it("same-number fragments split by a seam are unioned", () => {
    // a corridor spanning both tiles: each sees half, halves overlap slightly
    const a: TileBox = { x0: 0, y0: 0, x1: 0.6, y1: 1 };
    const b: TileBox = { x0: 0.4, y0: 0, x1: 1, y1: 1 };
    const leftHalf = rect(0.1 / 0.6, 0.45, (0.55) / 0.6, 0.55);   // global 0.1..0.55
    const rightHalf = rect((0.45 - 0.4) / 0.6, 0.45, (0.9 - 0.4) / 0.6, 0.55); // global 0.45..0.9
    const merged = mergeTileRooms([
      { box: a, rooms: [room("EW2C", leftHalf)] },
      { box: b, rooms: [room("EW2C", rightHalf)] }
    ], W, H);
    const corridors = merged.filter((r) => r.roomNumber === "EW2C");
    expect(corridors.length).toBe(1);
    const xs = corridors[0].polygon.map((p) => p[0]);
    expect(Math.min(...xs)).toBeLessThan(0.15);   // spans the whole corridor
    expect(Math.max(...xs)).toBeGreaterThan(0.85);
  });

  it("different rooms that merely sit in the overlap band both survive", () => {
    const a: TileBox = { x0: 0, y0: 0, x1: 0.6, y1: 1 };
    const b: TileBox = { x0: 0.4, y0: 0, x1: 1, y1: 1 };
    const r1 = rect(0.45 / 0.6, 0.1, 0.55 / 0.6, 0.3);
    const r2 = rect((0.45 - 0.4) / 0.6, 0.5, (0.55 - 0.4) / 0.6, 0.7);
    const merged = mergeTileRooms([
      { box: a, rooms: [room("2101", r1)] },
      { box: b, rooms: [room("2103", r2)] }
    ], W, H);
    expect(merged.length).toBe(2);
  });

  it("a stated square footage survives the union", () => {
    const a: TileBox = { x0: 0, y0: 0, x1: 0.6, y1: 1 };
    const b: TileBox = { x0: 0.4, y0: 0, x1: 1, y1: 1 };
    const inA = rect(0.45 / 0.6, 0.4, 0.55 / 0.6, 0.6);
    const inB = rect((0.45 - 0.4) / 0.6, 0.4, (0.55 - 0.4) / 0.6, 0.6);
    const merged = mergeTileRooms([
      { box: a, rooms: [room("2107", inA, { squareFeet: 0 })] },
      { box: b, rooms: [room("2107", inB, { squareFeet: 240 })] }
    ], W, H);
    expect(merged[0].squareFeet).toBe(240);
  });
});

describe("wall-trace ribbons and unnumbered shapes (Josh's staging findings)", () => {
  const W = 2000, H = 1000;

  it("a wall-hugging ribbon is rejected outright", () => {
    // a "corridor" traced along a wall line: 0.5 long, ~8px wide at 2000px
    const ribbon = rect(0.2, 0.5, 0.7, 0.504);
    const merged = mergeTileRooms(
      [{ box: { x0: 0, y0: 0, x1: 1, y1: 1 }, rooms: [room("CW2A", ribbon)] }], W, H);
    expect(merged.length).toBe(0);
  });

  it("a real corridor (wall-to-wall floor) survives", () => {
    // 0.5 long, 40px wide — a genuine corridor
    const corridor = rect(0.2, 0.5, 0.7, 0.54);
    const merged = mergeTileRooms(
      [{ box: { x0: 0, y0: 0, x1: 1, y1: 1 }, rooms: [room("CW2A", corridor)] }], W, H);
    expect(merged.length).toBe(1);
  });

  it("an UNNUMBERED corridor never displaces numbered rooms it covers", () => {
    const corridor = { ...room("", rect(0.1, 0.4, 0.9, 0.6)), name: "Corridor", roomType: "Corridor" };
    const r1 = room("2205", rect(0.2, 0.42, 0.3, 0.58));
    const r2 = room("2207", rect(0.35, 0.42, 0.45, 0.58));
    const merged = mergeTileRooms([
      { box: { x0: 0, y0: 0, x1: 1, y1: 1 }, rooms: [corridor] },
      { box: { x0: 0, y0: 0, x1: 0.6, y1: 1 }, rooms: [room("2205", rect(0.2 / 0.6, 0.42, 0.3 / 0.6, 0.58)), room("2207", rect(0.35 / 0.6, 0.42, 0.45 / 0.6, 0.58))] }
    ], W, H);
    const nums = merged.map((r) => r.roomNumber).sort();
    expect(nums).toContain("2205");
    expect(nums).toContain("2207");
  });

  it("the corridor pass unions with same-tag tile fragments", () => {
    const a = { x0: 0, y0: 0, x1: 0.6, y1: 1 };
    const frag = rect(0.2 / 0.6, 0.45, 0.55 / 0.6, 0.55);       // global 0.2..0.55
    const whole = rect(0.2, 0.45, 0.9, 0.55);                    // the full corridor
    const merged = mergeTileRooms([
      { box: a, rooms: [room("EW2C", frag, { roomType: "Corridor" })] },
      { box: { x0: 0, y0: 0, x1: 1, y1: 1 }, rooms: [room("EW2C", whole, { roomType: "Corridor" })] }
    ], W, H);
    expect(merged.filter((r) => r.roomNumber === "EW2C").length).toBe(1);
  });
});
