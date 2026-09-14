// READY CONFIDENCE — the engine service behind every arrival room's
// walk / hold / do-not-walk verdict. Pure: state + a clock in, verdict out.
//
// HARD RULES (tested in verdict.test.ts):
//   • a stale or missing REQUIRED signal never produces green — it produces
//     Unknown, with the stale signal named
//   • a disconnected adapter paints every room Unknown immediately
//   • the front desk cannot override; a GM may override a HOLD (yellow) with
//     a logged reason — never a red, never an unknown
//   • a suite (cluster) shows the WORST of its members
import type { HotelState, RoomStatus, Space } from "./store";
import { statusFor, openWorkOrders, clusterOf } from "./store";
import type { VerdictLevel } from "./theme";

export interface Verdict {
  level: VerdictLevel;
  /** plain-English reasons, worst first */
  reasons: string[];
  /** which required signals were stale/missing (why it is Unknown) */
  stale: string[];
  /** true when a GM override lifted a hold */
  overridden: boolean;
}

const RANK: Record<VerdictLevel, number> = { green: 0, yellow: 1, red: 2, unknown: 3 };

function ageMin(iso: string | undefined, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (now - t) / 60000;
}

/** verdict for ONE space (a cluster member is judged alone here) */
export function spaceVerdict(state: HotelState, sp: Space, now = Date.now()): Verdict {
  const st: RoomStatus = statusFor(state, sp.id);
  const fresh = state.settings.freshnessMin;
  const reasons: string[] = [];
  const stale: string[] = [];

  if (!state.settings.adapter.connected) {
    return { level: "unknown", reasons: ["Status feed disconnected — nothing is trusted until it reconnects"], stale: ["feed"], overridden: false };
  }

  // required signals: condition, occupancy, engineering — each must exist AND be fresh
  const check = (name: string, iso: string | undefined, limit: number) => {
    const a = ageMin(iso, now);
    if (a === null) stale.push(`${name} never confirmed`);
    else if (a > limit) stale.push(`${name} last confirmed ${Math.round(a)} min ago (limit ${limit})`);
  };
  check("Condition", st.condition?.at, fresh.condition);
  check("Occupancy", st.occupancy?.at, fresh.occupancy);
  check("Engineering", st.engineering?.at, fresh.engineering);
  if (stale.length) {
    return { level: "unknown", reasons: stale.map((s) => `Unknown — ${s}`), stale, overridden: false };
  }

  const cond = st.condition!.value;
  const wos = openWorkOrders(state, sp.id);
  const cur: { level: VerdictLevel } = { level: "green" };
  const worse = (l: VerdictLevel, why: string) => { if (RANK[l] > RANK[cur.level]) cur.level = l; reasons.push(why); };

  if (st.engineering!.ooo) worse("red", `Out of order${st.engineering!.reason ? ": " + st.engineering!.reason : ""}`);
  if (st.flags.doNotWalk) worse("red", "Flagged do not walk");
  for (const w of wos) {
    if (w.blocking) worse("red", `Open work order blocks the room: ${w.text}`);
    else worse("yellow", `Open work order: ${w.text}`);
  }
  if (cond === "dirty") worse("red", "Room is dirty");
  else if (cond === "in_progress") worse("red", "Being cleaned right now");
  else if (cond === "pickup") worse("yellow", "Needs a pickup");
  else if (cond === "clean") worse("yellow", "Clean but not yet inspected");
  else if (cond === "inspected") {
    // an inspection only counts if it passed AFTER the condition last changed
    const insp = st.inspection;
    const condT = new Date(st.condition!.since ?? st.condition!.at).getTime();
    if (!insp) worse("yellow", "Marked inspected but no inspection on record");
    else if (insp.result === "fail") worse("yellow", "Last inspection failed");
    else if (new Date(insp.at).getTime() < condT - 60000) worse("yellow", "Inspection is older than the last condition change");
  }
  if (st.inspection?.result === "fail" && cond !== "inspected") {
    const t = new Date(st.inspection.at).getTime();
    if (t >= new Date(st.condition!.since ?? st.condition!.at).getTime() - 60000) worse("yellow", `Failed inspection: ${st.inspection.notes ?? "needs re-clean"}`);
  }
  if (cur.level === "green") reasons.push("Inspected and ready — walk the guest");

  // GM override: lifts a HOLD only, and only with a logged reason
  let overridden = false;
  if (cur.level === "yellow" && st.override && st.override.level === "green" && st.override.reason) {
    cur.level = "green";
    overridden = true;
    reasons.unshift(`Hold overridden by ${st.override.by}: ${st.override.reason}`);
  }
  return { level: cur.level, reasons, stale, overridden };
}

/** the guest-facing verdict: a cluster reports the WORST of its members */
export function verdictFor(state: HotelState, sp: Space, now = Date.now()): Verdict {
  const cl = clusterOf(state, sp);
  if (!cl) return spaceVerdict(state, sp, now);
  const members = cl.memberIds.map((id) => state.spaces.find((x) => x.id === id)).filter((m): m is Space => Boolean(m));
  if (!members.length) return { level: "unknown", reasons: ["Suite has no rooms"], stale: ["members"], overridden: false };
  const judged = members.map((m) => { const v = spaceVerdict(state, m, now); return { ...v, reasons: v.reasons.map((r) => `${m.name}: ${r}`) }; });
  const worst = judged.reduce((a, b) => (RANK[b.level] > RANK[a.level] ? b : a));
  return { ...worst, reasons: judged.flatMap((j) => j.reasons).sort((a, b) => (worst.reasons.includes(a) ? -1 : 0) - (worst.reasons.includes(b) ? -1 : 0)) };
}

/** minutes until the promised check-in (negative = already late); null when no promise */
export function minutesToPromise(st: RoomStatus, now = Date.now()): number | null {
  if (!st.flags.promisedAt) return null;
  const t = new Date(st.flags.promisedAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.round((t - now) / 60000);
}

/** arrival rooms (one row per guest-facing unit: a suite is one row) */
export function arrivalUnits(state: HotelState): { key: string; label: string; floor: string; spaces: Space[]; status: RoomStatus }[] {
  const seen = new Set<string>();
  const out: { key: string; label: string; floor: string; spaces: Space[]; status: RoomStatus }[] = [];
  for (const sp of state.spaces) {
    const st = statusFor(state, sp.id);
    if (st.occupancy?.value !== "arriving") continue;
    const cl = clusterOf(state, sp);
    const key = cl ? cl.id : sp.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const spaces = cl ? state.spaces.filter((x) => x.clusterId === cl.id) : [sp];
    out.push({ key, label: cl ? cl.number : sp.number, floor: sp.floor, spaces, status: st });
  }
  return out.sort((a, b) => (new Date(a.status.flags.promisedAt ?? 0).getTime()) - (new Date(b.status.flags.promisedAt ?? 0).getTime()));
}
