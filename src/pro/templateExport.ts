// The GENERIC template export: any uploaded client workbook + the map Max
// read out of it → a filled copy, values patched into the client's own
// bytes (clientSchedule.ts's patcher), re-packed as a stored zip. The
// bundled Akron template is just the special case with a hand-written map.
//
// Overflow: a single-sheet workbook grows an identical page 2 (3, 4…);
// a multi-sheet workbook can't be cloned safely, so extra rooms report back
// to the caller instead of silently vanishing.
import { readZip, zipStore, utf8, type ZipEntry } from "./xlsxZip";
import {
  patchSheetXml, excelSerial, addMinutes, fmt12, hoursLabel, windowLabel, daysLabel,
  type CellPatch, type ClientExportInput
} from "./clientSchedule";
import type { TemplateMap } from "./templateStore";

const dec = new TextDecoder();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const timePatch = (map: TemplateMap, ref: string, t: string): CellPatch =>
  map.timesAsText ? { ref, text: fmt12(t) } : { ref, serial: excelSerial(t) };

/** the header + per-page assignment patches for one template map */
export function planTemplatePages(map: TemplateMap, input: ClientExportInput): {
  pagePatches: CellPatch[][];
  /** rooms that had no slot (multi-sheet workbook that can't grow pages) */
  overflow: number;
  singleSheetPages: number;
} {
  const head: CellPatch[] = [];
  const put = (ref: string | undefined, patch: (r: string) => CellPatch) => {
    if (ref) head.push(patch(ref));
  };
  put(map.positionCell, (r) => ({ ref: r, text: input.scheduleName }));
  put(map.orgCell, (r) => ({ ref: r, text: input.orgName }));
  const days = daysLabel(input.days);
  if (days) put(map.daysCell, (r) => ({ ref: r, text: days }));
  const { hoursStart: start, hoursEnd: end } = input;
  if (start && end) {
    put(map.hoursCell, (r) => ({ ref: r, text: hoursLabel(start, end) }));
    for (const a of map.timeAnchors ?? []) {
      const t = addMinutes(a.from === "start" ? start : end, a.offsetMin);
      head.push(timePatch(map, a.cell, t));
    }
  }
  const breaks = input.windows.filter((w) => w.kind === "break");
  const lunch = input.windows.find((w) => w.kind === "lunch");
  if (breaks.length) {
    put(map.breakCell, (r) => ({ ref: r, text: breaks.map((b) => windowLabel(b.start, b.minutes)).join(", ") }));
    put(map.breakTimeCell, (r) => timePatch(map, r, breaks[0].start));
  }
  if (lunch) {
    put(map.lunchCell, (r) => ({ ref: r, text: windowLabel(lunch.start, lunch.minutes) }));
    put(map.lunchTimeCell, (r) => timePatch(map, r, lunch.start));
  }

  const per = Math.max(1, map.assignmentCells.length);
  const pageCount = Math.max(1, Math.ceil(input.assignments.length / per));
  const pagePatches: CellPatch[][] = [];
  for (let pg = 0; pg < pageCount; pg++) {
    const rows = input.assignments.slice(pg * per, (pg + 1) * per);
    const patches = [...head];
    map.assignmentCells.forEach((ref, i) => {
      patches.push(rows[i] !== undefined ? { ref, text: rows[i] } : { ref, clear: true });
    });
    pagePatches.push(patches);
  }
  return { pagePatches, overflow: 0, singleSheetPages: pageCount };
}

export interface TemplateExportResult {
  bytes: Uint8Array;
  /** rooms that didn't fit (only when the workbook couldn't grow a page 2) */
  leftOver: string[];
}

const sheetSafe = (s: string) =>
  (s.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim() || "Schedule").slice(0, 26);

export async function exportWithTemplate(
  templateBytes: Uint8Array, map: TemplateMap, input: ClientExportInput
): Promise<TemplateExportResult> {
  const entries = await readZip(templateBytes);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const sheetEntry = byName.get(map.sheetPath);
  if (!sheetEntry) throw new Error(`the template has no ${map.sheetPath} — re-upload it`);
  const workbookEntry = byName.get("xl/workbook.xml");
  if (!workbookEntry) throw new Error("the template has no workbook.xml — re-upload it");
  const workbookXml = dec.decode(workbookEntry.data);
  const sheetTags = [...workbookXml.matchAll(/<sheet [^>]*\/>/g)];
  const singleSheet = sheetTags.length === 1;

  const { pagePatches } = planTemplatePages(map, input);
  const sheetXml = dec.decode(sheetEntry.data);
  const pages = singleSheet ? pagePatches : [pagePatches[0]];
  const leftOver = singleSheet ? [] : input.assignments.slice(map.assignmentCells.length);

  const out: ZipEntry[] = [];
  const sheetRelsPath = map.sheetPath.replace(/worksheets\/(.*)$/, "worksheets/_rels/$1.rels");
  for (const e of entries) {
    if (e.name === map.sheetPath) continue;               // rebuilt below
    if (e.name === "xl/workbook.xml" && pages.length > 1) continue;
    if (e.name === "xl/_rels/workbook.xml.rels" && pages.length > 1) continue;
    if (e.name === "[Content_Types].xml" && pages.length > 1) continue;
    out.push(e);
  }
  // page 1 always replaces the mapped sheet in place
  out.push({ name: map.sheetPath, data: utf8(patchSheetXml(sheetXml, pages[0])) });

  if (pages.length > 1) {
    // clone the one sheet: new parts + a <sheet> + rel + content-type each
    const relsEntry = byName.get("xl/_rels/workbook.xml.rels");
    let rels = relsEntry ? dec.decode(relsEntry.data) : "";
    let ctypes = dec.decode(byName.get("[Content_Types].xml")!.data);
    const maxRid = Math.max(0, ...[...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1])));
    const baseName = sheetSafe(input.scheduleName);
    let sheetsXml = "";
    const firstTag = sheetTags[0][0];
    const firstRid = /r:id="(rId\d+)"/.exec(firstTag)?.[1] ?? "rId1";
    for (let pg = 0; pg < pages.length; pg++) {
      const name = `${baseName} · ${pg + 1}`;
      if (pg === 0) {
        sheetsXml += firstTag
          .replace(/name="[^"]*"/, `name="${esc(name)}"`);
      } else {
        const partPath = map.sheetPath.replace(/\.xml$/, `-p${pg + 1}.xml`);
        const rid = `rId${maxRid + pg}`;
        sheetsXml += firstTag
          .replace(/name="[^"]*"/, `name="${esc(name)}"`)
          .replace(/sheetId="\d+"/, `sheetId="${900 + pg}"`)
          .replace(/r:id="rId\d+"/, `r:id="${rid}"`);
        rels = rels.replace("</Relationships>",
          `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${partPath.replace(/^xl\//, "")}"/></Relationships>`);
        ctypes = ctypes.replace("</Types>",
          `<Override PartName="/${partPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
        out.push({ name: partPath, data: utf8(patchSheetXml(sheetXml, pages[pg])) });
        const srcRels = byName.get(sheetRelsPath);
        if (srcRels) {
          out.push({
            name: partPath.replace(/worksheets\/(.*)$/, "worksheets/_rels/$1.rels"),
            data: srcRels.data
          });
        }
      }
    }
    out.push({ name: "xl/workbook.xml", data: utf8(workbookXml.replace(firstTag, sheetsXml)) });
    if (relsEntry) out.push({ name: "xl/_rels/workbook.xml.rels", data: utf8(rels) });
    out.push({ name: "[Content_Types].xml", data: utf8(ctypes) });
  }

  return { bytes: zipStore(out), leftOver };
}

/** browser: build and hand the file over */
export async function downloadTemplateExport(
  templateBytes: Uint8Array, map: TemplateMap, input: ClientExportInput, label: string
): Promise<string[]> {
  const { bytes, leftOver } = await exportWithTemplate(templateBytes, map, input);
  const blob = new Blob([bytes as unknown as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${sheetSafe(input.scheduleName)} — ${sheetSafe(label)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return leftOver;
}
