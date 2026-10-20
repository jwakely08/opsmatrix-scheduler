// Overlay a labelled coordinate grid on the exported tile PNGs so room
// rectangles can be read off by eye (bench/out/tile-N-grid.png).
import { chromium } from "playwright";
import fs from "node:fs";

const idx = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
await page.goto("about:blank");

for (const i of idx) {
  const b64 = fs.readFileSync(`bench/out/tile-${i}.png`).toString("base64");
  const out = await page.evaluate(async (b64) => {
    const im = new Image();
    await new Promise((ok) => { im.onload = ok; im.src = "data:image/png;base64," + b64; });
    const cv = document.createElement("canvas");
    cv.width = im.width; cv.height = im.height;
    const ctx = cv.getContext("2d");
    ctx.drawImage(im, 0, 0);
    ctx.strokeStyle = "rgba(220,40,80,0.45)";
    ctx.fillStyle = "rgba(220,40,80,0.95)";
    ctx.font = "bold 22px sans-serif";
    for (let x = 0; x < cv.width; x += 100) {
      ctx.lineWidth = x % 500 === 0 ? 2.5 : 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, cv.height); ctx.stroke();
      if (x % 200 === 0) { ctx.fillText(String(x), x + 3, 24); ctx.fillText(String(x), x + 3, cv.height - 8); }
    }
    for (let y = 0; y < cv.height; y += 100) {
      ctx.lineWidth = y % 500 === 0 ? 2.5 : 1;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cv.width, y); ctx.stroke();
      if (y % 200 === 0) { ctx.fillText(String(y), 4, y + 24); ctx.fillText(String(y), cv.width - 60, y + 24); }
    }
    return cv.toDataURL("image/png");
  }, b64);
  fs.writeFileSync(`bench/out/tile-${i}-grid.png`, Buffer.from(out.split(",")[1], "base64"));
  console.log(`tile-${i}-grid.png`);
}
await browser.close();
