// Scope's per-section saves: each Save commits ONLY its own section, and
// floor-care work never boards a Max Schedules schedule.
import { describe, it, expect } from "vitest";
import { sectionDirty, saveSection } from "./scopeDraft";
import { defaultRules, splitRequiredTasks, isFloorCareTask, type Rules } from "./rules";

const clone = (r: Rules): Rules => JSON.parse(JSON.stringify(r));

describe("per-section save isolation", () => {
  it("saving the formula never carries unsaved edits from other sections", () => {
    const saved = defaultRules();
    const draft = clone(saved);
    draft.general.hardSqftPerMin = 25;                       // formula edit
    draft.roomTypes = draft.roomTypes.filter((r) => r.id !== "office"); // UNSAVED
    draft.tasks = draft.tasks.filter((t) => t.id !== "trash-pull");     // UNSAVED

    expect(sectionDirty(saved, draft, "general")).toBe(true);
    const next = saveSection(saved, draft, "general");
    expect(next.general.hardSqftPerMin).toBe(25);
    expect(next.roomTypes.some((r) => r.id === "office")).toBe(true);   // untouched
    expect(next.tasks.some((t) => t.id === "trash-pull")).toBe(true);   // untouched
    expect(sectionDirty(next, draft, "general")).toBe(false);           // shows Saved
    expect(sectionDirty(next, draft, "roomTypes")).toBe(true);          // still dirty
  });

  it("Room types owns the automatic-task chips (autoFor), Space tasks owns the rates", () => {
    const saved = defaultRules();
    const draft = clone(saved);
    // room-type section edit: burnishing becomes automatic for corridors
    draft.tasks.find((t) => t.id === "burnish")!.autoFor.push("corridor");
    // space-task section edit: change a rate
    draft.tasks.find((t) => t.id === "high-dusting")!.sqftPerMin = 99;

    const afterTypes = saveSection(saved, draft, "roomTypes");
    expect(afterTypes.tasks.find((t) => t.id === "burnish")!.autoFor).toContain("corridor");
    expect(afterTypes.tasks.find((t) => t.id === "high-dusting")!.sqftPerMin).toBe(120); // rate NOT saved

    const afterTasks = saveSection(saved, draft, "tasks");
    expect(afterTasks.tasks.find((t) => t.id === "high-dusting")!.sqftPerMin).toBe(99);
    expect(afterTasks.tasks.find((t) => t.id === "burnish")!.autoFor).not.toContain("corridor"); // chips NOT saved
  });

  it("built-ins are deletable now — room types and tasks alike", () => {
    const saved = defaultRules();
    const draft = clone(saved);
    draft.roomTypes = draft.roomTypes.filter((r) => r.id !== "operating-room"); // built-in
    draft.tasks = draft.tasks.filter((t) => t.id !== "burnish");                // built-in
    const next = saveSection(saveSection(saved, draft, "roomTypes"), draft, "tasks");
    expect(next.roomTypes.some((r) => r.id === "operating-room")).toBe(false);
    expect(next.tasks.some((t) => t.id === "burnish")).toBe(false);
  });

  it("breaks and non-space sections slice cleanly too", () => {
    const saved = defaultRules();
    const draft = clone(saved);
    draft.breaks = [];
    draft.nonSpaceDefs.push({ id: "x", label: "Evening Route", defaultHours: 3, minutes: 180, qualifierIds: [] });
    const nsOnly = saveSection(saved, draft, "nonSpace");
    expect(nsOnly.nonSpaceDefs.some((n) => n.label === "Evening Route")).toBe(true);
    expect((nsOnly.breaks ?? []).length).toBe((saved.breaks ?? []).length); // breaks untouched
    const brOnly = saveSection(saved, draft, "breaks");
    expect((brOnly.breaks ?? []).length).toBe(0);
  });
});

describe("floor-care scheduling split", () => {
  const rules = defaultRules();
  it("the five floor-care tasks are Max Floor Care's alone", () => {
    for (const id of ["auto-scrub", "dust-mop", "burnish", "machine-sweep", "machine-carpet"]) {
      expect(isFloorCareTask(rules, id), id).toBe(true);
    }
    expect(isFloorCareTask(rules, "high-dusting")).toBe(false);
    expect(isFloorCareTask(rules, "trash-pull")).toBe(false);
  });

  it("splitRequiredTasks separates a corridor's crews", () => {
    const corridor = { roomType: "Corridor", spaceTasks: ["auto-scrub", "dust-mop", "trash-pull", "high-dusting"] };
    const { cleaning, floorCare } = splitRequiredTasks(rules, corridor);
    expect(cleaning.sort()).toEqual(["high-dusting", "trash-pull"]);
    expect(floorCare.sort()).toEqual(["auto-scrub", "dust-mop"]);
  });

  it("a custom task flagged floor-care in Scope moves crews", () => {
    const r = clone(rules);
    r.tasks.push({ id: "scrub-deck", label: "Deck Scrub", sqftPerMin: 100, flatMin: 0, autoFor: [], addable: true, floorCare: true });
    const { cleaning, floorCare } = splitRequiredTasks(r, { roomType: "Office", spaceTasks: ["scrub-deck", "trash-pull"] });
    expect(floorCare).toEqual(["scrub-deck"]);
    expect(cleaning).toEqual(["trash-pull"]);
  });
});
