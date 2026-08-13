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
  getViewport: (o: { scale: number }) => { width: number; height: number };
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
}

/** first page of a PDF, rendered big enough for the model to read wall lines */
async function pdfPageToImage(file: File): Promise<PlanImage> {
  const lib = await loadPdfLib();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(4, Math.max(1, PLAN_IMAGE_SIZE / Math.max(base.width, base.height)));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; // PDFs are transparent; walls need a ground to sit on
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  return {
    dataUrl: canvas.toDataURL("image/png"),
    width: canvas.width,
    height: canvas.height,
    aspect: canvas.width / canvas.height
  };
}

/** an ordinary image, downscaled if it is larger than the model can use */
async function imageFileToImage(file: File): Promise<PlanImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("That image could not be opened."));
      img.src = url;
    });
    const long = Math.max(img.width, img.height);
    const scale = long > PLAN_IMAGE_SIZE ? PLAN_IMAGE_SIZE / long : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return {
      // JPEG keeps big plans under the request size limit
      dataUrl: canvas.toDataURL("image/jpeg", 0.92),
      width: canvas.width,
      height: canvas.height,
      aspect: canvas.width / canvas.height
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function planFileToImage(file: File): Promise<PlanImage> {
  return isPdf(file) ? pdfPageToImage(file) : imageFileToImage(file);
}
