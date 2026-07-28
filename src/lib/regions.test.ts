import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDXF, parseStatsCSV } from "./parsers";
import { deriveRoomRegions, pointInPolygon, polygonArea, polygonCentroid } from "./regions";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test-fixtures");
const dxf = parseDXF(readFileSync(join(FIXTURES, "Test_project_-_1st_Floor.dxf"), "utf8"));
const stats = parseStatsCSV(readFileSync(join(FIXTURES, "Test_project_statistics.csv"), "utf8"));

const rooms = stats.floors[0].rooms.map((rm, i) => {
  const label = dxf.labels.find((l) => l.text.toLowerCase().trim() === rm.name.toLowerCase().trim());
  return {
    id: "r" + i,
    name: rm.name,
    mapX: label ? label.x : null,
    mapY: label ? label.y : null,
    cleanableSqFt: rm.areaSqFt
  };
});

describe("room region derivation (fixtures sanity)", () => {
  const regions = deriveRoomRegions(dxf, rooms);

  it("derives a clickable shape for every labeled room", () => {
    expect(regions.size).toBe(4);
    for (const r of rooms) {
      const region = regions.get(r.id)!;
      expect(region).toBeTruthy();
      expect(region.polygon.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("each room's label point sits inside its own shape", () => {
    for (const r of rooms) {
      const region = regions.get(r.id)!;
      expect(pointInPolygon(r.mapX!, r.mapY!, region.polygon)).toBe(true);
    }
  });

  it("shapes do not contain other rooms' labels (fills did not merge)", () => {
    for (const r of rooms) {
      const region = regions.get(r.id)!;
      for (const other of rooms) {
        if (other.id === r.id) continue;
        expect(pointInPolygon(other.mapX!, other.mapY!, region.polygon)).toBe(false);
      }
    }
  });

  it("flood-derived shape areas are in the right ballpark of the CSV sq ft", () => {
    for (const r of rooms) {
      const region = regions.get(r.id)!;
      if (region.method !== "flood") continue;
      const area = polygonArea(region.polygon);
      // walls are thickened to close door gaps, so shapes come out a bit
      // smaller than the true interior — allow a wide but meaningful band
      expect(area).toBeGreaterThan(r.cleanableSqFt * 0.4);
      expect(area).toBeLessThan(r.cleanableSqFt * 1.6);
    }
  });

  it("centroids land inside their shapes (labels render sensibly)", () => {
    for (const r of rooms) {
      const region = regions.get(r.id)!;
      const [cx, cy] = polygonCentroid(region.polygon);
      expect(pointInPolygon(cx, cy, region.polygon)).toBe(true);
    }
  });

  it("a room with no label gets no shape; an escaped fill falls back to a rect", () => {
    const weird = deriveRoomRegions(dxf, [
      { id: "nolabel", mapX: null, mapY: null, cleanableSqFt: 100 },
      { id: "outside", mapX: -50, mapY: -50, cleanableSqFt: 100 } // seed outside the building
    ]);
    expect(weird.has("nolabel")).toBe(false);
    const outside = weird.get("outside");
    expect(outside).toBeTruthy();
    expect(outside!.method).toBe("rect");
  });
});
