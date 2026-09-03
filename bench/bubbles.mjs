// Prototype the label-bubble detector on a crop of the benchmark sheet.
// Detects the stadium-shaped room-number bubbles, then writes:
//   bench/out/bubbles-overlay.png  — the crop with indexed boxes drawn on
//   bench/out/bubbles-montage.png  — every bubble cropped into a numbered grid
//   bench/out/bubbles.json         — detections in full-sheet normalised coords
// Usage: node bench/bubbles.mjs x0 y0 x1 y1 longEdge
import { chromium } from "playwright";
import fs from "node:fs";

const [x0, y0, x1, y1, long] = process.argv.slice(2).map(Number);
const box = { x0, y0, x1, y1 };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("pageerror:", e.message));
page.on("console", (m) => console.log("[page]", m.text()));
await page.goto("http://localhost:5173/maps.html");

const res = await page.evaluate(async ({ box, long }) => {
  const { planFileToImage } = await import("/src/pro/planFile.ts");
  const { grayFromPixels } = await import("/src/pro/planSnap.ts");
  const buf = await (await fetch("/bench/fixtures/central-2nd-floor.pdf")).arrayBuffer();
  const file = new File([buf], "c.pdf", { type: "application/pdf" });
  const img = await planFileToImage(file);
  const crop = await img.renderRegion(box, long);

  const cv = document.createElement("canvas");
  const im = new Image();
  await new Promise((ok) => { im.onload = ok; im.src = crop.dataUrl; });
  cv.width = im.width; cv.height = im.height;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(im, 0, 0);
  const G = grayFromPixels(ctx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
  const W = G.w, H = G.h;

  // ink mask
  const ink = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const v = G.data[i];
    ink[i] = (G.dark ? 1 - v : v) > 0.45 ? 1 : 0;
  }
  // flood-fill non-ink regions (4-connected), no dilation
  const label = new Int32Array(W * H);
  for (let i = 0; i < W * H; i++) if (ink[i]) label[i] = -1;
  const qx = new Int32Array(W * H), qy = new Int32Array(W * H);
  let next = 1;
  const regions = [];
  for (let sy = 0; sy < H; sy++) for (let sx = 0; sx < W; sx++) {
    const si = sy * W + sx;
    if (label[si] !== 0) continue;
    let head = 0, tail = 0;
    qx[tail] = sx; qy[tail] = sy; tail++;
    label[si] = next;
    let area = 0, minx = sx, maxx = sx, miny = sy, maxy = sy, border = false;
    while (head < tail) {
      const cx = qx[head], cy = qy[head]; head++;
      area++;
      if (cx === 0 || cy === 0 || cx === W - 1 || cy === H - 1) border = true;
      if (cx < minx) minx = cx; if (cx > maxx) maxx = cx;
      if (cy < miny) miny = cy; if (cy > maxy) maxy = cy;
      const nb = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (label[ni] === 0) { label[ni] = next; qx[tail] = nx; qy[tail] = ny; tail++; }
      }
    }
    regions.push({ id: next, area, minx, maxx, miny, maxy, border });
    next++;
  }

  // bubble test — thresholds relative to the render size
  const S = Math.max(W, H);
  const out = [];
  for (const r of regions) {
    if (r.border) continue;
    const bw = r.maxx - r.minx + 1, bh = r.maxy - r.miny + 1;
    const short = Math.min(bw, bh), lng = Math.max(bw, bh);
    if (short < S * 0.008 || short > S * 0.035) continue;
    if (lng > S * 0.12) continue;
    if (lng / short < 1.5) continue;
    const fill = r.area / (bw * bh);
    if (fill < 0.72) continue;
    out.push({ minx: r.minx, miny: r.miny, maxx: r.maxx, maxy: r.maxy, area: r.area, fill: Math.round(fill * 100) / 100 });
  }
  out.sort((a, b) => (a.miny - b.miny) || (a.minx - b.minx));

  // overlay
  ctx.strokeStyle = "#e11d48"; ctx.lineWidth = 3; ctx.font = "bold 26px sans-serif"; ctx.fillStyle = "#e11d48";
  out.forEach((b, i) => {
    ctx.strokeRect(b.minx - 2, b.miny - 2, b.maxx - b.minx + 5, b.maxy - b.miny + 5);
    ctx.fillText(String(i), b.minx - 2, b.miny - 8);
  });
  const overlay = cv.toDataURL("image/png");

  // montage: each bubble upright, labelled. Vertical bubbles are drawn twice
  // (rotated both ways) so the readable one is always present.
  const upright = (b, dir) => {
    const bw = b.maxx - b.minx + 1, bh = b.maxy - b.miny + 1;
    const t = document.createElement("canvas");
    if (bh > bw) {
      t.width = bh; t.height = bw;
      const tx = t.getContext("2d");
      if (dir === "cw") { tx.translate(t.width, 0); tx.rotate(Math.PI / 2); }
      else { tx.translate(0, t.height); tx.rotate(-Math.PI / 2); }
      tx.drawImage(im, b.minx, b.miny, bw, bh, 0, 0, bw, bh);
    } else {
      t.width = bw; t.height = bh;
      t.getContext("2d").drawImage(im, b.minx, b.miny, bw, bh, 0, 0, bw, bh);
    }
    return t;
  };
  const cell = 210, ch = 96, cols = 5;
  const rows = Math.ceil(out.length / cols);
  const mc = document.createElement("canvas");
  mc.width = cols * cell; mc.height = rows * ch;
  const mx = mc.getContext("2d");
  mx.fillStyle = "#fff"; mx.fillRect(0, 0, mc.width, mc.height);
  out.forEach((b, i) => {
    const gx = (i % cols) * cell, gy = Math.floor(i / cols) * ch;
    const bw = b.maxx - b.minx + 1, bh = b.maxy - b.miny + 1;
    const vertical = bh > bw;
    const draw = (t, dx, dy) => {
      const s = Math.min((cell - 50) / t.width, 40 / t.height, 1);
      mx.drawImage(t, gx + dx, gy + dy, t.width * s, t.height * s);
    };
    draw(upright(b, "ccw"), 44, 4);
    if (vertical) draw(upright(b, "cw"), 44, 50);
    mx.fillStyle = "#e11d48"; mx.font = "bold 18px sans-serif";
    mx.fillText(String(i), gx + 4, gy + 40);
    mx.strokeStyle = "#ddd"; mx.strokeRect(gx, gy, cell, ch);
  });
  const montage = mc.toDataURL("image/png");

  // normalise detections back to FULL-SHEET coordinates
  const bx = box, bwN = bx.x1 - bx.x0, bhN = bx.y1 - bx.y0;
  const dets = out.map((b, i) => ({
    i,
    cx: bx.x0 + ((b.minx + b.maxx) / 2 / W) * bwN,
    cy: bx.y0 + ((b.miny + b.maxy) / 2 / H) * bhN,
    w: ((b.maxx - b.minx + 1) / W) * bwN,
    h: ((b.maxy - b.miny + 1) / H) * bhN,
    fill: b.fill
  }));
  return { overlay, montage, dets, W, H, regionCount: regions.length };
}, { box, long });

const save = (name, dataUrl) =>
  fs.writeFileSync(`bench/out/${name}`, Buffer.from(dataUrl.split(",")[1], "base64"));
save("bubbles-overlay.png", res.overlay);
save("bubbles-montage.png", res.montage);
fs.writeFileSync("bench/out/bubbles.json", JSON.stringify(res.dets, null, 1));
console.log(`render ${res.W}x${res.H}, regions ${res.regionCount}, bubbles ${res.dets.length}`);
await browser.close();
