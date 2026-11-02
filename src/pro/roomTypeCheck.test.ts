import { describe, it, expect } from "vitest";
import { checkType, roomMinutes } from "./roomTypeCheck";
import { defaultRules } from "./rules";
import type { ClassicSpace } from "./classicStore";

const rules = defaultRules();
const room = (id: string, sqft: number, roomType = "Patient Room", extra: Partial<ClassicSpace> = {}): ClassicSpace =>
  ({ id, roomNumber: id, roomName: "", roomType, floorType: "Hard floor — finished", squareFeet: sqft, spaceTasks: [], ...extra });

describe("roomMinutes — one room's minutes, floor care told apart", () => {
  it("a patient room: the General Clean line only", () => {
    const m = roomMinutes(rules, room("a", 238));
    // 238 sq ft at ISSA clinical 2,150 sq ft/hr = 6.6 → 7
    expect(m).toMatchObject({ total: 7, cleaning: 7, floorCare: 0 });
    // the General Clean divided up: its baseline, then trash pull and mopping (its steps on a hard floor)
    expect(m.lines.map((l) => l.label.split(" — ")[0])).toEqual(["General Clean baseline", "Trash Pull", "Mopping"]);
    expect(m.lines[0].label).toMatch(/^General Clean baseline — Patient Room: 238 sq ft/);
  });

  it("a corridor: the clean plus the floor crew's scrubbing and dust mopping, kept apart", () => {
    const m = roomMinutes(rules, room("c", 1000, "Corridor", { spaceTasks: ["auto-scrub", "dust-mop"] }));
    // 1,000 at 5,500/hr = 10.9; scrub 1,000/200 = 5; dust mop 1,000/150 = 6.7
    expect(m.cleaning).toBe(11);
    expect(m.floorCare).toBe(12);
    expect(m.total).toBe(23);
    expect(m.lines.filter((l) => l.floorCare).map((l) => l.label.split(" — ")[0])).toEqual(["Machine Scrubbing", "Dust Mopping"]);
  });

  it("an extra counts toward the cleaning, not the floor care", () => {
    const m = roomMinutes(rules, room("h", 400, "Patient Room", { spaceTasks: ["high-dusting"] }));
    expect(m.cleaning).toBe(14); // 11.2 + 3.3 = 14.5 → 14
    expect(m.floorCare).toBe(0);
  });
});

describe("checkType — a room type's rooms side by side", () => {
  const typical = Array.from({ length: 10 }, (_, i) => room("p" + i, 230 + i * 2));

  it("sums up the rooms: sizes, minutes and the rate they imply", () => {
    const c = checkType(rules, typical, "patient-room");
    expect(c.rooms).toBe(10);
    expect(c.sqft).toEqual({ min: 230, median: 239, max: 248 });
    expect(c.minutes).toEqual({ min: 6, median: 7, max: 7 });
    expect(c.perHundred).toBe(2.9); // 7 min / 239 sq ft × 100
    expect(c.unusual).toEqual([]);
  });

  it("the 52-minute nurses station: a room 8× the typical size stands out, with the reason", () => {
    const rooms = [...Array.from({ length: 9 }, (_, i) => room("n" + i, 240 + i, "Nurses Station")), room("bay", 1879, "Nurses Station")];
    const c = checkType(rules, rooms, "nurses-station");
    expect(c.unusual).toHaveLength(1);
    expect(c.unusual[0]).toMatchObject({ id: "bay", sqft: 1879, minutes: 52 });
    expect(c.unusual[0].reasons[0]).toBe("1,879 sq ft — 8× the typical 245 sq ft"); // median of 240…248 + the bay = 244.5
  });

  it("a room with a task added by hand stands out by that task, and a tiny one by its size", () => {
    const rooms = [...typical, room("hd", 240, "Patient Room", { spaceTasks: ["high-dusting"] }), room("tiny", 40)];
    const c = checkType(rules, rooms, "patient-room");
    const hd = c.unusual.find((u) => u.id === "hd")!;
    expect(hd.reasons).toEqual(["+2 min: added by hand — High Dusting"]);
    const tiny = c.unusual.find((u) => u.id === "tiny")!;
    expect(tiny.reasons[0]).toMatch(/^40 sq ft — well under the typical 239 sq ft/);
  });

  it("a room missing one of the type's usual tasks says so", () => {
    const r = defaultRules();
    r.tasks.find((t) => t.id === "high-dusting")!.autoFor.push("exam-room");
    const rooms = [...Array.from({ length: 8 }, (_, i) => room("e" + i, 300, "Exam Room", { spaceTasks: ["high-dusting"] })), room("bare", 300, "Exam Room", { spaceTasks: [] })];
    const c = checkType(r, rooms, "exam-room");
    expect(c.unusual.map((u) => u.id)).toEqual(["bare"]);
    expect(c.unusual[0].reasons).toEqual(["-3 min: without the usual High Dusting"]); // 300/120 = 2.5 → 3
  });

  it("counts the floor crew's time separately and never calls it unusual", () => {
    const rooms = Array.from({ length: 8 }, (_, i) => room("c" + i, 500, "Corridor", { spaceTasks: ["auto-scrub", "dust-mop"] }));
    const c = checkType(rules, rooms, "corridor");
    expect(c.unusual).toEqual([]);
    expect(c.floorCareRooms).toBe(8);
    expect(c.floorCareMinutes).toBe(8 * 6); // 500/200 = 2.5 + 500/150 = 3.3 → 6 each
  });

  it("a type with no General Clean: its automatic tasks are the expected time, so nothing stands out", () => {
    const r = defaultRules();
    const corridor = r.roomTypes.find((t) => t.id === "corridor")!;
    corridor.method = "none"; corridor.includedTasks = [];
    r.tasks.find((t) => t.id === "high-dusting")!.autoFor.push("corridor");
    r.tasks.find((t) => t.id === "trash-pull")!.autoFor.push("corridor");
    const rooms = Array.from({ length: 10 }, (_, i) => room("c" + i, 400 + i * 20, "Corridor", { spaceTasks: ["auto-scrub", "dust-mop", "high-dusting", "trash-pull"] }));
    const c = checkType(r, rooms, "corridor");
    expect(c.unusual).toEqual([]);
    expect(c.minutes!.median).toBe(6); // 490/120 = 4.1 + 2 → 6
  });

  it("an unknown type or no rooms gives an empty check", () => {
    expect(checkType(rules, typical, "nope")).toMatchObject({ rooms: 0, sqft: null, unusual: [] });
    expect(checkType(rules, [], "patient-room").rooms).toBe(0);
  });
});
