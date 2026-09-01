// CAD files in the Plan Studio: a .dxf is text, so we can read its lines and
// draw them ourselves — the file becomes a clean picture, and from there the
// pipeline is identical to a photo or PDF (trace, snap, calibrate, Max).
// Deliberately minimal: LINE / LWPOLYLINE / POLYLINE / ARC / CIRCLE across
// every layer. That covers wall geometry, which is all the Studio needs.
// (.dwg is a closed binary format — we tell the user to export DXF or PDF.)

export interface Seg { x1: number; y1: number; x2: number; y2: number }

/** DXF text → line segments (pure, testable) */
export function dxfSegments(text: string): Seg[] {
  const lines = text.split(/\r\n|\r|\n/);
  const segs: Seg[] = [];
  let i = 0;
  const arcSegs = (cx: number, cy: number, r: number, a0: number, a1: number) => {
    if (!(r > 0)) return;
    let start = (a0 * Math.PI) / 180, end = (a1 * Math.PI) / 180;
    if (end <= start) end += Math.PI * 2;
    const steps = Math.max(8, Math.ceil((end - start) / (Math.PI / 16)));
    let px = cx + r * Math.cos(start), py = cy + r * Math.sin(start);
    for (let s = 1; s <= steps; s++) {
      const a = start + ((end - start) * s) / steps;
      const nx = cx + r * Math.cos(a), ny = cy + r * Math.sin(a);
      segs.push({ x1: px, y1: py, x2: nx, y2: ny });
      px = nx; py = ny;
    }
  };

  while (i < lines.length - 1) {
    const code = lines[i].trim();
    const value = (lines[i + 1] ?? "").trim();
    i += 2;
    if (code !== "0") continue;

    if (value === "LINE") {
      const e = readEntity(lines, i);
      i = e.next;
      const { d } = e;
      if (has(d, 10, 20, 11, 21)) {
        segs.push({ x1: d[10][0], y1: d[20][0], x2: d[11][0], y2: d[21][0] });
      }
    } else if (value === "LWPOLYLINE") {
      const e = readEntity(lines, i);
      i = e.next;
      const xs = e.d[10] ?? [], ys = e.d[20] ?? [];
      const closed = ((e.d[70]?.[0] ?? 0) & 1) === 1;
      pushPolyline(segs, xs, ys, closed);
    } else if (value === "POLYLINE") {
      // vertices follow as VERTEX entities until SEQEND
      const closed = (() => {
        const e = readEntity(lines, i);
        i = e.next;
        return ((e.d[70]?.[0] ?? 0) & 1) === 1;
      })();
      const xs: number[] = [], ys: number[] = [];
      while (i < lines.length - 1) {
        const c2 = lines[i].trim(), v2 = (lines[i + 1] ?? "").trim();
        if (c2 !== "0") { i += 2; continue; }
        if (v2 === "VERTEX") {
          i += 2;
          const e = readEntity(lines, i);
          i = e.next;
          if (e.d[10] !== undefined && e.d[20] !== undefined) { xs.push(e.d[10][0]); ys.push(e.d[20][0]); }
        } else if (v2 === "SEQEND") {
          i += 2;
          break;
        } else {
          break; // malformed — don't eat the next entity
        }
      }
      pushPolyline(segs, xs, ys, closed);
    } else if (value === "ARC") {
      const e = readEntity(lines, i);
      i = e.next;
      if (has(e.d, 10, 20, 40)) arcSegs(e.d[10][0], e.d[20][0], e.d[40][0], e.d[50]?.[0] ?? 0, e.d[51]?.[0] ?? 360);
    } else if (value === "CIRCLE") {
      const e = readEntity(lines, i);
      i = e.next;
      if (has(e.d, 10, 20, 40)) arcSegs(e.d[10][0], e.d[20][0], e.d[40][0], 0, 360);
    }
  }
  return segs.filter((s) => [s.x1, s.y1, s.x2, s.y2].every(Number.isFinite));
}

function has(d: Record<number, number[]>, ...codes: number[]): boolean {
  return codes.every((c) => d[c] !== undefined && Number.isFinite(d[c][0]));
}

function pushPolyline(segs: Seg[], xs: number[], ys: number[], closed: boolean) {
  const n = Math.min(xs.length, ys.length);
  for (let k = 1; k < n; k++) segs.push({ x1: xs[k - 1], y1: ys[k - 1], x2: xs[k], y2: ys[k] });
  if (closed && n > 2) segs.push({ x1: xs[n - 1], y1: ys[n - 1], x2: xs[0], y2: ys[0] });
}

/** read group-code/value pairs until the next entity's "0" line */
function readEntity(lines: string[], start: number): { d: Record<number, number[]>; next: number } {
  const d: Record<number, number[]> = {};
  let i = start;
  while (i < lines.length - 1) {
    const code = lines[i].trim();
    if (code === "0") break;
    const num = Number(code);
    const val = Number((lines[i + 1] ?? "").trim());
    if (Number.isFinite(num) && Number.isFinite(val)) (d[num] ??= []).push(val);
    i += 2;
  }
  return { d, next: i };
}

export function segmentBounds(segs: Seg[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of segs) {
    minX = Math.min(minX, s.x1, s.x2); maxX = Math.max(maxX, s.x1, s.x2);
    minY = Math.min(minY, s.y1, s.y2); maxY = Math.max(maxY, s.y1, s.y2);
  }
  return { minX, minY, maxX, maxY };
}

/** DXF text → the same PlanPicture shape every other upload produces (browser) */
export function dxfToPicture(text: string, targetLongEdge = 2000): {
  dataUrl: string; width: number; height: number; aspect: number;
} {
  const segs = dxfSegments(text);
  if (segs.length < 3) {
    throw new Error("No drawable lines were found in that CAD file. Export it as DXF (ASCII) or as a PDF and try again.");
  }
  const b = segmentBounds(segs);
  const bw = b.maxX - b.minX, bh = b.maxY - b.minY;
  if (!(bw > 0) || !(bh > 0)) throw new Error("That CAD file's drawing has no size.");
  const pad = 0.03 * Math.max(bw, bh);
  const scale = targetLongEdge / (Math.max(bw, bh) + pad * 2);
  const w = Math.max(1, Math.round((bw + pad * 2) * scale));
  const h = Math.max(1, Math.round((bh + pad * 2) * scale));
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#1c2b33";
  ctx.lineWidth = Math.max(1.5, targetLongEdge / 900);
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const s of segs) {
    // DXF y grows UP; pictures grow down — flip
    ctx.moveTo((s.x1 - b.minX + pad) * scale, h - (s.y1 - b.minY + pad) * scale);
    ctx.lineTo((s.x2 - b.minX + pad) * scale, h - (s.y2 - b.minY + pad) * scale);
  }
  ctx.stroke();
  return { dataUrl: cv.toDataURL("image/png"), width: w, height: h, aspect: w / h };
}

export function isDxf(file: File): boolean {
  return /\.dxf$/i.test(file.name);
}

export function isDwg(file: File): boolean {
  return /\.dwg$/i.test(file.name);
}
