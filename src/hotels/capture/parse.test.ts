import { describe, it, expect } from "vitest";
import { parseLocal, numberWordsToDigits } from "./parse";
import type { CaptureContext } from "./intents";

const ctx: CaptureContext = {
  rooms: ["301", "303", "305", "310", "311", "412", "418", "420", "Suite 420", "LOBBY", "Pool deck", "GYM"],
  staff: [
    { name: "Marco Bianchi", role: "engineering" }, { name: "Rosa Delgado", role: "attendant" },
    { name: "Ana Petrova", role: "attendant" }, { name: "Dana Whitfield", role: "inspector" }
  ],
  currentRoom: undefined
};
const types = (s: string, c = ctx) => parseLocal(s, c).map((i) => i.type);

describe("ambient capture — the local grammar (20+ utterances)", () => {
  it("1. the brief's example: 412 AC / minibar / pull / Marco → two work orders, a flag, an assignment", () => {
    const out = parseLocal("412 AC blowing warm, minibar door hanging open, pull it from tonight's arrivals, give it to Marco.", ctx);
    expect(out.map((i) => i.type)).toEqual(["create_work_order", "create_work_order", "flag", "assign"]);
    expect(out.every((i) => i.room === "412")).toBe(true);
    expect(out[0].category).toBe("hvac");
    expect(out[1].category).toBe("minibar");
    expect(out[2].flag).toBe("do_not_walk");
    expect(out[3].staff).toBe("Marco Bianchi");
    expect(out[3].task).toBe("repair");
    expect(out[0].readback).toMatch(/412 → AC blowing warm → work order → Engineering \(Marco\)/);
    expect(out.every((i) => i.confidence >= 0.85)).toBe(true);
  });
  it("2. spoken number words", () => {
    expect(numberWordsToDigits("four twelve is dirty")).toBe("412 is dirty");
    expect(numberWordsToDigits("room three oh one clean")).toBe("room 301 clean");
    expect(numberWordsToDigits("four twenty passed")).toBe("420 passed");
    expect(numberWordsToDigits("four hundred and seven leaking")).toBe("407 leaking");
  });
  it("3. '303 is dirty' → set_condition dirty", () => {
    const [i] = parseLocal("303 is dirty", ctx);
    expect(i).toMatchObject({ type: "set_condition", room: "303", condition: "dirty" });
  });
  it("4. 'room 305 is clean' → clean", () => {
    expect(parseLocal("room 305 is clean", ctx)[0]).toMatchObject({ type: "set_condition", condition: "clean", room: "305" });
  });
  it("5. 'Rosa started on 310' → in progress (room found after the name)", () => {
    expect(parseLocal("Rosa started on 310", ctx)[0]).toMatchObject({ type: "set_condition", condition: "in_progress", room: "310" });
  });
  it("6. '412 passed' → inspect_pass", () => {
    expect(parseLocal("412 passed", ctx)[0]).toMatchObject({ type: "inspect_pass", room: "412" });
  });
  it("7. '311 failed, hair in the tub' → inspect_fail with notes", () => {
    const [i] = parseLocal("311 failed, hair in the tub", ctx);
    expect(i.type).toBe("inspect_fail");
    expect(i.room).toBe("311");
    expect(parseLocal("311 failed, hair in the tub", ctx).map((x) => x.type)).toContain("inspect_fail");
  });
  it("8. 'give 303 to Ana' → assign departure", () => {
    expect(parseLocal("give 303 to Ana", ctx)[0]).toMatchObject({ type: "assign", room: "303", staff: "Ana Petrova", task: "departure" });
  });
  it("9. 'Dana can take 305' → assign inspect (inspector)", () => {
    expect(parseLocal("Dana can take 305", ctx)[0]).toMatchObject({ type: "assign", staff: "Dana Whitfield", task: "inspect", room: "305" });
  });
  it("10. 'suite 420 do not walk' → flag on the suite", () => {
    expect(parseLocal("suite 420 do not walk", ctx)[0]).toMatchObject({ type: "flag", flag: "do_not_walk", room: "Suite 420" });
  });
  it("11. '412 is ok to walk again' → walk_ok", () => {
    expect(parseLocal("412 is ok to walk again", ctx)[0]).toMatchObject({ type: "flag", flag: "walk_ok" });
  });
  it("12. '303 VIP tonight' → vip flag", () => {
    expect(parseLocal("303 VIP tonight", ctx)[0]).toMatchObject({ type: "flag", flag: "vip", room: "303" });
  });
  it("13. '305 toilet keeps running' → plumbing work order", () => {
    expect(parseLocal("305 toilet keeps running", ctx)[0]).toMatchObject({ type: "create_work_order", category: "plumbing", room: "305" });
  });
  it("14. '310 bedside lamp flickers' → electrical", () => {
    expect(parseLocal("310 bedside lamp flickers", ctx)[0]).toMatchObject({ type: "create_work_order", category: "electrical" });
  });
  it("15. '412 TV remote missing' → tv", () => {
    expect(parseLocal("412 TV remote missing", ctx)[0]).toMatchObject({ type: "create_work_order", category: "tv" });
  });
  it("16. '303 no power, can't sell it' → blocking work order", () => {
    const [i] = parseLocal("303 no power, can't sell it", ctx);
    expect(i).toMatchObject({ type: "create_work_order", blocking: true });
  });
  it("17. 'note 412 guest asked for extra pillows' → note on the room", () => {
    expect(parseLocal("note 412 guest asked for extra pillows", ctx)[0]).toMatchObject({ type: "note", room: "412" });
  });
  it("18. 'for the handover: linen delivery is late' → report_line", () => {
    expect(parseLocal("for the handover: linen delivery is late", ctx)[0]).toMatchObject({ type: "report_line", text: "linen delivery is late" });
  });
  it("19. 'pool deck chair strap torn' → public-area work order by name", () => {
    expect(parseLocal("pool deck chair strap torn", ctx)[0]).toMatchObject({ type: "create_work_order", room: "Pool deck", category: "furniture" });
  });
  it("20. no room mentioned, current room set → uses the room I'm standing in", () => {
    const [i] = parseLocal("shower drain is slow", { ...ctx, currentRoom: "418" });
    expect(i).toMatchObject({ type: "create_work_order", room: "418", category: "plumbing" });
  });
  it("21. no room and no context → lower confidence, never silently dropped", () => {
    const [i] = parseLocal("AC not cooling", ctx);
    expect(i.type).toBe("create_work_order");
    expect(i.room).toBeUndefined();
    expect(i.confidence).toBeLessThan(0.8);
  });
  it("22. an unknown room number is kept but marked less confident", () => {
    const [i] = parseLocal("999 is dirty", ctx);
    expect(i.room).toBe("999");
    expect(i.confidence).toBeLessThan(0.9);
  });
  it("23. multiple rooms in one breath", () => {
    const out = parseLocal("301 is clean, 303 is dirty and 305 passed", ctx);
    expect(out.map((i) => [i.type, i.room])).toEqual([["set_condition", "301"], ["set_condition", "303"], ["inspect_pass", "305"]]);
  });
  it("24. 'AC and heat not working in 412' does not split on 'and heat'", () => {
    const out = parseLocal("AC and heat not working in 412", ctx);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "create_work_order", category: "hvac", room: "412" });
  });
  it("25. gibberish becomes an honest low-confidence note, not a fake action", () => {
    const [i] = parseLocal("hmm what was that thing", ctx);
    expect(i.type).toBe("note");
    expect(i.confidence).toBeLessThanOrEqual(0.5);
  });
  it("26. 'Marco has it' after a room → assign", () => {
    const out = parseLocal("412 minibar door broken, Marco's got it", ctx);
    expect(types("412 minibar door broken, Marco's got it")).toEqual(["create_work_order", "assign"]);
    expect(out[1].staff).toBe("Marco Bianchi");
  });
});
