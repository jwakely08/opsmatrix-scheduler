import { describe, it, expect } from "vitest";
import {
  detectHeader, detectImportMode, pickAreaColumn, normalizeRoomType,
  normalizeFloorType, departmentIdentity, blankDeptLabels, departmentDisplay,
  importRoomList, attachPlanToRooms, scopeTypeMatch, resolvePendingRoomTypes,
  type RawSheet, type AliasStore, type SpaceRecord
} from "./roomListImport";
import {
  defaultRules, spaceCleanability, weeklyMinutes, estimatedFte, freqPerWeek
} from "./rules";
import { facilityTotals, buildTree, byDepartment } from "./workload";

const rules = defaultRules();
const noAliases: AliasStore = { roomTypes: {}, floorTypes: {} };

/** rows shaped like Josh's real CAD export: title junk, then a header row */
function cadSheet(dataRows: (string | number)[][]): RawSheet[] {
  return [{
    name: "Comprehensive Location Re",
    rows: [
      [],
      ["Comprehensive Location Report"],
      ["2025-06-18", "", "Filters: Building = 'HOSPITAL-"],
      [],
      ["Site", "Building", "Floor", "Room Number", "Room Name", "Gross S.F.",
        "Net  S.F.", "Cost Center", "Cost Center Description", "Department",
        "Department Description", "Internal Handle", "Space Definition",
        "Floor Type", "AHU"],
      ...dataRows
    ]
  }];
}

const row = (over: Partial<Record<number, string | number>> = {}): (string | number)[] => {
  const base: (string | number)[] = [
    "AKRON", "HOSPITAL-E", "01", "E1-1000", "CORR.", 1433.45, 0,
    "73240", "SCI-CARDIOLOGY PREP & RECOVERY", "", "", "12808_AC_SP_01.dwg",
    "", "SHEET VINYL", "AHU-7"
  ];
  for (const [i, v] of Object.entries(over)) base[Number(i)] = v as string | number;
  return base;
};

describe("header detection on a real CAD export shape", () => {
  it("finds the header row below the title block", () => {
    const m = detectHeader(cadSheet([row()]));
    expect(m).not.toBeNull();
    expect(m!.headerRow).toBe(4);
    expect(m!.columns.roomNumber).toBe(3);
    expect(m!.columns.grossSqFt).toBe(5);
    expect(m!.columns.netSqFt).toBe(6);
    expect(m!.columns.sourceKey).toBe(11);
    expect(m!.columns.system).toBe(0);
    expect(m!.columns.department).toBe(9);
    expect(m!.columns.departmentName).toBe(10);
  });

  it("'Floor Type' outranks an empty 'Floor Finish' column (real CAD layout)", () => {
    const sheets: RawSheet[] = [{
      name: "s",
      rows: [
        ["Room Number", "Room Name", "Floor Finish", "Floor Type"],
        ["E1-1000", "CORR.", "", "SHEET VINYL"]
      ]
    }];
    const m = detectHeader(sheets)!;
    expect(m.columns.floorType).toBe(3);
    const spaces: SpaceRecord[] = [];
    importRoomList(spaces, sheets, rules, noAliases);
    expect(spaces[0].floorType).toBe("Hard floor — finished");
  });

  it("mode is room-list when room columns exist, unknown otherwise", () => {
    expect(detectImportMode(cadSheet([row()]))).toBe("room-list");
    expect(detectImportMode([{ name: "x", rows: [["a", "b"], [1, 2]] }])).toBe("unknown");
  });
});

describe("square footage column selection (§19–20)", () => {
  it("picks Gross when Net is all zeros, and records the choice", () => {
    const sheets = cadSheet([row(), row({ 3: "E1-1001" })]);
    const m = detectHeader(sheets)!;
    const area = pickAreaColumn(m, sheets[0].rows)!;
    expect(area.header).toBe("Gross S.F.");
  });

  it("prefers Net when both carry real areas", () => {
    const sheets = cadSheet([row({ 6: 900 }), row({ 3: "E1-1001", 6: 880 })]);
    const m = detectHeader(sheets)!;
    expect(pickAreaColumn(m, sheets[0].rows)!.header).toBe("Net  S.F.");
  });

  it("returns null when no candidate holds positive areas — rooms still import", () => {
    const sheets = cadSheet([row({ 5: 0 })]);
    const m = detectHeader(sheets)!;
    expect(pickAreaColumn(m, sheets[0].rows)).toBeNull();
    const spaces: SpaceRecord[] = [];
    const { summary } = importRoomList(spaces, sheets, rules, noAliases);
    expect(summary.created).toBe(1);
    expect(spaces[0].squareFeet).toBeUndefined();
    expect(summary.warnings.join(" ")).toMatch(/square footage/i);
  });
});

describe("room type normalization (§24–25)", () => {
  const n = (name: string, def?: string) => normalizeRoomType(rules, noAliases, name, def);
  it("maps common CAD abbreviations deterministically", () => {
    expect(n("PAT. RM.")).toBe("Patient Room");
    expect(n("PAT. TLT.")).toBe("Restroom");
    expect(n("TLT.")).toBe("Restroom");
    expect(n("CORR.")).toBe("Corridor");
    expect(n("NURSES STN.")).toBe("Office");
    expect(n("SOILED UTIL.")).toBe("Utility Room");
    expect(n("MECH. RM.")).toBe("Mechanical Room");
    expect(n("ELEC.")).toBe("Electrical Room");
    expect(n("TELECOM")).toBe("Data / Telecom Room");
    expect(n("STAIR")).toBe("Stairwell");
    expect(n("ELEV.")).toBe("Elevator");
    expect(n("STOR.")).toBe("Storage");
    expect(n("SHAFT")).toBe("Shaft");
    expect(n("OFFICE")).toBe("Office");
    expect(n("WAITING")).toBe("Waiting Room");
    expect(n("HSKPG.")).toBe("Utility Room");
  });
  it("believes an explicit SHELL/ROOF space definition", () => {
    expect(n("anything", "SHELL")).toBe("Shell Space");
    expect(n("-", "ROOF")).toBe("Roof");
  });
  it("leaves the unknown BLANK instead of guessing", () => {
    expect(n("-")).toBeNull();
    expect(n("FLUOROSCOPY CONTROL")).toBeNull();
  });
  it("an approved alias wins over the deterministic rules", () => {
    const aliases: AliasStore = { roomTypes: { fluoroscopycontrol: "procedure-room" }, floorTypes: {} };
    expect(normalizeRoomType(rules, aliases, "FLUOROSCOPY CONTROL")).toBe("Procedure Room");
  });
});

describe("Scope determines classification (Josh's rule)", () => {
  it("a room type ADDED in Scope is recognized automatically, abbreviations included", () => {
    const withTele = defaultRules();
    withTele.roomTypes.push({ id: "telemetry-room", label: "Telemetry Room", qualifierMin: 4, frequency: "7x / week" });
    expect(normalizeRoomType(withTele, noAliases, "TELE. RM.")).toBe("Telemetry Room");
    expect(normalizeRoomType(withTele, noAliases, "TELEMETRY ROOM")).toBe("Telemetry Room");
    // without that Scope entry the same name stays honestly unclassified
    expect(normalizeRoomType(rules, noAliases, "TELE. RM.")).toBeNull();
  });
  it("an abbreviation that could fit two Scope types matches neither", () => {
    const r = defaultRules();
    r.roomTypes.push({ id: "st-a", label: "Simulation Room", qualifierMin: 0, frequency: "5x / week" });
    r.roomTypes.push({ id: "st-b", label: "Sterilizer Room", qualifierMin: 0, frequency: "5x / week" });
    expect(scopeTypeMatch(r, "S. RM.")).toBeNull();
  });
  it("adding a Scope type retroactively resolves waiting Needs-Review rooms", () => {
    const spaces: SpaceRecord[] = [];
    importRoomList(spaces, cadSheet([row({ 4: "TELE. RM." })]), rules, noAliases);
    expect(spaces[0].roomType).toBe("");
    const withTele = defaultRules();
    withTele.roomTypes.push({ id: "telemetry-room", label: "Telemetry Room", qualifierMin: 4, frequency: "7x / week" });
    const n = resolvePendingRoomTypes(spaces, withTele, noAliases);
    expect(n).toBe(1);
    expect(spaces[0].roomType).toBe("Telemetry Room");
    expect(Number(spaces[0].estimatedCleaningMinutes)).toBeGreaterThan(0);
    // a second pass has nothing left to do, and set types are never overridden
    expect(resolvePendingRoomTypes(spaces, withTele, noAliases)).toBe(0);
  });
  it("knows the shorthand for types Scope already has", () => {
    const n = (name: string) => normalizeRoomType(rules, noAliases, name);
    expect(n("VEST.")).toBe("Lobby");
    expect(n("RECEP.")).toBe("Office");
    expect(n("LKRS.")).toBe("Locker Room");
    expect(n("I.T.")).toBe("Data / Telecom Room");
    expect(n("SOILED HOLDING")).toBe("Utility Room");
    expect(n("MEDS.")).toBe("Utility Room");
    expect(n("DECONTAM.")).toBe("Utility Room");
    expect(n("VENTS")).toBe("Mechanical Room");
    expect(n("WATER TREATMENT")).toBe("Mechanical Room");
    expect(n("EQUIP. RM.")).toBe("Utility Room");
    expect(n("EQUIP. ALCOVE")).toBe("Utility Room");
    expect(n("KITCHEN")).toBe("Lounge");
    expect(n("VENDING")).toBe("Lounge");
    expect(n("CLASSROOM")).toBe("Office");
    expect(n("GROUP RM.")).toBe("Office");
    expect(n("ANTE")).toBe("Utility Room");
    // the genuinely ambiguous still ask a human (or Max)
    expect(n("P/R #4")).toBeNull();
    expect(n("TEE")).toBeNull();
    expect(n("DIR.")).toBeNull();
  });
});

describe("floor type normalization (§56)", () => {
  it("maps known finishes and leaves the rest blank", () => {
    expect(normalizeFloorType(noAliases, "CARPET")).toBe("Carpet");
    expect(normalizeFloorType(noAliases, "SHEET VINYL")).toBe("Hard floor — finished");
    expect(normalizeFloorType(noAliases, "CERAMIC TILE")).toBe("Hard floor — finished");
    expect(normalizeFloorType(noAliases, "LVT")).toBe("Hard floor — finished");
    expect(normalizeFloorType(noAliases, "CONCRETE")).toBe("Hard floor — unfinished");
    expect(normalizeFloorType(noAliases, "")).toBe("");
    expect(normalizeFloorType(noAliases, "MOON ROCK")).toBe("");
  });
});

describe("department identity vs name (§12–§18)", () => {
  it("a code is identity but never a display name", () => {
    expect(departmentIdentity("60005", "")).toEqual({ key: "60005", name: "" });
  });
  it("a name identifies and displays", () => {
    expect(departmentIdentity("", "Oncology")).toEqual({ key: "Oncology", name: "Oncology" });
  });
  it("no code and no name → no department at all", () => {
    expect(departmentIdentity("", "")).toEqual({ key: null, name: "" });
  });
  it("two blank-named departments with different codes stay separate, with stable labels", () => {
    const spaces = [
      { departmentKey: "D-200", department: "" },
      { departmentKey: "D-100", department: "" },
      { departmentKey: "D-300", department: "Oncology" }
    ];
    const labels = blankDeptLabels(spaces);
    expect(labels.get("D-100")).toBe("Blank Department 1");
    expect(labels.get("D-200")).toBe("Blank Department 2");
    expect(labels.has("D-300")).toBe(false);
    expect(departmentDisplay(spaces[2], labels)).toBe("Oncology");
    expect(departmentDisplay({ departmentKey: "", department: "" }, labels)).toBe("No department assigned");
    // stable across a "refresh" (recompute)
    expect(blankDeptLabels([...spaces].reverse()).get("D-100")).toBe("Blank Department 1");
  });
  it("with no department columns, cost center IS the department: code = identity, description = name (Josh's rule)", () => {
    const spaces: SpaceRecord[] = [];
    importRoomList(spaces, cadSheet([
      row({ 11: "H1.dwg" }),                                     // CC 73240 + description
      row({ 3: "E1-2000", 7: "60080", 8: "ONCOLOGY (7 EAST)", 11: "H2.dwg" }),
      row({ 3: "E1-3000", 7: "61910", 8: "", 11: "H3.dwg" }),    // code, no description
      row({ 3: "E1-4000", 7: "-", 8: "-", 11: "H4.dwg" })        // junk CC → no evidence
    ]), rules, noAliases);
    expect(spaces[0].departmentKey).toBe("cc:73240");
    expect(spaces[0].department).toBe("Sci-Cardiology Prep & Recovery"); // tidied from ALL-CAPS
    expect(spaces[1].department).toBe("Oncology (7 East)");
    expect(spaces[2].departmentKey).toBe("cc:61910");
    expect(spaces[2].department ?? "").toBe("");                 // no description → placeholder fallback
    expect(spaces[3].departmentKey ?? "").toBe("");              // stays unassigned
    type DeptLike = { departmentKey?: string; department?: string };
    const labels = blankDeptLabels(spaces as DeptLike[]);
    expect(departmentDisplay(spaces[2] as DeptLike, labels)).toBe("Blank Department 1");
    expect(departmentDisplay(spaces[3] as DeptLike, labels)).toBe("No department assigned");
    // the verbatim source value is preserved alongside the tidied name
    const src = spaces[0].source as { costCenterDescription: string };
    expect(src.costCenterDescription).toBe("SCI-CARDIOLOGY PREP & RECOVERY");
    // a real department column still outranks cost center
    const withDept: SpaceRecord[] = [];
    importRoomList(withDept, cadSheet([row({ 9: "D-77", 11: "H9.dwg" })]), rules, noAliases);
    expect(withDept[0].departmentKey).toBe("D-77");
  });

  it("a rename during validation survives re-import (identity keeps the grouping)", () => {
    const spaces: SpaceRecord[] = [];
    importRoomList(spaces, cadSheet([row({ 7: "60080", 8: "ONCOLOGY (7 EAST)" })]), rules, noAliases);
    expect(spaces[0].department).toBe("Oncology (7 East)");
    spaces[0].department = "Oncology";                            // manager tidies the name
    const again = importRoomList(spaces, cadSheet([row({ 7: "60080", 8: "ONCOLOGY (7 EAST)" })]), rules, noAliases);
    expect(spaces[0].department).toBe("Oncology");               // manual edit wins
    expect(spaces[0].departmentKey).toBe("cc:60080");            // grouping intact
    expect(again.summary.keptManualEdits).toBeGreaterThan(0);
  });
});

describe("import, upsert and lineage (§10, §21–§23)", () => {
  it("creates canonical rooms with source preserved and blanks blank", () => {
    const spaces: SpaceRecord[] = [];
    const { summary } = importRoomList(
      spaces, cadSheet([row(), row({ 3: "E1-2000", 4: "PAT. RM.", 5: 227, 11: "13047_AC_SP_01.dwg" })]),
      rules, noAliases, { fileName: "e-building.xlsx" });
    expect(summary.created).toBe(2);
    expect(summary.sqftSource).toBe("Gross S.F.");
    const pat = spaces[1];
    expect(pat.roomType).toBe("Patient Room");
    expect(pat.squareFeet).toBe(227);
    expect(pat.system).toBe("AKRON");
    expect(pat.department).toBe("Sci-Cardiology Prep & Recovery"); // from cost center (Josh's rule)
    expect(pat.importSource).toBe("room-list");
    expect(Number(pat.estimatedCleaningMinutes)).toBeGreaterThan(0);
    const src = pat.source as { key: string; floorType: string; file: string };
    expect(src.key).toBe("13047_AC_SP_01.dwg");
    expect(src.file).toBe("e-building.xlsx");
    // corridor floor type mapped, original preserved
    expect(spaces[0].floorType).toBe("Hard floor — finished");
    expect((spaces[0].source as { floorType: string }).floorType).toBe("SHEET VINYL");
  });

  it("re-import updates by Internal Handle instead of duplicating", () => {
    const spaces: SpaceRecord[] = [];
    importRoomList(spaces, cadSheet([row({ 5: 1000 })]), rules, noAliases);
    const r2 = importRoomList(spaces, cadSheet([row({ 5: 1200 })]), rules, noAliases);
    expect(spaces.length).toBe(1);
    expect(r2.summary.created).toBe(0);
    expect(r2.summary.updated).toBe(1);
    expect(spaces[0].squareFeet).toBe(1200);
  });

  it("an identical re-import is unchanged, and a manual edit is never clobbered", () => {
    const spaces: SpaceRecord[] = [];
    importRoomList(spaces, cadSheet([row()]), rules, noAliases);
    const again = importRoomList(spaces, cadSheet([row()]), rules, noAliases);
    expect(again.summary.unchanged).toBe(1);
    // the manager fixes the floor type by hand…
    spaces[0].floorType = "Carpet";
    const third = importRoomList(spaces, cadSheet([row()]), rules, noAliases);
    expect(spaces[0].floorType).toBe("Carpet");
    expect(third.summary.keptManualEdits).toBeGreaterThan(0);
  });

  it("duplicate room numbers with distinct handles stay separate rooms", () => {
    const spaces: SpaceRecord[] = [];
    const { summary } = importRoomList(spaces, cadSheet([
      row({ 3: "E8-2000", 11: "H1.dwg" }),
      row({ 3: "E8-2000", 11: "H2.dwg" })
    ]), rules, noAliases);
    expect(summary.created).toBe(2);
    expect(summary.duplicateRoomNumbers).toEqual(["E8-2000"]);
  });

  it("refuses a file with no recognizable room list", () => {
    expect(() => importRoomList([], [{ name: "x", rows: [[1, 2], [3, 4]] }], rules, noAliases))
      .toThrow(/no room list/i);
  });
});

describe("cleanability and workload (§28–§36)", () => {
  it("follows the normalized room type, with review for the unknown", () => {
    expect(spaceCleanability(rules, { roomType: "Patient Room" })).toBe("Cleanable");
    expect(spaceCleanability(rules, { roomType: "Mechanical Room" })).toBe("Non-cleanable");
    expect(spaceCleanability(rules, { roomType: "" })).toBe("Needs review");
    expect(spaceCleanability(rules, { roomType: "Mystery" })).toBe("Needs review");
  });
  it("a manual override wins", () => {
    expect(spaceCleanability(rules, { roomType: "Mechanical Room", cleanability: "Cleanable" })).toBe("Cleanable");
    expect(spaceCleanability(rules, { roomType: "Office", cleanability: "Non-cleanable" })).toBe("Non-cleanable");
  });
  it("weekly minutes = the SAME per-visit engine × frequency; unknowns are null, not zero", () => {
    const office = { roomType: "Office", squareFeet: 330, floorType: "Hard floor — finished" };
    // per-visit: 330/33 = 10 min; Office is 5x/week → 50
    expect(weeklyMinutes(rules, office)).toBe(50);
    expect(weeklyMinutes(rules, { roomType: "Mechanical Room", squareFeet: 500 })).toBe(0);
    expect(weeklyMinutes(rules, { roomType: "", squareFeet: 500 })).toBeNull();
    expect(weeklyMinutes(rules, { roomType: "Office" })).toBeNull(); // no sqft yet
  });
  it("frequency strings parse the way the Scope screen writes them", () => {
    expect(freqPerWeek("7x / week")).toBe(7);
    expect(freqPerWeek("5x / week")).toBe(5);
    expect(freqPerWeek("Every other week")).toBe(0.5);
    expect(freqPerWeek("Monthly")).toBeCloseTo(12 / 52);
  });
  it("FTE is workload ÷ productive time — the original engine's algorithm", () => {
    // 2100 weekly minutes ÷ (420 productive × 5 shifts) = 1 FTE
    expect(estimatedFte(2100, rules)).toBe(1);
  });
});

describe("a later floor plan attaches to existing rooms (§9)", () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  it("moves geometry onto the matching room instead of duplicating it", () => {
    const existing: SpaceRecord[] = [
      { id: "sp-1", building: "HOSPITAL-E", floor: "01", roomNumber: "E1-1000", roomName: "CORR.", squareFeet: 1433 },
      { id: "sp-2", building: "HOSPITAL-E", floor: "01", roomNumber: "E1-1001" }
    ];
    const imported = {
      plan: { id: "plan-x", rooms: [{ spaceId: "ai-1", pts }] },
      spaces: [
        { id: "ai-1", building: "HOSPITAL-E", floor: "01", roomNumber: "E1-1000", visualPts: pts, visualPlanId: "plan-x", squareFeet: 999 },
        { id: "ai-2", building: "HOSPITAL-E", floor: "01", roomNumber: "E1-9999", visualPts: pts, visualPlanId: "plan-x" }
      ] as SpaceRecord[]
    };
    const r = attachPlanToRooms(existing, imported);
    expect(r.attached).toBe(1);
    expect(r.added).toBe(1);
    expect(existing.length).toBe(3);                 // sp-1, sp-2, ai-2 — no duplicate of E1-1000
    expect(existing[0].visualPlanId).toBe("plan-x");
    expect(existing[0].squareFeet).toBe(1433);       // the list's area is kept, not overwritten
    expect(imported.plan.rooms[0].spaceId).toBe("sp-1"); // the plan points at the SAME room record
  });
  it("matches on room number alone when the plan omitted building/floor and it is unambiguous", () => {
    const existing: SpaceRecord[] = [
      { id: "sp-1", building: "HOSPITAL-E", floor: "03", roomNumber: "E3-201" }
    ];
    const imported = {
      plan: { rooms: [{ spaceId: "ai-1", pts }] },
      spaces: [{ id: "ai-1", building: "", floor: "", roomNumber: "E3-201", visualPts: pts }] as SpaceRecord[]
    };
    expect(attachPlanToRooms(existing, imported).attached).toBe(1);
    expect(existing.length).toBe(1);
  });
});

describe("facility totals and drill-down (§33, §41–§48)", () => {
  const spaces = [
    { id: "a", system: "AKRON", building: "E", floor: "03", departmentKey: "D1", department: "Oncology",
      roomType: "Patient Room", squareFeet: 227, floorType: "Hard floor — finished" },
    { id: "b", system: "AKRON", building: "E", floor: "03", departmentKey: "D2", department: "",
      roomType: "Office", squareFeet: 330, floorType: "Hard floor — finished" },
    { id: "c", system: "AKRON", building: "E", floor: "03", departmentKey: "D3", department: "",
      roomType: "Mechanical Room", squareFeet: 800 },
    { id: "d", system: "AKRON", building: "E", floor: "04", departmentKey: "", department: "",
      roomType: "", squareFeet: 100 }
  ];
  it("total vs cleanable vs non-cleanable vs unresolved never blur (§28, §33)", () => {
    const t = facilityTotals(spaces, rules);
    expect(t.totalSqFt).toBe(1457);
    expect(t.cleanableSqFt).toBe(557);
    expect(t.nonCleanableSqFt).toBe(800);
    expect(t.unresolvedSqFt).toBe(100);
    expect(t.reviewRooms).toBe(1);
    expect(t.coverage).toBeCloseTo((1457 - 100) / 1457);
    // patient room: (227/33 → 6.879 + 6 qual → round 13) × 7 = 91; office 10 × 5 = 50
    expect(t.weeklyMinutes).toBe(91 + 50);
    expect(t.fte).toBeCloseTo(141 / 2100);
  });
  it("blank departments stay separate in the tree and the chart", () => {
    const depts = byDepartment(spaces, rules);
    const labels = depts.map((d) => d.label);
    expect(labels).toContain("Oncology");
    expect(labels).toContain("Blank Department 1");
    expect(labels).toContain("Blank Department 2");
    const tree = buildTree(spaces, rules);
    expect(tree[0].label).toBe("AKRON");
    const floor3 = tree[0].children[0].children.find((f) => f.label === "03")!;
    expect(floor3.children.length).toBe(3); // Oncology + two separate blanks
  });
});
