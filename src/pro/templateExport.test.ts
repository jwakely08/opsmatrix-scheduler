// The generic template engine: any uploaded workbook + Max's map → a filled
// copy. Proven against the REAL bundled client template: the generic path
// with a hand-written map must land the same values the dedicated
// clientSchedule.ts path lands.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { readZip, zipStore, utf8, crc32, type ZipEntry } from "./xlsxZip";
import { exportWithTemplate } from "./templateExport";
import { firstSheetPath, sheetInventory } from "./templateRead";
import { buildSheetXlsx } from "./sheetBuild";
import type { TemplateMap } from "./templateStore";
import { PART_PATHS, excelSerial, type ClientExportInput } from "./clientSchedule";

const dec = new TextDecoder();
const BASE = new URL("../../public/templates/client-schedule/", import.meta.url).pathname;

function bundledTemplateBytes(): Uint8Array {
  const entries: ZipEntry[] = PART_PATHS.map((p) => ({
    name: p, data: new Uint8Array(readFileSync(BASE + p))
  }));
  return zipStore(entries);
}

/** the built-in Akron mapping, written by hand — what Max should find */
const JOSH_MAP: TemplateMap = {
  sheetPath: "xl/worksheets/sheet1.xml",
  positionCell: "B2", orgCell: "E2", daysCell: "B3", hoursCell: "B4",
  breakCell: "B5", lunchCell: "B6", breakTimeCell: "A18", lunchTimeCell: "A25",
  timeAnchors: [
    { cell: "A9", from: "start", offsetMin: 0 },
    { cell: "A10", from: "start", offsetMin: 10 },
    { cell: "A33", from: "end", offsetMin: -10 },
    { cell: "A34", from: "end", offsetMin: -5 },
    { cell: "A35", from: "end", offsetMin: 0 }
  ],
  assignmentCells: [11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 26, 27, 28, 29, 30, 31, 32]
    .map((r) => "B" + r)
};

const INPUT: ClientExportInput = {
  scheduleName: "S-9 · North Tower",
  orgName: "Demo Medical Center",
  days: [1, 2, 3, 4, 5],
  hoursStart: "7:00",
  hoursEnd: "15:30",
  windows: [
    { kind: "break", start: "9:00", minutes: 15 },
    { kind: "lunch", start: "11:15", minutes: 45 }
  ],
  assignments: Array.from({ length: 25 }, (_, i) => `Room ${i + 1}`)
};

describe("readZip", () => {
  it("round-trips a stored archive", async () => {
    const zip = zipStore([
      { name: "a.xml", data: utf8("<a/>") },
      { name: "dir/b.xml", data: utf8("<b>hello</b>") }
    ]);
    const back = await readZip(zip);
    expect(back.map((e) => e.name)).toEqual(["a.xml", "dir/b.xml"]);
    expect(dec.decode(back[1].data)).toBe("<b>hello</b>");
  });

  it("inflates deflated entries (a real uploaded xlsx)", async () => {
    // hand-assemble a one-entry zip with method 8, like Excel writes
    const raw = utf8("<sheet>the deflated worksheet body</sheet>");
    const comp = new Uint8Array(deflateRawSync(raw));
    const name = utf8("xl/sheet.xml");
    const u16 = (v: number) => [v & 255, (v >> 8) & 255];
    const u32 = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    const crc = crc32(raw);
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(8), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(comp.length), ...u32(raw.length), ...u16(name.length), ...u16(0)
    ]);
    const central = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(8), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(comp.length), ...u32(raw.length),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(0)
    ]);
    const cdOfs = local.length + name.length + comp.length;
    const eocd = new Uint8Array([
      ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(1), ...u16(1),
      ...u32(central.length + name.length), ...u32(cdOfs), ...u16(0)
    ]);
    const zip = new Uint8Array([...local, ...name, ...comp, ...central, ...name, ...eocd]);
    const back = await readZip(zip);
    expect(dec.decode(back[0].data)).toBe("<sheet>the deflated worksheet body</sheet>");
  });
});

describe("exportWithTemplate — generic engine on the real client template", () => {
  it("lands the same header values as the dedicated path", async () => {
    const { bytes } = await exportWithTemplate(bundledTemplateBytes(), JOSH_MAP, INPUT);
    const entries = await readZip(bytes);
    const sheet = dec.decode(entries.find((e) => e.name === "xl/worksheets/sheet1.xml")!.data);
    expect(sheet).toContain(">S-9 · North Tower</t>");
    expect(sheet).toContain(">Demo Medical Center</t>");
    expect(sheet).toContain(">Monday - Friday</t>");
    expect(sheet).toContain(">7:00 - 3:30 pm</t>");
    expect(sheet).toContain(">9:00-9:15</t>");
    expect(sheet).toContain(">11:15-12:00</t>");
    expect(sheet).toContain(`<c r="A18" s="34"><v>${excelSerial("9:00")}</v></c>`);
    expect(sheet).toContain(`<c r="A35" s="28"><v>${excelSerial("15:30")}</v></c>`);
    expect(sheet).toContain(">Room 1</t>");
    expect(sheet).toContain(">Room 20</t>");
    // sample assignments replaced: B11 no longer points into sharedStrings
    expect(sheet).not.toMatch(/<c r="B11" t="s"/);
    // boilerplate untouched: E8 still references "7 Step Cleaning Process" (string 18)
    expect(sheet).toContain(`<c r="E8" t="s" s="23"><v>18</v></c>`);
  });

  it("grows an identical page 2 on a single-sheet workbook", async () => {
    const { bytes, leftOver } = await exportWithTemplate(bundledTemplateBytes(), JOSH_MAP, INPUT);
    expect(leftOver).toEqual([]);
    const entries = await readZip(bytes);
    const names = entries.map((e) => e.name);
    expect(names).toContain("xl/worksheets/sheet1-p2.xml");
    const p2 = dec.decode(entries.find((e) => e.name === "xl/worksheets/sheet1-p2.xml")!.data);
    expect(p2).toContain(">Room 21</t>");
    expect(p2).not.toContain(">Room 1</t>");
    const wb = dec.decode(entries.find((e) => e.name === "xl/workbook.xml")!.data);
    expect([...wb.matchAll(/<sheet /g)].length).toBe(2);
    const ct = dec.decode(entries.find((e) => e.name === "[Content_Types].xml")!.data);
    expect(ct).toContain("/xl/worksheets/sheet1-p2.xml");
  });

  it("writes times as text when the map says so", async () => {
    const { bytes } = await exportWithTemplate(bundledTemplateBytes(),
      { ...JOSH_MAP, timesAsText: true }, { ...INPUT, assignments: ["Room 1"] });
    const entries = await readZip(bytes);
    const sheet = dec.decode(entries.find((e) => e.name === "xl/worksheets/sheet1.xml")!.data);
    expect(sheet).toContain(`<c r="A18" s="34" t="inlineStr"><is><t xml:space="preserve">9:00</t></is></c>`);
  });
});

describe("templateRead — the inventory Max reads", () => {
  it("finds the sheet and resolves shared strings", async () => {
    const entries = await readZip(bundledTemplateBytes());
    expect(firstSheetPath(entries)).toBe("xl/worksheets/sheet1.xml");
    const inv = sheetInventory(entries, "xl/worksheets/sheet1.xml");
    expect(inv).toContain(`B2="T3 & Ground 130"`);
    expect(inv).toContain(`E2="Akron City Hospital"`);
    expect(inv).toContain(`B18="Break"`);
    expect(inv).toMatch(/A18=.*9:00/);   // the serial decodes to a time hint
    expect(inv).toContain(`C9=[empty]`); // blank styled cells are visible slots
  });
});

describe("sheetBuild — a PDF recreation becomes a real workbook", () => {
  it("builds a loadable single-sheet xlsx with styles", async () => {
    const bytes = buildSheetXlsx({
      colWidths: [12, 40],
      merges: ["A1:B1"],
      cells: [
        { ref: "A1", text: "Daily Schedule", bold: true, size: 14, align: "center", fill: "DDEBF7" },
        { ref: "A2", text: "Time:", bold: true, border: true },
        { ref: "B2", text: "Assignment", bold: true, border: true, align: "center" },
        { ref: "B3", text: "", border: true }
      ]
    });
    const entries = await readZip(bytes);
    const names = entries.map((e) => e.name);
    expect(names).toContain("xl/worksheets/sheet1.xml");
    expect(names).toContain("xl/styles.xml");
    const sheet = dec.decode(entries.find((e) => e.name === "xl/worksheets/sheet1.xml")!.data);
    expect(sheet).toContain(">Daily Schedule</t>");
    expect(sheet).toContain(`<mergeCell ref="A1:B1"/>`);
    const styles = dec.decode(entries.find((e) => e.name === "xl/styles.xml")!.data);
    expect(styles).toContain("<b/>");
    expect(styles).toContain(`rgb="FFDDEBF7"`);
    expect(styles).toContain(`style="thin"`);
  });
});
