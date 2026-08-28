// Admin Settings → Exporting: the promise is a PERFECT round trip — the
// re-import file goes back through ⬆ Import and lands on the same rooms with
// nothing invented, nothing duplicated, and nothing lost. Proven here by
// running the real importer over the real export rows.
import { describe, it, expect } from "vitest";
import {
  scopeSpaces, scopeLabel, exportFilename, reimportRows, dataExportRows, DATA_EXPORT_HEADERS
} from "./exportData";
import {
  importRoomList, detectHeader, normalizeFloorType,
  parsePriorityCell, parseCleanableCell,
  type RawSheet, type AliasStore, type SpaceRecord
} from "./roomListImport";
import { defaultRules } from "./rules";
import type { ClassicData } from "./classicStore";

const rules = defaultRules();
const noAliases: AliasStore = { roomTypes: {}, floorTypes: {} };

/** three deliberately different rooms: CAD-imported (cost-center dept),
 *  hand-made (name dept), and one still full of blanks */
function fixture(): ClassicData {
  return {
    v7: {
      spaces: [
        {
          id: "sp-cad", system: "AKRON", building: "HOSPITAL-E", floor: "01",
          roomNumber: "E1-1000", roomName: "CORR.", roomType: "Corridor",
          department: "Oncology (7 East)", departmentKey: "cc:731015",
          floorType: "Hard floor — finished", squareFeet: 1433, fixtureCount: 2,
          priority: "High", cleanability: "Non-cleanable", notes: "Buff after 9pm only",
          spaceTasks: [],
          source: { key: "12808_AC_SP_01.dwg", ahu: "AHU-7", spaceDefinition: "CIRCULATION" }
        },
        {
          id: "sp-manual", building: "HOSPITAL-E", floor: "02",
          roomNumber: "E2-2040", roomName: "Med Room", roomType: "Exam Room",
          department: "EVS", departmentKey: "EVS",
          floorType: "Carpet", squareFeet: 180, fixtureCount: 1,
          notes: "", spaceTasks: []
        },
        {
          id: "sp-blank", building: "HOSPITAL-E", floor: "02",
          roomNumber: "E2-2041", roomName: "", roomType: "",
          department: "", departmentKey: "",
          floorType: "", squareFeet: 0, fixtureCount: 0, spaceTasks: []
        }
      ]
    },
    plans: [],
    nonSpace: []
  };
}

function asSheets(rows: (string | number)[][]): RawSheet[] {
  return [{ name: "Rooms", rows }];
}

describe("the re-import round trip", () => {
  it("re-importing an export changes NOTHING: no new rooms, no clobbers", () => {
    const data = fixture();
    const rows = reimportRows(data, {});
    const spaces = JSON.parse(JSON.stringify(data.v7.spaces)) as SpaceRecord[];
    const { summary } = importRoomList(spaces, asSheets(rows), rules, noAliases);

    expect(summary.created).toBe(0);
    expect(summary.keptManualEdits).toBe(0);
    expect(summary.updated).toBe(0);
    expect(summary.unchanged).toBe(3);
    expect(spaces.length).toBe(3);

    // every operational value survives byte-for-byte
    const before = data.v7.spaces!;
    for (const orig of before) {
      const after = spaces.find((s) => s.roomNumber === orig.roomNumber)!;
      for (const f of ["roomName", "roomType", "floorType", "department", "departmentKey",
        "squareFeet", "fixtureCount", "priority", "cleanability", "notes"] as const) {
        expect(String(after[f] ?? "")).toBe(String(orig[f] ?? ""));
      }
    }
  });

  it("importing an export into an EMPTY system recreates every room faithfully", () => {
    const data = fixture();
    const rows = reimportRows(data, {});
    const spaces: SpaceRecord[] = [];
    const { summary } = importRoomList(spaces, asSheets(rows), rules, noAliases);

    expect(summary.created).toBe(3);
    const cad = spaces.find((s) => s.roomNumber === "E1-1000")!;
    expect(cad.roomType).toBe("Corridor");
    expect(cad.floorType).toBe("Hard floor — finished");
    expect(cad.squareFeet).toBe(1433);
    expect(cad.fixtureCount).toBe(2);
    expect(cad.priority).toBe("High");
    expect(cad.cleanability).toBe("Non-cleanable");
    expect(cad.notes).toBe("Buff after 9pm only");
    expect(cad.department).toBe("Oncology (7 East)");
    expect(cad.departmentKey).toBe("cc:731015"); // cost-center identity survives
    expect(cad.system).toBe("AKRON");

    const manual = spaces.find((s) => s.roomNumber === "E2-2040")!;
    expect(manual.floorType).toBe("Carpet");
    expect(manual.department).toBe("EVS");
    expect(manual.departmentKey).toBe("EVS");

    const blank = spaces.find((s) => s.roomNumber === "E2-2041")!;
    expect(String(blank.roomType ?? "")).toBe("");   // blanks stay blank
    expect(String(blank.floorType ?? "")).toBe("");
    expect(blank.priority).toBeUndefined();
  });

  it("a manager's newer edit still wins over a stale export", () => {
    const data = fixture();
    const rows = reimportRows(data, {});
    const spaces = JSON.parse(JSON.stringify(data.v7.spaces)) as SpaceRecord[];
    // manager renames the room AFTER the export was taken
    spaces[0].roomName = "Corridor — East Spine";
    const { summary } = importRoomList(spaces, asSheets(rows), rules, noAliases);
    expect(spaces[0].roomName).toBe("Corridor — East Spine");
    expect(summary.keptManualEdits).toBeGreaterThan(0);
    expect(summary.created).toBe(0);
  });

  it("the export's header row is what the importer itself recognizes", () => {
    const rows = reimportRows(fixture(), {});
    const match = detectHeader(asSheets(rows))!;
    expect(match).toBeTruthy();
    expect(match.headerRow).toBe(0);
    for (const f of ["roomNumber", "roomName", "building", "floor", "roomType",
      "floorType", "fixtureCount", "sourceKey", "priority", "cleanability", "notes"] as const) {
      expect(match.columns[f], f + " column recognized").toBeDefined();
    }
  });
});

describe("scoping", () => {
  it("filters by building/floor/department and down to one room", () => {
    const data = fixture();
    expect(scopeSpaces(data, {}).length).toBe(3);
    expect(scopeSpaces(data, { building: "HOSPITAL-E", floor: "02" }).length).toBe(2);
    expect(scopeSpaces(data, { department: "EVS" }).map((s) => s.id)).toEqual(["sp-manual"]);
    expect(scopeSpaces(data, { roomId: "sp-cad" }).length).toBe(1);
    expect(scopeLabel(data, { roomId: "sp-cad" })).toBe("Room E1-1000");
    expect(scopeLabel(data, {})).toBe("Everything");
    expect(exportFilename(data, { building: "HOSPITAL-E" }, "reimport"))
      .toMatch(/^opsmatrix-reimport-hospital-e-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});

describe("the data export", () => {
  it("is the whole dataset, one row per room, columns like the tree", () => {
    const data = fixture();
    const rows = dataExportRows(data, {});
    expect(rows[0]).toEqual([...DATA_EXPORT_HEADERS]);
    expect(rows.length).toBe(4); // header + 3 rooms, no summary, no totals
    const cad = rows.find((r) => r[3] === "E1-1000")!;
    expect(cad[0]).toBe("HOSPITAL-E");           // Building leads, like the tree
    expect(cad[2]).toBe("Oncology (7 East)");
    expect(cad[5]).toBe("Corridor");
    expect(cad[6]).toBe("Hard floor — finished");
    expect(cad[7]).toBe(2);                       // fixtures
    expect(cad[8]).toBe(1433);                    // square feet
    expect(cad[9]).toBe("1");                     // priority spoken Josh's way
    expect(cad[10]).toBe("12808_AC_SP_01.dwg");   // internal handle survives
    // no report-style columns anywhere
    expect(rows[0]).not.toContain("Cleanable");
    expect(rows[0]).not.toContain("Notes");
    expect(rows[0]).not.toContain("AHU");
    expect(rows[0]).not.toContain("Weekly Minutes");
  });
});

describe("new importer column smarts", () => {
  it("parses priority and cleanable cells the way people write them", () => {
    expect(parsePriorityCell("1")).toBe("High");
    expect(parsePriorityCell("High")).toBe("High");
    expect(parsePriorityCell("2")).toBe("Medium");
    expect(parsePriorityCell("3")).toBe("Low");
    expect(parsePriorityCell("banana")).toBe("");
    expect(parseCleanableCell("Yes")).toBe("Cleanable");
    expect(parseCleanableCell("no")).toBe("Non-cleanable");
    expect(parseCleanableCell("Needs review")).toBe("Needs review");
    expect(parseCleanableCell("")).toBe("");
  });

  it("OpsMatrix's own floor labels round-trip through normalizeFloorType", () => {
    expect(normalizeFloorType(noAliases, "Hard floor — finished")).toBe("Hard floor — finished");
    expect(normalizeFloorType(noAliases, "Hard floor — unfinished")).toBe("Hard floor — unfinished");
    expect(normalizeFloorType(noAliases, "Carpet")).toBe("Carpet");
  });
});
