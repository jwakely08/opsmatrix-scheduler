// Visualise what the REAL autoDetectRooms pipeline sees for one tile:
// black = wall ink (max-pooled), red = sealed door gaps, blue outlines =
// regions the detector returns.
import { chromium } from "playwright";
import fs from "node:fs";

const i = process.argv[2] ?? "8";
const maxW = Number(process.argv[3] ?? 1024);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("pageerror:", e.message));
await page.goto("http://localhost:5173/maps.html");

const res = await page.evaluate(async ({ b64, maxW }) => {
  const { grayFromPixels, stretchGray, eraseBubbles, sealDoorGaps, autoDetectRooms } =
    await import("/src/pro/planSnap.ts");
  const im = new Image();
  await new Promise((ok) => { im.onload = ok; im.src = "data:image/png;base64," + b64; });
  const cv = document.createElement("canvas");
  cv.width = im.width; cv.height = im.height;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(im, 0, 0);
  const G = eraseBubbles(stretchGray(
    grayFromPixels(ctx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height)));
  const sc = G.w > maxW ? maxW / G.w : 1;
  const w = Math.round(G.w * sc), hh = Math.round(G.h * sc);
  const wall = new Uint8Array(w * hh);
  for (let gy = 0; gy < G.h; gy++) {
    const y = Math.min(hh - 1, Math.floor(gy * sc));
    for (let gx = 0; gx < G.w; gx++) {
      const v = G.data[gy * G.w + gx];
      if ((G.dark ? 1 - v : v) > 0.45) wall[y * w + Math.min(w - 1, Math.floor(gx * sc))] = 1;
    }
  }
  const sealed = sealDoorGaps(wall, w, hh, Math.round(w * 0.03));
  const out = document.createElement("canvas");
  out.width = w; out.height = hh;
  const octx = out.getContext("2d");
  const id = octx.createImageData(w, hh);
  for (let k = 0; k < w * hh; k++) {
    const p = k * 4;
    if (wall[k]) { id.data[p] = 0; id.data[p + 1] = 0; id.data[p + 2] = 0; }
    else if (sealed[k]) { id.data[p] = 230; id.data[p + 1] = 40; id.data[p + 2] = 70; }
    else { id.data[p] = 255; id.data[p + 1] = 255; id.data[p + 2] = 255; }
    id.data[p + 3] = 255;
  }
  octx.putImageData(id, 0, 0);
  const polys = autoDetectRooms(G, { maxSide: maxW, keepBubbles: true, keepBorder: true, dilate: 3, minAreaFrac: 0.0005 });
  octx.strokeStyle = "rgba(37,99,235,0.85)";
  octx.lineWidth = 2;
  for (const poly of polys) {
    octx.beginPath();
    poly.forEach((q, k2) => (k2 ? octx.lineTo(q.x * sc, q.y * sc) : octx.moveTo(q.x * sc, q.y * sc)));
    octx.closePath(); octx.stroke();
  }
  return { png: out.toDataURL("image/png"), count: polys.length };
}, { b64: fs.readFileSync(`bench/out/tile-${i}.png`).toString("base64"), maxW });
fs.writeFileSync(`bench/out/tile-${i}-mask.png`, Buffer.from(res.png.split(",")[1], "base64"));
console.log(`bench/out/tile-${i}-mask.png regions=${res.count}`);
await browser.close();
