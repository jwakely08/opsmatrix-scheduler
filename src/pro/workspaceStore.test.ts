import { describe, it, expect } from "vitest";
import {
  WORKSPACE_KEYS, WORKSPACE_FORMAT, collectWorkspace, applyWorkspace,
  workspaceFingerprint, backupFilename
} from "./workspaceStore";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get: (k: string) => (map.has(k) ? map.get(k)! : null),
    set: (k: string, v: string) => { map.set(k, v); },
    map
  };
}

const V7 = JSON.stringify({
  spaces: [{ id: "sp1", roomNumber: "E1-100" }],
  settings: { orgName: "Demo", maxApiKey: "sk-ant-api-SECRET" }
});

describe("collectWorkspace", () => {
  it("collects every present store and skips absent ones", () => {
    const s = fakeStorage({ opsmatrix_v7: V7, opsmatrix_fusion_rules: "{}" });
    const snap = collectWorkspace(s.get, () => "2026-08-26T00:00:00Z");
    expect(snap.format).toBe(WORKSPACE_FORMAT);
    expect(Object.keys(snap.stores).sort()).toEqual(["opsmatrix_fusion_rules", "opsmatrix_v7"]);
  });
  it("NEVER exports the API key — stripped from settings, and the backup slot is not a workspace store", () => {
    const s = fakeStorage({ opsmatrix_v7: V7, opsmatrix_max_api_key: "sk-ant-api-SECRET" });
    const snap = collectWorkspace(s.get);
    expect(JSON.stringify(snap)).not.toContain("SECRET");
    expect(snap.stores["opsmatrix_max_api_key"]).toBeUndefined();
    const v7 = JSON.parse(snap.stores["opsmatrix_v7"]);
    expect(v7.settings.orgName).toBe("Demo");        // other settings survive
    expect(v7.settings.maxApiKey).toBeUndefined();
    expect(v7.spaces).toHaveLength(1);               // data untouched
  });
  it("the dedicated key slot is not a workspace store", () => {
    expect((WORKSPACE_KEYS as readonly string[]).includes("opsmatrix_max_api_key")).toBe(false);
  });
});

describe("applyWorkspace", () => {
  it("round-trips: apply(collect(x)) restores every store", () => {
    const src = fakeStorage({ opsmatrix_v7: V7, opsmatrix_fusion_floorcare: '{"schedules":[]}' });
    const snap = collectWorkspace(src.get);
    const dst = fakeStorage();
    const applied = applyWorkspace(snap, dst.get, dst.set);
    expect(applied.sort()).toEqual(["opsmatrix_fusion_floorcare", "opsmatrix_v7"]);
    expect(JSON.parse(dst.get("opsmatrix_v7")!).spaces).toHaveLength(1);
  });
  it("the restoring device KEEPS its own API key", () => {
    const snap = collectWorkspace(fakeStorage({ opsmatrix_v7: V7 }).get);
    const dst = fakeStorage({
      opsmatrix_v7: JSON.stringify({ settings: { maxApiKey: "sk-ant-api-DEVICEKEY" } })
    });
    applyWorkspace(snap, dst.get, dst.set);
    expect(JSON.parse(dst.get("opsmatrix_v7")!).settings.maxApiKey).toBe("sk-ant-api-DEVICEKEY");
  });
  it("falls back to the dedicated backup slot for the device key", () => {
    const snap = collectWorkspace(fakeStorage({ opsmatrix_v7: V7 }).get);
    const dst = fakeStorage({ opsmatrix_max_api_key: "sk-ant-api-SLOTKEY" });
    applyWorkspace(snap, dst.get, dst.set);
    expect(JSON.parse(dst.get("opsmatrix_v7")!).settings.maxApiKey).toBe("sk-ant-api-SLOTKEY");
  });
  it("rejects non-backups and damaged stores in plain English", () => {
    const dst = fakeStorage();
    expect(() => applyWorkspace({ hello: 1 }, dst.get, dst.set)).toThrow(/not an OpsMatrix backup/);
    expect(() => applyWorkspace(
      { format: WORKSPACE_FORMAT, exportedAt: "", stores: { opsmatrix_v7: "{broken" } },
      dst.get, dst.set
    )).toThrow(/damaged/);
    expect(() => applyWorkspace(
      { format: WORKSPACE_FORMAT, exportedAt: "", stores: {} },
      dst.get, dst.set
    )).toThrow(/no OpsMatrix data/);
  });
  it("ignores unknown store names in a tampered file (never writes arbitrary keys)", () => {
    const dst = fakeStorage();
    applyWorkspace(
      { format: WORKSPACE_FORMAT, exportedAt: "", stores: { evil_key: "{}", opsmatrix_fusion_rules: "{}" } },
      dst.get, dst.set
    );
    expect(dst.get("evil_key")).toBeNull();
    expect(dst.get("opsmatrix_fusion_rules")).toBe("{}");
  });
});

describe("workspaceFingerprint", () => {
  it("is stable for identical data and changes when any store changes", () => {
    const a = fakeStorage({ opsmatrix_v7: V7 });
    const b = fakeStorage({ opsmatrix_v7: V7 });
    expect(workspaceFingerprint(a.get)).toBe(workspaceFingerprint(b.get));
    b.set("opsmatrix_fusion_rules", "{}");
    expect(workspaceFingerprint(a.get)).not.toBe(workspaceFingerprint(b.get));
  });
});

describe("backupFilename", () => {
  it("is dated", () => {
    expect(backupFilename(new Date("2026-08-26T12:00:00Z"))).toBe("opsmatrix-backup-2026-08-26.json");
  });
});
