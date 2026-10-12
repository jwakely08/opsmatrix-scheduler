// The General Clean model (Josh, 2026-10-12): each room type carries its
// own formula — by size (sq ft ÷ rate), fixed minutes per room, or both —
// typed in the hospital's own unit, ISSA midpoints by default; floor type
// never changes it, there is no per-room minimum, and each type lists the
// tasks its General Clean already includes. Plus the migration of saved
// rules and of the operator's "issa-*" workaround.
import { describe, it, expect, beforeEach } from "vitest";
import {
  defaultRules, loadRules, saveRules, computeMinutes, migrateRules, gcFormula, gcMinutes, gcText,
  gcFormulaText, rateFromUnit, rateInUnit, resetToIssa, issaSourceLabel, includedTasksFor, includedConflicts,
  requiredTasks, autoTasksFor, generalCleanLine, ISSA_CATEGORIES, ISSA_TYPE_CATEGORY, issaCategory,
  typeIdFromLabel, typeIdFromLabelStrict, RULES_KEY, type Rules, type RoomTypeRule, type RateUnit
} from "./rules";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); }
  };
});

const HARD = "Hard floor — finished";
const room = (roomType: string, squareFeet = 1000, spaceTasks: string[] = []) =>
  ({ roomType, squareFeet, floorType: HARD, spaceTasks });
const type = (r: Rules, id: string) => r.roomTypes.find((x) => x.id === id)!;

describe("ISSA defaults", () => {
  it("ships the ISSA 612 midpoints", () => {
    const rate = (id: string) => issaCategory(id)!.sqftPerHour;
    expect(rate("office")).toBe(4250);
    expect(rate("conference")).toBe(3500);
    expect(rate("lobby-corridor")).toBe(5500);
    expect(rate("elevator")).toBe(600);
    expect(rate("restroom")).toBe(1000);
    expect(rate("break-room")).toBe(3150);
    expect(rate("clinical")).toBe(2150);
    expect(rate("lab")).toBe(1850);
    expect(rate("locker")).toBe(1850);
    expect(new Set(ISSA_CATEGORIES.map((c) => c.id)).size).toBe(ISSA_CATEGORIES.length);
  });

  it("every built-in type: by size at its category's rate, trash/mop/vacuum included", () => {
    const r = defaultRules();
    for (const rt of r.roomTypes) {
      const cat = issaCategory(ISSA_TYPE_CATEGORY[rt.id]);
      expect(cat, rt.id).toBeDefined();
      expect(gcFormula(r, rt), rt.id).toEqual({ method: "size", fixedMin: 0, sqftPerHour: cat!.sqftPerHour, rateUnit: "sqftPerHour" });
      expect(issaSourceLabel(r, rt)).toBe(`ISSA ${cat!.label}`);
      expect(rt.includedTasks).toEqual(["trash-pull", "damp-mop", "vacuum"]);
    }
    const cat = (id: string) => type(r, id).issaCategory;
    expect(["exam-room", "emergency-room", "patient-room", "procedure-room", "operating-room", "nurses-station"].map(cat))
      .toEqual(Array(6).fill("clinical"));
    expect(["corridor", "hallway", "stairwell", "lobby", "waiting-room"].map(cat)).toEqual(Array(5).fill("lobby-corridor"));
    expect(cat("storage")).toBe("office");
  });

  it("adds the new hospital types", () => {
    const r = defaultRules();
    expect(type(r, "conference-room")).toMatchObject({ label: "Conference Room", frequency: "5x / week", issaCategory: "conference" });
    expect(type(r, "nurses-station")).toMatchObject({ label: "Nurses Station", frequency: "7x / week", issaCategory: "clinical" });
    expect(type(r, "break-room")).toMatchObject({ label: "Break Room / Kitchen", frequency: "7x / week", issaCategory: "break-room" });
    expect(type(r, "lab")).toMatchObject({ label: "Laboratory", frequency: "7x / week", issaCategory: "lab" });
    expect(type(r, "clean-utility")).toMatchObject({ label: "Clean Supply / Med Room", frequency: "7x / week", issaCategory: "clinical" });
  });

  it("legacy labels land on the new types while the account has them", () => {
    const r = defaultRules();
    expect(typeIdFromLabel(r, "Nurses Station")).toBe("nurses-station");
    expect(typeIdFromLabel(r, "Break Room")).toBe("break-room");
    expect(typeIdFromLabelStrict(r, "Conference Room")).toBe("conference-room");
    r.roomTypes = r.roomTypes.filter((rt) => rt.id !== "break-room");
    expect(typeIdFromLabel(r, "Break Room")).toBe("lounge");
  });
});

describe("the General Clean formula", () => {
  it("one line, worked so it can be redone by hand — Josh's example", () => {
    const { lines, total } = computeMinutes(defaultRules(), room("Office", 152));
    expect(lines).toEqual([{ label: "General Clean — Office: 152 sq ft ÷ 4,250 sq ft/hr = 2.1 min", minutes: 152 * 60 / 4250 }]);
    expect(total).toBe(2);
  });

  it("fixed minutes per room: size doesn't matter", () => {
    const r = defaultRules();
    Object.assign(type(r, "exam-room"), { method: "fixed", fixedMin: 10 });
    expect(computeMinutes(r, room("Exam Room", 90)).lines[0].label).toBe("General Clean — Exam Room: 10 min");
    expect(computeMinutes(r, room("Exam Room", 900)).total).toBe(10);
  });

  it("both: fixed minutes + size", () => {
    const r = defaultRules();
    Object.assign(type(r, "exam-room"), { method: "both", fixedMin: 4 });
    const { lines, total } = computeMinutes(r, room("Exam Room", 161));
    expect(lines[0].label).toBe("General Clean — Exam Room: 4 min + 161 sq ft ÷ 2,150 sq ft/hr = 8.5 min");
    expect(total).toBe(Math.round(4 + 161 * 60 / 2150));
  });

  it("a hospital's rate goes in exactly as given, in its own unit", () => {
    const cases: [RateUnit, number, number, string][] = [
      ["sqftPerHour", 2000, 2000, "2,000 sq ft/hr"],
      ["sqftPerMin", 40, 2400, "40 sq ft/min"],
      ["minPer100", 3, 2000, "3 min per 100 sq ft"],
      ["minPer1000", 25, 2400, "25 min per 1,000 sq ft"]
    ];
    for (const [unit, typed, perHour, text] of cases) {
      expect(rateFromUnit(typed, unit)).toBeCloseTo(perHour);
      expect(rateInUnit(rateFromUnit(typed, unit), unit)).toBe(typed); // round trip: shown as typed
      const r = defaultRules();
      Object.assign(type(r, "exam-room"), { sqftPerHour: rateFromUnit(typed, unit), rateUnit: unit });
      expect(gcFormulaText(gcFormula(r, type(r, "exam-room")))).toContain(text);
    }
    const r = defaultRules();
    Object.assign(type(r, "exam-room"), { sqftPerHour: rateFromUnit(7, "minPer100"), rateUnit: "minPer100" });
    expect(computeMinutes(r, room("Exam Room", 200)).lines[0].label)
      .toBe("General Clean — Exam Room: 200 sq ft × 7 min per 100 sq ft = 14 min");
    expect(computeMinutes(r, room("Exam Room", 200)).total).toBe(14);
  });

  it("floor type never changes it, and there is no minimum per room", () => {
    const r = defaultRules();
    expect(computeMinutes(r, { ...room("Office", 850), floorType: "Carpet" }).total)
      .toBe(computeMinutes(r, room("Office", 850)).total);
    expect(computeMinutes(r, room("Office", 30)).total).toBe(0); // 30 ÷ 4,250/hr = 0.4 → 0, no 3-minute floor
    expect(computeMinutes(r, room("Office", 30)).lines[0].minutes).toBeCloseTo(30 * 60 / 4250);
  });

  it("every ISSA type prices at straight ISSA math", () => {
    const r = defaultRules();
    for (const [typeId, catId] of Object.entries(ISSA_TYPE_CATEGORY)) {
      const cat = issaCategory(catId)!;
      expect(computeMinutes(r, room(type(r, typeId).label, 1000)).total, typeId).toBe(Math.round(60000 / cat.sqftPerHour));
    }
  });

  it("Reset to ISSA puts an edited formula back", () => {
    const r = defaultRules();
    const rt = type(r, "restroom");
    Object.assign(rt, { method: "both", fixedMin: 5, sqftPerHour: 900, rateUnit: "sqftPerMin" });
    expect(issaSourceLabel(r, rt)).toBeNull();
    resetToIssa(r, rt);
    expect(gcFormula(r, rt)).toEqual({ method: "size", fixedMin: 0, sqftPerHour: 1000, rateUnit: "sqftPerHour" });
    resetToIssa(r, rt, "clinical"); // a different ISSA match
    expect(rt.sqftPerHour).toBe(2150);
  });

  it("generalCleanLine names a missing type and still prices it (ISSA General office)", () => {
    const g = generalCleanLine(defaultRules(), { roomType: "Mystery", squareFeet: 425 });
    expect(g.minutes).toBeCloseTo(6); // falls back to Office — "Mystery" maps there
    expect(gcMinutes({ method: "size", fixedMin: 0, sqftPerHour: 0, rateUnit: "sqftPerHour" }, 500)).toBe(0);
    expect(gcText("Room", { method: "fixed", fixedMin: 7.25, sqftPerHour: 0, rateUnit: "sqftPerHour" }, 1)).toBe("Room: 7.3 min");
  });
});

describe("Included in General Clean", () => {
  it("an included task adds no time, isn't required, and is flagged on a room that lists it", () => {
    const r = defaultRules();
    const sp = room("Office", 400, ["trash-pull", "high-dusting"]);
    expect(requiredTasks(r, sp)).toEqual(["high-dusting"]);
    expect(includedConflicts(r, sp)).toEqual(["trash-pull"]);
    expect(computeMinutes(r, sp).lines.map((l) => l.label.split(" — ")[0])).toEqual(["General Clean", "High Dusting"]);
    // a schedule subset naming it prices nothing for it either
    expect(computeMinutes(r, sp, { includeBase: false, tasks: ["trash-pull"] }).total).toBe(0);
  });

  it("untick it and it becomes an extra again", () => {
    const r = defaultRules();
    type(r, "office").includedTasks = ["damp-mop", "vacuum"];
    const sp = room("Office", 400, ["trash-pull"]);
    expect(requiredTasks(r, sp)).toEqual(["trash-pull"]);
    expect(computeMinutes(r, sp).total).toBe(Math.round(400 * 60 / 4250 + 2));
  });

  it("an included task is never an automatic extra", () => {
    const r = defaultRules();
    r.tasks.find((t) => t.id === "trash-pull")!.autoFor = ["office"];
    expect(autoTasksFor(r, "office")).toEqual([]);
    expect(includedTasksFor(r, "office")).toContain("trash-pull");
  });
});

/** a rulebook as saved before 2026-10-12: no formulas, the old qualifiers + floor rates */
function preFormulaSave(): Rules {
  const r = defaultRules();
  r.version = 1;
  r.roomTypes = r.roomTypes
    .filter((rt) => !["conference-room", "nurses-station", "break-room", "lab", "clean-utility"].includes(rt.id))
    .map((rt) => ({ id: rt.id, label: rt.label, frequency: rt.frequency, cleanability: rt.cleanability, builtIn: true,
      qualifierMin: rt.id === "patient-room" ? 6 : 0 } as RoomTypeRule));
  r.roomTypes.push({ id: "rt-sim", label: "Simulation Room", qualifierMin: 2, frequency: "5x / week" });
  return r;
}

describe("migrating saved rules", () => {
  it("ISSA where it applies, the old floor rate otherwise; a qualifier becomes the fixed part", () => {
    store.set(RULES_KEY, JSON.stringify(preFormulaSave()));
    const r = loadRules();
    expect(r.version).toBe(2);
    expect(type(r, "office")).toMatchObject({ method: "size", fixedMin: 0, sqftPerHour: 4250, issaCategory: "office" });
    expect(type(r, "patient-room")).toMatchObject({ method: "both", fixedMin: 6, sqftPerHour: 2150 });
    // a custom type with no ISSA match: the old 33 sq ft/min hard-floor rate, shown as typed
    expect(type(r, "rt-sim")).toMatchObject({ method: "both", fixedMin: 2, sqftPerHour: 33 * 60, rateUnit: "sqftPerMin" });
    expect(computeMinutes(r, room("Simulation Room", 330)).lines[0].label)
      .toBe("General Clean — Simulation Room: 2 min + 330 sq ft ÷ 33 sq ft/min = 12 min");
    for (const rt of r.roomTypes) {
      expect(rt.qualifierMin, rt.id).toBeUndefined();
      expect(rt.includedTasks, rt.id).toEqual(["trash-pull", "damp-mop", "vacuum"]);
    }
    expect(type(r, "conference-room").sqftPerHour).toBe(3500); // new built-ins arrive at ISSA
  });

  it("the old mop/vacuum toggles carry into the included list", () => {
    const saved = preFormulaSave();
    saved.general.mopIncluded = false;
    store.set(RULES_KEY, JSON.stringify(saved));
    expect(type(loadRules(), "office").includedTasks).toEqual(["trash-pull", "vacuum"]);
  });

  it("an unmigrated type prices the same as its migrated self", () => {
    const raw = preFormulaSave();
    const migrated = migrateRules(JSON.parse(JSON.stringify(raw)));
    for (const label of ["Patient Room", "Simulation Room", "Corridor"]) {
      expect(computeMinutes(raw, room(label, 420)).total).toBe(computeMinutes(migrated, room(label, 420)).total);
    }
  });

  it("formulas, units and included lists survive a save/load round trip", () => {
    const r = defaultRules();
    Object.assign(type(r, "exam-room"), { method: "both", fixedMin: 4, sqftPerHour: 2000, rateUnit: "minPer100" });
    type(r, "office").includedTasks = ["vacuum"];
    saveRules(r);
    const back = loadRules();
    expect(type(back, "exam-room")).toMatchObject({ method: "both", fixedMin: 4, sqftPerHour: 2000, rateUnit: "minPer100" });
    expect(type(back, "office").includedTasks).toEqual(["vacuum"]);
  });
});

describe("the 2026-10-12 operator workaround migrates cleanly", () => {
  /** what operator/issa-relabel.cjs left in the account */
  function workaround(): Rules {
    const r = preFormulaSave();
    const b = 5500 / 60;
    r.general.hardSqftPerMin = +b.toFixed(2);
    r.general.carpetSqftPerMin = +b.toFixed(2);
    for (const rt of r.roomTypes) rt.qualifierMin = 0;
    const cats: Record<string, [number, string[]]> = {
      "issa-office": [4250, ["office", "storage"]],
      "issa-elevator": [600, ["elevator"]],
      "issa-restroom": [1000, ["restroom"]],
      "issa-breakroom": [3150, ["lounge"]],
      "issa-clinical": [2150, ["exam-room", "emergency-room", "patient-room", "procedure-room",
        "operating-room", "utility-room", "rt-sim"]],
      "issa-locker": [1850, ["locker-room"]]
    };
    for (const [id, [sfh, autoFor]] of Object.entries(cats)) {
      const addon = 1 / (1 / (sfh / 60) - 1 / b);
      r.tasks.push({ id, label: "ISSA: " + id, sqftPerMin: +addon.toFixed(2), flatMin: 0, addable: true, autoFor });
    }
    return r;
  }

  it("each type lands on its category's rate, the helpers and their base are gone", () => {
    store.set(RULES_KEY, JSON.stringify(workaround()));
    const r = loadRules();
    expect(r.tasks.some((t) => t.id.startsWith("issa-"))).toBe(false);
    expect(r.tasks.length).toBe(defaultRules().tasks.length);
    expect(r.general.hardSqftPerMin).toBe(33);
    expect(type(r, "rt-sim")).toMatchObject({ method: "size", sqftPerHour: 2150, issaCategory: "clinical" }); // from its helper
    expect(type(r, "corridor")).toMatchObject({ method: "size", sqftPerHour: 5500 });
  });

  it("every cleanable room prices as the workaround did, to rounding", () => {
    const before = workaround();
    store.set(RULES_KEY, JSON.stringify(before));
    const after = loadRules();
    // the old engine: base 91.67 sq ft/min (floor formula) + helper task + 3-min minimum
    const oldTotal = (typeId: string, sqft: number) => {
      const helpers = before.tasks.filter((t) => t.autoFor.includes(typeId) && t.id.startsWith("issa-"));
      const raw = sqft / before.general.hardSqftPerMin + helpers.reduce((s, t) => s + sqft / t.sqftPerMin!, 0);
      return Math.max(3, Math.round(raw));
    };
    for (const rt of before.roomTypes) {
      if (rt.cleanability === "non-cleanable") continue;
      for (const sqft of [400, 2500]) {
        const now = computeMinutes(after, room(rt.label, sqft)).total;
        expect(Math.abs(now - oldTotal(rt.id, sqft)), `${rt.id} @ ${sqft}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("rooms and schedule coverage lose the helper ids on load", async () => {
    const { loadClassic } = await import("./classicStore");
    store.set("opsmatrix_v7", JSON.stringify({
      spaces: [{ id: "a", roomType: "Patient Room", spaceTasks: ["issa-clinical", "high-dusting"] }],
      schedules: [{ id: "s", spaceOrder: ["a"], roomTasks: { a: ["general-cleaning", "wet-mop", "issa-clinical"] } }]
    }));
    const d = loadClassic();
    expect(d.v7.spaces![0].spaceTasks).toEqual(["high-dusting"]);
    expect(d.v7.schedules![0].roomTasks).toEqual({ a: ["general-cleaning", "wet-mop"] });
  });

  it("is idempotent", () => {
    const once = migrateRules(workaround());
    expect(migrateRules(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });
});

describe("room types renamed, duplicated, cleaned", () => {
  it("renaming a type takes its rooms along", async () => {
    const { renameRoomTypes } = await import("./classicStore");
    const prev = defaultRules();
    const next = defaultRules();
    type(next, "exam-room").label = "Exam Room – Bariatric";
    const spaces = [{ id: "a", roomType: "Exam Room" }, { id: "b", roomType: "Office" }];
    expect(renameRoomTypes(spaces as never, prev, next)).toBe(1);
    expect(spaces.map((s) => s.roomType)).toEqual(["Exam Room – Bariatric", "Office"]);
  });

  it("stripIncludedTasks takes included tasks off rooms", async () => {
    const { stripIncludedTasks } = await import("./classicStore");
    const data = { v7: { spaces: [room("Office", 100, ["trash-pull", "high-dusting"]), room("Office", 100, ["high-dusting"])] }, plans: [], nonSpace: [] };
    expect(stripIncludedTasks(data as never, defaultRules())).toBe(1);
    expect(data.v7.spaces[0].spaceTasks).toEqual(["high-dusting"]);
  });

  it("a per-card save commits ONLY that type, a duplicate lands after its source", async () => {
    const { saveRoomType, roomTypeDirty } = await import("./scopeDraft");
    const saved = defaultRules();
    const draft: Rules = JSON.parse(JSON.stringify(saved));
    const at = draft.roomTypes.findIndex((x) => x.id === "exam-room");
    draft.roomTypes.splice(at + 1, 0, { ...JSON.parse(JSON.stringify(draft.roomTypes[at])), id: "rt-bari", label: "Exam Room – Bariatric", fixedMin: 5, method: "both", builtIn: undefined });
    draft.tasks.find((t) => t.id === "high-dusting")!.autoFor = ["rt-bari"];
    type(draft, "office").fixedMin = 99; // an unsaved edit elsewhere
    expect(roomTypeDirty(saved, draft, "rt-bari")).toBe(true);
    const next = saveRoomType(saved, draft, "rt-bari");
    expect(next.roomTypes[at + 1].id).toBe("rt-bari");
    expect(next.tasks.find((t) => t.id === "high-dusting")!.autoFor).toEqual(["rt-bari"]);
    expect(type(next, "office").fixedMin).toBe(0); // the office edit stayed a draft
    expect(roomTypeDirty(next, draft, "rt-bari")).toBe(false);
  });
});
