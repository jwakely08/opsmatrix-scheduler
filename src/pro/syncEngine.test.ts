import { describe, it, expect } from "vitest";
import { decideSync, changedStores, type SyncMeta } from "./syncEngine";
import { collectWorkspace, snapshotFingerprint, storeHash } from "./workspaceStore";

const fp = (stores: Record<string, string>) => snapshotFingerprint(stores);

describe("decideSync — the whole truth table", () => {
  const stores = { opsmatrix_v7: '{"spaces":[]}' };
  const baseMeta = (over: Partial<SyncMeta> = {}): SyncMeta => ({
    rev: 5, fingerprint: fp(stores), hashes: { opsmatrix_v7: storeHash(stores.opsmatrix_v7) }, ...over
  });

  it("new device, org already has data → first-pull (never clobber the org)", () => {
    expect(decideSync({ meta: null, serverRev: 9, serverHasData: true, localFingerprint: fp(stores) }))
      .toBe("first-pull");
  });
  it("new device, empty org → first-push", () => {
    expect(decideSync({ meta: null, serverRev: 0, serverHasData: false, localFingerprint: fp(stores) }))
      .toBe("first-push");
  });
  it("nothing changed anywhere → in-sync", () => {
    expect(decideSync({ meta: baseMeta(), serverRev: 5, serverHasData: true, localFingerprint: fp(stores) }))
      .toBe("in-sync");
  });
  it("local edits, server unchanged → push", () => {
    const edited = { opsmatrix_v7: '{"spaces":[{"id":"x"}]}' };
    expect(decideSync({ meta: baseMeta(), serverRev: 5, serverHasData: true, localFingerprint: fp(edited) }))
      .toBe("push");
  });
  it("server moved, local untouched → apply-server", () => {
    expect(decideSync({ meta: baseMeta(), serverRev: 6, serverHasData: true, localFingerprint: fp(stores) }))
      .toBe("apply-server");
  });
  it("both changed → conflict (the user decides, never silence)", () => {
    const edited = { opsmatrix_v7: '{"spaces":[{"id":"x"}]}' };
    expect(decideSync({ meta: baseMeta(), serverRev: 6, serverHasData: true, localFingerprint: fp(edited) }))
      .toBe("conflict");
  });
});

describe("delta pushes", () => {
  it("only stores whose content changed are uploaded", () => {
    const last = { a: storeHash("one"), b: storeHash("two") };
    expect(changedStores({ a: "one", b: "CHANGED" }, last)).toEqual(["b"]);
    expect(changedStores({ a: "one", b: "two" }, last)).toEqual([]);
    expect(changedStores({ a: "one", b: "two", c: "new" }, last)).toEqual(["c"]);
  });
});

describe("phantom-push regression — the API key is invisible to sync", () => {
  it("injecting a device key into opsmatrix_v7 does NOT change the sync fingerprint", () => {
    const withoutKey = { opsmatrix_v7: JSON.stringify({ spaces: [1], settings: { orgName: "A" } }) };
    const withKey = {
      opsmatrix_v7: JSON.stringify({ spaces: [1], settings: { orgName: "A", maxApiKey: "sk-ant-api-X" } })
    };
    const g1 = (k: string) => (withoutKey as Record<string, string>)[k] ?? null;
    const g2 = (k: string) => (withKey as Record<string, string>)[k] ?? null;
    expect(snapshotFingerprint(collectWorkspace(g1).stores))
      .toBe(snapshotFingerprint(collectWorkspace(g2).stores));
  });
});
