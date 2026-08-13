# OPSMATRIX — COMPLETE PROJECT HANDOFF
*Written 2026-08-06. Purpose: drop this file into a fresh AI chat (or hand to a developer) and continue seamlessly. Everything below is current, verified, and deployed.*

---

## 1. WHAT THIS PROJECT IS

OpsMatrix is Josh Wakely's hospital EVS (Environmental Services) operations platform: import magicplan floor scans, auto-detect rooms, calculate cleaning workloads from healthcare production rates, and build visual staff schedules on the floor plan. Josh is demoing it to potential clients; the guiding UX principle throughout: **a 60-year-old EVS manager who barely uses computers must be able to run it without training.** No hover tooltips ever (Josh's explicit rule). Consumer-tile aesthetic.

## 2. LIVE LINKS (GitHub Pages, auto-deploys on every push to main)

| URL | What it is |
|---|---|
| `https://jwakely08.github.io/opsmatrix-scheduler/classic.html?demo=1` | **THE DEMO LINK.** OpsMatrix Classic, self-seeding lived-in demo |
| `https://jwakely08.github.io/opsmatrix-scheduler/classic.html` | Classic without seeding (never touches saved data) |
| `https://jwakely08.github.io/opsmatrix-scheduler/maps.html` | Max Schedules hub (Map + Schedules tabs) |
| `https://jwakely08.github.io/opsmatrix-scheduler/maps.html#spaces` | Max Space — Map View (room editing) |
| `https://jwakely08.github.io/opsmatrix-scheduler/maps.html#scope` | Admin Settings — Scope (rules manager) |
| `https://jwakely08.github.io/opsmatrix-scheduler/` | The older React scheduler app (still deployed, largely superseded) |

- Repo: `https://github.com/jwakely08/opsmatrix-scheduler` (public — required for free Pages)
- Local folder: `F:\ops matrix` (git repo, Windows, **no system node** — use portable node at `F:\Claude\tools\node`)
- GitHub CLI: `C:\Program Files\GitHub CLI\gh.exe`, authenticated as `jwakely08` (repo+workflow scopes)
- CI: `.github/workflows/deploy.yml` — push to main → tests → build → Pages deploy (~35s)

## 3. THE THREE SURFACES (architecture)

**A. OpsMatrix Classic** (`public/classic.html`, 878KB) — Josh's ORIGINAL v5 app (Max AI assistant, Dashboard, Max Space/Calendar/Inspections/Logs/Reports/Notes/Team, Admin Settings). Built by `npm run build:classic` which takes the **untouchable archive** `opsmatrix-v5-maxplans.html` (614KB, NEVER modify it) and injects three scripts before/after body:
  1. `scripts/out/fusion-core.js` — IIFE bundle of `src/bridge/fusionEntry.ts` (parsers + geometry pipeline + demo builder), built by `vite.fusion.config.ts`
  2. `scripts/fusion-seed.js` — demo seeding, runs BEFORE the classic app's script (order matters: seeding after loses a race with Classic's save effect)
  3. `scripts/fusion-ui.js` — DOM injections into Classic (see §7)

**B. The Hub** (`maps.html` → `src/pro/*`) — React page, dark theme matching Classic. Renders three distinct views by URL hash:
  - no hash = **Max Schedules** (tabs: Map, Schedules) — Classic's "Max Schedules" nav button is rewired to navigate here
  - `#spaces` = **Max Space — Map View** (standalone; Classic's Floor Plans tab is hidden and replaced by an injected "🗺 Map View" button)
  - `#scope` = **Admin Settings — Scope** (standalone; Classic's Admin Settings → "scope" sub-tab is rewired here)
  It is a SEPARATE DOCUMENT from Classic on purpose: no in-memory state races — it reads/writes localStorage directly, Classic reloads fresh when you navigate back.

**C. Old React scheduler** (`index.html` → `src/App.tsx` etc.) — the earlier map-first app with its own storage (`opsmatrix_sched_v1`), Supabase schema (`supabase/migrations/0001_init.sql`, multi-tenant RLS, never activated — Josh never made the Supabase account), PWA manifest. Superseded by A+B but still deployed and tested.

## 4. DATA STORES (all localStorage, per-origin)

| Key | Owner | Contents |
|---|---|---|
| `opsmatrix_v7` | Classic | `{spaces, employees, schedules, logs, inspections, notes, importHistory, shifts, settings}` |
| `opsmatrix_v7_plans` | Classic Max Plans | `[{id, building, floor, img (SVG dataURL), w, h, rooms:[{spaceId, pts}]}]` |
| `opsmatrix_v7_demo_stamp` | fusion seed | current: `classic-demo-v3:<dxflen>:<csvlen>` |
| `opsmatrix_fusion_rules` | Scope manager | the Rules object (see §6) |
| `opsmatrix_fusion_nonspace` | hub | `[{id, name, hours, scheduleId, roomIds[]}]` non-space task instances |
| `opsmatrix_sched_v1` | old React app | its own AppState (irrelevant to Classic) |

**Space schema** (Classic + fusion extras): `{id, roomNumber, roomName, building, floor, department, roomType (label e.g. "Patient Room"), floorType, squareFeet, fixtureCount, estimatedCleaningMinutes, assignedScheduleId, visualPts:[{x,y}] (plan pixels), visualPlanId, spaceTasks:[our task ids] (fusion), vacuumDaysPerWeek (fusion), importSource:'magicplan-scan', updatedAt}`.
**Floor types** (exactly three + empty): `"Carpet" | "Hard floor — finished" | "Hard floor — unfinished"`; empty string = missing → room renders RED in Map View. `FLOOR_TYPES` const in `classicStore.ts`.

**Schedule schema**: `{id, num ('101'...), name, shift ('1st Shift'|'2nd'|'3rd'), employeeId, employee, color, targetHours, spaceOrder:[spaceIds], roomTasks:{spaceId:[classic task ids]}, tasks, notes, projectNoteId? (auto project schedules), createdAt, updatedAt}`.

## 5. THE TASK-OWNERSHIP MODEL (the most important concept)

- A **SPACE** owns its required task list: `space.spaceTasks` (our task ids; General Clean always implicit). Edited in Max Space — Map View.
- A **SCHEDULE** owns which of those tasks it covers per room: `sched.roomTasks[spaceId]` (classic-vocab ids). `'general-cleaning'` present in that list = **primary coverage** (the base clean). Exactly one primary per room, enforced by `setCoverage()` in `src/pro/classicStore.ts` (it demotes any other primary, which keeps only its extra tasks).
- A room may be on MULTIPLE schedules with different tasks — that's how a floor tech runs the corridor while an EVS worker high-dusts it. On the map such rooms render **two-tone**: primary color + 45° diagonal stripes of the second schedule's color (SVG `<pattern id="st-<hex>">`).
- `space.assignedScheduleId` mirrors the primary schedule (keeps Classic's own screens coherent).
- Vocab bridge (`rules.ts`): ours ↔ classic — `auto-scrub↔floor-scrub`, `dust-mop`, `high-dusting`, `burnish` (custom), `trash-pull`; primary adds `general-cleaning` + (`wet-mop` hard / `vacuuming` carpet).
- `uncovered(data, rules, space)` → `{baseUncovered, tasks[]}` drives the "⚠ Unassigned Tasks" report and the "Has unscheduled tasks" filter.
- **Key interaction flows (hub Map tab):** click room → sidebar: "This room needs" chips (⚠ on uncovered), coverage rows per schedule with task chips, "+ Add to schedule" button → inline colored schedule list → tap = instant add (`setCoverage(..., keepEmpty=true)` — the keepEmpty flag exists because an explicit add with no remaining tasks must still create the row). Legend (bottom-left) click a schedule → its rooms highlight, click rooms to add/remove (add = take over base clean), sidebar opens simultaneously.

## 6. THE RULES ENGINE (`src/pro/rules.ts`, storage `opsmatrix_fusion_rules`)

- **General formula** (applied to every room): 1 min per `hardSqftPerMin` (33) sq ft hard floor (mopping included) / per `carpetSqftPerMin` (40) sq ft carpet (vacuuming included; carpet rooms carry `vacuumDaysPerWeek`). Labeled as ISSA-style healthcare starting rates, all editable.
- **Room types** (12 preloaded per Josh's spec, each `{id, label, qualifierMin, frequency}`): Office(+0, 5x/wk), Exam Room(+4), Emergency Room(+10), Patient Room(+6), Lounge(+2), Lobby(+2), Waiting Room(+2), Procedure Room(+8), Restroom(+8), Operating Room(+25), Corridor(+0), Hallway(+0). Custom types addable (name+frequency+qualifier, General Clean always attached, NO building/applies dropdowns).
- **Space tasks** `{id, label, sqftPerMin|null, flatMin, autoFor:[roomTypeIds], addable}`: Auto Scrub (1/200, auto corridors+hallways), Dust Mop (1/150, auto corridors+hallways), Burnishing (1/100, manual), High Dusting (1/120, independently assignable), Trash Pull (2min flat). Custom addable.
- **Non-space defs** `{id, label, defaultHours}`: Discharges(2h), Sanitation Route(3h), Day Porter(8h). Instances get attached to schedules; room-linking optional.
- `computeMinutes(rules, space, {tasks?, includeBase?})` prices full rooms or coverage subsets; every number renders as plain-English lines. Any rules change → `syncSpaceMinutes` recalcs every space's `estimatedCleaningMinutes` (keeps Classic's displays consistent).
- `typeIdFromLabel` fuzzy-maps legacy labels (Bedroom→Patient Room etc. happens at import via `guessType` in fusionEntry).

## 7. FUSION-UI INJECTIONS INTO CLASSIC (`scripts/fusion-ui.js`)

- "⚡ Import magicplan Scan" button next to Add Floor Plan/Upload First Plan (Max Plans screen) → overlay → `OpsMatrixFusion.importScan(dxf, csv, {building})` → writes v7 spaces + plans → reload.
- "Max Schedules" nav button → capture-phase click → `maps.html`.
- Admin Settings "scope" sub-tab → capture-phase click → `maps.html#scope`. "Break Times"/"Turn Times" tab buttons hidden.
- Max Space: "Floor Plans" tab hidden; injected "🗺 Map View" button → `maps.html#spaces` (which has its own ⚡ Import button in the header).
- MutationObserver keeps injections alive across Classic re-renders. All buttons borrow Classic's own classNames.

## 8. GEOMETRY PIPELINE (`src/lib/geometry.ts` — battle-tested, don't casually rewrite)

`deriveShapesAuto(geometry, rooms)` is THE entry point: runs seal+extract at increasing heal tolerances, scored by labeled-face count then CSV-area agreement (CSV = ground truth for VALIDATION, never fabrication). Stages:
1. `analyzeOpenings` — for each DXF door/window insert, RAYCAST against actual wall material along candidate axes (nearest wall edges AND their perpendiculars; tightest two-sided hit wins — a T-junction door near a crossing wall's edge otherwise reads solid). Patch quads clamped to wall thickness, biased toward the wall if the insert sat inside material.
2. `sealingPatches` = door patches + endpoint gap healer.
3. `extractRoomFaces` — union walls+patches (clipper-lib, **StrictlySimple=true essential**), then faces = `boundingBox − wallRegion` DIFFERENCE (never read union holes — they come back self-touching/merged).
4. Face↔room assignment: one-to-one, by contained label text (fuzzy `matchLabel`) ranked by CSV-area agreement — survives duplicate names (real scan has 3 rooms named "Bedroom"). Unique-area rescue for missing labels; `hullClosureStrips` (inward-biased) for open scan sides.
- Real-scan results (locked in tests): Bedroom 420.25→421.41 (0.28%), Bedroom 141.53→141.46, Bedroom 71.84→71.96, Other 20.60→18.11 (magicplan counts doorway-threshold floor; tolerance = 5% OR 3 sq ft absolute, documented).
- `mergeShapes` unions rooms through their doorways (door patches as bridges; refuses if no connecting door); walls between merged rooms survive as holes.
- **Ground truth fixtures**: `test-fixtures/Test_project_-_1st_Floor.dxf` + `Test_project_Statistics.csv` are **Josh's REAL magicplan exports (READ-ONLY — never regenerate/substitute)**. History note: earlier fixtures were synthetic stand-ins I generated (fully disclosed + audited on 2026-08-05); Josh then provided the real files and everything was rebuilt/validated against them. 45 vitest tests green (`npm test`): parsers, geometry (incl. damaged-scan robustness), compute engine of the old React app.

## 9. DEMO SEED (critical for Josh's client demos)

- `buildClassicDemo()` in `src/bridge/fusionEntry.ts`: imports the real scan (building "Demo Medical Center"), 10 employees (Maria Alvarez EVS Supervisor, Denise Carter [birthday in 3 days → dashboard reminder], James Okafor, Linda Tran, Robert Miller [Floor Tech, isProjectTech], Keisha Osei, Carlos Reyes, Angela Brooks, Sam Whitfield, Dorothy Nguyen; 1st/2nd/3rd shifts), 2 schedules (101 East Wing→Denise, 102 West Wing→James, 100% coverage), a manager note + a strip&wax project note (Classic auto-creates project schedule P01→Robert Miller + calendar entry + daily inspections).
- Demo floor types: Bedroom 1+3 Carpet, Bedroom 2 Hard floor — finished, **"Other" left empty ON PURPOSE** (the red fix-me room for demos).
- Seeding entrances: `classic.html?demo=1` (via fusion-seed.js, pre-app) and `maps.html?demo=1` (via mapsMain.tsx, guarded: only reseeds stamped-demo/absent data, never real work). Stamp bump (`demoStamp()` v3 → v4...) forces every device to refresh. That's the reset lever.

## 10. BUILD & DEPLOY WORKFLOW

```
cd "F:\ops matrix"
export PATH="/f/Claude/tools/node:$PATH"     # portable node (git bash)
npm test                                      # 45 tests must stay green
npm run build:classic                         # rebuild public/classic.html (after fusion/bridge/rules changes!)
npm run build                                 # MPA: index.html + maps.html
git add -A && git commit && git push          # Pages deploys automatically (~35s)
# verify: gh run list --limit 1 ; curl the live URLs
```
- **Forgetting `build:classic` after touching `src/bridge/*`, `src/pro/rules.ts` (shared), or `scripts/fusion-*.js` ships a stale classic.html — the #1 gotcha.**
- Local dev: launch config `opsmatrix-vite` (port 5173) serves everything incl. `/classic.html` and `/test-fixtures/*`.
- Commits authored as Josh (`-c user.name="Josh Wakely" -c user.email="josh.j.wakely@gmail.com"`).

## 11. FILE MAP (the ones that matter)

```
F:\ops matrix\
├── opsmatrix-v5-maxplans.html      ← ORIGINAL ARCHIVE. NEVER TOUCH.
├── public/classic.html             ← generated Classic+fusion (commit it)
├── maps.html / index.html          ← Vite MPA entries
├── src/bridge/fusionEntry.ts       ← importScan, buildClassicDemo, demoStamp, V5 rate mirror
├── src/pro/MapsApp.tsx             ← the hub (Map/Schedules tabs, #spaces, #scope, sidebars, report, two-tone)
├── src/pro/classicStore.ts         ← v7 access, coverage model, setCoverage, CRUD, FLOOR_TYPES, display rectify
├── src/pro/rules.ts                ← rules engine (§6)
├── src/pro/pro.css                 ← hub styling (dark slate + teal #0d9488)
├── scripts/fusion-ui.js            ← Classic DOM injections (§7)
├── scripts/fusion-seed.js          ← pre-app demo seeder
├── scripts/make-classic.cjs        ← builds public/classic.html
├── vite.fusion.config.ts           ← IIFE build of fusionEntry
├── src/lib/geometry.ts (+ tests)   ← auto-detection pipeline (§8)
├── src/lib/parsers.ts              ← magicplan DXF/CSV parsers (VERBATIM from original importer — frozen)
├── test-fixtures/                  ← Josh's REAL exports (read-only ground truth)
├── src/{App,components,lib,storage,state,auth}  ← old React app (surface C)
└── supabase/migrations/0001_init.sql ← full multi-tenant schema+RLS (unused until Josh makes account)
```

## 12. OPEN ITEMS / NEXT CANDIDATES

- **Josh demos to a potential client** — the demo link must stay pristine; bump the seed stamp whenever the demo should refresh on his devices.
- Non-space task instances count toward schedule totals in the HUB legend/cards; Classic's own schedule cards count room minutes only (known, communicated).
- Sidebar add-flow: dropdown was fully replaced by the tap-list; Josh may still ask for a compact variant.
- Multi-floor "stacking" floor picker exists (`.floorstack`, shows when >1 plan) but has never seen real multi-floor data.
- Classic Max Schedules original screens (Visual/Legacy Builder, print) are now unreachable via nav (rewired). If Josh misses printing daily schedules, either resurface a link or build print in the hub. **Printing is probably the next real gap.**
- The 20.6 sq ft closet reads 18.1 from geometry (threshold convention) — explained, accepted.
- Old React app (surface C) still deployed at `/` with its own demo; candidate for retirement to avoid confusion.
- Privacy note (flagged to Josh): the repo is public and contains his real home scan + it's visible in the public demo.
- Supabase/multi-user path exists only in surface C; if Classic needs multi-user, that's a big future project.

## 13. HARD RULES (violate none of these)

1. `opsmatrix-v5-maxplans.html` is read-only, forever.
2. `test-fixtures/*.dxf|csv` are Josh's real exports — never regenerate, never substitute, never "fix" them. CSV numbers are ground truth for validation only.
3. `cleanableSqFt`/interior area is the only number in workload math; gross is display-only.
4. No hover tooltips anywhere. Motion 150–250ms eased. Plain language over jargon.
5. Never claim success without running the tests and verifying in the browser; report failures honestly (Josh explicitly audited honesty once — see §8 history note).
6. Commit + push only when green; every push goes live.
```
