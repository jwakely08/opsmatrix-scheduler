# OPSMATRIX — PRODUCTION ACTIVATION RUNBOOK

*Written 2026-08-26. Everything in the code is already built, tested, and
dormant — this runbook is the list of one-time human steps (accounts,
secrets, dashboard switches) that turn it on. Follow it top to bottom; each
section says how to verify before moving on. Companion docs:
`PRODUCTION_READINESS_REPORT.md` (why), `PRODUCTION_ROADMAP.md` (the plan
this executes).*

**The mode rule, one more time:** a build with no `VITE_SUPABASE_*` env vars
is LOCAL mode — the demo, unchanged forever. Cloud mode only exists in
builds you create through the steps below. Nothing here risks the demo.

---

## 0. Accounts & MFA (do this first, ~30 min)

Turn on MFA (authenticator app, save recovery codes somewhere offline) on:

- [ ] **GitHub** (github.com → Settings → Password and authentication)
- [ ] **Cloudflare** (dash.cloudflare.com → My Profile → Authentication)
- [ ] **Supabase** (supabase.com → Account → Security)
- [ ] **Anthropic Console** (console.anthropic.com → Settings)
- [ ] The **email account** behind all of the above (it can reset everything)
- [ ] Domain registrar, when you buy the domain

Repo hardening (github.com → the repo → Settings):

- [ ] Code security → enable **Secret scanning** + **Push protection** + **Dependabot alerts**
- [ ] Branches → protect `main`: require a pull request + require status checks
- [ ] **Make the repository private** — do this only AFTER Cloudflare Pages is
      deploying (section 3), because the free GitHub Pages demo requires a
      public repo. If keeping a public demo matters, the cleaner end-state is
      a separate tiny public repo that holds only the built demo.

## 1. Supabase — three projects (~45 min)

Create THREE projects at supabase.com (org: your company; region: a US
region, same for all three): `opsmatrix-dev`, `opsmatrix-staging`,
`opsmatrix-prod`. For EACH project:

1. **SQL Editor** → run `supabase/migrations/0001_init.sql`, then
   `supabase/migrations/0002_production.sql` (in that order; both should end
   "Success").
2. **Authentication → Sign In / Up → Email**: leave "Confirm email" ON for
   staging/production (OFF is fine for dev).
3. **Authentication → Multi-Factor**: ensure **TOTP** is enabled (it is by
   default). The app enforces enrollment for directors.
4. Note the **Project URL** and **anon public key** (Settings → API) — these
   are the `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` for that
   environment. The **service_role key is never used anywhere client-side —
   don't copy it into anything except step 2's function secrets.**

**Production only:** Settings → upgrade to a paid plan, then Database →
Backups: confirm daily backups; enable **PITR**. Put a quarterly "restore
rehearsal" reminder in your calendar (restore into a scratch project,
confirm rooms are there, delete the scratch).

**Verify (staging):** run the isolation proof against a scratch copy —
locally: `psql <staging-connection-string>` is NOT the way (never run the
test against a live project); instead spin the scratch database the test
header describes, or simply trust CI once section 4 wires it. Minimum
manual check: create two accounts/two orgs in the app later (section 5) and
confirm neither sees the other's rooms.

## 2. Anthropic — keys with guardrails (~20 min)

In console.anthropic.com:

1. Create three **workspaces**: `opsmatrix-dev`, `opsmatrix-staging`,
   `opsmatrix-prod`, each with its own **API key** and a **monthly spend
   limit** (start: dev $25, staging $50, prod to taste).
2. Note: the app pins `claude-fable-5`, which requires the standard 30-day
   data retention — relevant only if a customer's procurement asks about
   zero-data-retention (answer per the readiness report §10/M5).

Deploy the proxy to EACH Supabase project (needs the Supabase CLI,
`npm i -g supabase`, then `supabase login`):

```bash
supabase functions deploy claude-proxy --project-ref <PROJECT_REF>
supabase secrets set --project-ref <PROJECT_REF> \
  ANTHROPIC_API_KEY=<that environment's key> \
  ALLOWED_ORIGINS=<that environment's page origins, comma-separated> \
  AI_MONTHLY_TOKEN_BUDGET=20000000
```

`ALLOWED_ORIGINS` examples — staging: `https://staging.opsmatrix.app` (or
the `*.pages.dev` preview origin while you have no domain); production:
`https://opsmatrix.app,https://www.opsmatrix.app`; dev: `http://localhost:5173`.

**Verify:** `curl -X POST <project-url>/functions/v1/claude-proxy` with no
auth → a JSON "Sign in to OpsMatrix" 401 (not a platform error page).

## 3. Cloudflare Pages (~30 min)

1. Cloudflare dashboard → Workers & Pages → **Create → Pages → Direct
   upload is NOT needed** — the GitHub workflows push builds; just create the
   project named e.g. `opsmatrix` (any first upload works; the workflows
   overwrite it).
   Simplest path: `npx wrangler pages project create opsmatrix` locally.
2. Create an **API token** (My Profile → API Tokens → Create → "Edit
   Cloudflare Workers/Pages" template) and note your **Account ID**.
3. Custom domain (when bought): Pages project → Custom domains → add
   `opsmatrix.app` (production = the `main` branch deployment) and
   `staging.opsmatrix.app` (the `staging` branch alias). HTTPS + certs are
   automatic; HSTS is already in `public/_headers`.
4. The CSP in `public/_headers` ships **Report-Only**. After a clean week in
   staging (no violations in the browser console), rename the header to
   `Content-Security-Policy` to enforce.

## 4. GitHub environments & branches (~20 min)

1. Repo → Settings → **Environments**: create `staging` and `production`.
   On `production`, add **Required reviewers: you** — every production
   deploy then waits for your approval click.
2. In EACH environment add secrets:
   `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   (that environment's values; optionally `VITE_SENTRY_DSN`, section 6)
   and a variable `CLOUDFLARE_PAGES_PROJECT` = the Pages project name.
3. Branches (after merging this work to `main`):
   ```bash
   git checkout main && git pull
   git branch staging && git push -u origin staging
   git branch develop && git push -u origin develop
   ```
4. Flow from now on: feature branches → PR into `develop` (daily work) →
   merge `develop` into `staging` (auto-deploys staging; QA there) → merge
   `staging` into `main` (production deploy, behind your approval).
   The old GitHub Pages workflow keeps deploying `main` as the LOCAL-mode
   public demo until you retire it or make the repo private.

**Verify:** push to `staging` → the "Deploy staging" action goes green → the
staging URL shows a **sign-in screen** (cloud mode). The GitHub Pages demo
still shows the app directly (local mode).

## 5. First cloud smoke test (staging, ~30 min)

On the staging URL:

1. Create an account → **create the organization** → you're the director →
   the app requires **two-step verification**: scan the QR, enter the code.
2. Land in the app → bottom-right pill should reach **"☁ Saved to your
   organization"**.
3. Import a room list or run `?demo=1` data → make an edit → open the same
   account in a second browser → the edit appears (sync).
4. Upload a floor plan → the key row says **"AI reading is included with
   your OpsMatrix account"** → the read works (that's the proxy; check
   Supabase → Table editor → `ai_usage` gained a row with token counts).
5. Invite flow: as director generate an invite (24-char code), redeem it in
   a fresh browser/account, confirm the role's powers (staff = view-only
   pill, no sync-up).
6. Cross-tenant check: second account creates its OWN org → sees none of
   org 1's data.
7. Classic (`/classic.html` on staging): signed-in session syncs and Max
   works through the proxy (Admin Settings shows a placeholder key —
   expected; the real key never exists in the browser).

## 6. Monitoring (~15 min)

1. Create a free Sentry project (browser JS) → copy the DSN into the
   `VITE_SENTRY_DSN` secret of `staging` and `production` environments.
   Local/demo builds never load Sentry at all.
2. Throw a test error in staging (`log.error("sentry test", new Error("x"))`
   from the console) → confirm it arrives.
3. Cloudflare Pages → notifications: enable deploy-failure emails.
   Supabase → Reports: glance weekly (auth + DB size). Anthropic Console →
   spend alerts on each workspace.

## 7. Go-live checklist

- [ ] Sections 0–6 all verified in **staging**
- [ ] Production Supabase: migrations applied, PITR on, TOTP on
- [ ] Production proxy deployed with production key + origins + budget
- [ ] `production` GitHub environment: secrets set, required reviewer set
- [ ] Domain live on the Pages project, HTTPS green
- [ ] Repo private (or the split-demo decision made)
- [ ] Merge `staging` → `main`, approve the deploy, run the section-5 smoke
      test against PRODUCTION with a real account
- [ ] Onboard the pilot organization personally (create org with them,
      import their room list together, enroll their director's MFA)
- [ ] Watch Sentry + `ai_usage` + Supabase logs daily for the first week

## 8. Rollbacks & recovery

- **Bad frontend deploy:** Cloudflare Pages → Deployments → previous
  deployment → **Rollback** (instant). Or revert the commit on `main`.
- **Bad migration:** never edit an applied migration; write a new one that
  reverses it, rehearse on staging first. Worst case: PITR restore.
- **Data mistake by a customer:** PITR to a scratch project, export the org's
  workspace rows, hand-restore. (Their own Scope → Data backup file is the
  fast path when they have one.)
- **Leaked/suspect Anthropic key:** Console → revoke + reissue → update the
  ONE function secret (`supabase secrets set …`) → done; no client ships a key.
- **Leaked Cloudflare/Supabase credential:** rotate in that dashboard;
  update the GitHub environment secret.
- **Full restore point of the pre-production codebase:** commit `3b4b50d`
  (tag `pre-production-hardening` exists locally on the dev machine).

## 9. What is deliberately NOT in this first deployment

Documented so nobody mistakes absence for oversight (all tracked in
`PRODUCTION_ROADMAP.md` long-term items): per-field/role write granularity
(v1 syncs whole stores; staff are view-only, directors+supervisors write),
SSO/SAML, in-app audit-log viewer (rows are collected from day one),
Sentry on classic.html (hub only for now), enforced CSP (report-only first),
the `aal2` RLS policy for director writes (enable after every director has
enrolled MFA — the SQL is written, commented, at the bottom of
`0002_production.sql`), and retiring the old React scheduler at `/`.
