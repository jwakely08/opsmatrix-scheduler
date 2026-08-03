// Verifies the fixtures against the parser functions lifted VERBATIM from
// files/opsmatrix-scan-importer.html (parseDXF, parseStatsCSV, decodeDxfText).
"use strict";
const fs = require("fs");
const path = require("path");

// ---------- parsers (verbatim from opsmatrix-scan-importer.html) ----------
function decodeDxfText(s) {
  return s.replace(/\\U\+([0-9a-fA-F]{4})/g, function (m, hex) {
    return String.fromCharCode(parseInt(hex, 16));
  });
}
function parseDXF(text) {
  var lines = text.split(/\r?\n/);
  var walls = [], labels = [], openings = [];
  var section = "", cur = null, i = 0;
  function flush() {
    if (!cur) return;
    if (section !== "ENTITIES") { cur = null; return; }
    if (cur.type === "LWPOLYLINE" && cur.layer === "walls" && cur.pts.length > 2) {
      walls.push({ points: cur.pts, closed: cur.closed });
    } else if (cur.type === "TEXT" && cur.text) {
      labels.push({ text: decodeDxfText(cur.text), x: cur.x, y: cur.y });
    } else if (cur.type === "INSERT" && cur.name && cur.name.indexOf("W-") === 0) {
      openings.push({ name: cur.name, x: cur.x, y: cur.y });
    }
    cur = null;
  }
  while (i < lines.length - 1) {
    var code = parseInt(lines[i].trim(), 10);
    var v = lines[i + 1].trim();
    i += 2;
    if (isNaN(code)) continue;
    if (code === 0) {
      flush();
      if (v === "ENDSEC") section = "";
      if (v === "LWPOLYLINE" || v === "TEXT" || v === "INSERT") {
        cur = { type: v, layer: "", pts: [], closed: false, text: "", name: "", x: 0, y: 0, lastX: null };
      }
      continue;
    }
    if (code === 2 && section === "" && (v === "ENTITIES" || v === "BLOCKS" || v === "HEADER" || v === "TABLES" || v === "OBJECTS")) {
      section = v; continue;
    }
    if (!cur) continue;
    if (code === 8) cur.layer = v;
    else if (code === 70 && cur.type === "LWPOLYLINE") cur.closed = (parseInt(v, 10) & 1) === 1;
    else if (code === 10) {
      if (cur.type === "LWPOLYLINE") cur.lastX = parseFloat(v);
      else cur.x = parseFloat(v);
    }
    else if (code === 20) {
      if (cur.type === "LWPOLYLINE" && cur.lastX !== null) { cur.pts.push([cur.lastX, parseFloat(v)]); cur.lastX = null; }
      else cur.y = parseFloat(v);
    }
    else if (code === 1 && cur.type === "TEXT") cur.text = v;
    else if (code === 2 && cur.type === "INSERT") cur.name = v;
  }
  flush();
  return { walls: walls, labels: labels, openings: openings, units: "ft" };
}
function parseStatsCSV(text) {
  var lines = text.split(/\r?\n/);
  var plan = {}, floors = [], mode = "", currentFloor = null;
  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i];
    if (!raw || !raw.trim()) continue;
    var cells = raw.split(",");
    var first = cells[0].trim();
    if (first === "PLAN ATTRIBUTES") { mode = "plan"; continue; }
    if (first === "FLOOR ATTRIBUTES") { mode = "floorattr"; continue; }
    if (first === "ROOM ATTRIBUTES") { mode = "rooms"; continue; }
    if (first === "WALL ATTRIBUTES" || first === "OBJECT COUNT" || first === "Object Attributes") { mode = first; continue; }
    if (mode === "plan") {
      if (cells.length >= 2 && cells[1].trim()) plan[first] = cells[1].trim();
      continue;
    }
    if (mode === "rooms") {
      var hasData = cells.length > 2 && cells[1] && cells[1].trim() !== "";
      if (!hasData) { currentFloor = { name: first, rooms: [] }; floors.push(currentFloor); }
      else if (currentFloor) {
        currentFloor.rooms.push({
          name: first,
          areaSqFt: parseFloat(cells[1]),
          volumeCuFt: parseFloat(cells[2]),
          groundPerimeter: cells[3] ? cells[3].trim() : "",
          doorAreaSqFt: cells[7] ? parseFloat(cells[7]) : 0,
          windowAreaSqFt: cells[8] ? parseFloat(cells[8]) : 0,
          ceilingHeight: cells[9] ? cells[9].trim() : ""
        });
      }
      continue;
    }
  }
  var gross = plan["Ground surface with all walls: sq ft"];
  var cleanable = plan["Ground surface without walls: sq ft"];
  return {
    grossSqFt: gross ? parseFloat(gross) : null,
    cleanableSqFt: cleanable ? parseFloat(cleanable) : null,
    totalAreaSqFt: cleanable ? parseFloat(cleanable) : null, // cleanable is the working number
    roomCount: plan["Rooms"] ? parseInt(plan["Rooms"], 10) : null,
    created: plan["Project creation date"] || "",
    floors: floors
  };
}
// ---------- end verbatim parsers ----------

const dxf = parseDXF(fs.readFileSync(path.join(__dirname, "Test_project_-_1st_Floor.dxf"), "utf8"));
const stats = parseStatsCSV(fs.readFileSync(path.join(__dirname, "Test_project_statistics.csv"), "utf8"));

let rooms = 0;
stats.floors.forEach(f => { rooms += f.rooms.length; });
const sum = stats.floors.reduce((s, f) => s + f.rooms.reduce((a, r) => a + r.areaSqFt, 0), 0);

const checks = [
  ["room count", rooms, 4],
  ["cleanableSqFt", stats.cleanableSqFt, 653.88],
  ["grossSqFt", stats.grossSqFt, 799.11],
  ["sum of room areas", Number(sum.toFixed(2)), 653.88],
  ["roomCount attr", stats.roomCount, 4],
  ["dxf walls > 0", dxf.walls.length > 0, true],
  ["dxf labels", dxf.labels.length, 4],
  ["dxf openings", dxf.openings.length, 6]
];
let fail = 0;
for (const [name, got, want] of checks) {
  const ok = got === want;
  if (!ok) fail++;
  console.log((ok ? "PASS" : "FAIL") + "  " + name + ": got " + got + (ok ? "" : " want " + want));
}
console.log(fail === 0 ? "\nALL CHECKS PASS" : "\n" + fail + " CHECK(S) FAILED");
process.exit(fail === 0 ? 0 : 1);
