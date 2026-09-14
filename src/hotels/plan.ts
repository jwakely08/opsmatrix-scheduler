// Floor-plan drawing for the hotel concept: polygons in → an SVG plan in the
// OpsMatrix house style (white ground, dark wall mass) → a Plan record the
// house map renders under the status layers. Same idea as the hospital
// engine's buildPlanFromRooms, copied here so the hotel side can evolve it.
import type { Plan, Pt, Space } from "./store";

const WALL_PX = 6;

export function polygonPath(pts: Pt[]): string {
  return pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ") + " Z";
}

export function centroid(pts: Pt[]): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const f = p.x * q.y - q.x * p.y;
    a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-6) {
    const n = pts.length || 1;
    return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
  }
  a *= 0.5;
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function polygonArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function pointIn(pts: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function boundsOf(pts: Pt[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  return { minX, minY, maxX, maxY };
}

export function rect(x: number, y: number, w: number, h: number): Pt[] {
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}

/** draw the plan: every space outline as wall mass, white floors, light labels */
export function buildPlanSvg(spaces: Space[], w: number, h: number): string {
  const walls = spaces.filter((s) => s.pts && s.pts.length >= 3)
    .map((s) => `<path d="${polygonPath(s.pts!)}" fill="#ffffff" stroke="#3a332e" stroke-width="${WALL_PX}" stroke-linejoin="round"/>`)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="#ffffff"/>${walls}</svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

export function buildPlan(id: string, floor: string, spaces: Space[], ratio: number): Plan {
  const all = spaces.flatMap((s) => s.pts ?? []);
  const b = all.length ? boundsOf(all) : { minX: 0, minY: 0, maxX: 800, maxY: 400 };
  const pad = 30;
  const w = Math.ceil(b.maxX + pad), hgt = Math.ceil(b.maxY + pad);
  return { id, floor, img: buildPlanSvg(spaces, w, hgt), w, h: hgt, ratio };
}

export type Shape = { pts: Pt[]; path: string; c: Pt };

export function shapesFor(spaces: Space[]): Map<string, Shape> {
  const m = new Map<string, Shape>();
  for (const s of spaces) {
    if (!s.pts || s.pts.length < 3) continue;
    m.set(s.id, { pts: s.pts, path: polygonPath(s.pts), c: centroid(s.pts) });
  }
  return m;
}
