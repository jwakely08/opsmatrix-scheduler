// Direct, careful access to the CLASSIC app's stores from the scheduling hub.
// The classic app is never running on this page (separate document), so there
// are no in-memory races: we read, we write, and when the user goes back,
// Classic loads whatever is here.
//
// TASK OWNERSHIP MODEL (the important idea):
//   • a SPACE owns its required task list (spaceTasks; general clean implicit)
//   • a SCHEDULE owns which of those tasks it covers per room
//     (sched.roomTasks[spaceId] — classic's own field; 'general-cleaning'
//     in that list marks PRIMARY coverage, i.e. the base clean)
//   • a room may appear on several schedules with different tasks — that's
//     how a floor tech runs the corridor while someone else high-dusts it.
//   • space.assignedScheduleId mirrors the PRIMARY schedule for Classic.
import {
  computeMinutes, requiredTasks, toClassicRoomTasks, fromClassicRoomTasks,
  loadRules, type Rules
} from "./rules";

/** room urgency, decided by the manager during Max Space validation */
export type Priority = "High" | "Medium" | "Low";
export const PRIORITIES: Priority[] = ["High", "Medium", "Low"];

export interface ClassicSpace {
  id: string;
  roomNumber?: string;
  roomName?: string;
  building?: string;
  floor?: string;
  department?: string;
  roomType?: string;
  floorType?: string;
  squareFeet?: number;
  fixtureCount?: number;
  estimatedCleaningMinutes?: number;
  assignedScheduleId?: string;
  visualPts?: { x: number; y: number }[];
  visualPlanId?: string;
  /** fusion extras (ignored by Classic, preserved by its saves) */
  spaceTasks?: string[];
  fusionTasks?: string[]; // legacy name
  vacuumDaysPerWeek?: number;
  /** how urgent this room is — set during Max Space validation, prints on the schedule */
  priority?: Priority;
  updatedAt?: string;
  [k: string]: unknown;
}

export interface ClassicSchedule {
  id: string;
  num?: string;
  name?: string;
  shift?: string;
  employeeId?: string;
  employee?: string;
  color?: string;
  targetHours?: number;
  spaceOrder?: string[];
  roomTasks?: Record<string, string[]>;
  projectNoteId?: string;
  [k: string]: unknown;
}

export interface ClassicEmployee {
  id: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  shift?: string;
  role?: string;
  [k: string]: unknown;
}

export interface ClassicPlan {
  id: string;
  building?: string;
  floor?: string;
  img: string;
  w: number;
  h: number;
  rooms?: { spaceId: string; pts: { x: number; y: number }[] }[];
  [k: string]: unknown;
}

export interface NonSpaceTask {
  id: string;
  name: string;
  hours: number;
  scheduleId: string;
  roomIds: string[];
}

const V7 = "opsmatrix_v7";
const PLANS = "opsmatrix_v7_plans";
const NONSPACE = "opsmatrix_fusion_nonspace";

export interface ClassicData {
  v7: Record<string, unknown> & {
    spaces?: ClassicSpace[];
    schedules?: ClassicSchedule[];
    employees?: ClassicEmployee[];
  };
  plans: ClassicPlan[];
  nonSpace: NonSpaceTask[];
}

export function loadClassic(): ClassicData {
  let v7: ClassicData["v7"] = {};
  let plans: ClassicPlan[] = [];
  let nonSpace: NonSpaceTask[] = [];
  try { v7 = JSON.parse(localStorage.getItem(V7) ?? "{}") ?? {}; } catch { v7 = {}; }
  try { plans = JSON.parse(localStorage.getItem(PLANS) ?? "[]") ?? []; } catch { plans = []; }
  try { nonSpace = JSON.parse(localStorage.getItem(NONSPACE) ?? "[]") ?? []; } catch { nonSpace = []; }
  // migrate legacy fusionTasks → spaceTasks
  for (const sp of v7.spaces ?? []) {
    if (!Array.isArray(sp.spaceTasks) && Array.isArray(sp.fusionTasks)) {
      sp.spaceTasks = sp.fusionTasks;
    }
  }
  return { v7, plans, nonSpace };
}

export function saveClassic(data: ClassicData) {
  localStorage.setItem(V7, JSON.stringify(data.v7));
  localStorage.setItem(NONSPACE, JSON.stringify(data.nonSpace));
}

/** apply the rules engine to one space (ALL its required tasks) for Classic */
export function syncSpaceMinutes(space: ClassicSpace, rules?: Rules) {
  const r = rules ?? loadRules();
  space.estimatedCleaningMinutes = computeMinutes(r, space).total;
  space.updatedAt = new Date().toISOString();
}

// ── coverage: which schedules cover which tasks in which rooms ──────────────

export interface Coverage { scheduleId: string; primary: boolean; tasks: string[]; }

export function coverageForSpace(data: ClassicData, spaceId: string): Coverage[] {
  const out: Coverage[] = [];
  for (const sched of data.v7.schedules ?? []) {
    if (sched.projectNoteId) continue;
    if (!(sched.spaceOrder ?? []).includes(spaceId)) continue;
    const { primary, tasks } = fromClassicRoomTasks(sched.roomTasks?.[spaceId]);
    out.push({ scheduleId: sched.id, primary, tasks });
  }
  return out;
}

/** required tasks of the space that NO schedule covers (plus base clean) */
export function uncovered(data: ClassicData, rules: Rules, space: ClassicSpace):
  { baseUncovered: boolean; tasks: string[] } {
  const cov = coverageForSpace(data, space.id);
  const covered = new Set<string>();
  let baseCovered = false;
  for (const c of cov) {
    if (c.primary) baseCovered = true;
    for (const t of c.tasks) covered.add(t);
  }
  return {
    baseUncovered: !baseCovered,
    tasks: requiredTasks(rules, space).filter((t) => !covered.has(t))
  };
}

/**
 * Set one schedule's coverage of one room. tasks = our task ids;
 * primary = covers the base general clean. Empty tasks + !primary → remove,
 * unless keepEmpty (an explicit "add to schedule, tasks picked next").
 */
export function setCoverage(
  data: ClassicData,
  spaceId: string,
  scheduleId: string,
  primary: boolean,
  tasks: string[],
  keepEmpty = false
) {
  const space = (data.v7.spaces ?? []).find((s) => s.id === spaceId);
  const sched = (data.v7.schedules ?? []).find((s) => s.id === scheduleId);
  if (!space || !sched) return;
  const inOrder = (sched.spaceOrder ?? []).includes(spaceId);
  const wants = primary || tasks.length > 0 || keepEmpty;
  if (wants && !inOrder) sched.spaceOrder = [...(sched.spaceOrder ?? []), spaceId];
  if (!wants && inOrder) {
    sched.spaceOrder = (sched.spaceOrder ?? []).filter((id) => id !== spaceId);
    if (sched.roomTasks) delete sched.roomTasks[spaceId];
  }
  if (wants) {
    sched.roomTasks = { ...(sched.roomTasks ?? {}), [spaceId]: toClassicRoomTasks(space, tasks, primary) };
  }
  // only ONE schedule may be primary for a room
  if (primary) {
    for (const other of data.v7.schedules ?? []) {
      if (other.id === scheduleId || other.projectNoteId) continue;
      const rt = other.roomTasks?.[spaceId];
      if (rt?.includes("general-cleaning")) {
        const { tasks: keep } = fromClassicRoomTasks(rt);
        if (keep.length) {
          other.roomTasks![spaceId] = toClassicRoomTasks(space, keep, false);
        } else {
          other.spaceOrder = (other.spaceOrder ?? []).filter((id) => id !== spaceId);
          delete other.roomTasks![spaceId];
        }
      }
    }
    space.assignedScheduleId = scheduleId;
  } else if (space.assignedScheduleId === scheduleId) {
    // this schedule no longer carries the base clean
    space.assignedScheduleId = "";
    for (const other of data.v7.schedules ?? []) {
      if (other.roomTasks?.[spaceId]?.includes("general-cleaning")) {
        space.assignedScheduleId = other.id;
        break;
      }
    }
  }
  space.updatedAt = new Date().toISOString();
}

/** minutes one schedule spends in one room (base only if primary) */
export function coverageMinutes(rules: Rules, space: ClassicSpace, cov: Coverage): number {
  return computeMinutes(rules, space, { tasks: cov.tasks, includeBase: cov.primary }).total;
}

export function scheduleMinutes(data: ClassicData, rules: Rules, sched: ClassicSchedule): number {
  const spaces = data.v7.spaces ?? [];
  let total = 0;
  for (const id of sched.spaceOrder ?? []) {
    const sp = spaces.find((s) => s.id === id);
    if (!sp) continue;
    const { primary, tasks } = fromClassicRoomTasks(sched.roomTasks?.[id]);
    total += computeMinutes(rules, sp, { tasks, includeBase: primary }).total;
  }
  for (const t of data.nonSpace) {
    if (t.scheduleId === sched.id) total += t.hours * 60;
  }
  return total;
}

// ── schedule CRUD ────────────────────────────────────────────────────────────

const SCHED_COLORS = ["#22c55e", "#3b82f6", "#eab308", "#ec4899", "#8b5cf6", "#14b8a6", "#f97316", "#06b6d4"];

export function createSchedule(data: ClassicData, name: string, shift: string, employeeId: string): ClassicSchedule {
  const scheds = data.v7.schedules ?? (data.v7.schedules = []);
  const used = scheds.map((s) => s.color);
  const emp = (data.v7.employees ?? []).find((e) => e.id === employeeId);
  const sched: ClassicSchedule = {
    id: "sched-" + Math.random().toString(36).slice(2, 9),
    num: String(101 + scheds.filter((s) => !s.projectNoteId).length),
    name, shift,
    employeeId: employeeId || "",
    employee: emp ? String(emp.displayName ?? "") : "",
    color: SCHED_COLORS.find((c) => !used.includes(c)) ?? SCHED_COLORS[scheds.length % SCHED_COLORS.length],
    targetHours: 8,
    spaceOrder: [], roomTasks: {}, tasks: [], notes: "",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  scheds.push(sched);
  return sched;
}

export function deleteSchedule(data: ClassicData, scheduleId: string) {
  data.v7.schedules = (data.v7.schedules ?? []).filter((s) => s.id !== scheduleId);
  for (const sp of data.v7.spaces ?? []) {
    if (sp.assignedScheduleId === scheduleId) sp.assignedScheduleId = "";
  }
  for (const t of data.nonSpace) {
    if (t.scheduleId === scheduleId) t.scheduleId = "";
  }
}

export function scheduleColor(schedules: ClassicSchedule[], id: string | undefined): string {
  const s = schedules.find((x) => x.id === id);
  return (s?.color as string) || "#64748b";
}

/**
 * A room's priority. Unset reads as Medium so nothing is ever blank on a
 * printed schedule and older rooms don't suddenly look unfinished.
 */
export function spacePriority(space: ClassicSpace): Priority {
  return PRIORITIES.includes(space.priority as Priority) ? (space.priority as Priority) : "Medium";
}

/**
 * Move a room earlier/later in a schedule's running order. spaceOrder IS the
 * order the rooms were tapped in, and that order is what the printed schedule
 * numbers 1, 2, 3… — so this is how a manager fixes a mis-tap.
 */
export function moveInSchedule(data: ClassicData, scheduleId: string, spaceId: string, dir: -1 | 1) {
  const sched = (data.v7.schedules ?? []).find((s) => s.id === scheduleId);
  if (!sched) return;
  const order = [...(sched.spaceOrder ?? [])];
  const i = order.indexOf(spaceId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  sched.spaceOrder = order;
  sched.updatedAt = new Date().toISOString();
}

/** the three floor finishes (wax or no wax, plus carpet) */
export const FLOOR_TYPES = ["Carpet", "Hard floor — finished", "Hard floor — unfinished"];

/** data-completeness check for the Spaces map (red = fix me) */
export function spaceIncomplete(space: ClassicSpace): string[] {
  const issues: string[] = [];
  if (!space.roomType || space.roomType === "Other") issues.push("room type");
  if (!space.floorType) issues.push("floor type");
  if (!Number(space.squareFeet)) issues.push("square feet");
  return issues;
}

// ── display geometry: clean, even, gap-free room shapes ─────────────────────

type XY = { x: number; y: number };

/** snap near-axis edges straight (display only — data stays untouched) */
export function rectifyForDisplay(pts: XY[]): XY[] {
  const out = pts.map((p) => ({ x: p.x, y: p.y }));
  for (let pass = 0; pass < 3; pass++) {
    for (let a = 0; a < out.length; a++) {
      const b = (a + 1) % out.length;
      const adx = Math.abs(out[b].x - out[a].x);
      const ady = Math.abs(out[b].y - out[a].y);
      if (ady <= adx * 0.22) { const my = (out[a].y + out[b].y) / 2; out[a].y = my; out[b].y = my; }
      else if (adx <= ady * 0.22) { const mx = (out[a].x + out[b].x) / 2; out[a].x = mx; out[b].x = mx; }
    }
  }
  const simplified: XY[] = [];
  for (let i = 0; i < out.length; i++) {
    const prev = simplified[simplified.length - 1];
    if (!prev || Math.hypot(out[i].x - prev.x, out[i].y - prev.y) > 2.5) simplified.push(out[i]);
  }
  return simplified.length >= 3 ? simplified : out;
}

export function pathFrom(pts: XY[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ") + " Z";
}

export function centroidOf(pts: XY[]): XY {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const f = pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    a += f; cx += (pts[j].x + pts[i].x) * f; cy += (pts[j].y + pts[i].y) * f;
  }
  if (Math.abs(a) < 1e-6) {
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function boundsOf(pts: XY[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function pointIn(pts: XY[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if ((pts[i].y > y) !== (pts[j].y > y) &&
      x < ((pts[j].x - pts[i].x) * (y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside;
  }
  return inside;
}
