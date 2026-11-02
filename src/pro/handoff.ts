// "Help from Claude" (Josh, 2026-11-02): an ON/OFF switch on the Scope page. OFF — the default, and
// how the app has always worked — nothing leaves the device. ON — this device makes an unguessable
// code, keeps its workspace (rooms, plans, schedules, rules; not the Calibration Editor's floor
// pictures) in the OpsMatrix mailbox under that code, and watches the mailbox for changes Claude
// leaves there. Josh reads the code to Claude in chat; Claude fetches, edits, sends back; the device
// shows what came in and applies it ONLY when Josh taps Apply. OFF deletes the mailbox. It also turns
// itself off after AUTO_OFF_HOURS. The mailbox is functions/handoff/[[path]].js; this module is the
// device side — pure helpers (unit-tested) plus the fetch/timer engine that HandoffCard.tsx drives.
import {
  WORKSPACE_FORMAT, WORKSPACE_KEYS, applyWorkspace, collectWorkspace, snapshotFingerprint,
  type WorkspaceSnapshot
} from "./workspaceStore";

/** where the mailbox lives — the OpsMatrix Pages project; a device may point elsewhere for tests */
export const HANDOFF_URL = "https://staging.opsmatrix.pages.dev/handoff";
export const HANDOFF_URL_KEY = "om_handoff_url";
/** this device's switch, code and bookkeeping — device-local, never part of the workspace */
export const HANDOFF_STATE_KEY = "om_handoff";
export const AUTO_OFF_HOURS = 12;
/** how often the device looks for changes, and re-sends its own */
export const TICK_MS = 15_000;
/** the floor pictures stay home: big, and nothing Claude edits */
export const HOME_ONLY_STORES: ReadonlySet<string> = new Set(["opsmatrix_fusion_planstudio"]);

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** a fresh 16-character code (80 bits), e.g. 7Q2MK9XW4PLTZC8R */
export function newCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = random(16);
  let out = "";
  for (let i = 0; i < 16; i++) out += ALPHABET[bytes[i] % 32];
  return out;
}

/** "7q2m-k9xw 4plt zc8r" → "7Q2MK9XW4PLTZC8R", or null when it isn't a code */
export function normalizeCode(text: unknown): string | null {
  const s = String(text ?? "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  return /^[A-Z2-7]{16}$/.test(s) ? s : null;
}

/** the code the way it's read out loud: 7Q2M-K9XW-4PLT-ZC8R */
export function formatCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, "$1-");
}

export interface HandoffState {
  code: string;
  /** when the switch went on (ISO) */
  since: string;
  /** this device's revision counter — goes up with every send */
  rev: number;
  /** fingerprint of what was last sent, so an unchanged workspace isn't re-sent */
  sentFp: string;
  sentAt: string;
  /** change sets already applied or discarded — never offered twice */
  seen: string[];
}

export function loadState(get: (k: string) => string | null): HandoffState | null {
  try {
    const s = JSON.parse(get(HANDOFF_STATE_KEY) ?? "null");
    return s && normalizeCode(s.code) ? { ...s, code: normalizeCode(s.code)!, seen: Array.isArray(s.seen) ? s.seen : [] } : null;
  } catch { return null; }
}

export function saveState(set: (k: string, v: string) => void, remove: (k: string) => void, s: HandoffState | null) {
  if (s) set(HANDOFF_STATE_KEY, JSON.stringify(s)); else remove(HANDOFF_STATE_KEY);
}

/** the mailbox's base URL, with a device override for tests */
export function mailboxUrl(get: (k: string) => string | null): string {
  const o = String(get(HANDOFF_URL_KEY) ?? "").trim();
  return (/^https?:\/\//.test(o) ? o : HANDOFF_URL).replace(/\/+$/, "");
}

/** has the switch been on longer than it's allowed to be? */
export function expired(since: string, now = Date.now()): boolean {
  const t = Date.parse(since);
  return !Number.isFinite(t) || now - t > AUTO_OFF_HOURS * 3600_000;
}

export interface HandoffPayload extends WorkspaceSnapshot {
  rev: number;
  device: string;
}

/** what the device sends: the workspace without the stores that stay home */
export function buildPayload(get: (k: string) => string | null, rev: number, device: string, now?: () => string): HandoffPayload {
  const snap = collectWorkspace(get, now);
  const stores: Record<string, string> = {};
  for (const [k, v] of Object.entries(snap.stores)) if (!HOME_ONLY_STORES.has(k)) stores[k] = v;
  return { ...snap, stores, rev, device };
}

/** fingerprint of what WOULD be sent — compared tick to tick */
export function payloadFingerprint(get: (k: string) => string | null): string {
  const snap = collectWorkspace(get);
  const stores: Record<string, string> = {};
  for (const [k, v] of Object.entries(snap.stores)) if (!HOME_ONLY_STORES.has(k)) stores[k] = v;
  return snapshotFingerprint(stores);
}

/** a change set Claude left in the mailbox */
export interface HandoffEdits {
  id: string;
  /** the device revision Claude's copy came from */
  baseRev: number;
  at: string;
  note?: string;
  stores: Record<string, string>;
}

export interface EditsSummary {
  rooms: number | null;
  schedules: number | null;
  nonSpace: number | null;
  /** the other stores in the change set, by plain name */
  others: string[];
  /** the device changed since Claude's copy — applying replaces those changes */
  stale: boolean;
}

const STORE_WORDS: Record<string, string> = {
  opsmatrix_v7_plans: "floor plans", opsmatrix_fusion_rules: "Scope rules", opsmatrix_fusion_aliases: "import aliases",
  opsmatrix_fusion_floorcare: "Floor Care", opsmatrix_fusion_routes: "Sanitation / Policing routes",
  opsmatrix_v7_demo_stamp: "demo stamp"
};

/** what a change set holds, in counts — the banner's words */
export function summarizeEdits(edits: HandoffEdits, currentRev: number): EditsSummary {
  const out: EditsSummary = { rooms: null, schedules: null, nonSpace: null, others: [], stale: Number(edits.baseRev) < currentRev };
  for (const [k, raw] of Object.entries(edits.stores ?? {})) {
    if (k === "opsmatrix_v7") {
      try {
        const v7 = JSON.parse(raw) ?? {};
        out.rooms = Array.isArray(v7.spaces) ? v7.spaces.length : 0;
        out.schedules = Array.isArray(v7.schedules) ? v7.schedules.filter((s: { projectNoteId?: unknown }) => !s?.projectNoteId).length : 0;
      } catch { out.rooms = 0; out.schedules = 0; }
    } else if (k === "opsmatrix_fusion_nonspace") {
      try { const list = JSON.parse(raw); out.nonSpace = Array.isArray(list) ? list.length : 0; } catch { out.nonSpace = 0; }
    } else if ((WORKSPACE_KEYS as readonly string[]).includes(k)) {
      out.others.push(STORE_WORDS[k] ?? k);
    }
  }
  return out;
}

/** a change set is a partial workspace — only the stores it carries are replaced, the pictures never */
export function applyEdits(edits: HandoffEdits, get: (k: string) => string | null, set: (k: string, v: string) => void): string[] {
  const stores: Record<string, string> = {};
  for (const [k, v] of Object.entries(edits.stores ?? {})) if (!HOME_ONLY_STORES.has(k)) stores[k] = v;
  return applyWorkspace({ format: WORKSPACE_FORMAT, exportedAt: edits.at, stores }, get, set);
}

// ── the mailbox, as the device talks to it ──────────────────────────────────

export interface MailboxStatus {
  exists: boolean;
  rev?: number;
  pushedAt?: string | null;
  size?: number;
  edits?: { id: string; at: string; note?: string; size: number; baseRev: number } | null;
}

export class Mailbox {
  constructor(private base: string, private code: string, private fetchFn: typeof fetch = (...a) => fetch(...a)) {}
  private url(leaf = "") { return `${this.base}/${this.code}${leaf ? "/" + leaf : ""}`; }
  async status(): Promise<MailboxStatus> {
    const r = await this.fetchFn(this.url("status"), { cache: "no-store" });
    if (!r.ok) throw new Error("mailbox answered " + r.status);
    return r.json();
  }
  async send(payload: HandoffPayload): Promise<{ rev: number }> {
    const r = await this.fetchFn(this.url(), {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload)
    });
    if (!r.ok) throw new Error(r.status === 413 ? "too much data for the mailbox" : "mailbox answered " + r.status);
    return r.json();
  }
  async edits(): Promise<HandoffEdits | null> {
    const r = await this.fetchFn(this.url("edits"), { cache: "no-store" });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("mailbox answered " + r.status);
    return r.json();
  }
  async clearEdits(): Promise<void> {
    await this.fetchFn(this.url("edits"), { method: "DELETE" });
  }
  async close(): Promise<void> {
    await this.fetchFn(this.url(), { method: "DELETE" });
  }
}

/** the name this device gives itself in the mailbox — never personal, just which screen */
export function deviceName(ua: string = navigator.userAgent): string {
  if (/iPad|Macintosh.*Mobile/.test(ua)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Electron/.test(ua)) return "Windows app";
  if (/Android/.test(ua)) return "Android";
  return "computer";
}
