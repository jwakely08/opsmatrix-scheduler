// Generates synthetic magicplan-format test fixtures for OpsMatrix.
// The real magicplan exports were not present in the project folder; these
// files reproduce the documented ground truth so the parsers AND the room-
// shape geometry pipeline can be verified:
//   4 rooms, 653.88 cleanable sq ft (interior), 799.11 gross sq ft (with walls).
// The wall layout is computed FROM the CSV room areas, so each room's drawn
// interior matches its CSV square footage exactly (like a real magicplan
// export, where the stats are measured from the same geometry).
// Replace with real exports when available — parsers and tests don't change.
"use strict";
const fs = require("fs");
const path = require("path");

// ---- room areas (the ground truth, sq ft) ----
const AREAS = { patient: 220.0, bath: 45.88, office: 143.0, corridor: 245.0 };
const T = 0.5;        // wall thickness (ft)
const H_NORTH = 15;   // height of the three north rooms
const DOOR = 3;       // door gap width

// widths derived from areas
const wPR = AREAS.patient / H_NORTH;              // 14.6667
const wBA = AREAS.bath / H_NORTH;                 //  3.0587
const wOF = AREAS.office / H_NORTH;               //  9.5333
const W_INT = wPR + T + wBA + T + wOF;            // interior width incl. partitions
const hC = AREAS.corridor / W_INT;                // corridor height → area exact

// key coordinates (interior origin at (T, T))
const x0 = T;                     // interior west
const xE = T + W_INT;             // interior east
const yC0 = T;                    // corridor floor south
const yC1 = T + hC;               // corridor ceiling / mid-partition south edge
const yN0 = yC1 + T;              // north rooms south edge
const yN1 = yN0 + H_NORTH;        // north rooms north edge
const xPR1 = x0 + wPR;            // PR east edge
const xBA0 = xPR1 + T;            // BA west edge
const xBA1 = xBA0 + wBA;
const xOF0 = xBA1 + T;

const rooms = [
  { name: "Patient Room 101", area: AREAS.patient,  volume: AREAS.patient * 8,  perimeter: "59' 4\"", door: 21.0, window: 15.0, ceiling: "8' 0\"", label: [(x0 + xPR1) / 2, (yN0 + yN1) / 2] },
  { name: "Bathroom 101B",    area: AREAS.bath,     volume: AREAS.bath * 8,     perimeter: "27' 1\"", door: 21.0, window: 0.0,  ceiling: "8' 0\"", label: [(xBA0 + xBA1) / 2, (yN0 + yN1) / 2] },
  { name: "Office 102",       area: AREAS.office,   volume: AREAS.office * 8,   perimeter: "48' 6\"", door: 21.0, window: 15.0, ceiling: "8' 0\"", label: [(xOF0 + xE) / 2, (yN0 + yN1) / 2] },
  { name: "Corridor A",       area: AREAS.corridor, volume: AREAS.corridor * 8, perimeter: "84' 0\"", door: 42.0, window: 0.0,  ceiling: "8' 0\"", label: [(x0 + xE) / 2, (yC0 + yC1) / 2] }
];
const totalCleanable = rooms.reduce((s, r) => s + r.area, 0); // 653.88
const gross = 799.11; // CSV reference value (never derived from geometry)

// ---- Statistics CSV ----
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
  csvLines.push([r.name, r.area.toFixed(2), r.volume.toFixed(2), r.perimeter, "", "", "", r.door.toFixed(2), r.window.toFixed(2), r.ceiling].join(","));
}
csvLines.push("");
csvLines.push("WALL ATTRIBUTES");
csvLines.push("1st Floor,");
fs.writeFileSync(path.join(__dirname, "Test_project_statistics.csv"), csvLines.join("\n"), "utf8");

// ---- DXF walls (closed strips with 3 ft door gaps) ----
function strip(x1, y1, x2, y2) {
  return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
}
const walls = [];
// exterior
walls.push(strip(0, 0, xE + T, T));                      // south
walls.push(strip(0, yN1, xE + T, yN1 + T));              // north
walls.push(strip(0, T, T, yN1));                         // west
walls.push(strip(xE, T, xE + T, yN1));                   // east
// mid partition (corridor ceiling) with a door gap centered under each north room
const doors = [
  (x0 + xPR1) / 2,   // door to Patient Room
  (xBA0 + xBA1) / 2, // door to Bathroom
  (xOF0 + xE) / 2    // door to Office
];
let segStart = x0;
for (const dc of doors) {
  const g0 = dc - DOOR / 2, g1 = dc + DOOR / 2;
  if (g0 > segStart + 0.05) walls.push(strip(segStart, yC1, g0, yN0));
  segStart = g1;
}
if (segStart < xE - 0.05) walls.push(strip(segStart, yC1, xE, yN0));
// partition PR | BA — door gap in the middle
const dMid = (yN0 + yN1) / 2;
walls.push(strip(xPR1, yN0, xBA0, dMid - DOOR / 2));
walls.push(strip(xPR1, dMid + DOOR / 2, xBA0, yN1));
// partition BA | OF — solid
walls.push(strip(xBA1, yN0, xOF0, yN1));

const openings = [
  { name: "W-D1", x: doors[0], y: (yC1 + yN0) / 2 },
  { name: "W-D2", x: doors[1], y: (yC1 + yN0) / 2 },
  { name: "W-D3", x: doors[2], y: (yC1 + yN0) / 2 },
  { name: "W-D4", x: (xPR1 + xBA0) / 2, y: dMid },
  { name: "W-W1", x: (x0 + xPR1) / 2, y: yN1 + T / 2 },
  { name: "W-W2", x: (xOF0 + xE) / 2, y: yN1 + T / 2 }
];

const d = [];
function pair(code, val) { d.push(String(code)); d.push(String(val)); }
function num(v) { return String(Math.round(v * 10000) / 10000); }
pair(0, "SECTION"); pair(2, "HEADER");
pair(9, "$INSUNITS"); pair(70, 2);
pair(0, "ENDSEC");
pair(0, "SECTION"); pair(2, "ENTITIES");
for (const w of walls) {
  pair(0, "LWPOLYLINE");
  pair(8, "walls");
  pair(90, w.length);
  pair(70, 1); // closed
  for (const p of w) { pair(10, num(p[0])); pair(20, num(p[1])); }
}
for (const r of rooms) {
  pair(0, "TEXT");
  pair(8, "labels");
  pair(10, num(r.label[0])); pair(20, num(r.label[1]));
  pair(40, 1);
  pair(1, r.name);
}
for (const o of openings) {
  pair(0, "INSERT");
  pair(8, "walls");
  pair(2, o.name);
  pair(10, num(o.x)); pair(20, num(o.y));
}
pair(0, "ENDSEC");
pair(0, "EOF");
fs.writeFileSync(path.join(__dirname, "Test_project_-_1st_Floor.dxf"), d.join("\n"), "utf8");

console.log("fixtures written; cleanable total =", totalCleanable.toFixed(2),
  "| interior widths PR/BA/OF =", wPR.toFixed(3), wBA.toFixed(3), wOF.toFixed(3),
  "| corridor h =", hC.toFixed(3));
