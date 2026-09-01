// Josh's 2026-08-31 floor-care rules: "does not need" sticks to the room,
// and dust mopping ↔ machine sweeping are the same pass — never both.
import { describe, it, expect } from "vitest";
import { defaultRules } from "./rules";
import { fcEligible, fcTasksForSpace, fcOfferable, FC_EXCLUSIVE } from "./floorcare";

const rules = defaultRules();
const corridor = { roomType: "Corridor", floorType: "Hard floor — finished", squareFeet: 900, spaceTasks: ["auto-scrub", "dust-mop"] };

describe("does not need", () => {
  it("a task marked not-needed disappears from the room's offers", () => {
    const room = { ...corridor, fcNotNeeded: ["dust-mop"] };
    expect(fcTasksForSpace(rules, room)).not.toContain("dust-mop");
    expect(fcTasksForSpace(rules, corridor)).toContain("dust-mop");
  });

  it("a room whose only floor-care work is all marked not-needed stops being eligible", () => {
    const room = { ...corridor, spaceTasks: ["dust-mop"], fcNotNeeded: ["dust-mop"] };
    expect(fcEligible(rules, room)).toBe(false);
    expect(fcEligible(rules, corridor)).toBe(true);
  });
});

describe("dust mop ↔ machine sweep exclusivity", () => {
  it("the pair is declared both ways", () => {
    expect(FC_EXCLUSIVE["dust-mop"]).toBe("machine-sweep");
    expect(FC_EXCLUSIVE["machine-sweep"]).toBe("dust-mop");
  });

  it("booking one eliminates the other from the room's offers", () => {
    expect(fcOfferable(rules, corridor, new Set())).toContain("machine-sweep");
    expect(fcOfferable(rules, corridor, new Set(["dust-mop"]))).not.toContain("machine-sweep");
    expect(fcOfferable(rules, corridor, new Set(["machine-sweep"]))).not.toContain("dust-mop");
    // an unrelated booked task eliminates nothing
    expect(fcOfferable(rules, corridor, new Set(["burnish"]))).toContain("dust-mop");
  });
});
