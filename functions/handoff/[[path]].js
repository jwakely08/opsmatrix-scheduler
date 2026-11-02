// The "Help from Claude" mailbox (Josh, 2026-11-02: "I want you to be able to edit the schedules for
// me currently on the OpsMatrix iPad session, at request only… find an on/off switch").
//
// A Cloudflare Pages Function in front of one KV namespace (binding HANDOFF). When Josh flips the
// switch ON in the app, the device makes an unguessable 16-character code and keeps its workspace
// here under that code; Claude, told the code in chat, reads it, edits, and leaves the changes here;
// the device offers them and applies them only when Josh taps Apply. OFF deletes everything. Every
// entry expires on its own after TTL_SECONDS, whatever happens.
//
//   GET    /handoff/<code>/status   → { exists, rev, pushedAt, size, edits: { id, at, note, size } | null }
//   PUT    /handoff/<code>          ← the device's workspace { format, exportedAt, stores, rev, device }
//   GET    /handoff/<code>          → that workspace (Claude)
//   PUT    /handoff/<code>/edits    ← Claude's changes { id, baseRev, at, note, stores }
//   GET    /handoff/<code>/edits    → those changes (the device), 404 when there are none
//   DELETE /handoff/<code>/edits    → the changes are gone (applied or discarded)
//   DELETE /handoff/<code>          → everything under the code is gone (the switch went OFF)
//
// No account, no login: the code IS the key, so it is long (80 bits), and a wrong one answers 404.
// Browsers may call this only from the OpsMatrix origins below; a plain client (curl) has no Origin
// and is let through. Nothing here reads the data.

const TTL_SECONDS = 48 * 3600;
/** KV values top out at 25 MiB; a workspace without floor pictures is a few MB */
const MAX_BYTES = 20 * 1024 * 1024;
const CODE = /^[A-Z2-7]{16}$/;

const ORIGINS = [
  "https://jwakely08.github.io",
  "https://staging.opsmatrix.pages.dev",
  "https://opsmatrix.pages.dev",
  "opsmatrix://app"
];
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function cors(origin) {
  const h = { "cache-control": "no-store", "vary": "origin" };
  if (origin && (ORIGINS.includes(origin) || LOCAL.test(origin))) {
    h["access-control-allow-origin"] = origin;
    h["access-control-allow-methods"] = "GET,PUT,DELETE,OPTIONS";
    h["access-control-allow-headers"] = "content-type";
    h["access-control-max-age"] = "86400";
  }
  return h;
}

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "content-type": "application/json" } });

/** "7Q2M-K9XW-4PLT-ZC8R" or "7q2mk9xw4pltzc8r" → "7Q2MK9XW4PLTZC8R", or null */
function codeOf(seg) {
  const s = String(seg ?? "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  return CODE.test(s) ? s : null;
}

export async function onRequest({ request, env, params }) {
  const origin = request.headers.get("origin");
  const headers = cors(origin);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  // a browser from somewhere else gets nothing (no CORS headers) — and nothing more to go on
  if (origin && !headers["access-control-allow-origin"]) return new Response(null, { status: 403 });

  const kv = env.HANDOFF;
  if (!kv) return json({ error: "mailbox not set up" }, 503, headers);

  const parts = Array.isArray(params.path) ? params.path : String(params.path ?? "").split("/").filter(Boolean);
  const code = codeOf(parts[0]);
  const leaf = parts[1] ?? "";
  if (!code || parts.length > 2 || (leaf && leaf !== "status" && leaf !== "edits")) {
    return json({ error: "not found" }, 404, headers);
  }
  const WS = "ws:" + code, ED = "ed:" + code, META = "meta:" + code;
  const now = new Date().toISOString();
  const readMeta = async () => (await kv.get(META, "json")) ?? null;
  const putJson = (key, value) => kv.put(key, JSON.stringify(value), { expirationTtl: TTL_SECONDS });

  if (request.method === "GET") {
    if (leaf === "status") {
      const meta = await readMeta();
      return json(meta ? { exists: true, ...meta } : { exists: false }, 200, headers);
    }
    const raw = await kv.get(leaf === "edits" ? ED : WS);
    if (raw === null) return json({ error: "nothing here" }, 404, headers);
    return new Response(raw, { status: 200, headers: { ...headers, "content-type": "application/json" } });
  }

  if (request.method === "PUT") {
    if (leaf === "status") return json({ error: "not found" }, 404, headers);
    const len = Number(request.headers.get("content-length") || 0);
    if (len > MAX_BYTES) return json({ error: "too big" }, 413, headers);
    const raw = await request.text();
    if (raw.length > MAX_BYTES) return json({ error: "too big" }, 413, headers);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: "not JSON" }, 400, headers); }
    if (!body || typeof body !== "object" || !body.stores || typeof body.stores !== "object") {
      return json({ error: "no stores" }, 400, headers);
    }
    const meta = (await readMeta()) ?? { rev: 0, pushedAt: null, size: 0, edits: null };
    if (leaf === "edits") {
      // Claude's changes: an id so the device offers each set once, and the revision they were based on
      const id = String(body.id ?? "").slice(0, 64) || now;
      const edits = { ...body, id, at: now };
      await putJson(ED, edits);
      meta.edits = { id, at: now, note: String(body.note ?? "").slice(0, 300), size: raw.length, baseRev: Number(body.baseRev) || 0 };
      await putJson(META, meta);
      return json({ ok: true, id, rev: meta.rev }, 200, headers);
    }
    // the device's workspace, refreshed on every change it makes
    await kv.put(WS, raw, { expirationTtl: TTL_SECONDS });
    meta.rev = Number(body.rev) || meta.rev + 1;
    meta.pushedAt = now;
    meta.size = raw.length;
    meta.device = String(body.device ?? "").slice(0, 80);
    await putJson(META, meta);
    return json({ ok: true, rev: meta.rev, edits: meta.edits }, 200, headers);
  }

  if (request.method === "DELETE") {
    if (leaf === "status") return json({ error: "not found" }, 404, headers);
    if (leaf === "edits") {
      const meta = await readMeta();
      await kv.delete(ED);
      if (meta) { meta.edits = null; await putJson(META, meta); }
      return json({ ok: true }, 200, headers);
    }
    await Promise.all([kv.delete(WS), kv.delete(ED), kv.delete(META)]);
    return json({ ok: true }, 200, headers);
  }

  return json({ error: "method not allowed" }, 405, headers);
}
