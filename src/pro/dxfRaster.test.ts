// CAD (.dxf) → line segments for the Plan Studio's picture.
import { describe, it, expect } from "vitest";
import { dxfSegments, segmentBounds } from "./dxfRaster";

const dxf = (body: string) => ["0", "SECTION", "2", "ENTITIES", body.trim(), "0", "ENDSEC", "0", "EOF"].join("\n");

describe("dxfSegments", () => {
  it("reads LINE entities", () => {
    const segs = dxfSegments(dxf(`
0
LINE
8
WALLS
10
0.0
20
0.0
11
100.0
21
0.0
`));
    expect(segs).toEqual([{ x1: 0, y1: 0, x2: 100, y2: 0 }]);
  });

  it("reads LWPOLYLINE with the closed flag", () => {
    const segs = dxfSegments(dxf(`
0
LWPOLYLINE
90
3
70
1
10
0
20
0
10
50
20
0
10
50
20
30
`));
    expect(segs.length).toBe(3); // two edges + closing edge
    expect(segs[2]).toEqual({ x1: 50, y1: 30, x2: 0, y2: 0 });
  });

  it("reads POLYLINE/VERTEX/SEQEND", () => {
    const segs = dxfSegments(dxf(`
0
POLYLINE
70
0
0
VERTEX
10
0
20
0
0
VERTEX
10
10
20
0
0
VERTEX
10
10
20
10
0
SEQEND
`));
    expect(segs.length).toBe(2);
  });

  it("approximates circles with segments and computes bounds", () => {
    const segs = dxfSegments(dxf(`
0
CIRCLE
10
50
20
50
40
10
`));
    expect(segs.length).toBeGreaterThan(8);
    const b = segmentBounds(segs);
    expect(b.minX).toBeCloseTo(40, 0);
    expect(b.maxX).toBeCloseTo(60, 0);
  });

  it("ignores junk without dying", () => {
    expect(dxfSegments("not a dxf at all")).toEqual([]);
  });
});
