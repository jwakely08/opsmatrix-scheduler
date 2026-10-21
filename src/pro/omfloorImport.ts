// Floor files from our CAD converter (.omfloor, Josh 2026-10-20: "it's not accepting our files").
// An .omfloor is gzip-compressed JSON for one floor: each room's outline (feet), number, name and
// square feet, plus the walls/doors/windows picture. OpsMatrix reads it through the SAME exact-CAD
// path as a DXF with room data: the floor is written out here, in memory, as that DXF — so the
// rooms, the square feet and the drawn plan come out exactly as the converter showed them, and the
// file is never sent to Max. Pure (no DOM besides Blob/streams) and unit-tested.
import { pointInPts, polyArea, type XY } from "./cadImport";

const FORMAT = "opsmatrix-floor";

interface FloorRoom { number: string; name: string; sqft: number; outline: number[]; label: [number, number] | null }
interface FloorLayer { kind: string; paths: number[][] }
export interface OmFloor {
  format: string;
  version: number;
  site?: { account?: string; building?: string; floor?: string };
  bounds?: number[];
  rooms: FloorRoom[];
  drawing: FloorLayer[];
}

export class OmfloorError extends Error {}

export function isOmfloor(file: { name: string }): boolean {
  return /\.omfloor$/i.test(file.name);
}

/** the file → a checked floor (plain-English errors for anything else) */
export async function readOmfloor(file: Blob): Promise<OmFloor> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  let text: string;
  if (head[0] === 0x1f && head[1] === 0x8b) {
    if (typeof DecompressionStream === "undefined") {
      throw new OmfloorError("This device's browser is too old to open floor files — update it, or use the floor's .dxf file instead.");
    }
    try {
      text = await new Response(file.stream().pipeThrough(new DecompressionStream("gzip"))).text();
    } catch {
      throw new OmfloorError("This floor file couldn't be opened — it may be damaged. Save it again from the converter.");
    }
  } else {
    text = await file.text();
  }
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new OmfloorError("This floor file couldn't be read — it may be damaged. Save it again from the converter."); }
  const f = data as Partial<OmFloor> | null;
  if (!f || typeof f !== "object" || f.format !== FORMAT) throw new OmfloorError("This isn't an OpsMatrix floor file.");
  if (f.version !== 1) throw new OmfloorError(`This floor file is version ${String(f.version)}; this OpsMatrix reads version 1. Update OpsMatrix, or use the floor's .dxf file.`);
  if (!Array.isArray(f.rooms) || !Array.isArray(f.drawing)) throw new OmfloorError("This floor file is incomplete. Save it again from the converter.");
  for (const r of f.rooms) {
    if (!r || typeof r.number !== "string" || !Array.isArray(r.outline) || r.outline.length < 6 || r.outline.some((v) => !Number.isFinite(v))) {
      throw new OmfloorError("This floor file has a damaged room. Save it again from the converter.");
    }
  }
  return f as OmFloor;
}

// ── the floor as the exact-CAD DXF (feet, $INSUNITS 2) ─────────────────────

type Box = [number, number, number, number];
const toPts = (o: number[]): XY[] => {
  const pts: XY[] = [];
  for (let i = 0; i + 1 < o.length; i += 2) pts.push({ x: o[i], y: o[i + 1] });
  return pts;
};
const boxOf = (pts: XY[]): Box => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  return [x0, y0, x1, y1];
};
const inBox = (b: Box, x: number, y: number) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

/** The outline whose area rounds to the room's own square feet under the CAD import's rule. A room
 *  sitting exactly on a half square foot can round the other way after the unit change; such a room
 *  is resized by a hair (millionths of a foot). */
function exactOutline(r: FloorRoom): XY[] {
  let pts = toPts(r.outline);
  for (let tries = 1; tries <= 6; tries++) {
    const area = polyArea(pts);
    const got = Math.round(area);
    if (got === r.sqft || !(area > 0) || Math.abs(area - r.sqft) > 1) return pts;
    const target = got < r.sqft ? r.sqft - 0.5 + 1e-7 * tries : r.sqft + 0.5 - 1e-7 * tries;
    const s = Math.sqrt(target / area);
    const [x0, y0, x1, y1] = boxOf(pts);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    pts = pts.map((p) => ({ x: cx + (p.x - cx) * s, y: cy + (p.y - cy) * s }));
  }
  return pts;
}

function segDist(px: number, py: number, a: XY, b: XY): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2)) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

interface Placed { pts: XY[]; box: Box; area: number }

/** Where a room's tag goes: inside the room and not inside a room the import would prefer for it
 *  (a smaller one, or an identical one written earlier) — the drawing's own spot if it qualifies. */
function tagPoint(me: Placed, label: [number, number] | null, rivals: Placed[]): XY | null {
  const ok = (x: number, y: number) => pointInPts(me.pts, x, y) && !rivals.some((o) => inBox(o.box, x, y) && pointInPts(o.pts, x, y));
  if (label && ok(label[0], label[1])) return { x: label[0], y: label[1] };
  const [x0, y0, x1, y1] = me.box;
  let best: XY | null = null, bestD = -1;
  const N = 24;
  for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) {
    const x = x0 + ((x1 - x0) * i) / N, y = y0 + ((y1 - y0) * j) / N;
    if (!ok(x, y)) continue;
    let d = Infinity;
    for (let k = 0; k < me.pts.length; k++) d = Math.min(d, segDist(x, y, me.pts[k], me.pts[(k + 1) % me.pts.length]));
    if (d > bestD) { bestD = d; best = { x, y }; }
  }
  return best;
}

const num = (v: number) => (Object.is(v, -0) ? "0" : String(v));

/** One floor → the DXF text the exact-CAD import reads (rooms with tags + the picture's lines). */
export function omfloorToDxf(floor: OmFloor): string {
  // tagged rooms first: where two outlines are identical, the import gives the tag to the first
  const rooms = [...floor.rooms].sort((a, b) => Number(!(a.number || a.name)) - Number(!(b.number || b.name)));
  const placed: Placed[] = rooms.map((r) => { const pts = exactOutline(r); return { pts, box: boxOf(pts), area: polyArea(pts) }; });
  const out: string[] = [];
  const pair = (code: number, value: string | number) => { out.push(String(code), typeof value === "number" ? num(value) : value.replace(/[\r\n]+/g, " ")); };
  pair(0, "SECTION"); pair(2, "HEADER");
  pair(9, "$INSUNITS"); pair(70, 2); // feet
  pair(0, "ENDSEC");
  pair(0, "SECTION"); pair(2, "ENTITIES");
  rooms.forEach((r, i) => {
    const me = placed[i];
    pair(0, "LWPOLYLINE"); pair(8, "OPSMATRIX-ROOMS"); pair(90, me.pts.length); pair(70, 1);
    for (const p of me.pts) { pair(10, p.x); pair(20, p.y); }
    if (!(r.number || r.name)) return;
    const rivals = placed.filter((o, k) => k !== i && (o.area < me.area || (o.area === me.area && k < i)) &&
      o.box[0] <= me.box[2] && o.box[2] >= me.box[0] && o.box[1] <= me.box[3] && o.box[3] >= me.box[1]);
    const at = tagPoint(me, r.label, rivals);
    if (!at) return;
    pair(0, "INSERT"); pair(8, "OPSMATRIX-ROOM-TAGS"); pair(66, 1); pair(2, "OPSMATRIX-ROOM"); pair(10, at.x); pair(20, at.y);
    if (r.number) { pair(0, "ATTRIB"); pair(8, "OPSMATRIX-ROOM-TAGS"); pair(10, at.x); pair(20, at.y); pair(1, r.number); pair(2, "ROOM NUMBER"); }
    if (r.name) { pair(0, "ATTRIB"); pair(8, "OPSMATRIX-ROOM-TAGS"); pair(10, at.x); pair(20, at.y); pair(1, r.name); pair(2, "ROOM NAME"); }
    pair(0, "SEQEND"); pair(8, "OPSMATRIX-ROOM-TAGS");
  });
  for (const layer of floor.drawing) {
    const name = `OPSMATRIX-${String(layer.kind || "other").toUpperCase().replace(/[^A-Z0-9-]/g, "")}`;
    for (const p of layer.paths ?? []) {
      if (!Array.isArray(p) || p.length < 4 || p.some((v) => !Number.isFinite(v))) continue;
      // open polylines only: a closed one could be taken for a room
      pair(0, "LWPOLYLINE"); pair(8, name); pair(90, Math.floor(p.length / 2)); pair(70, 0);
      for (let k = 0; k + 1 < p.length; k += 2) { pair(10, p[k]); pair(20, p[k + 1]); }
    }
  }
  pair(0, "ENDSEC");
  pair(0, "EOF");
  return out.join("\n") + "\n";
}
