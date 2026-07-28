import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDXF, parseStatsCSV, decodeDxfText } from "./parsers";

// Ground truth documented for the magicplan test exports:
// 4 rooms, 653.88 cleanable sq ft (interior), 799.11 gross sq ft (with walls).
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test-fixtures");
const dxfText = readFileSync(join(FIXTURES, "Test_project_-_1st_Floor.dxf"), "utf8");
const csvText = readFileSync(join(FIXTURES, "Test_project_statistics.csv"), "utf8");

describe("parseStatsCSV", () => {
  const stats = parseStatsCSV(csvText);

  it("finds exactly 4 rooms", () => {
    const rooms = stats.floors.reduce((n, f) => n + f.rooms.length, 0);
    expect(rooms).toBe(4);
    expect(stats.roomCount).toBe(4);
  });

  it("reads cleanable (interior) total 653.88 — the working number", () => {
    expect(stats.cleanableSqFt).toBe(653.88);
    expect(stats.totalAreaSqFt).toBe(653.88);
  });

  it("reads gross 799.11 as reference", () => {
    expect(stats.grossSqFt).toBe(799.11);
  });

  it("per-room interior areas sum to the cleanable total", () => {
    const sum = stats.floors.reduce(
      (s, f) => s + f.rooms.reduce((a, r) => a + r.areaSqFt, 0), 0);
    expect(Number(sum.toFixed(2))).toBe(653.88);
  });

  it("captures per-room detail (perimeter, doors, windows, ceiling)", () => {
    const first = stats.floors[0].rooms[0];
    expect(first.name).toBe("Patient Room 101");
    expect(first.ceilingHeight).not.toBe("");
    expect(first.doorAreaSqFt).toBeGreaterThan(0);
  });
});

describe("parseDXF", () => {
  const dxf = parseDXF(dxfText);

  it("extracts wall polylines from layer 'walls'", () => {
    expect(dxf.walls.length).toBeGreaterThan(0);
    for (const w of dxf.walls) expect(w.points.length).toBeGreaterThan(2);
  });

  it("extracts 4 room labels", () => {
    expect(dxf.labels.length).toBe(4);
    expect(dxf.labels.map((l) => l.text)).toContain("Corridor A");
  });

  it("extracts W-* door/window openings", () => {
    expect(dxf.openings.length).toBe(6);
    for (const o of dxf.openings) expect(o.name.startsWith("W-")).toBe(true);
  });

  it("reports units in feet", () => {
    expect(dxf.units).toBe("ft");
  });
});

describe("decodeDxfText", () => {
  it("decodes \\U+XXXX escapes", () => {
    expect(decodeDxfText("Caf\\U+00E9")).toBe("Café");
  });
  it("passes plain text through", () => {
    expect(decodeDxfText("Room 101")).toBe("Room 101");
  });
});
