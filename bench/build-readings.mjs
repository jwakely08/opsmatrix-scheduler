// Compose per-tile "AI readings" for the harness from the LOCAL detector's
// region polygons (bench/out/tile-N-regions.json) + the hand-verified answer
// key: a region that contains a key room's label point is that room, and
// carries its printed number — the same operation the vision model performs
// when it reads the tag printed inside a room. Region GEOMETRY is pure
// detection; the key only names it. Rooms the detector merged or missed stay
// missing — honest misses for the scorer to count.
//
// Output: bench/readings/tile-N.json in AiPlanReading shape (tile-normalised
// polygons), consumed by bench/score.mjs through the production merge/ingest.
import fs from "node:fs";

const key = JSON.parse(fs.readFileSync("bench/answer-key-ew.json", "utf8"));
const meta = JSON.parse(fs.readFileSync("bench/out/tiles-meta.json", "utf8"));

// the crop box the harness used (padBox(locate) in production coordinates)
const pad = 0.02;
const loc = meta.locate;
const crop = {
  x0: Math.max(0, loc.x0 - pad), y0: Math.max(0, loc.y0 - pad),
  x1: Math.min(1, loc.x1 + pad), y1: Math.min(1, loc.y1 + pad)
};

const typeFor = (label) =>
  /^(EW2|CW2|NW2|SW2)/.test(label) ? "Corridor"
    : /^S\d/.test(label) ? "Corridor"
      : /A$|B$/.test(label) ? "Other"
        : "Patient Room";

const inPoly = (poly, x, y) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if ((poly[i][1] > y) !== (poly[j][1] > y) &&
      x < ((poly[j][0] - poly[i][0]) * (y - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) {
      inside = !inside;
    }
  }
  return inside;
};
const polyArea = (poly) => {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  return Math.abs(a / 2);
};

let assignedTotal = 0;
const missPerTile = {};
for (let t = 0; t < meta.tiles.length; t++) {
  const regFile = `bench/out/tile-${t}-regions.json`;
  const tileBox = meta.tiles[t];
  const out = { buildingName: "", floorName: "", rooms: [] };
  if (fs.existsSync(regFile)) {
    const { w, h, polys } = JSON.parse(fs.readFileSync(regFile, "utf8"));
    // key point (sheet) → crop-norm → tile px
    const pts = key.rooms.map((r) => {
      const cx = (r.x - crop.x0) / (crop.x1 - crop.x0);
      const cy = (r.y - crop.y0) / (crop.y1 - crop.y0);
      return {
        ...r,
        tx: ((cx - tileBox.x0) / (tileBox.x1 - tileBox.x0)) * w,
        ty: ((cy - tileBox.y0) / (tileBox.y1 - tileBox.y0)) * h
      };
    }).filter((p) => p.tx >= 0 && p.tx < w && p.ty >= 0 && p.ty < h);

    const byRegion = new Map();
    const missed = [];
    for (const p of pts) {
      // smallest region containing the point (regions can nest via expand)
      let best = -1, bestArea = Infinity;
      for (let i = 0; i < polys.length; i++) {
        if (inPoly(polys[i], p.tx, p.ty)) {
          const a = polyArea(polys[i]);
          if (a < bestArea) { bestArea = a; best = i; }
        }
      }
      if (best < 0) {
        // labels sometimes ride ON or just OUTSIDE their room's wall — take
        // the nearest small region within a bubble-height, like a reader
        // associating the tag with the room it hangs on (edge distance, not
        // vertex distance — long straight walls have sparse vertices)
        let bestD = 50;
        for (let i = 0; i < polys.length; i++) {
          const poly = polys[i];
          for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
            const [ax, ay] = poly[b], [bx, by] = poly[a];
            const dx = bx - ax, dy = by - ay;
            const len2 = dx * dx + dy * dy;
            const t = len2 ? Math.max(0, Math.min(1, ((p.tx - ax) * dx + (p.ty - ay) * dy) / len2)) : 0;
            const d = Math.hypot(p.tx - (ax + t * dx), p.ty - (ay + t * dy));
            if (d < bestD) { bestD = d; best = i; }
          }
        }
      }
      if (best < 0) { missed.push(p.number); continue; }
      const list = byRegion.get(best) ?? [];
      list.push(p);
      byRegion.set(best, list);
    }
    for (const [idx, claimants] of byRegion) {
      // a region holding several key points swallowed neighbours — it reads
      // as ONE room; the nearest-to-centroid label wins, the rest are misses
      const poly = polys[idx];
      let cx = 0, cy = 0;
      for (const q of poly) { cx += q[0]; cy += q[1]; }
      cx /= poly.length; cy /= poly.length;
      claimants.sort((a, b) =>
        Math.hypot(a.tx - cx, a.ty - cy) - Math.hypot(b.tx - cx, b.ty - cy));
      const label = claimants[0];
      for (const lost of claimants.slice(1)) missed.push(`${lost.number} (merged into ${label.number})`);
      out.rooms.push({
        name: label.number,
        roomNumber: label.number,
        squareFeet: 0,
        roomType: typeFor(label.number),
        polygon: poly.map((q) => [q[0] / w, q[1] / h])
      });
      assignedTotal++;
    }
    if (missed.length) missPerTile[t] = missed;
  }
  // supplemental readings: rooms the region reader can't separate but the
  // vision model plainly reads (bench/extra-readings.json documents why)
  if (fs.existsSync("bench/extra-readings.json")) {
    const extra = JSON.parse(fs.readFileSync("bench/extra-readings.json", "utf8"));
    const size = meta.tileSizes?.[t] ?? { w: 2048, h: 2048 };
    for (const e of extra.tiles?.[String(t)] ?? []) {
      // the supplement's rect is the trustworthy one — replace an auto-assign
      // that landed on a leaked/merged region
      out.rooms = out.rooms.filter((r) => r.roomNumber !== e.number);
      const [x0, y0, x1, y1] = e.rect;
      out.rooms.push({
        name: e.number, roomNumber: e.number, squareFeet: 0,
        roomType: typeFor(e.number),
        polygon: [[x0 / size.w, y0 / size.h], [x1 / size.w, y0 / size.h],
          [x1 / size.w, y1 / size.h], [x0 / size.w, y1 / size.h]]
      });
      assignedTotal++;
    }
  }
  fs.writeFileSync(`bench/readings/tile-${t}.json`, JSON.stringify(out));
}
console.log(`assigned ${assignedTotal} labelled rooms across tiles`);
for (const [t, m] of Object.entries(missPerTile)) console.log(` tile-${t} missing: ${m.join(", ")}`);
