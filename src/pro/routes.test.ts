// Max Sanitation + Max Policing (Josh's spec, 2026-08-31).
import { describe, it, expect } from "vitest";
import { defaultRules } from "./rules";
import {
  sanTiming, isSoiledUtility, isPoliceable, policeTasks, policeStopMinutes,
  shipSanitation, shipPolicing, unshipRoute,
  DOCK, SAN_FT_PER_MIN, SAN_PICKUP_MINUTES, SAN_UNLOAD_MINUTES,
  type SanRoute, type PoliceRoute
} from "./routes";
import { scheduleMinutes, coverageForSpace, type ClassicData, type ClassicSpace } from "./classicStore";
import { buildScheduleDoc } from "./scheduleDoc";

const rules = defaultRules();

/** a square room of 100x100 px centred on (cx, cy) */
const room = (id: string, cx: number, cy: number, extra: Partial<ClassicSpace> = {}): ClassicSpace => ({
  id, roomNumber: id.toUpperCase(), roomName: "Soiled Utility", roomType: "Utility Room",
  squareFeet: 120, floorType: "Hard floor — finished", visualPlanId: "plan1",
  visualPts: [
    { x: cx - 50, y: cy - 50 }, { x: cx + 50, y: cy - 50 },
    { x: cx + 50, y: cy + 50 }, { x: cx - 50, y: cy + 50 }
  ],
  ...extra
});

// 2 px per foot: a 500 px hop is 250 ft, i.e. exactly one minute of walking
const plan = { id: "plan1", building: "Main", floor: "1", img: "", w: 4000, h: 4000, ratio: 2 };

const dataWith = (spaces: ClassicSpace[]): ClassicData => ({
  v7: { spaces, schedules: [] }, plans: [plan], nonSpace: []
});

describe("who Max Sanitation lets you click", () => {
  it("takes soiled utility rooms by name or type, and nothing else", () => {
    expect(isSoiledUtility({ roomName: "Soiled Utility", roomType: "Utility Room" })).toBe(true);
    expect(isSoiledUtility({ roomName: "Soiled Holding", roomType: "Storage" })).toBe(true);
    expect(isSoiledUtility({ roomName: "Clean Utility", roomType: "Utility Room" })).toBe(false);
    expect(isSoiledUtility({ roomName: "Patient Room 12", roomType: "Patient Room" })).toBe(false);
  });
});

describe("sanitation route timing", () => {
  const spaces = [room("a", 500, 0), room("b", 1500, 0)];
  const base: Pick<SanRoute, "dock" | "seq"> = { dock: { x: 0, y: 0 }, seq: [] };

  it("an empty route costs nothing", () => {
    const t = sanTiming(plan, spaces, base);
    expect(t.legs).toEqual([]);
    expect(t.total).toBe(0);
  });

  it("one stop is dock → room → dock, both legs and the return home included", () => {
    const t = sanTiming(plan, spaces, { ...base, seq: ["a"] });
    expect(t.legs.map((l) => `${l.from}→${l.to}`)).toEqual(["Dock→A", "A→Dock"]);
    // 500 px ÷ 2 = 250 ft each way = 1 min each way
    expect(t.legs[0].feet).toBe(250);
    expect(t.travelMinutes).toBeCloseTo(2, 5);
    expect(t.serviceMinutes).toBe(SAN_PICKUP_MINUTES + SAN_UNLOAD_MINUTES);
    expect(t.total).toBe(Math.round(2 + SAN_PICKUP_MINUTES + SAN_UNLOAD_MINUTES));
  });

  it("stops are walked in the order they were clicked", () => {
    const forward = sanTiming(plan, spaces, { ...base, seq: ["a", "b"] });
    expect(forward.legs.map((l) => `${l.from}→${l.to}`)).toEqual(["Dock→A", "A→B", "B→Dock"]);
  });

  it("a wasteful click order really does cost more walking", () => {
    // three stops: reversing a two-stop tour walks the same loop, so the
    // order only starts to matter at three — a zig-zag beats a sweep
    const three = [room("a", 500, 0), room("b", 1000, 0), room("c", 0, 1000)];
    const sweep = sanTiming(plan, three, { ...base, seq: ["a", "b", "c"] });
    const zigzag = sanTiming(plan, three, { ...base, seq: ["a", "c", "b"] });
    expect(zigzag.travelMinutes).toBeGreaterThan(sweep.travelMinutes);
    expect(zigzag.serviceMinutes).toBe(sweep.serviceMinutes); // same rooms serviced
  });

  it("a mid-route dock return adds the trip home and an unload", () => {
    const straight = sanTiming(plan, spaces, { ...base, seq: ["a", "b"] });
    const withReturn = sanTiming(plan, spaces, { ...base, seq: ["a", DOCK, "b"] });
    expect(withReturn.serviceMinutes).toBe(straight.serviceMinutes + SAN_UNLOAD_MINUTES);
    expect(withReturn.travelMinutes).toBeGreaterThan(straight.travelMinutes);
  });

  it("ending the route at the dock doesn't tack on a second return", () => {
    const a = sanTiming(plan, spaces, { ...base, seq: ["a"] });
    const b = sanTiming(plan, spaces, { ...base, seq: ["a", DOCK] });
    expect(b.total).toBe(a.total);
  });

  it("an unscaled plan says so instead of inventing distances", () => {
    const t = sanTiming({ ratio: undefined }, spaces, { ...base, seq: ["a"] });
    expect(t.unscaled).toBe(true);
    expect(t.legs[0].feet).toBeNull();
    expect(t.travelMinutes).toBe(0);
    // pickups and unloads are still real work
    expect(t.total).toBe(SAN_PICKUP_MINUTES + SAN_UNLOAD_MINUTES);
  });

  it("walking pace is the documented constant", () => {
    const t = sanTiming(plan, spaces, { ...base, seq: ["a"] });
    expect(t.legs[0].minutes).toBeCloseTo(t.legs[0].feet! / SAN_FT_PER_MIN, 5);
  });
});

describe("shipping a sanitation route to Max Schedules", () => {
  const spaces = [room("a", 500, 0), room("b", 1500, 0)];
  const route = (): SanRoute => ({
    id: "r1", name: "Soiled Run", shift: "1st Shift", building: "Main", planId: "plan1",
    dock: { x: 0, y: 0 }, seq: ["a", "b"],
    createdAt: "", updatedAt: ""
  });

  it("becomes a real schedule carrying the route's own total", () => {
    const d = dataWith(spaces);
    const r = route();
    const sched = shipSanitation(d, plan, r);
    const t = sanTiming(plan, spaces, r);
    expect(sched.spaceOrder).toEqual(["a", "b"]);
    expect(scheduleMinutes(d, rules, sched)).toBe(t.total);
    expect(r.linkedScheduleId).toBe(sched.id);
  });

  it("visiting a room is NOT cleaning it — the route never counts as coverage", () => {
    const d = dataWith(spaces);
    shipSanitation(d, plan, route());
    expect(coverageForSpace(d, "a")).toEqual([]);
  });

  it("re-shipping updates the same schedule instead of making a second one", () => {
    const d = dataWith(spaces);
    const r = route();
    shipSanitation(d, plan, r);
    r.seq = ["a"];
    shipSanitation(d, plan, r);
    expect((d.v7.schedules ?? []).length).toBe(1);
    expect((d.v7.schedules ?? [])[0].spaceOrder).toEqual(["a"]);
  });

  it("deleting the route takes its schedule with it", () => {
    const d = dataWith(spaces);
    const r = route();
    shipSanitation(d, plan, r);
    unshipRoute(d, r);
    expect(d.v7.schedules).toEqual([]);
  });

  it("prints as a running order with per-stop minutes", () => {
    const d = dataWith(spaces);
    const sched = shipSanitation(d, plan, route());
    const doc = buildScheduleDoc(d, rules, sched);
    expect(doc.rows.map((x) => x.roomNumber)).toEqual(["A", "B"]);
    expect(doc.rows.every((x) => x.minutes > 0)).toBe(true);
  });
});

describe("Max Policing", () => {
  const lobby = room("l1", 300, 300, { roomName: "Main Lobby", roomType: "Lobby" });
  const patient = room("p1", 900, 300, { roomName: "Patient Room", roomType: "Patient Room" });

  it("only public porter spaces are selectable", () => {
    expect(isPoliceable(rules, lobby)).toBe(true);
    expect(isPoliceable(rules, { roomType: "Restroom" })).toBe(true);
    expect(isPoliceable(rules, { roomType: "Corridor" })).toBe(true);
    expect(isPoliceable(rules, patient)).toBe(false);
    expect(isPoliceable(rules, { roomType: "Operating Room" })).toBe(false);
  });

  it("floor-care work is never offered on a porter round", () => {
    const offered = policeTasks(rules);
    expect(offered).toContain("trash-pull");
    expect(offered).not.toContain("auto-scrub");
    expect(offered).not.toContain("dust-mop");
  });

  it("a pass is never priced under two minutes", () => {
    expect(policeStopMinutes(rules, { squareFeet: 10, floorType: "Hard floor — finished" }, "trash-pull"))
      .toBeGreaterThanOrEqual(2);
  });

  it("ships as a schedule whose minutes are the sum of its passes", () => {
    const d = dataWith([lobby, patient]);
    const r: PoliceRoute = {
      id: "pr1", name: "Lobby Porter", shift: "1st Shift", building: "Main", planId: "plan1",
      stops: [{ spaceId: "l1", taskId: "trash-pull" }, { spaceId: "l1", taskId: "trash-pull" }],
      createdAt: "", updatedAt: ""
    };
    const sched = shipPolicing(d, rules, r);
    const per = policeStopMinutes(rules, lobby, "trash-pull");
    expect(scheduleMinutes(d, rules, sched)).toBe(per * 2);
    expect(sched.spaceOrder).toEqual(["l1"]); // two passes, one room in the order
    expect(coverageForSpace(d, "l1")).toEqual([]); // still not cleaning coverage
  });
});
