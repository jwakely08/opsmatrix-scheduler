// Calibration sets — the Calibration Editor's saved work (Josh's spec,
// step 16 + the return-from-the-nav flow). Every plan built in the Plan
// Studio is kept as an editable SET: the source picture, every drawn box,
// the calibration anchors, and the account/building/floor it shipped into.
// Reopening a set from the Calibration Editor home screen lets a manager
// move boxes and change details after a remodel — and shipping the update
// lands on the SAME Max Space rooms (ids preserved), so schedules, coverage
// and history never break.
import {
  syncSpaceMinutes, type ClassicData, type ClassicSpace
} from "./classicStore";
import { autoTasksFor, typeIdFromLabel, type Rules } from "./rules";
import type { ImportResult } from "../bridge/aiPlanImport";
import type { XY } from "./planSnap";

export interface StudioShapeData {
  id: string;
  pts: XY[];               // picture pixels
  roomNumber: string;
  roomName: string;
  roomType: string;        // Scope label ("" = pick later)
  floorType: string;
  fixtureCount: number;
  department: string;
  knownSqFt: number | null;
  source: "traced" | "ai";
}

export interface StudioSet {
  id: string;
  account: string;         // the hospital system — top of the hierarchy
  building: string;
  floor: string;
  picture: { dataUrl: string; width: number; height: number; aspect: number };
  shapes: StudioShapeData[];
  /** shape id → the Max Space room it shipped as (filled at first ship) */
  spaceIdByShape: Record<string, string>;
  /** the plan record this set owns in opsmatrix_v7_plans */
  planId: string;
  /** built from a WITH-info plan (sizes read off the sheet) — re-editing
   *  keeps the direct edit→ship flow, no calibration step */
  readMode?: boolean;
  createdAt: string;
  updatedAt: string;
}

const KEY = "opsmatrix_fusion_planstudio";

// buildPlanFromRooms stamps ids from Date.now() — two builds in the same
// millisecond would collide (and a re-ship could hand an OLD room's id to a
// NEW one). Rooms the Studio creates always get their own unique ids.
const freshId = () => "sp-studio-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);

export function loadStudioSets(): StudioSet[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

/** true when it saved; false when storage refused (quota) — the caller says
 *  so in plain English, the floor plan itself is safe either way */
export function saveStudioSet(set: StudioSet): boolean {
  try {
    const sets = loadStudioSets().filter((s) => s.id !== set.id);
    sets.push(set);
    localStorage.setItem(KEY, JSON.stringify(sets));
    return true;
  } catch { return false; }
}

export function deleteStudioSet(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadStudioSets().filter((s) => s.id !== id)));
  } catch { /* nothing to do */ }
}

/** per-shape info the reading itself can't carry (AiRoom has no dept etc.) */
function applyShapeDetails(sp: ClassicSpace, shape: StudioShapeData, account: string, rules: Rules) {
  sp.system = account || sp.system || "";
  sp.department = shape.department;
  sp.floorType = shape.floorType;
  sp.fixtureCount = Math.round(Number(shape.fixtureCount) || 0);
  sp.roomNumber = shape.roomNumber;
  sp.roomName = shape.roomName;
  if (shape.roomType) {
    sp.roomType = shape.roomType;
    sp.spaceTasks = autoTasksFor(rules, typeIdFromLabel(rules, shape.roomType));
  }
  syncSpaceMinutes(sp, rules);
}

/**
 * FIRST ship: the Studio's built result goes into Max Space; every room gets
 * the hierarchy (account → building → floor → department) and its details,
 * priced by the Scope engine. A room that ALREADY exists (imported earlier
 * from a room list, matched by room number within the same building) gets
 * the geometry attached instead of being duplicated — the same rule every
 * other plan path follows. Returns shape id → space id, so the set can be
 * re-edited later onto the same rooms.
 */
export function applyStudioShip(
  data: ClassicData,
  result: ImportResult,
  shapes: StudioShapeData[],
  account: string,
  rules: Rules
): Record<string, string> {
  const map: Record<string, string> = {};
  const spaces = data.v7.spaces ?? (data.v7.spaces = []);
  const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  const planId = String((result.plan as { id?: string }).id ?? "");
  const planRooms: { spaceId: string; pts: XY[] }[] = [];

  result.spaces.forEach((raw, i) => {
    const fresh = raw as unknown as ClassicSpace;
    const shape = shapes[i];
    if (!shape) return;
    // attach to an existing room when the number identifies exactly one
    const rn = norm(shape.roomNumber);
    const candidates = rn
      ? spaces.filter((s) => norm(s.roomNumber) === rn &&
        (!String(fresh.building ?? "").trim() || !String(s.building ?? "").trim() ||
          norm(s.building) === norm(fresh.building)))
      : [];
    const target = candidates.length === 1 ? candidates[0] : undefined;
    if (target) {
      target.visualPts = fresh.visualPts as XY[];
      target.visualW = fresh.visualW;
      target.visualH = fresh.visualH;
      target.visualPlanId = planId;
      if (!String(target.building ?? "").trim()) target.building = fresh.building;
      if (!String(target.floor ?? "").trim()) target.floor = fresh.floor;
      target.squareFeet = Number(fresh.squareFeet) || Number(target.squareFeet) || 0;
      applyShapeDetails(target, shape, account, rules);
      map[shape.id] = target.id;
      planRooms.push({ spaceId: target.id, pts: fresh.visualPts as XY[] });
    } else {
      fresh.id = freshId();
      applyShapeDetails(fresh, shape, account, rules);
      spaces.push(fresh);
      map[shape.id] = fresh.id;
      planRooms.push({ spaceId: fresh.id, pts: fresh.visualPts as XY[] });
    }
  });
  (result.plan as { rooms?: unknown }).rooms = planRooms;
  data.plans.push(result.plan as unknown as ClassicData["plans"][0]);
  return map;
}

/**
 * RE-ship after editing a saved set (a remodel): geometry, scale, square
 * footage and details land on the SAME rooms. Shapes added since last time
 * become new rooms on the same plan; shapes deleted since last time leave
 * their rooms in Max Space but take their drawing away (data is never
 * silently destroyed by a plan edit).
 */
export function applyStudioUpdate(
  data: ClassicData,
  set: StudioSet,
  result: ImportResult,
  shapes: StudioShapeData[],
  rules: Rules
): Record<string, string> {
  const spaces = data.v7.spaces ?? (data.v7.spaces = []);
  const map: Record<string, string> = {};
  const freshPlan = result.plan as { img: string; w: number; h: number; ratio?: number };
  const planRooms: { spaceId: string; pts: XY[] }[] = [];

  result.spaces.forEach((raw, i) => {
    const fresh = raw as unknown as ClassicSpace;
    const shape = shapes[i];
    if (!shape) return;
    const existingId = set.spaceIdByShape[shape.id];
    const target = existingId ? spaces.find((s) => s.id === existingId) : undefined;
    if (target) {
      // same room, new drawing + numbers — schedules keep pointing at it
      target.visualPts = fresh.visualPts as XY[];
      target.visualW = fresh.visualW;
      target.visualH = fresh.visualH;
      target.visualPlanId = set.planId;
      target.squareFeet = Number(fresh.squareFeet) || 0;
      applyShapeDetails(target, shape, set.account, rules);
      map[shape.id] = target.id;
      planRooms.push({ spaceId: target.id, pts: fresh.visualPts as XY[] });
    } else {
      fresh.id = freshId();
      fresh.visualPlanId = set.planId;
      applyShapeDetails(fresh, shape, set.account, rules);
      fresh.building = set.building || fresh.building;
      fresh.floor = set.floor || fresh.floor;
      spaces.push(fresh);
      map[shape.id] = fresh.id;
      planRooms.push({ spaceId: fresh.id, pts: fresh.visualPts as XY[] });
    }
  });

  // rooms whose shape was deleted keep their data, lose their drawing
  const kept = new Set(Object.values(map));
  for (const oldId of Object.values(set.spaceIdByShape)) {
    if (kept.has(oldId)) continue;
    const orphan = spaces.find((s) => s.id === oldId);
    if (orphan && orphan.visualPlanId === set.planId) {
      delete orphan.visualPts;
      delete orphan.visualPlanId;
      orphan.updatedAt = new Date().toISOString();
    }
  }

  const plan = data.plans.find((p) => p.id === set.planId);
  if (plan) {
    plan.img = freshPlan.img;
    plan.w = freshPlan.w;
    plan.h = freshPlan.h;
    if (freshPlan.ratio) (plan as { ratio?: number }).ratio = freshPlan.ratio;
    plan.rooms = planRooms;
  } else {
    // the plan record vanished (cleared device) — recreate it under the set's id
    const p = result.plan as unknown as ClassicData["plans"][0];
    p.id = set.planId;
    p.rooms = planRooms;
    data.plans.push(p);
  }
  return map;
}
