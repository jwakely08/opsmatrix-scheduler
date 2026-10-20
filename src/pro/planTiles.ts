// Tiled reading for large, dense sheets (the Franciscan benchmark problem):
// a 200-room 11x17 hospital sheet rendered at 2000px leaves a typical room
// 40-60px across — the reader sees smudges. The fix mirrors what a person
// does: lean in. The sheet is split into overlapping tiles, each re-rendered
// at full resolution from the source (razor-sharp for PDFs), read separately,
// and the per-tile readings are merged back into whole-sheet coordinates
// with overlap dedupe.
//
// How much to lean in comes from the sheet itself: the printed room-number
// bubbles (labelBubbles) say how small the text is. No bubbles → no tiling —
// a magicplan scan or a photo of a single ward reads fine in one shot.
//
// Everything here is pure over numbers (unit-testable); only tilesForPicture
// touches the DOM.
import {
  buildGray, labelBubbles, medianBubbleShort, overlapRatio, unionPolygons,
  shoelacePx, avgWidth, dropSpikes, type Gray, type XY
} from "./planSnap";
import type { AiRoom } from "../bridge/aiPlanImport";

export interface TileBox { x0: number; y0: number; x1: number; y1: number }

/** long edge each tile is rendered at */
export const TILE_RENDER_EDGE = 2048;
/** the bubble short side we want AT THE RENDER — comfortably readable text */
const TARGET_BUBBLE_PX = 44;
/** never zoom in more than this, however tiny the print */
const MAX_ZOOM = 4;
/** below this zoom a single shot is fine */
const MIN_ZOOM_TO_TILE = 1.35;
/** fraction of each tile shared with its neighbour, so every room is whole in at least one tile */
const TILE_OVERLAP = 0.18;

/**
 * The tile layout for a picture, from its printed-label size.
 * `bubbleShortPx` is the median label-bubble short side in PICTURE pixels
 * (null/0 = no bubbles found → single tile).
 */
export function tileGrid(w: number, h: number, bubbleShortPx: number | null): TileBox[] {
  const whole: TileBox = { x0: 0, y0: 0, x1: 1, y1: 1 };
  if (!bubbleShortPx || bubbleShortPx <= 0) return [whole];
  const zoom = Math.min(MAX_ZOOM, TARGET_BUBBLE_PX / bubbleShortPx);
  if (zoom < MIN_ZOOM_TO_TILE) return [whole];
  // a tile covers this many source pixels along its long edge
  const cover = TILE_RENDER_EDGE / zoom;
  const cols = Math.max(1, Math.ceil((w - cover * TILE_OVERLAP) / (cover * (1 - TILE_OVERLAP))));
  const rows = Math.max(1, Math.ceil((h - cover * TILE_OVERLAP) / (cover * (1 - TILE_OVERLAP))));
  if (cols * rows <= 1) return [whole];
  const tiles: TileBox[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // spread tiles evenly so the last row/col isn't a sliver
      const tw = Math.min(1, cover / w), th = Math.min(1, cover / h);
      const x0 = cols === 1 ? 0 : (c * (1 - tw)) / (cols - 1);
      const y0 = rows === 1 ? 0 : (r * (1 - th)) / (rows - 1);
      tiles.push({ x0, y0, x1: Math.min(1, x0 + tw), y1: Math.min(1, y0 + th) });
    }
  }
  return tiles;
}

/** fraction of a tile's pixels that read as ink */
export function tileInkFraction(G: Gray, t: TileBox): number {
  const x0 = Math.floor(t.x0 * G.w), x1 = Math.min(G.w, Math.ceil(t.x1 * G.w));
  const y0 = Math.floor(t.y0 * G.h), y1 = Math.min(G.h, Math.ceil(t.y1 * G.h));
  let ink = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = G.data[y * G.w + x];
      if ((G.dark ? 1 - v : v) > 0.45) ink++;
      n++;
    }
  }
  return n ? ink / n : 0;
}

/** blank margin tiles are not worth a network round trip */
export function dropEmptyTiles(G: Gray, tiles: TileBox[], minInk = 0.002): TileBox[] {
  if (tiles.length <= 1) return tiles;
  const kept = tiles.filter((t) => tileInkFraction(G, t) >= minInk);
  return kept.length ? kept : tiles.slice(0, 1);
}

export interface TileReading { box: TileBox; rooms: AiRoom[] }

const EDGE_EPS = 0.02;     // "touches its tile's edge" margin, in tile units
const DUP_OVERLAP = 0.5;   // two readings of the same room overlap this much

interface Cand {
  room: AiRoom;
  pts: XY[];        // picture-pixel polygon
  areaPx: number;
  clipped: boolean; // hugs a tile edge that is NOT the picture edge
}

/**
 * Merge per-tile readings into one whole-picture room list.
 * Rules, in order:
 *   • same printed number read in two tiles → the readings are the same room:
 *     union them if they overlap/touch, else keep the bigger one
 *   • overlapping readings with different (or no) numbers → the one that was
 *     seen WHOLE (not clipped by its tile edge) wins; then the bigger one
 */
export function mergeTileRooms(perTile: TileReading[], w: number, h: number): AiRoom[] {
  const cands: Cand[] = [];
  for (const { box, rooms } of perTile) {
    const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    for (const r of rooms) {
      if (!Array.isArray(r.polygon) || r.polygon.length < 3) continue;
      let clipped = false;
      const pts: XY[] = r.polygon.map((p) => {
        const tx = p[0], ty = p[1];
        if (
          (tx < EDGE_EPS && box.x0 > 0.001) || (tx > 1 - EDGE_EPS && box.x1 < 0.999) ||
          (ty < EDGE_EPS && box.y0 > 0.001) || (ty > 1 - EDGE_EPS && box.y1 < 0.999)
        ) clipped = true;
        return { x: (box.x0 + tx * bw) * w, y: (box.y0 + ty * bh) * h };
      });
      const areaPx = shoelacePx(pts);
      if (!(areaPx > 0)) continue;
      // WALL TRACES are not rooms: a reading that follows the wall lines
      // instead of the floor between them comes out as a ribbon about a
      // wall-thickness wide. A real room — even a slim closet — is wider.
      // De-spike first: a noisy perimeter understates the width of small
      // honest rooms.
      const clean = dropSpikes(pts);
      if (avgWidth(clean) < Math.max(6, Math.min(w, h) * 0.005)) continue;
      cands.push({ room: r, pts: clean, areaPx: shoelacePx(clean), clipped });
    }
  }

  // drop cross-tile ZONE WRAPPERS first: a tile that read a corridor plus
  // its rooms as ONE blob produces a huge polygon that would out-rank and
  // dedupe away the clean per-room readings from neighbouring tiles
  if (cands.length >= 6) {
    const areas = cands.map((c) => c.areaPx).sort((a, b) => a - b);
    const median = areas[Math.floor(areas.length / 2)] || 1;
    const centers = cands.map((c) => {
      let x = 0, y = 0;
      for (const p of c.pts) { x += p.x; y += p.y; }
      return { x: x / c.pts.length, y: y / c.pts.length };
    });
    const wrapped = (c: Cand, i: number) => {
      if (c.areaPx <= 3.5 * median) return false;
      let inside = 0;
      for (let j = 0; j < cands.length; j++) {
        if (j === i) continue;
        if ((cands[j].room.roomNumber || "") === (c.room.roomNumber || "")) continue;
        if (pointInPts(c.pts, centers[j].x, centers[j].y)) inside++;
        if (inside >= 3) return true;
      }
      return false;
    };
    for (let i = cands.length - 1; i >= 0; i--) {
      if (wrapped(cands[i], i)) cands.splice(i, 1);
    }
  }

  // same-number fragments first: union what the tile seams split
  const byNumber = new Map<string, Cand[]>();
  for (const c of cands) {
    const num = (c.room.roomNumber || "").trim();
    if (!num) continue;
    const list = byNumber.get(num) ?? [];
    list.push(c);
    byNumber.set(num, list);
  }
  const merged: Cand[] = cands.filter((c) => !(c.room.roomNumber || "").trim());
  for (const [, list] of byNumber) {
    list.sort((a, b) => Number(a.clipped) - Number(b.clipped) || b.areaPx - a.areaPx);
    const kept: Cand[] = [];
    for (const c of list) {
      let joined = false;
      for (const k of kept) {
        if (overlapRatio(k.pts, c.pts) > 0.25 || touches(k.pts, c.pts)) {
          const u = unionPolygons(k.pts, c.pts);
          if (u) {
            k.pts = dropSpikes(u);
            k.areaPx = shoelacePx(k.pts);
            k.clipped = k.clipped && c.clipped;
            // the union carries the best of both readings' data
            if (!k.room.squareFeet && c.room.squareFeet) k.room = { ...k.room, squareFeet: c.room.squareFeet };
          }
          joined = true; // overlapping same-number readings never survive twice
          break;
        }
      }
      if (!joined) kept.push({ ...c });
    }
    merged.push(...kept);
  }

  // overlap dedupe: whole beats clipped, then bigger beats smaller. A
  // PRINTED NUMBER is evidence read off the plan: a numbered reading only
  // ever loses to the SAME number (a duplicate); it is never displaced by a
  // different number or by an unnumbered shape (a sloppy corridor polygon
  // must not eat the rooms it brushes). Unnumbered readings dedupe freely.
  merged.sort((a, b) => Number(a.clipped) - Number(b.clipped) || b.areaPx - a.areaPx);
  const final: Cand[] = [];
  for (const c of merged) {
    const cn = (c.room.roomNumber || "").trim();
    if (final.some((k) => {
      const kn = (k.room.roomNumber || "").trim();
      if (cn && kn !== cn) return false; // numbered dies only to its own number
      return overlapRatio(k.pts, c.pts) > DUP_OVERLAP;
    })) continue;
    final.push(c);
  }

  return final.map((c) => ({
    ...c.room,
    polygon: c.pts.map((p) => [
      Math.min(1, Math.max(0, p.x / w)),
      Math.min(1, Math.max(0, p.y / h))
    ])
  }));
}

function pointInPts(pts: XY[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if ((pts[i].y > y) !== (pts[j].y > y) &&
      x < ((pts[j].x - pts[i].x) * (y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside;
  }
  return inside;
}

/** do two polygons come within a couple of wall-thicknesses of each other? */
function touches(a: XY[], b: XY[]): boolean {
  let minxa = Infinity, maxxa = -Infinity, minya = Infinity, maxya = -Infinity;
  for (const p of a) { minxa = Math.min(minxa, p.x); maxxa = Math.max(maxxa, p.x); minya = Math.min(minya, p.y); maxya = Math.max(maxya, p.y); }
  let minxb = Infinity, maxxb = -Infinity, minyb = Infinity, maxyb = -Infinity;
  for (const p of b) { minxb = Math.min(minxb, p.x); maxxb = Math.max(maxxb, p.x); minyb = Math.min(minyb, p.y); maxyb = Math.max(maxyb, p.y); }
  const gap = 12;
  return minxa < maxxb + gap && minxb < maxxa + gap && minya < maxyb + gap && minyb < maxya + gap;
}

/**
 * Browser-side analysis of a picture: find the label bubbles, size the tile
 * grid from them, drop blank tiles. Returns a single whole-picture "tile"
 * when the sheet doesn't need tiling.
 */
export async function tilesForPicture(dataUrl: string, width: number, height: number): Promise<{
  tiles: TileBox[];
  bubbleCount: number;
}> {
  const img = new Image();
  await new Promise<void>((ok, bad) => {
    img.onload = () => ok();
    img.onerror = () => bad(new Error("picture unreadable"));
    img.src = dataUrl;
  });
  const G = buildGray(img);
  if (!G) return { tiles: [{ x0: 0, y0: 0, x1: 1, y1: 1 }], bubbleCount: 0 };
  const bubbles = labelBubbles(G);
  // bubbles are measured on the (possibly downscaled) gray — convert to picture px
  const toPic = width / G.w;
  const median = medianBubbleShort(bubbles);
  const tiles = dropEmptyTiles(G, tileGrid(width, height, median ? median * toPic : null));
  return { tiles, bubbleCount: bubbles.length };
}
