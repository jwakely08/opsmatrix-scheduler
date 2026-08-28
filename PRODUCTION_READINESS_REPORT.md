# OPSMATRIX — PRODUCTION READINESS REPORT

*Prepared 2026-08-24. Every claim below was verified against the repository, the full 48-commit git history, `npm audit`, and the running application — nothing is assumed. Companion document: `PRODUCTION_ROADMAP.md` (the staged plan).*

---

## The one-paragraph honest summary

OpsMatrix today is a **fully client-side application**: three HTML surfaces served as static files from GitHub Pages, with ALL data living in each browser's localStorage and ALL logic (the deterministic workload/scheduling engines and the Claude-assisted interpretation layer) running in the browser. There is **no backend, no server API, no user accounts, and no shared database in operation**. That architecture is clean, honest, secret-free, and excellent for demos and single-operator use — and it is structurally not a multi-customer SaaS yet. Most classic web-app vulnerabilities (SQL injection, broken server-side authorization, cross-tenant leaks) literally cannot occur because there is no server to attack; the flip side is that customer data has no accounts, no isolation, no backups, and no MFA because those need a backend to exist. The good news: a **well-designed multi-tenant backend already exists in this repo** (a Supabase schema with per-organization row-level security, roles, and invite flows — written, tested in design, never activated). The path to production is primarily *activating and finishing that backend*, not repairing a broken one.

---

## 1. CURRENT ARCHITECTURE

| Concern | Current state |
|---|---|
| Frontend framework | Three surfaces. **A: OpsMatrix Classic** (`public/classic.html`, ~1MB) — generated from a frozen archive; React 18 UMD + Tailwind 2, all vendored to our origin (zero CDN as of 2026-08-24). **B: The Hub** (`maps.html`) — Vite + React 18 + TypeScript. **C: old React scheduler** (`index.html`) — superseded, still deployed. |
| Backend framework / runtime | **None.** No server code runs anywhere. |
| API architecture | **None of our own.** The only network calls the app makes are to `api.anthropic.com` (and same-origin static assets). |
| Database / provider | **In operation: none** — all canonical data is browser `localStorage` (`opsmatrix_v7` and fusion keys), per browser, per device. **Designed but dormant:** `supabase/migrations/0001_init.sql` — a complete multi-tenant Postgres schema (Supabase) with RLS. No Supabase project has ever been created. |
| ORM | None (dormant path uses supabase-js query builder directly; no ORM). |
| Authentication | **None in the live product.** Dormant surface C has Supabase email auth + org creation + invite-code redemption (`src/auth/`, RPCs in the migration). |
| File storage | No server storage. Uploaded files are parsed **in the browser** and the *derived data* (JSON rooms, SVG plan images as data URLs) is stored in localStorage. Original files are never persisted or transmitted anywhere except plan images sent to the Anthropic API for reading. |
| Hosting / deployment | GitHub Pages, auto-deployed by `.github/workflows/deploy.yml` on every push to `main` (npm ci → 172 tests → build → deploy). A `vercel.json` exists from an earlier phase — apparently unused. |
| Domain | None — `jwakely08.github.io/opsmatrix-scheduler`. No custom domain, no DNS to manage yet. |
| Environment variables | Only the dormant surface C reads any (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` from `.env.local`). `.env.example` exists and correctly contains names only. The live surfaces (A, B) use zero env vars. |
| Anthropic / Claude integration | Browser → `api.anthropic.com/v1/messages` directly, using the **customer's own API key** typed into the app (stored in localStorage, dual-slot since 2026-08-24), with the `anthropic-dangerous-direct-browser-access` header. Call sites: `src/bridge/aiPlanImport.ts` (floor-plan reading, two-pass, images), `src/bridge/roomTypeSuggest.ts` (room-type suggestions, user-triggered), and the archive's Max assistant (chat/voice, 43 tools). All pinned to `claude-fable-5`. |
| Other third-party APIs | None. |
| Email provider | None. |
| Payment provider | None. |
| Logging / monitoring | `src/lib/logger.ts` — console only, with an explicit hook point for a real transport ("to add Sentry later, replace the transport in emit"). No error tracking, no uptime monitoring, no alerts. |
| Analytics | None. |
| Background jobs / scheduled jobs | None (and none needed by the current design). |
| Caching | Browser-side only: a deliberately **network-first** service worker (`public/sw.js`) that caches same-origin GETs as an offline fallback and never touches POSTs or `api.anthropic.com`. Correctly designed. |
| Mobile / PWA | Installable PWA (manifest + icons + the SW above). Phone-first responsive layouts across the hub. |

**Architecture note Josh asked to preserve, verified true in code:** Claude never computes workload. All pricing/scheduling math is the deterministic rules engine (`src/pro/rules.ts`, `floorcare.ts`, `scheduleDoc.ts`, `workload.ts`). Every path where Max (the assistant) writes data goes through guarded tool implementations that validate values and re-price rooms through the engine (`wireMaxFusionTools` in `scripts/fusion-ui.js`). Claude interprets language and documents; the engine decides numbers. This separation is real and should be kept.

---

## 2. WHAT IS ALREADY PRODUCTION READY

These are genuine assets — do not rebuild them:

- **Secret hygiene is clean.** Full-history scan (48 commits): no API keys, no tokens, no passwords, no `.env` ever committed (only `.env.example` with names). CI needs and stores no secrets. The archive's `DEFAULT_MAX_API_KEY` is an empty string.
- **No third-party scripts on pages that hold the key.** React, ReactDOM, Tailwind, SheetJS, and pdf.js are all vendored to our origin; the build **fails** if any CDN reference survives (`scripts/make-classic.cjs`). This closes the classic supply-chain/XSS-key-theft channel.
- **The dormant Supabase schema is well designed.** Every domain table carries `organization_id` with RLS enabled; roles (`director`/`supervisor`/`staff`) are enforced *in policies, server-side*; privileged flows (org creation, invite redemption, org-data deletion) are `security definer` RPCs with auth checks; optimistic concurrency via `state_rev`; an explicit **NO PHI, EVER** design rule is written into the schema header and there is genuinely nowhere to put patient data.
- **Test discipline.** 172 vitest tests, green, run in CI before every deploy; geometry validated against real magicplan ground truth; the Anthropic request shape is locked by tests.
- **The service worker is done right** (network-first — the stale-build bug class is designed out; API calls never cached).
- **No PHI by design** across the whole product — the data model holds spaces, rates, schedules, and staff assignments only.
- **No unsafe HTML rendering in app code.** Zero `dangerouslySetInnerHTML`/`innerHTML` in `src/`; the fusion overlay's `innerHTML` usage escapes all dynamic values through `esc()`.
- **CI/CD exists and is gated on tests.** Push→test→build→deploy is already a real pipeline; it just needs environments in front of it.

---

## 3. CRITICAL ISSUES — MUST FIX BEFORE PRODUCTION

**C1. There is no backend, so customer data has no home.** All customer data lives in one browser's localStorage: it is lost when browsing data is cleared, invisible on the customer's other devices, unbackupable by you, and shared with anyone who uses that physical machine. For a paying hospital customer this is the deal-breaker. *Fix: activate the Supabase path (schema exists) and make it the canonical store for surfaces A/B (it was written for surface C's data model — porting it to the v7 model is the real work).* **Difficulty: Significant. Breakage risk: highest of any item — this touches the data layer of everything.**

**C2. No authentication or authorization exists in the live product.** Anyone with the URL sees whatever is in their own browser — fine today (their own data), meaningless for SaaS. MFA is impossible until accounts exist. *Fix: Supabase Auth (already integrated in dormant code) with native TOTP MFA.* **Difficulty: Significant (bundled with C1). Breakage risk: moderate.**

**C3. Every push to `main` deploys straight to the public site.** There is exactly one environment and it is production-for-the-demo. No staging, no approval gate, no rollback story beyond `git revert`. **Difficulty: Moderate. Breakage risk: low.**

**C4. The `xlsx` dependency (SheetJS 0.18.5 from npm) has two high-severity advisories with no fix available on the npm registry** (prototype pollution GHSA-4r6h-8v6p-xvw6, ReDoS GHSA-5pgg-2g8v-p4x9). It parses **untrusted customer spreadsheets** in the page that holds the API key. SheetJS moved distribution off npm; patched versions (≥0.19.3/0.20.x) exist on their official CDN as installable tarballs. *Fix: repoint the dependency at the official patched distribution (or a maintained alternative) and re-run the import tests.* **Difficulty: Easy–Moderate. Breakage risk: low-moderate (importer is heavily tested — the tests are the safety net).**

**C5. The repository is public and will contain the product.** Acceptable while it's a demo (it was required for free Pages); not acceptable for a commercial product's source, roadmap, and security documentation — and it currently ships Josh's **real home floor-plan scan** as test fixtures and demo data. *Fix: make the repo private (or split: private product repo + public demo), and decide deliberately whether the home scan stays as ground-truth fixtures in the private repo.* **Difficulty: Easy. Breakage risk: none technically (free GitHub Pages requires public repos — so this is coupled to the hosting move in C3).**

---

## 4. HIGH PRIORITY ISSUES

**H1. API-key-in-browser is not a SaaS pattern.** Today each user pastes their own Anthropic key; it lives in localStorage and is sent from the browser with the `anthropic-dangerous-direct-browser-access` header. That header exists precisely to force acknowledgment of the risk: any XSS or malicious extension on the page can read the key, and asking each hospital to procure an Anthropic key is bad onboarding. *Production pattern: a small server-side proxy (Supabase Edge Function fits naturally) holds workspace-scoped Anthropic keys per environment, enforces per-org auth + spend/rate limits, and the browser never sees a key.* Until the backend exists, the current model is acceptable **only** because the key belongs to the same person whose browser holds it. **Difficulty: Moderate (once a backend exists). Breakage risk: low — request shape is test-locked; only the endpoint and auth change.**

**H2. No error tracking or monitoring.** Failures in customers' browsers will be invisible. The logger already has the hook point; wire a real transport (e.g., Sentry) with PII-scrubbing defaults. **Easy. Low risk.**

**H3. No backups** — nothing server-side exists to back up. The moment C1 lands, enable Supabase point-in-time recovery / scheduled backups and test a restore. Until then, add a user-facing **Export/Import all data** button so customers can snapshot their own localStorage workspace (partial mitigation, near-term win). **Easy. Low risk.**

**H4. No security headers / CSP.** GitHub Pages cannot set response headers. After the hosting move (C3), add CSP (`connect-src 'self' https://api.anthropic.com`), `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`, HSTS. Classic's giant inline scripts mean the CSP needs `'unsafe-inline'` for scripts initially — still worthwhile for `connect-src`/`frame-ancestors`; tightening further is a long-term item. **Easy (post-move). Low risk (test carefully: CSP typos break pages loudly).**

**H5. Organizational account security (not code).** MFA on: the GitHub account (and required for any future collaborators), the future hosting provider, the future Supabase org, the Anthropic Console account, domain registrar/DNS when a domain is bought, and business email. Also enable GitHub secret scanning + push protection and Dependabot alerts on the repo. **Easy. No breakage risk.**

**H6. Invite codes in the dormant schema are 8 hex characters (~32 bits) and redemption is an unthrottled RPC.** Fine for a pilot; before real multi-org production, lengthen codes (or add expiry + attempt limits). **Easy. Low risk.**

## 5. MEDIUM PRIORITY IMPROVEMENTS

- **M1. Dev-tooling vulnerabilities** — vitest (critical), vite (high), esbuild/vite-node/nanoid (moderate/high) are all **dev-time only** (never shipped to users) and all have available fixes: `npm audit fix`, verify tests. Not customer-facing, but clean it up. **Easy.**
- **M2. Retire or fence off surface C** (`index.html`, the old scheduler) — still deployed, confusing, and it's the only surface with auth code that will be cannibalized for the real backend. Stop deploying it publicly once its code is harvested. **Easy.**
- **M3. Rate limiting / brute force** — nothing to rate-limit today; when the backend lands, rely on Supabase Auth's built-in limits + add limits on the Claude proxy (per-org request and token budgets). **Moderate (bundled with H1).**
- **M4. Prompt-injection posture for Max.** Uploaded documents and room names flow into Claude prompts; Claude's tool calls then write data. Existing mitigations are real: schema-constrained responses, sanitization/validation in `aiPlanImport.ts`, guarded tool implementations (floor types restricted to three, room types must exist in Scope, protected fields, >50-row edits need explicit confirmation, everything repriced by the engine). Residual risk is bounded today because the only data reachable is the user's own browser. Before production: add a visible confirmation step for bulk/destructive Max actions and treat document-derived text as untrusted in any future server-side prompt. **Moderate.**
- **M5. Pin and review the Fable 5 dependency.** All three call sites use `claude-fable-5`. Two production considerations: (a) Fable 5 requires 30-day data retention on the Anthropic org — it is not available under zero-data-retention; if a healthcare customer's procurement asks for ZDR, those calls must run on an Opus-tier model instead. (b) When moving calls server-side, handle the `refusal` stop reason and consider the server-side fallback parameter so a declined request degrades gracefully. **Easy to decide, Moderate to implement with H1.**
- **M6. `files/`, `files.zip`, `opsmatrix-scheduler.html`, `vercel.json`** — historical artifacts in the repo root (old prompts, phase-A single-file app, unused Vercel config). No secrets in them (verified). Archive or delete for a professional repo. **Easy.**

## 6. LONG-TERM IMPROVEMENTS

- Audit logging (who changed what, when) — the schema has no audit table; add one when multi-user editing is real.
- Soft deletes / undo for destructive operations (today `delete_org_data` and cascades are hard deletes).
- Indexes on `organization_id` across domain tables (RLS filters by it constantly).
- Tighten Classic's CSP by extracting inline scripts (or by gradually replacing the archive surface).
- SSO/SAML for large hospital systems (Supabase supports SAML on paid tiers) — a sales conversation, not a launch blocker.
- Status page + uptime monitoring once there's a domain.
- Data-processing agreement template + subprocessor list (Anthropic, Supabase, host) for customer security reviews.

---

## 7. RECOMMENDED ARCHITECTURES

### Production
- **Hosting:** move static hosting to a provider with private-repo support, branch deploys, and header control — Cloudflare Pages, Vercel, or Netlify (any of the three; Cloudflare Pages is the cheapest at scale, Vercel matches the existing `vercel.json`). Custom domain + HTTPS + HSTS.
- **Backend:** one **production Supabase project** (Auth with TOTP MFA available and required for director-role users; Postgres with the existing RLS schema ported to the v7 data model; PITR backups on).
- **Claude:** server-side proxy (Supabase Edge Function) holding a **production workspace-scoped Anthropic key** with Console spend limits; per-org authorization and usage metering in the proxy; browser never holds a key.
- **Releases:** deploy only from `main`, only via CI, only after staging approval (GitHub Environments with required reviewers).
- **Monitoring:** Sentry (frontend + edge functions), provider analytics, Supabase log drains.

### Staging
- Mirror of production on subdomain (e.g., `staging.…`): its **own Supabase project** (same migrations, seeded synthetic data — never customer data), its **own Anthropic key** with a small spend cap, deployed automatically from a `staging` branch. This is where migrations are rehearsed and QA/security testing happens.

### Development
- What exists today, kept: local Vite + localStorage demo mode (`?demo=1`) — genuinely great for fast iteration — plus an optional **dev Supabase project** (or `supabase start` locally) when working on backend features. Claude Code continues to work here; experimentation stays here. The public GitHub Pages demo can live on as a separate, permanently-demo deployment fed only by seeded data.

## 8. DATABASE & BACKUP ASSESSMENT

- **In operation:** localStorage only. No backups possible from your side; data loss is one "Clear browsing data" away; ~5–10MB quota caps facility size. Verdict: fine for demo, unacceptable for customers (see C1, H3).
- **Dormant schema:** reviewed line-by-line — RLS on all 13 tables, org scoping consistent, role checks in policies, security-definer RPCs guard privileged flows, cascading deletes are coherent (org → everything). Gaps: no `organization_id` indexes, no audit trail, hard deletes only, invite-code entropy (H6), and it models surface C's data shape — porting to the v7 shape (spaces/schedules/rules/floorcare stores) is the substantive migration work.
- **Migrations:** single init migration; adopt Supabase CLI migration flow (staging first, then production) as part of Stage 7.
- **Backups when live:** Supabase daily backups (paid tier) + PITR; document and *rehearse* a restore.

## 9. AUTHENTICATION & AUTHORIZATION ASSESSMENT

- **Live product:** none exists — by design of the current single-operator architecture. No sessions, no tokens, no roles. Nothing relies on frontend hiding because there is nothing to hide: the user owns 100% of what their browser holds.
- **Dormant path:** Supabase email/password auth; roles director/supervisor/staff; **authorization enforced server-side in RLS policies** (not just UI) — the correct pattern, already written; supervisors' write scope correctly limited to schedule tables both client- and server-side.
- **MFA:** not possible today (no accounts). Supabase Auth supports native TOTP MFA — use it; require it for director/admin roles; do not build custom MFA.
- **Admin separation:** no OpsMatrix-staff "super admin" concept exists anywhere yet; when you need one, model it as a separate table + policies, never a shared password.

## 10. CLAUDE / API SECURITY ASSESSMENT

- **Where called:** browser only — three call sites (plan reader, room-type suggester, Max assistant), all pinned to `claude-fable-5`, all `POST api.anthropic.com/v1/messages` with `x-api-key` + `anthropic-dangerous-direct-browser-access`.
- **Can the key reach the browser?** It *lives* in the browser (localStorage) — today that is the design, and it is the user's own key for their own account. No key has ever been committed, bundled, or defaulted (verified across history; a build-time guard blocks CDN scripts from the page).
- **What is sent to Claude:** floor-plan images (the crop being read), spreadsheet-derived room names awaiting classification, the user's chat/voice text, and — via Max's `read_data` tool — operational records from the user's own browser when the conversation requests them. No other customer's data can be sent because no other customer's data is reachable. Entire raw files are *not* blindly sent: plans are re-rendered/cropped images; spreadsheets send name lists, not the file.
- **Prompt injection:** possible in inputs (a spreadsheet cell or plan annotation could carry instructions). Mitigations that exist: schema-constrained outputs, response sanitization, coordinate validation, guarded tools with enum/type checks, engine repricing, blast radius limited to the user's own local data. Remaining gap: Max tool calls execute without a confirmation step — see M4.
- **Production direction:** proxy server-side (H1), per-env workspace keys with spend limits, per-org metering, refusal/fallback handling, and note the Fable 5 30-day retention requirement for customer security questionnaires (M5). No PHI is sent because no PHI exists in the system.

## 11. FILE UPLOAD SECURITY ASSESSMENT

- **Accepted types:** DXF+CSV (magicplan), XLSX/XLSM/XLS/CSV/TSV (room lists), PNG/JPG/PDF (plans). Extension-based accept filters; no MIME sniffing (see below).
- **Where they go:** nowhere. Parsing is 100% in-browser (text parsers, vendored SheetJS, vendored pdf.js, canvas rasterization); only derived JSON/SVG lands in localStorage; plan images go to Anthropic for reading. There is no server to receive a malicious file, no stored file that could ever execute, no public URLs generated, and no path traversal / filename issues because filenames are never used as paths.
- **Real risks, honestly ranked:** (1) the vulnerable `xlsx` parser processing hostile spreadsheets — C4, the one genuine upload issue; (2) pdf.js parsing hostile PDFs — current version 4.10.38 postdates the known arbitrary-JS-in-fonts CVE (patched in 4.2.67); keep it updated; (3) resource exhaustion from a giant file (a browser tab hang — annoying, not a breach). There is **no size limit** today; adding a simple size cap with a friendly message is worthwhile polish.
- **When a backend arrives:** if original files ever get stored server-side (not currently needed), that's the moment the full upload-security checklist (content-type validation, private buckets, signed URLs, AV scanning decision) applies — flagged in the roadmap so it isn't forgotten.

## 12. CUSTOMER DATA ISOLATION ASSESSMENT

- **Today:** isolation is physical — each browser holds only its own operator's data; cross-tenant exposure is impossible because tenants share nothing. The inverse problem is real: shared computers share data, and there is no concept of organizations, campuses, or per-user access at all.
- **Designed (dormant):** organization-scoped RLS on every table — the right foundation. Buildings/campuses/systems live *inside* an org's data rather than as isolation boundaries, which matches the product (a hospital system = one org).
- **Must hold before production:** every server-side query path goes through RLS (never the service-role key in anything browser-reachable), and a cross-tenant test suite (user A cannot read/write org B — automated, run in staging on every release).

## 13. LOGGING & MONITORING ASSESSMENT

Console-only logger with a designed transport hook; no error tracking, uptime checks, alerts, or analytics anywhere. Nothing sensitive is currently logged (verified: no key material in log calls). This is a green-field: wire Sentry into the existing hook (Easy), add provider uptime/analytics after the hosting move, and Supabase auth/query logs once the backend exists. Alert on: deploy failures (exists implicitly via Actions), error-rate spikes, auth anomalies, Claude proxy spend thresholds.

## 14. DEPLOYMENT ASSESSMENT

One pipeline, one environment, zero secrets, tests gate the deploy — a solid foundation with no staging and no approval step (C3). `vercel.json` is leftover. Branch protection on `main` is not configured (recommend: require PR + passing checks; you can allow your own admin bypass while solo). Rollback today = revert + push (~35s to live) — acceptable; document it. Target end-state pipeline: `develop` → auto-deploy dev URL; `staging` → auto-deploy staging URL + migration rehearsal; `main` → production behind a GitHub Environment with required approval. Keep the GitHub Pages demo as a *fourth*, permanently-demo surface if desired.

## 15. ESTIMATED DIFFICULTY OF EACH CHANGE

| Change | Difficulty | Breakage risk to existing app |
|---|---|---|
| Repo private + hosting move (C3+C5) | Moderate | Low (URLs change; demo link redirects needed) |
| Replace vulnerable `xlsx` build (C4) | Easy–Moderate | Low-Moderate — importer tests catch regressions |
| Dev-dependency `npm audit fix` (M1) | Easy | Low (dev-only; run tests) |
| Sentry via existing logger hook (H2) | Easy | Minimal |
| Export/Import-my-data button (H3 interim) | Easy | Minimal |
| Org/account MFA + GitHub hardening (H5) | Easy | None |
| Security headers/CSP after move (H4) | Easy | Low-Moderate (CSP mistakes are loud — test in staging) |
| Repo tidy: files/, zip, vercel.json (M6) | Easy | None |
| Three environments + branch flow (C3) | Moderate | Low |
| **Backend activation: Supabase + auth + port v7 model (C1+C2)** | **Significant** | **High — the data layer of every surface changes; this is THE project** |
| Claude server-side proxy + metering (H1) | Moderate (after backend) | Low — request shape is test-locked |
| Cross-tenant test suite (Stage 3) | Moderate | None (tests only) |
| Retire surface C (M2) | Easy | Low |
| Audit log, soft deletes, indexes (long-term) | Moderate | Low |

**The two changes most likely to break things:** (1) the backend/data-layer migration — mitigate by keeping localStorage mode as the offline/demo fallback and building sync alongside rather than as a rewrite; (2) CSP rollout — mitigate by shipping report-only first in staging.

---

*Stop point per the plan: no architectural changes have been made. The only repository changes accompanying this report are these two documents themselves. No secrets were found, so no emergency remediation was needed or performed.*
