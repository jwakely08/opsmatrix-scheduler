// For each tile: run the LOCAL detector (bubble-erased flood fill) at tile
// resolution and export the found region polygons + an indexed overlay.
// A human then assigns the printed room number to each region index in
// bench/readings/tile-N.map.json; bench/build-readings.mjs composes the
// final per-tile readings. Regions are honest wall-tight outlines — the
// number assignment stands in for the model's reading of the printed tags.
// Usage: node bench/regions.mjs 8 9 10 ...
import { chromium } from "playwright";
import fs from "node:fs";

const idx = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("pageerror:", e.message));
await page.goto("http://localhost:5173/maps.html");

for (const i of idx) {
  const b64 = fs.readFileSync(`bench/out/tile-${i}.png`).toString("base64");
  const res = await page.evaluate(async (b64) => {
    const { grayFromPixels, stretchGray, eraseBubbles, autoDetectRooms, centroid } =
      await import("/src/pro/planSnap.ts");
    const im = new Image();
    await new Promise((ok) => { im.onload = ok; im.src = "data:image/png;base64," + b64; });
    const cv = document.createElement("canvas");
    cv.width = im.width; cv.height = im.height;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(im, 0, 0);
    const g0 = grayFromPixels(ctx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
    const g = stretchGray(g0);
    const polys = autoDetectRooms(g, { maxSide: 1024, keepBorder: true, dilate: 3, minAreaFrac: 0.0005 });
    // overlay
    ctx.lineWidth = 4;
    polys.forEach((p, n) => {
      ctx.strokeStyle = "rgba(225,29,72,0.9)";
      ctx.beginPath();
      p.forEach((q, k) => (k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath(); ctx.stroke();
      const c = centroid(p);
      ctx.fillStyle = "#2563eb";
      ctx.font = "bold 40px sans-serif";
      ctx.fillText(String(n), c.x - 20, c.y + 14);
    });
    return {
      overlay: cv.toDataURL("image/png"),
      polys: polys.map((p) => p.map((q) => [Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10])),
      w: cv.width, h: cv.height
    };
  }, b64);
  fs.writeFileSync(`bench/out/tile-${i}-regions.png`, Buffer.from(res.overlay.split(",")[1], "base64"));
  fs.writeFileSync(`bench/out/tile-${i}-regions.json`, JSON.stringify({ w: res.w, h: res.h, polys: res.polys }));
  console.log(`tile-${i}: ${res.polys.length} regions`);
}
await browser.close();
