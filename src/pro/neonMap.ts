// The matrix look, baked into pixels — because the browser can't be trusted
// to do it live. The maps used to render the stored light blueprint through
// `filter: invert(...) …` + `mix-blend-mode: screen` on an SVG <image>; iOS
// Safari silently drops that filter inside a transformed group, so phones got
// the raw white plan pasted OVER the room fills: washed-out hairlines, no
// highlights (Josh, staging, 2026-09-02). This module converts the blueprint
// ONCE, in a canvas, into glowing cyan linework on a TRANSPARENT ground —
// plain alpha compositing after that, identical on every browser and zoom.
// Stored plans stay light blueprints (they print clean); only the on-screen
// map wears the baked neon.

/** neon line color (matches the Deep Theme's cyan) */
const NEON = { r: 103, g: 232, b: 249 };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** mean luminance 0..1 of the visible pixels — >0.5 means light paper, dark ink */
export function meanLuminance(px: Uint8ClampedArray | number[], count: number): number {
  let sum = 0, n = 0;
  for (let i = 0; i < count; i++) {
    const p = i * 4;
    if (Number(px[p + 3]) < 8) continue; // transparent — not paper, not ink
    sum += (Number(px[p]) * 0.299 + Number(px[p + 1]) * 0.587 + Number(px[p + 2]) * 0.114) / 255;
    n++;
  }
  return n ? sum / n : 1;
}

/**
 * In place: every pixel becomes neon-on-transparent. Ink strength drives
 * alpha; strong ink cores brighten toward white so walls glow instead of
 * reading flat. Pure over the RGBA array, so it's unit-testable.
 */
export function neonizePixels(px: Uint8ClampedArray | number[], count: number, inkIsDark: boolean): void {
  for (let i = 0; i < count; i++) {
    const p = i * 4;
    const a0 = Number(px[p + 3]) / 255;
    const lum = (Number(px[p]) * 0.299 + Number(px[p + 1]) * 0.587 + Number(px[p + 2]) * 0.114) / 255;
    const resp = (inkIsDark ? 1 - lum : lum) * a0;
    const alpha = clamp01((resp - 0.06) * 1.7);
    const core = clamp01(resp * 1.25 - 0.45); // how far the color leans white
    px[p] = Math.round(NEON.r + (255 - NEON.r) * core);
    px[p + 1] = Math.round(NEON.g + (255 - NEON.g) * core);
    px[p + 2] = Math.round(NEON.b + (255 - NEON.b) * core);
    px[p + 3] = Math.round(alpha * 255);
  }
}

// ── browser side: image → baked neon data URL, cached per source ───────────

const cache = new Map<string, string>();

/**
 * Bake a plan image into its neon rendering. Resolves to a PNG data URL with
 * transparent background; rejects only if the image itself can't load — the
 * caller keeps showing the plain plan in that case.
 */
export async function neonPlanUrl(src: string, maxSide = 2400): Promise<string> {
  const hit = cache.get(src);
  if (hit) return hit;
  const img = new Image();
  img.decoding = "async";
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("plan image failed to load"));
    img.src = src;
  });
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (!iw || !ih) throw new Error("plan image is empty");
  const sc = Math.min(1, maxSide / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * sc)), h = Math.max(1, Math.round(ih * sc));
  const work = document.createElement("canvas");
  work.width = w; work.height = h;
  const ctx = work.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(img, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h);
  const inkIsDark = meanLuminance(id.data, w * h) > 0.5;
  neonizePixels(id.data, w * h, inkIsDark);
  ctx.putImageData(id, 0, 0);
  // the glow pass: the old CSS drop-shadow fattened hairline walls so a phone
  // fitting the whole floor still shows them — same job, done with plain
  // compositing: a faint 4-way halo under the crisp center.
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const octx = out.getContext("2d");
  if (!octx) throw new Error("no 2d context");
  octx.globalAlpha = 0.4;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    octx.drawImage(work, dx, dy);
  }
  octx.globalAlpha = 1;
  octx.drawImage(work, 0, 0);
  const url = out.toDataURL("image/png");
  cache.set(src, url);
  return url;
}
