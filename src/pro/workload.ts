// Workload Intelligence aggregation: the SAME canonical rooms and the SAME
// cleaning-rules engine every other screen uses, rolled up the authoritative
// hierarchy — System → Building → Floor → Department → Room.
//
// Nothing here invents a formula: per-room minutes come from computeMinutes
// via weeklyMinutes(), and FTE is workload minutes ÷ productive minutes —
// the original OpsMatrix staffing algorithm. Rooms whose workload cannot be
// calculated yet (no room type, no square footage) are counted and shown as
// unresolved, never silently included or excluded.
import {
  type Rules, type CleanableSpaceLike, spaceCleanability, weeklyMinutes,
  estimatedFte, freqPerWeek, typeIdFromLabelStrict
} from "./rules";
import { blankDeptLabels, departmentDisplay } from "./roomListImport";

export interface WorkSpace extends CleanableSpaceLike {
  id: string;
  system?: string;
  building?: string;
  floor?: string;
  department?: string;
  departmentKey?: string;
  roomNumber?: string;
  roomName?: string;
  [k: string]: unknown;
}

export interface Totals {
  rooms: number;
  cleanableRooms: number;
  nonCleanableRooms: number;
  reviewRooms: number;
  /** cleanable rooms that still can't be priced (missing sqft etc.) */
  incalculableRooms: number;
  totalSqFt: number;
  cleanableSqFt: number;
  nonCleanableSqFt: number;
  unresolvedSqFt: number;
  weeklyMinutes: number;
  weeklyHours: number;
  dailyHours: number;
  fte: number;
  /** share of imported square footage classified well enough to calculate */
  coverage: number;
}

const zero = (): Totals => ({
  rooms: 0, cleanableRooms: 0, nonCleanableRooms: 0, reviewRooms: 0,
  incalculableRooms: 0, totalSqFt: 0, cleanableSqFt: 0, nonCleanableSqFt: 0,
  unresolvedSqFt: 0, weeklyMinutes: 0, weeklyHours: 0, dailyHours: 0,
  fte: 0, coverage: 0
});

function addSpace(t: Totals, rules: Rules, sp: WorkSpace) {
  const sqft = Number(sp.squareFeet) || 0;
  const clean = spaceCleanability(rules, sp);
  const weekly = weeklyMinutes(rules, sp);
  t.rooms++;
  t.totalSqFt += sqft;
  if (clean === "Cleanable") {
    t.cleanableRooms++;
    t.cleanableSqFt += sqft;
    if (weekly === null) { t.incalculableRooms++; t.unresolvedSqFt += sqft; }
    else t.weeklyMinutes += weekly;
  } else if (clean === "Non-cleanable") {
    t.nonCleanableRooms++;
    t.nonCleanableSqFt += sqft;
  } else {
    t.reviewRooms++;
    t.unresolvedSqFt += sqft;
  }
}

function finish(t: Totals, rules: Rules): Totals {
  t.weeklyHours = t.weeklyMinutes / 60;
  t.dailyHours = t.weeklyHours / 7;
  t.fte = estimatedFte(t.weeklyMinutes, rules);
  t.coverage = t.totalSqFt > 0 ? (t.totalSqFt - t.unresolvedSqFt) / t.totalSqFt : 1;
  return t;
}

export function facilityTotals(spaces: WorkSpace[], rules: Rules): Totals {
  const t = zero();
  for (const sp of spaces) addSpace(t, rules, sp);
  return finish(t, rules);
}

/** one node of the drill-down tree */
export interface WorkNode {
  key: string;
  label: string;
  level: "system" | "building" | "floor" | "department" | "room";
  totals: Totals;
  children: WorkNode[];
  space?: WorkSpace; // room level only
}

/**
 * The drill-down: System → Building → Floor → Department → Room. Departments
 * are grouped by IDENTITY (departmentKey), so two unnamed departments with
 * different source identities stay separate — their display labels are the
 * stable "Blank Department N" placeholders, never saved as names.
 */
export function buildTree(spaces: WorkSpace[], rules: Rules): WorkNode[] {
  const labels = blankDeptLabels(spaces);
  const roots = new Map<string, WorkNode>();
  const nodeIn = (map: Map<string, WorkNode>, key: string, label: string, level: WorkNode["level"]) => {
    let n = map.get(key);
    if (!n) { n = { key, label, level, totals: zero(), children: [] }; map.set(key, n); }
    return n;
  };
  const kids = new Map<WorkNode, Map<string, WorkNode>>();
  const childMap = (n: WorkNode) => {
    let m = kids.get(n);
    if (!m) { m = new Map(); kids.set(n, m); }
    return m;
  };

  for (const sp of spaces) {
    const sysLabel = String(sp.system ?? "").trim() || "Facility";
    const bldLabel = String(sp.building ?? "").trim() || "No building";
    const flrLabel = String(sp.floor ?? "").trim() || "No floor";
    const deptKey = String(sp.departmentKey ?? "").trim() || (String(sp.department ?? "").trim() || "~none");
    const deptLabel = departmentDisplay(sp, labels);

    const sys = nodeIn(roots, sysLabel.toLowerCase(), sysLabel, "system");
    const bld = nodeIn(childMap(sys), bldLabel.toLowerCase(), bldLabel, "building");
    const flr = nodeIn(childMap(bld), flrLabel.toLowerCase(), flrLabel, "floor");
    const dep = nodeIn(childMap(flr), deptKey.toLowerCase(), deptLabel, "department");
    const room: WorkNode = {
      key: sp.id,
      label: [sp.roomNumber, sp.roomName].filter(Boolean).join(" — ") || sp.id,
      level: "room", totals: zero(), children: [], space: sp
    };
    addSpace(room.totals, rules, sp);
    for (const n of [sys, bld, flr, dep]) addSpace(n.totals, rules, sp);
    childMap(dep).set(sp.id, room);
  }

  const attach = (n: WorkNode): WorkNode => {
    finish(n.totals, rules);
    const m = kids.get(n);
    if (m) {
      n.children = [...m.values()].map(attach);
      n.children.sort((a, b) =>
        b.totals.weeklyMinutes - a.totals.weeklyMinutes || a.label.localeCompare(b.label));
    }
    return n;
  };
  return [...roots.values()].map(attach)
    .sort((a, b) => b.totals.weeklyMinutes - a.totals.weeklyMinutes || a.label.localeCompare(b.label));
}

/** flat per-department rollup (for the Overview bar chart) */
export function byDepartment(spaces: WorkSpace[], rules: Rules): WorkNode[] {
  const labels = blankDeptLabels(spaces);
  const map = new Map<string, WorkNode>();
  for (const sp of spaces) {
    const key = String(sp.departmentKey ?? "").trim() || (String(sp.department ?? "").trim() || "~none");
    let n = map.get(key.toLowerCase());
    if (!n) {
      n = { key, label: departmentDisplay(sp, labels), level: "department", totals: zero(), children: [] };
      map.set(key.toLowerCase(), n);
    }
    addSpace(n.totals, rules, sp);
  }
  return [...map.values()].map((n) => { finish(n.totals, rules); return n; })
    .sort((a, b) => b.totals.weeklyMinutes - a.totals.weeklyMinutes || a.label.localeCompare(b.label));
}

/** flat per-floor rollup (for the Overview floor chart) */
export function byFloor(spaces: WorkSpace[], rules: Rules): WorkNode[] {
  const map = new Map<string, WorkNode>();
  for (const sp of spaces) {
    const label = String(sp.floor ?? "").trim() || "No floor";
    let n = map.get(label.toLowerCase());
    if (!n) {
      n = { key: label, label, level: "floor", totals: zero(), children: [] };
      map.set(label.toLowerCase(), n);
    }
    addSpace(n.totals, rules, sp);
  }
  return [...map.values()].map((n) => { finish(n.totals, rules); return n; })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

/**
 * Room-level explanation: exactly why one room contributes what it does,
 * using only numbers the engine actually produced.
 */
export function explainRoom(rules: Rules, sp: WorkSpace) {
  const clean = spaceCleanability(rules, sp);
  const tid = typeIdFromLabelStrict(rules, sp.roomType);
  const rt = rules.roomTypes.find((x) => x.id === tid);
  const weekly = weeklyMinutes(rules, sp);
  const perVisit = Number(sp.estimatedCleaningMinutes) || 0;
  return {
    cleanability: clean,
    roomTypeLabel: rt?.label ?? null,
    frequency: rt?.frequency ?? null,
    timesPerWeek: rt ? freqPerWeek(rt.frequency) : null,
    perVisitMinutes: perVisit,
    weeklyMinutes: weekly,
    weeklyHours: weekly === null ? null : weekly / 60,
    fte: weekly === null ? null : estimatedFte(weekly, rules)
  };
}
