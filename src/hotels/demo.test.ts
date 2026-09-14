import { describe, it, expect } from "vitest";
import { buildDemo } from "./demo";
import { verdictFor } from "./verdict";

describe("the demo hotel", () => {
  it("builds without dangling references and shows every verdict level", () => {
    const now = Date.parse("2026-09-14T15:00:00Z");
    const s = buildDemo(now);
    for (const w of s.workOrders) expect(s.spaces.some((x) => x.id === w.spaceId)).toBe(true);
    for (const a of s.assignments) expect(s.spaces.some((x) => x.id === a.spaceId)).toBe(true);
    for (const l of s.ledger) if (l.spaceId) expect(s.spaces.some((x) => x.id === l.spaceId)).toBe(true);
    const levels = new Set(s.spaces.filter((x) => /^\d/.test(x.number)).map((x) => verdictFor(s, x, now).level));
    expect([...levels].sort()).toEqual(["green", "red", "unknown", "yellow"]);
    // the stale room is Unknown, honestly
    const stale = s.spaces.find((x) => x.number === "311")!;
    expect(verdictFor(s, stale, now).level).toBe("unknown");
    const guest = (x: { typeId: string }) => s.roomTypes.find((t) => t.id === x.typeId)?.kind === "guest";
    const unknowns = s.spaces.filter((x) => guest(x) && verdictFor(s, x, now).level === "unknown").map((x) => x.number);
    expect(unknowns).toEqual(["311"]);
    // the suite follows its parlor
    const bedroom = s.spaces.find((x) => x.number === "420")!;
    expect(verdictFor(s, bedroom, now).level).toBe("red");
  });
});
