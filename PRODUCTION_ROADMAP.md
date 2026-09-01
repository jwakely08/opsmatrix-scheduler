# OPSMATRIX — PRODUCTION ROADMAP

*Prepared 2026-08-24. Companion to `PRODUCTION_READINESS_REPORT.md` (read that first — it explains WHY each stage exists). Stages are ordered so that each one leaves the app fully working and shippable; nothing requires a big-bang rewrite. The single largest effort is Stage 3+4 (activating the backend); everything before it is cheap hardening, everything after it builds on it.*

**Downtime note up front:** because the app is static files + per-browser data today, almost nothing on this roadmap requires downtime. The only "migration" moments are per-customer data imports into the backend (Stage 7), which happen per organization, not as a global outage.

---

## Stage 1 — Repository & Secret Security

**Objective:** a private, tidy, protected repository with organizational account security, so everything built afterward has a safe home.

**Files/components affected:** repository settings (GitHub), `.gitignore` (already correct), `files/`, `files.zip`, `opsmatrix-scheduler.html`, `vercel.json`, branch settings. No app code.

**Changes required:**
- Make the repo private (coupled with Stage 12's hosting move because free GitHub Pages requires public; sequence: set up new hosting first OR accept a short overlap where the demo redeploys from the new host).
- Enable GitHub: secret scanning + push protection, Dependabot alerts, branch protection on `main` (require PR + passing checks).
- MFA on the GitHub account (H5 in the report); hardware key or authenticator app, saved recovery codes.
- Delete or move to an `archive/` folder: `files/`, `files.zip`, `opsmatrix-scheduler.html`, `vercel.json` (verified to contain no secrets — this is tidiness, not remediation).
- Decide the fate of the real home-scan fixtures: they are load-bearing ground truth for 172 tests; keeping them in a **private** repo is reasonable. Bump the demo seed later if the public demo should stop showing the home plan.
- Keep `.env.example` as the only env file ever committed (names only — already true).

**Potential risks:** making the repo private before new hosting exists breaks the GitHub Pages demo.
**Testing:** `npm test` still green after file moves; verify demo link behavior post-privatization.
**Rollback:** re-set repo to public; `git revert` the tidy commit.
**Downtime:** none (unless sequenced wrong with Pages — follow the coupling note).

---

## Stage 2 — Authentication & MFA

**Objective:** real user accounts with native MFA, using the provider path already in the codebase — no custom auth, no custom MFA.

**Files/components affected:** new `src/auth/` usage in surfaces A/B (harvested from dormant surface C: `AuthContext.tsx`, `supabaseClient.ts`, `LoginView.tsx`), Supabase project (Auth settings), `supabase/migrations/`.

**Changes required:**
- Create the Supabase projects (see Stage 7 for the three-environment layout; dev project first).
- Turn on Supabase Auth email/password with email confirmation; evaluate magic-link for the "60-year-old EVS manager" principle.
- Enable **native TOTP MFA** in Supabase Auth; enforce enrollment for `director` (org admin) role at the app level; offer it to all users.
- Port the login/org-creation/invite-redemption flow (already written for surface C) into the hub as the sign-in shell.
- Lengthen invite codes (report H6) and add expiry + single-use enforcement (single-use already exists).
- Session handling: supabase-js manages tokens/refresh; do not hand-roll anything.

**Potential risks:** UX regression for the demo (demo must stay login-free — keep `?demo=1` local mode fully working, auth only gates the synced mode).
**Testing:** signup→org create→invite→redeem→role checks; MFA enroll/challenge/recovery; wrong-password lockout behavior (Supabase built-in limits).
**Rollback:** auth shell is additive — feature-flag it off and the app returns to local mode.
**Downtime:** none.

---

## Stage 3 — Authorization & Tenant Isolation

**Objective:** server-enforced permissions and provable cross-tenant isolation before any second customer exists.

**Files/components affected:** `supabase/migrations/0001_init.sql` (extended by new migrations — never edited in place), a new automated isolation test suite, RemoteAdapter-successor code.

**Changes required:**
- Port the RLS pattern to the production data model (the v7-shaped tables added in Stage 4): every table gets `organization_id` + the four policies; roles enforced in policy `using`/`with check` clauses, exactly as the existing schema does.
- Define the role matrix explicitly in one document: director / supervisor / staff (+ a future OpsMatrix-staff support role as its own table, never a shared login).
- **Never** expose the service-role key to anything browser-reachable; it lives only in server-side functions' secrets.
- Build the cross-tenant test suite: two test orgs, assert user A can neither read nor write any of org B's rows on every table and every RPC; run it in CI against the dev project and in staging before each release.
- Add `organization_id` indexes (report, long-term list — cheap to do now).

**Potential risks:** an over-permissive policy slipping in unnoticed — that is exactly what the test suite exists to catch.
**Testing:** the isolation suite is the deliverable; also manual: two browsers, two orgs, attempt IDOR by id-guessing (text ids are app-generated — RLS must be the guard, not id secrecy).
**Rollback:** policies are migrations; write the down-migration alongside each up.
**Downtime:** none.

---

## Stage 4 — Database Security (and the real data-layer port)

**Objective:** the canonical customer data store — Postgres with RLS — holding the v7 data model that surfaces A/B actually use.

**Files/components affected:** new migrations (spaces, schedules, rules, floorcare, nonspace, aliases, plans as jsonb or normalized tables), a new sync adapter for the hub (`src/pro/classicStore.ts` grows a remote mode; pattern already exists in `src/storage/remoteAdapter.ts`), `mapsMain.tsx`, `scripts/fusion-*` (Classic reads a synced snapshot).

**Changes required:**
- Model decision (recommend): keep the v7 JSON shapes and store them as org-scoped jsonb documents per store (spaces, schedules, rules, floorcare…) with `state_rev` optimistic concurrency — this reuses the proven whole-workspace sync pattern and avoids a risky normalization rewrite; normalize hot tables (spaces) later only if query needs demand it.
- Keep localStorage as the offline cache and the demo mode; sync layer reconciles (last-write-wins + conflict banner via `state_rev`, as surface C already implements).
- Constraints: NOT NULL orgs everywhere, checked enums for roles/kinds, FK cascades reviewed (org delete cascades are intentional; document them).
- Deletion behavior: add soft-delete or a 30-day export-before-delete rule for `delete_org_data`; log deletions.
- Auditability: minimal audit table (who, when, which store, rev) from day one — cheap now, painful retrofit later.
- Migration safety: Supabase CLI migration flow, rehearsed on staging with production-shaped seed data before every production apply.

**Potential risks:** THE highest-risk stage (report §15) — data-layer changes touch everything. Mitigate: additive sync (local mode keeps working untouched), feature flag, migrate one pilot org first.
**Testing:** full 172-test suite stays green (pure functions untouched); new sync tests (save/load/conflict/offline); browser E2E on both modes.
**Rollback:** flag off remote mode → app is exactly today's app; database keeps the data for retry.
**Downtime:** none globally; per-org cutover is a coordinated moment per customer.

---

## Stage 5 — Secure File Uploads

**Objective:** keep the excellent "parse in browser, store derived data" model and remove its one real weakness.

**Files/components affected:** `package.json` (xlsx), `scripts/copy-xlsx.cjs`, `src/pro/sheetFile.ts`, upload entry points (`UploadHub` in `MapsApp.tsx`, fusion-ui hub).

**Changes required:**
- **Replace vulnerable SheetJS 0.18.5** with the patched official distribution (≥0.20.x tarball from SheetJS's own registry) or a maintained alternative; importer tests are the acceptance gate. (Report C4 — the one genuine upload fix.)
- Keep pdf.js current (4.10.38 is post-CVE; add it to the dependency-review habit).
- Add a file-size cap with a plain-language message (e.g., 25MB) at all three upload options.
- Add light content sniffing (reject a ".csv" that is actually a binary) for error quality, not security theater.
- Document the invariant that makes this architecture safe: **original files are never stored or transmitted** (except plan images to Anthropic). If Stage 4+ ever adds server-side file storage, at that moment apply: private buckets only, signed URLs, content-type allowlist, per-org paths, no user-controlled filenames in paths.

**Potential risks:** SheetJS version bump changing parse output for odd files.
**Testing:** `roomListImport.test.ts` (41 tests) + real-workbook manual test (Josh's 510-room export, kept out of the repo).
**Rollback:** pin back to the prior xlsx version (accepting the advisories) — one-line revert.
**Downtime:** none.

---

## Stage 6 — Claude / API Security

**Objective:** the browser never holds an Anthropic key in customer deployments; usage is metered per organization; AI behavior is production-safe.

**Files/components affected:** new Supabase Edge Function (`claude-proxy`), `src/bridge/aiPlanImport.ts`, `src/bridge/roomTypeSuggest.ts`, the archive Max call path (interceptable in `fusion-ui.js` without touching the archive), `aiPlanRequest.test.ts`.

**Changes required:**
- Edge function: authenticates the Supabase session → resolves org → forwards to `api.anthropic.com` using a **server-held, environment-specific, workspace-scoped key** → enforces per-org rate + monthly token budgets → logs usage per org. Browser code changes only the URL and drops the key/dangerous-direct header (request shape is test-locked; update the tests to match).
- Anthropic Console hygiene: separate keys for dev/staging/prod workspaces, spend limits on each, MFA on the Console account.
- Handle `refusal` stop reason gracefully at each call site; consider server-side fallbacks so a declined read degrades to a clear message.
- Prompt-injection hardening (report M4): visible confirmation for Max's bulk/destructive tool calls (>N rooms, deletes); keep treating document text as data.
- Retention decision for customers: Fable 5 requires 30-day retention at Anthropic; if a customer demands ZDR, route their org's calls to an Opus-tier model via proxy config (no client change).
- Keep the current paste-your-own-key mode as the fallback for the standalone/demo product — it is honest and serverless.

**Potential risks:** latency added by proxy (minimal); streaming for the Max chat through the function needs care.
**Testing:** request-shape tests updated; end-to-end plan read + Max command through the proxy in staging; budget-exhaustion behavior (clear plain-language message).
**Rollback:** config flag back to direct mode.
**Downtime:** none.

---

## Stage 7 — Development / Staging / Production Separation

**Objective:** the release flow becomes Development → Staging → Approval → Production, with nothing experimental touching production.

**Files/components affected:** hosting provider config, `.github/workflows/` (split deploy into three), branch layout, three Supabase projects, `.env.example` (grows the full variable list).

**Changes required:**
- Hosting: Cloudflare Pages / Vercel / Netlify project with three targets — `develop` branch → dev URL, `staging` branch → staging URL, `main` → production domain. (This is also what unlocks Stage 1's repo privatization and Stage 8's headers.)
- GitHub Environments: `production` requires manual approval; `staging` auto-deploys after tests.
- Three Supabase projects (dev / staging / prod), three Anthropic keys — secrets live only in the hosting provider's and GitHub's secret stores. `.env.example` lists every variable name.
- Migration rule: every schema change lands on dev → staging (rehearsed against production-shaped seed) → production, via the Supabase CLI in CI.
- Keep the GitHub Pages demo as a permanently-demo deployment (optional), seeded data only.
- Branch flow documented in the README: feature branches → `develop` → `staging` → `main`.

**Potential risks:** URL changes for the existing demo audience (put a redirect page at the old Pages URL).
**Testing:** deploy each environment, verify env-var wiring (staging talks to staging DB and staging key only — assert it in a smoke test).
**Rollback:** hosting providers keep previous deployments one click away; `main` protection means production only moves deliberately.
**Downtime:** none.

---

## Stage 8 — Logging, Monitoring & Alerts

**Objective:** you find out about problems before customers tell you.

**Files/components affected:** `src/lib/logger.ts` (its designed transport hook), app entry points, edge function, hosting/Supabase dashboards.

**Changes required:**
- Sentry (or equivalent): frontend errors + edge-function errors, environment-tagged, PII scrubbing on, no key material ever logged (verified none today — keep it that way).
- Uptime check on the production domain; deploy-failure notifications (Actions → email already exists — make it deliberate).
- Alerts: error-rate spike, Claude proxy spend threshold per org and global, Supabase auth anomalies, DB storage growth.
- Lightweight privacy-respecting analytics (page views, feature usage) if wanted — decision, not requirement.

**Potential risks:** minimal; over-alerting is the usual failure — start with few, high-signal alerts.
**Testing:** throw a deliberate error in staging, watch it arrive; trip a test alert.
**Rollback:** remove transport → console logger remains.
**Downtime:** none.

---

## Stage 9 — Backups & Disaster Recovery

**Objective:** customer data survives your worst day.

**Files/components affected:** Supabase project settings, a documented runbook (`docs/DR.md`), Export/Import feature in-app.

**Changes required:**
- Supabase: daily backups + PITR on production (paid tier); verify retention window fits promises made to customers.
- **Rehearse a restore** into a scratch project quarterly; write down the steps and the measured time.
- In-app "Export all data / Import" for each org (also the interim mitigation while data is still localStorage-only — ship this early, it's Easy and it protects today's users).
- Define RPO/RTO honestly (e.g., RPO ≤ 24h with daily backups or minutes with PITR; RTO = rehearsed restore time) and put them in the customer-facing docs.
- Repo DR: the repo itself, the migrations, and the hosting config are the app — an org-owned GitHub org + a second maintainer account (break-glass) covers bus-factor.

**Potential risks:** none to the app; the risk is *not doing the rehearsal*.
**Testing:** the rehearsal IS the test.
**Rollback:** n/a.
**Downtime:** none.

---

## Stage 10 — Application Security Hardening

**Objective:** close the remaining web-layer gaps once there is a real host and backend to harden.

**Files/components affected:** hosting header config, `index.html`/`maps.html`/generated `classic.html` meta, edge function, dependency manifest.

**Changes required:**
- Security headers at the host: CSP (start `Content-Security-Policy-Report-Only` in staging; target `default-src 'self'; connect-src 'self' https://api.anthropic.com <supabase-url>; img-src 'self' data: blob:`, with `'unsafe-inline'` script allowance for Classic initially), `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/mic off except mic where Max voice needs it), HSTS.
- CORS: on the edge function, allow only the three environment origins.
- Rate limiting: on the edge function (per-org and per-IP) — Supabase Auth covers login brute force.
- `npm audit fix` for the dev-chain (vitest/vite/esbuild/nanoid), verify 172 tests; schedule a monthly dependency review (Dependabot PRs into `develop`).
- Re-run the cross-tenant suite + an IDOR pass + an upload-abuse pass against staging as a pre-launch security test; fix findings before Stage 12.
- Confirm the non-issues stay non-issues: no server-rendered HTML (XSS surface is the escaped-overlay code, keep the no-`innerHTML`-in-src rule), no cookies-based sessions to CSRF (supabase-js uses bearer tokens), no redirects taking user URLs, no exec/shell anywhere.

**Potential risks:** CSP breaking Classic (inline scripts) — that's why report-only-first and staging exist.
**Testing:** CSP report-only logs clean in staging for a week → enforce; automated header check in CI.
**Rollback:** headers are host config — revert instantly.
**Downtime:** none.

---

## Stage 11 — Legal / Privacy / User-Facing Security Requirements

**Objective:** the paperwork a hospital's procurement team will ask for, ready before they ask.

**Changes required (documents, not code):**
- Privacy policy + Terms of Service on the production domain.
- Data inventory one-pager: what OpsMatrix stores (facility/operational data, staff names and shifts), what it deliberately does not (PHI — cite the schema's no-PHI rule), where it lives (host, Supabase region — pick US region), and the subprocessor list (hosting provider, Supabase, Anthropic).
- AI disclosure page: what is sent to Anthropic (plan images, room names, user commands), what is not (other customers' data; no PHI exists), retention (30-day on Fable 5; per-model notes), and that workload math is deterministic — Claude does not make staffing decisions. This matches the architecture and will disarm most AI-procurement anxiety.
- Employee-name handling note: staff schedules contain worker names → that is personal data; cover it in the privacy policy; the printed-schedule design already omits names (locked by test) — say so.
- Security page: MFA availability, RLS isolation, backups/RPO/RTO, responsible-disclosure contact (a `security.txt`).
- Data-processing agreement template for customers; incident-response one-pager (who is notified, when).
- Not HIPAA-scoped by design — but write the sentence carefully: "designed to operate without PHI" rather than "HIPAA compliant"; if a customer later insists on a BAA-covered deployment, that is a separate project (Anthropic and Supabase both have healthcare paths).

**Risks/Testing/Rollback/Downtime:** n/a — review with a lawyer before first paid contract.

---

## Stage 12 — Production Deployment

**Objective:** first controlled customer launch.

**Changes required:**
- Buy the domain; DNS at a registrar with MFA; production TLS via host.
- Pre-launch gate (all must be true): Stage 3 isolation suite green in staging · Stage 4 migration rehearsed · Stage 6 proxy metering live · Stage 8 alerts firing to a monitored inbox · Stage 9 restore rehearsed · Stage 10 security pass done · Stage 11 pages published.
- Launch runbook: deploy `main` via the approval gate; smoke-test checklist (login, MFA, import, plan read via proxy, schedule build, print, Max command); first-customer onboarding script (create org, invite users, import their room list *with them*).
- Controlled = one pilot org first; a week of watching Sentry + spend dashboards before the second.

**Potential risks:** first-real-customer surprises — that's why pilot-of-one.
**Testing:** the smoke-test checklist, run on production after deploy.
**Rollback:** hosting one-click rollback + DB PITR; documented in the runbook.
**Downtime:** none (first deploy of a new environment).

---

## Stage 13 — Post-Launch Security Monitoring

**Objective:** security as a routine, not an event.

**Ongoing cadence:**
- **Weekly (5 min):** Sentry triage; Anthropic spend per org; Supabase auth log skim.
- **Monthly:** Dependabot/`npm audit` review and merge into `develop`; verify backups ran; review any new upload formats/features against the Stage 5 invariant.
- **Quarterly:** restore rehearsal (Stage 9); re-run cross-tenant + IDOR suites against staging; access review (who has GitHub/hosting/Supabase/Anthropic access — rotate anything stale); revisit CSP tightening; review this roadmap's long-term list (audit log depth, SSO asks, normalizing hot tables).
- **On every incident:** short written post-mortem (what, impact, fix, prevention) — even for near-misses.
- **On every new feature:** two questions before merge: does it move data across an org boundary, and does it send anything new to Claude? If either is yes, it gets a staging security pass first.

---

## Suggested order of attack (practical sequencing)

1. **This week, Easy wins:** Stage 1 (minus privatization) + H2 Sentry hook + H3 export button + M1 audit fix + M6 tidy.
2. **Next:** Stage 7 hosting/environments (unlocks privatization + headers) → Stage 5 xlsx replacement → Stage 10 headers.
3. **The project:** Stages 2+3+4 together (backend activation) — the Significant one; plan it as its own multi-week effort with the pilot-org strategy.
4. **Then:** Stage 6 proxy → Stages 8/9 → Stage 11 paperwork → Stage 12 launch → Stage 13 forever.
