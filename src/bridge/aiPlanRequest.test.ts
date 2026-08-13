// Guards the shape of the request we send to Claude. Fable 5 rejects several
// parameters that older models accepted, and a browser call needs a header
// most server-side examples omit — both fail at runtime, in front of a client,
// so they are pinned here instead.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readPlanWithAI, importPlanFromImage, AiPlanError, AI_MODEL } from "./aiPlanImport";

const IMAGE = "data:image/png;base64,AAAA";

function mockFetch(reply: unknown, ok = true, status = 200) {
  const spy = vi.fn().mockResolvedValue({
    ok, status,
    json: async () => reply,
    text: async () => JSON.stringify(reply)
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

const goodReply = {
  stop_reason: "end_turn",
  content: [{
    type: "text",
    text: JSON.stringify({
      buildingName: "Mercy General", floorName: "4 East",
      rooms: [{
        name: "Patient Room", roomNumber: "4E-101", squareFeet: 240,
        roomType: "Patient Room",
        polygon: [[0.1, 0.1], [0.4, 0.1], [0.4, 0.4], [0.1, 0.4]]
      }]
    })
  }]
};

afterEach(() => vi.unstubAllGlobals());

describe("the request we send", () => {
  it("asks Fable 5, in the browser, with a schema-constrained reply", async () => {
    const spy = mockFetch(goodReply);
    await readPlanWithAI({ apiKey: "sk-ant-test", imageDataUrl: IMAGE });

    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    // without this header the browser call is refused outright
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["x-api-key"]).toBe("sk-ant-test");

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(AI_MODEL);
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.effort).toBe("high");
  });

  it("sends no parameter Fable 5 would reject", async () => {
    const spy = mockFetch(goodReply);
    await readPlanWithAI({ apiKey: "k", imageDataUrl: IMAGE });
    const body = JSON.parse(spy.mock.calls[0][1].body as string);
    // sampling params and thinking config are all 400s on this model
    for (const banned of ["temperature", "top_p", "top_k", "thinking"]) {
      expect(body).not.toHaveProperty(banned);
    }
    // and it must not try to prefill the assistant turn
    expect(body.messages.every((m: { role: string }) => m.role === "user")).toBe(true);
  });

  it("sends the plan as an image alongside the instructions", async () => {
    const spy = mockFetch(goodReply);
    await readPlanWithAI({ apiKey: "k", imageDataUrl: "data:image/jpeg;base64,ZZZZ" });
    const body = JSON.parse(spy.mock.calls[0][1].body as string);
    const [img, text] = body.messages[0].content;
    expect(img).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "ZZZZ" } });
    expect(text.type).toBe("text");
    expect(text.text).toMatch(/ignore/i); // the colour/furniture instruction
  });
});

describe("the two-pass read: find the drawing, then lean in", () => {
  const boxReply = {
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify({ x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.4 }) }]
  };

  function mockTwoCalls() {
    const spy = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => boxReply, text: async () => "" })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => goodReply, text: async () => "" });
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  it("locates the plan, re-renders that region, and reads rooms from the crop", async () => {
    const spy = mockTwoCalls();
    const renderRegion = vi.fn().mockResolvedValue({
      dataUrl: "data:image/png;base64,CROP", width: 2500, height: 1800, aspect: 2500 / 1800
    });
    const result = await importPlanFromImage({
      apiKey: "k", imageDataUrl: IMAGE, imageWidth: 2000, imageHeight: 1500,
      aspect: 2000 / 1500, renderRegion
    });

    // pass 1 asked WHERE, cheaply
    const locate = JSON.parse(spy.mock.calls[0][1].body as string);
    expect(locate.output_config.effort).toBe("low");
    expect(locate.messages[0].content[1].text).toMatch(/bounding box/i);

    // the crop request used the located box, padded outward
    const box = renderRegion.mock.calls[0][0];
    expect(box.x0).toBeCloseTo(0.08, 6);
    expect(box.y1).toBeCloseTo(0.42, 6);
    expect(renderRegion.mock.calls[0][1]).toBe(2576);

    // pass 2 read rooms from the CROP, not the sheet
    const read = JSON.parse(spy.mock.calls[1][1].body as string);
    expect(read.messages[0].content[0].source.data).toBe("CROP");

    // and the finished plan is shaped like the crop, not the sheet
    const aspect = Number(result.plan.w) / Number(result.plan.h);
    expect(aspect).toBeCloseTo(2500 / 1800, 2);
  });

  it("falls back to the whole sheet when the locate pass returns nothing usable", async () => {
    const spy = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "{\"x0\":0,\"y0\":0,\"x1\":1,\"y1\":1}" }] }), text: async () => "" })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => goodReply, text: async () => "" });
    vi.stubGlobal("fetch", spy);
    const renderRegion = vi.fn();
    const result = await importPlanFromImage({
      apiKey: "k", imageDataUrl: IMAGE, aspect: 1.4, renderRegion
    });
    expect(renderRegion).not.toHaveBeenCalled(); // whole-sheet box = no crop
    expect(result.spaces.length).toBeGreaterThan(0);
  });

  it("survives the crop renderer failing and still reads the full sheet", async () => {
    const spy = mockTwoCalls();
    const renderRegion = vi.fn().mockRejectedValue(new Error("canvas boom"));
    const result = await importPlanFromImage({
      apiKey: "k", imageDataUrl: IMAGE, aspect: 1.4, renderRegion
    });
    expect(result.spaces.length).toBeGreaterThan(0);
    // the read fell back to the original picture
    const read = JSON.parse(spy.mock.calls[1][1].body as string);
    expect(read.messages[0].content[0].source.data).toBe("AAAA");
  });

  it("skips the locate pass entirely when the caller cannot re-render", async () => {
    const spy = mockFetch(goodReply);
    await importPlanFromImage({ apiKey: "k", imageDataUrl: IMAGE, aspect: 1.4 });
    expect(spy).toHaveBeenCalledTimes(1); // one call: straight to reading
  });
});

describe("when things go wrong, the manager gets plain English", () => {
  it("refuses to call at all without a key", async () => {
    const spy = mockFetch(goodReply);
    await expect(readPlanWithAI({ apiKey: "  ", imageDataUrl: IMAGE }))
      .rejects.toThrow(/No Anthropic API key/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it("explains a rejected key instead of showing a status code", async () => {
    mockFetch({ error: "unauthorized" }, false, 401);
    await expect(readPlanWithAI({ apiKey: "bad", imageDataUrl: IMAGE }))
      .rejects.toThrow(/API key was rejected/i);
  });

  it("names the data-retention requirement, which is not obvious", async () => {
    mockFetch({ error: { message: "zero data retention not supported" } }, false, 400);
    await expect(readPlanWithAI({ apiKey: "k", imageDataUrl: IMAGE }))
      .rejects.toThrow(/30-day data retention/i);
  });

  it("says to wait when rate limited", async () => {
    mockFetch({}, false, 429);
    await expect(readPlanWithAI({ apiKey: "k", imageDataUrl: IMAGE }))
      .rejects.toThrow(/rate limited/i);
  });

  it("handles a refusal without pretending it found rooms", async () => {
    mockFetch({ stop_reason: "refusal", content: [] });
    await expect(readPlanWithAI({ apiKey: "k", imageDataUrl: IMAGE }))
      .rejects.toThrow(/declined/i);
  });

  it("says so when the plan yielded no usable rooms", async () => {
    mockFetch({ stop_reason: "end_turn", content: [{ type: "text", text: '{"buildingName":"","floorName":"","rooms":[]}' }] });
    await expect(readPlanWithAI({ apiKey: "k", imageDataUrl: IMAGE }))
      .rejects.toThrow(/No rooms could be found/i);
  });

  it("survives an unreadable answer rather than throwing a parser error at the user", async () => {
    mockFetch({ stop_reason: "end_turn", content: [{ type: "text", text: "sorry, not JSON" }] });
    await expect(readPlanWithAI({ apiKey: "k", imageDataUrl: IMAGE }))
      .rejects.toBeInstanceOf(AiPlanError);
  });

  it("reports a dropped connection as a network problem", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    await expect(readPlanWithAI({ apiKey: "k", imageDataUrl: IMAGE }))
      .rejects.toThrow(/Could not reach Claude/i);
  });
});
