// Direct, careful access to the CLASSIC app's stores from the Map Scheduler
// page. The classic app is never running on this page (it's a separate
// document), so there are no in-memory race conditions: we read, we write,
// and when the user goes back, Classic loads whatever is here.
import { computeMinutes, classicTaskIds, loadRules, type Rules } from "./rules";

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
  fusionTasks?: string[];
  vacuumDaysPerWeek?: number;
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
  fusionNonSpaceMinutes?: number;
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
  v7: Record<string, unknown> & { spaces?: ClassicSpace[]; schedules?: ClassicSchedule[]; employees?: unknown[] };
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
  return { v7, plans, nonSpace };
}

export function saveClassic(data: ClassicData) {
  localStorage.setItem(V7, JSON.stringify(data.v7));
  localStorage.setItem(NONSPACE, JSON.stringify(data.nonSpace));
  // plans are read-only here (created by import); no write needed
}

/** apply the rules engine to one space and keep Classic's fields coherent */
export function syncSpaceMinutes(space: ClassicSpace, rules?: Rules) {
  const r = rules ?? loadRules();
  space.estimatedCleaningMinutes = computeMinutes(r, space).total;
  space.updatedAt = new Date().toISOString();
}

/** move a space to a schedule (or none) and keep both sides coherent */
export function assignSpaceToSchedule(
  data: ClassicData,
  spaceId: string,
  scheduleId: string
) {
  const space = (data.v7.spaces ?? []).find((s) => s.id === spaceId);
  if (!space) return;
  const schedules = data.v7.schedules ?? [];
  for (const sched of schedules) {
    const inOrder = (sched.spaceOrder ?? []).includes(spaceId);
    const should = sched.id === scheduleId;
    if (should && !inOrder) {
      sched.spaceOrder = [...(sched.spaceOrder ?? []), spaceId];
      sched.roomTasks = { ...(sched.roomTasks ?? {}), [spaceId]: classicTaskIds(space) };
    } else if (!should && inOrder) {
      sched.spaceOrder = (sched.spaceOrder ?? []).filter((id) => id !== spaceId);
      if (sched.roomTasks) delete sched.roomTasks[spaceId];
    }
  }
  space.assignedScheduleId = scheduleId || "";
  space.updatedAt = new Date().toISOString();
}

export function scheduleColor(schedules: ClassicSchedule[], id: string | undefined): string {
  const s = schedules.find((x) => x.id === id);
  return (s?.color as string) || "#64748b";
}

export function scheduleMinutes(data: ClassicData, sched: ClassicSchedule): number {
  const spaces = data.v7.spaces ?? [];
  let total = 0;
  for (const id of sched.spaceOrder ?? []) {
    const sp = spaces.find((s) => s.id === id);
    if (sp) total += Number(sp.estimatedCleaningMinutes) || 0;
  }
  for (const t of data.nonSpace) {
    if (t.scheduleId === sched.id) total += t.hours * 60;
  }
  return total;
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
  // drop jitter vertices that barely move
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
