// Floor work follows the room's FLOOR type (Josh, 2026-10-12): Mopping on
// every hard-floor room, Vacuuming on every carpeted one, each at its ISSA
// 540 rate, automatically — the way room types already bring their tasks.
// Covers the floor trigger, floor-type switches, room-type re-apply, the
// manual-edit-wins rule, and loading accounts saved before the trigger.
import { describe, it, expect, beforeEach } from "vitest";
import {
  defaultRules, loadRules, saveRules, autoTasksFor, autoTasksForSpace, tasksAfterFloorChange, floorKind,
  taskSourceLabel, computeMinutes, RULES_KEY, type Rules
} from "./rules";
import { applyFloorType, applyRoomType, refreshAutoTasks, type ClassicSpace } from "./classicStore";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); }
  };
});

const CARPET = "Carpet";
const HARD = "Hard floor — finished";
const BARE = "Hard floor — unfinished";
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Josh's design: mop and vacuum come out of every type's General Clean, so they add their own time */
function joshRules(): Rules {
  const r = defaultRules();
  for (const rt of r.roomTypes) rt.includedTasks = ["trash-pull"];
  return r;
}
const room = (roomType: string, floorType: string, spaceTasks?: string[]): ClassicSpace =>
  ({ id: "r1", roomType, floorType, squareFeet: 412, spaceTasks });
const task = (r: Rules, id: string) => r.tasks.find((t) => t.id === id)!;

describe("built-in floor tasks", () => {
  it("ship at their ISSA 540 rates with the floor trigger, and name the source", () => {
    const r = defaultRules();
    expect(task(r, "damp-mop")).toMatchObject({ sqftPerMin: 68.67, autoForFloor: ["hard-finished", "hard-unfinished"], floorSkipTypes: ["corridor", "hallway"] });
    expect(task(r, "vacuum")).toMatchObject({ sqftPerMin: 47.62, autoForFloor: ["carpet"], floorSkipTypes: ["corridor", "hallway"] });
    expect(taskSourceLabel(task(r, "damp-mop"))).toMatch(/ISSA 540 #429.*4,120 sq ft\/hr/);
    expect(taskSourceLabel(task(r, "vacuum"))).toMatch(/ISSA 540 #280.*2,857 sq ft\/hr/);
    // an edited rate is the account's own number, not ISSA's
    task(r, "damp-mop").sqftPerMin = 50;
    expect(taskSourceLabel(task(r, "damp-mop"))).toBeNull();
  });

  it("stay inside General Clean on stock rules, so stock rooms are unchanged", () => {
    const r = defaultRules();
    expect(autoTasksFor(r, "office", HARD)).toEqual([]);
    expect(autoTasksFor(r, "office", CARPET)).toEqual([]);
    expect(autoTasksFor(r, "corridor", HARD)).toEqual(["auto-scrub", "dust-mop"]);
  });

  it("reads every floor label the app uses", () => {
    expect(floorKind(CARPET)).toBe("carpet");
    expect(floorKind(HARD)).toBe("hard-finished");
    expect(floorKind(BARE)).toBe("hard-unfinished");
    expect(floorKind("Unfinished Floors")).toBe("hard-unfinished");
    // unset reads as hard floor, as the room sidebar has always said
    expect(floorKind("")).toBe("hard-finished");
    expect(floorKind(undefined)).toBe("hard-finished");
  });
});

describe("the floor trigger (Josh's design: mop/vacuum out of General Clean)", () => {
  it("mops hard floors and vacuums carpet, on top of the room type's own tasks", () => {
    const r = joshRules();
    expect(autoTasksFor(r, "exam-room", HARD)).toEqual(["damp-mop"]);
    expect(autoTasksFor(r, "storage", BARE)).toEqual(["damp-mop"]);
    expect(autoTasksFor(r, "office", CARPET)).toEqual(["vacuum"]);
    // a room with no floor type yet prices as hard floor (and Max Space flags it)
    expect(autoTasksFor(r, "exam-room", "")).toEqual(["damp-mop"]);
  });

  it("skips corridors/hallways (the floor crew's) and non-cleanable rooms", () => {
    const r = joshRules();
    expect(autoTasksFor(r, "corridor", HARD)).toEqual(["auto-scrub", "dust-mop"]);
    expect(autoTasksFor(r, "hallway", CARPET)).toEqual(["auto-scrub", "dust-mop"]);
    expect(autoTasksFor(r, "mechanical-room", BARE)).toEqual([]);
    // Scope can take corridors off the skip list
    task(r, "damp-mop").floorSkipTypes = ["hallway"];
    expect(autoTasksFor(r, "corridor", HARD)).toEqual(["auto-scrub", "dust-mop", "damp-mop"]);
  });

  it("adds the floor task's own ISSA time to the room", () => {
    const r = joshRules();
    const sp = room("Exam Room", HARD);
    sp.spaceTasks = autoTasksForSpace(r, sp);
    const lines = computeMinutes(r, sp).lines;
    expect(lines.map((l) => l.label)).toEqual([expect.stringMatching(/^General Clean/), "Mopping — 1 min per 68.67 sq ft"]);
    expect(lines[1].minutes).toBeCloseTo(412 / 68.67, 6);
  });
});

describe("floor-type switch", () => {
  it("carpet → hard floor swaps Vacuuming for Mopping and re-times the room", () => {
    const r = joshRules();
    const sp = room("Office", CARPET, ["vacuum"]);
    applyFloorType(sp, HARD, r);
    expect(sp.floorType).toBe(HARD);
    expect(sp.spaceTasks).toEqual(["damp-mop"]);
    expect(sp.estimatedCleaningMinutes).toBe(computeMinutes(r, sp).total);
    applyFloorType(sp, CARPET, r);
    expect(sp.spaceTasks).toEqual(["vacuum"]);
  });

  it("keeps the room's other tasks, including ones a manager added by hand", () => {
    const r = joshRules();
    const sp = room("Office", CARPET, ["high-dusting", "vacuum", "trash-pull"]);
    applyFloorType(sp, HARD, r);
    expect(sp.spaceTasks).toEqual(["high-dusting", "trash-pull", "damp-mop"]);
  });

  it("never duplicates a task the room already lists", () => {
    const r = joshRules();
    const sp = room("Office", CARPET, ["vacuum", "damp-mop"]);
    applyFloorType(sp, HARD, r);
    expect(sp.spaceTasks).toEqual(["damp-mop"]);
  });

  it("normalizes the archive's floor labels on the way in", () => {
    const r = joshRules();
    const sp = room("Office", CARPET, ["vacuum"]);
    applyFloorType(sp, "Unfinished Floors", r);
    expect(sp.floorType).toBe(BARE);
    expect(sp.spaceTasks).toEqual(["damp-mop"]);
  });

  it("does nothing to corridors — their floors stay with the floor crew", () => {
    const r = joshRules();
    const sp = room("Corridor", HARD, ["auto-scrub", "dust-mop"]);
    applyFloorType(sp, CARPET, r);
    expect(sp.spaceTasks).toEqual(["auto-scrub", "dust-mop"]);
  });
});

describe("room type re-applied", () => {
  it("brings the type's tasks AND the floor's (it used to drop the floor task)", () => {
    const r = joshRules();
    const sp = room("Office", HARD, ["damp-mop", "high-dusting"]);
    applyRoomType(sp, "exam-room", r);
    expect(sp.roomType).toBe("Exam Room");
    expect(sp.spaceTasks).toEqual(["damp-mop"]);
    applyRoomType(sp, "corridor", r);
    expect(sp.spaceTasks).toEqual(["auto-scrub", "dust-mop"]);
    sp.floorType = CARPET;
    applyRoomType(sp, "office", r);
    expect(sp.spaceTasks).toEqual(["vacuum"]);
  });
});

describe("manual edit wins", () => {
  it("a Mopping a manager took off stays off when the floor changes between hard floors", () => {
    const r = joshRules();
    const sp = room("Storage", HARD, []);
    applyFloorType(sp, BARE, r);
    expect(sp.spaceTasks).toEqual([]);
  });

  it("a Mopping a manager took off stays off when Scope changes", () => {
    const prev = joshRules();
    const next = clone(prev);
    task(next, "vacuum").autoForFloor = ["carpet", "hard-finished"]; // any Scope edit to the floor rule
    const removed = room("Exam Room", HARD, []);                    // manager took Mopping off
    const following = room("Exam Room", HARD, ["damp-mop"]);       // still exactly what Scope gave it
    const changed = refreshAutoTasks([removed, following], prev, next);
    expect(changed).toBe(1);
    expect(removed.spaceTasks).toEqual([]);
    expect(following.spaceTasks).toEqual(["damp-mop", "vacuum"]);
  });

  it("rooms following the rulebook pick up a Scope change to the floor trigger", () => {
    const prev = joshRules();
    const next = clone(prev);
    task(next, "vacuum").autoForFloor = [];
    const office = room("Office", CARPET, ["vacuum"]);
    refreshAutoTasks([office], prev, next);
    expect(office.spaceTasks).toEqual([]);
  });

  it("unticking Mopping from a type's General Clean in Scope puts it on that type's hard-floor rooms", () => {
    const prev = defaultRules();
    const next = clone(prev);
    next.roomTypes.find((x) => x.id === "restroom")!.includedTasks = ["trash-pull", "vacuum"];
    const restroom = room("Restroom", HARD, []);
    const office = room("Office", HARD, []);
    refreshAutoTasks([restroom, office], prev, next);
    expect(restroom.spaceTasks).toEqual(["damp-mop"]);
    expect(office.spaceTasks).toEqual([]);
  });
});

describe("accounts saved before the floor trigger", () => {
  /** Josh's Fairview rulebook as the operator script left it (no floor trigger yet) */
  function savedFairview(): Rules {
    const r = joshRules();
    for (const t of r.tasks) { delete t.autoForFloor; delete t.floorSkipTypes; }
    Object.assign(task(r, "damp-mop"), { label: "Mop", sqftPerMin: 68.67 });
    Object.assign(task(r, "vacuum"), { label: "Vacuum", sqftPerMin: 47.62 });
    return r;
  }

  it("get the stock floor rule on load, and keep their own labels and rates", () => {
    saveRules(savedFairview());
    const r = loadRules();
    expect(task(r, "damp-mop")).toMatchObject({ label: "Mop", sqftPerMin: 68.67, autoForFloor: ["hard-finished", "hard-unfinished"], floorSkipTypes: ["corridor", "hallway"] });
    expect(task(r, "vacuum")).toMatchObject({ label: "Vacuum", sqftPerMin: 47.62, autoForFloor: ["carpet"] });
  });

  it("rooms the operator script set up already match — nothing moves, nothing duplicates", () => {
    saveRules(savedFairview());
    const r = loadRules();
    const rooms = [
      room("Exam Room", HARD, ["damp-mop"]),
      room("Office", CARPET, ["vacuum"]),
      room("Corridor", HARD, ["auto-scrub", "dust-mop"]),
      room("Mechanical Room", BARE, []),
      room("Shaft", BARE, [])
    ];
    const before = clone(rooms);
    for (const sp of rooms) expect(autoTasksForSpace(r, sp)).toEqual(sp.spaceTasks);
    expect(refreshAutoTasks(rooms, r, r)).toBe(0);
    for (const sp of rooms) applyFloorType(sp, String(sp.floorType), r); // same floor re-picked
    expect(rooms.map((sp) => sp.spaceTasks)).toEqual(before.map((sp) => sp.spaceTasks));
  });

  it("a floor rule the account cleared stays cleared", () => {
    const r0 = defaultRules();
    task(r0, "damp-mop").autoForFloor = [];
    saveRules(r0);
    expect(task(loadRules(), "damp-mop").autoForFloor).toEqual([]);
  });

  it("an untouched old stock rate moves to ISSA 540; an edited one stays", () => {
    const r0 = defaultRules();
    Object.assign(task(r0, "damp-mop"), { label: "Mopping", sqftPerMin: 60 });
    Object.assign(task(r0, "vacuum"), { label: "Vacuuming", sqftPerMin: 40 });
    localStorage.setItem(RULES_KEY, JSON.stringify(r0));
    const r = loadRules();
    expect(task(r, "damp-mop").sqftPerMin).toBe(68.67);
    expect(task(r, "vacuum").sqftPerMin).toBe(40);
  });
});

describe("tasksAfterFloorChange", () => {
  it("rooms with no stored list read their automatic tasks live", () => {
    const r = joshRules();
    expect(tasksAfterFloorChange(r, room("Office", CARPET), HARD)).toEqual(["damp-mop"]);
  });
});
