// "Ask Max about these room names" — Fable-assisted room-type suggestions
// for source names the deterministic rules could not place.
//
// This NEVER runs automatically: classification stays deterministic
// (approved alias → library match → rule table), and this helper is invoked
// only when the user presses the button in Space Validation. Its answers are
// SUGGESTIONS the user approves; approvals are saved as aliases so the same
// question is never asked twice. Same API, key and conventions as the floor
// plan reader — no second AI provider, no second key.
import { AiPlanError, anthropicRequest, type AiProxy } from "./aiPlanImport";

const MODEL = "claude-fable-5";

export interface SuggestOptions {
  apiKey: string;
  /** cloud builds: route through the server-side proxy instead of the key */
  proxy?: AiProxy | null;
  /** source room names that need a home, e.g. ["FLUORO CONTROL", "PACS"] */
  names: string[];
  /** the account's Room Type labels, exactly as they exist in Scope */
  typeLabels: string[];
  signal?: AbortSignal;
}

function suggestSchema(typeLabels: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["suggestions"],
    properties: {
      suggestions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["sourceName", "roomType"],
          properties: {
            sourceName: { type: "string" },
            // "none" = Claude cannot tell either — the room stays unclassified
            roomType: { type: "string", enum: [...typeLabels, "none"] }
          }
        }
      }
    }
  };
}

const PROMPT = (names: string[], labels: string[]) =>
  `These are room names from a hospital CAD/location export. They use ` +
  `facility-drawing abbreviations (for example "MECH RM.", "ELEC CL.", ` +
  `"PAT. TLT." are a mechanical room, an electrical closet and a patient toilet).\n\n` +
  `For each name, pick the ONE best matching room type from this exact list, ` +
  `or "none" if you genuinely cannot tell:\n${labels.join(", ")}\n\n` +
  `Answer for every name. Do not invent new types.\n\nRoom names:\n` +
  names.map((n) => `- ${n}`).join("\n");

/**
 * Returns sourceName → suggested type label (or null for "none").
 * Throws AiPlanError with a plain-English message on any failure.
 */
export async function suggestRoomTypes(opts: SuggestOptions): Promise<Map<string, string | null>> {
  const key = (opts.apiKey || "").trim();
  if (!key && !opts.proxy) throw new AiPlanError("No Anthropic API key saved yet. Save one first — one time only.");
  const names = [...new Set(opts.names.map((n) => n.trim()).filter(Boolean))].slice(0, 200);
  if (!names.length) return new Map();

  const t = anthropicRequest(key, opts.proxy, "room-types");
  let res: Response;
  try {
    res = await fetch(t.url, {
      method: "POST",
      signal: opts.signal,
      headers: t.headers,
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: suggestSchema(opts.typeLabels) }
        },
        messages: [{ role: "user", content: [{ type: "text", text: PROMPT(names, opts.typeLabels) }] }]
      })
    });
  } catch {
    throw new AiPlanError("Could not reach Claude. Check the internet connection and try again.");
  }
  if (!res.ok) {
    if (res.status === 401) throw new AiPlanError("That API key was rejected. Check it and try again.");
    if (res.status === 429) throw new AiPlanError("Claude is rate-limited right now. Wait a minute and try again.");
    throw new AiPlanError("Claude could not answer right now. Try again in a moment.");
  }
  const json = await res.json();
  if (json.stop_reason === "refusal") throw new AiPlanError("Claude declined to classify these names.");
  const text = (json.content || [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text).join("");
  let parsed: { suggestions?: { sourceName: string; roomType: string }[] };
  try { parsed = JSON.parse(text); } catch {
    throw new AiPlanError("Claude's answer was not readable. Try again.");
  }
  const out = new Map<string, string | null>();
  for (const s of parsed.suggestions ?? []) {
    if (!s?.sourceName) continue;
    out.set(s.sourceName, s.roomType === "none" ? null : s.roomType);
  }
  return out;
}
