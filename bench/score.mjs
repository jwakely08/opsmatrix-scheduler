// THE SCORING HARNESS — runs the PRODUCTION no-sizes upload pipeline on the
// benchmark PDF end to end and scores the result against the hand-labelled
// EW-wing answer key.
//
//   planFileToImage → locateDrawing → renderRegion crop → tilesForPicture
//   → readPlanTiled (per-tile readings + mergeTileRooms) → ingestAiSeeds
//   (bubble-erased snap gray, scale-aware reach, no-overlap rule)
//
// api.anthropic.com is stubbed (the sandbox can't reach it): the locate
// answer is canned (bench/readings/locate.json, verified by eye) and each
// tile read returns bench/readings/tile-N.json — region polygons from the
// local detector, labelled via the answer key (see build-readings.mjs).
// On staging the same code path runs against the real model.
//
// Output: metrics on stdout + bench/out/score-overlay.png for eyeballing.
import { chromium } from "playwright";
import fs from "node:fs";

const locate = JSON.parse(fs.readFileSync("bench/readings/locate.json", "utf8"));
const key = JSON.parse(fs.readFileSync("bench/answer-key-ew.json", "utf8"));
const readings = [];
for (let i = 0; fs.existsSync(`bench/readings/tile-${i}.json`); i++) {
  readings.push(JSON.parse(fs.readFileSync(`bench/readings/tile-${i}.json`, "utf8")));
}

// --jitter 0.015 : perturb the readings like a sloppy model answer — each
// room shifted as a whole by up to ±J (tile units) plus per-vertex noise of
// ±J/3. Seeded, so runs are comparable. The snap+ingest should recover.
const jIdx = process.argv.indexOf("--jitter");
const JITTER = jIdx >= 0 ? Number(process.argv[jIdx + 1] ?? 0.015) : 0;
if (JITTER > 0) {
  let seed = 1234567;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff * 2 - 1; // -1..1
  };
  for (const t of readings) {
    for (const r of t.rooms) {
      const dx = rnd() * JITTER, dy = rnd() * JITTER;
      r.polygon = r.polygon.map(([x, y]) => [
        x + dx + rnd() * JITTER / 3,
        y + dy + rnd() * JITTER / 3
      ]);
    }
  }
  console.log(`jitter: ±${JITTER} whole-room + ±${JITTER / 3} per vertex (tile units)`);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("pageerror:", e.message));
await page.goto("http://localhost:5173/maps.html");

const result = await page.evaluate(async ({ locate, readings }) => {
  const { planFileToImage } = await import("/src/pro/planFile.ts");
  const { locateDrawing, padBox, readPlanTiled } = await import("/src/bridge/aiPlanImport.ts");
  const { tilesForPicture, mergeTileRooms, TILE_RENDER_EDGE } = await import("/src/pro/planTiles.ts");
  const { buildGray, eraseBubbles, shoelacePx } = await import("/src/pro/planSnap.ts");
  const { ingestAiSeeds } = await import("/src/pro/studioIngest.ts");
  const { defaultRules } = await import("/src/pro/rules.ts");

  // ── the Anthropic stub ────────────────────────────────────────────────────
  const tileByB64 = new Map(); // image base64 → reading index
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, init) => {
    if (!String(url).includes("api.anthropic.com")) return realFetch(url, init);
    const body = JSON.parse(init.body);
    const schema = body.output_config?.format?.schema ?? {};
    let payload;
    if (schema.properties && schema.properties.x0) {
      payload = locate; // the locate pass
    } else {
      const b64 = body.messages[0].content[0].source.data;
      const idx = tileByB64.get(b64);
      // an unregistered image = the whole-sheet corridor pass; no canned
      // corridor reading in this run → empty (the room score is unaffected)
      payload = idx === undefined
        ? { buildingName: "", floorName: "", rooms: [] }
        : readings[idx];
    }
    return new Response(JSON.stringify({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(payload) }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  // ── the production flow ───────────────────────────────────────────────────
  const buf = await (await fetch("/bench/fixtures/central-2nd-floor.pdf")).arrayBuffer();
  const img = await planFileToImage(new File([buf], "central.pdf", { type: "application/pdf" }));
  const box = await locateDrawing({ apiKey: "sk-test", imageDataUrl: img.dataUrl });
  if (!box) throw new Error("locate failed");
  const crop = await img.renderRegion(padBox(box), 2576);
  const { tiles } = await tilesForPicture(crop.dataUrl, crop.width, crop.height);
  // register each tile's exact render with the stub
  for (let i = 0; i < tiles.length; i++) {
    const p = await crop.renderRegion(tiles[i], TILE_RENDER_EDGE);
    tileByB64.set(p.dataUrl.split(",")[1], i);
  }
  const t0 = performance.now();
  const reading = await readPlanTiled({
    apiKey: "sk-test",
    imageDataUrl: crop.dataUrl, imageWidth: crop.width, imageHeight: crop.height,
    tiles, renderRegion: (b, t) => crop.renderRegion(b, t),
    tileEdge: TILE_RENDER_EDGE, merge: mergeTileRooms
  });

  // ── ingest exactly like the Calibration Editor ────────────────────────────
  const im = new Image();
  await new Promise((ok) => { im.onload = ok; im.src = crop.dataUrl; });
  const cv = document.createElement("canvas");
  cv.width = im.width; cv.height = im.height;
  cv.getContext("2d").drawImage(im, 0, 0);
  const g0 = buildGray(cv);
  const gray = g0 ? eraseBubbles(g0) : null;
  const seeds = reading.rooms.map((r) => ({
    name: r.name, roomNumber: r.roomNumber, roomType: r.roomType,
    polygon: r.polygon, squareFeet: 0
  }));
  const { shapes, dropped, gapFilled } = ingestAiSeeds(
    seeds, [], gray, crop.width, crop.height, defaultRules(), { fillGaps: true });

  // ── overlay ───────────────────────────────────────────────────────────────
  const octx = cv.getContext("2d");
  octx.lineWidth = 3;
  for (const s of shapes) {
    octx.strokeStyle = "rgba(225,29,72,0.85)";
    octx.fillStyle = "rgba(225,29,72,0.10)";
    octx.beginPath();
    s.pts.forEach((q, k) => (k ? octx.lineTo(q.x, q.y) : octx.moveTo(q.x, q.y)));
    octx.closePath(); octx.fill(); octx.stroke();
    let cx = 0, cy = 0;
    for (const q of s.pts) { cx += q.x; cy += q.y; }
    cx /= s.pts.length; cy /= s.pts.length;
    octx.fillStyle = "#1d4ed8";
    octx.font = "bold 22px sans-serif";
    octx.fillText(s.roomNumber || "·", cx - 24, cy + 7);
  }
  // who swallowed the readings that ingest dropped?
  const { overlapRatio } = await import("/src/pro/planSnap.ts");
  const keptNums = new Set(shapes.map((s) => s.roomNumber));
  const blame = [];
  for (const r of reading.rooms) {
    if (!r.roomNumber || keptNums.has(r.roomNumber)) continue;
    const pts = r.polygon.map((q) => ({ x: q[0] * crop.width, y: q[1] * crop.height }));
    let worst = { n: "", v: 0 };
    for (const s of shapes) {
      const v = overlapRatio(s.pts, pts);
      if (v > worst.v) worst = { n: s.roomNumber || s.roomName || "?", v };
    }
    blame.push(`${r.roomNumber} ⊂ ${worst.n} (${Math.round(worst.v * 100)}%)`);
  }

  return {
    blame,
    overlay: cv.toDataURL("image/png"),
    cropW: crop.width, cropH: crop.height,
    merged: reading.rooms.length,
    mergedNumbers: reading.rooms.map((r) => r.roomNumber).filter(Boolean),
    dropped,
    gapFilled,
    ms: Math.round(performance.now() - t0),
    shapes: shapes.map((s) => ({
      number: s.roomNumber,
      pts: s.pts.map((q) => [Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10]),
      area: Math.round(shoelacePx(s.pts))
    }))
  };
}, { locate, readings });

fs.writeFileSync("bench/out/score-overlay.png", Buffer.from(result.overlay.split(",")[1], "base64"));

// ── scoring ──────────────────────────────────────────────────────────────────
const pad = 0.02;
const crop = {
  x0: Math.max(0, locate.x0 - pad), y0: Math.max(0, locate.y0 - pad),
  x1: Math.min(1, locate.x1 + pad), y1: Math.min(1, locate.y1 + pad)
};
const toCrop = (r) => ({
  x: ((r.x - crop.x0) / (crop.x1 - crop.x0)) * result.cropW,
  y: ((r.y - crop.y0) / (crop.y1 - crop.y0)) * result.cropH
});
const inPoly = (pts, x, y) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if ((pts[i][1] > y) !== (pts[j][1] > y) &&
      x < ((pts[j][0] - pts[i][0]) * (y - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) inside = !inside;
  }
  return inside;
};
const distToPoly = (pts, x, y) => {
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j], [bx, by] = pts[i];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
};
const TOL = 14; // crop px — about half a wall thickness at this render

const rooms = key.rooms.filter((r) => !r.corridor);
const corridors = key.rooms.filter((r) => r.corridor);
const byNumber = new Map();
for (const s of result.shapes) {
  if (!s.number) continue;
  const list = byNumber.get(s.number) ?? [];
  list.push(s);
  byNumber.set(s.number, list);
}

const found = [], misplaced = [], missing = [];
for (const r of rooms) {
  const p = toCrop(r);
  const claims = byNumber.get(r.number) ?? [];
  if (!claims.length) { missing.push(r.number); continue; }
  const ok = claims.some((s) => inPoly(s.pts, p.x, p.y) || distToPoly(s.pts, p.x, p.y) <= TOL);
  (ok ? found : misplaced).push(r.number);
}
const corrFound = corridors.filter((r) => {
  const p = toCrop(r);
  return (byNumber.get(r.number) ?? []).some((s) => inPoly(s.pts, p.x, p.y) || distToPoly(s.pts, p.x, p.y) <= TOL);
});

// false positives INSIDE the EW scoring area: numbered shapes claiming a
// number the key doesn't have, or extra shapes duplicating a key number
const keyNums = new Set(key.rooms.map((r) => r.number));
const ewPts = key.rooms.map(toCrop);
const ew = {
  x0: Math.min(...ewPts.map((p) => p.x)) - 30, x1: Math.max(...ewPts.map((p) => p.x)) + 30,
  y0: Math.min(...ewPts.map((p) => p.y)) - 30, y1: Math.max(...ewPts.map((p) => p.y)) + 30
};
const centroidOf = (pts) => {
  let x = 0, y = 0;
  for (const q of pts) { x += q[0]; y += q[1]; }
  return { x: x / pts.length, y: y / pts.length };
};
let falseNumbered = 0, dupes = 0, unnumberedExtras = 0;
for (const s of result.shapes) {
  const c = centroidOf(s.pts);
  const inEw = c.x >= ew.x0 && c.x <= ew.x1 && c.y >= ew.y0 && c.y <= ew.y1;
  if (!inEw) continue;
  if (!s.number) { unnumberedExtras++; continue; }
  if (!keyNums.has(s.number)) { falseNumbered++; continue; }
}
for (const [num, list] of byNumber) {
  if (keyNums.has(num) && list.length > 1) dupes += list.length - 1;
}

const inReadings = new Set();
for (const t of readings) for (const r of t.rooms) inReadings.add(r.roomNumber);
const afterMerge = new Set(result.mergedNumbers);
const afterIngest = new Set(result.shapes.map((s) => s.number).filter(Boolean));
const lostInMerge = [...inReadings].filter((n) => !afterMerge.has(n)).sort();
const lostInIngest = [...afterMerge].filter((n) => !afterIngest.has(n)).sort();
console.log(`lost in merge: ${JSON.stringify(lostInMerge)}`);
console.log(`lost in ingest: ${JSON.stringify(lostInIngest)}`);
console.log(`ingest blame: ${JSON.stringify(result.blame)}`);

const pct = (n, d) => `${n}/${d} (${Math.round((n / d) * 1000) / 10}%)`;
console.log(`merged rooms from tiles: ${result.merged}  |  ingest dropped: ${result.dropped}  |  gap-filled: ${result.gapFilled}  |  read+merge ${result.ms}ms`);
console.log(`ROOMS   found in place: ${pct(found.length, rooms.length)}`);
console.log(`        misplaced:      ${misplaced.length} ${JSON.stringify(misplaced)}`);
console.log(`        missing:        ${missing.length} ${JSON.stringify(missing)}`);
console.log(`CORRIDORS in place:     ${pct(corrFound.length, corridors.length)} (${corridors.filter((c) => !corrFound.includes(c)).map((c) => c.number).join(", ") || "none missing"})`);
console.log(`FALSE   wrong-number in EW: ${falseNumbered}   duplicate numbers: ${dupes}   unnumbered extras in EW: ${unnumberedExtras}`);
console.log(`overlay: bench/out/score-overlay.png`);
await browser.close();
