import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDXF, parseStatsCSV } from "./parsers";
import {
  extractRoomFaces, deriveShapes, deriveShapesAuto, pointInShape, intersectionAreaSqFt,
  shapeAreaSqFt, snapToWalls, matchLabel, mergeShapes, hullClosureStrips, analyzeOpenings
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

describe("deriveShapesAuto — the definition of success", () => {
  it("fixture import auto-derives ALL rooms, areas within 5% of CSV, zero tracing", () => {
    const res = deriveShapesAuto(dxf, rooms);
    expect(res.unresolved).toEqual([]);
    expect(Object.keys(res.shapes).length).toBe(4);
    expect(res.tuning.usedHullClosure).toBe(false);
    for (const r of rooms) {
      const s = res.shapes[r.id];
      const rel = Math.abs(s.areaSqFt - r.cleanableSqFt) / r.cleanableSqFt;
      expect(rel, `${r.name}: ${s.areaSqFt.toFixed(2)} vs CSV ${r.cleanableSqFt}`).toBeLessThan(0.05);
    }
  });

  it("survives real-world name mismatches (case, spacing, truncation)", () => {
    const messyNames = ["PATIENT ROOM 101", "  bathroom   101b ", "Office 10", "corridor a."];
    for (let i = 0; i < rooms.length; i++) {
      const hit = matchLabel(dxf.labels, messyNames[i]);
      expect(hit, messyNames[i]).toBeTruthy();
    }
    expect(matchLabel(dxf.labels, "Cafeteria")).toBeNull();
  });

  it("rescues a room whose label is missing via unique CSV-area match", () => {
    const noBathLabel = {
      ...dxf,
      labels: dxf.labels.filter((l) => l.text !== "Bathroom 101B")
    };
    const roomsNoLabel = rooms.map((r) =>
      r.name === "Bathroom 101B" ? { ...r, mapX: null, mapY: null } : r);
    const res = deriveShapesAuto(noBathLabel, roomsNoLabel);
    const bath = roomsNoLabel.find((r) => r.name === "Bathroom 101B")!;
    expect(res.shapes[bath.id], "bathroom rescued by area").toBeTruthy();
    expect(res.unresolved).toEqual([]);
    const rel = Math.abs(res.shapes[bath.id].areaSqFt - bath.cleanableSqFt) / bath.cleanableSqFt;
    expect(rel).toBeLessThan(0.05);
  });

  it("seals a doorway that has NO door marker (auto-tuned gap healer)", () => {
    const noInsert = {
      ...dxf,
      openings: dxf.openings.filter((o) => o.name !== "W-D4") // PR|BA door unmarked
    };
    const res = deriveShapesAuto(noInsert, rooms);
    expect(res.unresolved).toEqual([]);
    expect(Object.keys(res.shapes).length).toBe(4);
    // PR and BA must still be separate rooms
    const pr = rooms.find((r) => r.name === "Patient Room 101")!;
    const ba = rooms.find((r) => r.name === "Bathroom 101B")!;
    expect(intersectionAreaSqFt(res.shapes[pr.id].outer, res.shapes[ba.id].outer)).toBeLessThan(0.05);
  });

  it("closes an open scan side with the hull and still finds every room", () => {
    // drop the east exterior wall entirely — office + corridor now open-sided
    const eastless = {
      ...dxf,
      walls: dxf.walls.filter((w) => {
        const xs = w.points.map((p) => p[0]);
        return !(Math.min(...xs) > 28.7 && Math.max(...xs) < 29.3);
      })
    };
    expect(eastless.walls.length).toBe(dxf.walls.length - 1);
    const res = deriveShapesAuto(eastless, rooms);
    expect(res.unresolved).toEqual([]);
    expect(res.tuning.usedHullClosure).toBe(true);
    // closure is conservative: areas may grow slightly, never wildly
    for (const r of rooms) {
      const rel = Math.abs(res.shapes[r.id].areaSqFt - r.cleanableSqFt) / r.cleanableSqFt;
      expect(rel, r.name).toBeLessThan(0.12);
    }
  });
});

describe("room merging", () => {
  const auto = deriveShapesAuto(dxf, rooms);
  const pr = rooms.find((r) => r.name === "Patient Room 101")!;
  const ba = rooms.find((r) => r.name === "Bathroom 101B")!;

  it("merges two adjacent rooms through their doorway into ONE polygon", () => {
    const merged = mergeShapes(dxf, [auto.shapes[pr.id], auto.shapes[ba.id]]);
    expect(merged).toBeTruthy();
    // both labels inside the merged shape
    expect(pointInShape(pr.mapX!, pr.mapY!, merged!)).toBe(true);
    expect(pointInShape(ba.mapX!, ba.mapY!, merged!)).toBe(true);
    // area ≈ sum of parts (+ the small doorway passage)
    const sum = auto.shapes[pr.id].areaSqFt + auto.shapes[ba.id].areaSqFt;
    expect(merged!.areaSqFt).toBeGreaterThan(sum - 1);
    expect(merged!.areaSqFt).toBeLessThan(sum + 10);
  });

  it("refuses to merge rooms with no connecting doorway (stays honest)", () => {
    const office = rooms.find((r) => r.name === "Office 102")!;
    // PR and Office share no door — bridging must fail, caller keeps them apart
    const merged = mergeShapes(dxf, [auto.shapes[pr.id], auto.shapes[office.id]]);
    expect(merged).toBeNull();
  });
});

describe("openings analysis (door glyphs)", () => {
  it("classifies the 4 doors as gaps with span/orientation and 2 windows as solid", () => {
    const infos = analyzeOpenings(dxf);
    expect(infos.length).toBe(6);
    const doors = infos.filter((i) => i.isGap);
    const windows = infos.filter((i) => !i.isGap);
    expect(doors.length).toBe(4);
    expect(windows.length).toBe(2);
    for (const d of doors) {
      expect(d.span).toBeGreaterThan(2.5);
      expect(d.span).toBeLessThan(3.5);
      expect(d.quad!.length).toBe(4);
    }
    // the PR|BA door runs vertically: wall direction is along y
    const vertical = doors.find((d) => Math.abs(d.u[1]) > 0.9);
    expect(vertical).toBeTruthy();
  });

  it("hull closure adds nothing on a fully closed building", () => {
    expect(hullClosureStrips(dxf).length).toBe(0);
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
