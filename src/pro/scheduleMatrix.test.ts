import { describe, it, expect } from "vitest";
import {
  loadBand, shiftKey, sortItems, summarize, rebalanceHint, loadPct, type MatrixItem
} from "./scheduleMatrix";

const item = (id: string, num: string, shift: MatrixItem["shift"], minutes: number, rooms: MatrixItem["rooms"] = [], extra: Partial<MatrixItem> = {}): MatrixItem =>
  ({ id, num, name: "S" + num, shift, minutes, target: 480, rooms, ...extra });

describe("load bands — blue to green to red", () => {
  it("puts the edges where Josh drew them", () => {
    expect(loadBand(79).id).toBe("way-under");
    expect(loadBand(80).id).toBe("under");
    expect(loadBand(94).id).toBe("under");
    expect(loadBand(95).id).toBe("on");
    expect(loadBand(105).id).toBe("on");
    expect(loadBand(106).id).toBe("heavy");
    expect(loadBand(115).id).toBe("heavy");
    expect(loadBand(116).id).toBe("way-over");
  });
  it("treats nonsense as way under, never crashes", () => {
    expect(loadBand(NaN).id).toBe("way-under");
    expect(loadBand(0).id).toBe("way-under");
  });
  it("uses the schedule's own target", () => {
    expect(loadPct({ minutes: 480, target: 480 })).toBe(100);
    expect(loadPct({ minutes: 240, target: 0 })).toBe(0);
  });
});

describe("shift reading", () => {
  it("reads the app's own labels and loose spellings", () => {
    expect(shiftKey("1st Shift")).toBe("1st");
    expect(shiftKey("2nd Shift")).toBe("2nd");
    expect(shiftKey("3rd Shift")).toBe("3rd");
    expect(shiftKey("Split Shift")).toBe("split");
    expect(shiftKey("Days")).toBe("1st");
    expect(shiftKey("nights")).toBe("3rd");
    expect(shiftKey("")).toBe("other");
    expect(shiftKey(undefined)).toBe("other");
  });
});

describe("sorting", () => {
  const xs = [item("a", "110", "2nd", 300), item("b", "101", "3rd", 520), item("c", "102", "1st", 480), item("d", "P01", "1st", 100)];
  it("by number is numeric, not alphabetic, with named schedules last", () => {
    expect(sortItems(xs, "num").map((x) => x.num)).toEqual(["101", "102", "110", "P01"]);
  });
  it("by load puts the heaviest first", () => {
    expect(sortItems(xs, "load").map((x) => x.num)).toEqual(["101", "102", "110", "P01"]);
  });
  it("by shift groups 1st → 2nd → 3rd", () => {
    expect(sortItems(xs, "shift").map((x) => x.num)).toEqual(["102", "P01", "110", "101"]);
  });
});

describe("summary", () => {
  it("counts bands and FTE from productive minutes", () => {
    const s = summarize([item("a", "1", "1st", 480), item("b", "2", "1st", 300), item("c", "3", "1st", 600)], 420);
    expect(s).toMatchObject({ count: 3, totalMinutes: 1380, on: 1, under: 1, over: 1, fte: 3.3 });
  });
  it("handles an empty site", () => {
    expect(summarize([], 420)).toMatchObject({ count: 0, fte: 0, avgPct: 0 });
  });
});

describe("rebalance hints", () => {
  const heavy = item("h", "101", "1st", 560, [
    { id: "r1", label: "PT 401", minutes: 20 },
    { id: "r2", label: "PT 402", minutes: 70 },
    { id: "r3", label: "RR 4W", minutes: 12 }
  ]);
  const light = item("l", "102", "1st", 380, [{ id: "r9", label: "OFF 1", minutes: 15 }]);
  const otherShift = item("n", "201", "3rd", 100);

  it("over → names its own room that fits, to the lightest SAME-shift schedule", () => {
    // excess 80, light has 100 of room → best fit ≤ 80 is PT 402 (70)
    expect(rebalanceHint(heavy, [heavy, light, otherShift]))
      .toBe("Move PT 402 (70 min) to Schedule 102 (79%) — both land closer to target.");
  });
  it("under → names the heavy partner's room to take", () => {
    // room 100, heavy excess 80 → best fit ≤ 80 is PT 402
    expect(rebalanceHint(light, [heavy, light]))
      .toBe("Take PT 402 (70 min) from Schedule 101 (117%) to even out the shift.");
  });
  it("never crosses shifts", () => {
    expect(rebalanceHint(heavy, [heavy, otherShift])).toMatch(/Every other 1st Shift schedule is full/);
  });
  it("on target says so", () => {
    expect(rebalanceHint(item("o", "103", "1st", 480), [heavy, light])).toBe("Balanced — no change needed.");
  });
  it("engine-built schedules point back to their engine", () => {
    const fc = item("f", "FC1", "1st", 700, [], { lockedTo: "Max Floor Care" });
    expect(rebalanceHint(fc, [fc, light])).toBe("Built in Max Floor Care — rebalance it there.");
    // and are never offered as a partner
    expect(rebalanceHint(light, [fc, light])).toBe("Room for about 100 more minutes of work.");
  });
});
