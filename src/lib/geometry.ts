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
  mapX: number | null;
  mapY: number | null;
  cleanableSqFt: number;
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

/**
 * Closure patches for door/window openings plus a general small-gap healer.
 * A patch spans exactly between the cut ends of the two flanking wall strips,
 * so room interiors keep their precise drawn extent.
 */
export function sealingPatches(geometry: FloorGeometry, maxDoorFt = 4.6, healTolFt = 1.1): Pt[][] {
  const strips = (geometry?.walls ?? []).map((w) => w.points as Pt[]).filter((p) => p.length >= 3);
  if (!strips.length) return [];
  const edges = collectEdges(strips);
  const t = estimateThickness(edges);
  const endEdges = edges.filter((e) => e.len <= t * 2.6); // cut ends of strips
  const patches: Pt[][] = [];

  // 1) explicit patches at every door/window insert
  for (const o of geometry.openings ?? []) {
    // wall direction at the opening = direction of the nearest long edge
    let bestD = Infinity, u: Pt = [1, 0];
    for (const e of edges) {
      if (e.len <= t * 2.6) continue;
      const d = pointSegDist(o.x, o.y, e.a, e.b);
      if (d < bestD) { bestD = d; u = e.dir; }
    }
    const n: Pt = [-u[1], u[0]];
    const along = (p: Pt) => (p[0] - o.x) * u[0] + (p[1] - o.y) * u[1];
    const across = (p: Pt) => (p[0] - o.x) * n[0] + (p[1] - o.y) * n[1];
    // flanking cut ends: perpendicular-ish short edges near the wall line
    let right: Edge | null = null, left: Edge | null = null;
    let rD = maxDoorFt, lD = maxDoorFt;
    for (const e of endEdges) {
      if (Math.abs(e.dir[0] * u[0] + e.dir[1] * u[1]) > 0.5) continue; // not a cross-cut
      if (Math.abs(across(e.mid)) > t * 1.6) continue;                 // off the wall line
      const d = along(e.mid);
      if (d > 0.02 && d < rD) { rD = d; right = e; }
      if (d < -0.02 && -d < lD) { lD = -d; left = e; }
    }
    if (right && left) {
      patches.push(orderQuad([right.a, right.b, left.a, left.b]));
    } else if (right || left) {
      // odd geometry with a single flanking end: modest rectangle, union-safe
      const hl = maxDoorFt / 2, ht = t * 0.45;
      patches.push([
        [o.x - u[0] * hl - n[0] * ht, o.y - u[1] * hl - n[1] * ht],
        [o.x + u[0] * hl - n[0] * ht, o.y + u[1] * hl - n[1] * ht],
        [o.x + u[0] * hl + n[0] * ht, o.y + u[1] * hl + n[1] * ht],
        [o.x - u[0] * hl + n[0] * ht, o.y - u[1] * hl + n[1] * ht]
      ]);
    }
    // no flanking cut ends at all → the insert sits on solid wall (a window):
    // there is no gap to seal, so no patch — never shave interior area
  }

  // 2) general healer: bridge near-adjacent cut ends (scan imperfections)
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
  const wallRegion = unionPaths([...strips, ...patches].map(toIntPath));

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
  const unresolved: string[] = [];
  const claimed = new Set<number>();

  // labels per face
  const faceLabels: DeriveRoomInput[][] = faces.map(() => []);
  for (const room of rooms) {
    if (room.mapX === null || room.mapY === null) continue;
    for (let fi = 0; fi < faces.length; fi++) {
      if (pointInShape(room.mapX, room.mapY, faces[fi])) {
        faceLabels[fi].push(room);
        break; // faces don't overlap; first hit is the only hit
      }
    }
  }

  for (let fi = 0; fi < faces.length; fi++) {
    if (faceLabels[fi].length === 1) {
      const room = faceLabels[fi][0];
      shapes[room.id] = {
        outer: faces[fi].outer,
        holes: faces[fi].holes,
        source: "derived",
        areaSqFt: faces[fi].areaSqFt
      };
      claimed.add(fi);
    }
    // 0 labels → unlabeled face; ≥2 labels → a door seal failed somewhere:
    // don't guess, leave those rooms for the trace tool
  }
  for (const room of rooms) {
    if (!shapes[room.id]) unresolved.push(room.id);
  }
  return {
    shapes,
    unresolved,
    unlabeledFaces: faces.filter((_, fi) => !claimed.has(fi) && faceLabels[fi].length === 0)
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
