// Derives approximate clickable room shapes from magicplan DXF wall strips.
// The DXF has walls but no room polygons, so we:
//   1. rasterize the wall geometry onto a coarse grid (pure JS, no canvas),
//   2. thicken the walls enough to close door gaps,
//   3. flood-fill outward from each room's label position, bounded by walls,
//   4. grow the filled region back toward the true walls,
//   5. trace the region outline (Moore-neighbor) and simplify it (RDP).
// Rooms whose fill escapes (open scan side) fall back to a rounded rectangle
// sized proportionally to the room's square footage, centered on its label.
import type { FloorGeometry } from "./types";

export interface RegionRoomInput {
  id: string;
  mapX: number | null;
  mapY: number | null;
  cleanableSqFt: number;
}

export interface RoomRegion {
  roomId: string;
  /** world-coordinate (feet) outline, closed implicitly */
  polygon: [number, number][];
  method: "flood" | "rect";
  /** approximate region area in sq ft (flood method only) */
  areaSqFt: number;
}

interface Options {
  maxGrid: number;       // longest grid side in cells
  wallDilateFt: number;  // thicken walls this much per side to close door gaps
  regrowFt: number;      // grow rooms back toward the walls afterwards
  simplifyEps: number;   // RDP epsilon, in cells
}

const DEFAULTS: Options = { maxGrid: 460, wallDilateFt: 1.7, regrowFt: 1.1, simplifyEps: 1.6 };

export function deriveRoomRegions(
  geometry: FloorGeometry,
  rooms: RegionRoomInput[],
  optsIn?: Partial<Options>
): Map<string, RoomRegion> {
  const opts = { ...DEFAULTS, ...optsIn };
  const out = new Map<string, RoomRegion>();
  const withLabel = rooms.filter((r) => r.mapX !== null && r.mapY !== null);
  if (!geometry || !geometry.walls.length || !withLabel.length) {
    for (const r of withLabel) out.set(r.id, rectFallback(r));
    return out;
  }

  // ---- grid setup ----
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const w of geometry.walls) for (const p of w.points) {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
  }
  const pad = 3;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const extent = Math.max(maxX - minX, maxY - minY);
  const cell = extent / opts.maxGrid;
  const W = Math.max(8, Math.ceil((maxX - minX) / cell));
  const H = Math.max(8, Math.ceil((maxY - minY) / cell));
  const idx = (x: number, y: number) => y * W + x;
  const toGX = (wx: number) => Math.floor((wx - minX) / cell);
  const toGY = (wy: number) => Math.floor((wy - minY) / cell);
  const toWX = (gx: number) => minX + (gx + 0.5) * cell;
  const toWY = (gy: number) => minY + (gy + 0.5) * cell;

  // ---- 1. rasterize wall polygons (scanline fill) ----
  const wall = new Uint8Array(W * H);
  for (const w of geometry.walls) {
    fillPolygon(w.points, wall, W, H, toGX, toGY, minX, minY, cell);
  }

  // ---- 2. dilate walls to close door gaps ----
  const dilateRounds = Math.max(1, Math.round(opts.wallDilateFt / cell));
  const blocked = dilate(wall, W, H, dilateRounds);

  // ---- 3. flood fill from each label ----
  const owner = new Int16Array(W * H).fill(-1);
  const results: { room: RegionRoomInput; cells: number[]; escaped: boolean }[] = [];
  withLabel.forEach((room, ri) => {
    let sx = clamp(toGX(room.mapX!), 0, W - 1);
    let sy = clamp(toGY(room.mapY!), 0, H - 1);
    // if the seed sits inside a (dilated) wall or a claimed cell, search nearby
    const seed = findFreeSeed(sx, sy, blocked, owner, W, H, Math.max(3, dilateRounds * 2));
    if (!seed) { results.push({ room, cells: [], escaped: true }); return; }
    const cells: number[] = [];
    let escaped = false;
    const queue = [idx(seed[0], seed[1])];
    owner[queue[0]] = ri;
    const maxCells = Math.max(600, (room.cleanableSqFt * 3.5) / (cell * cell));
    while (queue.length) {
      const c = queue.pop()!;
      cells.push(c);
      if (cells.length > maxCells) { escaped = true; break; }
      const cx = c % W, cy = Math.floor(c / W);
      if (cx === 0 || cy === 0 || cx === W - 1 || cy === H - 1) { escaped = true; break; }
      const nb = [c - 1, c + 1, c - W, c + W];
      for (const n of nb) {
        if (owner[n] === -1 && !blocked[n]) { owner[n] = ri; queue.push(n); }
      }
    }
    results.push({ room, cells, escaped });
  });

  // ---- 4. grow non-escaped regions back toward the true walls ----
  const regrowRounds = Math.max(0, Math.round(opts.regrowFt / cell));
  for (let round = 0; round < regrowRounds; round++) {
    const additions: [number, number][] = []; // [cellIndex, regionIdx]
    for (let ri = 0; ri < results.length; ri++) {
      if (results[ri].escaped) continue;
      for (const c of results[ri].cells) {
        const cx = c % W, cy = Math.floor(c / W);
        if (cx <= 0 || cy <= 0 || cx >= W - 1 || cy >= H - 1) continue;
        for (const n of [c - 1, c + 1, c - W, c + W]) {
          if (owner[n] === -1 && !wall[n]) additions.push([n, ri]);
        }
      }
    }
    for (const [c, ri] of additions) {
      if (owner[c] === -1) { owner[c] = ri; results[ri].cells.push(c); }
    }
  }

  // ---- 5. trace + simplify each region ----
  results.forEach((res, ri) => {
    const room = res.room;
    if (res.escaped || res.cells.length < 12) {
      out.set(room.id, rectFallback(room));
      return;
    }
    const mask = new Uint8Array(W * H);
    for (const c of res.cells) mask[c] = 1;
    const contour = traceBoundary(mask, W, H);
    if (!contour || contour.length < 4) {
      out.set(room.id, rectFallback(room));
      return;
    }
    const simplified = rdp(contour, opts.simplifyEps);
    out.set(room.id, {
      roomId: room.id,
      polygon: simplified.map(([gx, gy]) => [toWX(gx), toWY(gy)] as [number, number]),
      method: "flood",
      areaSqFt: res.cells.length * cell * cell
    });
  });
  return out;

  function rectFallback(room: RegionRoomInput): RoomRegion {
    const aspect = 1.4;
    const w = Math.sqrt(Math.max(20, room.cleanableSqFt) * aspect);
    const h = Math.max(20, room.cleanableSqFt) / w;
    const cx = room.mapX ?? 0, cy = room.mapY ?? 0;
    return {
      roomId: room.id,
      polygon: [
        [cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2],
        [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]
      ],
      method: "rect",
      areaSqFt: room.cleanableSqFt
    };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Scanline-fill one polygon into the grid. */
function fillPolygon(
  pts: [number, number][], grid: Uint8Array, W: number, H: number,
  toGX: (x: number) => number, toGY: (y: number) => number,
  minX: number, minY: number, cell: number
) {
  if (pts.length < 3) return;
  let gMinY = Infinity, gMaxY = -Infinity;
  for (const p of pts) {
    const gy = (p[1] - minY) / cell;
    if (gy < gMinY) gMinY = gy;
    if (gy > gMaxY) gMaxY = gy;
  }
  const y0 = clamp(Math.floor(gMinY), 0, H - 1);
  const y1 = clamp(Math.ceil(gMaxY), 0, H - 1);
  for (let gy = y0; gy <= y1; gy++) {
    const wy = minY + (gy + 0.5) * cell;
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a[1] <= wy && b[1] > wy) || (b[1] <= wy && a[1] > wy)) {
        xs.push(a[0] + ((wy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = clamp(Math.floor((xs[i] - minX) / cell), 0, W - 1);
      const x1c = clamp(Math.ceil((xs[i + 1] - minX) / cell), 0, W - 1);
      for (let gx = x0; gx <= x1c; gx++) grid[gy * W + gx] = 1;
    }
  }
}

function dilate(src: Uint8Array, W: number, H: number, rounds: number): Uint8Array {
  let cur = src;
  for (let r = 0; r < rounds; r++) {
    const next = new Uint8Array(cur);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const c = y * W + x;
        if (cur[c]) continue;
        if (cur[c - 1] || cur[c + 1] || cur[c - W] || cur[c + W] ||
            cur[c - W - 1] || cur[c - W + 1] || cur[c + W - 1] || cur[c + W + 1]) {
          next[c] = 1;
        }
      }
    }
    cur = next;
  }
  return cur;
}

function findFreeSeed(
  sx: number, sy: number, blocked: Uint8Array, owner: Int16Array,
  W: number, H: number, radius: number
): [number, number] | null {
  for (let r = 0; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = sx + dx, y = sy + dy;
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
        const c = y * W + x;
        if (!blocked[c] && owner[c] === -1) return [x, y];
      }
    }
  }
  return null;
}

/** Moore-neighbor boundary trace; returns grid-coordinate outline. */
function traceBoundary(mask: Uint8Array, W: number, H: number): [number, number][] | null {
  // find topmost-leftmost filled cell
  let start = -1;
  for (let i = 0; i < mask.length; i++) if (mask[i]) { start = i; break; }
  if (start === -1) return null;
  const sx = start % W, sy = Math.floor(start / W);
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1);
  // 8 directions clockwise starting from W
  const dirs: [number, number][] = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
  const path: [number, number][] = [[sx, sy]];
  let cx = sx, cy = sy;
  let backtrack = 0; // came from the west
  const maxSteps = W * H;
  for (let step = 0; step < maxSteps; step++) {
    let found = false;
    for (let i = 0; i < 8; i++) {
      const d = (backtrack + 1 + i) % 8;
      const nx = cx + dirs[d][0], ny = cy + dirs[d][1];
      if (at(nx, ny)) {
        // new backtrack = direction pointing back to the cell we came from
        backtrack = (d + 4) % 8;
        cx = nx; cy = ny;
        if (cx === sx && cy === sy) return path;
        path.push([cx, cy]);
        found = true;
        break;
      }
    }
    if (!found) return path; // single-cell region
  }
  return path;
}

/** Ramer–Douglas–Peucker simplification. */
function rdp(points: [number, number][], eps: number): [number, number][] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0, maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const d = perpDist(points[i], points[a], points[b]);
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > eps && maxI !== -1) {
      keep[maxI] = 1;
      stack.push([a, maxI], [maxI, b]);
    }
  }
  const out: [number, number][] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

function perpDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

/** Point-in-polygon (ray cast) for hit-testing. */
export function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polygonCentroid(poly: [number, number][]): [number, number] {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    a += f;
    cx += (poly[j][0] + poly[i][0]) * f;
    cy += (poly[j][1] + poly[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    // degenerate: average the points
    let sx = 0, sy = 0;
    for (const p of poly) { sx += p[0]; sy += p[1]; }
    return [sx / poly.length, sy / poly.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function polygonArea(poly: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  return Math.abs(a) / 2;
}

export function polygonBounds(poly: [number, number][]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY };
}
