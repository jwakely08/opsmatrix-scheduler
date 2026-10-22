import { describe, expect, it } from "vitest";
import { joinOutlines } from "./outlineJoin";
import { pointIn } from "./classicStore";

type P = { x: number; y: number };
const rect = (x0: number, y0: number, x1: number, y1: number): P[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const area = (pts: P[]) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  return Math.abs(a / 2);
};
const sorted = (pts: P[]) => pts.map((p) => `${p.x},${p.y}`).sort();
const joined = (r: ReturnType<typeof joinOutlines>) => {
  if (!("pts" in r)) throw new Error("refused: " + r.refused);
  return r.pts;
};

describe("joinOutlines — rooms right next to each other become one outline", () => {
  it("two rooms sharing an edge: one rectangle, corners exact", () => {
    const pts = joined(joinOutlines([rect(0, 0, 10, 10), rect(10, 0, 20, 10)], { unitsPerFt: 1 }));
    expect(sorted(pts)).toEqual(sorted(rect(0, 0, 20, 10)));
  });

  it("two CAD rooms a wall apart: the wall between them is filled, the outside stays true", () => {
    const pts = joined(joinOutlines([rect(0, 0, 10, 10), rect(10.5, 0, 20.5, 10)], { unitsPerFt: 1 }));
    expect(sorted(pts)).toEqual(sorted(rect(0, 0, 20.5, 10)));
    expect(area(pts)).toBeCloseTo(205, 5);
  });

  it("rooms stacked a wall apart, in plan pixels (4.7 px per foot)", () => {
    const s = 4.7;
    const a = rect(100, 100, 100 + 12 * s, 100 + 10 * s);
    const b = rect(100, 100 + 10.4 * s, 100 + 12 * s, 100 + 20.4 * s);
    const pts = joined(joinOutlines([a, b], { unitsPerFt: s }));
    expect(pts).toHaveLength(4);
    expect(area(pts)).toBeCloseTo(12 * 20.4 * s * s, 0);
  });

  it("offset neighbours: the wall is filled only where they face each other", () => {
    const pts = joined(joinOutlines([rect(0, 0, 10, 10), rect(10.5, 4, 16, 20)], { unitsPerFt: 1 }));
    expect(pointIn(pts, 5, 5)).toBe(true);
    expect(pointIn(pts, 13, 15)).toBe(true);
    expect(pointIn(pts, 10.25, 7)).toBe(true); // the wall between them
    expect(pointIn(pts, 13, 1)).toBe(false);   // never floor that isn't there
    expect(pointIn(pts, 5, 15)).toBe(false);
    expect(area(pts)).toBeCloseTo(100 + 5.5 * 16 + 0.5 * 6, 0);
  });

  it("an L of three corridor pieces", () => {
    const pts = joined(joinOutlines([rect(0, 0, 30, 6), rect(30.4, 0, 36, 6), rect(30.4, 6.4, 36, 40)], { unitsPerFt: 1 }));
    expect(pointIn(pts, 33, 3)).toBe(true);
    expect(pointIn(pts, 33, 30)).toBe(true);
    expect(pointIn(pts, 15, 3)).toBe(true);
    expect(pointIn(pts, 15, 20)).toBe(false);
  });

  it("refuses rooms that aren't next to each other", () => {
    expect(joinOutlines([rect(0, 0, 10, 10), rect(16, 0, 26, 10)], { unitsPerFt: 1 })).toEqual({ refused: "apart" });
    // touching only at a corner is not sharing a wall
    expect(joinOutlines([rect(0, 0, 10, 10), rect(10.5, 10.5, 20, 20)], { unitsPerFt: 1 })).toEqual({ refused: "apart" });
  });

  it("refuses when another room sits between them", () => {
    const closet = rect(10.2, 0, 11.2, 10);
    expect(joinOutlines([rect(0, 0, 10, 10), rect(11.4, 0, 20, 10)], { unitsPerFt: 1, others: [closet] }))
      .toEqual({ refused: "between" });
  });

  it("a neighbour's outline overlapping the wall a little doesn't stop the join", () => {
    // a wall-thin strip drawn down the wall line, far longer than the wall these rooms share
    const strip = rect(10.1, -20, 10.4, 30);
    const pts = joined(joinOutlines([rect(0, 0, 10, 10), rect(10.5, 0, 20.5, 10)], { unitsPerFt: 1, others: [strip] }));
    expect(sorted(pts)).toEqual(sorted(rect(0, 0, 20.5, 10)));
  });

  it("a closet in the wall at one end stays out: the rooms join along the rest of the wall", () => {
    const closet = rect(10.05, 7, 10.45, 10);
    const pts = joined(joinOutlines([rect(0, 0, 10, 10), rect(10.5, 0, 20.5, 10)], { unitsPerFt: 1, others: [closet] }));
    expect(pointIn(pts, 10.25, 3)).toBe(true);
    expect(pointIn(pts, 10.25, 8.5)).toBe(false);
  });

  it("a zone drawn around both rooms is not in the way", () => {
    const zone = rect(-5, -5, 30, 20);
    const pts = joined(joinOutlines([rect(0, 0, 10, 10), rect(10.5, 0, 20.5, 10)], { unitsPerFt: 1, others: [zone] }));
    expect(area(pts)).toBeCloseTo(205, 5);
  });

  it("a loop around another room is refused; around nothing, the middle is floor", () => {
    const ring = [rect(0, 0, 30, 5), rect(0, 5, 5, 25), rect(25, 5, 30, 25), rect(0, 25, 30, 30)];
    expect(joinOutlines(ring, { unitsPerFt: 1, others: [rect(6, 6, 24, 24)] })).toEqual({ refused: "around" });
    expect(sorted(joined(joinOutlines(ring, { unitsPerFt: 1 })))).toEqual(sorted(rect(0, 0, 30, 30)));
  });

  it("walls thicker than the limit don't count as next to each other", () => {
    expect(joinOutlines([rect(0, 0, 10, 10), rect(12.5, 0, 22.5, 10)], { unitsPerFt: 1 })).toEqual({ refused: "apart" });
    expect("pts" in joinOutlines([rect(0, 0, 10, 10), rect(12.5, 0, 22.5, 10)], { unitsPerFt: 1, maxWallFt: 3 })).toBe(true);
  });

  it("angled rooms join along their shared wall", () => {
    // two rooms either side of a wall at 30°, a quarter foot apart
    const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
    const rot = (pts: P[]) => pts.map((p) => ({ x: 50 + p.x * c - p.y * s, y: 50 + p.x * s + p.y * c }));
    const pts = joined(joinOutlines([rot(rect(0, 0, 10, 10)), rot(rect(10.25, 0, 20.25, 10))], { unitsPerFt: 1 }));
    expect(area(pts)).toBeGreaterThan(200);
    expect(area(pts)).toBeLessThan(206);
    const mid = rot([{ x: 10.12, y: 5 }])[0];
    expect(pointIn(pts, mid.x, mid.y)).toBe(true);
  });
});
