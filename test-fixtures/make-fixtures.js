// Generates synthetic magicplan-format test fixtures for OpsMatrix.
// The real magicplan exports were not present in the project folder; these
// files reproduce the documented ground truth so the parsers can be verified:
//   4 rooms, 653.88 cleanable sq ft (interior), 799.11 gross sq ft (with walls).
// Replace with the real exports when available — the parsers and tests do not change.
"use strict";
const fs = require("fs");
const path = require("path");

// ---- floor layout (feet). Interior areas sum to 653.88 exactly. ----
// Building interior 36 x 24 approx; walls drawn as 0.5 ft strips with door gaps.
const rooms = [
  { name: "Patient Room 101", area: 220.0,  volume: 1760.0, perimeter: "59' 4\"",  door: 21.0, window: 15.0, ceiling: "8' 0\"", label: [9.5, 16.5] },
  { name: "Bathroom 101B",    area: 45.88,  volume: 367.04, perimeter: "27' 1\"",  door: 21.0, window: 0.0,  ceiling: "8' 0\"", label: [21.5, 16.5] },
  { name: "Office 102",       area: 143.0,  volume: 1144.0, perimeter: "48' 6\"",  door: 21.0, window: 15.0, ceiling: "8' 0\"", label: [30.5, 16.5] },
  { name: "Corridor A",       area: 245.0,  volume: 1960.0, perimeter: "84' 0\"",  door: 42.0, window: 0.0,  ceiling: "8' 0\"", label: [18.0, 4.0] }
];
const totalCleanable = rooms.reduce((s, r) => s + r.area, 0); // 653.88
const gross = 799.11;

// ---- Statistics CSV (magicplan layout the parser expects) ----
const csvLines = [];
csvLines.push("PLAN ATTRIBUTES");
csvLines.push("Project name,Test project");
csvLines.push("Project creation date,2026-07-20");
csvLines.push("Rooms,4");
csvLines.push("Ground surface with all walls: sq ft," + gross.toFixed(2));
csvLines.push("Ground surface without walls: sq ft," + totalCleanable.toFixed(2));
csvLines.push("");
csvLines.push("ROOM ATTRIBUTES");
csvLines.push("1st Floor");
for (const r of rooms) {
  // name, area, volume, perimeter, wallSurf, wallSurfNoOpenings, floorPerim, doorArea, windowArea, ceiling
  csvLines.push([r.name, r.area.toFixed(2), r.volume.toFixed(2), r.perimeter, "", "", "", r.door.toFixed(2), r.window.toFixed(2), r.ceiling].join(","));
}
csvLines.push("");
csvLines.push("WALL ATTRIBUTES");
csvLines.push("1st Floor,");
fs.writeFileSync(path.join(__dirname, "Test_project_statistics.csv"), csvLines.join("\n"), "utf8");

// ---- DXF ----
// Walls: LWPOLYLINE strips on layer "walls" (closed rectangles 0.5 ft thick, gaps at doors).
// Labels: TEXT at room centers. Openings: INSERT blocks named W-*.
const T = 0.5; // wall thickness
function strip(x1, y1, x2, y2) {
  // axis-aligned wall strip rectangle
  return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
}
const walls = [];
// exterior: outer bounds 0..37 x 0..24.5 (interior 0.5..36.5 etc.)
walls.push(strip(0, 0, 37, T));                    // south
walls.push(strip(0, 24, 37, 24.5));                // north
walls.push(strip(0, T, T, 24));                    // west
walls.push(strip(36.5, T, 37, 24));                // east
// corridor / rooms partition at y=8 with three door gaps
walls.push(strip(T, 8, 6, 8.5));
walls.push(strip(9, 8, 18, 8.5));
walls.push(strip(21, 8, 27, 8.5));
walls.push(strip(30, 8, 36.5, 8.5));
// partition between Patient Room 101 and Bathroom 101B at x=18 (door gap y 10..13)
walls.push(strip(18, 8.5, 18.5, 10));
walls.push(strip(18, 13, 18.5, 24));
// partition between Bathroom 101B and Office 102 at x=25
walls.push(strip(25, 8.5, 25.5, 24));

const openings = [
  { name: "W-D1", x: 7.5,  y: 8.25 },  // door to Patient Room 101
  { name: "W-D2", x: 19.5, y: 8.25 },  // door to Bathroom corridor gap
  { name: "W-D3", x: 28.5, y: 8.25 },  // door to Office 102
  { name: "W-D4", x: 18.25, y: 11.5 }, // door PR101 -> Bath
  { name: "W-W1", x: 9.5,  y: 24.25 }, // window
  { name: "W-W2", x: 30.5, y: 24.25 }  // window
];

const d = [];
function pair(code, val) { d.push(String(code)); d.push(String(val)); }
pair(0, "SECTION"); pair(2, "HEADER");
pair(9, "$INSUNITS"); pair(70, 2);
pair(0, "ENDSEC");
pair(0, "SECTION"); pair(2, "ENTITIES");
for (const w of walls) {
  pair(0, "LWPOLYLINE");
  pair(8, "walls");
  pair(90, w.length);
  pair(70, 1); // closed
  for (const p of w) { pair(10, p[0]); pair(20, p[1]); }
}
for (const r of rooms) {
  pair(0, "TEXT");
  pair(8, "labels");
  pair(10, r.label[0]); pair(20, r.label[1]);
  pair(40, 1);
  pair(1, r.name);
}
for (const o of openings) {
  pair(0, "INSERT");
  pair(8, "walls");
  pair(2, o.name);
  pair(10, o.x); pair(20, o.y);
}
pair(0, "ENDSEC");
pair(0, "EOF");
fs.writeFileSync(path.join(__dirname, "Test_project_-_1st_Floor.dxf"), d.join("\n"), "utf8");

console.log("fixtures written; cleanable total =", totalCleanable.toFixed(2));
