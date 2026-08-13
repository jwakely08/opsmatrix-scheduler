// Turn whatever the manager picked — PNG, JPG or PDF — into one plain image
// data URL, so everything downstream only ever deals with a picture.
//
// pdf.js is served from our own origin and pulled in lazily: nobody downloads
// it unless they actually pick a PDF. It is never loaded from a CDN, because
// this page holds the account's Anthropic API key.

const PDFJS_URL = "/pdfjs/pdf.min.mjs";
const PDF_WORKER_URL = "/pdfjs/pdf.worker.min.mjs";

/** long edge of the picture we hand to the model */
export const PLAN_IMAGE_SIZE = 2000;

let pdfLib: Promise<{ getDocument: (o: unknown) => { promise: Promise<PdfDoc> }; GlobalWorkerOptions: { workerSrc: string } }> | null = null;

interface PdfPage {
  getViewport: (o: { scale: number; offsetX?: number; offsetY?: number }) => { width: number; height: number };
  render: (o: unknown) => { promise: Promise<void> };
}
interface PdfDoc { getPage: (n: number) => Promise<PdfPage> }

function loadPdfLib() {
  if (!pdfLib) {
    pdfLib = import(/* @vite-ignore */ new URL(PDFJS_URL, document.baseURI).href)
      .then((lib) => { lib.GlobalWorkerOptions.workerSrc = new URL(PDF_WORKER_URL, document.baseURI).href; return lib; });
  }
  return pdfLib;
}

export function isPdf(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

export interface PlanImage {
  dataUrl: string;
  width: number;
  height: number;
  /** width / height — used to shape the rebuilt plan */
  aspect: number;
  /**
   * Re-render a region (normalised box) of the SOURCE at a target long edge.
   * For PDFs this re-rasterises the vectors, so a crop of a small drawing on
   * a big sheet comes back razor sharp instead of blown up and blurry.
   */
  renderRegion: (box: { x0: number; y0: number; x1: number; y1: number }, targetLongEdge: number) => Promise<PlanImage>;
}

/** first page of a PDF, rendered big enough for the model to read wall lines */
async function pdfPageToImage(file: File): Promise<PlanImage> {
  const lib = await loadPdfLib();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });

  const renderAt = async (
    box: { x0: number; y0: number; x1: number; y1: number },
    targetLongEdge: number
  ): Promise<PlanImage> => {
    const bw = (box.x1 - box.x0) * base.width;
    const bh = (box.y1 - box.y0) * base.height;
    // scale so the CROP hits the target — the vectors re-rasterise crisply
    const scale = Math.min(8, Math.max(1, targetLongEdge / Math.max(bw, bh)));
    // pdf.js offsets shift the page inside the canvas, so a canvas sized to
    // the crop with negative offsets renders exactly the region we want
    const viewport = page.getViewport({
      scale,
      offsetX: -box.x0 * base.width * scale,
      offsetY: -box.y0 * base.height * scale
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bw * scale);
    canvas.height = Math.round(bh * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff"; // PDFs are transparent; walls need a ground to sit on
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    return {
      dataUrl: canvas.toDataURL("image/png"),
      width: canvas.width,
      height: canvas.height,
      aspect: canvas.width / canvas.height,
      renderRegion: (b, t) => renderAt(composeBoxes(box, b), t)
    };
  };

  return renderAt({ x0: 0, y0: 0, x1: 1, y1: 1 }, PLAN_IMAGE_SIZE);
}

/** a box within a box → the equivalent box on the original source */
function composeBoxes(
  outer: { x0: number; y0: number; x1: number; y1: number },
  inner: { x0: number; y0: number; x1: number; y1: number }
) {
  const w = outer.x1 - outer.x0, h = outer.y1 - outer.y0;
  return {
    x0: outer.x0 + inner.x0 * w, y0: outer.y0 + inner.y0 * h,
    x1: outer.x0 + inner.x1 * w, y1: outer.y0 + inner.y1 * h
  };
}

/** an ordinary image, downscaled if it is larger than the model can use */
async function imageFileToImage(file: File): Promise<PlanImage> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That image could not be opened.")); };
    img.src = url;
  });
  // the Image is kept alive (URL not revoked) so regions can be re-cropped
  // from the ORIGINAL pixels rather than from an already-downscaled copy
  const renderAt = (
    box: { x0: number; y0: number; x1: number; y1: number },
    targetLongEdge: number
  ): Promise<PlanImage> => {
    const sx = box.x0 * img.width, sy = box.y0 * img.height;
    const sw = (box.x1 - box.x0) * img.width, sh = (box.y1 - box.y0) * img.height;
    const scale = Math.min(1, targetLongEdge / Math.max(sw, sh)); // never upscale pixels
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return Promise.resolve({
      // JPEG keeps big plans under the request size limit
      dataUrl: canvas.toDataURL("image/jpeg", 0.92),
      width: canvas.width,
      height: canvas.height,
      aspect: canvas.width / canvas.height,
      renderRegion: (b, t) => renderAt(composeBoxes(box, b), t)
    });
  };
  return renderAt({ x0: 0, y0: 0, x1: 1, y1: 1 }, PLAN_IMAGE_SIZE);
}

export function planFileToImage(file: File): Promise<PlanImage> {
  return isPdf(file) ? pdfPageToImage(file) : imageFileToImage(file);
}
