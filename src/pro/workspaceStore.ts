// The WORKSPACE: every localStorage store that together holds one operation's
// data. One definition, two consumers — the Data Backup card (download /
// restore a file) and the Supabase sync engine (push/pull the same stores to
// the org's row set). Anything not listed here is deliberately device-local.
//
// SECURITY RULE: the Anthropic API key never leaves the device. It is not a
// workspace store (`opsmatrix_max_api_key` is absent below), and the copy
// embedded inside opsmatrix_v7 → settings.maxApiKey is STRIPPED on collect
// and re-injected from the device on apply — so no backup file and no synced
// row ever carries a key.

export const WORKSPACE_FORMAT = "opsmatrix-workspace-v1";

export const WORKSPACE_KEYS = [
  "opsmatrix_v7",
  "opsmatrix_v7_plans",
  "opsmatrix_v7_demo_stamp",
  "opsmatrix_fusion_rules",
  "opsmatrix_fusion_nonspace",
  "opsmatrix_fusion_aliases",
  "opsmatrix_fusion_floorcare"
] as const;

export interface WorkspaceSnapshot {
  format: typeof WORKSPACE_FORMAT;
  exportedAt: string;
  stores: Record<string, string>;
}

type Getter = (key: string) => string | null;
type Setter = (key: string, value: string) => void;

/** opsmatrix_v7 with the API key removed — the only store that embeds a secret */
function stripKeyFromV7(raw: string): string {
  try {
    const v7 = JSON.parse(raw) ?? {};
    if (v7 && typeof v7 === "object" && v7.settings && typeof v7.settings === "object") {
      delete v7.settings.maxApiKey;
    }
    return JSON.stringify(v7);
  } catch {
    return raw; // unparseable — leave as-is rather than lose data
  }
}

/** every present workspace store, secrets stripped, ready to save or send */
export function collectWorkspace(get: Getter, now: () => string = () => new Date().toISOString()): WorkspaceSnapshot {
  const stores: Record<string, string> = {};
  for (const key of WORKSPACE_KEYS) {
    const raw = get(key);
    if (raw === null || raw === undefined) continue;
    stores[key] = key === "opsmatrix_v7" ? stripKeyFromV7(raw) : raw;
  }
  return { format: WORKSPACE_FORMAT, exportedAt: now(), stores };
}

/**
 * Replace this device's workspace with a snapshot. The device's own saved
 * API key survives: it is read BEFORE applying and re-injected into the
 * incoming opsmatrix_v7 afterwards (backups/synced rows never carry one).
 * Throws plain-English errors on anything that isn't a valid snapshot.
 */
export function applyWorkspace(snapshot: unknown, get: Getter, set: Setter): string[] {
  const s = snapshot as WorkspaceSnapshot;
  if (!s || typeof s !== "object" || s.format !== WORKSPACE_FORMAT || !s.stores || typeof s.stores !== "object") {
    throw new Error("That file is not an OpsMatrix backup.");
  }
  const deviceKey =
    (() => {
      try {
        const v7 = JSON.parse(get("opsmatrix_v7") ?? "{}") ?? {};
        return String(v7?.settings?.maxApiKey ?? "");
      } catch { return ""; }
    })() || String(get("opsmatrix_max_api_key") ?? "");

  const applied: string[] = [];
  for (const key of WORKSPACE_KEYS) {
    let raw = s.stores[key];
    if (raw === undefined) continue;
    if (typeof raw !== "string") throw new Error("That backup file is damaged (store " + key + ").");
    // a store must at least be JSON except the stamp, which is a plain string
    if (key !== "opsmatrix_v7_demo_stamp") {
      try { JSON.parse(raw); } catch { throw new Error("That backup file is damaged (store " + key + ")."); }
    }
    if (key === "opsmatrix_v7" && deviceKey) {
      try {
        const v7 = JSON.parse(raw) ?? {};
        v7.settings = { ...(v7.settings ?? {}), maxApiKey: deviceKey };
        raw = JSON.stringify(v7);
      } catch { /* validated above — unreachable */ }
    }
    set(key, raw);
    applied.push(key);
  }
  if (!applied.length) throw new Error("That backup file contains no OpsMatrix data.");
  return applied;
}

/**
 * Cheap, stable fingerprint of the whole workspace — the sync engine compares
 * it between ticks to know whether anything changed without re-serializing
 * megabytes into the comparison itself. djb2 over each store, order-fixed.
 */
export function workspaceFingerprint(get: Getter): string {
  let out = "";
  for (const key of WORKSPACE_KEYS) {
    const raw = get(key);
    if (raw === null || raw === undefined) { out += key + ":-;"; continue; }
    let h = 5381;
    for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) | 0;
    out += key + ":" + raw.length + ":" + (h >>> 0).toString(36) + ";";
  }
  return out;
}

/** filename for a downloaded backup: opsmatrix-backup-2026-08-26.json */
export function backupFilename(d: Date = new Date()): string {
  return "opsmatrix-backup-" + d.toISOString().slice(0, 10) + ".json";
}
