// Apply confirmed intents: every one lands in the status layers, the right
// queue and the ledger through actions.ts — the same path a tap takes.
import type { HotelState, Space } from "../store";
import { spaceByNumber, uid, nowIso } from "../store";
import * as A from "../actions";
import type { Intent } from "./intents";

export interface ApplyResult { applied: number; skipped: { intent: Intent; why: string }[]; }

export function resolveRoom(state: HotelState, ref: string | undefined): Space | undefined {
  if (!ref) return undefined;
  const r = ref.trim();
  const direct = spaceByNumber(state, r);
  if (direct) return direct;
  // "Suite 420" → its first member; the actions fan out to the cluster where it matters
  const cl = state.clusters.find((c) => c.number.toLowerCase() === r.toLowerCase() || c.id === "cl-" + r.toLowerCase().replace(/\s+/g, "-"));
  if (cl) return state.spaces.find((s) => s.id === cl.memberIds[0]);
  const digits = r.replace(/\D/g, "");
  if (digits) return state.spaces.find((s) => s.number.replace(/\D/g, "") === digits && /^\d/.test(s.number));
  return undefined;
}

export function applyIntents(state: HotelState, intents: Intent[], by: string, transcript?: string): ApplyResult {
  const ctx = { by, source: "capture" as const };
  const res: ApplyResult = { applied: 0, skipped: [] };
  if (transcript) state.ledger.push({ id: uid("lg"), at: nowIso(), by, kind: "system", text: `Captured: "${transcript}"` });
  for (const it of intents) {
    const sp = resolveRoom(state, it.room);
    if (!sp && it.type !== "report_line" && it.type !== "note") { res.skipped.push({ intent: it, why: `room "${it.room ?? "?"}" not found` }); continue; }
    switch (it.type) {
      case "set_condition": if (!it.condition) { res.skipped.push({ intent: it, why: "no condition" }); continue; } A.setCondition(state, sp!, it.condition, ctx); break;
      case "create_work_order": A.createWorkOrder(state, sp!, it.text || it.readback, it.category ?? "other", ctx, { blocking: it.blocking, assignTo: it.staff }); break;
      case "assign": { const who = A.assign(state, sp!, it.staff ?? "", it.task ?? "departure", ctx); if (!who) { res.skipped.push({ intent: it, why: `nobody called "${it.staff}"` }); continue; } break; }
      case "inspect_pass": A.inspect(state, sp!, "pass", it.notes, ctx); break;
      case "inspect_fail": A.inspect(state, sp!, "fail", it.notes, ctx); break;
      case "flag":
        if (!it.flag) { res.skipped.push({ intent: it, why: "no flag" }); continue; }
        A.flag(state, sp!, it.flag, ctx, it.text);
        if (it.flag === "do_not_walk" && it.text === "out of order") A.setOutOfOrder(state, sp!, true, undefined, ctx);
        break;
      case "note": A.note(state, sp ?? null, it.text ?? it.readback, ctx); break;
      case "report_line": A.reportLine(state, it.text ?? it.readback, ctx, sp ?? null); break;
    }
    res.applied += 1;
  }
  return res;
}
