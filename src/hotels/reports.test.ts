import { describe, it, expect } from "vitest";
import { buildDemo } from "./demo";
import { handoverReport, dailyRoomsReport, scarMap, reportToText } from "./reports";
import { parseLocal } from "./capture/parse";
import { applyIntents } from "./capture/apply";

describe("generated reports", () => {
  const now = Date.parse("2026-09-14T15:00:00Z");
  it("the handover is generated from the ledger with zero typing", () => {
    const s = buildDemo(now);
    const r = handoverReport(s, now, 8);
    expect(r.sections[0].heading).toBe("Arrivals");
    expect(r.sections[0].lines[0]).toMatch(/13 arrivals tonight/);
    expect(r.sections.find((x) => x.heading === "Out of order")!.lines[0]).toMatch(/407/);
    expect(r.sections.find((x) => x.heading === "Failed inspections this shift")!.lines[0]).toMatch(/315/);
    expect(r.sections.some((x) => x.heading === "315")).toBe(true);
    expect(reportToText(r)).toMatch(/SHIFT HANDOVER/);
  });
  it("the 412 capture shows up in the handover as four lines and in the scar map as two failures", () => {
    const s = buildDemo(now);
    const ctx = { rooms: s.spaces.map((x) => x.number), staff: s.staff.map((x) => ({ name: x.name, role: x.role })) };
    applyIntents(s, parseLocal("412 AC blowing warm, minibar door hanging open, pull it from tonight's arrivals, give it to Marco", ctx), "Josh");
    const later = Date.now() + 1000;
    const r = handoverReport(s, later, 8);
    const sec = r.sections.find((x) => x.heading === "412")!;
    expect(sec.lines).toHaveLength(4);
    const m = scarMap(s, later, 30);
    expect(m.count("412", "hvac")).toBeGreaterThanOrEqual(2); // today's + the one from 6 days ago
    expect(m.count("412", "minibar")).toBe(1);
    expect(m.rooms[0]).toBe("412");
  });
  it("30 vs 90 days widen the scar window", () => {
    const s = buildDemo(now);
    expect(scarMap(s, now, 30).total).toBeLessThanOrEqual(scarMap(s, now, 90).total);
    expect(scarMap(s, now, 1).count("412", "hvac")).toBe(0);
  });
  it("the daily rooms report counts every guest room exactly once", () => {
    const s = buildDemo(now);
    const r = dailyRoomsReport(s, now);
    const total = r.sections[0].lines.map((l) => Number(l.split(": ")[1])).reduce((a, b) => a + b, 0);
    const guestRooms = s.spaces.filter((x) => s.roomTypes.find((t) => t.id === x.typeId)?.kind === "guest").length;
    expect(total).toBe(guestRooms);
    expect(guestRooms).toBe(38);
  });
});
