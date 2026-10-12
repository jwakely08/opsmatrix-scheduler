// ISSA production rates as a built-in feature of the engine (Josh,
// 2026-10-12: "ISSA by default for everything" until a hospital's own
// per-room times arrive): per-room-type rates, flat per-room standards,
// saved-rules compatibility, and the clean-up of the operator workaround.
import { describe, it, expect, beforeEach } from "vitest";
import {
  defaultRules, loadRules, saveRules, computeMinutes, applyIssaStandards, needsIssaMigration,
  basePricing, rateSourceLabel, ISSA_CATEGORIES, ISSA_TYPE_CATEGORY, issaCategory, typeIdFromLabel,
  typeIdFromLabelStrict, RULES_KEY, type Rules
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
const room = (roomType: string, squareFeet = 1000, floorType = HARD) => ({ roomType, squareFeet, floorType, spaceTasks: [] });

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
  });

  it("maps EVERY built-in room type to a category, at that category's rate, with no qualifier", () => {
    const r = defaultRules();
    for (const rt of r.roomTypes) {
      const cat = issaCategory(ISSA_TYPE_CATEGORY[rt.id]);
      expect(cat, rt.id).toBeDefined();
      expect(rt.issaCategory).toBe(cat!.id);
      expect(rt.sqftPerHour).toBe(cat!.sqftPerHour);
      expect(rt.qualifierMin).toBe(0);
      expect(basePricing(rt)).toBe("rate");
    }
    expect(r.roomTypes.find((rt) => rt.id === "storage")!.issaCategory).toBe("office");
  });

  it("adds the new hospital types", () => {
    const r = defaultRules();
    const label = (id: string) => r.roomTypes.find((rt) => rt.id === id);
    expect(label("conference-room")).toMatchObject({ label: "Conference Room", frequency: "5x / week", issaCategory: "conference" });
    expect(label("nurses-station")).toMatchObject({ label: "Nurses Station", frequency: "7x / week", issaCategory: "clinical" });
    expect(label("break-room")).toMatchObject({ label: "Break Room / Kitchen", frequency: "7x / week", issaCategory: "break-room" });
    expect(label("lab")).toMatchObject({ label: "Laboratory", frequency: "7x / week", issaCategory: "lab" });
    expect(label("clean-utility")).toMatchObject({ label: "Clean Supply / Med Room", frequency: "7x / week", issaCategory: "clinical" });
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

describe("computeMinutes prices each type at its own rate", () => {
  it("every category, straight ISSA math, no helper tasks", () => {
    const r = defaultRules();
    expect(r.tasks.some((t) => t.id.startsWith("issa-"))).toBe(false);
    for (const [typeId, catId] of Object.entries(ISSA_TYPE_CATEGORY)) {
      const rt = r.roomTypes.find((x) => x.id === typeId)!;
      const cat = issaCategory(catId)!;
      const sqft = 1000;
      const mins = computeMinutes(r, { ...room(rt.label, sqft), spaceTasks: [] });
      expect(mins.total, typeId).toBe(Math.max(r.general.minMinutes, Math.round(sqft * 60 / cat.sqftPerHour)));
    }
  });

  it("labels the line with the per-minute rate and its ISSA source", () => {
    const { lines } = computeMinutes(defaultRules(), room("Patient Room", 400));
    expect(lines[0].label).toBe("General cleaning — 1 min per 35.8 sq ft (ISSA Medical / clinical)");
    expect(lines[0].minutes).toBeCloseTo(400 * 60 / 2150);
    expect(lines).toHaveLength(1); // ISSA rates are all-in: no qualifier line
  });

  it("ignores the floor type — an ISSA rate covers the whole clean", () => {
    const r = defaultRules();
    expect(computeMinutes(r, room("Office", 850, "Carpet")).total)
      .toBe(computeMinutes(r, room("Office", 850, HARD)).total);
  });

  it("a changed rate stops claiming to be ISSA", () => {
    const r = defaultRules();
    const rt = r.roomTypes.find((x) => x.id === "restroom")!;
    rt.sqftPerHour = 900;
    expect(rateSourceLabel(rt)).toBe("your rate");
    expect(computeMinutes(r, room("Restroom", 90)).lines[0].label).toBe("General cleaning — 1 min per 15 sq ft (your rate)");
    expect(computeMinutes(r, room("Restroom", 90)).total).toBe(6);
  });

  it("the qualifier still rides on top as an optional flat add-on", () => {
    const r = defaultRules();
    r.roomTypes.find((x) => x.id === "operating-room")!.qualifierMin = 25;
    const { lines, total } = computeMinutes(r, room("Operating Room", 600));
    expect(lines.map((l) => l.label)).toContain("Operating Room qualifier");
    expect(total).toBe(Math.round(600 * 60 / 2150 + 25));
  });

  it("flat minutes per clean — a hospital's own per-room standard — beat any rate", () => {
    const r = defaultRules();
    r.roomTypes.find((x) => x.id === "operating-room")!.flatMinutes = 45;
    const small = computeMinutes(r, room("Operating Room", 300));
    const big = computeMinutes(r, room("Operating Room", 900));
    expect(small.total).toBe(45);
    expect(big.total).toBe(45);
    expect(small.lines[0].label).toBe("General cleaning — 45 min per clean (Operating Room standard)");
  });

  it("tasks still add on top of the type's rate", () => {
    const r = defaultRules();
    // corridor: 1000 at 5,500/hr = 10.9 + machine scrubbing 1000/200 = 5
    expect(computeMinutes(r, { ...room("Corridor"), spaceTasks: ["auto-scrub"] }).total).toBe(16);
  });

  it("a type without a rate falls back to the floor formula", () => {
    const r = defaultRules();
    r.roomTypes.push({ id: "rt-x", label: "Simulation Room", qualifierMin: 2, frequency: "5x / week" });
    const { lines, total } = computeMinutes(r, room("Simulation Room", 330));
    expect(lines[0].label).toBe("General cleaning — 1 min per 33 sq ft (hard floor, mopping included)");
    expect(total).toBe(12); // 330/33 + 2
  });

  it("formulaOff still drops the base clean entirely", () => {
    const r = defaultRules();
    r.general.formulaOff = true;
    expect(computeMinutes(r, { ...room("Corridor"), spaceTasks: ["auto-scrub"] }).lines.map((l) => l.label))
      .toEqual(["Machine Scrubbing — 1 min per 200 sq ft"]);
  });
});

describe("saved rules stay backward compatible", () => {
  /** a rulebook as saved before 2026-10-12: no rates, the old qualifiers */
  function preIssaSave(): Rules {
    const r = defaultRules();
    r.roomTypes = r.roomTypes
      .filter((rt) => !["conference-room", "nurses-station", "break-room", "lab", "clean-utility"].includes(rt.id))
      .map(({ issaCategory: _c, sqftPerHour: _s, ...rest }) => ({ ...rest, qualifierMin: rest.id === "patient-room" ? 6 : 0 }));
    return r;
  }

  it("a saved type keeps pricing exactly as before; the new built-ins arrive at ISSA", () => {
    store.set(RULES_KEY, JSON.stringify(preIssaSave()));
    const r = loadRules();
    expect(basePricing(r.roomTypes.find((rt) => rt.id === "patient-room"))).toBe("formula");
    expect(computeMinutes(r, room("Patient Room", 400)).total).toBe(18); // 400/33 + 6, as always
    const conf = r.roomTypes.find((rt) => rt.id === "conference-room")!;
    expect(conf.sqftPerHour).toBe(3500);
    expect(needsIssaMigration(r)).toEqual({ helperTasks: 0, formulaTypes: 23 });
  });

  it("rates and flat minutes survive a save/load round trip", () => {
    const r = defaultRules();
    r.roomTypes.find((rt) => rt.id === "restroom")!.sqftPerHour = 900;
    r.roomTypes.find((rt) => rt.id === "operating-room")!.flatMinutes = 45;
    saveRules(r);
    const back = loadRules();
    expect(back.roomTypes.find((rt) => rt.id === "restroom")!.sqftPerHour).toBe(900);
    expect(back.roomTypes.find((rt) => rt.id === "operating-room")!.flatMinutes).toBe(45);
  });

  it("applyIssaStandards moves a pre-ISSA account onto the rates", () => {
    store.set(RULES_KEY, JSON.stringify(preIssaSave()));
    const next = applyIssaStandards(loadRules());
    expect(needsIssaMigration(next)).toEqual({ helperTasks: 0, formulaTypes: 0 });
    expect(computeMinutes(next, room("Patient Room", 400)).total).toBe(11); // 400 at 2,150/hr
    expect(next.general.hardSqftPerMin).toBe(33); // untouched — no workaround to undo
  });
});

describe("the 2026-10-12 operator workaround migrates cleanly", () => {
  /** what operator/issa-relabel.cjs left in the account */
  function workaround(): Rules {
    const r = defaultRules();
    const b = 5500 / 60;
    r.general.hardSqftPerMin = +b.toFixed(2);
    r.general.carpetSqftPerMin = +b.toFixed(2);
    r.roomTypes = r.roomTypes.map(({ issaCategory: _c, sqftPerHour: _s, ...rest }) => ({ ...rest, qualifierMin: 0 }));
    r.roomTypes.push({ id: "rt-sim", label: "Simulation Room", qualifierMin: 0, frequency: "5x / week" });
    const cats: Record<string, [number, string[]]> = {
      "issa-office": [4250, ["office", "storage"]],
      "issa-conference": [3500, ["conference-room"]],
      "issa-elevator": [600, ["elevator"]],
      "issa-restroom": [1000, ["restroom"]],
      "issa-breakroom": [3150, ["lounge", "break-room"]],
      "issa-clinical": [2150, ["exam-room", "emergency-room", "patient-room", "procedure-room",
        "operating-room", "utility-room", "nurses-station", "clean-utility", "rt-sim"]],
      "issa-lab": [1850, ["lab"]],
      "issa-locker": [1850, ["locker-room"]]
    };
    for (const [id, [sfh, autoFor]] of Object.entries(cats)) {
      const addon = 1 / (1 / (sfh / 60) - 1 / b);
      r.tasks.push({ id, label: "ISSA: " + id, sqftPerMin: +addon.toFixed(2), flatMin: 0, addable: true, autoFor });
    }
    return r;
  }

  it("detects the helper tasks", () => {
    expect(needsIssaMigration(workaround()).helperTasks).toBe(8);
  });

  it("removes the helpers, restores the floor formula, and prices every cleanable room the same", () => {
    const before = workaround();
    const after = applyIssaStandards(before);
    expect(after.tasks.some((t) => t.id.startsWith("issa-"))).toBe(false);
    expect(after.tasks.length).toBe(defaultRules().tasks.length);
    expect(after.general.hardSqftPerMin).toBe(33);
    expect(after.general.carpetSqftPerMin).toBe(40);
    expect(after.roomTypes.find((rt) => rt.id === "rt-sim")!.issaCategory).toBe("clinical"); // from its helper
    for (const rt of before.roomTypes) {
      if (rt.cleanability === "non-cleanable") continue;
      for (const sqft of [80, 400, 2500]) {
        const auto = (r: Rules) => r.tasks.filter((t) => t.autoFor.includes(rt.id)).map((t) => t.id);
        const was = computeMinutes(before, { ...room(rt.label, sqft), spaceTasks: auto(before) }).total;
        const now = computeMinutes(after, { ...room(rt.label, sqft), spaceTasks: auto(after) }).total;
        expect(Math.abs(now - was), `${rt.id} @ ${sqft}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("strips the helper ids from hand-customized rooms and schedule coverage", async () => {
    const { stripIssaHelperTasks } = await import("./classicStore");
    const data = {
      v7: {
        spaces: [
          { id: "a", spaceTasks: ["issa-clinical", "high-dusting"] },
          { id: "b", spaceTasks: ["auto-scrub"] }
        ],
        schedules: [{ id: "s", roomTasks: { a: ["general-cleaning", "wet-mop", "issa-clinical"], b: ["floor-scrub"] } }]
      },
      plans: [], nonSpace: []
    };
    expect(stripIssaHelperTasks(data as never)).toBe(2);
    expect(data.v7.spaces[0].spaceTasks).toEqual(["high-dusting"]);
    expect(data.v7.spaces[1].spaceTasks).toEqual(["auto-scrub"]);
    expect(data.v7.schedules[0].roomTasks).toEqual({ a: ["general-cleaning", "wet-mop"], b: ["floor-scrub"] });
  });

  it("is idempotent", () => {
    const once = applyIssaStandards(workaround());
    expect(applyIssaStandards(once)).toEqual(once);
  });

  it("does not mutate its input", () => {
    const before = workaround();
    const snap = JSON.stringify(before);
    applyIssaStandards(before);
    expect(JSON.stringify(before)).toBe(snap);
  });
});

it("ISSA_CATEGORIES ids are unique", () => {
  expect(new Set(ISSA_CATEGORIES.map((c) => c.id)).size).toBe(ISSA_CATEGORIES.length);
});
