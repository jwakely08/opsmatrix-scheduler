// Merge in Max Space (Josh, 2026-10-22): in the Map View, tap a room, then tap the room right
// next to it, and the two become ONE room — not just on the map, in all the data. The first room
// stays: its number, name, room type, floor type, department and priority. It takes on the other
// room's square feet, fixtures and tasks, its minutes are worked out again, and its outline becomes
// the two outlines joined (outlineJoin.ts). Everything that pointed at the second room now points
// at the first: schedules (running order, tasks, route stop minutes), non-space tasks, inspections,
// manager notes, the floor map and its picture, Sanitation and Policing routes, Floor Care stops
// and projects, and the Calibration Editor's saved drawing. Rooms that aren't right next to each
// other don't merge, and nothing changes.
import { joinOutlines } from "./outlineJoin";
import type { XY } from "./planSnap";
import { syncSpaceMinutes, type ClassicData, type ClassicPlan, type ClassicSpace } from "./classicStore";
import { fromClassicRoomTasks, includedTasksFor, toClassicRoomTasks, typeIdFromLabel, type Rules } from "./rules";
import { DOCK, type RouteStore } from "./routes";
import type { FcStore } from "./floorcare";
import type { StudioSet } from "./studioSets";
import { drawRoomsPicture } from "../bridge/aiPlanImport";

/** everything on this device a merge reaches */
export interface MergeStores {
  data: ClassicData;
  routes: RouteStore;
  floorCare: FcStore;
  sets: StudioSet[];
}

export type MergeResult =
  | {
    ok: true;
    /** the room that stayed, as it is now */
    keep: ClassicSpace;
    /** the rooms that went into it, as they were */
    merged: ClassicSpace[];
    /** which stores changed and need saving (the classic data always does) */
    plansChanged: boolean;
    routesChanged: boolean;
    floorCareChanged: boolean;
    setsChanged: StudioSet[];
  }
  | { ok: false; reason: string };

/** the thickest wall still "right next to each other" — rooms further apart don't merge */
export const MERGE_MAX_WALL_FT = 2;

const roomLabel = (sp: ClassicSpace) =>
  String(sp.roomNumber ?? "").trim() || String(sp.roomName ?? "").trim() || "that room";

const usable = (pts: unknown): pts is XY[] =>
  Array.isArray(pts) && pts.length >= 3 && pts.every((p) => p && Number.isFinite((p as XY).x) && Number.isFinite((p as XY).y));

function area(pts: XY[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  return Math.abs(a / 2);
}

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

/** a floor map's scale in plan pixels per foot: its own, or read off its rooms' square feet */
export function planPxPerFt(plan: ClassicPlan | undefined, roomsOnPlan: ClassicSpace[]): number | null {
  const own = Number(plan?.ratio);
  if (Number.isFinite(own) && own > 0) return own;
  const ratios: number[] = [];
  for (const sp of roomsOnPlan) {
    const sq = Number(sp.squareFeet);
    if (!(sq > 0) || !usable(sp.visualPts)) continue;
    const a = area(sp.visualPts);
    if (a > 0) ratios.push(Math.sqrt(a / sq));
  }
  if (!ratios.length) return null;
  ratios.sort((a, b) => a - b);
  return ratios[Math.floor(ratios.length / 2)];
}

/** a plan whose picture is drawn from its own room outlines (CAD, plan reading, rebuilt maps) */
function drawnFromRooms(plan: ClassicPlan): boolean {
  return typeof plan.img === "string" && plan.img.startsWith("data:image/svg+xml") &&
    (plan.source === "ai-plan-read" || plan.source === "rebuilt-from-rooms");
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Merge `otherIds` into `keepId`, through every store. Checks first and changes nothing when the
 * rooms can't merge (the reason says why, in plain English); otherwise changes the stores in place.
 */
export function mergeRooms(
  stores: MergeStores,
  keepId: string,
  otherIds: string[],
  rules: Rules,
  now = new Date().toISOString()
): MergeResult {
  const { data } = stores;
  const spaces = data.v7.spaces ?? [];
  const keep = spaces.find((s) => s.id === keepId);
  const others = [...new Set(otherIds)].filter((id) => id !== keepId)
    .map((id) => spaces.find((s) => s.id === id));
  if (!keep || !others.length || others.some((o) => !o)) {
    return { ok: false, reason: "That room isn't in Max Space anymore." };
  }
  const gone = others as ClassicSpace[];
  const members = [keep, ...gone];

  // ── check: same floor, and right next to each other ───────────────────────
  const where = (sp: ClassicSpace) => [norm(sp.building), norm(sp.floor)];
  for (const o of gone) {
    const [b1, f1] = where(keep), [b2, f2] = where(o);
    if ((b1 && b2 && b1 !== b2) || (f1 && f2 && f1 !== f2)) {
      return { ok: false, reason: `${roomLabel(keep)} and ${roomLabel(o)} are on different floors — only rooms right next to each other can merge.` };
    }
  }
  const drawn = members.filter((sp) => usable(sp.visualPts));
  const planIds = [...new Set(drawn.map((sp) => String(sp.visualPlanId ?? "")))];
  if (planIds.length > 1) {
    return { ok: false, reason: `${roomLabel(keep)} and ${roomLabel(gone[0])} are on different floor maps — only rooms right next to each other can merge.` };
  }
  const planId = planIds[0] ?? "";
  const plan = data.plans.find((p) => String(p.id) === planId);
  let outline: XY[] | null = null;
  if (drawn.length >= 2) {
    const onPlan = spaces.filter((sp) => String(sp.visualPlanId ?? "") === planId);
    const memberIds = new Set(members.map((m) => m.id));
    const joined = joinOutlines(drawn.map((sp) => sp.visualPts as XY[]), {
      unitsPerFt: planPxPerFt(plan, onPlan) ?? NaN,
      maxWallFt: MERGE_MAX_WALL_FT,
      others: onPlan.filter((sp) => !memberIds.has(sp.id) && usable(sp.visualPts)).map((sp) => sp.visualPts as XY[])
    });
    if ("refused" in joined) {
      const a = roomLabel(keep), b = roomLabel(gone[0]);
      return {
        ok: false,
        reason: joined.refused === "between"
          ? `Another room sits between ${a} and ${b} — only rooms right next to each other can merge.`
          : joined.refused === "around"
            ? `Joined, ${a} and ${b} would wrap all the way around another room — merge them in smaller pieces.`
            : `${a} and ${b} aren't right next to each other — only rooms that share a wall can merge.`
      };
    }
    outline = joined.pts.map((p) => ({ x: round1(p.x), y: round1(p.y) }));
  } else if (drawn.length === 1) {
    outline = (drawn[0].visualPts as XY[]).map((p) => ({ x: p.x, y: p.y }));
  }

  // ── what each schedule's base clean covered, before anything moves ────────
  const isMember = new Set(members.map((m) => m.id));
  const into = new Map(gone.map((o) => [o.id, keep.id]));
  const sqftOf = (id: string) => Number(spaces.find((s) => s.id === id)?.squareFeet) || 0;
  const primaryWeight = new Map<string, number>();
  for (const sched of data.v7.schedules ?? []) {
    let w = 0, any = false;
    for (const m of members) {
      if (sched.roomTasks?.[m.id]?.includes("general-cleaning")) { any = true; w += sqftOf(m.id); }
    }
    if (any) primaryWeight.set(sched.id, w);
  }
  const keptPrimary = String(keep.assignedScheduleId ?? "");
  const merged = gone.map((o) => JSON.parse(JSON.stringify(o)) as ClassicSpace);

  // ── the room that stays ───────────────────────────────────────────────────
  keep.squareFeet = Math.round(members.reduce((a, m) => a + (Number(m.squareFeet) || 0), 0) * 100) / 100;
  keep.fixtureCount = Math.round(members.reduce((a, m) => a + (Number(m.fixtureCount) || 0), 0));
  const included = includedTasksFor(rules, typeIdFromLabel(rules, String(keep.roomType ?? "")));
  const tasks: string[] = [];
  for (const m of members) {
    const list = Array.isArray(m.spaceTasks) ? m.spaceTasks : Array.isArray(m.fusionTasks) ? m.fusionTasks : [];
    for (const t of list) if (!tasks.includes(t) && !included.includes(t)) tasks.push(t);
  }
  keep.spaceTasks = tasks;
  const notes = [...new Set(members.map((m) => String(m.notes ?? "").trim()).filter(Boolean))];
  if (notes.length) keep.notes = notes.join("\n");
  // blanks in the kept room are filled from the others; what it has, it keeps
  for (const f of ["building", "floor", "department", "system"] as const) {
    if (!String(keep[f] ?? "").trim()) {
      const v = gone.map((o) => String(o[f] ?? "").trim()).find(Boolean);
      if (v) keep[f] = v;
    }
  }
  if (outline) {
    const from = drawn[0];
    keep.visualPts = outline;
    keep.visualPlanId = planId;
    keep.visualW = Number(keep.visualW) || Number(from.visualW) || plan?.w;
    keep.visualH = Number(keep.visualH) || Number(from.visualH) || plan?.h;
    if (!keep.visualBuilding && from.visualBuilding) keep.visualBuilding = from.visualBuilding;
    if (!keep.visualFloor && from.visualFloor) keep.visualFloor = from.visualFloor;
    keep.visualUpdatedAt = now;
  }
  syncSpaceMinutes(keep, rules);
  keep.updatedAt = now;
  data.v7.spaces = spaces.filter((s) => !into.has(s.id));

  // ── schedules: one stop where the rooms were, doing what was done in each ─
  for (const sched of data.v7.schedules ?? []) {
    const order = sched.spaceOrder ?? [];
    const rt = sched.roomTasks ?? {};
    const stops = sched.routeStopMinutes as Record<string, number> | undefined;
    const touched = order.some((id) => into.has(id)) || Object.keys(rt).some((id) => into.has(id)) ||
      (!!stops && typeof stops === "object" && Object.keys(stops).some((id) => into.has(id)));
    if (!touched) continue;
    const next: string[] = [];
    for (const id of order) {
      const to = into.get(id) ?? id;
      if (to === keep.id && next.includes(to)) continue;
      next.push(to);
    }
    sched.spaceOrder = next;
    const lists = members.map((m) => rt[m.id]).filter((l): l is string[] => Array.isArray(l));
    if (lists.length) {
      const union: string[] = [];
      for (const l of lists) for (const t of l) if (!union.includes(t)) union.push(t);
      for (const o of gone) delete rt[o.id];
      const { primary, tasks: all } = fromClassicRoomTasks(union);
      // a task the merged room's General Clean already does is no extra on any schedule
      const ours = all.filter((t) => !included.includes(t));
      if (!primary && !ours.length && all.length) {
        sched.spaceOrder = next.filter((id) => id !== keep.id);
        delete rt[keep.id];
      } else {
        rt[keep.id] = toClassicRoomTasks(keep, ours, primary);
      }
      sched.roomTasks = rt;
    }
    if (stops && typeof stops === "object") {
      let add = 0, moved = false;
      for (const o of gone) {
        if (o.id in stops) { add += Number(stops[o.id]) || 0; delete stops[o.id]; moved = true; }
      }
      if (moved) stops[keep.id] = (Number(stops[keep.id]) || 0) + add;
    }
    sched.updatedAt = now;
  }
  // only ONE schedule carries a room's base clean (setCoverage's rule): the kept room's own, else
  // the one that cleaned the most of the merged floor; the others keep just their extra tasks
  const primaries = (data.v7.schedules ?? [])
    .filter((s) => !s.projectNoteId && (s.roomTasks?.[keep.id] ?? []).includes("general-cleaning"));
  let winner = primaries.find((s) => s.id === keptPrimary) ?? null;
  if (!winner && primaries.length) {
    winner = [...primaries].sort((a, b) => (primaryWeight.get(b.id) ?? 0) - (primaryWeight.get(a.id) ?? 0))[0];
  }
  for (const s of primaries) {
    if (s === winner) continue;
    const { tasks: extra } = fromClassicRoomTasks(s.roomTasks![keep.id]);
    if (extra.length) {
      s.roomTasks![keep.id] = toClassicRoomTasks(keep, extra, false);
    } else {
      s.spaceOrder = (s.spaceOrder ?? []).filter((id) => id !== keep.id);
      delete s.roomTasks![keep.id];
    }
  }
  if (winner) keep.assignedScheduleId = winner.id;
  else if (!keptPrimary) {
    const legacy = gone.map((o) => String(o.assignedScheduleId ?? "")).find((id) => id && (data.v7.schedules ?? []).some((s) => s.id === id));
    if (legacy) keep.assignedScheduleId = legacy;
  }

  // ── non-space tasks, inspections, manager notes ───────────────────────────
  for (const t of data.nonSpace) {
    if (!(t.roomIds ?? []).some((id) => into.has(id))) continue;
    t.roomIds = [...new Set(t.roomIds.map((id) => into.get(id) ?? id))];
  }
  for (const i of (data.v7.inspections as Record<string, unknown>[] | undefined) ?? []) {
    if (!into.has(String(i.spaceId ?? ""))) continue;
    i.spaceId = keep.id;
    i.roomNum = keep.roomNumber;
    i.roomName = keep.roomName || keep.roomNumber;
    i.dept = keep.department;
  }
  for (const n of (data.v7.notes as Record<string, unknown>[] | undefined) ?? []) {
    if (into.has(String(n.linkedSpaceId ?? ""))) n.linkedSpaceId = keep.id;
  }

  // ── the floor map: one outline for the room, and a picture without the wall between ──
  let plansChanged = false;
  for (const p of data.plans) {
    if (!Array.isArray(p.rooms) || !p.rooms.some((r) => isMember.has(r.spaceId))) continue;
    const rooms: NonNullable<ClassicPlan["rooms"]> = [];
    let placed = false;
    for (const r of p.rooms) {
      if (!isMember.has(r.spaceId)) { rooms.push(r); continue; }
      if (outline && String(p.id) === planId) {
        if (!placed) { rooms.push({ spaceId: keep.id, pts: outline }); placed = true; }
        continue;
      }
      rooms.push({ spaceId: keep.id, pts: r.pts });
    }
    p.rooms = rooms;
    if (drawn.length >= 2 && String(p.id) === planId && drawnFromRooms(p)) {
      const ratio = Number(p.ratio);
      p.img = drawRoomsPicture(rooms.filter((r) => usable(r.pts)).map((r) => r.pts), p.w, p.h, ratio > 0 ? ratio : null);
    }
    plansChanged = true;
  }

  // ── Sanitation and Policing routes ────────────────────────────────────────
  let routesChanged = false;
  for (const r of stores.routes.sanitation) {
    if (!(r.seq ?? []).some((id) => into.has(id))) continue;
    const seq: string[] = [];
    for (const id of r.seq) {
      const to = into.get(id) ?? id;
      if (to === keep.id && seq.includes(to)) continue; // the merged room is visited once
      if (to === DOCK && seq[seq.length - 1] === DOCK) continue; // two returns in a row are one
      seq.push(to);
    }
    r.seq = seq;
    r.updatedAt = now;
    routesChanged = true;
  }
  for (const r of stores.routes.policing) {
    if (!(r.stops ?? []).some((s) => into.has(s.spaceId))) continue;
    const seen = new Set<string>();
    r.stops = r.stops.flatMap((s) => {
      const id = into.get(s.spaceId) ?? s.spaceId;
      const k = id + "\u0000" + s.taskId;
      if (id === keep.id && seen.has(k)) return [];
      seen.add(k);
      return [{ ...s, spaceId: id }];
    });
    r.updatedAt = now;
    routesChanged = true;
  }

  // ── Floor Care: one stop per task in the merged room ──────────────────────
  let floorCareChanged = false;
  for (const fc of stores.floorCare.schedules) {
    if (!(fc.stops ?? []).some((s) => into.has(s.spaceId))) continue;
    const seen = new Set<string>();
    fc.stops = fc.stops.flatMap((s) => {
      const id = into.get(s.spaceId) ?? s.spaceId;
      const k = id + "\u0000" + s.taskId;
      if (id === keep.id && seen.has(k)) return [];
      seen.add(k);
      return [{ ...s, spaceId: id }];
    });
    fc.updatedAt = now;
    floorCareChanged = true;
  }
  for (const pr of stores.floorCare.projects) {
    if (!pr.spaceId || !into.has(pr.spaceId)) continue;
    pr.spaceId = keep.id;
    pr.location = `${keep.roomNumber ?? ""} ${keep.roomName ?? ""}`.trim();
    floorCareChanged = true;
  }

  // ── the Calibration Editor's saved drawing: one shape for the merged room ─
  // (re-shipping the set after a remodel must land on the merged room, never bring the other back)
  const setsChanged: StudioSet[] = [];
  for (const set of stores.sets) {
    const map = set.spaceIdByShape ?? {};
    const hits = Object.entries(map).filter(([, sid]) => isMember.has(sid));
    if (!hits.length) continue;
    const keepShapeId = (hits.find(([, sid]) => sid === keep.id) ?? hits[0])[0];
    const goneShapes = new Set(hits.map(([sh]) => sh).filter((sh) => sh !== keepShapeId));
    const shape = (set.shapes ?? []).find((s) => s.id === keepShapeId);
    if (shape) {
      const pw = Number(keep.visualW) || Number(plan?.w), ph = Number(keep.visualH) || Number(plan?.h);
      if (outline && set.planId === planId && pw > 0 && ph > 0 && set.picture?.width > 0 && set.picture?.height > 0) {
        const sx = set.picture.width / pw, sy = set.picture.height / ph;
        shape.pts = outline.map((p) => ({ x: round1(p.x * sx), y: round1(p.y * sy) }));
      }
      const anchored = (set.shapes ?? []).some((s) => (s.id === keepShapeId || goneShapes.has(s.id)) && (s.knownSqFt ?? 0) > 0);
      shape.roomNumber = String(keep.roomNumber ?? "");
      shape.roomName = String(keep.roomName ?? "");
      shape.roomType = String(keep.roomType ?? "");
      shape.floorType = String(keep.floorType ?? "");
      shape.department = String(keep.department ?? "");
      shape.fixtureCount = Number(keep.fixtureCount) || 0;
      if (set.readMode || anchored) shape.knownSqFt = Math.round(Number(keep.squareFeet) || 0) || null;
    }
    set.shapes = (set.shapes ?? []).filter((s) => !goneShapes.has(s.id));
    const nextMap: Record<string, string> = {};
    for (const [sh, sid] of Object.entries(map)) if (!goneShapes.has(sh)) nextMap[sh] = sid;
    nextMap[keepShapeId] = keep.id;
    set.spaceIdByShape = nextMap;
    set.updatedAt = now;
    setsChanged.push(set);
  }

  return { ok: true, keep, merged, plansChanged, routesChanged, floorCareChanged, setsChanged };
}
