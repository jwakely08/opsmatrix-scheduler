// Exact 2D geometry pipeline for room shapes — replaces the old raster
// flood-fill entirely.
//
//   walls (closed strips) ──union──► wall region
//        ──morphological closing (dilate +s, erode −s, MITER joins)──►
//   sealed wall region: door/window gaps ≤ 2s are bridged, every straight
//   edge and corner stays EXACTLY where it was drawn
//        ──extract holes──► interior faces = candidate room polygons
//        ──label containment──► room shapes (tight to the walls)
//
// Pure functions over plain data, unit-tested against the fixtures. Any
// future capture source (native LiDAR app) that produces wall polygons +
// label points feeds this same pipeline.
import ClipperLib from "clipper-lib";
import type { FloorGeometry } from "./types";

const SCALE = 100; // ints at 0.01 ft precision

export type Pt = [number, number];

export interface Face {
  outer: Pt[];
  holes: Pt[][];
  areaSqFt: number;
}

export interface RoomShape {
  outer: Pt[];
  holes: Pt[][];
  source: "derived" | "traced" | "edited";
  areaSqFt: number;
}

export interface DeriveResult {
  shapes: Record<string, RoomShape>;
  /** room ids that need the trace tool */
  unresolved: string[];
  /** enclosed faces no label claimed (closets, shafts…) — informational */
  unlabeledFaces: Face[];
}

export interface DeriveRoomInput {
  id: string;
  /** CSV room name — used for label-text matching (duplicates are fine) */
  name?: string;
  mapX: number | null;
  mapY: number | null;
  cleanableSqFt: number;
}

/** shared name normalization for CSV-name ↔ DXF-label comparison */
function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function namesMatch(a: string, b: string): boolean {
  const na = normName(a), nb = normName(b);
  if (!na || !nb) return false;
  return na === nb || na.startsWith(nb) || nb.startsWith(na) || na.includes(nb) || nb.includes(na);
}

// ---------- int/float conversion ----------
type IntPt = { X: number; Y: number };

function toIntPath(poly: Pt[]): IntPt[] {
  return poly.map((p) => ({ X: Math.round(p[0] * SCALE), Y: Math.round(p[1] * SCALE) }));
}
function fromIntPath(path: IntPt[]): Pt[] {
  return path.map((p) => [p.X / SCALE, p.Y / SCALE] as Pt);
}

function unionPaths(paths: IntPt[][]): IntPt[][] {
  const c = new ClipperLib.Clipper();
  // StrictlySimple is essential: without it, an enclosed region (a room) can
  // come back as a single self-touching path instead of an outer + hole pair
  c.StrictlySimple = true;
  c.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const out: IntPt[][] = [];
  c.Execute(ClipperLib.ClipType.ctUnion, out,
    ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return out;
}

// ---------- gap sealing (patches, not dilation — narrow rooms must survive) ----------

interface Edge { a: Pt; b: Pt; mid: Pt; dir: Pt; len: number; strip: number; }

function collectEdges(strips: Pt[][]): Edge[] {
  const edges: Edge[] = [];
  strips.forEach((poly, si) => {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-6) continue;
      edges.push({
        a, b,
        mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        dir: [(b[0] - a[0]) / len, (b[1] - a[1]) / len],
        len, strip: si
      });
    }
  });
  return edges;
}

/** typical wall thickness = median of the short strip edges */
function estimateThickness(edges: Edge[]): number {
  const shorts = edges.map((e) => e.len).sort((a, b) => a - b);
  if (!shorts.length) return 0.5;
  return Math.max(0.15, Math.min(2, shorts[Math.floor(shorts.length * 0.25)]));
}

/** order 4 points into a simple quad (angle sort around the centroid) */
function orderQuad(pts: Pt[]): Pt[] {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [...pts].sort((p, q) =>
    Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(q[1] - cy, q[0] - cx));
}

/** Everything the pipeline (and the door glyph renderer) knows about one opening. */
export interface OpeningInfo {
  x: number; y: number;
  name: string;
  /** unit vector along the wall */
  u: Pt;
  /** true when flanking wall ends were found — a real gap (a door) */
  isGap: boolean;
  /** gap span along the wall (ft), 0 for windows on solid wall */
  span: number;
  /** wall thickness estimate at the opening */
  thickness: number;
  /** the sealing quad (only when isGap) */
  quad: Pt[] | null;
}

/**
 * Analyze every insert by RAYCASTING against the actual wall material:
 * march from the opening point along the wall direction until wall polygons
 * are hit on both sides — that IS the gap, regardless of how the strips are
 * cut at the doorway (junctions, jamb geometry, angled walls). The sealing
 * quad spans hit-to-hit, flush with the measured wall thickness.
 */
export function analyzeOpenings(geometry: FloorGeometry, maxDoorFt = 4.6): OpeningInfo[] {
  const strips = (geometry?.walls ?? []).map((w) => w.points as Pt[]).filter((p) => p.length >= 3);
  if (!strips.length) return [];
  const edges = collectEdges(strips);
  const t = estimateThickness(edges);
  const out: OpeningInfo[] = [];

  const inWall = (x: number, y: number): boolean => {
    for (const s of strips) if (pointInPolygon(x, y, s)) return true;
    return false;
  };
  const STEP = 0.04;
  const march = (from: Pt, dir: Pt, maxD: number): number | null => {
    for (let d = STEP; d <= maxD; d += STEP) {
      if (inWall(from[0] + dir[0] * d, from[1] + dir[1] * d)) return d;
    }
    return null;
  };
  // wall band extent across the gap, measured just inside the hit wall
  const crossExtent = (p: Pt, n: Pt): { lo: number; hi: number } => {
    let hi = 0, lo = 0;
    for (let d = 0; d <= 2.2; d += STEP) {
      if (inWall(p[0] + n[0] * d, p[1] + n[1] * d)) hi = d; else if (d > t) break;
    }
    for (let d = 0; d <= 2.2; d += STEP) {
      if (inWall(p[0] - n[0] * d, p[1] - n[1] * d)) lo = d; else if (d > t) break;
    }
    return { lo, hi };
  };

  for (const o of geometry.openings ?? []) {
    // candidate gap directions: the few nearest long wall edges AND their
    // perpendiculars (a doorway at a T-junction often sits nearest to an edge
    // of the CROSSING wall — assuming that edge's axis marches into open room
    // space and misreads the door as solid)
    const nearest = edges
      .filter((e) => e.len > t * 2.6)
      .map((e) => ({ e, d: pointSegDist(o.x, o.y, e.a, e.b) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 4);
    const candDirs: Pt[] = [];
    const pushDir = (dir: Pt) => {
      if (!candDirs.some((c) => Math.abs(c[0] * dir[0] + c[1] * dir[1]) > 0.985)) candDirs.push(dir);
    };
    for (const { e } of nearest) {
      pushDir(e.dir);
      pushDir([-e.dir[1], e.dir[0]]);
    }
    if (!candDirs.length) candDirs.push([1, 0], [0, 1]);

    // evaluate every candidate; a two-sided hit with the SMALLEST span is the
    // true gap axis (the wrong axis reads long or one-sided)
    let best: { u: Pt; origin: Pt; tR: number | null; tL: number | null; nudged: number } | null = null;
    for (const u0 of candDirs) {
      const n0: Pt = [-u0[1], u0[0]];
      let origin: Pt = [o.x, o.y];
      let nudged = 0; // n-sign we escaped toward (wall material lies the other way)
      if (inWall(origin[0], origin[1])) {
        let freed = false;
        for (let d = STEP; d <= t * 2 && !freed; d += STEP) {
          for (const sgn of [1, -1]) {
            const cand: Pt = [o.x + n0[0] * d * sgn, o.y + n0[1] * d * sgn];
            if (!inWall(cand[0], cand[1])) { origin = cand; nudged = sgn; freed = true; break; }
          }
        }
        if (!freed) continue; // buried along this axis
      }
      const tR = march(origin, u0, maxDoorFt);
      const tL = march(origin, [-u0[0], -u0[1]], maxDoorFt);
      const cand = { u: u0, origin, tR, tL, nudged };
      const rank = (c: typeof cand) =>
        c.tR !== null && c.tL !== null ? (c.tR + c.tL) : c.tR !== null || c.tL !== null ? 100 : 1000;
      if (!best || rank(cand) < rank(best)) best = cand;
    }
    if (!best) {
      out.push({ x: o.x, y: o.y, name: o.name, u: [1, 0], isGap: false, span: 0, thickness: t, quad: null });
      continue;
    }
    const u = best.u;
    const n: Pt = [-u[1], u[0]];
    const origin = best.origin;
    const tR = best.tR, tL = best.tL;

    if (tR !== null && tL !== null) {
      const pR: Pt = [origin[0] + u[0] * (tR + 0.1), origin[1] + u[1] * (tR + 0.1)];
      const pL: Pt = [origin[0] - u[0] * (tL + 0.1), origin[1] - u[1] * (tL + 0.1)];
      const eR = crossExtent(pR, n);
      const eL = crossExtent(pL, n);
      // flush with the thinner of the two flanks, and never wider than a real
      // wall: at T-junctions both flanks can be long PARALLEL bands, and an
      // unclamped patch would swallow a strip of the room's interior
      const tMax = Math.min(1.0, Math.max(0.35, t * 1.5));
      let hi = Math.max(0.08, Math.min(eR.hi, eL.hi, tMax));
      let lo = Math.max(0.08, Math.min(eR.lo, eL.lo, tMax));
      if (best.nudged > 0) { lo = Math.max(lo, tMax); hi = 0.1; }       // wall lies at −n
      else if (best.nudged < 0) { hi = Math.max(hi, tMax); lo = 0.1; }  // wall lies at +n
      const aR = tR + 0.12, aL = tL + 0.12; // overlap into the walls so the union fuses
      out.push({
        x: o.x, y: o.y, name: o.name, u, isGap: true,
        span: tR + tL, thickness: hi + lo,
        quad: [
          [origin[0] + u[0] * aR + n[0] * hi, origin[1] + u[1] * aR + n[1] * hi],
          [origin[0] + u[0] * aR - n[0] * lo, origin[1] + u[1] * aR - n[1] * lo],
          [origin[0] - u[0] * aL - n[0] * lo, origin[1] - u[1] * aL - n[1] * lo],
          [origin[0] - u[0] * aL + n[0] * hi, origin[1] - u[1] * aL + n[1] * hi]
        ]
      });
    } else if (tR !== null || tL !== null) {
      const hl = maxDoorFt / 2, ht = t * 0.45;
      out.push({
        x: o.x, y: o.y, name: o.name, u, isGap: true, span: maxDoorFt, thickness: t,
        quad: [
          [origin[0] - u[0] * hl - n[0] * ht, origin[1] - u[1] * hl - n[1] * ht],
          [origin[0] + u[0] * hl - n[0] * ht, origin[1] + u[1] * hl - n[1] * ht],
          [origin[0] + u[0] * hl + n[0] * ht, origin[1] + u[1] * hl + n[1] * ht],
          [origin[0] - u[0] * hl + n[0] * ht, origin[1] - u[1] * hl + n[1] * ht]
        ]
      });
    } else {
      out.push({ x: o.x, y: o.y, name: o.name, u, isGap: false, span: 0, thickness: t, quad: null });
    }
  }
  return out;
}

/**
 * Closure patches for door/window openings plus a general small-gap healer.
 * A patch spans exactly between the cut ends of the two flanking wall strips,
 * so room interiors keep their precise drawn extent.
 */
export function sealingPatches(geometry: FloorGeometry, maxDoorFt = 4.6, healTolFt = 1.1): Pt[][] {
  const strips = (geometry?.walls ?? []).map((w) => w.points as Pt[]).filter((p) => p.length >= 3);
  if (!strips.length) return [];
  const patches: Pt[][] = [];

  // 1) explicit patches at every door insert
  for (const info of analyzeOpenings(geometry, maxDoorFt)) {
    if (info.quad) patches.push(info.quad);
  }

  // 2) general healer: bridge near-facing cut ends (scan imperfections and
  //    doorways that have no insert marker)
  const edges = collectEdges(strips);
  const t = estimateThickness(edges);
  const endEdges = edges.filter((e) => e.len <= t * 2.6);
  for (let i = 0; i < endEdges.length; i++) {
    for (let j = i + 1; j < endEdges.length; j++) {
      const e1 = endEdges[i], e2 = endEdges[j];
      if (e1.strip === e2.strip) continue;
      const d = Math.hypot(e1.mid[0] - e2.mid[0], e1.mid[1] - e2.mid[1]);
      if (d < 0.02 || d > healTolFt) continue;
      if (Math.abs(e1.dir[0] * e2.dir[0] + e1.dir[1] * e2.dir[1]) < 0.7) continue; // not parallel cuts
      patches.push(orderQuad([e1.a, e1.b, e2.a, e2.b]));
    }
  }
  return patches;
}

/**
 * Conservative outer-boundary closure for partially open scans: thin strips
 * along convex-hull edges that aren't already covered by walls. Only used
 * when normal extraction can't enclose the labeled rooms; floors that needed
 * it are flagged so the boundary can render as "approximate."
 */
export function hullClosureStrips(geometry: FloorGeometry): Pt[][] {
  const pts: Pt[] = [];
  for (const w of geometry?.walls ?? []) for (const p of w.points) pts.push(p as Pt);
  if (pts.length < 3) return [];
  // Andrew monotone chain
  const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));

  const edges = collectEdges((geometry.walls ?? []).map((w) => w.points as Pt[]).filter((p) => p.length >= 3));
  const t = estimateThickness(edges);
  // strip reaches inward past a typical wall thickness so it seals flush with
  // the interior — no thin leak channel between strip and the open room edge
  const IN = t * 1.5, OUT = 0.15;
  let cxAll = 0, cyAll = 0;
  for (const p of pts) { cxAll += p[0]; cyAll += p[1]; }
  cxAll /= pts.length; cyAll /= pts.length;

  const strips: Pt[][] = [];
  for (let i = 0, j = hull.length - 1; i < hull.length; j = i++) {
    const a = hull[j], b = hull[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.5) continue;
    // covered already? sample the midpoint against existing wall edges
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let minD = Infinity;
    for (const e of edges) minD = Math.min(minD, pointSegDist(mid[0], mid[1], e.a, e.b));
    if (minD < 1.2) continue; // a real wall is already there
    const u: Pt = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    let n: Pt = [-u[1], u[0]];
    // orient n toward the building interior
    if ((cxAll - mid[0]) * n[0] + (cyAll - mid[1]) * n[1] < 0) n = [-n[0], -n[1]];
    strips.push([
      [a[0] - n[0] * OUT, a[1] - n[1] * OUT],
      [b[0] - n[0] * OUT, b[1] - n[1] * OUT],
      [b[0] + n[0] * IN, b[1] + n[1] * IN],
      [a[0] + n[0] * IN, a[1] + n[1] * IN]
    ]);
  }
  return strips;
}

function pointSegDist(x: number, y: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const tt = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2));
  return Math.hypot(x - (a[0] + tt * dx), y - (a[1] + tt * dy));
}

function signedArea(path: IntPt[]): number {
  return ClipperLib.Clipper.Area(path);
}

// ---------- float-space polygon helpers ----------
export function pointInPolygon(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInShape(x: number, y: number, shape: { outer: Pt[]; holes: Pt[][] }): boolean {
  if (!pointInPolygon(x, y, shape.outer)) return false;
  for (const h of shape.holes) if (pointInPolygon(x, y, h)) return false;
  return true;
}

export function polygonArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  return Math.abs(a) / 2;
}

export function shapeAreaSqFt(shape: { outer: Pt[]; holes: Pt[][] }): number {
  return polygonArea(shape.outer) - shape.holes.reduce((s, h) => s + polygonArea(h), 0);
}

export function polygonCentroid(poly: Pt[]): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    a += f;
    cx += (poly[j][0] + poly[i][0]) * f;
    cy += (poly[j][1] + poly[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0, sy = 0;
    for (const p of poly) { sx += p[0]; sy += p[1]; }
    return [sx / poly.length, sy / poly.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function polygonBounds(poly: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY };
}

/** Ramer–Douglas–Peucker with a tiny epsilon — kills jitter, keeps corners. */
export function simplifyPolygon(poly: Pt[], eps = 0.02): Pt[] {
  if (poly.length < 5) return poly;
  const keep = new Uint8Array(poly.length);
  keep[0] = 1; keep[poly.length - 1] = 1;
  const stack: [number, number][] = [[0, poly.length - 1]];
  const perp = (p: Pt, a: Pt, b: Pt) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
  };
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0, maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const d = perp(poly[i], poly[a], poly[b]);
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > eps && maxI !== -1) {
      keep[maxI] = 1;
      stack.push([a, maxI], [maxI, b]);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) if (keep[i]) out.push(poly[i]);
  return out.length >= 3 ? out : poly;
}

// ---------- the pipeline ----------

export interface ExtractOptions {
  /** widest gap an opening patch may span (ft) */
  maxDoorFt?: number;
  /** widest gap the general healer bridges without an insert (ft) */
  healTolFt?: number;
  /** ignore enclosed faces smaller than this (wall cavities, noise) */
  minRoomSqFt?: number;
  /** extra sealing polygons (hull closure strips for open scans) */
  extraStrips?: Pt[][];
}

/**
 * Seal door/window gaps with exact patches, union the wall geometry, then
 * return every enclosed interior face (polygon with holes), tight to the
 * drawn walls. No dilation anywhere — narrow rooms keep their exact extent.
 */
export function extractRoomFaces(geometry: FloorGeometry, options?: ExtractOptions): Face[] {
  const minRoomSqFt = options?.minRoomSqFt ?? 4;
  const strips = (geometry?.walls ?? [])
    .map((w) => w.points as Pt[])
    .filter((p) => p.length >= 3);
  if (!strips.length) return [];

  const patches = sealingPatches(geometry, options?.maxDoorFt, options?.healTolFt);
  const wallRegion = unionPaths(
    [...strips, ...patches, ...(options?.extraStrips ?? [])].map(toIntPath));

  // Interior = (bounding box) − (sealed walls). Each enclosed open region
  // comes back as its OWN positive polygon — rooms can never get stitched
  // together the way hole-paths of a union can. The one region touching the
  // bounding frame is the outside world; it gets discarded.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s2 of strips) for (const p of s2) {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
  }
  const M = 5; // frame margin (ft)
  const bbox: Pt[] = [
    [minX - M, minY - M], [maxX + M, minY - M],
    [maxX + M, maxY + M], [minX - M, maxY + M]
  ];
  const c = new ClipperLib.Clipper();
  c.StrictlySimple = true;
  c.AddPath(toIntPath(bbox), ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(wallRegion, ClipperLib.PolyType.ptClip, true);
  let paths: IntPt[][] = [];
  c.Execute(ClipperLib.ClipType.ctDifference, paths,
    ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  const cleaned = ClipperLib.Clipper.CleanPolygons(paths, 0.015 * SCALE);
  if (Array.isArray(cleaned) && cleaned.length) paths = cleaned;

  const outers: IntPt[][] = [];
  const holes: IntPt[][] = [];
  for (const p of paths) {
    if (!p || p.length < 3) continue;
    (signedArea(p) > 0 ? outers : holes).push(p);
  }

  const eps = 0.5; // ft — proximity to the frame marks the outside region
  const nearFrame = (poly: Pt[]) => poly.some((p) =>
    p[0] < minX - M + eps || p[0] > maxX + M - eps ||
    p[1] < minY - M + eps || p[1] > maxY + M - eps);

  const faces: Face[] = [];
  for (const o of outers) {
    const areaSqFt = signedArea(o) / (SCALE * SCALE);
    if (areaSqFt < minRoomSqFt) continue;
    const outerF = simplifyPolygon(fromIntPath(o));
    if (nearFrame(outerF)) continue; // the outside world, not a room
    // islands: wall chunks / shafts fully inside this face (negative paths)
    const islands: Pt[][] = [];
    let islandArea = 0;
    for (const h of holes) {
      const p0 = h[0];
      if (pointInPolygon(p0.X / SCALE, p0.Y / SCALE, outerF)) {
        const hf = simplifyPolygon(fromIntPath(h).reverse());
        islands.push(hf);
        islandArea += Math.abs(signedArea(h)) / (SCALE * SCALE);
      }
    }
    faces.push({ outer: outerF, holes: islands, areaSqFt: areaSqFt - islandArea });
  }
  return faces;
}

/**
 * Match extracted faces to rooms by label containment.
 * Every room ends up either with a wall-tight shape or on the unresolved
 * list (which the guided trace tool then covers — 100% coverage either way).
 */
export function deriveShapes(
  geometry: FloorGeometry,
  rooms: DeriveRoomInput[],
  options?: ExtractOptions
): DeriveResult {
  const faces = extractRoomFaces(geometry, options);
  const shapes: Record<string, RoomShape> = {};
  const claimedFace = new Set<number>();
  const claimedRoom = new Set<string>();

  // DXF labels contained in each face (text matching works even when several
  // rooms share a name — assignment below is one-to-one, ranked by how well
  // the face's area agrees with the room's CSV square footage)
  const faceLabelTexts: string[][] = faces.map((f) =>
    (geometry.labels ?? [])
      .filter((l) => pointInShape(l.x, l.y, f))
      .map((l) => l.text));

  interface Candidate { fi: number; roomId: string; areaErr: number; }
  const candidates: Candidate[] = [];
  for (let fi = 0; fi < faces.length; fi++) {
    for (const room of rooms) {
      const byName = room.name !== undefined &&
        faceLabelTexts[fi].some((txt) => namesMatch(txt, room.name!));
      const byPoint = room.mapX !== null && room.mapY !== null &&
        pointInShape(room.mapX, room.mapY, faces[fi]);
      if (!byName && !byPoint) continue;
      const areaErr = room.cleanableSqFt > 0
        ? Math.abs(faces[fi].areaSqFt - room.cleanableSqFt) / room.cleanableSqFt
        : 0.5;
      candidates.push({ fi, roomId: room.id, areaErr });
    }
  }
  // best area agreement wins; each face and each room used at most once
  candidates.sort((a, b) => a.areaErr - b.areaErr);
  for (const c of candidates) {
    if (claimedFace.has(c.fi) || claimedRoom.has(c.roomId)) continue;
    // a face that "matches" but disagrees wildly on area is not a match —
    // it's two merged rooms or a fragment; leave it for tuning/rescue
    if (c.areaErr > 0.5) continue;
    claimedFace.add(c.fi);
    claimedRoom.add(c.roomId);
    shapes[c.roomId] = {
      outer: faces[c.fi].outer,
      holes: faces[c.fi].holes,
      source: "derived",
      areaSqFt: faces[c.fi].areaSqFt
    };
  }

  return {
    shapes,
    unresolved: rooms.filter((r) => !claimedRoom.has(r.id)).map((r) => r.id),
    unlabeledFaces: faces.filter((_, fi) => !claimedFace.has(fi))
  };
}

// ---------- auto-tuned derivation (the normal path) ----------

export interface AutoDeriveResult extends DeriveResult {
  /** the winning tolerances, for the diagnostic overlay */
  tuning: { maxDoorFt: number; healTolFt: number; usedHullClosure: boolean };
}

/**
 * Fuzzy CSV-name ↔ DXF-label matcher. Real exports rarely agree exactly
 * (case, stray spaces, unicode escapes, truncation).
 */
export function matchLabel(
  labels: { text: string; x: number; y: number }[],
  roomName: string
): { x: number; y: number } | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const target = norm(roomName);
  if (!target) return null;
  let candidate =
    labels.find((l) => norm(l.text) === target) ??
    labels.find((l) => norm(l.text).startsWith(target) || target.startsWith(norm(l.text))) ??
    labels.find((l) => norm(l.text).includes(target) || target.includes(norm(l.text)));
  return candidate ? { x: candidate.x, y: candidate.y } : null;
}

/**
 * The pipeline the app actually calls. Runs the extraction at increasing
 * healing tolerances (and, as a last resort, with a conservative hull
 * closure), scores each run by how many labeled rooms were found and how
 * well face areas agree with the CSV square footages, and keeps the best.
 * CSV areas validate and select — they never fabricate shapes. Rooms that
 * still lack a shape get one final chance: an unlabeled face whose area
 * uniquely matches their CSV area within 12%.
 */
export function deriveShapesAuto(
  geometry: FloorGeometry,
  rooms: DeriveRoomInput[],
  options?: { minRoomSqFt?: number }
): AutoDeriveResult {
  const combos: { maxDoorFt: number; healTolFt: number; hull: boolean }[] = [];
  for (const hull of [false, true]) {
    for (const healTolFt of [0.7, 1.2, 2.0, 3.0, 4.2]) {
      for (const maxDoorFt of [4.6, 6.2]) combos.push({ maxDoorFt, healTolFt, hull });
    }
  }
  const hullStrips = hullClosureStrips(geometry);

  let best: { res: DeriveResult; score: number; combo: typeof combos[0] } | null = null;
  for (const combo of combos) {
    const res = deriveShapes(geometry, rooms, {
      maxDoorFt: combo.maxDoorFt,
      healTolFt: combo.healTolFt,
      minRoomSqFt: options?.minRoomSqFt,
      extraStrips: combo.hull ? hullStrips : undefined
    });
    const assigned = Object.keys(res.shapes).length;
    let areaScore = 0;
    for (const room of rooms) {
      const s = res.shapes[room.id];
      if (!s || !room.cleanableSqFt) continue;
      const rel = Math.abs(s.areaSqFt - room.cleanableSqFt) / room.cleanableSqFt;
      areaScore += Math.max(0, 1 - rel);
    }
    // prefer: more rooms assigned » better area agreement » no hull closure » gentler healing
    const score = assigned * 10000 + areaScore * 100 - (combo.hull ? 5 : 0) - combo.healTolFt;
    if (!best || score > best.score) best = { res, score, combo };
    if (assigned === rooms.length && areaScore / Math.max(1, rooms.length) > 0.9 && !combo.hull) break;
  }

  const res = best!.res;
  // last-chance rescue: unlabeled face whose area uniquely matches a CSV room
  const stillUnresolved = rooms.filter((r) => !res.shapes[r.id]);
  for (const room of stillUnresolved) {
    if (!room.cleanableSqFt) continue;
    const matches = res.unlabeledFaces
      .map((f, i) => ({ f, i, rel: Math.abs(f.areaSqFt - room.cleanableSqFt) / room.cleanableSqFt }))
      .filter((m) => m.rel < 0.12)
      .sort((a, b) => a.rel - b.rel);
    // only when unambiguous: exactly one face fits this room's square footage
    if (matches.length === 1) {
      const { f, i } = matches[0];
      res.shapes[room.id] = { outer: f.outer, holes: f.holes, source: "derived", areaSqFt: f.areaSqFt };
      res.unlabeledFaces.splice(i, 1);
      res.unresolved = res.unresolved.filter((id) => id !== room.id);
    }
  }

  return {
    ...res,
    tuning: {
      maxDoorFt: best!.combo.maxDoorFt,
      healTolFt: best!.combo.healTolFt,
      usedHullClosure: best!.combo.hull
    }
  };
}

/**
 * Merge several room shapes into one polygon. Door patches that touch two or
 * more of the shapes act as bridges, so the merged room flows through its
 * doorways instead of coming back as disconnected pieces.
 */
export function mergeShapes(
  geometry: FloorGeometry,
  parts: { outer: Pt[]; holes: Pt[][] }[]
): { outer: Pt[]; holes: Pt[][]; areaSqFt: number } | null {
  if (parts.length < 2) return null;
  const bridgeQuads: Pt[][] = [];
  for (const info of analyzeOpenings(geometry)) {
    if (!info.quad) continue;
    // a doorway connects two rooms across the wall band: probe a little way
    // out on each side of the wall line and see which parts we land in
    const n: Pt = [-info.u[1], info.u[0]];
    const reach = info.thickness / 2 + 0.4;
    const touched = new Set<number>();
    for (const d of [reach, -reach, reach * 1.8, -reach * 1.8]) {
      const px = info.x + n[0] * d, py = info.y + n[1] * d;
      parts.forEach((p, pi) => { if (pointInShape(px, py, p)) touched.add(pi); });
    }
    if (touched.size >= 2) {
      // widen the sealing quad across the wall so the union overlaps both rooms
      const cx = info.quad.reduce((s, q) => s + q[0], 0) / info.quad.length;
      const cy = info.quad.reduce((s, q) => s + q[1], 0) / info.quad.length;
      bridgeQuads.push(info.quad.map(([x, y]) => {
        const side = Math.sign((x - cx) * n[0] + (y - cy) * n[1]) || 1;
        return [x + n[0] * 0.55 * side, y + n[1] * 0.55 * side] as Pt;
      }));
    }
  }
  const c = new ClipperLib.Clipper();
  c.StrictlySimple = true;
  c.AddPaths([...parts.map((p) => toIntPath(p.outer)), ...bridgeQuads.map(toIntPath)],
    ClipperLib.PolyType.ptSubject, true);
  for (const p of parts) for (const h of p.holes) {
    c.AddPath(toIntPath(h), ClipperLib.PolyType.ptClip, true);
  }
  const out: IntPt[][] = [];
  c.Execute(parts.some((p) => p.holes.length) ? ClipperLib.ClipType.ctDifference : ClipperLib.ClipType.ctUnion,
    out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  const outers = out.filter((p) => signedArea(p) > 0).sort((a, b) => signedArea(b) - signedArea(a));
  if (!outers.length) return null;
  if (outers.length > 1) return null; // still disconnected — caller keeps parts separate
  const holes = out.filter((p) => signedArea(p) < 0).map((h) => simplifyPolygon(fromIntPath(h).reverse()));
  const outer = simplifyPolygon(fromIntPath(outers[0]));
  return { outer, holes, areaSqFt: polygonArea(outer) - holes.reduce((s, h) => s + polygonArea(h), 0) };
}

function growQuad(quad: Pt[], by: number): Pt[] {
  const cx = quad.reduce((s, p) => s + p[0], 0) / quad.length;
  const cy = quad.reduce((s, p) => s + p[1], 0) / quad.length;
  return quad.map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    const d = Math.hypot(dx, dy) || 1;
    return [x + (dx / d) * by, y + (dy / d) * by] as Pt;
  });
}

/** Every pipeline stage in one bag — feeds the dev diagnostic overlay. */
export function debugExtract(geometry: FloorGeometry, rooms: DeriveRoomInput[]) {
  const auto = deriveShapesAuto(geometry, rooms);
  return {
    strips: (geometry?.walls ?? []).map((w) => w.points as Pt[]),
    patches: sealingPatches(geometry, auto.tuning.maxDoorFt, auto.tuning.healTolFt),
    hullStrips: auto.tuning.usedHullClosure ? hullClosureStrips(geometry) : [],
    faces: extractRoomFaces(geometry, {
      maxDoorFt: auto.tuning.maxDoorFt, healTolFt: auto.tuning.healTolFt,
      extraStrips: auto.tuning.usedHullClosure ? hullClosureStrips(geometry) : undefined
    }),
    result: auto
  };
}

/** Intersection area of two simple polygons, in sq ft (for overlap tests). */
export function intersectionAreaSqFt(a: Pt[], b: Pt[]): number {
  const c = new ClipperLib.Clipper();
  c.AddPath(toIntPath(a), ClipperLib.PolyType.ptSubject, true);
  c.AddPath(toIntPath(b), ClipperLib.PolyType.ptClip, true);
  const out: IntPt[][] = [];
  c.Execute(ClipperLib.ClipType.ctIntersection, out,
    ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  let total = 0;
  for (const p of out) total += Math.abs(signedArea(p));
  return total / (SCALE * SCALE);
}

/** Nearest point on any wall-strip edge within maxDist — for trace snapping. */
export function snapToWalls(
  geometry: FloorGeometry, x: number, y: number, maxDist: number
): Pt | null {
  let best: Pt | null = null;
  let bestD = maxDist;
  for (const w of geometry.walls) {
    const pts = w.points;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const ax = pts[j][0], ay = pts[j][1], bx = pts[i][0], by = pts[i][1];
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
      const px = ax + t * dx, py = ay + t * dy;
      const d = Math.hypot(x - px, y - py);
      if (d < bestD) { bestD = d; best = [px, py]; }
    }
  }
  return best;
}
