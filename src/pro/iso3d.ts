// The 3D showcase projection — pure math, no canvas, no React.
//
// Josh's ask (2026-09-04): the matrix should read like the futuristic
// mockups — tilted, extruded glowing rooms, "more of a cube look" — and it
// must stay TRUE: no AI-generated imagery, no perspective warping. So this
// is an ORTHOGRAPHIC axonometric projection: spin the plan around its
// center, tilt it back, raise walls straight up. Orthographic means the
// whole ground-plane mapping is one affine matrix (a canvas setTransform
// can lay the baked neon plan down as the floor), parallel lines stay
// parallel, areas stay proportional, and the inverse is exact — a tap on a
// roof maps back to the same plan coordinates the 2D map uses.
//
// Conventions: plan coords x right / y down; z grows UP off the floor.
// tilt 0 = flat top-down (the 2D map); tilt ~1 rad leans the sheet back so
// walls show. The viewer sits toward screen-bottom, so larger rotated-y is
// CLOSER and must paint LATER (painter's algorithm).

export interface XY { x: number; y: number }

export interface IsoPose {
  /** rotation of the plan around its center, radians (spin) */
  spin: number;
  /** lean-back angle, radians; 0 = flat 2D, ~1.0 = the showcase view */
  tilt: number;
  /** plan center (rotation pivot), plan px */
  cx: number;
  cy: number;
}

/** the resting showcase pose: legible but unmistakably 3D */
export const REST_TILT = 0.96;   // ~55°
export const REST_SPIN = -0.17;  // ~-10° — enough to feel dimensional
/** wall height as a fraction of the plan's short side */
export const WALL_H_FRAC = 0.035;
/** the selected room stands taller — it answers "which one did I click" */
export const SEL_H_BOOST = 1.45;

/** project a plan-space point (with height z) to screen-ish iso space */
export function isoProject(p: IsoPose, x: number, y: number, z = 0): XY {
  const dx = x - p.cx, dy = y - p.cy;
  const cs = Math.cos(p.spin), sn = Math.sin(p.spin);
  const xr = dx * cs - dy * sn;
  const yr = dx * sn + dy * cs;
  return { x: p.cx + xr, y: p.cy + yr * Math.cos(p.tilt) - z * Math.sin(p.tilt) };
}

/** inverse of isoProject at a known height — exact, because it's affine */
export function isoUnproject(p: IsoPose, sx: number, sy: number, z = 0): XY {
  const xr = sx - p.cx;
  const ct = Math.cos(p.tilt);
  if (ct === 0) return { x: NaN, y: NaN }; // edge-on — nothing to invert
  const yr = (sy - p.cy + z * Math.sin(p.tilt)) / ct;
  const cs = Math.cos(p.spin), sn = Math.sin(p.spin);
  return { x: p.cx + xr * cs + yr * sn, y: p.cy - xr * sn + yr * cs };
}

/**
 * The ground plane (z=0) as a canvas-ready affine matrix
 * [a c e; b d f] — ctx.setTransform(a, b, c, d, e, f) maps plan px onto the
 * tilted floor, so the baked neon plan image IS the ground.
 */
export function isoGroundMatrix(p: IsoPose): { a: number; b: number; c: number; d: number; e: number; f: number } {
  const cs = Math.cos(p.spin), sn = Math.sin(p.spin), ct = Math.cos(p.tilt);
  // column images of the basis vectors under isoProject at z=0
  const a = cs, b = sn * ct;        // image of (1,0)
  const c = -sn, d = cs * ct;       // image of (0,1)
  const o = isoProject(p, 0, 0, 0); // image of the origin
  return { a, b, c, d, e: o.x, f: o.y };
}

/** painter's depth — bigger paints later (closer to the viewer) */
export function isoDepth(p: IsoPose, x: number, y: number): number {
  const dx = x - p.cx, dy = y - p.cy;
  return dx * Math.sin(p.spin) + dy * Math.cos(p.spin);
}

export interface IsoFace {
  /** screen-space polygon, ready to fill */
  pts: XY[];
  /** 0..1 how lit this face is (fake sun from screen-left) */
  light: number;
  /** painter's key within the room */
  depth: number;
}

export interface ExtrudedRoom {
  top: XY[];
  sides: IsoFace[];
  /** room-level painter's key (centroid depth) */
  depth: number;
  /** projected top-face centroid — where the label floats */
  labelAt: XY;
}

export function centroidOf(pts: XY[]): XY {
  let x = 0, y = 0;
  for (const q of pts) { x += q.x; y += q.y; }
  const n = Math.max(1, pts.length);
  return { x: x / n, y: y / n };
}

/**
 * Extrude one room polygon into roof + wall quads, all projected. Every
 * edge becomes a wall; far walls paint first and the near walls + roof
 * overpaint them, so winding order never matters. Face light comes from
 * the edge's outward direction — walls facing screen-left catch the key
 * light, giving the "cube" read.
 */
export function extrudeRoom(p: IsoPose, pts: XY[], wallH: number): ExtrudedRoom {
  const top: XY[] = [];
  const base: XY[] = [];
  for (const q of pts) {
    base.push(isoProject(p, q.x, q.y, 0));
    top.push(isoProject(p, q.x, q.y, wallH));
  }
  const sides: IsoFace[] = [];
  const cs = Math.cos(p.spin), sn = Math.sin(p.spin);
  for (let i = 0; i < pts.length; i++) {
    const aP = pts[i], bP = pts[(i + 1) % pts.length];
    // edge direction in the SPUN frame — light is fixed to the screen
    const ex = (bP.x - aP.x) * cs - (bP.y - aP.y) * sn;
    const ey = (bP.x - aP.x) * sn + (bP.y - aP.y) * cs;
    const len = Math.hypot(ex, ey) || 1;
    // outward-ish normal angle → light: brightest facing screen-left/top
    const light = 0.5 - 0.5 * (ey / len) * 0.6 - 0.5 * (ex / len) * 0.4;
    const mid = { x: (aP.x + bP.x) / 2, y: (aP.y + bP.y) / 2 };
    sides.push({
      pts: [base[i], base[(i + 1) % pts.length], top[(i + 1) % pts.length], top[i]],
      light: Math.max(0, Math.min(1, light)),
      depth: isoDepth(p, mid.x, mid.y)
    });
  }
  sides.sort((s, t) => s.depth - t.depth);
  const c = centroidOf(pts);
  return { top, sides, depth: isoDepth(p, c.x, c.y), labelAt: centroidOf(top) };
}

/** rooms painted back-to-front: ascending centroid depth */
export function drawOrder<T>(p: IsoPose, rooms: { pts: XY[]; item: T }[]): { pts: XY[]; item: T; depth: number }[] {
  return rooms
    .map((r) => {
      const c = centroidOf(r.pts);
      return { ...r, depth: isoDepth(p, c.x, c.y) };
    })
    .sort((a, b) => a.depth - b.depth);
}

// ── the spin-and-settle intro ───────────────────────────────────────────────

/** ease-out with a gentle overshoot — the same spring the motion system uses */
export function easeOutBack(t: number, s = 1.2): number {
  const u = t - 1;
  return 1 + u * u * ((s + 1) * u + s);
}

export function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

export const INTRO_MS = 1700;

/**
 * The load animation: the matrix sweeps in from flat and over-rotated,
 * spins around, and settles into the resting pose. t in [0,1] (already
 * time-normalized); returns the pose angles + a zoom factor that starts
 * pulled back and lands at 1.
 */
export function introPose(t: number): { spin: number; tilt: number; zoom: number } {
  const tc = Math.max(0, Math.min(1, t));
  const sweep = easeOutCubic(tc);          // the long glide
  const settle = easeOutBack(tc, 1.1);     // lands with a breath of overshoot
  return {
    spin: REST_SPIN + (1 - settle) * -1.9, // comes around ~110°
    tilt: REST_TILT * sweep,               // lifts from flat to the lean
    zoom: 0.82 + 0.18 * settle             // eases forward into place
  };
}

// ── color helpers for the painted faces ─────────────────────────────────────

/** #rrggbb → {r,g,b}; anything unparsable reads as the dim slate */
export function hexRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 51, g: 64, b: 77 };
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

/** scale a hex color toward black (f<1) or white (f>1), clamped */
export function shadeHex(hex: string, f: number): string {
  const { r, g, b } = hexRgb(hex);
  const ch = (v: number) => {
    const s = f <= 1 ? v * f : v + (255 - v) * Math.min(1, f - 1);
    return Math.max(0, Math.min(255, Math.round(s)));
  };
  const to2 = (v: number) => v.toString(16).padStart(2, "0");
  return "#" + to2(ch(r)) + to2(ch(g)) + to2(ch(b));
}

/** point-in-polygon (ray cast) — screen-space hit test for roofs */
export function pointInPoly(pts: XY[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
