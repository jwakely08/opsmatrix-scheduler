// The workspace sync engine — mirrors this device's localStorage workspace
// (src/pro/workspaceStore.ts) to the organization's `workspaces` rows in
// Supabase, guarded by the org's state_rev (optimistic concurrency, the
// bump_state_rev RPC from migration 0001).
//
// DESIGN: localStorage stays the working copy — every screen keeps reading
// and writing it exactly as before, so nothing about the app's behavior
// changes. The engine is a mirror that runs beside the app: pull-and-decide
// on start, then push whenever the local fingerprint changes (ticked every
// TICK_MS and on tab-hide). Conflicts (another device saved since we last
// synced, AND this device has its own unsynced edits) are decided by the
// user through the onConflict callback — never silently.
//
// The decision logic is a pure function (decideSync) so the truth table is
// unit-tested without a server.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  WORKSPACE_KEYS, collectWorkspace, snapshotFingerprint, storeHash
} from "./workspaceStore";

export const SYNC_META_KEY = "opsmatrix_sync_meta";
const TICK_MS = 20_000;

export interface SyncMeta {
  rev: number;                     // org state_rev this device last synced at
  fingerprint: string;             // workspace fingerprint at that moment
  hashes: Record<string, string>;  // per-store hash at that moment (delta pushes)
}

export type SyncDecision =
  | "in-sync"        // nothing to do
  | "push"           // local changed, server unchanged → upload
  | "apply-server"   // server changed, local didn't → download
  | "conflict"       // both changed → ask the user
  | "first-pull"     // new device, org already has data → download
  | "first-push";    // new device, org empty → upload

/** The whole sync brain, as a pure truth table. */
export function decideSync(input: {
  meta: SyncMeta | null;
  serverRev: number;
  serverHasData: boolean;
  localFingerprint: string;
}): SyncDecision {
  const { meta, serverRev, serverHasData, localFingerprint } = input;
  if (!meta) return serverHasData ? "first-pull" : "first-push";
  const localChanged = localFingerprint !== meta.fingerprint;
  const serverChanged = serverRev !== meta.rev;
  if (!localChanged && !serverChanged) return "in-sync";
  if (localChanged && !serverChanged) return "push";
  if (!localChanged && serverChanged) return "apply-server";
  return "conflict";
}

/** which stores need uploading, given the last-synced hashes */
export function changedStores(
  stores: Record<string, string>,
  lastHashes: Record<string, string>
): string[] {
  return Object.keys(stores).filter((k) => storeHash(stores[k]) !== lastHashes[k]);
}

function loadMeta(): SyncMeta | null {
  try {
    const m = JSON.parse(localStorage.getItem(SYNC_META_KEY) ?? "null");
    return m && typeof m.rev === "number" && typeof m.fingerprint === "string"
      ? { rev: m.rev, fingerprint: m.fingerprint, hashes: m.hashes ?? {} }
      : null;
  } catch { return null; }
}

function saveMeta(meta: SyncMeta) {
  localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
}

export function clearSyncMeta() {
  localStorage.removeItem(SYNC_META_KEY);
}

export type SyncState = "idle" | "syncing" | "synced" | "offline" | "view-only" | "error";

export interface SyncEngineOptions {
  sb: SupabaseClient;
  orgId: string;
  userId: string;
  role: string; // 'director' | 'supervisor' | 'staff' — staff never push (view-only)
  /** both sides changed: resolve to "server" (load theirs) or "local" (keep ours) */
  onConflict: () => Promise<"server" | "local">;
  onState?: (state: SyncState, detail?: string) => void;
}

/**
 * Background sync for pages WITHOUT the AuthGate shell (classic.html): if the
 * build is cloud-configured AND a fully-verified session already exists (the
 * hub is where people sign in — same origin, shared session), mirror this
 * page's workspace too. Signed out, MFA incomplete, or local build → no-op,
 * and the page behaves exactly as it always has.
 */
export async function startBackgroundSync(deps: {
  cloud: () => SupabaseClient | null;
  onState?: (state: SyncState, detail?: string) => void;
}): Promise<SyncEngine | null> {
  const sb = deps.cloud();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  if (!data.session) return null;
  const aal = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!aal.error && aal.data.nextLevel === "aal2" && aal.data.currentLevel !== "aal2") {
    return null; // finish two-step verification in the hub first
  }
  const prof = await sb.from("profiles").select("organization_id, role")
    .eq("user_id", data.session.user.id).maybeSingle();
  if (prof.error || !prof.data) return null;
  const engine = new SyncEngine({
    sb,
    orgId: prof.data.organization_id,
    userId: data.session.user.id,
    role: String(prof.data.role),
    onConflict: async () =>
      confirm(
        "This data was changed on another device since this one last synced.\n\n" +
        "OK = load the newest version (recommended)\nCancel = keep THIS device's version"
      ) ? "server" : "local",
    onState: deps.onState
  });
  await engine.start();
  return engine;
}

export class SyncEngine {
  private timer: number | null = null;
  private running = false;
  private stopped = false;
  private opts: SyncEngineOptions;

  constructor(opts: SyncEngineOptions) { this.opts = opts; }

  /** initial reconcile, then background ticks; resolves after the first sync */
  async start(): Promise<void> {
    await this.tick();
    this.timer = window.setInterval(() => { void this.tick(); }, TICK_MS);
    document.addEventListener("visibilitychange", this.onHide);
  }

  stop() {
    this.stopped = true;
    if (this.timer !== null) window.clearInterval(this.timer);
    document.removeEventListener("visibilitychange", this.onHide);
  }

  private onHide = () => {
    if (document.visibilityState === "hidden") void this.tick();
  };

  /** push-now (used before sign-out) */
  async flush(): Promise<void> { await this.tick(); }

  private setState(s: SyncState, detail?: string) { this.opts.onState?.(s, detail); }

  private async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const sb = this.opts.sb;
      const local = collectWorkspace((k) => localStorage.getItem(k));
      const localFp = snapshotFingerprint(local.stores);
      const meta = loadMeta();

      const org = await sb.from("organizations").select("state_rev").eq("id", this.opts.orgId).single();
      if (org.error) { this.setState("offline", org.error.message); return; }
      const serverRev = Number(org.data.state_rev) || 0;

      // cheap existence probe — full rows are fetched only when applying
      const probe = await sb.from("workspaces").select("key").limit(1);
      if (probe.error) { this.setState("offline", probe.error.message); return; }
      const serverHasData = (probe.data ?? []).length > 0;

      let decision = decideSync({ meta, serverRev, serverHasData, localFingerprint: localFp });
      if (decision === "conflict") {
        decision = (await this.opts.onConflict()) === "server" ? "apply-server" : "push";
      }

      if (decision === "in-sync") { this.setState("synced"); return; }

      if (decision === "apply-server" || decision === "first-pull") {
        this.setState("syncing", "downloading");
        await this.applyServer(serverRev);
        this.setState("synced");
        return;
      }

      // push / first-push
      if (this.opts.role === "staff") {
        // RLS would reject the write anyway — say it honestly instead
        this.setState("view-only");
        return;
      }
      this.setState("syncing", "uploading");
      await this.push(local.stores, localFp, meta, serverRev);
    } catch (e) {
      this.setState("error", String((e as Error)?.message ?? e));
    } finally {
      this.running = false;
    }
  }

  private async applyServer(serverRev: number): Promise<void> {
    const sb = this.opts.sb;
    const rows = await sb.from("workspaces").select("key, content");
    if (rows.error) throw new Error(rows.error.message);
    const hashes: Record<string, string> = {};
    for (const row of rows.data ?? []) {
      if (!(WORKSPACE_KEYS as readonly string[]).includes(row.key)) continue;
      localStorage.setItem(row.key, row.content);
      hashes[row.key] = storeHash(row.content);
    }
    // the API key stays whatever this device holds — synced rows never carry
    // one, and healApiKey() reinstates the device key on next load
    saveMeta({
      rev: serverRev,
      fingerprint: snapshotFingerprint(collectWorkspace((k) => localStorage.getItem(k)).stores),
      hashes
    });
    // the app read localStorage at startup; a downloaded workspace needs a
    // fresh read to be visible — one guarded reload, same pattern as imports
    window.location.reload();
  }

  private async push(
    stores: Record<string, string>,
    localFp: string,
    meta: SyncMeta | null,
    serverRev: number
  ): Promise<void> {
    const sb = this.opts.sb;
    const dirty = changedStores(stores, meta?.hashes ?? {});
    if (dirty.length === 0) {
      // fingerprint moved only because a store vanished locally (rare) —
      // re-baseline the meta without touching the server
      const hashes: Record<string, string> = {};
      for (const k of Object.keys(stores)) hashes[k] = storeHash(stores[k]);
      saveMeta({ rev: serverRev, fingerprint: localFp, hashes });
      this.setState("synced");
      return;
    }
    {
      const rows = dirty.map((key) => ({
        organization_id: this.opts.orgId,
        key,
        content: stores[key],
        updated_at: new Date().toISOString(),
        updated_by: this.opts.userId
      }));
      const up = await sb.from("workspaces").upsert(rows);
      if (up.error) throw new Error(up.error.message);
    }
    const bump = await sb.rpc("bump_state_rev", { expected_rev: serverRev });
    if (bump.error) throw new Error(bump.error.message);
    const newRev = Number(bump.data);
    if (newRev === -1) {
      // someone saved between our read and our bump — next tick re-decides
      this.setState("syncing", "raced — retrying");
      return;
    }
    const hashes = { ...(meta?.hashes ?? {}) };
    for (const k of dirty) hashes[k] = storeHash(stores[k]);
    saveMeta({ rev: newRev, fingerprint: localFp, hashes });
    if (dirty.length > 0) {
      await sb.from("audit_log").insert({
        organization_id: this.opts.orgId,
        user_id: this.opts.userId,
        action: "workspace_push",
        detail: { stores: dirty, rev: newRev }
      });
    }
    this.setState("synced");
  }
}
