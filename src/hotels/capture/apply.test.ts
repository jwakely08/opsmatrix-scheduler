import { describe, it, expect } from "vitest";
import { buildDemo } from "../demo";
import { parseLocal } from "./parse";
import { applyIntents } from "./apply";
import { verdictFor } from "../verdict";
import { openWorkOrders, assigneeOf, statusFor } from "../store";

describe("capture end to end — the 412 example lands in three places", () => {
  it("two work orders on 412, room red with reason, do-not-walk, Marco assigned, four ledger lines", () => {
    const s = buildDemo();
    const now = Date.now();
    const ctx = { rooms: s.spaces.map((x) => x.number).concat(s.clusters.map((c) => c.number)), staff: s.staff.map((x) => ({ name: x.name, role: x.role })) };
    const intents = parseLocal("412 AC blowing warm, minibar door hanging open, pull it from tonight's arrivals, give it to Marco.", ctx);
    const before = s.ledger.length;
    const r = applyIntents(s, intents, "Josh", "412 AC blowing warm…");
    expect(r.applied).toBe(4);
    expect(r.skipped).toEqual([]);
    const sp = s.spaces.find((x) => x.number === "412")!;
    expect(openWorkOrders(s, sp.id)).toHaveLength(2);
    expect(statusFor(s, sp.id).flags.doNotWalk).toBe(true);
    const v = verdictFor(s, sp, now);
    expect(v.level).toBe("red");
    expect(v.reasons.join(" ")).toMatch(/do not walk/i);
    expect(assigneeOf(s, sp.id)?.name).toBe("Marco Bianchi");
    const lines = s.ledger.slice(before).filter((l) => l.spaceId === sp.id);
    expect(lines).toHaveLength(4);
    // scar map input: the two failures carry their category
    expect(lines.filter((l) => l.failure).map((l) => l.failure)).toEqual(["hvac", "minibar"]);
  });
  it("a suite flag fans out to every member", () => {
    const s = buildDemo();
    const ctx = { rooms: s.spaces.map((x) => x.number).concat(s.clusters.map((c) => c.number)), staff: [] };
    applyIntents(s, parseLocal("suite 420 do not walk", ctx), "Josh");
    const members = s.spaces.filter((x) => x.clusterId === "cl-420");
    expect(members).toHaveLength(2);
    expect(members.every((m) => statusFor(s, m.id).flags.doNotWalk)).toBe(true);
  });
  it("an unknown room is skipped with a reason, never applied to the wrong room", () => {
    const s = buildDemo();
    const ctx = { rooms: s.spaces.map((x) => x.number), staff: [] };
    const r = applyIntents(s, parseLocal("999 is dirty", ctx), "Josh");
    expect(r.applied).toBe(0);
    expect(r.skipped[0].why).toMatch(/999/);
  });
});
