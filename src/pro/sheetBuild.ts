// Build a small styled .xlsx from a flat spec — how a PDF template becomes
// an Excel one. There is no workbook inside a PDF to preserve, so Max reads
// the page and emits this spec (texts, bold, sizes, borders, fills, widths,
// merges); we turn it into a real workbook that then behaves exactly like an
// uploaded .xlsx template. Deliberately simple: Calibri, thin borders, solid
// fills — a faithful *reading* of the sheet, not a scan of it.
import { zipStore, utf8 } from "./xlsxZip";

export interface SpecCell {
  ref: string;
  text: string;
  bold?: boolean;
  size?: number;
  align?: "left" | "center" | "right";
  border?: boolean;
  /** solid background, 6-digit hex without # */
  fill?: string;
  wrap?: boolean;
}

export interface SheetSpec {
  colWidths?: number[];
  rowHeights?: { r: number; h: number }[];
  merges?: string[];
  cells: SpecCell[];
}

const CELL = { type: "string", pattern: "^[A-Z]+[0-9]+$" };

/** the JSON schema Max's recreation answer must satisfy */
export function sheetSpecSchema(): Record<string, unknown> {
  return {
    type: "object", additionalProperties: false, required: ["cells"],
    properties: {
      colWidths: { type: "array", maxItems: 20, items: { type: "number" } },
      rowHeights: {
        type: "array", maxItems: 80,
        items: {
          type: "object", additionalProperties: false, required: ["r", "h"],
          properties: { r: { type: "integer" }, h: { type: "number" } }
        }
      },
      merges: { type: "array", maxItems: 60, items: { type: "string", pattern: "^[A-Z]+[0-9]+:[A-Z]+[0-9]+$" } },
      cells: {
        type: "array", minItems: 1, maxItems: 500,
        items: {
          type: "object", additionalProperties: false, required: ["ref", "text"],
          properties: {
            ref: CELL, text: { type: "string" },
            bold: { type: "boolean" }, size: { type: "number" },
            align: { enum: ["left", "center", "right"] },
            border: { type: "boolean" }, wrap: { type: "boolean" },
            fill: { type: "string", pattern: "^[0-9A-Fa-f]{6}$" }
          }
        }
      }
    }
  };
}

const esc = (s: string) => s
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const refParts = (ref: string): { row: number; colIdx: number } => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
  let idx = 0;
  for (const ch of m[1]) idx = idx * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]), colIdx: idx };
};

export function buildSheetXlsx(spec: SheetSpec): Uint8Array {
  // dedupe style combos → cellXfs indexes
  const fonts: string[] = [`<font><sz val="11"/><name val="Calibri"/></font>`];
  const fills: string[] = [
    `<fill><patternFill patternType="none"/></fill>`,
    `<fill><patternFill patternType="gray125"/></fill>`
  ];
  const borders: string[] = [`<border><left/><right/><top/><bottom/><diagonal/></border>`];
  const thin = `<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>`;
  const xfs: string[] = [`<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`];
  const xfKey = new Map<string, number>();

  const dedupe = (list: string[], xml: string): number => {
    const at = list.indexOf(xml);
    if (at >= 0) return at;
    list.push(xml);
    return list.length - 1;
  };

  const styleOf = (c: SpecCell): number => {
    const fontXml = `<font>${c.bold ? "<b/>" : ""}<sz val="${c.size ?? 11}"/><name val="Calibri"/></font>`;
    const fontId = dedupe(fonts, fontXml);
    const fillId = c.fill
      ? dedupe(fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${c.fill.toUpperCase()}"/><bgColor auto="1"/></patternFill></fill>`)
      : 0;
    const borderId = c.border ? dedupe(borders, thin) : 0;
    const alignXml = (c.align || c.wrap)
      ? `<alignment${c.align ? ` horizontal="${c.align}"` : ""}${c.wrap ? ` wrapText="1"` : ""}/>`
      : "";
    const key = `${fontId}|${fillId}|${borderId}|${alignXml}`;
    const hit = xfKey.get(key);
    if (hit !== undefined) return hit;
    xfs.push(`<xf numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0" applyFont="1"${fillId ? ` applyFill="1"` : ""}${borderId ? ` applyBorder="1"` : ""}${alignXml ? ` applyAlignment="1"` : ""}>${alignXml}</xf>`);
    xfKey.set(key, xfs.length - 1);
    return xfs.length - 1;
  };

  // rows, sorted, cells sorted within
  const byRow = new Map<number, { c: SpecCell; colIdx: number; s: number }[]>();
  for (const c of spec.cells) {
    const { row, colIdx } = refParts(c.ref);
    const list = byRow.get(row) ?? [];
    list.push({ c, colIdx, s: styleOf(c) });
    byRow.set(row, list);
  }
  const heights = new Map((spec.rowHeights ?? []).map((r) => [r.r, r.h]));
  const rowsXml = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([r, cells]) => {
    const h = heights.get(r);
    const cellsXml = cells.sort((a, b) => a.colIdx - b.colIdx).map(({ c, s }) =>
      `<c r="${c.ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(c.text)}</t></is></c>`).join("");
    return `<row r="${r}"${h ? ` ht="${h}" customHeight="1"` : ""}>${cellsXml}</row>`;
  }).join("");

  const colsXml = (spec.colWidths ?? []).length
    ? `<cols>${(spec.colWidths ?? []).map((w, i) =>
      `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const mergeXml = (spec.merges ?? []).length
    ? `<mergeCells count="${spec.merges!.length}">${spec.merges!.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
    : "";
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${colsXml}<sheetData>${rowsXml}</sheetData>${mergeXml}</worksheet>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="${fonts.length}">${fonts.join("")}</fonts><fills count="${fills.length}">${fills.join("")}</fills><borders count="${borders.length}">${borders.join("")}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Schedule" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const ctypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

  return zipStore([
    { name: "[Content_Types].xml", data: utf8(ctypes) },
    { name: "_rels/.rels", data: utf8(rootRels) },
    { name: "xl/workbook.xml", data: utf8(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: utf8(wbRels) },
    { name: "xl/styles.xml", data: utf8(styles) },
    { name: "xl/worksheets/sheet1.xml", data: utf8(sheet) }
  ]);
}
