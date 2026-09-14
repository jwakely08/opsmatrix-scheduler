import { describe, it, expect } from "vitest";
import { buildIntentRequest, requestHeaders, sanitizeIntents, AI_MODEL } from "./ai";
import { INTENT_SCHEMA } from "./intents";

describe("capture — the Claude request", () => {
  const ctx = { rooms: ["412"], staff: [{ name: "Marco Bianchi", role: "engineering" }], currentRoom: "412", floor: "4", hotelName: "The Meridian" };
  it("is schema-constrained, low effort, carries the context, and never sends sampling params", () => {
    const req = buildIntentRequest("AC blowing warm", ctx);
    expect(req.model).toBe(AI_MODEL);
    expect(req.output_config).toEqual({ effort: "low", format: { type: "json_schema", schema: INTENT_SCHEMA } });
    expect(req.messages[0].content).toMatch(/Rooms and spaces: 412/);
    expect(req.messages[0].content).toMatch(/Marco Bianchi \(engineering\)/);
    expect(req.messages[0].content).toMatch(/Current room: 412/);
    expect(req.messages[0].content).toMatch(/"AC blowing warm"/);
    expect("temperature" in req).toBe(false);
    expect("thinking" in req).toBe(false);
    expect("tool_choice" in req).toBe(false);
  });
  it("uses the browser-direct headers with the user's key, exactly like the hospital app", () => {
    expect(requestHeaders(" sk-ant-x ")).toEqual({
      "content-type": "application/json", "x-api-key": "sk-ant-x", "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    });
  });
  it("sanitizes the reply: unknown types dropped, confidence clamped", () => {
    const out = sanitizeIntents({ intents: [
      { type: "create_work_order", room: "412", confidence: 1.7, readback: "412 → AC → WO", category: "hvac" },
      { type: "delete_everything", confidence: 1, readback: "no" },
      { type: "note", confidence: "0.4", readback: "hmm" }
    ] });
    expect(out.map((i) => i.type)).toEqual(["create_work_order", "note"]);
    expect(out[0].confidence).toBe(1);
    expect(out[1].confidence).toBe(0.4);
  });
});
