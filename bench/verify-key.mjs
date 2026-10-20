// Draw the answer key's points on a render of the EW wing for eyeball checks.
import { chromium } from "playwright";
import fs from "node:fs";

const key = JSON.parse(fs.readFileSync("bench/answer-key-ew.json", "utf8"));
const box = { x0: 0.38, y0: 0.50, x1: 0.88, y1: 0.70 };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
await page.goto("http://localhost:5173/maps.html");
const dataUrl = await page.evaluate(async ({ box, rooms }) => {
  const { planFileToImage } = await import("/src/pro/planFile.ts");
  const buf = await (await fetch("/bench/fixtures/central-2nd-floor.pdf")).arrayBuffer();
  const img = await planFileToImage(new File([buf], "c.pdf", { type: "application/pdf" }));
  const crop = await img.renderRegion(box, 2600);
  const im = new Image();
  await new Promise((ok) => { im.onload = ok; im.src = crop.dataUrl; });
  const cv = document.createElement("canvas");
  cv.width = im.width; cv.height = im.height;
  const ctx = cv.getContext("2d");
  ctx.drawImage(im, 0, 0);
  for (const r of rooms) {
    const px = ((r.x - box.x0) / (box.x1 - box.x0)) * cv.width;
    const py = ((r.y - box.y0) / (box.y1 - box.y0)) * cv.height;
    ctx.fillStyle = r.corridor ? "#2563eb" : "#e11d48";
    ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();
    ctx.font = "bold 20px sans-serif";
    ctx.fillText(r.number, px + 9, py - 6);
  }
  return cv.toDataURL("image/png");
}, { box, rooms: key.rooms });
fs.writeFileSync("bench/out/key-verify.png", Buffer.from(dataUrl.split(",")[1], "base64"));
console.log("bench/out/key-verify.png");
await browser.close();
