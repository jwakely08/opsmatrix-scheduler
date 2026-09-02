// The wall-detection / snap-to-plan engine, ported verbatim from the archive's
// Floor Plans editor (opsmatrix-v5-maxplans.html, fp* helpers) so the Plan
// Studio can use the exact snapping Josh already trusts — "the snap function
// works great, we don't need to change anything with that." The archive stays
// read-only; this is a faithful TypeScript port, pure over a Gray struct so
// every piece is unit-testable without a browser.

export interface XY { x: number; y: number }

export interface Gray {
  data: Float32Array; // 0..1 luminance
  w: number;
  h: number;
  /** true when the plan is light-on-dark (mean luminance > 0.5 means dark INK) */
  dark: boolean;
}

/** luminance grid from raw RGBA pixels (pure — the testable core) */
export function grayFromPixels(px: Uint8ClampedArray | number[], w: number, h: number): Gray {
  const g = new Float32Array(w * h);
  let mean = 0;
  for (let p = 0, q = 0; q < w * h; p += 4, q++) {
    g[q] = (Number(px[p]) * 0.299 + Number(px[p + 1]) * 0.587 + Number(px[p + 2]) * 0.114) / 255;
    mean += g[q];
  }
  mean /= w * h;
  return { data: g, w, h, dark: mean > 0.5 };
}

/**
 * Faint scans (light-gray walls, washed-out photocopies) barely register.
 * A percentile contrast stretch makes the darkest 2% read as full ink and
 * the lightest 98% as clean paper — the snap then treats a faint plan like
 * a crisp one. Pure, so it's testable.
 */
export function stretchGray(g: Gray): Gray {
  // work in the RESPONSE domain (ink = high): lines are a tiny share of a
  // plan's pixels, so the gain comes from the ink population itself — the
  // 75th-percentile ink level is boosted to solid, paper stays paper
  const resp = new Float32Array(g.data.length);
  for (let i = 0; i < g.data.length; i++) resp[i] = g.dark ? 1 - g.data[i] : g.data[i];
  const inks: number[] = [];
  for (let i = 0; i < resp.length; i++) if (resp[i] > 0.08) inks.push(resp[i]);
  if (inks.length < 50) return g;                 // blank-ish image — leave it
  inks.sort((a, b) => a - b);
  const hi = inks[Math.floor(inks.length * 0.75)];
  if (!(hi > 0.05) || hi > 0.55) return g;        // already strong ink
  const gain = 0.9 / hi;
  const out = new Float32Array(g.data.length);
  for (let i = 0; i < resp.length; i++) {
    const r = Math.min(1, resp[i] * gain);
    out[i] = g.dark ? 1 - r : r;
  }
  return { ...g, data: out };
}

/** luminance grid from any drawable source (browser only) */
export function buildGray(image: HTMLImageElement | HTMLCanvasElement, maxSide = 2200): Gray | null {
  const iw = image instanceof HTMLCanvasElement ? image.width : image.naturalWidth;
  const ih = image instanceof HTMLCanvasElement ? image.height : image.naturalHeight;
  if (!iw || !ih) return null;
  const sc = Math.min(1, maxSide / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * sc)), h = Math.max(1, Math.round(ih * sc));
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(image, 0, 0, w, h);
  const g = grayFromPixels(ctx.getImageData(0, 0, w, h).data, w, h);
  return stretchGray({ ...g, w, h });
}

/** how strongly the pixel reads as wall ink */
export function lineResp(G: Gray, x: number, y: number): number {
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 1 || yi < 1 || xi >= G.w - 1 || yi >= G.h - 1) return 0;
  const v = G.data[yi * G.w + xi];
  return G.dark ? 1 - v : v;
}

/** straighten near-axis edges (display + snap prep) */
export function rectify(pts: XY[]): XY[] {
  const out = pts.map((p) => ({ x: p.x, y: p.y }));
  for (let pass = 0; pass < 3; pass++) {
    for (let a = 0; a < out.length; a++) {
      const b = (a + 1) % out.length;
      const adx = Math.abs(out[b].x - out[a].x), ady = Math.abs(out[b].y - out[a].y);
      if (ady <= adx * 0.27) { const my = (out[a].y + out[b].y) / 2; out[a].y = my; out[b].y = my; }
      else if (adx <= ady * 0.27) { const mx = (out[a].x + out[b].x) / 2; out[a].x = mx; out[b].x = mx; }
    }
  }
  return out;
}

function intersect(e1: { a: XY; b: XY }, e2: { a: XY; b: XY }): XY | null {
  const { x: x1, y: y1 } = e1.a, { x: x2, y: y2 } = e1.b;
  const { x: x3, y: y3 } = e2.a, { x: x4, y: y4 } = e2.b;
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 1e-6) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}

export function centroid(pts: XY[]): XY {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}

export function shoelacePx(pts: XY[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}

/**
 * THE snap: each polygon edge slides along its normal to the strongest wall
 * response nearby, then corners are rebuilt from neighbouring edge
 * intersections (clamped so near-parallel corridor walls can't fly off).
 */
export function snapToWalls(G: Gray | null, ptsIn: XY[], opts?: { maxOffset?: number }): XY[] {
  if (!G || ptsIn.length < 3) return ptsIn;
  const pts = rectify(ptsIn);
  // maxOffset caps the search: a fresh rough trace wants the full reach, but
  // RE-snapping a shape someone deliberately reshaped or merged must be a
  // tight refinement — otherwise the strongest line 40px away (often the old
  // wall the user just moved off of) wins and the shape "reverts".
  const R = opts?.maxOffset
    ? Math.max(4, Math.round(opts.maxOffset))
    : Math.max(15, Math.min(55, Math.round(G.w * 0.035)));
  const n = pts.length;
  const fitted: { a: XY; b: XY }[] = [];
  for (let e = 0; e < n; e++) {
    const a = pts[e], b = pts[(e + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 5) { fitted.push({ a, b }); continue; }
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    const samples = Math.max(12, Math.min(60, Math.round(len / 3)));
    const inset = len * 0.14;
    let bestOff = 0, bestScore = -1;
    for (let off = -R; off <= R; off++) {
      let s = 0, cov = 0;
      for (let t = 0; t < samples; t++) {
        const d = inset + (len - 2 * inset) * t / (samples - 1);
        const sx = a.x + ux * d + nx * off, sy = a.y + uy * d + ny * off;
        const r = Math.max(lineResp(G, sx, sy), lineResp(G, sx + nx, sy + ny), lineResp(G, sx - nx, sy - ny));
        s += r;
        if (r > 0.4) cov++;
      }
      const score = (s / samples) * (0.35 + 0.65 * cov / samples) - 0.10 * Math.abs(off) / R;
      if (score > bestScore) { bestScore = score; bestOff = off; }
    }
    fitted.push({
      a: { x: a.x + nx * bestOff, y: a.y + ny * bestOff },
      b: { x: b.x + nx * bestOff, y: b.y + ny * bestOff }
    });
  }
  const out: XY[] = [];
  for (let j = 0; j < n; j++) {
    const prev = fitted[(j - 1 + n) % n], next = fitted[j];
    let ip = intersect(prev, next);
    if (!ip) ip = { x: (prev.b.x + next.a.x) / 2, y: (prev.b.y + next.a.y) / 2 };
    let gx = ip.x - pts[j].x, gy = ip.y - pts[j].y;
    if (Math.sqrt(gx * gx + gy * gy) > R * 2.2) {
      ip = { x: (prev.b.x + next.a.x) / 2, y: (prev.b.y + next.a.y) / 2 };
      gx = ip.x - pts[j].x; gy = ip.y - pts[j].y;
      if (Math.sqrt(gx * gx + gy * gy) > R * 2.2) ip = { x: pts[j].x, y: pts[j].y };
    }
    out.push({ x: ip.x, y: ip.y });
  }
  return out;
}

// ── auto-detect: rooms straight from the plan's own lines ───────────────────

export function rdp(pts: XY[], eps: number): XY[] {
  if (pts.length < 4) return pts;
  const perp = (p: XY, a: XY, b: XY): number => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) { const ex = p.x - a.x, ey = p.y - a.y; return Math.sqrt(ex * ex + ey * ey); }
    return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
  };
  const simp = (pp: XY[]): XY[] => {
    if (pp.length < 3) return pp;
    let dmax = 0, idx = 0;
    for (let i = 1; i < pp.length - 1; i++) {
      const d = perp(pp[i], pp[0], pp[pp.length - 1]);
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > eps) {
      const l = simp(pp.slice(0, idx + 1));
      const r = simp(pp.slice(idx));
      return l.slice(0, l.length - 1).concat(r);
    }
    return [pp[0], pp[pp.length - 1]];
  };
  return simp(pts);
}

function traceRegion(label: Int32Array, rg: { id: number; minx: number; maxx: number; miny: number; maxy: number },
  w: number, hh: number): XY[] | null {
  const id = rg.id;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < hh && label[y * w + x] === id;
  let sx = -1, sy = -1;
  for (let y = rg.miny; y <= rg.maxy && sx < 0; y++) {
    for (let x = rg.minx; x <= rg.maxx; x++) {
      if (label[y * w + x] === id) { sx = x; sy = y; break; }
    }
  }
  if (sx < 0) return null;
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  let poly: XY[] = [], cx2 = sx, cy2 = sy, dir = 6, guard = 0;
  const maxSteps = (rg.maxx - rg.minx + rg.maxy - rg.miny + 4) * 8 + 2000;
  do {
    poly.push({ x: cx2, y: cy2 });
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8;
      const nx2 = cx2 + dirs[d][0], ny2 = cy2 + dirs[d][1];
      if (inside(nx2, ny2)) { cx2 = nx2; cy2 = ny2; dir = d; found = true; break; }
    }
    if (!found) break;
    guard++;
  } while ((cx2 !== sx || cy2 !== sy) && guard < maxSteps);
  if (poly.length > 1200) {
    const step = Math.ceil(poly.length / 1200), dec: XY[] = [];
    for (let i2 = 0; i2 < poly.length; i2 += step) dec.push(poly[i2]);
    poly = dec;
  }
  return poly;
}

function expandPoly(pts: XY[], k: number): XY[] {
  const c = centroid(pts);
  const n = pts.length;
  const edges: { a: XY; b: XY }[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) { edges.push({ a, b }); continue; }
    const nx = -dy / len, ny = dx / len;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const s = (mx - c.x) * nx + (my - c.y) * ny > 0 ? 1 : -1;
    edges.push({ a: { x: a.x + nx * s * k, y: a.y + ny * s * k }, b: { x: b.x + nx * s * k, y: b.y + ny * s * k } });
  }
  const out: XY[] = [];
  for (let j = 0; j < n; j++) {
    const prev = edges[(j - 1 + n) % n], nxt = edges[j];
    let ip = intersect(prev, nxt);
    if (!ip) ip = { x: (prev.b.x + nxt.a.x) / 2, y: (prev.b.y + nxt.a.y) / 2 };
    const ddx = ip.x - pts[j].x, ddy = ip.y - pts[j].y;
    if (Math.sqrt(ddx * ddx + ddy * ddy) > k * 4 + 6) ip = { x: pts[j].x, y: pts[j].y };
    out.push(ip);
  }
  return out;
}

/** every enclosed region of the plan's own lines, as clean polygons */
export function autoDetectRooms(G: Gray): XY[][] {
  const maxW = 800;
  const sc = G.w > maxW ? maxW / G.w : 1;
  const w = Math.round(G.w * sc), hh = Math.round(G.h * sc);
  let wall = new Uint8Array(w * hh);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const gx = Math.min(G.w - 1, Math.round(x / sc)), gy = Math.min(G.h - 1, Math.round(y / sc));
      const v = G.data[gy * G.w + gx];
      wall[y * w + x] = (G.dark ? 1 - v : v) > 0.45 ? 1 : 0;
    }
  }
  // dilate walls to seal door gaps so rooms don't leak into corridors
  const iter = Math.max(3, Math.round(w / 110));
  for (let it = 0; it < iter; it++) {
    const nw = new Uint8Array(wall);
    for (let y2 = 1; y2 < hh - 1; y2++) {
      for (let x2 = 1; x2 < w - 1; x2++) {
        const i9 = y2 * w + x2;
        if (!wall[i9] && (wall[i9 - 1] || wall[i9 + 1] || wall[i9 - w] || wall[i9 + w])) nw[i9] = 1;
      }
    }
    wall = nw;
  }
  const label = new Int32Array(w * hh);
  for (let i3 = 0; i3 < w * hh; i3++) if (wall[i3]) label[i3] = -1;
  const qx = new Int32Array(w * hh), qy = new Int32Array(w * hh);
  let nextId = 1;
  const regions: { id: number; area: number; touchesBorder: boolean; minx: number; maxx: number; miny: number; maxy: number }[] = [];
  for (let sy = 0; sy < hh; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const si = sy * w + sx;
      if (label[si] !== 0) continue;
      let head = 0, tail = 0;
      qx[tail] = sx; qy[tail] = sy; tail++;
      label[si] = nextId;
      let area = 0, touchesBorder = false;
      let minx = sx, maxx = sx, miny = sy, maxy = sy;
      while (head < tail) {
        const cxp = qx[head], cyp = qy[head]; head++;
        area++;
        if (cxp === 0 || cyp === 0 || cxp === w - 1 || cyp === hh - 1) touchesBorder = true;
        if (cxp < minx) minx = cxp; if (cxp > maxx) maxx = cxp;
        if (cyp < miny) miny = cyp; if (cyp > maxy) maxy = cyp;
        if (cxp > 0 && label[cyp * w + cxp - 1] === 0) { label[cyp * w + cxp - 1] = nextId; qx[tail] = cxp - 1; qy[tail] = cyp; tail++; }
        if (cxp < w - 1 && label[cyp * w + cxp + 1] === 0) { label[cyp * w + cxp + 1] = nextId; qx[tail] = cxp + 1; qy[tail] = cyp; tail++; }
        if (cyp > 0 && label[(cyp - 1) * w + cxp] === 0) { label[(cyp - 1) * w + cxp] = nextId; qx[tail] = cxp; qy[tail] = cyp - 1; tail++; }
        if (cyp < hh - 1 && label[(cyp + 1) * w + cxp] === 0) { label[(cyp + 1) * w + cxp] = nextId; qx[tail] = cxp; qy[tail] = cyp + 1; tail++; }
      }
      regions.push({ id: nextId, area, touchesBorder, minx, maxx, miny, maxy });
      nextId++;
    }
  }
  const total = w * hh;
  const out: XY[][] = [];
  for (const rg of regions) {
    if (rg.touchesBorder) continue;
    if (rg.area < total * 0.0015 || rg.area > total * 0.35) continue;
    let poly = traceRegion(label, rg, w, hh);
    if (!poly || poly.length < 4) continue;
    poly = rdp(poly, Math.max(2, w * 0.006));
    if (poly.length < 3 || poly.length > 60) continue;
    poly = rectify(poly);
    poly = expandPoly(poly, iter);
    out.push(poly.map((p) => ({ x: p.x / sc, y: p.y / sc })));
  }
  return out;
}


// ── polygon booleans via a shared raster (merge tool + the no-overlap rule) ─

function rasterize(polys: XY[][], res = 420, pad = 1): {
  mask: Uint8Array[]; w: number; h: number; ox: number; oy: number; sc: number; pad: number;
} | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polys) for (const p of poly) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const bw = maxX - minX, bh = maxY - minY;
  if (!(bw > 0) || !(bh > 0)) return null;
  const sc = res / Math.max(bw, bh);
  const w = Math.max(2, Math.round(bw * sc) + pad * 2), h = Math.max(2, Math.round(bh * sc) + pad * 2);
  const masks = polys.map((poly) => {
    const m = new Uint8Array(w * h);
    const pts = poly.map((p) => ({ x: (p.x - minX) * sc + pad, y: (p.y - minY) * sc + pad }));
    // scanline fill
    for (let y = 0; y < h; y++) {
      const xs: number[] = [];
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i], b = pts[j];
        if ((a.y > y) !== (b.y > y)) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const x0 = Math.max(0, Math.ceil(xs[k])), x1 = Math.min(w - 1, Math.floor(xs[k + 1]));
        for (let x = x0; x <= x1; x++) m[y * w + x] = 1;
      }
    }
    return m;
  });
  return { mask: masks, w, h, ox: minX, oy: minY, sc, pad };
}

/** how much of the SMALLER polygon sits inside the other (0..1) */
export function overlapRatio(a: XY[], b: XY[]): number {
  if (a.length < 3 || b.length < 3) return 0;
  const r = rasterize([a, b], 240);
  if (!r) return 0;
  let inter = 0, areaA = 0, areaB = 0;
  for (let i = 0; i < r.w * r.h; i++) {
    const pa = r.mask[0][i], pb = r.mask[1][i];
    if (pa) areaA++;
    if (pb) areaB++;
    if (pa && pb) inter++;
  }
  const denom = Math.min(areaA, areaB);
  return denom > 0 ? inter / denom : 0;
}

/**
 * The merge tool: two rooms become one outline (union). Rasterize both,
 * OR the masks, trace the boundary, simplify lightly — angled shapes keep
 * their angles (no rectify here). Null when the rooms don't touch: merging
 * two separate rooms would invent floor that doesn't exist.
 */
export function unionPolygons(a: XY[], b: XY[]): XY[] | null {
  if (a.length < 3 || b.length < 3) return null;
  // rooms that share a wall sit a wall-thickness apart once snapped, so the
  // union is a morphological CLOSE: dilate enough to bridge a real wall,
  // erode the same amount so the outer boundary comes back true
  const k = 9;
  const r = rasterize([a, b], 420, k + 2);
  if (!r) return null;
  const u = new Uint8Array(r.w * r.h);
  for (let i = 0; i < u.length; i++) u[i] = r.mask[0][i] | r.mask[1][i];
  let grown = new Uint8Array(u);
  for (let it = 0; it < k; it++) {
    const nw = new Uint8Array(grown);
    for (let y = 1; y < r.h - 1; y++) {
      for (let x = 1; x < r.w - 1; x++) {
        const i = y * r.w + x;
        if (!grown[i] && (grown[i - 1] || grown[i + 1] || grown[i - r.w] || grown[i + r.w])) nw[i] = 1;
      }
    }
    grown = nw;
  }
  for (let it = 0; it < k; it++) {
    const nw = new Uint8Array(grown);
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const i = y * r.w + x;
        if (!grown[i]) continue;
        const left = x > 0 ? grown[i - 1] : 0, right = x < r.w - 1 ? grown[i + 1] : 0;
        const up = y > 0 ? grown[i - r.w] : 0, down = y < r.h - 1 ? grown[i + r.w] : 0;
        if (!(left && right && up && down)) nw[i] = 0;
      }
    }
    grown = nw;
  }
  // the close must not LOSE the rooms themselves
  for (let i = 0; i < u.length; i++) if (u[i]) grown[i] = 1;
  // connectivity check: flood from one polygon; the other must be reachable
  const seen = new Uint8Array(r.w * r.h);
  const qx = new Int32Array(r.w * r.h), qy = new Int32Array(r.w * r.h);
  let head = 0, tail = 0, seedFound = false;
  outer: for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    if (r.mask[0][y * r.w + x]) { qx[tail] = x; qy[tail] = y; tail++; seen[y * r.w + x] = 1; seedFound = true; break outer; }
  }
  if (!seedFound) return null;
  while (head < tail) {
    const x = qx[head], y = qy[head]; head++;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= r.w || ny >= r.h) continue;
      const ni = ny * r.w + nx;
      if (!seen[ni] && grown[ni]) { seen[ni] = 1; qx[tail] = nx; qy[tail] = ny; tail++; }
    }
  }
  let touchesB = false;
  for (let i = 0; i < u.length && !touchesB; i++) if (r.mask[1][i] && seen[i]) touchesB = true;
  if (!touchesB) return null;
  // trace the union boundary
  const label = new Int32Array(r.w * r.h);
  let minx = r.w, maxx = 0, miny = r.h, maxy = 0;
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    if (grown[y * r.w + x]) {
      label[y * r.w + x] = 1;
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
    }
  }
  const poly = traceRegion(label, { id: 1, minx, maxx, miny, maxy }, r.w, r.h);
  if (!poly || poly.length < 3) return null;
  const simplified = rdp(poly, 2.5);
  if (simplified.length < 3) return null;
  return simplified.map((p) => ({ x: (p.x - r.pad) / r.sc + r.ox, y: (p.y - r.pad) / r.sc + r.oy }));
}


/**
 * The snap's failure mode (seen live, 2026-09-02): in a corridor, each edge
 * independently picks the STRONGEST wall line in reach — when one wall reads
 * darker than the other, both long edges of a traced box land on the same
 * line and the box collapses to a sliver. A snap may refine a shape, never
 * destroy it: this detector compares the result against what was drawn, and
 * the caller keeps the drawn shape when the snap ate it.
 */
export function snapCollapsed(before: XY[], after: XY[]): boolean {
  if (before.length < 3) return false;
  if (after.length < 3) return true;
  const areaB = shoelacePx(before);
  if (!(areaB > 0)) return false;
  if (shoelacePx(after) < areaB * 0.3) return true;
  const dims = (pts: XY[]) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    return { w: maxX - minX, h: maxY - minY };
  };
  const db = dims(before), da = dims(after);
  return (db.w > 8 && da.w < db.w * 0.25) || (db.h > 8 && da.h < db.h * 0.25);
}

/**
 * Border-to-border cleanup (Josh's rule): after a snap, a room's edge that
 * runs almost along a NEIGHBOUR's edge — a sliver gap or a slight overlap —
 * moves onto that neighbour's line exactly. No empty slivers, no overlaps,
 * shared walls actually shared. Pure; corners are rebuilt the same way the
 * wall snap rebuilds them.
 */
export function alignEdgesToNeighbors(ptsIn: XY[], neighbors: XY[][], tol = 12): XY[] {
  if (ptsIn.length < 3 || !neighbors.length) return ptsIn;
  const pts = ptsIn.map((p) => ({ ...p }));
  const n = pts.length;
  const fitted: { a: XY; b: XY }[] = [];
  for (let e = 0; e < n; e++) {
    const a = pts[e], b = pts[(e + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 4) { fitted.push({ a, b }); continue; }
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    let bestOff = 0, bestSpan = 0;
    for (const poly of neighbors) {
      const m = poly.length;
      for (let f = 0; f < m; f++) {
        const c = poly[f], d = poly[(f + 1) % m];
        const ex = d.x - c.x, ey = d.y - c.y;
        const elen = Math.hypot(ex, ey);
        if (elen < 4) continue;
        // near-parallel?
        const cross = Math.abs(ux * (ey / elen) - uy * (ex / elen));
        if (cross > 0.18) continue; // > ~10°
        // signed normal distance from this edge to the neighbour's line
        const off = (c.x - a.x) * nx + (c.y - a.y) * ny;
        const off2 = (d.x - a.x) * nx + (d.y - a.y) * ny;
        const offMid = (off + off2) / 2;
        if (Math.abs(offMid) > tol) continue;
        // do the spans actually face each other along the edge direction?
        const t1 = (c.x - a.x) * ux + (c.y - a.y) * uy;
        const t2 = (d.x - a.x) * ux + (d.y - a.y) * uy;
        const lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(len, Math.max(t1, t2));
        const span = hi - lo;
        if (span < Math.min(len, elen) * 0.25) continue;
        if (span > bestSpan) { bestSpan = span; bestOff = offMid; }
      }
    }
    fitted.push({
      a: { x: a.x + nx * bestOff, y: a.y + ny * bestOff },
      b: { x: b.x + nx * bestOff, y: b.y + ny * bestOff }
    });
  }
  const out: XY[] = [];
  for (let j = 0; j < n; j++) {
    const prev = fitted[(j - 1 + n) % n], next = fitted[j];
    let ip = intersect(prev, next);
    if (!ip) ip = { x: (prev.b.x + next.a.x) / 2, y: (prev.b.y + next.a.y) / 2 };
    const gx = ip.x - pts[j].x, gy = ip.y - pts[j].y;
    if (Math.hypot(gx, gy) > tol * 3) ip = { x: pts[j].x, y: pts[j].y };
    out.push(ip);
  }
  return out;
}
