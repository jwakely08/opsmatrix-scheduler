import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDXF, parseStatsCSV } from "./parsers";
import {
  extractRoomFaces, deriveShapes, deriveShapesAuto, pointInShape, intersectionAreaSqFt,
  shapeAreaSqFt, snapToWalls, matchLabel, mergeShapes, analyzeOpenings, polygonBounds
} from "./geometry";

// GROUND TRUTH: Josh's real magicplan exports (read-only). Everything below is
// asserted against the numbers magicplan itself measured for this scan:
// 4 rooms — Bedroom 420.25 / Bedroom 141.53 / Other 20.60 / Bedroom 71.84 ft².
// Three rooms share the name "Bedroom" — assignment must survive duplicates.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test-fixtures");
const dxf = parseDXF(readFileSync(join(FIXTURES, "Test_project_-_1st_Floor.dxf"), "utf8"));
const stats = parseStatsCSV(readFileSync(join(FIXTURES, "Test_project_Statistics.csv"), "utf8"));

const rooms = stats.floors[0].rooms.map((rm, i) => ({
  id: "r" + i,
  name: rm.name,
  mapX: null as number | null,
  mapY: null as number | null,
  cleanableSqFt: rm.areaSqFt
}));

// Tolerance: within 5% of the CSV area, or within 3 sq ft absolute. The
// absolute floor exists because magicplan's per-room area includes the floor
// under doorway thresholds, which wall-tight faces exclude — on a 20 sq ft
// closet with three doorways that convention difference dominates the %.
function areaOk(shape: number, csv: number): boolean {
  return Math.abs(shape - csv) / csv < 0.05 || Math.abs(shape - csv) < 3.0;
}

describe("REAL SCAN — the definition of success", () => {
  const auto = deriveShapesAuto(dxf, rooms);

  it("auto-derives ALL rooms with zero manual tracing", () => {
    expect(auto.unresolved).toEqual([]);
    expect(Object.keys(auto.shapes).length).toBe(rooms.length);
    expect(auto.tuning.usedHullClosure).toBe(false);
  });

  it("every shape area agrees with magicplan's own measurement", () => {
    for (const r of rooms) {
      const s = auto.shapes[r.id];
      expect(areaOk(s.areaSqFt, r.cleanableSqFt),
        `${r.id} ${r.name}: shape ${s.areaSqFt.toFixed(2)} vs CSV ${r.cleanableSqFt}`).toBe(true);
    }
  });

  it("duplicate room names resolve one-to-one by area agreement", () => {
    // the three Bedrooms must land on three DIFFERENT faces, each nearest
    // its own CSV area — not all on the first "Bedroom" label
    const areas = rooms.map((r) => auto.shapes[r.id].areaSqFt);
    expect(new Set(areas.map((a) => a.toFixed(1))).size).toBe(rooms.length);
  });

  it("shapes do not overlap", () => {
    const ids = Object.keys(auto.shapes);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        expect(intersectionAreaSqFt(auto.shapes[ids[i]].outer, auto.shapes[ids[j]].outer)).toBeLessThan(0.05);
      }
    }
  });

  it("stored areas agree with their own polygons", () => {
    for (const r of rooms) {
      const s = auto.shapes[r.id];
      expect(Math.abs(shapeAreaSqFt(s) - s.areaSqFt)).toBeLessThan(1);
    }
  });

  it("no auto-tuning gymnastics needed: faces come out at the gentlest healing", () => {
    expect(auto.tuning.healTolFt).toBeLessThanOrEqual(1.2);
  });
});

describe("face extraction on the real walls", () => {
  const faces = extractRoomFaces(dxf);

  it("extracts one enclosed face per room at default tolerances", () => {
    expect(faces.length).toBe(rooms.length);
  });

  it("face areas pair with the CSV rooms", () => {
    const faceAreas = faces.map((f) => f.areaSqFt).sort((a, b) => a - b);
    const csvAreas = rooms.map((r) => r.cleanableSqFt).sort((a, b) => a - b);
    for (let i = 0; i < csvAreas.length; i++) {
      expect(areaOk(faceAreas[i], csvAreas[i]),
        `face ${faceAreas[i].toFixed(2)} vs CSV ${csvAreas[i]}`).toBe(true);
    }
  });
});

describe("openings analysis on the real scan", () => {
  it("finds a plausible gap at every wall opening (doors AND cut window bands)", () => {
    const infos = analyzeOpenings(dxf);
    expect(infos.length).toBe(dxf.openings.length);
    for (const info of infos.filter((i) => i.isGap)) {
      expect(info.span, info.name).toBeGreaterThan(1.2);
      expect(info.span, info.name).toBeLessThan(6.0);
      expect(info.quad!.length).toBe(4);
    }
    // the 3' 4 1/2" Opening between the big Bedroom and the closet — the one
    // the old flanking-edge heuristic misread as solid wall — must be a gap
    const w00 = infos.find((i) => i.name === "W-0-0")!;
    expect(w00.isGap).toBe(true);
    expect(Math.abs(w00.span - 3.375)).toBeLessThan(0.35);
  });
});

describe("robustness against scan defects (real geometry, surgically damaged)", () => {
  it("fuzzy label matching survives case/spacing/truncation", () => {
    expect(matchLabel(dxf.labels, "BEDROOM")).toBeTruthy();
    expect(matchLabel(dxf.labels, "  other ")).toBeTruthy();
    expect(matchLabel(dxf.labels, "Bedroo")).toBeTruthy();
    expect(matchLabel(dxf.labels, "Cafeteria")).toBeNull();
  });

  it("a room whose label is missing is rescued by unique CSV-area match", () => {
    // drop the small bedroom's label (the only 71.8-ish face keeps no label)
    const small = rooms.find((r) => r.cleanableSqFt === 71.84)!;
    const auto0 = deriveShapesAuto(dxf, rooms);
    const smallShape = auto0.shapes[small.id];
    const labelless = {
      ...dxf,
      labels: dxf.labels.filter((l) => !pointInShape(l.x, l.y, smallShape))
    };
    const res = deriveShapesAuto(labelless, rooms);
    expect(res.shapes[small.id], "small bedroom rescued by area").toBeTruthy();
    expect(areaOk(res.shapes[small.id].areaSqFt, small.cleanableSqFt)).toBe(true);
  });

  it("rooms that match nothing stay honestly unresolved (no fabrication)", () => {
    const res = deriveShapes(dxf, [
      ...rooms,
      { id: "ghost", name: "Cafeteria", mapX: null, mapY: null, cleanableSqFt: 999 }
    ]);
    expect(res.unresolved).toContain("ghost");
  });

  it("an unmarked doorway (insert deleted) is healed by the auto-tuned sweep", () => {
    // remove the closet's north door marker; its gap must still get sealed
    const damaged = { ...dxf, openings: dxf.openings.filter((o) => o.name !== "W-2-0") };
    const res = deriveShapesAuto(damaged, rooms);
    expect(res.unresolved).toEqual([]);
    for (const r of rooms) {
      expect(areaOk(res.shapes[r.id].areaSqFt, r.cleanableSqFt),
        `${r.name}: ${res.shapes[r.id].areaSqFt.toFixed(1)} vs ${r.cleanableSqFt}`).toBe(true);
    }
  });
});

describe("room merging on the real scan", () => {
  const auto = deriveShapesAuto(dxf, rooms);

  // find a door-connected pair programmatically (no hand-picked coordinates)
  function connectedPair(): [string, string] | null {
    const ids = Object.keys(auto.shapes);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (mergeShapes(dxf, [auto.shapes[ids[i]], auto.shapes[ids[j]]])) return [ids[i], ids[j]];
      }
    }
    return null;
  }

  it("two door-connected rooms merge into one polygon covering both", () => {
    const pair = connectedPair();
    expect(pair, "at least one door-connected pair exists").toBeTruthy();
    const [a, b] = pair!;
    const merged = mergeShapes(dxf, [auto.shapes[a], auto.shapes[b]])!;
    // the merged polygon must cover both original rooms…
    for (const id of [a, b]) {
      const bb = polygonBounds(auto.shapes[id].outer);
      expect(pointInShape((bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2, merged), id).toBe(true);
    }
    // …and its floor area is the two rooms plus the doorway passage, minus
    // the wall between them (which correctly survives as interior holes)
    const sum = auto.shapes[a].areaSqFt + auto.shapes[b].areaSqFt;
    expect(merged.areaSqFt).toBeGreaterThan(sum * 0.95);
    expect(merged.areaSqFt).toBeLessThan(sum + 12);
  });

  it("rooms with no connecting doorway refuse to merge", () => {
    // the two most distant shapes should not merge directly
    const ids = Object.keys(auto.shapes);
    let worst: [string, string] | null = null, worstD = -1;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const ba = polygonBounds(auto.shapes[ids[i]].outer);
        const bb = polygonBounds(auto.shapes[ids[j]].outer);
        const d = Math.hypot(
          (ba.minX + ba.maxX) / 2 - (bb.minX + bb.maxX) / 2,
          (ba.minY + ba.maxY) / 2 - (bb.minY + bb.maxY) / 2);
        if (d > worstD) { worstD = d; worst = [ids[i], ids[j]]; }
      }
    }
    const merged = mergeShapes(dxf, [auto.shapes[worst![0]], auto.shapes[worst![1]]]);
    expect(merged).toBeNull();
  });
});

describe("trace-tool snapping helper", () => {
  it("snaps a nearby point onto the closest wall edge", () => {
    const w = dxf.walls[0].points;
    const target: [number, number] = [(w[0][0] + w[1][0]) / 2, (w[0][1] + w[1][1]) / 2];
    const snapped = snapToWalls(dxf, target[0] + 0.15, target[1] + 0.15, 0.6);
    expect(snapped).toBeTruthy();
  });
  it("returns null when nothing is within range", () => {
    expect(snapToWalls(dxf, 500, 500, 1)).toBeNull();
  });
});
