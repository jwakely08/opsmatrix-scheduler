// Render the benchmark PDF through the app's OWN pipeline (vendored pdf.js via
// src/pro/planFile.ts) and save PNGs — the full sheet plus any requested crops.
// Usage: node bench/render.mjs [x0 y0 x1 y1 longEdge name] ...
//   with no args: the full sheet at PLAN_IMAGE_SIZE.
// Needs the vite dev server on :5173 and bench/fixtures/central-2nd-floor.pdf.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve("bench/out");
fs.mkdirSync(OUT, { recursive: true });

const crops = [];
const argv = process.argv.slice(2);
for (let i = 0; i + 5 < argv.length + 1 && argv.length >= 6; i += 6) {
  if (i + 6 > argv.length) break;
  crops.push({
    x0: Number(argv[i]), y0: Number(argv[i + 1]),
    x1: Number(argv[i + 2]), y1: Number(argv[i + 3]),
    long: Number(argv[i + 4]), name: argv[i + 5]
  });
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("pageerror:", e.message));
await page.goto("http://localhost:5173/maps.html");

const results = await page.evaluate(async (crops) => {
  const { planFileToImage } = await import("/src/pro/planFile.ts");
  const buf = await (await fetch("/bench/fixtures/central-2nd-floor.pdf")).arrayBuffer();
  const file = new File([buf], "central-2nd-floor.pdf", { type: "application/pdf" });
  const img = await planFileToImage(file);
  const out = [{ name: "full", dataUrl: img.dataUrl, w: img.width, h: img.height }];
  for (const c of crops) {
    const r = await img.renderRegion({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 }, c.long);
    out.push({ name: c.name, dataUrl: r.dataUrl, w: r.width, h: r.height });
  }
  return out;
}, crops);

for (const r of results) {
  const b64 = r.dataUrl.split(",")[1];
  const file = path.join(OUT, `${r.name}.png`);
  fs.writeFileSync(file, Buffer.from(b64, "base64"));
  console.log(`${file}  ${r.w}x${r.h}`);
}
await browser.close();
