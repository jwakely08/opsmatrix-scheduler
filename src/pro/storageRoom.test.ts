import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const SRC = fs.readFileSync(path.join(__dirname, "..", "..", "public", "storage-room.js"), "utf8");
const EDITABLE = "opsmatrix_fusion_planstudio";

/** a localStorage that holds `limit` characters (keys + values), like a browser's */
function makeStorage(limit: number) {
  class TestStorage {
    m = new Map<string, string>();
    getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
    setItem(k: string, v: string) {
      let total = k.length + String(v).length;
      for (const [key, val] of this.m) if (key !== k) total += key.length + val.length;
      if (total > limit) { const e = new Error("The quota has been exceeded."); e.name = "QuotaExceededError"; throw e; }
      this.m.set(k, String(v));
    }
  }
  const store = new TestStorage();
  vm.runInNewContext(SRC, { window: { localStorage: store }, console: { warn() { /* quiet */ } } });
  return store;
}

const set = (id: string, at: string, size: number) => ({ id, updatedAt: at, picture: { dataUrl: "x".repeat(size) } });

describe("storage room-maker", () => {
  it("makes room by dropping the oldest editable floor copy, and the save goes through", () => {
    const s = makeStorage(4000);
    s.setItem(EDITABLE, JSON.stringify([set("new", "2026-10-20", 1000), set("old", "2026-09-01", 1000)]));
    s.setItem("opsmatrix_v7", "y".repeat(2000)); // doesn't fit beside both copies
    expect(s.getItem("opsmatrix_v7")).toHaveLength(2000);
    expect(JSON.parse(s.getItem(EDITABLE)!).map((x: { id: string }) => x.id)).toEqual(["new"]);
  });

  it("still fails plainly when there's nothing optional left to give up", () => {
    const s = makeStorage(1000);
    expect(() => s.setItem("opsmatrix_v7", "y".repeat(2000))).toThrow(/quota/);
    s.setItem(EDITABLE, "[]");
    expect(() => s.setItem("opsmatrix_v7", "y".repeat(2000))).toThrow(/quota/);
  });

  it("never sacrifices other copies to save an editable copy itself", () => {
    const s = makeStorage(2500);
    s.setItem(EDITABLE, JSON.stringify([set("a", "2026-10-01", 1000)]));
    expect(() => s.setItem(EDITABLE, JSON.stringify([set("a", "2026-10-01", 1000), set("b", "2026-10-02", 2000)]))).toThrow(/quota/);
    expect(JSON.parse(s.getItem(EDITABLE)!)).toHaveLength(1);
  });

  it("passes other errors through untouched", () => {
    const s = makeStorage(100000);
    s.setItem(EDITABLE, JSON.stringify([set("a", "2026-10-01", 10)]));
    const broken = { toString() { throw new TypeError("bad value"); } };
    expect(() => s.setItem("opsmatrix_v7", broken as unknown as string)).toThrow(TypeError);
    expect(JSON.parse(s.getItem(EDITABLE)!)).toHaveLength(1);
  });
});
