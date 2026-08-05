import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDXF, parseStatsCSV, decodeDxfText } from "./parsers";

// GROUND TRUTH: Josh's real magicplan exports (read-only).
// Plan: 4 rooms, 653.88 cleanable sq ft (interior), 799.11 gross sq ft.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test-fixtures");
const dxfText = readFileSync(join(FIXTURES, "Test_project_-_1st_Floor.dxf"), "utf8");
const csvText = readFileSync(join(FIXTURES, "Test_project_Statistics.csv"), "utf8");

describe("parseStatsCSV (real export)", () => {
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

  it("reads the real per-room areas (three Bedrooms + Other)", () => {
    const rooms = stats.floors[0].rooms;
    expect(rooms.map((r) => r.name)).toEqual(["Bedroom", "Bedroom", "Other", "Bedroom"]);
    expect(rooms.map((r) => r.areaSqFt)).toEqual([420.25, 141.53, 20.6, 71.84]);
    // per-room areas sum near the plan total (magicplan's own rounding drift)
    const sum = rooms.reduce((s, r) => s + r.areaSqFt, 0);
    expect(Math.abs(sum - 653.88)).toBeLessThan(0.5);
  });

  it("captures per-room detail (doors, windows, ceiling)", () => {
    const first = stats.floors[0].rooms[0];
    expect(first.doorAreaSqFt).toBe(138.5);
    expect(first.windowAreaSqFt).toBe(25.38);
    expect(first.ceilingHeight).not.toBe("");
  });
});

describe("parseDXF (real export)", () => {
  const dxf = parseDXF(dxfText);

  it("extracts the 10 wall strips from layer 'walls'", () => {
    expect(dxf.walls.length).toBe(10);
    for (const w of dxf.walls) expect(w.points.length).toBeGreaterThan(2);
  });

  it("extracts and decodes the 4 room labels (unicode-escaped in the file)", () => {
    expect(dxf.labels.length).toBe(4);
    const texts = dxf.labels.map((l) => l.text);
    expect(texts.filter((t) => t === "Bedroom").length).toBe(3);
    expect(texts).toContain("Other");
  });

  it("extracts all 13 W-* door/window inserts", () => {
    expect(dxf.openings.length).toBe(13);
    for (const o of dxf.openings) expect(o.name.startsWith("W-")).toBe(true);
  });

  it("reports units in feet", () => {
    expect(dxf.units).toBe("ft");
  });
});

describe("decodeDxfText", () => {
  it("decodes \\U+XXXX escapes (as magicplan writes labels)", () => {
    expect(decodeDxfText("\\U+0042\\U+0065\\U+0064")).toBe("Bed");
    expect(decodeDxfText("Caf\\U+00E9")).toBe("Café");
  });
  it("passes plain text through", () => {
    expect(decodeDxfText("Room 101")).toBe("Room 101");
  });
});
