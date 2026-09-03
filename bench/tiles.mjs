// Phase 1 of the benchmark: run the PRODUCTION crop + tile analysis on the
// benchmark PDF and export each tile as a PNG (bench/out/tile-N.png) plus
// bench/out/tiles-meta.json. A human (or the real model on staging) then
// reads each tile into bench/readings/tile-N.json, which phase 2
// (bench/score.mjs) feeds through the production merge/ingest and scores.
//
// The locate step is canned (bench/readings/locate.json) because this
// sandbox cannot reach the Anthropic API — the box was placed by eye and is
// verified visually via bench/out/crop.png.
import { chromium } from "playwright";
import fs from "node:fs";

const locate = JSON.parse(fs.readFileSync("bench/readings/locate.json", "utf8"));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("pageerror:", e.message));
await page.goto("http://localhost:5173/maps.html");

const res = await page.evaluate(async ({ locate }) => {
  const { planFileToImage } = await import("/src/pro/planFile.ts");
  const { padBox } = await import("/src/bridge/aiPlanImport.ts");
  const { tilesForPicture, TILE_RENDER_EDGE } = await import("/src/pro/planTiles.ts");
  const buf = await (await fetch("/bench/fixtures/central-2nd-floor.pdf")).arrayBuffer();
  const img = await planFileToImage(new File([buf], "c.pdf", { type: "application/pdf" }));
  const crop = await img.renderRegion(padBox(locate), 2576);
  const { tiles, bubbleCount } = await tilesForPicture(crop.dataUrl, crop.width, crop.height);
  const tilePics = [];
  for (const t of tiles) {
    const p = await crop.renderRegion(t, TILE_RENDER_EDGE);
    tilePics.push({ box: t, dataUrl: p.dataUrl, w: p.width, h: p.height });
  }
  return {
    crop: { dataUrl: crop.dataUrl, w: crop.width, h: crop.height },
    bubbleCount, tiles, tilePics
  };
}, { locate });

fs.mkdirSync("bench/out", { recursive: true });
fs.writeFileSync("bench/out/crop.png", Buffer.from(res.crop.dataUrl.split(",")[1], "base64"));
res.tilePics.forEach((t, i) => {
  fs.writeFileSync(`bench/out/tile-${i}.png`, Buffer.from(t.dataUrl.split(",")[1], "base64"));
});
fs.writeFileSync("bench/out/tiles-meta.json", JSON.stringify({
  locate,
  crop: { w: res.crop.w, h: res.crop.h },
  bubbleCount: res.bubbleCount,
  tiles: res.tiles,
  tileSizes: res.tilePics.map((t) => ({ w: t.w, h: t.h }))
}, null, 1));
console.log(`crop ${res.crop.w}x${res.crop.h}, bubbles found: ${res.bubbleCount}, tiles: ${res.tiles.length}`);
res.tilePics.forEach((t, i) => console.log(
  ` tile-${i}: [${t.box.x0.toFixed(3)},${t.box.y0.toFixed(3)} → ${t.box.x1.toFixed(3)},${t.box.y1.toFixed(3)}] ${t.w}x${t.h}`));
await browser.close();
