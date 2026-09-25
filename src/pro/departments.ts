// Departments as a first-class map concept (Josh, 2026-09-25): select rooms
// in Max Space and assign them to a department with a color; Max Schedules
// can then OUTLINE rooms in their department's color while the fill keeps
// showing who cleans them. Colors live in opsmatrix_v7 → settings.
// departmentColors so they sync and back up with everything else.
import type { ClassicData, ClassicSpace } from "./classicStore";

export type DeptColorMap = Record<string, string>;

/** distinct from SCHED_COLORS on purpose — a department outline must never
 *  read as some schedule's fill */
export const DEPT_PALETTE = [
  "#f43f5e", "#a855f7", "#0ea5e9", "#84cc16", "#f59e0b",
  "#10b981", "#6366f1", "#d946ef", "#f97316", "#2dd4bf"
];

export function deptColorMap(data: ClassicData): DeptColorMap {
  const settings = (data.v7.settings ?? {}) as { departmentColors?: unknown };
  const raw = settings.departmentColors;
  if (!raw || typeof raw !== "object") return {};
  const out: DeptColorMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) out[k] = v;
  }
  return out;
}

export function setDeptColor(data: ClassicData, dept: string, color: string) {
  const settings = (data.v7.settings ?? (data.v7.settings = {})) as { departmentColors?: DeptColorMap };
  const map = settings.departmentColors ?? (settings.departmentColors = {});
  map[dept.trim()] = color;
}

/** the department's color: the one the account picked, else a stable pick
 *  from the palette (same name → same color, everywhere, forever) */
export function colorForDept(dept: string | undefined, map: DeptColorMap): string | null {
  const d = String(dept ?? "").trim();
  if (!d) return null;
  if (map[d]) return map[d];
  let h = 0;
  for (let i = 0; i < d.length; i++) h = (h * 31 + d.charCodeAt(i)) >>> 0;
  return DEPT_PALETTE[h % DEPT_PALETTE.length];
}

/** every department in use, first-seen order preserved then sorted */
export function departmentsOf(spaces: Pick<ClassicSpace, "department">[]): string[] {
  return [...new Set(spaces.map((s) => String(s.department ?? "").trim()).filter(Boolean))].sort();
}

// ── department BORDERS (Josh, 2026-09-25): one outline around each
// CONTIGUOUS group of a department's rooms — never per-room boxes. A
// department split by someone else's hallway gets one border per side.
// Method: paint the department's room polygons into a small grid, close the
// wall-thickness gaps between neighbours (CAD rooms are inset by their
// walls, so touching rooms don't quite touch), find connected components,
// and trace each component's outer contour. All pure and unit-tested. ─────

export interface XY { x: number; y: number }

/** scanline-fill a polygon into a binary grid (even-odd) */
export function fillPoly(grid: Uint8Array, gw: number, gh: number, pts: XY[]) {
  if (pts.length < 3) return;
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(gh - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    const xs: number[] = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > cy) !== (b.y > cy)) {
        xs.push(a.x + ((cy - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.round(xs[k])), xb = Math.min(gw - 1, Math.round(xs[k + 1]) - 1);
      for (let x = xa; x <= xb; x++) grid[y * gw + x] = 1;
    }
  }
}

/** Chebyshev (box) dilation by r cells — closes wall gaps up to 2r wide */
export function dilate(grid: Uint8Array, gw: number, gh: number, r: number): Uint8Array {
  let cur = grid;
  for (let pass = 0; pass < r; pass++) {
    const next = new Uint8Array(cur);
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        if (cur[y * gw + x]) continue;
        if ((x > 0 && cur[y * gw + x - 1]) || (x < gw - 1 && cur[y * gw + x + 1]) ||
          (y > 0 && cur[(y - 1) * gw + x]) || (y < gh - 1 && cur[(y + 1) * gw + x])) {
          next[y * gw + x] = 1;
        }
      }
    }
    cur = next;
  }
  return cur;
}

/** label 4-connected components; returns labels (0 = empty) and the count */
export function components(grid: Uint8Array, gw: number, gh: number): { labels: Int32Array; count: number } {
  const labels = new Int32Array(gw * gh);
  let count = 0;
  const stack: number[] = [];
  for (let i = 0; i < grid.length; i++) {
    if (!grid[i] || labels[i]) continue;
    count++;
    stack.push(i);
    labels[i] = count;
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % gw, y = (k / gw) | 0;
      for (const n of [x > 0 ? k - 1 : -1, x < gw - 1 ? k + 1 : -1, y > 0 ? k - gw : -1, y < gh - 1 ? k + gw : -1]) {
        if (n >= 0 && grid[n] && !labels[n]) { labels[n] = count; stack.push(n); }
      }
    }
  }
  return { labels, count };
}

/**
 * Trace ONE component's outer contour (edge walker, filled cells kept on
 * the right, so the walk is clockwise in screen coordinates). Returns
 * lattice-corner points in grid units.
 */
export function traceOutline(filled: (x: number, y: number) => boolean, gw: number, gh: number, startX: number, startY: number): XY[] {
  // start on the TOP edge of a cell whose north neighbour is empty
  const pts: XY[] = [];
  // direction: 0=E, 1=S, 2=W, 3=N; position = lattice corner
  let x = startX, y = startY, dir = 0;
  const sx = x, sy = y, sdir = dir;
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  // cell to the RIGHT of travel and the cell RIGHT-AHEAD decide the turn
  const rightCell = (px: number, py: number, d: number): [number, number] =>
    d === 0 ? [px, py] : d === 1 ? [px - 1, py] : d === 2 ? [px - 1, py - 1] : [px, py - 1];
  const leftCell = (px: number, py: number, d: number): [number, number] =>
    d === 0 ? [px, py - 1] : d === 1 ? [px, py] : d === 2 ? [px - 1, py] : [px - 1, py - 1];
  const inb = (cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < gw && cy < gh;
  const f = (c: [number, number]) => inb(c[0], c[1]) && filled(c[0], c[1]);
  let guard = gw * gh * 8;
  do {
    pts.push({ x, y });
    // advance one lattice step
    const nx = x + DX[dir], ny = y + DY[dir];
    x = nx; y = ny;
    // choose the next direction: keep the region on the right
    const lc = f(leftCell(x, y, dir));
    const rc = f(rightCell(x, y, dir));
    if (lc) dir = (dir + 3) % 4;        // region grew across our path — turn left
    else if (!rc) dir = (dir + 1) % 4;  // region fell away — turn right
    // else straight
    if (--guard <= 0) break;
  } while (!(x === sx && y === sy && dir === sdir));
  return pts;
}

/** Ramer–Douglas–Peucker — smooths the staircase into clean segments */
export function simplifyLine(pts: XY[], eps: number): XY[] {
  if (pts.length <= 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = pts[a], B = pts[b];
    const dx = B.x - A.x, dy = B.y - A.y;
    const len = Math.hypot(dx, dy) || 1;
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i].x - A.x) * dy - (pts[i].y - A.y) * dx) / len;
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > eps && at > 0) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** point-in-polygon over a border (test + legend hit checks) */
export function pointInPtsDept(pts: XY[], x: number, y: number): boolean {
  let ok = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) ok = !ok;
  }
  return ok;
}

export interface DeptBorder { dept: string; color: string; pts: XY[] }

/**
 * Borders for every department: rooms in PLAN pixels in, contour polylines
 * in PLAN pixels out — one per contiguous cluster.
 * joinPx closes the wall-thickness gap between neighbouring rooms (default
 * scales with the plan); anything wider — a corridor someone else owns —
 * keeps clusters apart, exactly Josh's administration-split-by-billing case.
 */
export function departmentBorders(
  rooms: { dept: string; pts: XY[] }[],
  planW: number,
  planH: number,
  colors: DeptColorMap,
  opts?: { gridW?: number; joinPx?: number }
): DeptBorder[] {
  if (!(planW > 0) || !(planH > 0)) return [];
  const gridW = Math.min(opts?.gridW ?? 720, Math.max(64, Math.round(planW)));
  const s = gridW / planW;
  const gw = gridW, gh = Math.max(8, Math.round(planH * s));
  const joinPx = opts?.joinPx ?? Math.max(3, Math.min(planW, planH) * 0.004);
  const r = Math.max(1, Math.round((joinPx * s) / 2 + 0.5));

  const byDept = new Map<string, { pts: XY[] }[]>();
  for (const room of rooms) {
    const d = room.dept.trim();
    if (!d || room.pts.length < 3) continue;
    (byDept.get(d) ?? byDept.set(d, []).get(d)!).push({ pts: room.pts });
  }

  const out: DeptBorder[] = [];
  for (const [dept, list] of byDept) {
    const grid = new Uint8Array(gw * gh);
    for (const { pts } of list) {
      fillPoly(grid, gw, gh, pts.map((p) => ({ x: p.x * s, y: p.y * s })));
    }
    const grown = dilate(grid, gw, gh, r);
    const { labels, count } = components(grown, gw, gh);
    for (let c = 1; c <= count; c++) {
      // topmost-leftmost cell of the component = a guaranteed outer edge
      let start = -1;
      for (let i = 0; i < labels.length; i++) if (labels[i] === c) { start = i; break; }
      if (start < 0) continue;
      const sxCell = start % gw, syCell = (start / gw) | 0;
      const contour = traceOutline((x, y) => labels[y * gw + x] === c, gw, gh, sxCell, syCell);
      if (contour.length < 4) continue;
      const simplified = simplifyLine(contour, 1.6);
      out.push({
        dept,
        color: colorForDept(dept, colors) ?? "#94a3b8",
        pts: simplified.map((p) => ({ x: p.x / s, y: p.y / s }))
      });
    }
  }
  return out;
}

/** assign every selected room to the department (and remember the color) */
export function assignDepartment(
  data: ClassicData,
  spaceIds: Iterable<string>,
  dept: string,
  color?: string
): number {
  const want = new Set(spaceIds);
  const name = dept.trim();
  let n = 0;
  for (const sp of data.v7.spaces ?? []) {
    if (!want.has(sp.id)) continue;
    sp.department = name;
    n++;
  }
  if (name && color) setDeptColor(data, name, color);
  return n;
}
