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

export function guessType(name: string): { type: string; fixtures: number } {
  for (const [re, type, fixtures] of TYPE_GUESSES) {
    if (re.test(name)) return { type, fixtures };
  }
  return { type: "Other", fixtures: 0 };
}

export function estimateMinutes(type: string, sqft: number, fixtures: number): number {
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

// ── Client-demo seed: the real scan + a lived-in operation ─────────────────
import dxfRaw from "../../test-fixtures/Test_project_-_1st_Floor.dxf?raw";
import csvRaw from "../../test-fixtures/Test_project_Statistics.csv?raw";

export function demoStamp(): string {
  return "classic-demo-v3:" + dxfRaw.length + ":" + csvRaw.length;
}

/** demo floor finishes: real values on most rooms, ONE genuinely missing so
 *  the Spaces map shows an honest red "needs attention" example */
const DEMO_FLOORS: Record<string, string> = {
  "Bedroom 1": "Carpet",
  "Bedroom 2": "Hard floor — finished",
  "Bedroom 3": "Carpet"
  // "Other" stays empty on purpose — the demo's fix-me room
};

export function buildClassicDemo() {
  const scan = importScan(dxfRaw, csvRaw, { building: "Demo Medical Center" });
  for (const sp of scan.spaces) {
    const ft = DEMO_FLOORS[String(sp.roomNumber)];
    if (ft) sp.floorType = ft;
  }
  const now = new Date();
  const iso = now.toISOString();
  const today = (d: Date) => d.toISOString().slice(0, 10);
  const inDays = (n: number) => { const d = new Date(now); d.setDate(d.getDate() + n); return d; };
  const mmdd = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;

  const mkEmp = (first: string, last: string, role: string, shift: string, extra?: Record<string, unknown>) => ({
    id: `emp-demo-${slug(first + last)}`,
    firstName: first, lastName: last, displayName: `${first} ${last}`,
    role, shift, buildingOrArea: "Demo Medical Center",
    phone: "", email: `${(first[0] + last).toLowerCase()}@demomed.org`,
    languages: "", certifications: "", birthday: "", startDate: "2023-04-10",
    payRate: "", onDays: "Mon–Fri", offDays: "Sat, Sun", ptoDates: "",
    isProjectTech: false, updatedAt: iso, ...(extra ?? {})
  });

  const employees = [
    mkEmp("Maria", "Alvarez", "EVS Supervisor", "1st Shift"),
    mkEmp("Denise", "Carter", "EVS Worker", "1st Shift", { birthday: mmdd(inDays(3)) }),
    mkEmp("James", "Okafor", "EVS Worker", "1st Shift"),
    mkEmp("Linda", "Tran", "EVS Worker", "1st Shift"),
    mkEmp("Robert", "Miller", "Floor Tech", "1st Shift", { isProjectTech: true }),
    mkEmp("Keisha", "Osei", "EVS Worker", "2nd Shift", { onDays: "Tue–Sat", offDays: "Sun, Mon" }),
    mkEmp("Carlos", "Reyes", "EVS Worker", "2nd Shift"),
    mkEmp("Angela", "Brooks", "EVS Worker", "2nd Shift"),
    mkEmp("Sam", "Whitfield", "EVS Worker", "3rd Shift", { onDays: "Wed–Sun", offDays: "Mon, Tue" }),
    mkEmp("Dorothy", "Nguyen", "EVS Worker", "3rd Shift")
  ];

  // two daily schedules covering the scanned rooms, owned by real roster names
  const spaces = scan.spaces.map((sp) => ({ ...sp }));
  const ids = spaces.map((sp) => sp.id as string);
  const half = Math.ceil(ids.length / 2);
  const groupA = ids.slice(0, half), groupB = ids.slice(half);
  const tasksFor = (spId: string) => {
    const sp = spaces.find((s) => s.id === spId)!;
    return String(sp.roomType) === "Restroom"
      ? ["general-cleaning", "trash-pull", "wet-mop"]
      : ["general-cleaning", "trash-pull", "dust-mop"];
  };
  const mkSched = (num: string, name: string, emp: typeof employees[0], color: string, group: string[]) => ({
    id: `sched-demo-${num}`,
    num, name, shift: "1st Shift",
    employeeId: emp.id, employee: emp.displayName,
    color, targetHours: 8,
    spaceOrder: group,
    roomTasks: Object.fromEntries(group.map((sid) => [sid, tasksFor(sid)])),
    tasks: [], notes: "",
    createdAt: iso, updatedAt: iso
  });
  const schedules = [
    mkSched("101", "East Wing — Daily Clean", employees[1], "#22c55e", groupA),
    mkSched("102", "West Wing — Daily Clean", employees[2], "#3b82f6", groupB)
  ];
  for (const sp of spaces) {
    sp.assignedScheduleId = groupA.includes(sp.id as string) ? "sched-demo-101" : "sched-demo-102";
  }

  const notes = [
    {
      id: "note-demo-1", date: now.toLocaleDateString(),
      title: "Client walkthrough prep",
      body: "High-touch surfaces in both wings get a second pass before 10am. Check supply carts are stocked and staged.",
      linkedSpaceId: "", linkedScheduleId: "sched-demo-101", linkedEmployeeId: employees[0].id,
      tags: [], kind: "note", isProject: false,
      projectDate: "", projectTime: "", projectDuration: "", projectPriority: "", projectStatus: "",
      readAt: "", createdAt: iso, updatedAt: iso
    },
    {
      id: "note-demo-2", date: now.toLocaleDateString(),
      title: "Strip & wax — East Wing",
      body: "Quarterly floor refinish ahead of the site visit.",
      linkedSpaceId: ids[0] ?? "", linkedScheduleId: "", linkedEmployeeId: employees[4].id,
      tags: ["Project"], kind: "project", isProject: true,
      projectDate: today(inDays(1)), projectTime: "14:00", projectDuration: "120",
      projectPriority: "high", projectStatus: "scheduled",
      readAt: "", createdAt: iso, updatedAt: iso
    }
  ];

  return {
    v7: { spaces, employees, schedules, notes },
    plans: [scan.plan],
    summary: scan.summary
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

// the AI plan reader, exposed on window.OpsMatrixFusion so the classic app's
// own upload flow can offer "read it with Max" at the moment a file is picked
export { importPlanFromImage, readPlanWithAI, buildPlanFromRooms, AiPlanError } from "./aiPlanImport";

// the room-list importer (CAD/location spreadsheets → canonical rooms) and
// the attach-a-later-floor-plan matcher, for both the hub and classic.html
export {
  importRoomListIntoStorage, importRoomList, detectImportMode, attachPlanToRooms
} from "../pro/roomListImport";

// the rules engine + retuning helpers, so Hey Max's fusion tools (injected
// by fusion-ui.js) speak the SAME Scope rulebook as every other screen
export {
  loadRules, saveRules, computeMinutes, autoTasksFor, typeIdFromLabelStrict,
  spaceCleanability, freqPerWeek, FREQUENCIES
} from "../pro/rules";
export { retuneAllSpaces, fusionFloorLabel, FLOOR_TYPES } from "../pro/classicStore";
export { loadAliases, normalizeFloorType as normalizeFloorFinish } from "../pro/roomListImport";
