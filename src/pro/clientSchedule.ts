// CLIENT SCHEDULE EXPORT (Josh, 2026-09-03): a client handed over the exact
// Excel sheet their EVS crews already read — "exactly replicated, no
// deviation." So we don't rebuild the look in code: the client's own file
// ships pre-extracted under public/templates/client-schedule/, and this
// module patches VALUES into its cells (keeping each cell's style index) and
// re-zips the parts. The bytes that make the look — styles, widths, borders,
// the logo drawing, the 7 Step Cleaning Process panel and every reminders
// box — pass through untouched.
//
// What gets patched, and from where:
//   B2 Position  ← the schedule's name
//   B3 Days      ← the schedule's day bubbles (Mon–Sun)
//   B4 Hours     ← the schedule's start/end times
//   B5/B6 + the Break/Lunch timeline rows ← the selected Break Schedule
//   E2           ← the organization's name
//   20 assignment slots (rows 11-17, 19-24, 26-32) ← the schedule's rooms,
//   in cleaning order; overflow continues on an identical page 2.
// The sign-in / EVS-closet / clock-out ritual rows keep their wording and
// re-time themselves around the shift (start, start+10 · end−10, end−5, end).
// Times print only on those anchor rows — matching the client's sample.
import { zipStore, utf8, type ZipEntry } from "./xlsxZip";
import type { BreakWindow } from "./rules";

// ── tiny time helpers (all inputs are 24h "HH:MM") ─────────────────────────

const hm = (t: string): [number, number] => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
};

/** the template stores times as 1900-01-01-anchored serials on a 12h clock
 *  (3:20 pm lives as the 3:20 serial; the h:mm format shows just "3:20") —
 *  we write the identical convention so every cell renders like the sample */
export function excelSerial(t: string): number {
  const [h, m] = hm(t);
  const hh = h % 12 === 0 ? 12 : h % 12;
  return 1 + hh / 24 + m / 1440;
}

export function addMinutes(t: string, delta: number): string {
  const [h, m] = hm(t);
  const total = (((h * 60 + m + delta) % 1440) + 1440) % 1440;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** "15:20" → "3:20" (the sample writes bare 12h times) */
export function fmt12(t: string): string {
  const [h, m] = hm(t);
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")}`;
}

/** "7:00 - 3:30 pm" — meridiem only on the end, like the client's sheet */
export function hoursLabel(start: string, end: string): string {
  return `${fmt12(start)} - ${fmt12(end)} ${hm(end)[0] >= 12 ? "pm" : "am"}`;
}

/** "9:00-9:15" for the Break:/Lunch: header lines */
export function windowLabel(start: string, minutes: number): string {
  return `${fmt12(start)}-${fmt12(addMinutes(start, minutes))}`;
}

const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** the Days: line — a full week or contiguous run reads as a range */
export function daysLabel(days: number[] | undefined): string | null {
  if (!days || !days.length) return null;
  const d = [...new Set(days)].filter((x) => x >= 0 && x <= 6).sort((a, b) => a - b);
  if (!d.length) return null;
  if (d.length === 7) return "Sunday - Saturday";
  const contiguous = d.every((v, i) => i === 0 || v === d[i - 1] + 1);
  if (contiguous && d.length > 2) return `${DAY_FULL[d[0]]} - ${DAY_FULL[d[d.length - 1]]}`;
  return d.map((v) => DAY_SHORT[v]).join(", ");
}

// ── the sheet-XML patcher ───────────────────────────────────────────────────

export interface CellPatch {
  ref: string;
  text?: string;
  serial?: number;
  clear?: boolean;
}

const esc = (s: string) => s
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

/**
 * Replace a cell's VALUE, keeping its style index — the whole "no deviation"
 * guarantee rests on never touching anything but the value. Throws when a
 * target cell isn't in the sheet: a silent miss would ship a page that still
 * shows the sample hospital's data.
 */
export function patchSheetXml(xml: string, patches: CellPatch[]): string {
  let out = xml;
  for (const p of patches) {
    const re = new RegExp(`<c r="${p.ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
    const m = re.exec(out);
    if (!m) throw new Error(`template cell ${p.ref} not found`);
    const sM = /\ss="\d+"/.exec(m[1]);
    const sAttr = sM ? sM[0] : "";
    let cell: string;
    if (p.clear) cell = `<c r="${p.ref}"${sAttr}/>`;
    else if (p.serial !== undefined) cell = `<c r="${p.ref}"${sAttr}><v>${p.serial}</v></c>`;
    else cell = `<c r="${p.ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(p.text ?? "")}</t></is></c>`;
    out = out.slice(0, m.index) + cell + out.slice(m.index + m[0].length);
  }
  return out;
}

// ── page planning ───────────────────────────────────────────────────────────

/** the template's blank assignment rows (between the ritual/break anchors) */
export const ASSIGNMENT_SLOTS = [
  11, 12, 13, 14, 15, 16, 17,      // morning block (after Sign-In + EVS Closet)
  19, 20, 21, 22, 23, 24,          // after Break
  26, 27, 28, 29, 30, 31, 32       // after Lunch
];

export interface ClientExportInput {
  scheduleName: string;
  orgName: string;
  days?: number[];
  /** 24h "HH:MM"; the template's own 7:00–15:30 stands when unset */
  hoursStart?: string;
  hoursEnd?: string;
  /** the selected Break Schedule's windows; empty = template times stand */
  windows: BreakWindow[];
  /** room lines in cleaning order */
  assignments: string[];
}

export interface ClientPagePlan {
  sheetNames: string[];
  pagePatches: CellPatch[][];
}

const sheetSafe = (s: string) =>
  (s.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim() || "Schedule").slice(0, 26);

export function planClientPages(input: ClientExportInput): ClientPagePlan {
  const head: CellPatch[] = [
    { ref: "B2", text: input.scheduleName },
    { ref: "E2", text: input.orgName }
  ];
  const days = daysLabel(input.days);
  if (days) head.push({ ref: "B3", text: days });
  const start = input.hoursStart, end = input.hoursEnd;
  if (start && end) {
    head.push(
      { ref: "B4", text: hoursLabel(start, end) },
      { ref: "A9", serial: excelSerial(start) },
      { ref: "A10", serial: excelSerial(addMinutes(start, 10)) },
      { ref: "A33", serial: excelSerial(addMinutes(end, -10)) },
      { ref: "A34", serial: excelSerial(addMinutes(end, -5)) },
      { ref: "A35", serial: excelSerial(end) }
    );
  }
  const breaks = input.windows.filter((w) => w.kind === "break");
  const lunch = input.windows.find((w) => w.kind === "lunch");
  if (breaks.length) {
    head.push(
      { ref: "B5", text: breaks.map((b) => windowLabel(b.start, b.minutes)).join(", ") },
      { ref: "A18", serial: excelSerial(breaks[0].start) }
    );
  }
  if (lunch) {
    head.push(
      { ref: "B6", text: windowLabel(lunch.start, lunch.minutes) },
      { ref: "A25", serial: excelSerial(lunch.start) }
    );
  }

  const per = ASSIGNMENT_SLOTS.length;
  const pageCount = Math.max(1, Math.ceil(input.assignments.length / per));
  const base = sheetSafe(input.scheduleName);
  const pagePatches: CellPatch[][] = [];
  const sheetNames: string[] = [];
  for (let pg = 0; pg < pageCount; pg++) {
    const rows = input.assignments.slice(pg * per, (pg + 1) * per);
    const patches = [...head];
    ASSIGNMENT_SLOTS.forEach((row, i) => {
      patches.push(rows[i] !== undefined
        ? { ref: `B${row}`, text: rows[i] }
        : { ref: `B${row}`, clear: true });
    });
    pagePatches.push(patches);
    sheetNames.push(pageCount === 1 ? base : `${base} · ${pg + 1}`);
  }
  return { sheetNames, pagePatches };
}

// ── workbook assembly ───────────────────────────────────────────────────────

/** template parts fetched from public/templates/client-schedule/ */
export const PART_PATHS = [
  "[Content_Types].xml",
  "_rels/.rels",
  "docProps/app.xml",
  "docProps/core.xml",
  "xl/workbook.xml",
  "xl/_rels/workbook.xml.rels",
  "xl/styles.xml",
  "xl/sharedStrings.xml",
  "xl/theme/theme1.xml",
  "xl/worksheets/sheet1.xml",
  "xl/worksheets/_rels/sheet1.xml.rels",
  "xl/drawings/drawing1.xml",
  "xl/drawings/_rels/drawing1.xml.rels",
  "xl/media/image1.png"
];

const dec = new TextDecoder();

export function buildClientWorkbook(parts: Map<string, Uint8Array>, input: ClientExportInput): Uint8Array {
  const need = (p: string): Uint8Array => {
    const v = parts.get(p);
    if (!v) throw new Error(`template part missing: ${p}`);
    return v;
  };
  const plan = planClientPages(input);
  const n = plan.pagePatches.length;
  const sheet1 = dec.decode(need("xl/worksheets/sheet1.xml"));
  const sheetRels = need("xl/worksheets/_rels/sheet1.xml.rels");

  // one <sheet> + one worksheet rel per page; rId1-3 stay shared/styles/theme
  const sheetsXml = plan.sheetNames.map((name, i) =>
    `<sheet name="${esc(name)}" sheetId="${i + 1}" r:id="rId${4 + i}"/>`).join("");
  const workbook = dec.decode(need("xl/workbook.xml"))
    .replace(/<sheets>[\s\S]*?<\/sheets>/, `<sheets>${sheetsXml}</sheets>`);
  const relRows = plan.sheetNames.map((_, i) =>
    `<Relationship Id="rId${4 + i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("");
  const wbRels = dec.decode(need("xl/_rels/workbook.xml.rels"))
    .replace(/<Relationship Id="rId4".*?\/>/, relRows);
  let ctypes = dec.decode(need("[Content_Types].xml"));
  for (let i = 1; i < n; i++) {
    ctypes = ctypes.replace("</Types>",
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  }

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: utf8(ctypes) },
    { name: "_rels/.rels", data: need("_rels/.rels") },
    { name: "docProps/app.xml", data: need("docProps/app.xml") },
    { name: "docProps/core.xml", data: need("docProps/core.xml") },
    { name: "xl/workbook.xml", data: utf8(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: utf8(wbRels) },
    { name: "xl/styles.xml", data: need("xl/styles.xml") },
    { name: "xl/sharedStrings.xml", data: need("xl/sharedStrings.xml") },
    { name: "xl/theme/theme1.xml", data: need("xl/theme/theme1.xml") },
    { name: "xl/drawings/drawing1.xml", data: need("xl/drawings/drawing1.xml") },
    { name: "xl/drawings/_rels/drawing1.xml.rels", data: need("xl/drawings/_rels/drawing1.xml.rels") },
    { name: "xl/media/image1.png", data: need("xl/media/image1.png") }
  ];
  plan.pagePatches.forEach((patches, i) => {
    entries.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: utf8(patchSheetXml(sheet1, patches)) });
    entries.push({ name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, data: sheetRels });
  });
  return zipStore(entries);
}

// ── browser side: fetch parts, build, hand the file over ───────────────────

export async function fetchTemplateParts(base = "templates/client-schedule/"): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  await Promise.all(PART_PATHS.map(async (p) => {
    const r = await fetch(base + p);
    if (!r.ok) throw new Error(`could not load template part ${p} (${r.status})`);
    out.set(p, new Uint8Array(await r.arrayBuffer()));
  }));
  return out;
}

export async function downloadClientSchedule(input: ClientExportInput): Promise<void> {
  const parts = await fetchTemplateParts();
  const bytes = buildClientWorkbook(parts, input);
  const blob = new Blob([bytes as unknown as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${sheetSafe(input.scheduleName)} — client schedule.xlsx`;
  document.body.appendChild(a); // detached anchors lose the filename in some browsers
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
