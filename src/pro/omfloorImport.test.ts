import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildCadRooms, cadLooksStructured, parseCad } from "./cadImport";
import { omfloorToDxf, OmfloorError, readOmfloor, type OmFloor } from "./omfloorImport";

const rect = (x: number, y: number, w: number, h: number) => [x, y, x + w, y, x + w, y + h, x, y + h];
const room = (number: string, name: string, sqft: number, outline: number[], label: [number, number] | null = null) =>
  ({ number, name, sqft, outline, label, type: "", id: number || name, layer: "SP", fixtures: {} });

/** a small floor in feet, as the converter saves it */
function floor(): OmFloor {
  return {
    format: "opsmatrix-floor", version: 1,
    site: { account: "Test", building: "Main", floor: "1st Floor" },
    rooms: [
      room("101", "PAT RM", 100, rect(0, 0, 10, 10), [5, 5]),
      room("102", "TLT", 200, rect(10, 0, 20, 10), [20, 5]),
      room("103", "CORR", 200, rect(30, 0, 10, 20), [35, 10]),
      room("104", "EXAM", 95, rect(0, 10, 10.5, 9), [5, 14]), // exactly 94.5 sq ft: on the rounding edge
      room("105", "SUITE", 400, rect(40, 0, 20, 20), [42, 2]), // its tag spot sits inside 106 below
      room("106", "OFFICE", 25, rect(40, 0, 5, 5), [42.5, 2.5]),
      room("", "", 30, rect(0, 30, 5, 6)) // an outline with no tag
    ],
    drawing: [
      { kind: "wall", paths: [[0, 0, 60, 0], [0, 0, 0, 20, 60, 20, 60, 0, 0, 0]] },
      { kind: "door", paths: [[10, 5, 10, 8]] }
    ]
  } as unknown as OmFloor;
}

describe("omfloorToDxf", () => {
  it("is read by the exact-CAD import as exactly the converter's rooms", () => {
    const f = floor();
    const built = buildCadRooms(parseCad(omfloorToDxf(f)));
    const key = (n: string, name: string, sqft: number) => `${n}|${name}|${sqft}`;
    expect(built.rooms.map((r) => key(r.roomNumber, r.roomName, r.sqFt)).sort())
      .toEqual(f.rooms.map((r) => key(r.number, r.name, r.sqft)).sort());
    expect(built.orphanTags).toBe(0);
    expect(built.unlabeled).toBe(1);
    expect(cadLooksStructured(built)).toBe(true);
  });

  it("keeps a room on the half-square-foot edge at its own number either way", () => {
    for (const sqft of [94, 95]) {
      const f = floor();
      f.rooms[3].sqft = sqft;
      const built = buildCadRooms(parseCad(omfloorToDxf(f)));
      expect(built.rooms.find((r) => r.roomNumber === "104")!.sqFt).toBe(sqft);
    }
  });

  it("draws the picture as open lines only (never mistaken for rooms) and writes no loose text", () => {
    const parsed = parseCad(omfloorToDxf(floor()));
    expect(parsed.polys).toHaveLength(7);
    expect(parsed.texts).toHaveLength(0);
    expect(parsed.insunits).toBe(2);
  });
});

describe("readOmfloor", () => {
  const blob = (s: string | Uint8Array<ArrayBuffer>) => new Blob([s]);

  it("opens the converter's gzip file, and plain JSON too", async () => {
    const json = JSON.stringify(floor());
    expect((await readOmfloor(blob(new Uint8Array(gzipSync(json))))).rooms).toHaveLength(7);
    expect((await readOmfloor(blob(json))).rooms).toHaveLength(7);
  });

  it("refuses other files in plain words", async () => {
    await expect(readOmfloor(blob("hello"))).rejects.toThrow(OmfloorError);
    await expect(readOmfloor(blob(JSON.stringify({ format: "other" })))).rejects.toThrow(/isn't an OpsMatrix floor file/);
    await expect(readOmfloor(blob(JSON.stringify({ ...floor(), version: 2 })))).rejects.toThrow(/version 2/);
    const broken = { ...floor(), rooms: [room("1", "X", 10, [0, 0, 1])] };
    await expect(readOmfloor(blob(JSON.stringify(broken)))).rejects.toThrow(/damaged room/);
  });
});
