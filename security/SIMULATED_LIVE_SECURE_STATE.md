# OpsMatrix — Simulated "Live & Secure" State (TARGET / PROJECTION — NOT A VERIFIED RESULT)

> ## ⚠️ READ THIS FIRST — WHAT THIS DOCUMENT IS AND IS NOT
>
> **This is a projection, not an assessment.** As of 2026-08-28, the deployed OpsMatrix is a client-side static app with no backend; the secure architecture described here **does not exist in this repository and has not been tested.** This document simulates what the security report *would* look like **once specific controls are actually built AND independently verified.**
>
> - Every ✅ below is **conditional** and carries a "**PROVE IT**" line naming the evidence that must exist before that ✅ is real.
> - **Do not share this document with a hospital, customer, or auditor** as if it described the running system. It describes a *goal*. Sharing it as fact would be misrepresentation.
> - The honest, evidence-based assessment of what exists **today** is in `MASTER_SECURITY_ASSESSMENT.md` and its siblings. That one is real. This one is a blueprint.
>
> Assumed target architecture (the path your repo already points to):
> **Supabase** (Postgres + Supabase Auth + Row-Level Security, per `supabase/migrations/0001_init.sql`) as the backend; a **first-party AI proxy** (small server function) that holds the Anthropic key and calls the API under a **BAA with zero data retention**; hosting on a platform that permits **response headers** (Cloudflare Pages / Netlify / Vercel with headers, or an edge in front of Pages); **MFA/SSO** via Supabase Auth or an IdP. If your real stack differs, tell me and I'll re-simulate against it — the controls change with the platform.

---

## Simulated Overall Rating: **B+ (Strong) — pilot-ready with conditions**

*(Why B+ and not A: even a well-built v1 of this design would still owe a health system an independent third-party pen test, a completed BAA chain, and a period of audit-log/DR evidence before "A — enterprise hardened." Those take calendar time and an outside auditor, not just code. A vendor claiming "A" on day one is a red flag to a CISO; "B+, here's our roadmap to A" reads as mature.)*

**Simulated answer — "Can I pilot with a hospital?"** → **YES, WITH CONDITIONS** (the conditions are the PROVE-IT lines below plus a signed BAA and a limited-scope pilot agreement).

**Simulated answer — "Can it process ePHI?"** → **YES, WITH CONDITIONS**, once the BAA chain and the technical controls below are verified. Note: even then, keep to the *minimum necessary* — OpsMatrix is an operations tool, and the less PHI it ever touches, the smaller your risk surface.

---

## 1. Simulated Executive Scorecard

| Category | Today (real) | Simulated (target) | What earns the target score — PROVE IT |
|---|---:|---:|---|
| Authentication | 5 | **90** | Supabase Auth (or SSO/SAML) enforced on every route; **MFA required**. PROVE IT: a login gate exists; an unauthenticated request to any data API returns 401; MFA enrollment enforced for privileged roles; screenshot + automated test. |
| Authorization | 5 | **88** | Server-enforced RBAC (`director/supervisor/staff`) + RLS. PROVE IT: a `staff` token is *rejected* server-side when attempting a `director` action — demonstrated with a real request, not the client `can()` helper. |
| Tenant Isolation | 10 | **90** | RLS on `organization_id` on every table (already designed in `0001_init.sql:169-209`). PROVE IT: **live** test — Org A's token cannot read/write any Org B row via the REST API, tried against every table, including the `organizations(name)` join. This is the #1 thing a hospital will try to break. |
| API Security | 30 | **85** | All data behind the authenticated Supabase/PostgREST layer + a rate-limited AI proxy. PROVE IT: BOLA/IDOR tests pass on every object ID; rate limits observed; no direct browser→Anthropic call remains. |
| Web Security | 25 | **88** | Strict CSP (`script-src 'self'`), `frame-ancestors 'none'`, HSTS, `X-Content-Type-Options`, Referrer-Policy, Permissions-Policy. PROVE IT: a headers scan (e.g. securityheaders.com A/A+) + framing blocked. |
| Data Protection | 15 | **85** | Encryption at rest (Supabase/Postgres); ePHI minimized; AI payloads scrubbed. PROVE IT: at-rest encryption confirmed with the provider; no sensitive data in localStorage; DLP check on AI payloads. |
| Cryptography | 35 | **85** | TLS everywhere (already), managed keys, no homemade crypto (already). PROVE IT: TLS config (A on SSL Labs), documented key management. |
| Secrets Management | 55 | **90** | Provider key lives **only** server-side in the proxy's secret store; never in the browser. PROVE IT: browser holds no provider key; secret in a managed vault; CI secret-scan gate green. |
| Dependency Security | 40 | **85** | `xlsx` replaced/patched; `npm audit` clean for shipped packages; SBOM in CI. PROVE IT: audit clean on the deployed bundle; CycloneDX SBOM artifact. |
| Infrastructure | 45 | **85** | Managed backend; dev/staging/prod separation; least-privilege service roles. PROVE IT: environment separation documented; no prod secret usable from dev; IAM review. |
| Logging / Auditability | 5 | **88** | Append-only audit log (WHO/WHAT/WHEN/WHERE/TARGET/RESULT) users can't edit. PROVE IT: a sample audit trail for login, CRUD, export, permission change, and AI access; logs immutable to app users. |
| Backup / Recovery | 5 | **80** | Automated encrypted backups + a **tested** restore. PROVE IT: a restore actually performed and documented (not just "backups are on"). |
| AI Security | 45 | **85** | Output handling (already good) + proxy with BAA/ZDR + rate limits + confirm-before-write. PROVE IT: BAA on file; ZDR headers enforced by the proxy; injection test suite green. |
| HIPAA Technical Readiness | 8 | **82** | All §164.312 technical safeguards implemented. PROVE IT: the control-by-control table in `HIPAA_TECHNICAL_READINESS.md` flips to VERIFIED with evidence for each. |
| Privacy | 30 | **82** | Subprocessor DPAs/BAAs (Anthropic, host), consent/notice, minimization. PROVE IT: signed agreements + a data-processing record. |
| Secure SDLC | 45 | **85** | CI security gates (SAST, dep-audit, secret-scan), SHA-pinned Actions, branch protection. PROVE IT: CI config showing the gates as required checks. |

---

## 2. Simulated Verifiable Claims (what you could say — once proven)

| CLAIM | Simulated answer | The evidence that makes it true |
|---|---|---|
| "Data is encrypted in transit." | ✅ YES | Already true today. |
| "Data is encrypted at rest." | ✅ YES *(conditional)* | Confirm provider at-rest encryption; stop persisting sensitive data client-side. |
| "Customers cannot access another customer's data." | ✅ YES *(conditional)* | **Live-tested** RLS tenant isolation across every table. |
| "OpsMatrix supports role-based access control." | ✅ YES *(conditional)* | Server-enforced roles demonstrated (not the client helper). |
| "Administrative actions are auditable." | ✅ YES *(conditional)* | Immutable audit log with sample entries. |
| "Secrets are not hardcoded." | ✅ YES | Already true today (verified). |
| "The AI provider does not train on our data / retains nothing." | ✅ YES *(conditional)* | **BAA + ZDR configured and enforced by the proxy** — contractual + technical evidence both. |
| "MFA is available/required." | ✅ YES *(conditional)* | MFA enforced for privileged roles. |
| "OpsMatrix can safely handle PHI." | ✅ YES, minimized *(conditional)* | All BLOCKER/CRITICAL controls verified + BAA chain complete. |
| "OpsMatrix is HIPAA compliant." | ❌ **still never say this as a product** | Compliance is an organizational/legal determination. Say "built to support HIPAA Security Rule technical safeguards; BAA available." |
| "OpsMatrix is SOC 2 certified." | ❌ not until an auditor says so | After a real Type II observation period. |

---

## 3. Simulated Hospital Questionnaire (the good-news version — each still needs its proof)

| Question | Simulated answer | Proof required |
|---|---|---|
| Encrypted in transit / at rest? | YES / YES* | provider config + no client-side persistence |
| MFA? SSO? | YES* / YES* | enforcement + IdP integration |
| RBAC? | YES* | server-enforced test |
| Audit logging? | YES* | immutable sample trail |
| Tenant isolation? | YES* | live cross-tenant test |
| BAA? | YES* | signed BAA with you, and your subprocessors' BAAs with you |
| AI data retention / training? | No retention, no training* | ZDR proxy + provider agreement |
| Backups / DR? | YES* | a *tested* restore |
| Pen test? | YES* | **independent third-party** report (your internal one isn't enough for this line) |
| Secrets hardcoded? | NO | already verified |

`*` = conditional on the PROVE-IT evidence existing.

---

## 4. The honest gap between this document and reality

Everything above is **achievable** — none of it is exotic; the Supabase design in your repo already sketches the hard part (multi-tenant RLS). But right now the distance between this projection and the running app is:

1. The backend isn't turned on (Supabase account never created — per `HANDOFF.md`).
2. No AI proxy exists; the browser still calls Anthropic directly with a user key.
3. No BAA with Anthropic or your host.
4. No audit logging, no MFA, no security headers, no at-rest strategy beyond the provider default.
5. No independent pen test.
6. `xlsx` still ships with a known CVE.

The sequence to close it is in `SECURITY_REMEDIATION_ROADMAP.md` (BLOCKER → CRITICAL → HIGH). When you've built and can *prove* each control, come back and I'll run the **real** assessment against the live system — and then the green checkmarks won't need an asterisk.

---

*Generated as a target-state projection on 2026-08-28. It reflects a secure design that is not yet implemented or verified. It must not be presented as a description of the running system.*
