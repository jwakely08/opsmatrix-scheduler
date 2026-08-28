// claude-proxy — the ONLY place a production Anthropic key lives.
//
// Browser (signed-in OpsMatrix user) → this function → api.anthropic.com.
// The browser sends its Supabase session token; the function:
//   1. CORS-checks the origin against ALLOWED_ORIGINS
//   2. verifies the session and looks up the user's organization
//   3. enforces the org's monthly token budget (AI_MONTHLY_TOKEN_BUDGET)
//   4. forwards the request body UNTOUCHED with the server-held key
//   5. records usage per organization in ai_usage (service role — clients
//      cannot write that table, by RLS design)
//
// It never logs request or response contents — only token counts.
//
// Deploy with JWT verification handled HERE (config.toml sets
// verify_jwt = false so browser preflights work; auth is enforced below).
//
// Function secrets (supabase secrets set …):
//   ANTHROPIC_API_KEY        — the environment's workspace-scoped key
//   ALLOWED_ORIGINS          — comma-separated page origins allowed to call
//   AI_MONTHLY_TOKEN_BUDGET  — per-org input+output tokens/month (default 20M)
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are provided
// automatically by the platform.)
import { createClient } from "npm:@supabase/supabase-js@2";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type, anthropic-version, x-opsmatrix-feature",
    "access-control-allow-methods": "POST, OPTIONS",
    "vary": "origin"
  };
}

function reply(status: number, body: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" }
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const originOk = allowed.length === 0 || allowed.includes(origin);
  const cors = corsHeaders(originOk ? (origin || "*") : "null");

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (!originOk) return reply(403, { error: { message: "This origin may not use the OpsMatrix AI service." } }, cors);

  // GET = health/config sanity check (booleans and lengths ONLY — never
  // secret values). `curl <url>` answers "is this function configured?"
  if (req.method === "GET") {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    return reply(200, {
      ok: true,
      has_anthropic_key: typeof key === "string" && key.length > 0,
      anthropic_key_length: key ? key.length : 0,
      allowed_origins: allowed,
      force_model: (Deno.env.get("FORCE_MODEL") ?? "claude-fable-5").trim(),
      monthly_token_budget: Number(Deno.env.get("AI_MONTHLY_TOKEN_BUDGET") ?? "20000000")
    }, cors);
  }
  if (req.method !== "POST") return reply(405, { error: { message: "POST only." } }, cors);

  // ── who is asking, and which organization do they belong to ──
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("authorization") ?? "" } }
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return reply(401, { error: { message: "Sign in to OpsMatrix to use Max." } }, cors);
  }
  const service = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const prof = await service.from("profiles").select("organization_id")
    .eq("user_id", userData.user.id).maybeSingle();
  if (prof.error || !prof.data) {
    return reply(403, { error: { message: "Join or create your organization first." } }, cors);
  }
  const orgId = prof.data.organization_id as string;

  // ── monthly budget: the brake that makes a runaway impossible ──
  const budget = Number(Deno.env.get("AI_MONTHLY_TOKEN_BUDGET") ?? "20000000");
  const monthStart = new Date();
  monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const usage = await service.from("ai_usage")
    .select("input_tokens, output_tokens")
    .eq("organization_id", orgId)
    .gte("created_at", monthStart.toISOString());
  if (!usage.error) {
    const spent = (usage.data ?? []).reduce(
      (s, r) => s + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0);
    if (spent >= budget) {
      return reply(429, { error: {
        type: "rate_limit_error",
        message: "This organization's AI allowance for the month is used up. It resets on the 1st — or contact OpsMatrix to raise it."
      } }, cors);
    }
  }

  // ── forward with the model PINNED; the key exists only here ──
  // The administrator decides which model OpsMatrix runs on — clients cannot
  // choose. FORCE_MODEL secret overrides the default; set it to "" to allow
  // client-selected models (not recommended).
  const feature = (req.headers.get("x-opsmatrix-feature") ?? "messages").slice(0, 40);
  const forceModel = (Deno.env.get("FORCE_MODEL") ?? "claude-fable-5").trim();
  let body = await req.text();
  if (forceModel) {
    try {
      const j = JSON.parse(body);
      j.model = forceModel;
      body = JSON.stringify(j);
    } catch { /* unparseable — forward as-is; Anthropic will reject it anyway */ }
  }
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    console.error("claude-proxy: ANTHROPIC_API_KEY secret is missing or empty");
    return reply(502, { error: { message: "The AI service is not configured yet (missing server key). Contact OpsMatrix." } }, cors);
  }
  let upstream: Response;
  try {
    upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": req.headers.get("anthropic-version") ?? "2023-06-01"
      },
      body
    });
  } catch (e) {
    // reason only — never request/response contents
    console.error("claude-proxy: upstream fetch failed:", String((e as Error)?.message ?? e));
    return reply(502, { error: { message: "Could not reach Claude. Try again in a moment." } }, cors);
  }

  const contentType = upstream.headers.get("content-type") ?? "application/json";

  if (contentType.includes("application/json")) {
    const text = await upstream.text();
    // meter from the response's own usage block; never log contents
    try {
      const j = JSON.parse(text);
      await service.from("ai_usage").insert({
        organization_id: orgId,
        user_id: userData.user.id,
        endpoint: feature,
        model: String(j?.model ?? ""),
        input_tokens: Number(j?.usage?.input_tokens ?? 0),
        output_tokens: Number(j?.usage?.output_tokens ?? 0)
      });
    } catch { /* unparseable (error body) — still return it faithfully */ }
    return new Response(text, { status: upstream.status, headers: { ...cors, "content-type": contentType } });
  }

  // streaming (SSE) — pipe through; record the request without token counts
  await service.from("ai_usage").insert({
    organization_id: orgId,
    user_id: userData.user.id,
    endpoint: feature + "-stream",
    model: "", input_tokens: 0, output_tokens: 0
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { ...cors, "content-type": contentType }
  });
});
