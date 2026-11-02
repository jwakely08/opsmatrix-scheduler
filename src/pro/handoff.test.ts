import { describe, it, expect } from "vitest";
import {
  AUTO_OFF_HOURS, HANDOFF_URL, HANDOFF_URL_KEY, HOME_ONLY_STORES, Mailbox, applyEdits, buildPayload, expired,
  formatCode, loadState, mailboxUrl, newCode, normalizeCode, payloadFingerprint, saveState, summarizeEdits,
  type HandoffEdits, type HandoffState
} from "./handoff";

/** a fake device: localStorage as a Map */
function device(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    get: (k: string) => (m.has(k) ? m.get(k)! : null),
    set: (k: string, v: string) => { m.set(k, v); },
    remove: (k: string) => { m.delete(k); },
    m
  };
}

const v7 = (spaces: number, schedules: number, extra: Record<string, unknown> = {}) => JSON.stringify({
  spaces: Array.from({ length: spaces }, (_, i) => ({ id: "sp" + i })),
  schedules: Array.from({ length: schedules }, (_, i) => ({ id: "s" + i })),
  settings: { maxApiKey: "sk-device-secret", orgName: "EVS" },
  ...extra
});

describe("the code Josh reads to Claude", () => {
  it("is 16 characters from the spoken alphabet, grouped in fours", () => {
    const code = newCode((n) => Uint8Array.from({ length: n }, (_, i) => i * 7));
    expect(code).toMatch(/^[A-Z2-7]{16}$/);
    expect(formatCode(code)).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
  });
  it("comes back the same however it's typed or spoken", () => {
    expect(normalizeCode("7q2m-k6xw 4plt zc5r")).toBe("7Q2MK6XW4PLTZC5R");
    expect(normalizeCode("7Q2MK6XW4PLTZC5R")).toBe("7Q2MK6XW4PLTZC5R");
    expect(normalizeCode("7Q2M-K6XW-4PLT")).toBeNull();     // too short
    expect(normalizeCode("7Q2M-K6XW-4PLT-ZC51")).toBeNull(); // 1 isn't in the alphabet, so it's a character short
    expect(normalizeCode("")).toBeNull();
  });
  it("never repeats across fresh randomness", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(newCode());
    expect(seen.size).toBe(50);
  });
});

describe("the switch's own bookkeeping", () => {
  it("saves, loads and clears, and refuses a damaged code", () => {
    const d = device();
    const s: HandoffState = { code: "7Q2MK6XW4PLTZC5R", since: "2026-11-02T13:50:00.000Z", rev: 3, sentFp: "x", sentAt: "", seen: ["e1"] };
    saveState(d.set, d.remove, s);
    expect(loadState(d.get)).toEqual(s);
    saveState(d.set, d.remove, null);
    expect(loadState(d.get)).toBeNull();
    d.set("om_handoff", JSON.stringify({ ...s, code: "nope" }));
    expect(loadState(d.get)).toBeNull();
  });
  it(`turns itself off after ${AUTO_OFF_HOURS} hours`, () => {
    const since = "2026-11-02T13:50:00.000Z";
    const t = Date.parse(since);
    expect(expired(since, t + 3600_000)).toBe(false);
    expect(expired(since, t + (AUTO_OFF_HOURS * 3600_000) - 1)).toBe(false);
    expect(expired(since, t + (AUTO_OFF_HOURS * 3600_000) + 1)).toBe(true);
    expect(expired("garbage")).toBe(true);
  });
  it("talks to the OpsMatrix mailbox unless a device says otherwise", () => {
    expect(mailboxUrl(() => null)).toBe(HANDOFF_URL);
    const d = device({ [HANDOFF_URL_KEY]: "http://127.0.0.1:47890/handoff/" });
    expect(mailboxUrl(d.get)).toBe("http://127.0.0.1:47890/handoff");
    expect(mailboxUrl(device({ [HANDOFF_URL_KEY]: "ftp://x" }).get)).toBe(HANDOFF_URL);
  });
});

describe("what the device sends", () => {
  const d = device({
    opsmatrix_v7: v7(3, 1),
    opsmatrix_v7_plans: "[]",
    opsmatrix_fusion_planstudio: JSON.stringify([{ img: "data:image/png;base64,AAAA" }]),
    opsmatrix_fusion_nonspace: "[]"
  });
  it("is the workspace without the floor pictures, and never the API key", () => {
    const p = buildPayload(d.get, 4, "iPad", () => "2026-11-02T14:00:00.000Z");
    expect(p).toMatchObject({ format: "opsmatrix-workspace-v1", rev: 4, device: "iPad", exportedAt: "2026-11-02T14:00:00.000Z" });
    expect(Object.keys(p.stores).sort()).toEqual(["opsmatrix_fusion_nonspace", "opsmatrix_v7", "opsmatrix_v7_plans"]);
    expect(HOME_ONLY_STORES.has("opsmatrix_fusion_planstudio")).toBe(true);
    expect(p.stores.opsmatrix_v7).not.toContain("sk-device-secret");
    expect(JSON.parse(p.stores.opsmatrix_v7).settings.orgName).toBe("EVS");
  });
  it("fingerprints only what would be sent, so a picture edit isn't a change", () => {
    const a = payloadFingerprint(d.get);
    d.set("opsmatrix_fusion_planstudio", "[]");
    expect(payloadFingerprint(d.get)).toBe(a);
    d.set("opsmatrix_fusion_nonspace", JSON.stringify([{ id: "n1" }]));
    expect(payloadFingerprint(d.get)).not.toBe(a);
  });
});

describe("what Claude sends back", () => {
  const edits = (stores: Record<string, string>, baseRev = 2): HandoffEdits =>
    ({ id: "e1", baseRev, at: "2026-11-02T14:10:00.000Z", note: "101 and 102 rebuilt", stores });

  it("is summed up in counts for the banner, and flagged when the device moved on", () => {
    const e = edits({ opsmatrix_v7: v7(3271, 2), opsmatrix_fusion_nonspace: JSON.stringify([{ id: "n1" }]), opsmatrix_fusion_rules: "{}" });
    expect(summarizeEdits(e, 2)).toEqual({ rooms: 3271, schedules: 2, nonSpace: 1, others: ["Scope rules"], stale: false });
    expect(summarizeEdits(e, 5).stale).toBe(true);
    expect(summarizeEdits(edits({ opsmatrix_fusion_routes: "{}" }), 1)).toMatchObject({ rooms: null, schedules: null, others: ["Sanitation / Policing routes"] });
  });

  it("replaces only the stores it carries, keeps the device's API key, never touches the pictures", () => {
    const d = device({
      opsmatrix_v7: v7(3, 0),
      opsmatrix_v7_plans: "[{\"id\":\"plan-1\"}]",
      opsmatrix_fusion_planstudio: "[{\"img\":\"keep\"}]"
    });
    const applied = applyEdits(edits({ opsmatrix_v7: v7(3, 2), opsmatrix_fusion_planstudio: "[]" }), d.get, d.set);
    expect(applied).toEqual(["opsmatrix_v7"]);
    const after = JSON.parse(d.get("opsmatrix_v7")!);
    expect(after.schedules).toHaveLength(2);
    expect(after.settings.maxApiKey).toBe("sk-device-secret");
    expect(d.get("opsmatrix_v7_plans")).toBe("[{\"id\":\"plan-1\"}]");
    expect(d.get("opsmatrix_fusion_planstudio")).toBe("[{\"img\":\"keep\"}]");
  });

  it("refuses a change set that isn't OpsMatrix data", () => {
    const d = device({ opsmatrix_v7: v7(1, 0) });
    expect(() => applyEdits(edits({ opsmatrix_v7: "not json" }), d.get, d.set)).toThrow(/damaged/);
    expect(() => applyEdits(edits({}), d.get, d.set)).toThrow(/no OpsMatrix data/);
  });
});

describe("the mailbox, as the device talks to it", () => {
  const calls: { url: string; method: string; body?: string }[] = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
    if (u.endsWith("/status")) return new Response(JSON.stringify({ exists: true, rev: 2, edits: { id: "e1", at: "x", size: 10, baseRev: 2 } }), { status: 200 });
    if (u.endsWith("/edits") && (init?.method ?? "GET") === "GET") return new Response(JSON.stringify({ id: "e1", baseRev: 2, at: "x", stores: {} }), { status: 200 });
    if (init?.method === "PUT") return new Response(JSON.stringify({ ok: true, rev: 3 }), { status: 200 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;

  it("uses the code in the path and the right verbs", async () => {
    const mb = new Mailbox("https://example.test/handoff", "7Q2MK6XW4PLTZC5R", fakeFetch);
    expect((await mb.status()).edits?.id).toBe("e1");
    expect((await mb.send({ format: "opsmatrix-workspace-v1", exportedAt: "x", stores: { a: "1" }, rev: 3, device: "iPad" })).rev).toBe(3);
    expect((await mb.edits())?.id).toBe("e1");
    await mb.clearEdits();
    await mb.close();
    expect(calls.map((c) => c.method + " " + c.url.replace("https://example.test/handoff/7Q2MK6XW4PLTZC5R", "…"))).toEqual([
      "GET …/status", "PUT …", "GET …/edits", "DELETE …/edits", "DELETE …"
    ]);
    expect(JSON.parse(calls[1].body!).rev).toBe(3);
  });

  it("reads 'nothing here' as no changes, and anything else as trouble", async () => {
    const mb404 = new Mailbox("https://x", "7Q2MK6XW4PLTZC5R", (async () => new Response("{}", { status: 404 })) as typeof fetch);
    expect(await mb404.edits()).toBeNull();
    const mb500 = new Mailbox("https://x", "7Q2MK6XW4PLTZC5R", (async () => new Response("{}", { status: 500 })) as typeof fetch);
    await expect(mb500.status()).rejects.toThrow(/500/);
  });
});
