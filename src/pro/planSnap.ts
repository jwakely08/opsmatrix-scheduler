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
  return { ...g, w, h };
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
export function snapToWalls(G: Gray | null, ptsIn: XY[]): XY[] {
  if (!G || ptsIn.length < 3) return ptsIn;
  const pts = rectify(ptsIn);
  const R = Math.max(15, Math.min(55, Math.round(G.w * 0.035)));
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
