// The 2026-08-31 Scope rework: per-occurrence non-space tasks + qualifiers,
// deletable built-ins that STAY deleted, the retired Sanitation Route def,
// and the General Clean formula toggles.
import { describe, it, expect, beforeEach } from "vitest";
import {
  defaultRules, loadRules, saveRules, computeMinutes, nonSpaceOccurrenceMinutes,
  RULES_KEY, type Rules
} from "./rules";
import { nonSpaceTaskMinutes } from "./classicStore";

// loadRules/saveRules talk to localStorage — give the node test env one
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); }
  };
});

describe("non-space defs and qualifiers", () => {
  it("discharge prices per occurrence with travel time attached", () => {
    const r = defaultRules();
    const discharge = r.nonSpaceDefs.find((d) => d.id === "discharge")!;
    expect(discharge.minutes).toBe(40);
    expect(discharge.qualifierIds).toContain("travel-time");
    expect(nonSpaceOccurrenceMinutes(r, discharge)).toBe(45); // 40 + 5 travel
  });

  it("sanitation route is no longer a stock non-space task", () => {
    expect(defaultRules().nonSpaceDefs.some((d) => d.id === "sanitation-route")).toBe(false);
  });

  it("a saved stock Sanitation Route def is retired on load; a renamed one survives", () => {
    const r = defaultRules();
    r.nonSpaceDefs.push({ id: "sanitation-route", label: "Sanitation Route", defaultHours: 3, minutes: 180, qualifierIds: [], builtIn: true });
    localStorage.setItem(RULES_KEY, JSON.stringify(r));
    expect(loadRules().nonSpaceDefs.some((d) => d.id === "sanitation-route")).toBe(false);

    r.nonSpaceDefs[r.nonSpaceDefs.length - 1].label = "Biohazard Run"; // the manager made it theirs
    localStorage.setItem(RULES_KEY, JSON.stringify(r));
    expect(loadRules().nonSpaceDefs.some((d) => d.label === "Biohazard Run")).toBe(true);
  });

  it("legacy defs saved before minutes existed derive them from the hours block", () => {
    const r = defaultRules() as unknown as { nonSpaceDefs: Record<string, unknown>[] };
    r.nonSpaceDefs = [{ id: "custom-route", label: "Evening Route", defaultHours: 2 }];
    localStorage.setItem(RULES_KEY, JSON.stringify(r));
    const loaded = loadRules();
    const custom = loaded.nonSpaceDefs.find((d) => d.id === "custom-route")!;
    expect(custom.minutes).toBe(120);
    expect(custom.qualifierIds).toEqual([]);
  });

  it("counted schedule entries multiply out; legacy entries keep their hour block", () => {
    expect(nonSpaceTaskMinutes({ id: "a", name: "Discharges", hours: 0, scheduleId: "s", roomIds: [], count: 5, minutesPer: 45 })).toBe(225);
    expect(nonSpaceTaskMinutes({ id: "b", name: "Old Route", hours: 2, scheduleId: "s", roomIds: [] })).toBe(120);
  });
});

describe("deleted built-ins stay deleted", () => {
  it("a built-in task deleted in Scope does not resurrect on the next load", () => {
    const r = defaultRules();
    r.tasks = r.tasks.filter((t) => t.id !== "machine-sweep");
    saveRules(r);
    expect(loadRules().tasks.some((t) => t.id === "machine-sweep")).toBe(false);
  });

  it("but a built-in the account never touched is still guaranteed to exist", () => {
    const r = defaultRules();
    saveRules(r);
    expect(loadRules().tasks.some((t) => t.id === "damp-mop")).toBe(true);
  });

  it("deleting the travel-time qualifier sticks too", () => {
    const r = defaultRules();
    r.nonSpaceQualifiers = [];
    for (const d of r.nonSpaceDefs) d.qualifierIds = [];
    saveRules(r);
    expect(loadRules().nonSpaceQualifiers).toEqual([]);
  });
});

describe("the General Clean formula toggles", () => {
  const room = { squareFeet: 330, roomType: "Office", floorType: "Hard floor — finished" };

  it("formulaOff drops the General Clean line", () => {
    const r: Rules = defaultRules();
    const withBase = computeMinutes(r, room).total;
    r.general.formulaOff = true;
    const without = computeMinutes(r, room);
    expect(without.lines.some((l) => l.label.startsWith("General Clean"))).toBe(false);
    expect(without.total).toBeLessThan(withBase);
  });

  it("floor type no longer changes General Clean (2026-10-12)", () => {
    const r: Rules = defaultRules();
    const hard = computeMinutes(r, room);
    const carpet = computeMinutes(r, { ...room, floorType: "Carpet" });
    expect(carpet.total).toBe(hard.total);
    expect(carpet.lines[0].label).toBe(hard.lines[0].label);
  });

  it("Mopping and Vacuuming are priced only where General Clean does not include them", () => {
    const r = defaultRules();
    // included by default: listed on the room, it adds nothing
    expect(computeMinutes(r, { ...room, spaceTasks: ["damp-mop"] }).lines.some((l) => l.label.startsWith("Mopping"))).toBe(false);
    r.roomTypes.find((rt) => rt.id === "office")!.includedTasks = ["trash-pull", "vacuum"];
    const mins = computeMinutes(r, { ...room, spaceTasks: ["damp-mop"] });
    expect(mins.lines.some((l) => l.label.startsWith("Mopping"))).toBe(true);
  });
});
