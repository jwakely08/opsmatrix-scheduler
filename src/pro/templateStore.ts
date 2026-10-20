// CLIENT TEMPLATES (Josh, 2026-09-03): "a place to actually upload a
// template." A manager uploads a client's schedule sheet (Excel or PDF) in
// Admin Settings → Exporting, names it, and that name becomes an export
// button on every schedule card in Max Schedules.
//
// Storage: `opsmatrix_v7 → settings.clientTemplates` — rides the existing
// workspace sync, no new store, no migration. Each entry keeps the
// template's xlsx BYTES (base64; for a PDF upload it's Max's Excel
// recreation) plus the MAP Max read out of it: which cells hold which
// header facts, and which rows are the assignment slots.
import type { ClassicData } from "./classicStore";

/** where each OpsMatrix fact lands in the template — any field may be
 *  missing when the template simply has no place for it */
export interface TemplateMap {
  /** zip path of the worksheet to fill, e.g. "xl/worksheets/sheet1.xml" */
  sheetPath: string;
  positionCell?: string;
  orgCell?: string;
  daysCell?: string;
  hoursCell?: string;
  /** the "Break:" / "Lunch:" header lines */
  breakCell?: string;
  lunchCell?: string;
  /** time cells on the timeline's Break / Lunch rows */
  breakTimeCell?: string;
  lunchTimeCell?: string;
  /** ritual rows that re-time around the shift (sign-in, clock-out…) */
  timeAnchors?: { cell: string; from: "start" | "end"; offsetMin: number }[];
  /** the blank assignment rows, in fill order */
  assignmentCells: string[];
  /** write times as plain text ("9:00") instead of Excel serials */
  timesAsText?: boolean;
}

export interface ClientTemplate {
  id: string;
  label: string;
  source: "xlsx" | "pdf";
  /** the template workbook, base64 — for PDFs, Max's Excel recreation */
  dataB64: string;
  map: TemplateMap;
  createdAt: string;
}

/** uploads above this bloat every sync push — a schedule sheet is tiny */
export const TEMPLATE_MAX_BYTES = 512 * 1024;

export function loadTemplates(data: ClassicData): ClientTemplate[] {
  const raw = ((data.v7.settings ?? {}) as Record<string, unknown>).clientTemplates;
  return Array.isArray(raw) ? (raw as ClientTemplate[]) : [];
}

/** mutate inside a commit(): replace the whole list */
export function writeTemplates(d: ClassicData, list: ClientTemplate[]) {
  d.v7.settings = { ...((d.v7.settings ?? {}) as Record<string, unknown>), clientTemplates: list };
}

export function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
