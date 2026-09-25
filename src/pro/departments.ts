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
