// The structured CAD importer: a facilities-managed DXF is TRANSCRIBED, not
// detected — closed space polylines + block-attribute room tags become exact
// rooms. Modeled on the FV-01 hospital file (858/858 tags matched).
import { describe, it, expect } from "vitest";
import {
  parseCad, buildCadRooms, cadUsageToScopeLabel, cadLooksStructured,
  unitFtPerUnit, isNumberTag, isNameTag, cleanMtext, polyArea
} from "./cadImport";

/** build a minimal ASCII DXF from pieces */
const dxf = (...body: string[]) => [
  "0", "SECTION", "2", "HEADER",
  "9", "$INSUNITS", "70", "1",
  "0", "ENDSEC",
  "0", "SECTION", "2", "ENTITIES",
  ...body,
  "0", "ENDSEC", "0", "EOF"
].join("\n");

/** a closed LWPOLYLINE rectangle, inches */
const rect = (layer: string, x: number, y: number, w: number, h: number) => [
  "0", "LWPOLYLINE", "8", layer, "90", "4", "70", "1",
  "10", String(x), "20", String(y),
  "10", String(x + w), "20", String(y),
  "10", String(x + w), "20", String(y + h),
  "10", String(x), "20", String(y + h)
];

/** an INSERT carrying Room Number / Room Usage attributes (the FV-01 shape) */
const tag = (x: number, y: number, num: string, usage: string) => [
  "0", "INSERT", "8", "__FN_TEXTSCHEME", "2", "FN_ts#6", "66", "1",
  "10", String(x), "20", String(y),
  "0", "ATTRIB", "8", "__FN_TEXTSCHEME", "2", "Room Number", "1", num,
  "10", String(x), "20", String(y),
  "0", "ATTRIB", "8", "__FN_TEXTSCHEME", "2", "Room Usage", "1", usage,
  "10", String(x), "20", String(y),
  "0", "SEQEND"
];

// a 12x10 ft patient room (144x120 in), a 6x5 ft toilet, a big corridor
const PLAN = dxf(
  ...rect("SP-PLINE", 0, 0, 144, 120),
  ...rect("SP-PLINE", 150, 0, 72, 60),
  ...rect("SP-PLINE", 0, 130, 400, 60),
  ...rect("AR-FURN", 10, 10, 20, 20),           // furniture — not a room
  ...tag(70, 60, "FV1-101", "PAT. RM."),
  ...tag(180, 30, "FV1-101A", "PAT TLT"),
  ...tag(200, 160, "FV1-C01", "CORR."),
  "0", "TEXT", "8", "AR-GRID", "1", "W10", "10", "9999", "20", "9999" // grid bubble in space
);

describe("parseCad", () => {
  it("reads header units, closed polylines, and insert attributes", () => {
    const p = parseCad(PLAN);
    expect(p.insunits).toBe(1);
    expect(p.polys.length).toBe(4);
    expect(p.tags.length).toBe(3);
    expect(p.tags[0].attrs["Room Number"]).toBe("FV1-101");
    expect(p.tags[0].attrs["Room Usage"]).toBe("PAT. RM.");
  });

  it("open polylines are not rooms", () => {
    const open = dxf(
      "0", "LWPOLYLINE", "8", "SP-PLINE", "90", "3", "70", "0",
      "10", "0", "20", "0", "10", "10", "20", "0", "10", "10", "20", "10");
    expect(parseCad(open).polys.length).toBe(0);
  });

  it("cleanMtext strips inline formatting", () => {
    expect(cleanMtext("{\\fArial|b0;PAT.} RM.\\Pfirst floor")).toBe("PAT. RM. first floor");
  });
});

describe("buildCadRooms", () => {
  const result = buildCadRooms(parseCad(PLAN));

  it("every tag lands in its own room, exact sizes come free", () => {
    expect(result.rooms.length).toBe(3); // furniture rectangle rejected
    const pat = result.rooms.find((r) => r.roomNumber === "FV1-101")!;
    expect(pat.roomName).toBe("PAT. RM.");
    expect(pat.roomType).toBe("Patient Room");
    expect(pat.sqFt).toBe(120); // 144in x 120in = 12ft x 10ft
    const tlt = result.rooms.find((r) => r.roomNumber === "FV1-101A")!;
    expect(tlt.roomType).toBe("Restroom");
    expect(tlt.sqFt).toBe(30);
    expect(result.orphanTags).toBe(0);
  });

  it("furniture outlines never survive: untagged shapes live only on the space layer", () => {
    expect(result.rooms.some((r) => r.layer === "AR-FURN")).toBe(false);
  });

  it("an untagged polyline ON the space layer is kept as an unlabeled space", () => {
    const withExtra = dxf(
      ...rect("SP-PLINE", 0, 0, 144, 120),
      ...rect("SP-PLINE", 200, 200, 100, 100),
      ...tag(70, 60, "101", "OFFICE"));
    const r = buildCadRooms(parseCad(withExtra));
    expect(r.rooms.length).toBe(2);
    expect(r.unlabeled).toBe(1);
    expect(r.rooms.find((x) => !x.roomNumber)!.roomName).toBe("");
  });

  it("free TEXT fills holes but never overrides a block tag", () => {
    const mixed = dxf(
      ...rect("SP-PLINE", 0, 0, 144, 120),
      ...rect("SP-PLINE", 200, 0, 144, 120),
      ...tag(70, 60, "101", "OFFICE"),
      "0", "TEXT", "8", "AR-TXT", "1", "999", "10", "72", "20", "60",     // inside tagged room — ignored
      "0", "TEXT", "8", "AR-TXT", "1", "202", "10", "270", "20", "60"     // inside untagged room — used
    );
    const r = buildCadRooms(parseCad(mixed));
    expect(r.rooms.find((x) => x.roomNumber === "101")).toBeTruthy();
    expect(r.rooms.find((x) => x.roomNumber === "999")).toBeUndefined();
    expect(r.rooms.find((x) => x.roomNumber === "202")).toBeTruthy();
  });

  it("a tag over a desk still claims the ROOM, not the desk outline", () => {
    // three tagged rooms; one tag sits inside a small furniture rectangle
    // nested in its room — the layer vote must route it to the space layer
    const r = buildCadRooms(parseCad(dxf(
      ...rect("SP-PLINE", 0, 0, 144, 120),
      ...rect("SP-PLINE", 200, 0, 144, 120),
      ...rect("SP-PLINE", 400, 0, 144, 120),
      ...rect("AR-FURN", 420, 20, 60, 60),   // desk inside room 3
      ...tag(70, 60, "101", "OFFICE"),
      ...tag(270, 60, "102", "OFFICE"),
      ...tag(440, 40, "103", "OFFICE"))));   // tag lands on the desk
    const r103 = r.rooms.find((x) => x.roomNumber === "103")!;
    expect(r103.layer).toBe("SP-PLINE");
    expect(r103.sqFt).toBe(120); // the room's 12x10 ft, not the desk's 5x5
    expect(r.rooms.length).toBe(3);
  });

  it("a tag floating outside every boundary counts as an orphan", () => {
    const r = buildCadRooms(parseCad(dxf(
      ...rect("SP-PLINE", 0, 0, 144, 120),
      ...tag(70, 60, "101", "OFFICE"),
      ...tag(5000, 5000, "999", "LOST"))));
    expect(r.orphanTags).toBe(1);
  });
});

describe("units", () => {
  it("honors the header when present", () => {
    expect(unitFtPerUnit(1, 999)).toBeCloseTo(1 / 12);
    expect(unitFtPerUnit(2, 999)).toBe(1);
    expect(unitFtPerUnit(6, 999)).toBeCloseTo(3.28084);
  });

  it("guesses a believable unit when the header is silent", () => {
    // median room 17280 units² → inches gives 120 sq ft (believable)
    expect(unitFtPerUnit(0, 17280)).toBeCloseTo(1 / 12);
    // median room 120 units² → feet gives 120 sq ft
    expect(unitFtPerUnit(0, 120)).toBe(1);
    // median room ~11.15 m² → meters gives ~120 sq ft
    expect(unitFtPerUnit(0, 11.15)).toBeCloseTo(3.28084);
  });
});

describe("tag recognition + the Scope dictionary", () => {
  it("recognizes the number/name attribute spellings that occur in the wild", () => {
    for (const t of ["Room Number", "ROOMNO", "RM_NUM", "Number", "room-number"]) {
      expect(isNumberTag(t)).toBe(true);
    }
    for (const t of ["Room Usage", "ROOMNAME", "NAME", "Description", "room_desc"]) {
      expect(isNameTag(t)).toBe(true);
    }
    expect(isNumberTag("CCM_HVDESIGN")).toBe(false);
    expect(isNameTag("CCM_LSDATE")).toBe(false);
  });

  it("maps the FV-01 vocabulary onto the packaged Scope types", () => {
    expect(cadUsageToScopeLabel("PAT. RM.")).toBe("Patient Room");
    expect(cadUsageToScopeLabel("PAT TLT")).toBe("Restroom");
    expect(cadUsageToScopeLabel("WOMEN TLT")).toBe("Restroom");
    expect(cadUsageToScopeLabel("CORR.")).toBe("Corridor");
    expect(cadUsageToScopeLabel("EXAM #4")).toBe("Exam Room");
    expect(cadUsageToScopeLabel("DRS. OFFICE")).toBe("Office");
    expect(cadUsageToScopeLabel("STOR.")).toBe("Storage");
    expect(cadUsageToScopeLabel("ELEC.")).toBe("Electrical Room");
    expect(cadUsageToScopeLabel("MECH. RM.")).toBe("Mechanical Room");
    expect(cadUsageToScopeLabel("SHAFT")).toBe("Shaft");
    expect(cadUsageToScopeLabel("STAIR H")).toBe("Stairwell");
    expect(cadUsageToScopeLabel("EVS")).toBe("Utility Room");
    expect(cadUsageToScopeLabel("SOILED UTIL. #1")).toBe("Utility Room");
    expect(cadUsageToScopeLabel("TRAUMA #1")).toBe("Emergency Room");
    // the unknowns stay unknown — Needs review beats a silent wrong price
    expect(cadUsageToScopeLabel("BACKFLOW")).toBe("");
    expect(cadUsageToScopeLabel("GIFT SHOP")).toBe("");
  });
});

describe("cadLooksStructured", () => {
  it("many numbered rooms → structured; a few stray labels → not", () => {
    const good = buildCadRooms(parseCad(PLAN));
    // PLAN has 3 rooms, all numbered
    expect(cadLooksStructured(good)).toBe(false); // under the 5-room floor
    const rooms = Array.from({ length: 12 }, (_, i) => ({
      pts: [], roomNumber: i < 8 ? String(i) : "", roomName: "", roomType: "", sqFt: 0, layer: ""
    }));
    expect(cadLooksStructured({ rooms, ftPerUnit: 1, orphanTags: 0, unlabeled: 0 })).toBe(true);
    rooms.forEach((r, i) => { if (i > 2) r.roomNumber = ""; });
    expect(cadLooksStructured({ rooms, ftPerUnit: 1, orphanTags: 0, unlabeled: 0 })).toBe(false);
  });
});

describe("polyArea", () => {
  it("shoelace on a rectangle", () => {
    expect(polyArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }])).toBe(50);
  });
});
