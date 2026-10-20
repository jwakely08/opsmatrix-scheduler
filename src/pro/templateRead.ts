// MAX READS A TEMPLATE (Josh, 2026-09-03): "the AI needs to read and
// understand what information needs to go in and what needs to stay out."
// A manager uploads a client's schedule sheet in Admin Settings → Exporting;
// this module turns it into a ClientTemplate:
//
//   • .xlsx — the workbook's cells become a compact text inventory, Max maps
//     which cells hold Position/Days/Hours/Break/Lunch/facility and which
//     blank rows are the assignment slots. The FILE ITSELF is stored
//     untouched, so exports stay byte-faithful to the client's sheet.
//   • .pdf — there is no workbook to preserve, so Max reads the page and
//     RECREATES it as an Excel sheet (sheetBuild.ts) along with the same
//     map. An approximation by nature — the UI says to open it once and
//     check before trusting it.
//
// Everything Max does NOT map — cleaning-steps panels, reminder boxes,
// discharge logs — is client boilerplate and passes through untouched.
import { anthropicRequest, AI_MODEL, type AiProxy } from "../bridge/aiPlanImport";
import { readZip, type ZipEntry } from "./xlsxZip";
import type { TemplateMap } from "./templateStore";
import { buildSheetXlsx, type SheetSpec, sheetSpecSchema } from "./sheetBuild";

const dec = new TextDecoder();

// ── the workbook → text inventory Max reads ────────────────────────────────

const unesc = (s: string) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function sharedStrings(entries: ZipEntry[]): string[] {
  const e = entries.find((x) => x.name === "xl/sharedStrings.xml");
  if (!e) return [];
  const xml = dec.decode(e.data);
  const out: string[] = [];
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    out.push([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unesc(t[1])).join(""));
  }
  return out;
}

/** the first worksheet the workbook lists — schedule templates are one page */
export function firstSheetPath(entries: ZipEntry[]): string {
  const wb = entries.find((x) => x.name === "xl/workbook.xml");
  const rels = entries.find((x) => x.name === "xl/_rels/workbook.xml.rels");
  if (wb && rels) {
    const rid = /<sheet [^>]*r:id="(rId\d+)"/.exec(dec.decode(wb.data))?.[1];
    if (rid) {
      const rel = new RegExp(`<Relationship Id="${rid}"[^>]*Target="([^"]+)"`).exec(dec.decode(rels.data));
      if (rel) return "xl/" + rel[1].replace(/^\/?(xl\/)?/, "");
    }
  }
  const any = entries.find((x) => /^xl\/worksheets\/[^/]+\.xml$/.test(x.name));
  if (!any) throw new Error("that Excel file has no worksheet inside");
  return any.name;
}

/** every cell as "REF: value" lines, row by row — what Max actually reads */
export function sheetInventory(entries: ZipEntry[], sheetPath: string): string {
  const sheet = entries.find((x) => x.name === sheetPath);
  if (!sheet) throw new Error("worksheet missing from the file");
  const xml = dec.decode(sheet.data);
  const strings = sharedStrings(entries);
  const lines: string[] = [];
  for (const row of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of row[2].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, ref, attrs, body] = c;
      if (body === undefined) { cells.push(`${ref}=[empty]`); continue; }
      const t = /t="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const is = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1];
      let text: string;
      if (t === "s" && v !== undefined) text = strings[Number(v)] ?? "";
      else if (t === "inlineStr" || t === "str") text = unesc(is ?? v ?? "");
      else if (v !== undefined) {
        const n = Number(v);
        // Excel time serials read as fractions of a day — decode the hint
        if (isFinite(n) && n > 0 && n < 3 && n % 1 !== 0) {
          const mins = Math.round((n % 1) * 1440);
          text = `${v} (a time ≈ ${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")})`;
        } else text = v;
      } else text = "[empty]";
      cells.push(`${ref}=${text === "[empty]" ? text : JSON.stringify(text)}`);
    }
    if (cells.length) lines.push(cells.join("  "));
  }
  const merges = /<mergeCells[^>]*>([\s\S]*?)<\/mergeCells>/.exec(xml)?.[1] ?? "";
  const mergeList = [...merges.matchAll(/ref="([^"]+)"/g)].map((m) => m[1]);
  if (mergeList.length) lines.push("MERGED: " + mergeList.join(" "));
  return lines.join("\n").slice(0, 24000);
}

// ── the map schema + prompt ────────────────────────────────────────────────

const CELL = { type: "string", pattern: "^[A-Z]+[0-9]+$" };

function mapSchema(): Record<string, unknown> {
  return {
    type: "object", additionalProperties: false, required: ["assignmentCells"],
    properties: {
      positionCell: CELL, orgCell: CELL, daysCell: CELL, hoursCell: CELL,
      breakCell: CELL, lunchCell: CELL, breakTimeCell: CELL, lunchTimeCell: CELL,
      timesAsText: { type: "boolean" },
      timeAnchors: {
        type: "array", maxItems: 8,
        items: {
          type: "object", additionalProperties: false, required: ["cell", "from", "offsetMin"],
          properties: { cell: CELL, from: { enum: ["start", "end"] }, offsetMin: { type: "number" } }
        }
      },
      assignmentCells: { type: "array", minItems: 1, maxItems: 60, items: CELL }
    }
  };
}

const MAP_BRIEF = `You are mapping a hospital EVS (Environmental Services) daily schedule template so software can fill it in.
The software knows these facts about a schedule: the schedule/position name, the facility (hospital) name, the days of week it runs, the shift hours (start and end), one or more 15-minute break windows, a lunch window, and the ROOMS/ASSIGNMENTS to clean, in order.
Map ONLY where those facts go:
- positionCell: the cell whose value is the position/assignment-area name (next to a "Position:"-style label — never the label itself).
- orgCell: the hospital/facility name cell.
- daysCell: the value cell for the days the schedule runs.
- hoursCell: the value cell for the shift hours.
- breakCell / lunchCell: the header value cells stating the break / lunch window.
- breakTimeCell / lunchTimeCell: on the schedule's own timeline, the TIME cell of the row that says Break / Lunch.
- timeAnchors: timeline TIME cells tied to the shift itself (sign-in at start, end-of-shift wrap-up rows, clock-out at end). Give each as from:"start" or "end" plus offsetMin (e.g. clock-out = end+0, a wrap row 10 minutes before end = end,-10, a row 10 minutes after start = start,+10).
- assignmentCells: the assignment-text cells the software fills with rooms, top to bottom — the blank (or example-filled) rows in the assignment column BETWEEN the fixed rows. Never include the Break/Lunch rows themselves, sign-in/clock-out rows, or anything outside the assignment column.
- timesAsText: true if the timeline stores times as plain text rather than numeric time values.
Everything else — cleaning-process steps, reminder boxes, discharge logs, headings — is fixed client boilerplate: leave it unmapped.`;

async function callClaude(
  opts: { apiKey: string; proxy?: AiProxy | null },
  feature: string,
  content: unknown,
  schema: Record<string, unknown>,
  maxTokens: number
): Promise<unknown> {
  const t = anthropicRequest(opts.apiKey, opts.proxy, feature);
  const res = await fetch(t.url, {
    method: "POST",
    headers: t.headers,
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: maxTokens,
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
      messages: [{ role: "user", content }]
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let msg = "";
    try { msg = String(JSON.parse(body)?.error?.message ?? ""); } catch { /* not json */ }
    throw new Error(msg || `Max could not read the template (error ${res.status}).`);
  }
  const j = await res.json();
  const text = (Array.isArray(j.content) ? j.content : [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text).join("");
  return JSON.parse(text);
}

const clean = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as T;

/** .xlsx upload: Max maps the cells; the workbook itself is never altered */
export async function mapXlsxTemplate(
  bytes: Uint8Array, opts: { apiKey: string; proxy?: AiProxy | null }
): Promise<TemplateMap> {
  const entries = await readZip(bytes);
  const sheetPath = firstSheetPath(entries);
  const inventory = sheetInventory(entries, sheetPath);
  const raw = await callClaude(opts, "template-map",
    `${MAP_BRIEF}\n\nHere is the worksheet, one line per row ("REF=value", [empty] marks a blank styled cell):\n\n${inventory}`,
    mapSchema(), 4000) as Omit<TemplateMap, "sheetPath">;
  const map: TemplateMap = { ...clean(raw), sheetPath };
  if (!map.assignmentCells?.length) throw new Error("Max couldn't find the assignment rows in that template.");
  return map;
}

/** .pdf upload: Max reads the page and recreates it as Excel + the map */
export async function recreatePdfTemplate(
  imageDataUrl: string, opts: { apiKey: string; proxy?: AiProxy | null }
): Promise<{ bytes: Uint8Array; map: TemplateMap }> {
  const m = /^data:([^;]+);base64,(.*)$/.exec(imageDataUrl);
  if (!m) throw new Error("could not read the PDF page image");
  const schema = {
    type: "object", additionalProperties: false, required: ["sheet", "map"],
    properties: { sheet: sheetSpecSchema(), map: mapSchema() }
  };
  const raw = await callClaude(opts, "template-recreate", [
    { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } },
    {
      type: "text",
      text: `This is a client's schedule sheet. Recreate it as a spreadsheet spec — same texts, same reading order, labels bold where they look bold, one row per printed line, a side column kept as its own columns — then map it.\n\n${MAP_BRIEF}\n\nIn the map, cell references refer to YOUR recreated sheet. Set timesAsText to true.`
    }
  ], schema, 16000) as { sheet: SheetSpec; map: Omit<TemplateMap, "sheetPath"> };
  const bytes = buildSheetXlsx(raw.sheet);
  const map: TemplateMap = { ...clean(raw.map), sheetPath: "xl/worksheets/sheet1.xml", timesAsText: true };
  if (!map.assignmentCells?.length) throw new Error("Max couldn't find the assignment rows in that PDF.");
  return { bytes, map };
}
