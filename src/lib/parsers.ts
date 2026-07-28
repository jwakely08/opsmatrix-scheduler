// magicplan export parsers — moved over VERBATIM from opsmatrix-scan-importer.html
// (function bodies unchanged; verified against the test fixtures:
//  4 rooms, 653.88 cleanable sq ft, 799.11 gross sq ft).
// Only the export keywords and type annotations on the signatures are new.

export interface ParsedDXF {
  walls: { points: [number, number][]; closed: boolean }[];
  labels: { text: string; x: number; y: number }[];
  openings: { name: string; x: number; y: number }[];
  units: string;
}

export interface ParsedStatsRoom {
  name: string;
  areaSqFt: number;
  volumeCuFt: number;
  groundPerimeter: string;
  doorAreaSqFt: number;
  windowAreaSqFt: number;
  ceilingHeight: string;
}

export interface ParsedStats {
  grossSqFt: number | null;
  cleanableSqFt: number | null;
  totalAreaSqFt: number | null;
  roomCount: number | null;
  created: string;
  floors: { name: string; rooms: ParsedStatsRoom[] }[];
}

export function decodeDxfText(s: string): string {
  return s.replace(/\\U\+([0-9a-fA-F]{4})/g, function (m, hex) {
    return String.fromCharCode(parseInt(hex, 16));
  });
}

export function parseDXF(text: string): ParsedDXF {
  var lines = text.split(/\r?\n/);
  var walls: any[] = [], labels: any[] = [], openings: any[] = [];
  var section = "", cur: any = null, i = 0;
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

export function parseStatsCSV(text: string): ParsedStats {
  var lines = text.split(/\r?\n/);
  var plan: Record<string, string> = {}, floors: any[] = [], mode = "", currentFloor: any = null;
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
