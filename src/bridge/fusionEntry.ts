// Fusion bridge: gives the CLASSIC OpsMatrix app (opsmatrix-v5) the new
// magicplan capability. Takes a DXF + Statistics CSV, runs the modern
// auto-detection pipeline, and returns data in the classic app's own shapes:
// a Max Plans floor plan ({img, w, h, rooms:[{spaceId, pts}]}) plus spaces
// ({roomNumber, squareFeet, visualPts, …}) ready for opsmatrix_v7 /
// opsmatrix_v7_plans. The classic app's scheduling, algorithms and UI are
// untouched — this just feeds them automatically instead of by hand-tracing.
import { parseDXF, parseStatsCSV } from "../lib/parsers";
import { deriveShapesAuto, polygonBounds, type Pt } from "../lib/geometry";

// The classic app's rate vocabulary (FP_CLEAN_RATES keys) and its estimator,
// mirrored so imported spaces arrive with minutes its screens expect.
const V5_RATES: Record<string, { base: number; perSqft: number; fixture: number }> = {
  "Patient Room": { base: 9, perSqft: 0.05, fixture: 1.25 },
  "Isolation Room": { base: 16, perSqft: 0.06, fixture: 1.5 },
  "Exam Room": { base: 6, perSqft: 0.04, fixture: 1 },
  "OR Room": { base: 18, perSqft: 0.065, fixture: 1.5 },
  "ER Room": { base: 10, perSqft: 0.055, fixture: 1.25 },
  "Corridor": { base: 2, perSqft: 0.012, fixture: 0 },
  "Restroom": { base: 8, perSqft: 0.06, fixture: 1.75 },
  "Office": { base: 4, perSqft: 0.02, fixture: 0.5 },
  "Storage": { base: 2, perSqft: 0.012, fixture: 0 },
  "Lobby": { base: 4, perSqft: 0.018, fixture: 0 },
  "Utility Room": { base: 4, perSqft: 0.025, fixture: 0.75 },
  "Break Room": { base: 5, perSqft: 0.03, fixture: 0.75 },
  "Waiting Room": { base: 5, perSqft: 0.025, fixture: 0.5 },
  "Nurses Station": { base: 6, perSqft: 0.035, fixture: 0.75 },
  "Conference Room": { base: 5, perSqft: 0.022, fixture: 0.5 },
  "Other": { base: 5, perSqft: 0.03, fixture: 0.75 }
};

const TYPE_GUESSES: [RegExp, string, number][] = [
  [/bath|restroom|toilet|wc/i, "Restroom", 2],
  [/isolation/i, "Isolation Room", 1],
  [/patient|bedroom|(^|\s)bed(\s|$)/i, "Patient Room", 1],
  [/exam/i, "Exam Room", 1],
  [/(^|\s)or(\s|$)|operating|surgery/i, "OR Room", 1],
  [/(^|\s)er(\s|$)|emergency/i, "ER Room", 1],
  [/corridor|hall/i, "Corridor", 0],
  [/office|admin/i, "Office", 0],
  [/lobby|entrance|reception/i, "Lobby", 0],
  [/wait/i, "Waiting Room", 0],
  [/util|mech|janitor/i, "Utility Room", 0],
  [/break|lounge|kitchen/i, "Break Room", 0],
  [/nurse|station/i, "Nurses Station", 0],
  [/conference|meeting/i, "Conference Room", 0],
  [/stor|closet/i, "Storage", 0]
];

function guessType(name: string): { type: string; fixtures: number } {
  for (const [re, type, fixtures] of TYPE_GUESSES) {
    if (re.test(name)) return { type, fixtures };
  }
  return { type: "Other", fixtures: 0 };
}

function estimateMinutes(type: string, sqft: number, fixtures: number): number {
  const r = V5_RATES[type] ?? V5_RATES["Other"];
  return Math.max(2, Math.round(r.base + r.perSqft * (sqft || 0) + r.fixture * (fixtures || 0)));
}

export interface ImportResult {
  plan: Record<string, unknown>;
  spaces: Record<string, unknown>[];
  summary: {
    rooms: number;
    autoDetected: number;
    needsTracing: number;
    cleanableSqFt: number | null;
    grossSqFt: number | null;
  };
}

export function importScan(
  dxfText: string,
  csvText: string,
  opts?: { building?: string; pxPerFt?: number }
): ImportResult {
  const dxf = parseDXF(dxfText);
  const stats = parseStatsCSV(csvText);
  const building = opts?.building?.trim() || "Main Building";
  const S = opts?.pxPerFt ?? 22;
  const M = 2; // margin, ft
  const now = new Date().toISOString();
  const stamp = Date.now().toString(36);

  const csvFloor = stats.floors[0] ?? { name: "1st Floor", rooms: [] };
  const floorName = csvFloor.name || "1st Floor";
  const roomInputs = csvFloor.rooms.map((rm, i) => ({
    id: `sp-scan-${stamp}-${i}`,
    name: rm.name,
    mapX: null,
    mapY: null,
    cleanableSqFt: rm.areaSqFt
  }));
  const derived = deriveShapesAuto(dxf, roomInputs);

  // world bounds → pixel space (Y flipped for image coordinates)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const w of dxf.walls) for (const p of w.points) {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
  }
  if (minX === Infinity) { minX = 0; minY = 0; maxX = 40; maxY = 30; }
  const w = Math.ceil((maxX - minX + 2 * M) * S);
  const h = Math.ceil((maxY - minY + 2 * M) * S);
  const px = (x: number) => (x - minX + M) * S;
  const py = (y: number) => (maxY - y + M) * S;

  // plan background image: clean white plan with dark walls + door markers
  const wallsPath = dxf.walls
    .map((wl) => wl.points.map((p, i) =>
      `${i === 0 ? "M" : "L"}${px(p[0]).toFixed(1)} ${py(p[1]).toFixed(1)}`).join(" ") + " Z")
    .join(" ");
  const doorDots = dxf.openings
    .map((o) => `<circle cx="${px(o.x).toFixed(1)}" cy="${py(o.y).toFixed(1)}" r="${(0.3 * S).toFixed(1)}" fill="#d98e1f"/>`)
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="#fcfdfe"/>` +
    `<path d="${wallsPath}" fill="#2b3f4a" fill-rule="nonzero"/>` +
    doorDots +
    `</svg>`;
  const img = "data:image/svg+xml;base64," + b64(svg);

  const planId = `scan-${slug(building)}-${slug(floorName)}-${stamp}`;

  // duplicate CSV names ("Bedroom" ×3) get numbered room numbers
  const nameCounts = new Map<string, number>();
  for (const r of roomInputs) nameCounts.set(r.name, (nameCounts.get(r.name) ?? 0) + 1);
  const nameSeen = new Map<string, number>();

  const spaces = roomInputs.map((r) => {
    const g = guessType(r.name);
    const shape = derived.shapes[r.id];
    const seen = (nameSeen.get(r.name) ?? 0) + 1;
    nameSeen.set(r.name, seen);
    const roomNumber = (nameCounts.get(r.name) ?? 1) > 1 ? `${r.name} ${seen}` : r.name;
    const sqft = Math.round(r.cleanableSqFt * 100) / 100;
    const base: Record<string, unknown> = {
      id: r.id,
      roomNumber,
      roomName: r.name,
      building,
      floor: floorName,
      department: "",
      roomType: g.type,
      floorType: "",
      squareFeet: sqft,
      fixtureCount: g.fixtures,
      cleaningFrequency: "Daily",
      priorityLevel: "Medium",
      estimatedCleaningMinutes: estimateMinutes(g.type, sqft, g.fixtures),
      importSource: "magicplan-scan",
      updatedAt: now
    };
    if (shape) {
      const pts = shape.outer.map(([x, y]: Pt) => ({
        x: Math.round(px(x) * 10) / 10,
        y: Math.round(py(y) * 10) / 10
      }));
      Object.assign(base, {
        floorPlanId: planId,
        visualPlanId: planId,
        visualBuilding: building,
        visualFloor: floorName,
        visualW: w,
        visualH: h,
        visualPts: pts,
        visualUpdatedAt: now
      });
    }
    return base;
  });

  const plan = {
    id: planId,
    building,
    floor: floorName,
    img,
    w,
    h,
    createdAt: now,
    source: "magicplan-scan",
    rooms: spaces
      .filter((sp) => Array.isArray(sp.visualPts))
      .map((sp) => ({ spaceId: sp.id, pts: sp.visualPts }))
  };

  return {
    plan,
    spaces,
    summary: {
      rooms: spaces.length,
      autoDetected: Object.keys(derived.shapes).length,
      needsTracing: derived.unresolved.length,
      cleanableSqFt: stats.cleanableSqFt,
      grossSqFt: stats.grossSqFt
    }
  };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function b64(s: string): string {
  if (typeof btoa === "function") return btoa(unescape(encodeURIComponent(s)));
  return Buffer.from(s, "utf8").toString("base64");
}

// polygonBounds re-exported for the UI layer (zoom-to-plan previews)
export { polygonBounds };
