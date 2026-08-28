# OpsMatrix — API Attack Surface (Phase 8)

*Assessment date: 2026-08-28.*

---

## 1. There is no first-party API

OpsMatrix exposes **no server-side API endpoints of its own**. There is no backend, no serverless function, no gateway. Therefore the entire OWASP API Security Top 10 (BOLA, broken function-level auth, mass assignment on a server, SSRF, etc.) has **no first-party surface to test** — these are **N/A (no server)**, not PASS.

The only outbound API the application consumes is the **Anthropic Messages API**, called directly from the browser.

---

## 2. The one real API interaction: browser → Anthropic

| Property | Value | Evidence |
|---|---|---|
| METHOD / PATH | `POST https://api.anthropic.com/v1/messages` | `aiPlanImport.ts:20,191,270`; `roomTypeSuggest.ts:12` |
| Auth | `x-api-key: <user's key from localStorage>` | `aiPlanImport.ts:196,275` |
| Special header | `anthropic-dangerous-direct-browser-access: true` | `aiPlanImport.ts:198,278` |
| Input | user-uploaded image (base64) + fixed prompt (`PLAN_PROMPT`/`LOCATE_PROMPT`); or unclassified room-type name strings | `aiPlanImport.ts:204-211`; `roomTypeSuggest.ts` |
| Output | schema-constrained JSON (`output_config.format.type = "json_schema"`) | `aiPlanImport.ts:203,286` |
| Sensitive data crossing | YES — the uploaded image (potential PHI) and the API key | see `DATA_FLOW_AND_PHI_ANALYSIS.md` |
| Rate limit (client-side) | **None** — no throttle/debounce on repeated calls | no rate-limit code found |
| Tenant check | N/A (no tenants) | — |

### Findings on this path
- **F-API-1 — Cost/abuse exposure (Medium).** There is no client-side rate limiting, request budgeting, or confirmation on the AI calls. A user (or a script running in the user's page) can issue unlimited `POST`s that spend the user's Anthropic quota. Because the key is the *user's own*, this is self-inflicted cost risk plus a lever for a malicious page/extension to drain the user's balance. Server-side controls are impossible without a server. **Remediation:** add a client-side per-minute cap and a visible confirm for large/batched reads; ultimately, route AI through a first-party proxy that enforces quotas (also required to fix retention/BAA).
- **F-API-2 — `dangerous-direct-browser-access` (Informational→by-design).** This header is *required* to call Anthropic from a browser at all and is used as intended. It is not itself a vulnerability, but it *is* the architectural marker that the app has chosen a keys-in-browser design with all the key-exposure consequences in `SECRETS_AUDIT.md`.
- **Output handling (good).** Responses are schema-constrained and the parsers defensively sanitize/clamp everything (`sanitizeRooms`, `sanitizeBox`, `normalizeCoordinateScale`, `dropZoneWrappers` — `aiPlanImport.ts:156-175,325-466`). The app does **not** `eval` or DOM-inject model output; it uses it only as numeric geometry and text labels. This substantially limits prompt-injection blast radius on the plan-reader path (see `AI_SECURITY_RED_TEAM_REPORT.md`).

---

## 3. The dormant Supabase API (not deployed)

`supabase/migrations/0001_init.sql` defines a full multi-tenant REST/RLS surface (PostgREST-style), and `src/auth/` wires a Supabase client. **It is inert in production** (`supabase = null`, `supabaseClient.ts:8`). If it were ever activated, the RLS policies would become the entire authorization boundary — see `AUTHORIZATION_AND_TENANT_ISOLATION` notes in `OWASP_ASVS_MATRIX.md` and the schema review below.

### Schema review (for the day it is turned on)
- Every domain table carries `organization_id` and has RLS enabled (`0001_init.sql:169-181`). Select policies scope to `current_org_id()`; insert/update policies additionally require `current_role_name() = 'director'` for most tables (`0001_init.sql:184-209`). This is a **reasonable tenant-isolation design on paper**.
- **Unverified / must-test-before-use:** the policies were never activated, never migration-tested, and never pen-tested against a live Postgres. `current_org_id()`/`current_role_name()` are `SECURITY`-sensitive `sql` functions reading `profiles` by `auth.uid()`; their `SECURITY DEFINER`/search_path settings and the `staff` role's read/write scope need live verification. The `profiles_select` policy allows reading any profile in your org (`0001_init.sql:190-191`) — acceptable, but confirm it does not leak cross-org via the `organizations(name)` join used in `AuthContext.tsx`. **Do not treat the RLS as proven until it is deployed and tested.**

---

## 4. HTTP methods / misc

- No first-party endpoints → no verb tampering, no content-type confusion, no parameter pollution surface on a server.
- Static hosting responds to `GET`/`HEAD` only; `deploy.yml` publishes immutable static assets.
- The service worker (`sw.js`) only intercepts same-origin GETs and never caches POSTs or cross-origin (Anthropic) requests (`sw.js:29-34`) — no cache-poisoning of API responses.

---

## 5. Verdict

| Area | Status |
|---|---|
| First-party API endpoints | N/A — none exist |
| Anthropic egress: auth model | PARTIAL — key in browser (see secrets) |
| Anthropic egress: rate/cost control | FAIL — no client-side limiting (F-API-1) |
| Anthropic egress: output handling | PASS — schema-constrained, sanitized, not eval'd/injected |
| Dormant Supabase API | N/A (inert); RLS design reasonable but UNVERIFIED |
