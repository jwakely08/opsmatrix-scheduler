// Save the printed schedule as a PDF without the browser's print dialog. The iPad's home-screen app
// cannot open one at all (Josh, 2026-11-02: "when I click on print schedule, I can't print/save as PDF
// — the button doesn't do anything"), so the preview's pages are drawn to canvases (html2canvas) and
// written into a Letter PDF (jsPDF). The file then goes to the share sheet — Print, Save to Files,
// AirDrop, Mail — where there is one, or downloads. Both libraries are served from OUR origin
// (public/vendor, like SheetJS) and loaded only when asked for.
declare global {
  interface Window {
    html2canvas?: Html2Canvas;
    jspdf?: { jsPDF: JsPdfCtor };
  }
}
type Html2Canvas = (el: HTMLElement, opts?: Record<string, unknown>) => Promise<HTMLCanvasElement>;
interface JsPdf {
  addPage(): void;
  addImage(data: string, fmt: string, x: number, y: number, w: number, h: number, alias?: string, compression?: string): void;
  output(type: "blob"): Blob;
  internal: { pageSize: { getWidth(): number; getHeight(): number } };
}
type JsPdfCtor = new (opts: { unit: string; format: string; orientation: string }) => JsPdf;

const loadScript = (src: string, ready: () => boolean, what: string) => new Promise<void>((resolve, reject) => {
  if (ready()) { resolve(); return; }
  const s = document.createElement("script");
  s.src = src;
  s.onload = () => (ready() ? resolve() : reject(new Error(`${what} did not load.`)));
  s.onerror = () => reject(new Error(`${what} could not be loaded. Check the connection and try again.`));
  document.head.appendChild(s);
});

export async function loadPdfLibs(): Promise<{ html2canvas: Html2Canvas; jsPDF: JsPdfCtor }> {
  await loadScript("./vendor/html2canvas.min.js", () => Boolean(window.html2canvas), "The page renderer");
  await loadScript("./vendor/jspdf.umd.min.js", () => Boolean(window.jspdf?.jsPDF), "The PDF writer");
  return { html2canvas: window.html2canvas!, jsPDF: window.jspdf!.jsPDF };
}

/** the floor plan's SVG is styled by the stylesheet; a serialized SVG loses that, so pin the styles on */
function pinSvgStyles(clonedDoc: Document) {
  const view = clonedDoc.defaultView ?? window;
  const props = ["fill", "stroke", "stroke-width", "stroke-linejoin", "font-size", "font-family", "font-weight",
    "opacity", "fill-opacity", "stroke-opacity", "text-anchor", "dominant-baseline"];
  for (const el of clonedDoc.querySelectorAll<SVGElement>("svg, svg *")) {
    const cs = view.getComputedStyle(el);
    for (const p of props) {
      const v = cs.getPropertyValue(p);
      if (v) el.style.setProperty(p, v);
    }
  }
  // the floor plan's drawing sits ON TOP of the room fills, blended (multiply) so the fills show
  // through; the renderer knows no blending and would cover them — so put the drawing underneath
  // and let the fills be translucent instead
  for (const svg of clonedDoc.querySelectorAll("svg.pmap")) {
    const img = svg.querySelector("image");
    if (img) svg.insertBefore(img, svg.firstChild);
    for (const p of svg.querySelectorAll<SVGPathElement>("path")) {
      if ((p.getAttribute("fill") ?? "").toLowerCase() === "#e9eef3") p.style.setProperty("fill-opacity", "0.35");
    }
  }
}

/** every page of the preview, one PDF page each, Letter portrait, drawn at 2× for crisp print */
export async function pagesToPdf(pages: HTMLElement[]): Promise<Blob> {
  const { html2canvas, jsPDF } = await loadPdfLibs();
  const pdf = new jsPDF({ unit: "pt", format: "letter", orientation: "portrait" });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  for (let i = 0; i < pages.length; i++) {
    const canvas = await html2canvas(pages[i], {
      scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false, onclone: pinSvgStyles
    });
    const ratio = Math.min(W / canvas.width, H / canvas.height);
    if (i > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.9), "JPEG", 0, 0, canvas.width * ratio, canvas.height * ratio, undefined, "FAST");
  }
  return pdf.output("blob");
}

/** the home-screen app on an iPad / iPhone (no print dialog there) */
export function inStandaloneApp(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return Boolean(window.matchMedia?.("(display-mode: standalone)").matches || nav.standalone === true);
}

type ShareNav = Navigator & { canShare?: (d: { files: File[] }) => boolean; share?: (d: { files: File[]; title?: string }) => Promise<void> };

/** whether the share sheet will take a file here */
export function canShareFiles(): boolean {
  const nav = navigator as ShareNav;
  try {
    return typeof nav.share === "function" && typeof nav.canShare === "function"
      && nav.canShare({ files: [new File([""], "x.pdf", { type: "application/pdf" })] });
  } catch { return false; }
}

/**
 * The share sheet is the right hand-off on a phone or tablet (Print, Save to Files, AirDrop, Mail);
 * on a desktop a download is — Windows' share panel has no printer in it. An iPad reports itself as a
 * Mac these days, so touch tells it apart.
 */
export function preferShareSheet(): boolean {
  const nav = navigator as Navigator & { maxTouchPoints?: number };
  const handheld = /iPad|iPhone|iPod|Android/i.test(nav.userAgent) || (nav.maxTouchPoints ?? 0) > 1;
  return handheld && canShareFiles();
}

/**
 * Hand the PDF over: the share sheet when there is one (it must be called straight from a tap, so the
 * PDF is built first and this runs on the next tap), else a download.
 */
export async function handOffPdf(blob: Blob, filename: string): Promise<"shared" | "downloaded"> {
  const file = new File([blob], filename, { type: "application/pdf" });
  const nav = navigator as ShareNav;
  if (preferShareSheet() && nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "shared"; // the sheet was closed — nothing to do
      // anything else: fall through to the download
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return "downloaded";
}
