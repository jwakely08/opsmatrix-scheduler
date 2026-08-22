# OPSMATRIX — COMPLETE PROJECT HANDOFF
*Written 2026-08-06, last refreshed 2026-08-22 (evening: CAD room import + Workload Intelligence). Purpose: drop this file into a fresh AI chat (or hand to a developer) and continue seamlessly. Everything below is current, verified, and deployed. If you are an AI session working on this repo: update this file before your session ends whenever you ship meaningful changes.*

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
| `https://jwakely08.github.io/opsmatrix-scheduler/classic.html?fp=1` | Deep link straight to Max Space → Floor Plans |
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
  - `#workload` = **Workload Intelligence** (standalone; injected "workload intelligence" sub-tab in Classic's Admin Settings — see §12a)
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
| `opsmatrix_fusion_aliases` | importer + WI | approved source-name → room/floor type mappings (`{roomTypes:{}, floorTypes:{}}`) |
| `opsmatrix_sched_v1` | old React app | its own AppState (irrelevant to Classic) |

The user's Anthropic API key lives at `opsmatrix_v7 → settings.maxApiKey` (device-only; shared by Classic's Max AI and the AI plan reader — `loadApiKey`/`saveApiKey` in `classicStore.ts`, `getApiKey`/`setApiKey` in `fusion-ui.js`). **Never commit, bundle, or default a key anywhere in this repo**, and never load third-party scripts from a CDN into pages that can see it (pdf.js is vendored for exactly this reason).

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
- **Ground truth fixtures**: `test-fixtures/Test_project_-_1st_Floor.dxf` + `Test_project_Statistics.csv` are **Josh's REAL magicplan exports (READ-ONLY — never regenerate/substitute)**. History note: earlier fixtures were synthetic stand-ins I generated (fully disclosed + audited on 2026-08-05); Josh then provided the real files and everything was rebuilt/validated against them. **151 vitest tests green (`npm test`)**: parsers, geometry (incl. damaged-scan robustness), compute engine of the old React app, schedule-doc generation (§10), the AI plan reader (§11), and the CAD room-list importer + workload engine (§12a).

## 9. DEMO SEED (critical for Josh's client demos)

- `buildClassicDemo()` in `src/bridge/fusionEntry.ts`: imports the real scan (building "Demo Medical Center"), 10 employees (Maria Alvarez EVS Supervisor, Denise Carter [birthday in 3 days → dashboard reminder], James Okafor, Linda Tran, Robert Miller [Floor Tech, isProjectTech], Keisha Osei, Carlos Reyes, Angela Brooks, Sam Whitfield, Dorothy Nguyen; 1st/2nd/3rd shifts), 2 schedules (101 East Wing→Denise, 102 West Wing→James, 100% coverage), a manager note + a strip&wax project note (Classic auto-creates project schedule P01→Robert Miller + calendar entry + daily inspections).
- Demo floor types: Bedroom 1+3 Carpet, Bedroom 2 Hard floor — finished, **"Other" left empty ON PURPOSE** (the red fix-me room for demos).
- Seeding entrances: `classic.html?demo=1` (via fusion-seed.js, pre-app) and `maps.html?demo=1` (via mapsMain.tsx, guarded: only reseeds stamped-demo/absent data, never real work). Stamp bump (`demoStamp()` v3 → v4...) forces every device to refresh. That's the reset lever.

## 10. PRINTED DAILY SCHEDULES (added 2026-08-12)

`src/pro/scheduleDoc.ts` (+297-line test file) builds the document; `src/pro/PrintSchedule.tsx` + `src/pro/print.css` render it. Reached from the hub's Schedules tab; preview shows exactly what prints, print/save-as-PDF from there.

- Two-page sheet per schedule: room-by-room running order, then that schedule's rooms highlighted on the real floor plan.
- **No employee name anywhere** — any worker can be handed any schedule (rule locked in by a test).
- Each room lists the tasks OpsMatrix already holds for it, derived from the task-ownership model (§5), never typed in. A room shared by two schedules prints only its own tasks/minutes on each sheet.
- Rooms numbered by `spaceOrder` (tap order), with up/down controls to fix a mis-tap. No route arrows.
- Room **priority** (High/Medium/Low) is set during Max Space validation and prints as a colored chip; unset = Medium.
- **Breaks/lunches** are configured in Admin Settings → Scope, movable/shortenable/off per schedule; a break outside a schedule's shift is skipped; the clock stops for breaks so printed times are real. Tests cover the time walk, break placement, and midnight-crossing shifts.
- Non-space duties (discharges, routes, porters) print as their own block only when attached.

## 11. AI FLOOR-PLAN READER — "Read it with Max" (added 2026-08-13)

Claude Fable 5 vision reads any floor-plan **picture or PDF** into real OpsMatrix rooms. Code: `src/bridge/aiPlanImport.ts` (reader + sanitising), `aiPlanRequest.test.ts` (exact API request shape), `src/pro/AiPlanImport.tsx` (hub UI), `src/pro/planFile.ts` (file→image, PDF rasterising).

- **Two-pass reading**: Pass 1 asks WHERE the drawing sits on the sheet (cheap, schema-constrained bounding box, padded; rejected if sliver/whole-page). Pass 2 re-renders JUST that region at full resolution (PDFs re-rasterise from vectors via pdf.js viewport offsets; images crop, never upscale) and reads rooms from the crop. Falls back to the whole sheet on any locate/crop failure. This is what makes a real architect's sheet (title block, legends, drawing at quarter-page) readable.
- **Coordinate-scale rescue**: models sometimes answer in pixels/percent/0-1000 instead of the demanded 0..1 fractions; one divisor is detected across the whole answer and undone per-axis before validation. Zone-wrapper polygons (one shape containing several rooms' centres) are pruned.
- The upload is **INPUT ONLY**: OpsMatrix redraws the plan itself in the magicplan house style (white ground, dark wall mass, ~5in scaled walls); the source picture is never shown back. Printed square footages are trusted → plan scale from their median → arrives already calibrated. Rooms with no printed number stay BLANK for the manager (never faked from the name).
- Reply is schema-constrained; failures reported in plain English (rejected key, rate limit, no rooms found), never a status code. Fable 5 rejects sampling params and thinking config; browser calls need the direct-access header — the request-shape tests lock this in.
- **pdf.js is vendored to our origin** (`scripts/copy-pdfjs.cjs`, runs automatically in build/dev scripts) and lazy-loaded only when a PDF is picked — never a CDN, because the API key lives in the page's localStorage.

## 12. UNIFIED UPLOAD + INSTALL AS AN APP (added 2026-08-12/13)

- One **"Upload"** button fronts Max Space: pick what you have — floor plan (picture/PDF), room-list spreadsheet, or magicplan export — and OpsMatrix routes it. Choosing a plan file asks right there: **"Read it with Max (recommended)"** or "Upload as a picture only — trace and calibrate by hand". The picker is emptied the moment the dialog opens so one upload can never become two plans.
- Classic's Floor Plans tab is back alongside Map View (it was silently hidden when Map View arrived, removing the only non-magicplan on-ramp); `classic.html?fp=1` deep-links to it.
- The API key UI shows a real saved state ("key saved on this device (…1234)") in both the upload flow and the Map View panel.
- Classic's upload form quirks fixed in place: labels now say PDFs are allowed; blank Building/Floor now focuses the missing box instead of silently swallowing the file; the MutationObserver watches characterData (React rewrites the button label in place).
- **PWA**: `public/opsmatrix.webmanifest` + icons + `public/sw.js` — Classic installs to taskbar/home screen. The service worker is deliberately **NETWORK-FIRST** (cache is offline fallback only; cache-first is the classic stale-build bug this avoids). Only same-origin GETs are touched; API calls never cached.
- The room sidebar has separate Room number / Room name fields, and incomplete rooms are flagged for missing number and name alongside floor type.

## 12a. CAD ROOM-LIST IMPORT + WORKLOAD INTELLIGENCE (added 2026-08-22)

A hospital CAD/location spreadsheet (Excel/CSV — e.g. a "Comprehensive Location Report") becomes normal OpsMatrix rooms in the ONE canonical dataset (`opsmatrix_v7.spaces`) — no floor plan required. List View, Max Schedule and Workload Intelligence work immediately; Map View stays honestly empty until a plan arrives and ATTACHES to those same rooms. Verified end-to-end in the browser against Josh's real 510-room export (NOT committed — see §15 privacy).

- **Importer** `src/pro/roomListImport.ts` (pure, heavily tested): weighted header-row detection (superset of Classic's own vocabulary + Gross/Net S.F., Cost Center, Department code vs description, Internal Handle, AHU, Space Definition, Floor Finish/Type); square-footage column SELECTION (picks the populated candidate — Gross when Net is all zeros — and records the choice); SCOPE-DRIVEN room-type classification (Josh's rule: "Scope determines everything"): approved alias → exact Scope match → `scopeTypeMatch` abbreviation matching against whatever room types Scope holds (add "Telemetry Room" in Scope and every "TELE. RM." classifies itself; ambiguous fits match nothing) → deterministic CAD-shorthand table (PAT. RM. → Patient Room, VEST. → Lobby, SOILED → Utility, VENTS → Mechanical...); `resolvePendingRoomTypes` re-tests Needs-Review rooms on every Scope change and page load, filling blanks only, never overriding; floor-finish mapping to Classic's three floor types; blanks stay blank, nothing invented. **Upsert**: rooms matched by CAD Internal Handle, then System|Building|Floor|Room#|Name composite; re-imports update instead of duplicate, and a manager's hand-edit is never clobbered (`source.applied` snapshot). Full source row preserved under `space.source`.
- **Department identity ≠ name** (critical): identity from dept code (or name); a numeric code is never displayed as a name; blank-named-but-coded departments stay SEPARATE with stable display labels "Blank Department N" (`blankDeptLabels`) that are never saved as names; When a file has NO department columns at all (Josh's E-building export), a populated Cost Center becomes the department: the code is the IDENTITY (`departmentKey: "cc:<code>"`) and — **Josh's explicit call, 2026-08-22** — the description becomes the department NAME, deterministically title-cased out of CAD ALL-CAPS ("ONCOLOGY (7 EAST)" → "Oncology (7 East)"; `titleCase` in roomListImport.ts). A code with no description falls back to the stable "Blank Department N" placeholder; a junk cost center like "-" is no evidence, so those rooms stay unassigned; real department columns still outrank cost center. Renames during validation survive re-imports (manual edit wins; identity keeps the grouping).
- **Cleanability** (rules engine): `RoomTypeRule.cleanability` ("non-cleanable" on new built-in infrastructure types: Mechanical/Electrical/Data-Telecom/Shaft/Shell/Roof; new cleanable types: Stairwell, Elevator, Storage, Utility Room, Locker Room); per-space override; unknown type → "Needs review", never silently counted. `spaceCleanability`/`weeklyMinutes` (per-visit `computeMinutes` × room-type frequency; null = cannot calculate yet)/`estimatedFte` (weekly minutes ÷ productiveMinutes×shiftsPerWeekPerFte — the ORIGINAL surface-C staffing algorithm, defaults 420 & 5, editable) in `rules.ts`.
- **Workload Intelligence** `maps.html#workload` (`src/pro/WorkloadApp.tsx`, aggregation in `src/pro/workload.ts`): Overview (Estimated FTE Requirement hero, Model Coverage = objective % of sqft classifiable, Total/Cleanable/Non-cleanable/Unresolved areas, FTE-by-department + hours-by-floor bars — all values printed, no hover), Space Validation (summary chips incl. "Blank department name — structure exists" vs "No department assigned", search/filter/pagination, multi-select bulk room-type/floor-type/cleanability/department, approvals saved as aliases in `opsmatrix_fusion_aliases` so future imports self-classify, "✨ Ask Max about unclassified names" = user-triggered Fable suggestions via `src/bridge/roomTypeSuggest.ts` — never automatic, approvals become aliases), Workload Breakdown (System → Building → Floor → Department → Room drill-down, room click = full plain-English calculation explanation + source lineage), Assumptions (the engine's real numbers only). Classic Admin Settings gains a "workload intelligence" sub-tab (fusion-ui injection).
- **Upload flow**: Classic's ⬆ Upload → "Room list — Excel or CSV" now runs OUR importer in place (fusion-ui overlay → `OpsMatrixFusion.importRoomListIntoStorage`), with a §-style result screen (List View available / Map View: no floor plan provided / …) and a record in Classic's own importHistory. Hub: "📊 Import room list" button in #spaces and #workload headers (`RoomListImportButton`, SheetJS lazy-loaded from `public/vendor/`).
- **Plans attach, never duplicate** (`attachPlanToRooms`, all three plan paths — magicplan, AI-read in hub, AI-read in Classic): imported plan rooms match existing spaces by Building+Floor+Room# (or unambiguous Room# alone), geometry moves onto the existing room, plan.rooms remapped to its id, blanks filled, values kept.
- **SheetJS vendored**: `scripts/copy-xlsx.cjs` → `public/vendor/xlsx.full.min.js` (gitignored, built by all build/dev scripts); make-classic.cjs REWRITES the archive's cdnjs xlsx tag to the vendored copy in the generated classic.html (archive untouched). NOTE: the archive still loads React 18.2 + Tailwind 2 from cdnjs — pre-existing, flagged in §15.

## 13. BUILD & DEPLOY WORKFLOW

```
npm test                                      # 151 tests must stay green
npm run build:classic                         # rebuild public/classic.html (after fusion/bridge/rules changes!)
npm run build                                 # MPA: index.html + maps.html
git add -A && git commit && git push          # Pages deploys automatically (~35s)
```
- **Forgetting `build:classic` after touching `src/bridge/*`, `src/pro/rules.ts` (shared), or `scripts/fusion-*.js` ships a stale classic.html — the #1 gotcha.**
- On Josh's Windows machine: repo at `F:\ops matrix`, **no system node** — `export PATH="/f/Claude/tools/node:$PATH"` (git bash); `gh` at `C:\Program Files\GitHub CLI\gh.exe`, authenticated as `jwakely08`. In Claude Code web/remote sessions, node and npm are standard — no PATH juggling needed.
- Local dev: launch config `opsmatrix-vite` (port 5173) serves everything incl. `/classic.html` and `/test-fixtures/*` (`predev` copies pdf.js automatically).
- Commits authored as Josh (`-c user.name="Josh Wakely" -c user.email="josh.j.wakely@gmail.com"`).

## 14. FILE MAP (the ones that matter)

```
<repo root>
├── opsmatrix-v5-maxplans.html      ← ORIGINAL ARCHIVE. NEVER TOUCH.
├── public/classic.html             ← generated Classic+fusion (commit it)
├── public/sw.js + opsmatrix.webmanifest ← PWA install (network-first SW, §12)
├── maps.html / index.html          ← Vite MPA entries
├── src/bridge/fusionEntry.ts       ← importScan, buildClassicDemo, demoStamp, V5 rate mirror
├── src/bridge/aiPlanImport.ts      ← AI plan reader: two-pass crop, sanitising, scale rescue (§11)
├── src/pro/MapsApp.tsx             ← the hub (Map/Schedules tabs, #spaces, #scope, sidebars, report, two-tone)
├── src/pro/AiPlanImport.tsx        ← hub UI for "Read it with Max" (§11)
├── src/pro/planFile.ts             ← plan file → image; PDF rasterising via vendored pdf.js
├── src/pro/roomListImport.ts       ← CAD room-list importer: header detect, dept identity, upsert, attach (§12a)
├── src/pro/workload.ts             ← WI aggregation: totals, hierarchy tree, room explanation (§12a)
├── src/pro/WorkloadApp.tsx         ← Workload Intelligence UI, 4 tabs + import button (§12a)
├── src/pro/sheetFile.ts            ← spreadsheet file → raw sheets (lazy same-origin SheetJS)
├── src/bridge/roomTypeSuggest.ts   ← user-triggered Fable room-type suggestions (§12a)
├── scripts/copy-xlsx.cjs           ← vendors SheetJS to public/vendor/ (auto-runs in builds)
├── src/pro/scheduleDoc.ts          ← printed-schedule document builder (§10)
├── src/pro/PrintSchedule.tsx + print.css ← printed-schedule rendering (§10)
├── src/pro/classicStore.ts         ← v7 access, coverage model, setCoverage, CRUD, FLOOR_TYPES, API key, display rectify
├── src/pro/rules.ts                ← rules engine (§6) + breaks config
├── src/pro/pro.css                 ← hub styling (dark slate + teal #0d9488)
├── scripts/fusion-ui.js            ← Classic DOM injections (§7, §12) incl. unified Upload + smart-read flow
├── scripts/fusion-seed.js          ← pre-app demo seeder
├── scripts/make-classic.cjs        ← builds public/classic.html
├── scripts/copy-pdfjs.cjs          ← vendors pdf.js to our origin (auto-runs in build/dev)
├── vite.fusion.config.ts           ← IIFE build of fusionEntry
├── src/lib/geometry.ts (+ tests)   ← auto-detection pipeline (§8)
├── src/lib/parsers.ts              ← magicplan DXF/CSV parsers (VERBATIM from original importer — frozen)
├── test-fixtures/                  ← Josh's REAL exports (read-only ground truth)
├── src/{App,components,lib,storage,state,auth}  ← old React app (surface C)
└── supabase/migrations/0001_init.sql ← full multi-tenant schema+RLS (unused until Josh makes account)
```

## 15. OPEN ITEMS / NEXT CANDIDATES

- **Josh demos to a potential client** — the demo link must stay pristine; bump the seed stamp whenever the demo should refresh on his devices.
- Non-space task instances count toward schedule totals in the HUB legend/cards; Classic's own schedule cards count room minutes only (known, communicated).
- Sidebar add-flow: dropdown was fully replaced by the tap-list; Josh may still ask for a compact variant.
- Multi-floor "stacking" floor picker exists (`.floorstack`, shows when >1 plan) but has never seen real multi-floor data.
- ~~Printing is probably the next real gap~~ — **DONE 2026-08-12**: native printed schedules in the hub (§10). Classic's original Visual/Legacy Builder screens remain unreachable via nav (rewired), which is fine now.
- The AI plan reader (§11) has been verified on Josh's real architect's sheet, but more real-world plans will shake out edge cases; the coordinate-scale rescue and zone-wrapper pruning exist because real model answers needed them.
- The 20.6 sq ft closet reads 18.1 from geometry (threshold convention) — explained, accepted.
- Old React app (surface C) still deployed at `/` with its own demo; candidate for retirement to avoid confusion.
- Privacy note (flagged to Josh): the repo is public and contains his real home scan + it's visible in the public demo. The Akron hospital CAD workbook used to build/verify the room-list importer was deliberately NOT committed (real hospital data, public repo) — keep it out.
- The ARCHIVE loads React 18.2 + Tailwind 2 from cdnjs into classic.html (pre-existing; the xlsx CDN tag is now rewritten to a vendored copy at build time). Vendoring React/Tailwind the same way would complete hard rule 7 — safe, mechanical, not yet done.
- Supabase/multi-user path exists only in surface C; if Classic needs multi-user, that's a big future project.

## 16. HARD RULES (violate none of these)

1. `opsmatrix-v5-maxplans.html` is read-only, forever.
2. `test-fixtures/*.dxf|csv` are Josh's real exports — never regenerate, never substitute, never "fix" them. CSV numbers are ground truth for validation only.
3. `cleanableSqFt`/interior area is the only number in workload math; gross is display-only.
4. No hover tooltips anywhere. Motion 150–250ms eased. Plain language over jargon.
5. Never claim success without running the tests and verifying in the browser; report failures honestly (Josh explicitly audited honesty once — see §8 history note).
6. Commit + push only when green; every push goes live.
7. Never commit, bundle, or default an API key; never load third-party scripts from a CDN into pages that hold the key (vendor them, like pdf.js).
