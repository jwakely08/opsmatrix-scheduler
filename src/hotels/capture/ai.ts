// The Claude parser: transcript + context → intents, schema-constrained.
// Mirrors the hospital app's proven direct-browser request (raw fetch, the
// user's own key saved on the device, output_config.format JSON schema).
// Falls back to the local grammar on any failure — capture never stalls.
import type { Intent, CaptureContext } from "./intents";
import { INTENT_SCHEMA } from "./intents";
import { parseLocal } from "./parse";

/** same model the hospital OpsMatrix pins (src/bridge/aiPlanImport.ts AI_MODEL) */
export const AI_MODEL = "claude-fable-5";
export const API_URL = "https://api.anthropic.com/v1/messages";

export const SYSTEM = [
  "You turn what a hotel rooms manager says on a walk into structured intents for OpsMatrix Hotels.",
  "Intent types: set_condition (dirty | in_progress | clean | inspected | pickup), create_work_order (category hvac | plumbing | electrical | furniture | minibar | tv | housekeeping | other; blocking=true only if the room cannot be sold), assign (staff = a name from the roster; task from the person's role unless stated), inspect_pass, inspect_fail (notes = what failed), flag (do_not_walk | walk_ok | vip | not_vip — 'pull it from arrivals' means do_not_walk), note, report_line (something said for the handover, not about one room's state).",
  "Rules: the room carries across clauses — 'it' means the last room mentioned, or the current room if none. One utterance can produce several intents; emit every action separately, in the order spoken. Use ONLY room numbers and staff names from the context; if a room is not in the list, keep what was said and lower the confidence. confidence is 0–1: how sure you are this is what was meant. readback is one plain-English line like '412 → AC blowing warm → work order → Engineering (Marco)'. Never invent actions that were not said. If nothing actionable was said, emit one low-confidence note."
].join("\n");

export function buildIntentRequest(transcript: string, ctx: CaptureContext) {
  const context = [
    `Hotel: ${ctx.hotelName ?? "this property"}. Current floor: ${ctx.floor ?? "unknown"}. Current room: ${ctx.currentRoom ?? "none"}.`,
    `Rooms and spaces: ${ctx.rooms.join(", ")}.`,
    `Staff: ${ctx.staff.map((s) => `${s.name} (${s.role})`).join(", ")}.`,
    ctx.openWorkOrders?.length ? `Open work orders: ${ctx.openWorkOrders.map((w) => `${w.room}: ${w.text}`).join("; ")}.` : ""
  ].filter(Boolean).join("\n");
  return {
    model: AI_MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    output_config: { effort: "low", format: { type: "json_schema", schema: INTENT_SCHEMA } },
    messages: [{ role: "user", content: `${context}\n\nThe manager said: "${transcript}"` }]
  };
}

export function requestHeaders(apiKey: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey.trim(),
    "anthropic-version": "2023-06-01",
    // required for calling the API straight from a browser page
    "anthropic-dangerous-direct-browser-access": "true"
  };
}

/** clean a model reply into Intents (drops anything off-contract) */
export function sanitizeIntents(raw: unknown): Intent[] {
  const list = (raw as { intents?: unknown[] })?.intents;
  if (!Array.isArray(list)) return [];
  const TYPES = new Set(["set_condition", "create_work_order", "assign", "inspect_pass", "inspect_fail", "note", "flag", "report_line"]);
  const out: Intent[] = [];
  for (const x of list as Record<string, unknown>[]) {
    if (!x || !TYPES.has(String(x.type))) continue;
    const conf = Math.max(0, Math.min(1, Number(x.confidence)));
    out.push({
      type: x.type as Intent["type"], room: x.room ? String(x.room) : undefined,
      confidence: Number.isFinite(conf) ? conf : 0.5,
      readback: String(x.readback ?? "").slice(0, 200) || `${x.room ?? ""} ${x.type}`,
      condition: x.condition as Intent["condition"], text: x.text ? String(x.text) : undefined,
      category: x.category as Intent["category"], blocking: Boolean(x.blocking),
      staff: x.staff ? String(x.staff) : undefined, task: x.task as Intent["task"],
      flag: x.flag as Intent["flag"], notes: x.notes ? String(x.notes) : undefined
    });
  }
  return out;
}

export type ParseResult = { intents: Intent[]; engine: "claude" | "local"; error?: string };

export async function parseWithClaude(transcript: string, ctx: CaptureContext, apiKey: string, signal?: AbortSignal): Promise<ParseResult> {
  try {
    const res = await fetch(API_URL, { method: "POST", signal, headers: requestHeaders(apiKey), body: JSON.stringify(buildIntentRequest(transcript, ctx)) });
    if (!res.ok) {
      const why = res.status === 401 ? "the saved API key was rejected" : res.status === 429 ? "Max is busy (rate limit)" : `Max could not answer (${res.status})`;
      return { intents: parseLocal(transcript, ctx), engine: "local", error: why };
    }
    const json = await res.json();
    if (json.stop_reason === "refusal") return { intents: parseLocal(transcript, ctx), engine: "local", error: "Max declined that one" };
    const text = (json.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
    const intents = sanitizeIntents(JSON.parse(text));
    if (!intents.length) return { intents: parseLocal(transcript, ctx), engine: "local", error: "Max heard nothing actionable" };
    return { intents, engine: "claude" };
  } catch (e) {
    return { intents: parseLocal(transcript, ctx), engine: "local", error: e instanceof Error && e.name === "AbortError" ? undefined : "could not reach Max — read locally" };
  }
}

/** the one entry point screens call: Claude when a key exists, the local grammar otherwise */
export async function parseUtterance(transcript: string, ctx: CaptureContext, apiKey: string | null, signal?: AbortSignal): Promise<ParseResult> {
  if (!apiKey) return { intents: parseLocal(transcript, ctx), engine: "local" };
  return parseWithClaude(transcript, ctx, apiKey, signal);
}
