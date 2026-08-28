// Calibrate-with-Max: 1–3 known rooms set the scale, every other room's
// square footage falls out of its own drawn area.
import { describe, it, expect } from "vitest";
import { pixelArea, calibrateFromKnownRooms } from "./planCalibrate";

const sq = (x: number, y: number, w: number, h: number) => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }
];

describe("pixelArea", () => {
  it("shoelace, any winding", () => {
    expect(pixelArea(sq(0, 0, 10, 20))).toBe(200);
    expect(pixelArea([...sq(0, 0, 10, 20)].reverse())).toBe(200);
    expect(pixelArea(undefined)).toBe(0);
    expect(pixelArea([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0);
  });
});

describe("calibrateFromKnownRooms", () => {
  // 10 px = 1 ft → pxPerFt 10; a 100×200 px room is 10×20 ft = 200 sq ft
  const rooms = [
    { id: "a", visualPts: sq(0, 0, 100, 200) },     // the KNOWN room: 200 sq ft
    { id: "b", visualPts: sq(300, 0, 150, 100) },   // 15×10 ft = 150 sq ft
    { id: "c", visualPts: sq(0, 300, 50, 50) },     // 5×5 ft = 25 sq ft
    { id: "d" }                                     // no geometry — left alone
  ];

  it("one anchor scales the whole plan", () => {
    const r = calibrateFromKnownRooms(rooms, [{ id: "a", sqft: 200 }])!;
    expect(r.pxPerFt).toBeCloseTo(10, 5);
    expect(r.sqftById.get("a")).toBe(200);   // the typed number, exactly
    expect(r.sqftById.get("b")).toBe(150);
    expect(r.sqftById.get("c")).toBe(25);
    expect(r.sqftById.has("d")).toBe(false); // nothing honest to compute
    expect(r.applied).toBe(3);
  });

  it("several anchors take the median, so one bad guess can't skew it", () => {
    const r = calibrateFromKnownRooms(rooms, [
      { id: "a", sqft: 200 },  // ratio 10
      { id: "b", sqft: 150 },  // ratio 10
      { id: "c", sqft: 100 }   // manager mis-guessed (true 25) → ratio 5
    ])!;
    expect(r.pxPerFt).toBeCloseTo(10, 5);
    // anchors keep what was typed; everyone else follows the median scale
    expect(r.sqftById.get("c")).toBe(100);
  });

  it("returns null when no anchor is usable", () => {
    expect(calibrateFromKnownRooms(rooms, [])).toBeNull();
    expect(calibrateFromKnownRooms(rooms, [{ id: "d", sqft: 100 }])).toBeNull();
    expect(calibrateFromKnownRooms(rooms, [{ id: "a", sqft: 0 }])).toBeNull();
  });
});
