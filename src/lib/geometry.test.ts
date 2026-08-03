import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDXF, parseStatsCSV } from "./parsers";
import {
  extractRoomFaces, deriveShapes, pointInShape, intersectionAreaSqFt,
  shapeAreaSqFt, snapToWalls
} from "./geometry";

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

describe("geometry pipeline: sealed walls → interior faces", () => {
  const faces = extractRoomFaces(dxf);

  it("extracts exactly the 4 room faces (door gaps sealed, no merged rooms)", () => {
    expect(faces.length).toBe(4);
  });

  it("each face area matches the CSV ground truth within 3%", () => {
    // sort both by area to pair faces with rooms
    const faceAreas = faces.map((f) => f.areaSqFt).sort((a, b) => a - b);
    const csvAreas = rooms.map((r) => r.cleanableSqFt).sort((a, b) => a - b);
    for (let i = 0; i < 4; i++) {
      const rel = Math.abs(faceAreas[i] - csvAreas[i]) / csvAreas[i];
      expect(rel, `face ${i}: ${faceAreas[i].toFixed(2)} vs CSV ${csvAreas[i]}`).toBeLessThan(0.03);
    }
  });

  it("faces do not overlap each other", () => {
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        expect(intersectionAreaSqFt(faces[i].outer, faces[j].outer)).toBeLessThan(0.05);
      }
    }
  });
});

describe("deriveShapes: label matching + coverage guarantee", () => {
  const result = deriveShapes(dxf, rooms);

  it("every labeled fixture room gets a derived, wall-tight shape", () => {
    expect(Object.keys(result.shapes).length).toBe(4);
    expect(result.unresolved.length).toBe(0);
    for (const r of rooms) {
      const s = result.shapes[r.id];
      expect(s, r.name).toBeTruthy();
      expect(s.source).toBe("derived");
    }
  });

  it("each room's own label lies inside its shape, and only its shape", () => {
    for (const r of rooms) {
      expect(pointInShape(r.mapX!, r.mapY!, result.shapes[r.id])).toBe(true);
      for (const other of rooms) {
        if (other.id === r.id) continue;
        expect(pointInShape(other.mapX!, other.mapY!, result.shapes[r.id])).toBe(false);
      }
    }
  });

  it("assigned shape areas match each room's CSV square footage within 3%", () => {
    for (const r of rooms) {
      const s = result.shapes[r.id];
      const rel = Math.abs(s.areaSqFt - r.cleanableSqFt) / r.cleanableSqFt;
      expect(rel, `${r.name}: shape ${s.areaSqFt.toFixed(2)} vs CSV ${r.cleanableSqFt}`).toBeLessThan(0.03);
    }
    // and the stored area agrees with the polygon itself
    for (const r of rooms) {
      const s = result.shapes[r.id];
      expect(Math.abs(shapeAreaSqFt(s) - s.areaSqFt)).toBeLessThan(1);
    }
  });

  it("rooms whose label matches nothing go to the unresolved list (trace tool)", () => {
    const weird = deriveShapes(dxf, [
      ...rooms,
      { id: "ghost", name: "Ghost", mapX: -40, mapY: -40, cleanableSqFt: 100 },
      { id: "nolabel", name: "NoLabel", mapX: null, mapY: null, cleanableSqFt: 80 }
    ]);
    expect(weird.unresolved).toContain("ghost");
    expect(weird.unresolved).toContain("nolabel");
    expect(Object.keys(weird.shapes).length).toBe(4); // real rooms unaffected
  });

  it("two labels in one face → neither room guesses (both go to trace)", () => {
    const twin = rooms.map((r) => ({ ...r }));
    // move the office label into the corridor face
    const office = twin.find((r) => r.name === "Office 102")!;
    const corridor = twin.find((r) => r.name === "Corridor A")!;
    office.mapX = corridor.mapX! - 2;
    office.mapY = corridor.mapY;
    const res = deriveShapes(dxf, twin);
    expect(res.unresolved).toContain(office.id);
    expect(res.unresolved).toContain(corridor.id);
  });
});

describe("trace-tool snapping helper", () => {
  it("snaps a nearby point onto the closest wall edge", () => {
    // fixture south wall runs along y=0.5 (interior side)
    const snapped = snapToWalls(dxf, 10, 0.62, 0.5);
    expect(snapped).toBeTruthy();
    expect(Math.abs(snapped![1] - 0.5)).toBeLessThan(0.01);
  });
  it("returns null when nothing is within range", () => {
    expect(snapToWalls(dxf, 200, 200, 1)).toBeNull();
  });
});
