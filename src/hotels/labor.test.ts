import { describe, it, expect } from "vitest";
import { buildDemo } from "./demo";
import { dailyDemand, forecastPlan, parseForecast, compareBoards, buildContiguousBoards, todayWork, variance } from "./labor";

describe("space-based labor", () => {
  const now = Date.parse("2026-09-14T15:00:00Z");
  it("daily demand = departures × departure min + stayovers × stayover min + public areas + travel", () => {
    const s = buildDemo(now);
    const d = dailyDemand(s, { date: "2026-09-15", arrivals: 14, departures: 12, stayovers: 20 });
    expect(d.departureMin).toBeGreaterThan(0);
    expect(d.totalMin).toBe(d.departureMin + d.stayoverMin + d.turndownMin + d.publicMin + d.travelMin);
    expect(d.attendants).toBe(Math.ceil(d.attendantsExact - 0.05));
    expect(d.turndownMin).toBe(0);
    s.settings.turndown = true;
    expect(dailyDemand(s, { date: "2026-09-15", arrivals: 14, departures: 12, stayovers: 20 }).turndownMin).toBeGreaterThan(0);
  });
  it("14-day sheet in → staffing plan out, FTE from 420 × 5", () => {
    const s = buildDemo(now);
    const p = forecastPlan(s);
    expect(p.days).toHaveLength(14);
    expect(p.fte).toBeCloseTo(Math.round((p.weeklyMin / (420 * 5)) * 10) / 10, 5);
    const sheet = "Date,Arrivals,Departures,Stayovers\n2026-10-01,10,8,20\n2026-10-02,12,9,22\nbad line\n";
    expect(parseForecast(sheet)).toEqual([{ date: "2026-10-01", arrivals: 10, departures: 8, stayovers: 20 }, { date: "2026-10-02", arrivals: 12, departures: 9, stayovers: 22 }]);
  });
  it("contiguous boards never change floors more than needed; scattered ones do — the difference is shown in minutes and dollars", () => {
    const s = buildDemo(now);
    const c = compareBoards(s);
    expect(c.work.length).toBeGreaterThan(20);
    expect(c.scatteredTravel).toBeGreaterThan(c.contiguousTravel);
    expect(c.savedMin).toBeGreaterThan(0);
    expect(c.savedDollars).toBeCloseTo((c.savedMin / 60) * s.settings.hourlyRate, 1);
    const totalChanges = c.contiguous.reduce((a, b) => a + b.floorChanges, 0);
    expect(totalChanges).toBeLessThanOrEqual(1);
    // every board is rooms in walking order on its floor
    for (const b of c.contiguous) for (let i = 1; i < b.items.length; i++) {
      if (b.items[i].space.floor === b.items[i - 1].space.floor) expect(Number(b.items[i].space.number) >= Number(b.items[i - 1].space.number)).toBe(true);
    }
  });
  it("out-of-order rooms are not on anyone's board", () => {
    const s = buildDemo(now);
    expect(todayWork(s).some((w) => w.space.number === "407")).toBe(false);
  });
  it("boards without attendants split by the productive limit", () => {
    const s = buildDemo(now);
    const boards = buildContiguousBoards(s, todayWork(s), []);
    expect(boards.length).toBeGreaterThanOrEqual(1);
    for (const b of boards) expect(b.cleanMin).toBeLessThanOrEqual(s.settings.productiveMinutes * 1.2);
  });
  it("labor vs standard variance in hours, dollars and percent", () => {
    const s = buildDemo(now);
    const v = variance(s, 840, 16);
    expect(v).toEqual({ standardHours: 14, actualHours: 16, deltaHours: 2, deltaDollars: 36, pct: 14 });
  });
});
