# OpsMatrix Scheduler

A scheduling platform for hospital EVS (Environmental Services): import magicplan
floor scans, see the facility as a tree and a map, and build cleaning schedules
with accurate workload math.

**No PHI by design** — the app stores physical spaces, cleaning rates, shifts and
staff assignments only. There is nowhere to enter patient names, occupant data,
or medical information, and no database column to hold them.

## Two apps, one capability

- **`/` (the new scheduler)** — the map-first React app.
- **`/classic.html` (OpsMatrix Classic + fusion)** — Josh's original full
  OpsMatrix (Max AI, inspections, reports, visual schedule builder),
  byte-identical to the archive, with ONE injected addition: an
  **"⚡ Import magicplan Scan"** button in Max Space → Floor Plans. It runs the
  modern auto-detection pipeline in the browser and writes the classic app's
  own data stores (`opsmatrix_v7`, `opsmatrix_v7_plans`): plan image rendered
  from the DXF, rooms pre-traced as polygons, square footage from the CSV,
  minutes via the classic rate table. Everything else about Classic is
  untouched. Regenerate after pipeline changes with `npm run build:classic`
  (commits `public/classic.html`).

## What's in this repo

| Path | What it is |
|---|---|
| `src/` | The production app — Vite + React + TypeScript |
| `supabase/migrations/0001_init.sql` | Full database schema + row-level security + RPCs |
| `opsmatrix-scheduler.html` | Phase A single-file version (works by double-clicking; same features, localStorage only) |
| `opsmatrix-v5-maxplans.html` | Josh's original OpsMatrix — **untouched archive** |
| `files/` | Original importer + phase specs (archive) |
| `test-fixtures/` | magicplan-format test files + generator (see note below) |
| `vercel.json` | Vercel deploy configuration |

> **Test-fixture note:** `test-fixtures/` contains Josh's REAL magicplan
> exports (added 2026-08-04) — they are read-only ground truth. The whole test
> suite validates against the numbers magicplan itself measured: 4 rooms
> (Bedroom 420.25 / Bedroom 141.53 / Other 20.60 / Bedroom 71.84 ft²),
> 653.88 cleanable / 799.11 gross. Never regenerate or substitute these files.

## Quick start (no accounts needed)

```bash
npm install
npm run dev
```

Open http://localhost:5173 — the app runs in **local mode** (data stays in your
browser). Import the files from `test-fixtures/` to see it working end to end.

Other commands:

- `npm test` — run the test suite (parsers vs fixtures, workload math, capacity)
- `npm run build` — production build into `dist/`

## Workload math (the rules)

- **`cleanableSqFt` (interior, without walls) is the only area used in workload
  math.** Gross square footage is stored for reference and labeled as such.
- Minutes per visit = `cleanableSqFt / 1000 × rate(roomType × floorType)` +
  `fixtures × minutesPerFixture`.
- Daily-equivalent minutes = per-visit minutes × (frequency per week ÷ 7).
- FTE estimate = total daily minutes ÷ productive minutes per shift (default
  420, editable in Settings).
- All rates are **editable estimates** seeded from industry-typical (ISSA-style)
  production rates — Settings → Workload rates.

## Architecture

- **One storage interface, two adapters** (`src/storage/`):
  `localAdapter` (localStorage — offline/demo) and `remoteAdapter` (Supabase).
  The app is fully functional on the local adapter with zero configuration.
- **Multi-tenant backend**: every table keyed by `organization_id`, enforced by
  row-level security. One org can never read another's data.
- **Roles**: `director` edits everything · `supervisor` edits schedules ·
  `staff` sees a read-only "My Day" view. Enforced in RLS *and* the UI.
- **Concurrency**: last-write-wins with optimistic detection — if someone saved
  since you loaded, you get a "data changed, refresh" notice
  (`bump_state_rev` RPC).
- **Parsers**: `src/lib/parsers.ts` — moved verbatim from the proven scan
  importer; kept passing against the test files.
- **Error tracking**: `src/lib/logger.ts` is the hook point. To add Sentry
  later: `npm i @sentry/react`, init it in `main.tsx`, and forward
  `log.error/warn` to `Sentry.captureMessage` in `logger.ts`.

## Environment variables

Copy `.env.example` to `.env.local`:

```
VITE_SUPABASE_URL=      # Supabase → Project Settings → API → Project URL
VITE_SUPABASE_ANON_KEY= # Supabase → Project Settings → API → anon public key
```

Without them the app runs local-only (fine for trying it out). With them you get
login, organizations, invites and shared data.

## Deploying

**GitHub Pages (current setup — free, automatic):**
`.github/workflows/deploy.yml` tests, builds and publishes to GitHub Pages on
every push to `main`. The published site has no Supabase keys, so it runs in
**local/demo mode**: data stays in each visitor's browser. Share
`…/?demo=1` to open it pre-seeded with the sample building (generated from the
test-file data). One-time setup lives in the checklist below.

**Vercel (optional, later — needed for the multi-user backend):** import the
repo in Vercel (framework auto-detected via `vercel.json`), add the two env
vars, deploy. Use this when you want login/roles/shared data on the internet.

---

## ✅ What Josh must do manually

Everything below needs a human with an email address; the code is already wired
for it.

### 1. Supabase (free) — enables login, roles, shared data

1. Go to https://supabase.com → **Start your project** → sign up (free tier is fine).
2. **New project** → name it (e.g. `opsmatrix`), pick a region near you, set a
   database password (save it somewhere safe).
3. When the project finishes provisioning, open **SQL Editor** → **New query**,
   paste the entire contents of `supabase/migrations/0001_init.sql`, and click **Run**.
   It should say "Success. No rows returned".
4. Go to **Project Settings → API** and copy:
   - **Project URL** → put in `.env.local` as `VITE_SUPABASE_URL`
   - **anon public** key → put in `.env.local` as `VITE_SUPABASE_ANON_KEY`
5. (Recommended) **Authentication → Providers → Email**: turn **off** "Confirm
   email" for the pilot so signups work instantly.
6. Restart `npm run dev`. You'll see the login screen — create your account and
   organization (you become the director). Then Settings → Team & invites to
   generate codes for supervisors/staff.

### 2. GitHub push + Pages (free) — the permanent demo link

One-time, ~3 minutes. Run in a terminal:

```
winget install --id GitHub.cli
gh auth login
```

(pick GitHub.com → HTTPS → Login with a web browser, and follow the code).
Then tell Claude "gh is authenticated" — the repo creation, push, and Pages
enablement are already scripted. After that, every commit to `main`
redeploys the site automatically; no further manual steps ever.

Note: GitHub Pages on a free account requires the repo to be **public**.

### (Optional, later) Vercel — for the multi-user backend

When you want login/roles/shared data hosted: import the repo at
https://vercel.com, add `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` in
project settings, deploy. `vercel.json` is already in place.

### 3. When you get the real magicplan exports

Drop the real `.dxf` and statistics `.csv` into `test-fixtures/` (names:
`Test_project_-_1st_Floor.dxf`, `Test_project_statistics.csv`) and run
`npm test` to confirm the parsers still read them perfectly.
