// Rooms that sit right next to each other, joined into one outline — Max Space's merge
// (mergeRooms.ts; Josh, 2026-10-22).
//
// Rooms drawn from a CAD file stop at the wall faces, so two neighbours sit a wall's thickness
// apart; rooms traced by hand may share an edge or overlap a little. The join paints the rooms on
// a fine grid (about an inch a cell) and fills the wall BETWEEN them: straight across, row by row
// and column by column, only where one room faces the other within a wall's thickness and no other
// room is in the way. Then it traces one outline around the lot. Square corners stay square, and
// rooms further apart than a thick wall (or touching only at a corner) aren't next to each other —
// the join says so instead of inventing floor.
import { rdp, type XY } from "./planSnap";

/** why rooms can't join: not next to each other · another room sits between them · joined, they'd wrap around another room */
export type JoinRefusal = "apart" | "between" | "around";

export interface JoinOptions {
  /** drawing units (plan pixels) per foot */
  unitsPerFt: number;
  /** the thickest wall that still counts as "right next to each other", in feet */
  maxWallFt?: number;
  /** the other rooms around them — the join never spreads into one */
  others?: XY[][];
}

export type JoinResult = { pts: XY[] } | { refused: JoinRefusal };

const CELL_FT = 0.1;
const MAX_CELLS = 1_500_000; // a join the size of a whole wing gets a coarser grid, never a slow one

const usable = (pts: unknown): pts is XY[] =>
  Array.isArray(pts) && pts.length >= 3 && pts.every((p) => p && Number.isFinite((p as XY).x) && Number.isFinite((p as XY).y));

interface Grid { ox: number; oy: number; cell: number; W: number; H: number }

/** every grid cell whose centre sits inside the polygon */
function fill(poly: XY[], g: Grid, visit: (i: number) => void) {
  const { ox, oy, cell, W, H } = g;
  let minY = Infinity, maxY = -Infinity;
  for (const p of poly) { if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  const j0 = Math.max(0, Math.floor((minY - oy) / cell - 0.5));
  const j1 = Math.min(H - 1, Math.ceil((maxY - oy) / cell - 0.5));
  const xs: number[] = [];
  for (let j = j0; j <= j1; j++) {
    const y = oy + (j + 0.5) * cell;
    xs.length = 0;
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
      const pa = poly[a], pb = poly[b];
      if ((pa.y > y) !== (pb.y > y)) xs.push(pa.x + ((y - pa.y) * (pb.x - pa.x)) / (pb.y - pa.y));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - ox) / cell - 0.5));
      const i1 = Math.min(W - 1, Math.floor((xs[k + 1] - ox) / cell - 0.5));
      for (let i = i0; i <= i1; i++) visit(j * W + i);
    }
  }
}

/** every grid cell a segment runs through, each side by side with the next */
function along(a: XY, b: XY, g: Grid, visit: (i: number) => void) {
  const { ox, oy, cell, W, H } = g;
  let x = Math.floor((a.x - ox) / cell), y = Math.floor((a.y - oy) / cell);
  const x1 = Math.floor((b.x - ox) / cell), y1 = Math.floor((b.y - oy) / cell);
  const dx = b.x - a.x, dy = b.y - a.y;
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(cell / dx) : Infinity, tdy = dy !== 0 ? Math.abs(cell / dy) : Infinity;
  let tx = dx !== 0 ? (sx > 0 ? ox + (x + 1) * cell - a.x : a.x - (ox + x * cell)) / Math.abs(dx) : Infinity;
  let ty = dy !== 0 ? (sy > 0 ? oy + (y + 1) * cell - a.y : a.y - (oy + y * cell)) / Math.abs(dy) : Infinity;
  const steps = Math.abs(x1 - x) + Math.abs(y1 - y);
  for (let n = 0; n <= steps; n++) {
    if (x >= 0 && y >= 0 && x < W && y < H) visit(y * W + x);
    if (tx < ty) { tx += tdx; x += sx; } else { ty += tdy; y += sy; }
  }
}

/** cells reachable from `start` through `pass`, side by side (not corner to corner) */
function reach(pass: Uint8Array, start: number, W: number, H: number, seen: Uint8Array, queue: Int32Array): void {
  seen.fill(0);
  if (!pass[start]) return;
  let head = 0, tail = 0;
  seen[start] = 1; queue[tail++] = start;
  const last = W * (H - 1);
  while (head < tail) {
    const i = queue[head++];
    const x = i % W;
    if (x > 0 && pass[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; queue[tail++] = i - 1; }
    if (x < W - 1 && pass[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; queue[tail++] = i + 1; }
    if (i >= W && pass[i - W] && !seen[i - W]) { seen[i - W] = 1; queue[tail++] = i - W; }
    if (i < last && pass[i + W] && !seen[i + W]) { seen[i + W] = 1; queue[tail++] = i + W; }
  }
}

/**
 * The outline of a region along its cells' edges, clockwise on screen (y down), as the corners
 * where it turns — in cell units. `start` must be the region's first cell in reading order.
 */
function traceOutline(region: Uint8Array, W: number, H: number, start: number): XY[] {
  const inside = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < H && region[j * W + i] === 1;
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1]; // east, south, west, north
  const sx = start % W, sy = Math.floor(start / W);
  let x = sx, y = sy, d = 0, steps = 0;
  const limit = 4 * (W + 1) * (H + 1);
  const out: XY[] = [];
  do {
    x += DX[d]; y += DY[d];
    // the two cells ahead of this corner, left and right of the heading
    let lx: number, ly: number, rx: number, ry: number;
    if (d === 0) { lx = x; ly = y - 1; rx = x; ry = y; }
    else if (d === 1) { lx = x; ly = y; rx = x - 1; ry = y; }
    else if (d === 2) { lx = x - 1; ly = y; rx = x - 1; ry = y - 1; }
    else { lx = x - 1; ly = y - 1; rx = x; ry = y - 1; }
    const nd = inside(lx, ly) ? (d + 3) % 4 : inside(rx, ry) ? d : (d + 1) % 4;
    if (nd !== d) out.push({ x, y });
    d = nd;
  } while (!(x === sx && y === sy && d === 0) && ++steps < limit);
  return out;
}

/**
 * Join rooms into one outline, or say why they can't be. The rooms must be right next to each
 * other: sharing an edge, overlapping, or facing each other across no more than a wall
 * (`maxWallFt`, 2 ft by default) with no other room in the way.
 */
export function joinOutlines(piecesIn: XY[][], opts: JoinOptions): JoinResult {
  const pieces = piecesIn.filter(usable);
  if (!pieces.length) return { refused: "apart" };
  if (pieces.length === 1) return { pts: pieces[0].map((p) => ({ x: p.x, y: p.y })) };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of pieces) for (const p of poly) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const bw = maxX - minX, bh = maxY - minY;
  if (!(bw > 0) || !(bh > 0)) return { refused: "apart" };
  // without a scale, assume the rooms span about 50 feet
  const upf = Number.isFinite(opts.unitsPerFt) && opts.unitsPerFt > 0 ? opts.unitsPerFt : Math.max(bw, bh) / 50;

  // the grid: ~an inch a cell, a little room around the edges
  let cell = CELL_FT * upf, W = 0, H = 0;
  for (let tries = 0; tries < 6; tries++) {
    W = Math.ceil(bw / cell) + 4;
    H = Math.ceil(bh / cell) + 4;
    if (W * H <= MAX_CELLS) break;
    cell *= Math.sqrt((W * H) / MAX_CELLS) * 1.05;
  }
  const g: Grid = { ox: minX - 2 * cell, oy: minY - 2 * cell, cell, W, H };
  const N = W * H;
  const wall = Math.max(1, Math.round(((opts.maxWallFt ?? 2) * upf) / cell)); // in cells

  // the rooms, numbered 1, 2, 3… (a room wholly under another counts as joined to it)
  const own = new Int32Array(N);
  const cells = new Int32Array(pieces.length + 1);
  pieces.forEach((poly, k) => fill(poly, g, (i) => { if (!own[i]) { own[i] = k + 1; cells[k + 1]++; } }));
  // …and every cell its outline runs through, so a room drawn as two areas joined by a
  // hairline (CAD corridors) stays one piece on the grid, and no room is too thin to show
  pieces.forEach((poly, k) => {
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
      along(poly[b], poly[a], g, (i) => { if (!own[i]) { own[i] = k + 1; cells[k + 1]++; } });
    }
  });
  const present: number[] = [];
  for (let k = 1; k <= pieces.length; k++) if (cells[k]) present.push(k);
  let start = -1;
  for (let i = 0; i < N && start < 0; i++) if (own[i]) start = i;
  if (start < 0) return { refused: "apart" };

  // the other rooms around them (numbered 1, 2, 3… on their own grid) — a zone drawn AROUND
  // these rooms doesn't count. CAD outlines often overlap a little, so a room counts as in the way
  // only when the join would cover a real part of it: over a quarter of it, and over a square foot.
  const other = new Int32Array(N);
  const otherFt2: number[] = [0];
  const gx1 = g.ox + W * cell, gy1 = g.oy + H * cell;
  const cellFt = cell / upf;
  for (const poly of opts.others ?? []) {
    if (!usable(poly)) continue;
    let ax = Infinity, ay = Infinity, bx = -Infinity, by = -Infinity;
    for (const p of poly) { if (p.x < ax) ax = p.x; if (p.x > bx) bx = p.x; if (p.y < ay) ay = p.y; if (p.y > by) by = p.y; }
    if (bx < g.ox || ax > gx1 || by < g.oy || ay > gy1) continue;
    const covered = new Int32Array(pieces.length + 1);
    fill(poly, g, (i) => { if (own[i]) covered[own[i]]++; });
    if (present.some((k) => covered[k] > cells[k] * 0.3)) continue;
    let a = 0;
    for (let p = 0, q = poly.length - 1; p < poly.length; q = p++) a += (poly[q].x + poly[p].x) * (poly[q].y - poly[p].y);
    const id = otherFt2.length;
    otherFt2.push(Math.abs(a / 2) / (upf * upf));
    fill(poly, g, (i) => { if (!own[i] && !other[i]) other[i] = id; });
  }
  /** the rooms `cells` would cover a real part of */
  const coveredRooms = (covers: (i: number) => boolean): Set<number> => {
    const n = new Map<number, number>();
    for (let i = 0; i < N; i++) if (other[i] && covers(i)) n.set(other[i], (n.get(other[i]) ?? 0) + 1);
    const out = new Set<number>();
    for (const [id, count] of n) {
      const ft2 = count * cellFt * cellFt;
      if (ft2 > 1 && ft2 > otherFt2[id] * 0.25) out.add(id);
    }
    return out;
  };

  const region = new Uint8Array(N);
  const seen = new Uint8Array(N), queue = new Int32Array(N);
  /** fill every wall between two DIFFERENT rooms, straight across (never across a room in `keepOut`),
   *  and see if that makes one piece */
  const joinWalls = (keepOut: Set<number>): boolean => {
    for (let i = 0; i < N; i++) region[i] = own[i] ? 1 : 0;
    const run = (first: number, count: number, step: number) => {
      let last = -1, lastLabel = 0;
      for (let n = 0, i = first; n < count; n++, i += step) {
        const o = own[i];
        if (!o) continue;
        if (last >= 0 && o !== lastLabel) {
          const gap = (i - last) / step - 1;
          if (gap >= 1 && gap <= wall) {
            let clear = true;
            if (keepOut.size) for (let k = last + step; k < i; k += step) if (other[k] && keepOut.has(other[k])) { clear = false; break; }
            if (clear) for (let k = last + step; k < i; k += step) region[k] = 1;
          }
        }
        last = i; lastLabel = o;
      }
    };
    for (let y = 0; y < H; y++) run(y * W, W, 1);
    for (let x = 0; x < W; x++) run(x, H, W);
    reach(region, start, W, H, seen, queue);
    const got = new Uint8Array(pieces.length + 1);
    for (let i = 0; i < N; i++) if (seen[i] && own[i]) got[own[i]] = 1;
    return present.every((k) => got[k]);
  };
  if (!joinWalls(new Set())) return { refused: "apart" };
  // a room the wall fill would cover a real part of stays out — joined around it, or not at all
  const inTheWay = coveredRooms((i) => seen[i] === 1 && !own[i]);
  if (inTheWay.size && !joinWalls(inTheWay)) return { refused: "between" };
  for (let i = 0; i < N; i++) region[i] = seen[i]; // only the joined piece

  // enclosed gaps (where walls cross, a column) are floor of the joined room — unless another room sits in one
  const outer = new Uint8Array(N);
  {
    let head = 0, tail = 0;
    const push = (i: number) => { if (!region[i] && !outer[i]) { outer[i] = 1; queue[tail++] = i; } };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
    const last = W * (H - 1);
    while (head < tail) {
      const i = queue[head++];
      const x = i % W;
      if (x > 0) push(i - 1);
      if (x < W - 1) push(i + 1);
      if (i >= W) push(i - W);
      if (i < last) push(i + W);
    }
  }
  const hole = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (!region[i] && !outer[i]) hole[i] = 1;
  if (coveredRooms((i) => hole[i] === 1).size) return { refused: "around" };
  for (let i = 0; i < N; i++) if (hole[i]) region[i] = 1;

  // trace it, straighten the stair-steps, and put the corners back exactly where the rooms had them
  let first = -1;
  for (let i = 0; i < N && first < 0; i++) if (region[i]) first = i;
  const loop = traceOutline(region, W, H, first);
  if (loop.length < 3) return { refused: "apart" };
  // the trace ends on its top-left corner; start there instead
  const corners = [loop[loop.length - 1], ...loop.slice(0, -1)].map((p) => ({ x: g.ox + p.x * cell, y: g.oy + p.y * cell }));
  const straight = rdp([...corners, corners[0]], cell).slice(0, -1);
  // a corner near one of the rooms' own corners takes it; otherwise each coordinate takes the
  // nearest wall line the rooms have (where a wall ends against another room's side)
  const originals = pieces.flat();
  const near = 1.5 * cell;
  const nearest = (v: number, key: "x" | "y") => {
    let best = v, bestD = near;
    for (const q of originals) {
      const d = Math.abs(q[key] - v);
      if (d <= bestD) { bestD = d; best = q[key]; }
    }
    return best;
  };
  const snapped = straight.map((p) => {
    let best: XY | null = null, bestD = near * near;
    for (const q of originals) {
      const dd = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (dd <= bestD) { bestD = dd; best = q; }
    }
    return best ? { x: best.x, y: best.y } : { x: nearest(p.x, "x"), y: nearest(p.y, "y") };
  });
  const pts: XY[] = [];
  for (const p of snapped) {
    const prev = pts[pts.length - 1];
    if (!prev || prev.x !== p.x || prev.y !== p.y) pts.push(p);
  }
  while (pts.length > 1 && pts[0].x === pts[pts.length - 1].x && pts[0].y === pts[pts.length - 1].y) pts.pop();
  return pts.length >= 3 ? { pts } : { refused: "apart" };
}
