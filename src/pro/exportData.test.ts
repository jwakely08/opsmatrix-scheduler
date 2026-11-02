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

// ── the schedules export: a raw workbook another system can re-create ─────
import {
  schedulesWorkbookSheets, clientScheduleRows, CLIENT_SCHEDULE_HEADERS, SCHEDULES_SHEET_HEADERS, STOPS_SHEET_HEADERS,
  TASK_MINUTES_HEADERS, BREAKS_HEADERS
} from "./exportData";
import { createSchedule } from "./classicStore";

const sheetByName = (d: ClassicData) => {
  const out = new Map(schedulesWorkbookSheets(d, rules).map((s) => [s.name, s.rows]));
  return out;
};

describe("the schedules workbook (raw data to re-create the schedule elsewhere)", () => {
  const build = () => {
    const d = fixture();
    const s = createSchedule(d, "EVS 1 — East Wing Daily", "1st Shift", "");
    s.spaceOrder = ["sp-manual", "sp-cad"]; // the tap order IS the route
    // what taps write: this schedule owns each room's base clean; the exam
    // room also gets High Dusting on this schedule
    s.roomTasks = {
      "sp-manual": ["general-cleaning", "high-dusting"],
      "sp-cad": ["general-cleaning"]
    };
    s.days = [1, 2, 3, 4, 5];
    return { d, s };
  };

  it("five sheets, joined by Schedule #", () => {
    const { d } = build();
    const sheets = schedulesWorkbookSheets(d, rules);
    expect(sheets.map((s) => s.name)).toEqual(
      ["Schedules", "Room Stops", "Task Minutes", "Schedule Tasks", "Breaks"]);
    for (const sh of sheets) expect(sh.rows.length).toBeGreaterThan(0);
  });

  it("Schedules sheet: shift hours, days, target and totals", () => {
    const { d } = build();
    const rows = sheetByName(d).get("Schedules")!;
    expect(rows[0]).toEqual([...SCHEDULES_SHEET_HEADERS]);
    const r = rows[1];
    expect(r[1]).toBe("EVS 1 — East Wing Daily");
    expect(r[5]).toBe("Mon Tue Wed Thu Fri");
    expect(r[7]).toBe(8);                          // target hours
    expect(r[8]).toBe(2);                          // room stops
    expect(typeof r[12]).toBe("number");           // total est. minutes
  });

  it("Room Stops: tap order, timed start→end, designations riding along", () => {
    const { d } = build();
    const rows = sheetByName(d).get("Room Stops")!;
    expect(rows[0]).toEqual([...STOPS_SHEET_HEADERS]);
    expect(rows.length).toBe(3);
    const [r1x, r2x] = [rows[1], rows[2]];
    expect(r1x[2]).toBe(1);                        // stop # follows tap order
    expect(r1x[5]).toBe("E2-2040");                // first-tapped room first
    expect(r2x[5]).toBe("E1-1000");
    expect(String(r1x[13])).toMatch(/Trash Pull/); // the General Clean prints as its steps
    expect(String(r1x[13])).toMatch(/High Dusting/);
    expect(r1x[9]).toBe("EVS");                    // department
    expect(typeof r1x[14]).toBe("number");         // minutes
    // end time = start time + the stop's minutes (the next stop starts there)
    expect(r1x[4]).toBe(r2x[3]);
  });

  it("Task Minutes: one row per task per stop — how long EACH task takes", () => {
    const { d } = build();
    const rows = sheetByName(d).get("Task Minutes")!;
    expect(rows[0]).toEqual([...TASK_MINUTES_HEADERS]);
    const stop1 = rows.filter((r) => r[1] === 1);
    const names = stop1.map((r) => String(r[3]));
    // the General Clean is written as its steps, each with its share of the ISSA time
    expect(names).not.toContain("General Clean");
    expect(names).toEqual(expect.arrayContaining(["Trash Pull", "Vacuuming", "High Dusting"]));
    // 180 sqft exam room on carpet: general = 180 at ISSA clinical 2,150/hr = 5.0m, shared by
    // trash pull + vacuuming; high dusting (an extra) = 180/120 = 1.5m
    const gc = stop1.filter((r) => r[3] === "Trash Pull" || r[3] === "Vacuuming").reduce((a, r) => a + Number(r[4]), 0);
    const hd = stop1.find((r) => r[3] === "High Dusting")!;
    expect(gc).toBeCloseTo(5, 1);
    expect(hd[4]).toBe(1.5);
    // and the task rows sum to the stop's total (top-up row included if any)
    const stops = sheetByName(d).get("Room Stops")!;
    const total = Number(stops[1][14]);
    const sum = stop1.reduce((a, r) => a + Number(r[4]), 0);
    expect(Math.abs(sum - total)).toBeLessThan(0.6);
  });

  it("Schedule Tasks: discharges with count and minutes; Breaks with windows", () => {
    const { d, s } = build();
    d.nonSpace.push({ id: "ns1", name: "Discharge cleans", hours: 0, scheduleId: s.id, roomIds: ["sp-cad"], count: 4, minutesPer: 25 } as never);
    const sheets = sheetByName(d);
    const ns = sheets.get("Schedule Tasks")!;
    const row = ns.find((r) => String(r[1]).includes("Discharge"))!;
    expect(row[2]).toBe(4);                        // count
    expect(row[3]).toBe(100);                      // 4 × 25 min
    expect(String(row[4])).toBe("E1-1000");        // linked room by number
    const breaks = sheets.get("Breaks")!;
    expect(breaks[0]).toEqual([...BREAKS_HEADERS]);
    expect(breaks.length).toBeGreaterThan(1);      // shifts carry breaks
    expect(typeof breaks[1][5]).toBe("number");    // after-stop marker
  });

  it("no schedules → headers only, on every sheet", () => {
    for (const sh of schedulesWorkbookSheets(fixture(), rules)) {
      expect(sh.rows.length).toBe(1);
    }
  });
});

describe("the schedules workbook — the end-of-day round", () => {
  it("writes the return visit as its own stop row: same Stop #, Visit says which", () => {
    const d = fixture();
    const s = createSchedule(d, "EVS 1", "1st Shift", "");
    s.spaceOrder = ["sp-manual"];
    s.roomTasks = { "sp-manual": ["general-cleaning", "trash-2"] };
    const r2 = {
      ...rules,
      tasks: [...rules.tasks, { id: "trash-2", label: "2nd Trash Pull", sqftPerMin: null, flatMin: 2, autoFor: [], addable: true, when: "end-of-day" as const }]
    };
    const sheets = new Map(schedulesWorkbookSheets(d, r2).map((x) => [x.name, x.rows]));
    const stops = sheets.get("Room Stops")!;
    expect(stops[0][stops[0].length - 1]).toBe("Visit");
    expect(stops.slice(1).map((r) => [r[2], r[13], r[14], r[15]])).toEqual([
      [1, "Trash Pull + Vacuuming", 5, "Clean"],
      [1, "2nd Trash Pull", 2, "End-of-day round"]
    ]);
    // and the per-task minutes follow each visit
    const tasks = sheets.get("Task Minutes")!.slice(1);
    expect(tasks.map((r) => [r[3], r[4]])).toEqual([["Trash Pull", 1.7], ["Vacuuming", 3.3], ["2nd Trash Pull", 2]]);
  });
});

describe("the client schedule sheet (Josh, 2026-11-02: his columns, in schedule order, minutes unreported)", () => {
  const withRound = () => {
    const d = fixture();
    const s = createSchedule(d, "EVS 1", "1st Shift", "");
    s.spaceOrder = ["sp-manual"];
    s.roomTasks = { "sp-manual": ["general-cleaning", "trash-2"] };
    const r2 = {
      ...rules,
      tasks: [...rules.tasks, { id: "trash-2", label: "2nd Trash Pull", sqftPerMin: null, flatMin: 2, autoFor: [], addable: true, when: "end-of-day" as const }]
    };
    return { d, s, r2 };
  };

  it("exactly the columns asked for, the rooms in cleaning order, the round's return visit after them", () => {
    const { d, s, r2 } = withRound();
    const rows = clientScheduleRows(d, r2, s);
    expect(rows[0]).toEqual([...CLIENT_SCHEDULE_HEADERS]);
    expect(rows[0]).toEqual(["Stop #", "Room Number", "Room Name", "Room Type", "Square Feet", "Cleaning Tasks", "Priority", "Est. Minutes", "Schedule", "Shift", "Hours", "Unit", "Building"]);
    expect(rows.slice(1).map((r) => [r[0], r[1]])).toEqual([[1, "E2-2040"], ["↻ 1", "E2-2040"]]);
    expect(rows[1].slice(2, 7)).toEqual(["Med Room", "Exam Room", 180, "Trash Pull + Vacuuming", "Medium"]);
    expect(rows[2][5]).toBe("2nd Trash Pull");
    expect(String(rows[1][8])).toMatch(/EVS 1$/);
    expect(rows[1][9]).toBe("1st Shift");
    expect(String(rows[1][10])).toMatch(/M – .*M$/);          // "7:00 AM – 3:00 PM"
    expect(rows[1][11]).toBe("EVS 1");                        // the unit is the schedule's name
    expect(String(rows[1][12])).toMatch(/^HOSPITAL-E/);
  });

  it("the estimated minutes read — until asked for", () => {
    const { d, s, r2 } = withRound();
    expect(clientScheduleRows(d, r2, s).slice(1).map((r) => r[7])).toEqual(["—", "—"]);
    expect(clientScheduleRows(d, r2, s, { includeMinutes: true }).slice(1).map((r) => r[7])).toEqual([5, 2]);
  });
});
