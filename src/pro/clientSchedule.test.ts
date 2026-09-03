// The Client Schedule Export's guarantees: values land in the client's
// template cells, styles are never touched, times print in the client's own
// serial convention, and overflow rolls to page 2. Pure over XML strings.
import { describe, it, expect } from "vitest";
import {
  excelSerial, addMinutes, fmt12, hoursLabel, windowLabel, daysLabel,
  patchSheetXml, planClientPages, ASSIGNMENT_SLOTS
} from "./clientSchedule";
import { crc32, zipStore, utf8 } from "./xlsxZip";

describe("the client's time-serial convention", () => {
  it("matches the template's own stored values", () => {
    // read straight out of Josh's file: A9=7:00 → 1.2916̄, A18=9:00 → 1.375,
    // A25=11:15 → 1.46875, A33=3:20pm stored on the 12h clock → 1.13888̄
    expect(excelSerial("7:00")).toBeCloseTo(1.291666666666667, 12);
    expect(excelSerial("9:00")).toBeCloseTo(1.375, 12);
    expect(excelSerial("11:15")).toBeCloseTo(1.46875, 12);
    expect(excelSerial("15:20")).toBeCloseTo(1.138888888888889, 12);
  });

  it("noon-hour times keep their 12", () => {
    expect(excelSerial("12:30")).toBeCloseTo(1.520833333333333, 12);
  });
});

describe("header labels", () => {
  it("hours read like the client writes them", () => {
    expect(hoursLabel("7:00", "15:30")).toBe("7:00 - 3:30 pm");
    expect(hoursLabel("6:00", "11:30")).toBe("6:00 - 11:30 am");
  });

  it("break and lunch windows", () => {
    expect(windowLabel("9:00", 15)).toBe("9:00-9:15");
    expect(windowLabel("11:15", 45)).toBe("11:15-12:00");
  });

  it("addMinutes wraps cleanly", () => {
    expect(addMinutes("15:30", -10)).toBe("15:20");
    expect(addMinutes("7:00", 10)).toBe("7:10");
  });

  it("days condense the way a manager would write them", () => {
    expect(daysLabel([0, 1, 2, 3, 4, 5, 6])).toBe("Sunday - Saturday");
    expect(daysLabel([1, 2, 3, 4, 5])).toBe("Monday - Friday");
    expect(daysLabel([1, 3, 5])).toBe("Mon, Wed, Fri");
    expect(daysLabel([])).toBeNull();
    expect(daysLabel(undefined)).toBeNull();
  });
});

describe("patchSheetXml — values change, styles never do", () => {
  const XML = `<row r="5"><c r="A5" t="s" s="6"><v>9</v></c><c r="B5" t="s" s="10"><v>10</v></c><c r="C5" s="8"/></row>`;

  it("swaps a shared-string cell for an inline string, keeping s=", () => {
    const out = patchSheetXml(XML, [{ ref: "B5", text: "9:00-9:15" }]);
    expect(out).toContain(`<c r="B5" s="10" t="inlineStr"><is><t xml:space="preserve">9:00-9:15</t></is></c>`);
    expect(out).toContain(`<c r="A5" t="s" s="6"><v>9</v></c>`); // neighbours untouched
  });

  it("writes serials as plain numbers and clears with a bare cell", () => {
    const out = patchSheetXml(XML, [
      { ref: "A5", serial: 1.375 },
      { ref: "C5", clear: true }
    ]);
    expect(out).toContain(`<c r="A5" s="6"><v>1.375</v></c>`);
    expect(out).toContain(`<c r="C5" s="8"/>`);
  });

  it("escapes XML in room names", () => {
    const out = patchSheetXml(XML, [{ ref: "B5", text: "T3 & <ground>" }]);
    expect(out).toContain("T3 &amp; &lt;ground&gt;");
  });

  it("refuses to miss silently", () => {
    expect(() => patchSheetXml(XML, [{ ref: "Z99", text: "x" }])).toThrow(/Z99/);
  });
});

describe("planClientPages", () => {
  const input = {
    scheduleName: "East Wing — Daily",
    orgName: "Demo Medical Center",
    days: [1, 2, 3, 4, 5],
    hoursStart: "7:00",
    hoursEnd: "15:30",
    windows: [
      { kind: "break" as const, start: "9:00", minutes: 15 },
      { kind: "lunch" as const, start: "11:15", minutes: 45 }
    ],
    assignments: Array.from({ length: 25 }, (_, i) => `Room ${i + 1}`)
  };

  it("25 rooms → two identical-format pages, 20 + 5", () => {
    const plan = planClientPages(input);
    expect(plan.pagePatches.length).toBe(2);
    const b = (pg: number) => plan.pagePatches[pg].filter((p) => /^B(1[1-9]|2[0-9]|3[0-2])$/.test(p.ref));
    expect(b(0).filter((p) => p.text).length).toBe(20);
    expect(b(1).filter((p) => p.text).length).toBe(5);
    expect(b(1).filter((p) => p.clear).length).toBe(15); // sample text never leaks through
    expect(plan.sheetNames[0]).not.toBe(plan.sheetNames[1]);
  });

  it("every page carries the full header", () => {
    const plan = planClientPages(input);
    for (const page of plan.pagePatches) {
      const refs = page.map((p) => p.ref);
      for (const ref of ["B2", "E2", "B3", "B4", "B5", "B6", "A9", "A18", "A25", "A35"]) {
        expect(refs, ref).toContain(ref);
      }
    }
  });

  it("no break schedule picked → the template's own times stand", () => {
    const plan = planClientPages({ ...input, windows: [] });
    const refs = plan.pagePatches[0].map((p) => p.ref);
    expect(refs).not.toContain("B5");
    expect(refs).not.toContain("A18");
  });

  it("ritual rows re-time around the shift", () => {
    const plan = planClientPages(input);
    const at = (ref: string) => plan.pagePatches[0].find((p) => p.ref === ref)!.serial!;
    expect(at("A10")).toBeCloseTo(excelSerial("7:10"), 12);
    expect(at("A33")).toBeCloseTo(excelSerial("15:20"), 12);
    expect(at("A35")).toBeCloseTo(excelSerial("15:30"), 12);
  });

  it("the 20 slots are the template's blank rows", () => {
    expect(ASSIGNMENT_SLOTS.length).toBe(20);
    expect(ASSIGNMENT_SLOTS).not.toContain(18); // Break row
    expect(ASSIGNMENT_SLOTS).not.toContain(25); // Lunch row
  });
});

describe("xlsxZip — stored zip mechanics", () => {
  it("crc32 matches the standard test vector", () => {
    expect(crc32(utf8("123456789"))).toBe(0xcbf43926);
  });

  it("writes a well-formed single-entry archive", () => {
    const data = utf8("hello xlsx");
    const zip = zipStore([{ name: "xl/workbook.xml", data }]);
    // local header, central directory and EOCD signatures all present
    expect([zip[0], zip[1], zip[2], zip[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const tail = zip.slice(-22);
    expect([tail[0], tail[1], tail[2], tail[3]]).toEqual([0x50, 0x4b, 0x05, 0x06]);
    expect(tail[10]).toBe(1); // one entry
  });
});
