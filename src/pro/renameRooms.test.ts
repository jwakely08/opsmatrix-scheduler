import { describe, it, expect } from "vitest";
import {
  LETTER_ENDINGS, applyRename, looksRough, mappedPrefix, planRename, renameGroups, renderName, splitNumber,
  typeKey, typeShort, undoRename
} from "./renameRooms";
import type { ClassicData, ClassicSpace } from "./classicStore";

const room = (id: string, roomNumber: string, roomName: string, roomType = "Patient Room", extra: Partial<ClassicSpace> = {}): ClassicSpace =>
  ({ id, roomNumber, roomName, roomType, floor: "4", ...extra });

describe("looksRough — names the drawing left behind", () => {
  it("flags blanks, the number again, code soup and dotted abbreviations", () => {
    expect(looksRough("", "FV4-201")).toBe(true);
    expect(looksRough("FV4-201", "FV4-201")).toBe(true);
    expect(looksRough("PK102PK103", "FV4-201")).toBe(true);
    expect(looksRough("4E-102 4E-103", "4E-102")).toBe(true);
    expect(looksRough("PAT. RM.", "FV4-201")).toBe(true);
    expect(looksRough("PAT. RM. 102", "FV4-201")).toBe(true);
    expect(looksRough("MECH. RM.", "B-12")).toBe(true);
    expect(looksRough("E.R.", "1-100")).toBe(true);
  });

  it("leaves real names alone, short ones included", () => {
    expect(looksRough("Patient Room", "FV4-201")).toBe(false);
    expect(looksRough("ICU", "3-300")).toBe(false);
    expect(looksRough("ICU 3", "3-300")).toBe(false);
    expect(looksRough("OR 1", "2-210")).toBe(false);
    expect(looksRough("Soiled Utility", "FV4-230")).toBe(false);
    expect(looksRough("Nurses Station", "FV4-240")).toBe(false);
  });
});

describe("renderName — the pattern's words", () => {
  const sp = room("a", "FV4-201", "PAT. RM.", "Patient Room", { department: "Med/Surg" });
  it("fills every placeholder and tidies the spacing", () => {
    expect(renderName("{type}", sp, 1)).toBe("Patient Room");
    expect(renderName("{type} {number}", sp, 1)).toBe("Patient Room FV4-201");
    expect(renderName("PT {n}", sp, 7)).toBe("PT 7");
    expect(renderName("{dept} — {type}  {floor}", sp, 1)).toBe("Med/Surg — Patient Room 4");
  });
  it("gives nothing for a room typed Other, so it can be skipped", () => {
    expect(renderName("{type}", room("b", "1", "x", "Other"), 1)).toBe("");
  });
});

describe("planRename — what would change", () => {
  const picked = [
    room("r3", "FV4-203", "PAT. RM."),
    room("r1", "FV4-201", "PAT. RM."),
    room("r2", "FV4-202", "Patient Room"),          // already right
    room("r4", "FV4-204", "PK102PK103", "Other"),    // nothing to name it after
    room("r5", "FV4-230", "SOIL. UTIL.", "Utility Room") // Max Sanitation finds it by "soil"
  ];

  it("renames to the room type, skipping what it should, in room-number order", () => {
    const plan = planRename(picked, "{type}");
    expect(plan.changes).toEqual([
      { id: "r1", from: "PAT. RM.", to: "Patient Room" },
      { id: "r3", from: "PAT. RM.", to: "Patient Room" }
    ]);
    expect(plan).toMatchObject({ noType: 1, same: 1, soiled: 1 });
  });

  it("numbers {n} across the renamed set, 1 up, after sorting by room number", () => {
    const plan = planRename(picked.slice(0, 3), "Patient {n}");
    expect(plan.changes.map((c) => [c.id, c.to])).toEqual([
      ["r1", "Patient 1"], ["r2", "Patient 2"], ["r3", "Patient 3"]
    ]);
  });

  it("lets a soiled room be renamed when the new name keeps the word", () => {
    const plan = planRename([picked[4]], "Soiled Utility {number}");
    expect(plan.changes).toEqual([{ id: "r5", from: "SOIL. UTIL.", to: "Soiled Utility FV4-230" }]);
  });

  it("groups the preview, biggest group first", () => {
    const groups = renameGroups(planRename(picked, "{type}").changes);
    expect(groups).toEqual([{ from: "PAT. RM.", to: "Patient Room", count: 2 }]);
  });
});

describe("applyRename / undoRename", () => {
  const data = (): ClassicData => ({
    v7: { spaces: [room("r1", "FV4-201", "PAT. RM."), room("r2", "FV4-202", "PAT. RM.")] },
    plans: [], nonSpace: []
  });

  it("writes the names and stamps the rooms", () => {
    const d = data();
    const plan = planRename(d.v7.spaces!, "{type}");
    expect(applyRename(d, plan.changes)).toBe(2);
    expect(d.v7.spaces!.map((s) => s.roomName)).toEqual(["Patient Room", "Patient Room"]);
    expect(d.v7.spaces![0].updatedAt).toBeTruthy();
  });

  it("undo puts the old names back, but never over a name typed since", () => {
    const d = data();
    const plan = planRename(d.v7.spaces!, "{type}");
    applyRename(d, plan.changes);
    d.v7.spaces![1].roomName = "Isolation Room"; // Josh fixed this one by hand afterwards
    expect(undoRename(d, plan.changes)).toBe(1);
    expect(d.v7.spaces!.map((s) => s.roomName)).toEqual(["PAT. RM.", "Isolation Room"]);
  });
});

describe("letters + number + name (Josh, 2026-11-02: FPKb → PKT, then the number, then the name as it is)", () => {
  it("splits a room number into its letters and its number", () => {
    expect(splitNumber("FPKb-101")).toEqual({ prefix: "FPKb", num: "101" });
    expect(splitNumber("FV4-297A")).toEqual({ prefix: "FV4", num: "297A" });
    expect(splitNumber("4E-102")).toEqual({ prefix: "4E", num: "102" });
    expect(splitNumber("PK102")).toEqual({ prefix: "PK", num: "102" });
    expect(splitNumber("102")).toEqual({ prefix: "", num: "102" });
    expect(splitNumber(" B2 .  14 ")).toEqual({ prefix: "B2", num: "14" });
  });

  it("maps the letters through the table, case aside, and says when there's no rule", () => {
    const rules = [{ from: "fpkb", to: "PKT" }, { from: "", to: "" }];
    expect(mappedPrefix("FPKb", rules)).toBe("PKT");
    expect(mappedPrefix("FV4", rules)).toBeNull();
    expect(mappedPrefix("FV4", [])).toBeNull();                    // an empty table changes nothing
    expect(mappedPrefix("FV4", [{ from: " ", to: "" }])).toBeNull();
  });

  it("builds PKT101 TLT from FPKb-101 and TLT", () => {
    const sp = room("b1", "FPKb-101", "TLT", "Restroom");
    expect(renderName("{prefix}{num} {name}", sp, 1, [{ from: "FPKb", to: "PKT" }])).toBe("PKT101 TLT");
    expect(renderName("{prefix}-{num} {name}", sp, 1, [{ from: "FPKb", to: "PKT" }])).toBe("PKT-101 TLT");
    expect(renderName("{prefix}{num} {name}", room("b2", "FPKb-102", "", "Restroom"), 1, [{ from: "FPKb", to: "PKT" }])).toBe("PKT102");
    expect(renderName("{prefix}{num} {name}", room("x", "FV4-201", "PAT. RM."), 1, [{ from: "FPKb", to: "PKT" }])).toBeNull();
  });

  it("plans the basement: rooms with other letters are left alone, and a second run changes nothing", () => {
    const rules = [{ from: "FPKb", to: "PKT" }];
    const picked = [
      room("b1", "FPKb-101", "TLT", "Restroom"),
      room("b2", "FPKb-103", "SOIL. UTIL.", "Utility Room"),
      room("b3", "FPKb-102", "", "Storage"),
      room("x", "FVb-120", "MECH.", "Mechanical Room")
    ];
    const plan = planRename(picked, "{prefix}{num} {name}", rules);
    expect(plan.changes).toEqual([
      { id: "b1", from: "TLT", to: "PKT101 TLT" },
      { id: "b3", from: "", to: "PKT102" },
      { id: "b2", from: "SOIL. UTIL.", to: "PKT103 SOIL. UTIL." }  // keeps the word Max Sanitation looks for
    ]);
    expect(plan).toMatchObject({ noRule: 1, same: 0, soiled: 0 });
    // apply, then plan again: everything already starts with its letters and number
    const data: ClassicData = { v7: { spaces: picked }, plans: [], nonSpace: [] };
    applyRename(data, plan.changes);
    const again = planRename(data.v7.spaces!, "{prefix}{num} {name}", rules);
    expect(again.changes).toEqual([]);
    expect(again.same).toBe(3);
  });
});

describe("the ending after the letters and number (Josh, 2026-11-02: '…the option to add the room type abbreviation')", () => {
  const rules = [{ from: "FPKb", to: "PKT" }];
  const abbr = { "patient room": "PT RM", "restroom": "TLT" };

  it("shortens the room type through the table, or uses the type itself when the table has nothing", () => {
    expect(typeShort(room("a", "FPKb-101", "x", "Patient Room"), abbr)).toBe("PT RM");
    expect(typeShort(room("a", "FPKb-101", "x", "Restroom"), { restroom: "  TLT " })).toBe("TLT");
    expect(typeShort(room("a", "FPKb-101", "x", "Corridor"), abbr)).toBe("Corridor");
    expect(typeShort(room("a", "FPKb-101", "x", "Other"), abbr)).toBe("");
    expect(typeKey("  Patient   Room ")).toBe("patient room");
  });

  it("builds every ending from the same letters and number", () => {
    const sp = room("b1", "FPKb-101", "TLT", "Restroom");
    const by = (id: string) => LETTER_ENDINGS.find((e) => e.id === id)!.pattern;
    expect(renderName(by("name"), sp, 1, rules, abbr)).toBe("PKT101 TLT");
    expect(renderName(by("typeabbr"), sp, 1, rules, abbr)).toBe("PKT101 TLT");
    expect(renderName(by("type"), sp, 1, rules, abbr)).toBe("PKT101 Restroom");
    expect(renderName(by("none"), sp, 1, rules, abbr)).toBe("PKT101");
    expect(renderName(by("typeabbr"), room("p", "FPKb-120", "PAT. RM.", "Patient Room"), 1, rules, abbr)).toBe("PKT120 PT RM");
  });

  it("plans the shortened type: rooms with no type are left alone, and a second run changes nothing", () => {
    const picked = [
      room("p1", "FPKb-120", "PAT. RM.", "Patient Room"),
      room("t1", "FPKb-101", "TLT", "Restroom"),
      room("o1", "FPKb-130", "PK102PK103", "Other")
    ];
    const plan = planRename(picked, "{prefix}{num} {typeabbr}", rules, abbr);
    expect(plan.changes).toEqual([
      { id: "t1", from: "TLT", to: "PKT101 TLT" },
      { id: "p1", from: "PAT. RM.", to: "PKT120 PT RM" }
    ]);
    expect(plan.noType).toBe(1);
    const data: ClassicData = { v7: { spaces: picked }, plans: [], nonSpace: [] };
    applyRename(data, plan.changes);
    expect(planRename(data.v7.spaces!, "{prefix}{num} {typeabbr}", rules, abbr).changes).toEqual([]);
  });
});
