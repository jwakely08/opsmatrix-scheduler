// Prepare the reading copy of a floor plan — browser canvas only.
//
// The picture the manager sees is never touched. For the AI read (and the tile
// crops) we make a SEPARATE, cleaned-up copy: greyscale + a contrast lift so
// faint pencil walls on a hand-drawn scan come back as crisp dark lines and the
// page noise drops back. Cleaner walls help the model AND the snap engine, which
// both key off wall ink. This is the "modify the blueprint so it reads better"
// step — applied to the reading copy, shown to nobody.
import type { PlanPicture, DrawingBox } from "../bridge/aiPlanImport";

/** load a data URL into an <img> we can crop from repeatedly */
export function loadImageEl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That image could not be opened."));
    img.src = dataUrl;
  });
}

/**
 * Crop a normalised region of `img` and clean it for reading. A tiny tile is
 * allowed to upscale modestly (up to 2×) so its room tags become legible; a
 * big region is capped at `longEdge`. Greyscale + contrast is applied through
 * the 2D context filter, which the deployment target (Chromium) supports.
 */
export function cropClean(
  img: HTMLImageElement,
  box: DrawingBox,
  longEdge = 1600,
  clean = true
): PlanPicture {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const sx = box.x0 * iw, sy = box.y0 * ih;
  const sw = Math.max(1, (box.x1 - box.x0) * iw);
  const sh = Math.max(1, (box.y1 - box.y0) * ih);
  const scale = Math.min(2, longEdge / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  // greyscale + contrast lift + a touch of brightness: pencil walls go dark and
  // crisp, faint page tone washes out. Guarded — an engine without ctx.filter
  // still gets a clean plain crop.
  try { if (clean && "filter" in ctx) (ctx as CanvasRenderingContext2D).filter = "grayscale(1) contrast(1.9) brightness(1.06)"; } catch { /* older canvas */ }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  return {
    // JPEG keeps a large crop under the request size limit
    dataUrl: canvas.toDataURL("image/jpeg", 0.92),
    width: w, height: h, aspect: w / h
  };
}
