import { describe, expect, it } from "vitest";
import { cloneInto, restoreRoom, snapshotRoom, DEFAULT_CLONE_FIELDS } from "./cloneRoom";
import { computeMinutes, defaultRules } from "./rules";
import type { ClassicSpace } from "./classicStore";

const rules = defaultRules();
const source = (): ClassicSpace => ({
  id: "src", roomNumber: "FV4-297", roomName: "POST PARTUM #1", squareFeet: 244, building: "Fairview", floor: "4",
  roomType: "Patient Room", floorType: "Carpet", fixtureCount: 2, department: "4 East", priority: "High",
  cleanability: "Cleanable", spaceTasks: ["high-dusting"], notes: "isolation cart outside", vacuumDaysPerWeek: 3
});
const target = (): ClassicSpace => ({
  id: "t", roomNumber: "FV4-298", roomName: "POST PARTUM #2", squareFeet: 230, building: "Fairview", floor: "4",
  roomType: "Other", floorType: "", fixtureCount: 0, department: "", spaceTasks: []
});

describe("cloneInto — one room's details onto the next", () => {
  it("copies what's ticked, the whole way, and recalculates the minutes", () => {
    const t = target();
    cloneInto(t, source(), DEFAULT_CLONE_FIELDS, rules);
    expect(t).toMatchObject({ roomType: "Patient Room", floorType: "Carpet", fixtureCount: 2, vacuumDaysPerWeek: 3 });
    expect(t.estimatedCleaningMinutes).toBe(computeMinutes(rules, t).total);
    // what isn't ticked stays the room's own
    expect(t.department).toBe("");
    expect(t.notes).toBeUndefined();
  });

  it("never touches the room's number, name or square feet", () => {
    const t = target();
    cloneInto(t, source(), ["roomType", "floorType", "fixtureCount", "department", "priority", "cleanability", "spaceTasks", "notes"], rules);
    expect(t).toMatchObject({ roomNumber: "FV4-298", roomName: "POST PARTUM #2", squareFeet: 230 });
    expect(t).toMatchObject({ department: "4 East", priority: "High", cleanability: "Cleanable", notes: "isolation cart outside" });
  });

  it("tasks copied on purpose win over the room type's automatic ones", () => {
    const t = target();
    cloneInto(t, source(), ["roomType", "spaceTasks"], rules);
    expect(t.spaceTasks).toEqual(["high-dusting"]);
  });

  it("undo puts the room back exactly as it was", () => {
    const t = target();
    const before = snapshotRoom(t);
    const snap = JSON.stringify(t);
    cloneInto(t, source(), ["roomType", "floorType", "fixtureCount", "priority", "notes"], rules);
    expect(JSON.stringify(t)).not.toBe(snap);
    restoreRoom(t, before);
    expect(JSON.stringify(t)).toBe(snap);
  });
});
