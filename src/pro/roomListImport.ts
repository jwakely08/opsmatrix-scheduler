// Room-list import: a hospital CAD/location spreadsheet (Excel or CSV)
// becomes normal OpsMatrix rooms in the ONE canonical dataset
// (opsmatrix_v7.spaces). List View, Max Schedule and Workload Intelligence
// work immediately; Map View simply stays empty until a floor plan arrives
// and attaches to these same rooms.
//
// Principles (they are product rules, not implementation details):
//   • Preserve what the source actually said — original values live under
//     space.source and are never overwritten by normalization.
//   • Blanks stay blank. No invented departments, floor types or room types.
//   • Department IDENTITY and department NAME are different things: a
//     department can structurally exist with no name, and two unnamed
//     departments with different source identities stay separate.
//   • Cost Center is not a department. It is preserved and analyzable,
//     never promoted to a department name.
//   • Re-import must be safe: rows are matched to existing rooms by source
//     identity, and a value the manager hand-edited is never clobbered.
import {
  type Rules, typeIdFromLabelStrict, autoTasksFor, computeMinutes, loadRules
} from "./rules";

/** one worksheet as raw cells (SheetJS sheet_to_json header:1, or CSV rows) */
export interface RawSheet {
  name: string;
  rows: (string | number | null | undefined)[][];
}

/** everything the source row said, kept verbatim on the space */
export interface SourceRecord {
  importId: string;
  file: string;
  row: number;             // 1-based row in the source sheet
  key: string;             // stable source identity (CAD Internal Handle etc.)
  site: string;
  building: string;
  floor: string;
  roomNumber: string;
  roomName: string;
  grossSqFt: number | null;
  netSqFt: number | null;
  costCenter: string;
  costCenterDescription: string;
  department: string;       // source department code/id — IDENTITY
  departmentName: string;   // source department description — NAME
  floorType: string;
  spaceDefinition: string;
  ahu: string;
  importedAt: string;
  /** the operational values THIS import wrote, so the next import can tell
   *  "still what we set" (safe to update) from "the manager changed it" */
  applied: Record<string, unknown>;
}

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
const txt = (s: unknown) => String(s ?? "").trim();

/** deterministic tidy for CAD ALL-CAPS text: "ONCOLOGY (7 EAST)" → "Oncology (7 East)" */
export function titleCase(s: string): string {
  const raw = txt(s);
  if (raw === "-" || /^[-–—.]+$/.test(raw)) return "";
  return raw.toLowerCase().replace(/(^|[\s\-–—/(&])([a-z])/g, (_, pre, ch) => pre + ch.toUpperCase());
}

// ── header vocabulary (superset of the classic app's importer) ──────────────
type FieldId =
  | "system" | "building" | "floor" | "roomNumber" | "roomName" | "roomType"
  | "department" | "departmentName" | "grossSqFt" | "netSqFt" | "areaSqFt"
  | "costCenter" | "costCenterDescription" | "floorType" | "fixtureCount"
  | "sourceKey" | "spaceDefinition" | "ahu";

const HEADER_KWDS: Record<string, { field: FieldId; w: number }> = {
  site: { field: "system", w: 3 }, campus: { field: "system", w: 4 },
  campusname: { field: "system", w: 4 }, system: { field: "system", w: 4 },
  hospitalcampus: { field: "system", w: 4 },

  building: { field: "building", w: 4 }, buildingcode: { field: "building", w: 4 },
  bldg: { field: "building", w: 3 }, bldgcode: { field: "building", w: 4 },
  bldgname: { field: "building", w: 3 }, facility: { field: "building", w: 2 },
  facilityname: { field: "building", w: 3 },

  floor: { field: "floor", w: 4 }, floornumber: { field: "floor", w: 4 },
  flr: { field: "floor", w: 2 }, flrno: { field: "floor", w: 3 },
  level: { field: "floor", w: 2 },

  room: { field: "roomNumber", w: 3 }, roomnumber: { field: "roomNumber", w: 5 },
  roomno: { field: "roomNumber", w: 4 }, rmno: { field: "roomNumber", w: 3 },
  rm: { field: "roomNumber", w: 2 }, spacenumber: { field: "roomNumber", w: 3 },
  spaceno: { field: "roomNumber", w: 3 }, locationnumber: { field: "roomNumber", w: 3 },

  roomname: { field: "roomName", w: 4 }, spacename: { field: "roomName", w: 3 },
  roomdescription: { field: "roomName", w: 3 }, description: { field: "roomName", w: 1 },

  roomtype: { field: "roomType", w: 5 }, roomcategory: { field: "roomType", w: 5 },
  spacetype: { field: "roomType", w: 4 }, category: { field: "roomType", w: 3 },
  classification: { field: "roomType", w: 3 }, usedescription: { field: "roomType", w: 2 },

  department: { field: "department", w: 4 }, departmentcode: { field: "department", w: 5 },
  departmentid: { field: "department", w: 5 }, dept: { field: "department", w: 3 },
  deptcode: { field: "department", w: 5 }, deptid: { field: "department", w: 5 },

  departmentdescription: { field: "departmentName", w: 5 },
  departmentname: { field: "departmentName", w: 5 }, deptname: { field: "departmentName", w: 4 },
  deptdescription: { field: "departmentName", w: 4 },

  grosssf: { field: "grossSqFt", w: 5 }, grosssquarefeet: { field: "grossSqFt", w: 5 },
  grosssqft: { field: "grossSqFt", w: 5 }, grossarea: { field: "grossSqFt", w: 4 },
  gsf: { field: "grossSqFt", w: 3 },

  netsf: { field: "netSqFt", w: 5 }, netsquarefeet: { field: "netSqFt", w: 5 },
  netsqft: { field: "netSqFt", w: 5 }, netarea: { field: "netSqFt", w: 4 },
  nsf: { field: "netSqFt", w: 3 }, netusablearea: { field: "netSqFt", w: 4 },

  area: { field: "areaSqFt", w: 3 }, squarefootage: { field: "areaSqFt", w: 4 },
  squarefeet: { field: "areaSqFt", w: 4 }, sqft: { field: "areaSqFt", w: 4 },
  sf: { field: "areaSqFt", w: 3 }, roomarea: { field: "areaSqFt", w: 4 },
  cleanablearea: { field: "areaSqFt", w: 5 }, assignablearea: { field: "areaSqFt", w: 3 },

  costcenter: { field: "costCenter", w: 5 }, costcentre: { field: "costCenter", w: 5 },
  costcenternumber: { field: "costCenter", w: 5 },
  costcenterdescription: { field: "costCenterDescription", w: 5 },
  costcentredescription: { field: "costCenterDescription", w: 5 },
  costcentername: { field: "costCenterDescription", w: 4 },

  floortype: { field: "floorType", w: 5 }, floorfinish: { field: "floorType", w: 4 },
  flooring: { field: "floorType", w: 4 }, floormaterial: { field: "floorType", w: 4 },
  surfacetype: { field: "floorType", w: 3 },

  fixtures: { field: "fixtureCount", w: 4 }, fixturecount: { field: "fixtureCount", w: 5 },

  internalhandle: { field: "sourceKey", w: 5 }, handle: { field: "sourceKey", w: 3 },
  cadid: { field: "sourceKey", w: 5 }, sourceid: { field: "sourceKey", w: 4 },
  recordid: { field: "sourceKey", w: 3 }, guid: { field: "sourceKey", w: 4 },

  spacedefinition: { field: "spaceDefinition", w: 5 },
  ahu: { field: "ahu", w: 5 }, airhandler: { field: "ahu", w: 4 }
};

export interface HeaderMatch {
  sheet: number;
  headerRow: number;             // index into rows
  columns: Partial<Record<FieldId, number>>;  // field → column index
  headers: Record<number, string>;            // column index → original header
  score: number;
}

/** find the header row: the row whose cells match the most known headers */
export function detectHeader(sheets: RawSheet[]): HeaderMatch | null {
  let best: HeaderMatch | null = null;
  sheets.forEach((sheet, si) => {
    const upto = Math.min(sheet.rows.length, 40);
    for (let ri = 0; ri < upto; ri++) {
      const row = sheet.rows[ri] ?? [];
      const columns: Partial<Record<FieldId, number>> = {};
      const colWeight: Partial<Record<FieldId, number>> = {};
      const headers: Record<number, string> = {};
      let score = 0;
      row.forEach((cell, ci) => {
        const kw = HEADER_KWDS[norm(cell)];
        if (!kw) return;
        score += kw.w;
        headers[ci] = txt(cell);
        // heavier weight wins outright ("Floor Type" beats "Floor Finish");
        // on equal weight the first (leftmost) column keeps the field
        if (kw.w > (colWeight[kw.field] ?? 0)) {
          columns[kw.field] = ci;
          colWeight[kw.field] = kw.w;
        }
      });
      const hasCore = columns.roomNumber !== undefined || columns.roomName !== undefined;
      if (!hasCore) continue;
      if (!best || score > best.score) best = { sheet: si, headerRow: ri, columns, headers, score };
    }
  });
  return best;
}

/** what kind of upload is this? A spreadsheet never carries drawable
 *  geometry, so its modes are room data or nothing-we-recognize. */
export function detectImportMode(sheets: RawSheet[]): "room-list" | "unknown" {
  return detectHeader(sheets) ? "room-list" : "unknown";
}

const parseNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[,$\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/**
 * §area selection: candidate columns are inspected, and the one that actually
 * contains positive room areas wins. A column of all zeros (this file's
 * "Net S.F.") is never chosen over a populated one. Preference on a tie
 * follows how close the number is to cleanable area: net, then generic,
 * then gross. The decision is recorded, not hidden.
 */
export function pickAreaColumn(
  match: HeaderMatch, rows: RawSheet["rows"]
): { field: FieldId; column: number; header: string } | null {
  const prefs: FieldId[] = ["netSqFt", "areaSqFt", "grossSqFt"];
  let best: { field: FieldId; column: number; positives: number; pref: number } | null = null;
  for (const f of prefs) {
    const ci = match.columns[f];
    if (ci === undefined) continue;
    let positives = 0;
    for (let ri = match.headerRow + 1; ri < rows.length; ri++) {
      const n = parseNum(rows[ri]?.[ci]);
      if (n !== null && n > 0) positives++;
    }
    const pref = prefs.indexOf(f);
    if (!best || positives > best.positives || (positives === best.positives && pref < best.pref)) {
      best = { field: f, column: ci, positives, pref };
    }
  }
  if (!best || best.positives === 0) return null;
  return { field: best.field, column: best.column, header: match.headers[best.column] ?? best.field };
}

// ── room-type normalization ────────────────────────────────────────────────
// Order matters and every rule is deterministic. Anything unmatched is left
// BLANK and lands in Needs Review — the importer never guesses.
const TYPE_RULES: [RegExp, string][] = [
  [/\b(pat|patient)\b.*\b(tlt|toilet|bath)|^pat\.?\s*tlt/i, "restroom"],
  [/tlt|toilet|restroom|bathroom|lavat|shwr|shower|\bwc\b/i, "restroom"],
  [/\b(pat|patient)\b|patient\s*(rm|room)|^pt\.?\s*(rm|room)/i, "patient-room"],
  [/isolation/i, "patient-room"],
  [/\bexam/i, "exam-room"],
  [/\bproc(edure)?\b/i, "procedure-room"],
  [/operating|\bor\b(?!\w)|surgery/i, "operating-room"],
  [/emergency|\ber\b(?!\w)/i, "emergency-room"],
  [/corr(idor)?\.?$|^corr/i, "corridor"],
  [/hallway|\bhall\b/i, "hallway"],
  [/nurses?\s*stn|nurses?\s*station|nourish|\bdictation\b|work\s*(area|rm|room)|\bcopy\b|\breception\b/i, "office"],
  [/office|\bofc\b|dietitian|social\s*work|admin|conf(erence)?|consult|interview|registrar/i, "office"],
  [/waiting|\bwait\b/i, "waiting-room"],
  [/lobby|vestibule|entry|entrance/i, "lobby"],
  [/lounge|break\s*(rm|room)|staff\s*rm|on.?call|sleep|respite|family\s*rm/i, "lounge"],
  [/soiled\s*util|clean\s*util|\butil(ity)?\b|hskpg|housekeeping|\bevs\b|janitor|med\.?\s*(rm|room)|medication|\blinen\b|equip(ment)?\s*(rm|room|stor)/i, "utility-room"],
  [/locker/i, "locker-room"],
  [/stor(age)?\.?$|^stor|closet|\bsupply\b/i, "storage"],
  [/stair/i, "stairwell"],
  [/elev(ator)?\.?/i, "elevator"],
  [/mech(anical)?\b/i, "mechanical-room"],
  [/elec(trical)?\b|\bemr\b/i, "electrical-room"],
  [/\bdata\b|telecom|\bidf\b|\bmdf\b|\bit\s*(rm|room|closet)\b|server/i, "data-telecom"],
  [/shaft|chase/i, "shaft"],
  [/shell/i, "shell-space"],
  [/roof/i, "roof"]
];

export interface AliasStore {
  /** approved source-name → room type id (null = approved as "leave blank") */
  roomTypes: Record<string, string | null>;
  /** approved source floor finish → OpsMatrix floor type label */
  floorTypes: Record<string, string>;
}

export const ALIASES_KEY = "opsmatrix_fusion_aliases";

export function loadAliases(): AliasStore {
  try {
    const parsed = JSON.parse(localStorage.getItem(ALIASES_KEY) ?? "{}") ?? {};
    return {
      roomTypes: parsed.roomTypes && typeof parsed.roomTypes === "object" ? parsed.roomTypes : {},
      floorTypes: parsed.floorTypes && typeof parsed.floorTypes === "object" ? parsed.floorTypes : {}
    };
  } catch {
    return { roomTypes: {}, floorTypes: {} };
  }
}

export function saveAliases(a: AliasStore) {
  localStorage.setItem(ALIASES_KEY, JSON.stringify(a));
}

/**
 * Source room name → OpsMatrix room type label, or null (= leave blank,
 * Needs Review). Precedence: approved alias → exact library match →
 * deterministic CAD-abbreviation rule. AI suggestions never run here — they
 * are a separate, user-triggered step whose approvals land in the aliases.
 */
export function normalizeRoomType(
  rules: Rules, aliases: AliasStore, sourceName: string, spaceDefinition?: string
): string | null {
  const raw = txt(sourceName);
  const def = txt(spaceDefinition);
  // the source explicitly declares SHELL/ROOF space — believe it
  if (/^shell/i.test(def)) return labelFor(rules, "shell-space");
  if (/^roof/i.test(def)) return labelFor(rules, "roof");
  if (!raw || raw === "-") return null;
  const key = norm(raw);
  if (key in aliases.roomTypes) {
    const id = aliases.roomTypes[key];
    return id === null ? null : labelFor(rules, id);
  }
  const exact = typeIdFromLabelStrict(rules, raw);
  if (exact) return labelFor(rules, exact);
  for (const [re, id] of TYPE_RULES) {
    if (re.test(raw)) return labelFor(rules, id);
  }
  return null;
}

function labelFor(rules: Rules, id: string): string {
  return rules.roomTypes.find((rt) => rt.id === id)?.label ?? id;
}

/** source floor finish → one of Classic's three floor types, or "" (blank).
 *  CARPET is carpet; hard surfaces that take a finish are "finished";
 *  bare concrete is "unfinished". Unrecognized values stay blank. */
export function normalizeFloorType(aliases: AliasStore, sourceValue: string): string {
  const raw = txt(sourceValue);
  if (!raw) return "";
  const key = norm(raw);
  if (key in aliases.floorTypes) return aliases.floorTypes[key];
  if (/carpet/i.test(raw)) return "Carpet";
  if (/vinyl|lvt|vct|tile|linoleum|terrazzo|rubber|epoxy|wood|laminate/i.test(raw)) return "Hard floor — finished";
  if (/concrete|unfinished|bare/i.test(raw)) return "Hard floor — unfinished";
  return "";
}

// ── department identity vs name ────────────────────────────────────────────

/**
 * §12–§18 in one function. Identity comes from a department CODE when the
 * source has one; a department NAME alone also identifies (it is real
 * structure the source stated). A numeric code is never used as a display
 * name. When the source offers neither, there is NO department — the room
 * stays unassigned rather than getting an invented one.
 */
export function departmentIdentity(code: string, name: string): { key: string | null; name: string } {
  const c = txt(code), n = txt(name);
  const key = c || n || null;
  let display = n;
  if (!display && c && /[a-z]/i.test(c)) display = c; // a wordy "code" is really a name
  return { key, name: display };
}

/**
 * Stable display labels for departments that structurally exist but have no
 * name: "Blank Department 1", "Blank Department 2"… numbered by sorted
 * identity key, so the same department keeps the same label across refreshes
 * and re-imports. Display-only — department names in the data STAY blank.
 */
export function blankDeptLabels(spaces: { departmentKey?: string; department?: string }[]): Map<string, string> {
  const keys = new Set<string>();
  for (const sp of spaces) {
    const key = txt(sp.departmentKey);
    if (key && !txt(sp.department)) keys.add(key);
  }
  const out = new Map<string, string>();
  [...keys].sort().forEach((k, i) => out.set(k, `Blank Department ${i + 1}`));
  return out;
}

/** what to show for a space's department (never saved back to the data) */
export function departmentDisplay(
  sp: { departmentKey?: string; department?: string }, labels: Map<string, string>
): string {
  const name = txt(sp.department);
  if (name) return name;
  const key = txt(sp.departmentKey);
  if (key) return labels.get(key) ?? "Blank Department";
  return "No department assigned";
}

// ── the import itself ──────────────────────────────────────────────────────

export interface SpaceRecord {
  id: string;
  [k: string]: unknown;
}

export interface ImportSummary {
  mode: "room-list";
  importId: string;
  file: string;
  rows: number;
  created: number;
  updated: number;
  unchanged: number;
  /** fields kept because the manager had hand-edited them since last import */
  keptManualEdits: number;
  sqftSource: string | null;
  totalSqFt: number;
  systems: string[];
  buildings: string[];
  floors: string[];
  deptNamesMissing: number;   // identity exists, name blank
  deptUnassigned: number;     // no identity at all
  floorTypeMapped: number;
  roomTypeMapped: number;
  needsReview: number;
  duplicateRoomNumbers: string[];
  warnings: string[];
}

export interface ImportOutcome {
  summary: ImportSummary;
  spaces: SpaceRecord[]; // the canonical array AFTER the import (same objects)
}

/**
 * Import a room-list workbook into the canonical spaces array (in place).
 * Existing rooms are matched by source identity — CAD Internal Handle first,
 * then System|Building|Floor|Room Number|Room Name — and updated instead of
 * duplicated. A value the manager changed by hand is kept, not clobbered.
 */
export function importRoomList(
  spaces: SpaceRecord[],
  sheets: RawSheet[],
  rules: Rules,
  aliases: AliasStore,
  opts?: { fileName?: string; now?: string }
): ImportOutcome {
  const match = detectHeader(sheets);
  if (!match) {
    throw new Error(
      "No room list was recognized in this file. It needs a header row with " +
      "columns like Building, Floor, Room Number and Room Name."
    );
  }
  const sheet = sheets[match.sheet];
  const rows = sheet.rows;
  const now = opts?.now ?? new Date().toISOString();
  const file = opts?.fileName ?? "spreadsheet";
  const stamp = now.replace(/[^0-9]/g, "").slice(0, 14) + "-" + Math.random().toString(36).slice(2, 7);
  const importId = "imp-" + stamp;
  const area = pickAreaColumn(match, rows);

  const cell = (ri: number, f: FieldId): string => {
    const ci = match.columns[f];
    return ci === undefined ? "" : txt(rows[ri]?.[ci]);
  };

  // index existing spaces by both identities
  const byKey = new Map<string, SpaceRecord>();
  const byComposite = new Map<string, SpaceRecord>();
  const compositeOf = (sys: string, b: string, f: string, rn: string, name: string) =>
    [norm(sys), norm(b), norm(f), norm(rn), norm(name)].join("|");
  for (const sp of spaces) {
    const src = sp.source as SourceRecord | undefined;
    if (src?.key) byKey.set(src.key, sp);
    const c = compositeOf(
      txt(sp.system ?? src?.site), txt(sp.building), txt(sp.floor),
      txt(sp.roomNumber), txt(sp.roomName)
    );
    if (!byComposite.has(c)) byComposite.set(c, sp);
  }

  const summary: ImportSummary = {
    mode: "room-list", importId, file, rows: 0, created: 0, updated: 0,
    unchanged: 0, keptManualEdits: 0, sqftSource: area?.header ?? null,
    totalSqFt: 0, systems: [], buildings: [], floors: [],
    deptNamesMissing: 0, deptUnassigned: 0, floorTypeMapped: 0,
    roomTypeMapped: 0, needsReview: 0, duplicateRoomNumbers: [], warnings: []
  };
  const systems = new Set<string>(), buildings = new Set<string>(), floors = new Set<string>();
  const roomNumbersSeen = new Map<string, number>();
  const deptKeysBlankName = new Set<string>();
  let idSeq = 0;

  for (let ri = match.headerRow + 1; ri < rows.length; ri++) {
    const raw = rows[ri] ?? [];
    if (!raw.some((v) => txt(v) !== "")) continue;
    const firstCell = txt(raw[0] ?? raw[1]).toLowerCase();
    if (/^(total|grand total|subtotal|totals|sum|count|average|note:|notes:)\b/.test(firstCell)) continue;

    const roomNumber = cell(ri, "roomNumber");
    const roomName = cell(ri, "roomName");
    if (!roomNumber && !roomName) continue;
    summary.rows++;

    const system = cell(ri, "system");
    const building = cell(ri, "building");
    const floor = cell(ri, "floor");
    const key = cell(ri, "sourceKey");
    const sqft = area ? parseNum(raw[area.column]) : null;
    let dept = departmentIdentity(cell(ri, "department"), cell(ri, "departmentName"));
    // No department columns at all? A populated Cost Center is the file's own
    // unit grouping, so it becomes the department: the code is the IDENTITY
    // (rooms billed together stay grouped together) and — Josh's call, made
    // looking at his real E-building export where the descriptions ARE the
    // units ("5 EAST", "ONCOLOGY (7 EAST)") — the description becomes the
    // department NAME, tidied out of CAD ALL-CAPS. Managers rename freely in
    // Space Validation; the identity keeps the grouping through any rename.
    // A code with no description falls back to the stable "Blank Department N"
    // placeholder; a placeholder cost center like "-" is no evidence at all,
    // so those rooms stay honestly unassigned. Real department columns, when
    // present, still outrank the cost center.
    if (!dept.key) {
      const cc = cell(ri, "costCenter");
      if (cc && !/^[-–—.0]+$/.test(cc)) {
        dept = { key: "cc:" + cc, name: titleCase(cell(ri, "costCenterDescription")) };
      }
    }
    const srcFloorType = cell(ri, "floorType");
    const floorType = normalizeFloorType(aliases, srcFloorType);
    const srcTypeName = cell(ri, "roomType") || roomName;
    const spaceDef = cell(ri, "spaceDefinition");
    const roomType = normalizeRoomType(rules, aliases, srcTypeName, spaceDef);

    if (system) systems.add(system);
    if (building) buildings.add(building);
    if (floor) floors.add(floor);
    if (sqft) summary.totalSqFt += sqft;
    if (roomNumber) roomNumbersSeen.set(roomNumber, (roomNumbersSeen.get(roomNumber) ?? 0) + 1);
    if (dept.key && !dept.name) { summary.deptNamesMissing++; deptKeysBlankName.add(dept.key); }
    if (!dept.key) summary.deptUnassigned++;
    if (floorType) summary.floorTypeMapped++;
    if (roomType) summary.roomTypeMapped++; else summary.needsReview++;

    const source: SourceRecord = {
      importId, file, row: ri + 1, key,
      site: system, building, floor, roomNumber, roomName,
      grossSqFt: match.columns.grossSqFt !== undefined ? parseNum(raw[match.columns.grossSqFt]) : null,
      netSqFt: match.columns.netSqFt !== undefined ? parseNum(raw[match.columns.netSqFt]) : null,
      costCenter: cell(ri, "costCenter"),
      costCenterDescription: cell(ri, "costCenterDescription"),
      department: cell(ri, "department"),
      departmentName: cell(ri, "departmentName"),
      floorType: srcFloorType, spaceDefinition: spaceDef, ahu: cell(ri, "ahu"),
      importedAt: now, applied: {}
    };

    // the operational values this row wants to set. Blanks stay blank —
    // a null/"" here never overwrites something the manager typed.
    const wanted: Record<string, unknown> = {
      system, building, floor, roomNumber, roomName,
      department: dept.name,          // NAME only — codes are identity, not display
      departmentKey: dept.key ?? "",
      roomType: roomType ?? "",
      floorType,
      squareFeet: sqft !== null && sqft > 0 ? sqft : undefined
    };

    // match by stable source key first; the composite fallback only applies
    // when neither side carries a conflicting key (two rooms that share a
    // number AND a name are still different rooms if their CAD ids differ)
    let existing: SpaceRecord | undefined = key ? byKey.get(key) : undefined;
    if (!existing) {
      const comp = byComposite.get(compositeOf(system, building, floor, roomNumber, roomName));
      const compKey = (comp?.source as SourceRecord | undefined)?.key ?? "";
      if (comp && (!key || !compKey || compKey === key)) existing = comp;
    }

    if (!existing) {
      const sp: SpaceRecord = {
        id: `sp-list-${stamp}-${idSeq++}`,
        importSource: "room-list",
        fixtureCount: 0,
        updatedAt: now,
        source
      };
      for (const [f, v] of Object.entries(wanted)) {
        if (v === undefined || v === "") continue;
        sp[f] = v;
        source.applied[f] = v;
      }
      if (!sp.department) sp.department = "";
      if (!sp.roomType) sp.roomType = "";
      if (!sp.floorType) sp.floorType = "";
      sp.spaceTasks = sp.roomType
        ? autoTasksFor(rules, typeIdFromLabelStrict(rules, String(sp.roomType)) ?? "")
        : [];
      sp.estimatedCleaningMinutes = computeMinutes(rules, sp as never).total;
      spaces.push(sp);
      if (key) byKey.set(key, sp);
      byComposite.set(compositeOf(system, building, floor, roomNumber, roomName), sp);
      summary.created++;
    } else {
      const prev = (existing.source as SourceRecord | undefined)?.applied ?? {};
      let changed = false;
      for (const [f, v] of Object.entries(wanted)) {
        if (v === undefined || v === "") { source.applied[f] = prev[f]; continue; }
        const cur = existing[f];
        const curBlank = cur === undefined || cur === null || cur === "";
        if (cur === v || String(cur ?? "") === String(v)) {
          source.applied[f] = v;
          continue; // already right
        }
        if (curBlank || String(cur ?? "") === String(prev[f] ?? " ")) {
          existing[f] = v;          // still what we set last time → safe to update
          source.applied[f] = v;
          changed = true;
        } else {
          summary.keptManualEdits++; // the manager changed it — keep their value
          source.applied[f] = cur;
        }
      }
      existing.source = source;
      if (changed) {
        existing.estimatedCleaningMinutes = computeMinutes(rules, existing as never).total;
        existing.updatedAt = now;
        summary.updated++;
      } else {
        summary.unchanged++;
      }
    }
  }

  summary.systems = [...systems];
  summary.buildings = [...buildings];
  summary.floors = [...floors];
  summary.duplicateRoomNumbers = [...roomNumbersSeen.entries()]
    .filter(([, n]) => n > 1).map(([rn]) => rn);
  if (summary.duplicateRoomNumbers.length) {
    summary.warnings.push(
      `Room number${summary.duplicateRoomNumbers.length > 1 ? "s" : ""} ` +
      summary.duplicateRoomNumbers.slice(0, 5).join(", ") +
      " appear more than once — each kept as its own room (they are different source records)."
    );
  }
  if (!area) {
    summary.warnings.push(
      "No usable square footage column was found. Rooms were imported without " +
      "areas — fill them in later, and workload for those rooms will show as " +
      "not yet calculable."
    );
  }
  return { summary, spaces };
}

// ── a floor plan uploaded LATER attaches to rooms that already exist ────────

export interface PlanImportLike {
  plan: { rooms?: { spaceId: string; pts: unknown }[]; [k: string]: unknown };
  spaces: SpaceRecord[];
}

/**
 * §9: when a plan (magicplan scan or AI-read picture/PDF) arrives after a
 * room list, its rooms are matched to existing spaces by Building + Floor +
 * Room Number and the GEOMETRY moves onto the existing room — no duplicate
 * room is created. Blank operational fields on the existing room are filled
 * from the plan; values already present are left alone. Rooms the plan shows
 * that the list didn't contain are added as new rooms.
 */
export function attachPlanToRooms(existing: SpaceRecord[], imported: PlanImportLike): {
  attached: number; added: number;
} {
  const keyOf = (b: unknown, f: unknown, rn: unknown) => {
    const rnN = norm(rn);
    return rnN ? `${norm(b)}|${norm(f)}|${rnN}` : "";
  };
  const numberIndex = new Map<string, SpaceRecord>();
  const looseIndex = new Map<string, SpaceRecord[]>();
  for (const sp of existing) {
    if (Array.isArray(sp.visualPts) && (sp.visualPts as unknown[]).length >= 3) continue; // already drawn
    const k = keyOf(sp.building, sp.floor, sp.roomNumber);
    if (k && !numberIndex.has(k)) numberIndex.set(k, sp);
    const rn = norm(sp.roomNumber);
    if (rn) {
      const arr = looseIndex.get(rn) ?? [];
      arr.push(sp);
      looseIndex.set(rn, arr);
    }
  }
  const VISUAL_FIELDS = [
    "visualPts", "visualPlanId", "visualBuilding", "visualFloor",
    "visualW", "visualH", "visualUpdatedAt", "floorPlanId"
  ];
  const FILL_FIELDS = ["squareFeet", "roomName", "roomType", "floorType", "building", "floor"];
  let attached = 0, added = 0;
  const idRemap = new Map<string, string>();
  const stillNew: SpaceRecord[] = [];
  for (const im of imported.spaces) {
    const exact = numberIndex.get(keyOf(im.building, im.floor, im.roomNumber));
    // a plan with no building/floor typed still matches when the room number
    // is unambiguous across the whole facility
    const loose = !exact && norm(im.roomNumber)
      ? (looseIndex.get(norm(im.roomNumber)) ?? []) : [];
    const target = exact ?? (loose.length === 1 ? loose[0] : undefined);
    if (!target) { stillNew.push(im); added++; continue; }
    for (const f of VISUAL_FIELDS) {
      if (im[f] !== undefined) target[f] = im[f];
    }
    for (const f of FILL_FIELDS) {
      const cur = target[f];
      if ((cur === undefined || cur === null || cur === "") && im[f] !== undefined && im[f] !== "") {
        target[f] = im[f];
      }
    }
    target.updatedAt = new Date().toISOString();
    idRemap.set(im.id, target.id);
    attached++;
  }
  for (const r of imported.plan.rooms ?? []) {
    const to = idRemap.get(r.spaceId);
    if (to) r.spaceId = to;
  }
  existing.push(...stillNew);
  return { attached, added };
}

// ── storage-level wrapper (classic page + hub share this) ──────────────────

/**
 * Run a room-list import directly against the canonical localStorage stores.
 * Also records the import in Classic's own importHistory, so the classic
 * app's import screens show it like any other import.
 */
export function importRoomListIntoStorage(
  sheets: RawSheet[], opts?: { fileName?: string }
): ImportSummary {
  const rules = loadRules();
  const aliases = loadAliases();
  let v7: Record<string, unknown> & { spaces?: SpaceRecord[]; importHistory?: unknown[] };
  try { v7 = JSON.parse(localStorage.getItem("opsmatrix_v7") ?? "{}") ?? {}; } catch { v7 = {}; }
  const spaces = Array.isArray(v7.spaces) ? v7.spaces : (v7.spaces = []);
  const { summary } = importRoomList(spaces, sheets, rules, aliases, opts);
  v7.spaces = spaces;
  const hist = Array.isArray(v7.importHistory) ? v7.importHistory : [];
  hist.unshift({
    id: summary.importId,
    fileName: summary.file,
    type: "Space Inventory",
    date: new Date().toLocaleDateString(),
    count: summary.created + summary.updated,
    warnings: summary.warnings.length,
    errors: 0,
    mode: summary.mode,
    sqftSource: summary.sqftSource
  });
  v7.importHistory = hist;
  localStorage.setItem("opsmatrix_v7", JSON.stringify(v7));
  return summary;
}
