# OpsMatrix Scheduler — Production Build Prompt for Claude Code

Paste everything below into Claude Code in the project folder (it should contain `opsmatrix-scheduler.html` from the redesign, `opsmatrix-scan-importer.html`, and the magicplan test files). Run it with permissions to create files, install packages, and run commands.

---

## Mission

Take the single-file OpsMatrix Scheduler and graduate it into a deployable, multi-user web application, working autonomously through the phases below. Complete each phase, verify it, commit it to git, then continue. Only stop when you hit an item marked **[NEEDS JOSH]** — those require account signups or payments only a human can do. When you hit one, print exactly what Josh must do (the URL, the values to paste back, where to put them), then continue with everything not blocked by it.

## Ground rules

- Preserve every feature and all workload math from `opsmatrix-scheduler.html`. This is a migration, not a redesign. UI look and feel carries over.
- The magicplan parsers (`parseDXF`, `parseStatsCSV`) move over verbatim and keep passing against the test files: 4 rooms, 653.88 cleanable sq ft, 799.11 gross.
- `cleanableSqFt` remains the only number used in workload math.
- No PHI, ever: no patient names, room-occupant data, or medical information anywhere in the schema, seeds, or examples. Add a comment in the schema stating this design rule.
- Initialize git immediately if not already a repo. Meaningful commits per phase. Create a `.gitignore` that excludes env files and node_modules. Never commit secrets.
- Write a `README.md` as you go: setup, env vars, deploy steps, and a "what Josh must do manually" checklist that you append to whenever you hit a [NEEDS JOSH].

## Phase 1 — Restructure into a real project

- Scaffold a Vite + React project. Decompose the single file into modules: data layer, parsers, tree, map canvas, scheduling board, rates engine, settings. TypeScript preferred; plain JS acceptable if conversion risk is high. The old single-file conventions (no optional chaining, Object.assign) no longer apply — write modern idiomatic code.
- All state behind one storage interface with two implementations: `localAdapter` (localStorage, works offline/demo) and `remoteAdapter` (Phase 2). App runs fully on localAdapter from day one.
- Port the app screen-for-screen. Verify with the test files. Add a small test suite (Vitest) covering: both parsers against the real exports, workload math (known inputs → expected minutes/FTE), and schedule capacity calculations. All tests pass before commit.

## Phase 2 — Backend on Supabase

- Design the schema: organizations, users (roles: director / supervisor / staff), buildings, floors, rooms, room_types, rate_tables, shifts, employees, assignments, non_space_jobs, imports. Multi-tenant from the start: every table keyed to organization_id with row-level security policies so one org can never read another's data.
- Write the full schema + RLS policies as SQL migration files in the repo.
- Implement `remoteAdapter` using supabase-js. Auth: email + password login, with roles enforced both in RLS and UI (director edits everything; supervisor edits schedules; staff sees a read-only "my day" view).
- **[NEEDS JOSH]** Create a free Supabase project at supabase.com, run the migration file per README instructions, and paste the project URL + anon key into `.env.local`. Print these instructions verbatim when you get here, then keep building against the local adapter until keys exist; wire and test remote once they do.
- Data migration path: an in-app "Upload backup" that ingests the old localStorage JSON export so nothing Josh built is lost.

## Phase 3 — Multi-user experience

- Login screen, org creation on first signup (first user becomes director), invite flow (director generates invite links/codes for supervisors and staff).
- Printable daily schedule per employee (clean print stylesheet).
- Concurrency safety: last-write-wins is acceptable at this stage, but show a "data changed, refresh" notice when a save conflicts.

## Phase 4 — Deploy

- Production build, then deploy configuration for Vercel (vercel.json if needed, env var documentation).
- **[NEEDS JOSH]** Create a free Vercel account, connect the git repo (or run `vercel` CLI login), and set the two env vars. Print exact steps. A custom domain is optional and can wait.
- Add a demo mode: with no login, "Try the demo" loads the app on localAdapter seeded with a sample building generated from the test-file data, so Josh can show it to anyone with one link.

## Phase 5 — Pilot readiness

- Seed content: a starter rate table (clearly labeled editable estimates), common hospital room types, and two example shifts.
- An in-app Settings > "Data & Security" page stating in plain language: what the app stores, that no PHI is collected by design, per-org data isolation, and how to export/delete all org data (implement both).
- Error tracking hook points (console-based logger abstraction now; a note in README on adding Sentry later).
- Final pass: lighthouse/perf sanity, empty states for every screen, and a QUICKSTART.md for a new EVS director: import scans → tag rooms → set rates → build schedule → print.

## Definition of done

- `npm run dev` works with zero config (local adapter).
- Tests green. Parsers verified against the real magicplan files.
- With Supabase + Vercel keys supplied, `npm run build` deploys to a URL with login, roles, and org isolation working.
- README's "what Josh must do manually" checklist is complete and accurate.

Work through all phases now. Do not ask for stylistic preferences — make sound decisions and document them in the README. Stop only at [NEEDS JOSH] items, print the instructions, and continue with unblocked work.
