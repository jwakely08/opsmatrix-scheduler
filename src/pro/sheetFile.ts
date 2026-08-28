// Turn a picked spreadsheet file (.xlsx/.xls/.csv) into raw sheets for the
// room-list importer. Excel parsing uses SheetJS served from OUR origin
// (public/vendor/, same reason as pdf.js: this page's localStorage holds the
// user's API key, so no third-party script may run here). It is loaded
// lazily — only when someone actually picks an Excel file.
import type { RawSheet } from "./roomListImport";

export interface SheetJs {
  read(data: ArrayBuffer, opts: { type: "array" }): {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
  utils: {
    sheet_to_json(sheet: unknown, opts: { header: 1; defval: string; raw: boolean }): unknown[][];
    aoa_to_sheet(rows: unknown[][]): Record<string, unknown>;
    book_new(): unknown;
    book_append_sheet(wb: unknown, ws: unknown, name: string): void;
  };
  writeFile(wb: unknown, filename: string): void;
}

declare global {
  interface Window { XLSX?: SheetJs }
}

let loading: Promise<SheetJs> | null = null;

export function loadSheetJs(): Promise<SheetJs> {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "./vendor/xlsx.full.min.js";
      s.onload = () => window.XLSX
        ? resolve(window.XLSX)
        : reject(new Error("The spreadsheet reader did not load."));
      s.onerror = () => {
        loading = null;
        reject(new Error("The spreadsheet reader could not be loaded. Check the connection and try again."));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

export function isSpreadsheet(file: File): boolean {
  return /\.(xlsx|xlsm|xls|csv|tsv)$/i.test(file.name);
}

export async function fileToSheets(file: File): Promise<RawSheet[]> {
  if (/\.(csv|tsv)$/i.test(file.name)) {
    const text = await file.text();
    const sep = /\.tsv$/i.test(file.name) ? "\t" : ",";
    return [{ name: file.name, rows: parseDelimited(text, sep) }];
  }
  const XLSX = await loadSheetJs();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: true }) as RawSheet["rows"]
  }));
}

/** small, quote-aware CSV/TSV parser (same behavior as Classic's own) */
export function parseDelimited(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQ && text[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === sep && !inQ) {
      row.push(cur); cur = "";
    } else if ((c === "\n" || c === "\r") && !inQ) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else {
      cur += c;
    }
  }
  row.push(cur);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}
