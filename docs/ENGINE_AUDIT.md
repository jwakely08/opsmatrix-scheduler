# OpsMatrix — Engine Audit and Skin Refactor Plan

*Step 0 of the OpsMatrix Hotels build. Written 2026-09-14 against commit `7ad4d5d` (main). Baseline: `npm test` → 23 files, **302 tests green**. Nothing in this document has been built yet; it is the review gate before phase 1.*

---

## 0. Corrections to the brief (read first)

The brief describes OpsMatrix as "Supabase + Vercel, React". The repo is close but not that. Five facts change how the refactor should be shaped:

1. **Three surfaces, not one app.** (A) *Classic* — `public/classic.html`, generated from the read-only archive `opsmatrix-v5-maxplans.html` plus injected fusion scripts. (B) *The Hub* — `maps.html` → `src/pro/*`, React, hash-routed. (C) the old React scheduler at `index.html` → `src/App.tsx`, superseded and a retirement candidate. The archive **cannot be skinned** (hard rule 1: never modify it). The hotel skin therefore has to live entirely in the Hub. Recommendation in §5.
2. **Deploy targets are GitHub Pages + Cloudflare Pages, not Vercel.** `deploy.yml` → GitHub Pages (public local-mode demo), `deploy-staging.yml` → Cloudflare Pages (`staging` branch), `deploy-production.yml` → Cloudflare Pages (`main`, approval-gated). There is no `vercel.json`. "One Vercel preview per phase" needs a decision (§7, decision A).
3. **Data is a localStorage workspace mirrored to Supabase, not row-per-room tables in use.** Nine localStorage stores (`WORKSPACE_KEYS` in `src/pro/workspaceStore.ts`) sync as JSON blobs into `public.workspaces` (migration 0002). The per-row tables in 0001 (`rooms`, `employees`, …) belong to surface C and are unused by Classic/Hub. Tenant = `public.organizations`; members = `public.profiles` with roles `director | supervisor | staff`. Adding `industry` is one column on `organizations` plus one settings key locally.
4. **Cloud mode is dormant unless `VITE_SUPABASE_*` env vars are set at build time.** A local build has no login and treats the device owner as the administrator (`accountRole.ts`). The skin loader must work in both modes.
5. **Voice already exists twice.** Rover Mode (`src/pro/RoverMode.tsx` + `roverParse.ts`) is on-device Web Speech with a local grammar, no AI round trip. Hey Max (archive + `scripts/fusion-ui.js`) is Web Speech → Anthropic tool calls with 43 tools. Ambient capture (phase 5) should be built as a third, engine-level service that reuses Rover's recognizer wrapper and Max's Anthropic transport (`src/pro/aiTransport.ts`, `anthropicRequest()` in `aiPlanImport.ts`), not a fourth stack.

---

## 1. Classification key

- **ENGINE** — industry-agnostic today. Ships to both skins untouched.
- **ENGINE / hospital strings** — the logic is agnostic but labels, defaults, alias tables, or prompt text assume a hospital. These are the refactor targets (§3).
- **HOSPITAL SKIN** — EVS-specific by nature. Stays as-is, becomes the hospital pack's content or stays hospital-only.
- **LEGACY** — surface C or archive-era code; not skinned, candidate for retirement.

---

## 2. Module inventory

### 2a. Floor-plan ingest and geometry — ENGINE

| Module | Lines | Class | Notes |
|---|---|---|---|
| `src/lib/parsers.ts` | 131 | ENGINE | magicplan DXF/CSV parsers. Frozen. |
| `src/lib/geometry.ts` | 807 | ENGINE | Seal + extract + face↔room assignment. Battle-tested; do not touch. |
| `src/pro/planSnap.ts` | 527 | ENGINE | Wall detection, snap, rectify, union, overlap. Pure. |
| `src/pro/planCalibrate.ts` | 80 | ENGINE | Anchor-based scale from known room sizes. |
| `src/pro/planFile.ts` | 140 | ENGINE | File → image; PDF rasterising via vendored pdf.js. |
| `src/pro/dxfRaster.ts` | 158 | ENGINE | DXF → picture. |
| `src/pro/PlanStudio.tsx` | 1001 | ENGINE / hospital strings | The Calibration Editor. Agnostic except placeholder text (`"e.g. Patient Room"` at 785) and the Scope-label mapper at 931. |
| `src/pro/studioSets.ts` | 225 | ENGINE / hospital strings | Saved calibration sets. Comment only: `account: // the hospital system` (31). |
| `src/bridge/aiPlanImport.ts` | 703 | ENGINE / hospital strings | Two-pass AI plan reader. The prompt says "hospital cleaning system" (79) and the room-name vocabulary list is hospital (26–28, 110). Request shape is test-locked; only the prompt text and vocabulary move to the pack. |
| `src/pro/AiPlanImport.tsx` | 329 | ENGINE / hospital strings | Hub upload modal. `Account <small>your hospital system</small>` (234). |
| `src/bridge/fusionEntry.ts` | 431 | mixed | `importScan` + `attachPlanToRooms` = ENGINE. `V5_RATES` (13–29) and `TYPE_GUESSES` (32–48) = hospital alias table. `buildClassicDemo` (225–262, "Demo Medical Center", EVS roles) = HOSPITAL SKIN demo seed. |

### 2b. Space inventory — ENGINE with hospital strings

| Module | Lines | Class | Notes |
|---|---|---|---|
| `src/pro/classicStore.ts` | 583 | ENGINE | Space/schedule/employee CRUD, coverage model (`setCoverage`), `FLOOR_TYPES`, priority 1/2/3, API-key healing. No hospital strings. Space schema is already generic: `{roomNumber, roomName, building, floor, department, roomType, floorType, squareFeet, fixtureCount, priority, notes, visualPts}`. A hotel room, suite member, or public area fits without a schema change. |
| `src/pro/SpacesApp.tsx` | 609 | ENGINE / hospital strings | Explorer / Room List / editor. `"Cleanable — counts toward EVS workload"` (202), notes placeholder `"keys, access, isolation notes…"` (224). |
| `src/pro/roomListImport.ts` | 838 | ENGINE / hospital strings | Header detection, department identity, upsert, attach = ENGINE. `hospitalcampus` header synonym (75) and the CAD-shorthand classification table `TYPE_RULES` (263–290: PAT. RM., TLT., SOILED, NURSES STN…) = hospital alias pack. `resolvePendingRoomTypes` / `scopeTypeMatch` are agnostic because they read whatever Scope holds. |
| `src/bridge/roomTypeSuggest.ts` | 107 | ENGINE / hospital strings | User-triggered AI type suggestions. Prompt says "hospital CAD/location export" (49–51). |
| `src/pro/roverParse.ts` | 223 | ENGINE / hospital strings | Local voice grammar. Type aliases at 62–66 ("or room", "nurses station", "isolation room") are hospital; the grammar itself reads Scope's labels and is agnostic. |
| `src/pro/RoverMode.tsx` | 276 | ENGINE | Full-screen voice validation. Comments mention hospital; UI strings do not. |
| `src/pro/exportData.ts` / `ExportApp.tsx` | 148 / 139 | ENGINE | Excel export, round-trip. Agnostic. |
| `src/pro/sheetFile.ts` | 89 | ENGINE | SheetJS loader. |
| `src/pro/buildingArt.ts` | 86 | ENGINE / hospital strings | Eight renders; preset label `"Azure Hospital"` (18). Cosmetic. |

### 2c. Scope rulebook and workload math — ENGINE with hospital DEFAULTS

| Module | Lines | Class | Notes |
|---|---|---|---|
| `src/pro/rules.ts` | 529 | ENGINE / hospital defaults | The single most important file. `computeMinutes`, `weeklyMinutes`, `estimatedFte`, `spaceCleanability`, `requiredTasks`, `splitRequiredTasks`, tombstone merge in `loadRules`/`saveRules` are all agnostic. **Hospital content**: `defaultRules()` room types (147–175: Exam, Emergency, Patient, Procedure, Operating…), non-space defs (176–180: Discharges 40 min), the legacy label maps in `typeIdFromLabel` (301–312) and `typeIdFromLabelStrict` (323–335: `isolationroom → patient-room`, `nursesstation → office`), and the `TO_CLASSIC`/`FROM_CLASSIC` vocab bridge (494–503, ties to the archive's task ids). Comments: "counts toward EVS", "ISSA-style healthcare". |
| `src/pro/scopeDraft.ts` | 66 | ENGINE | Per-section save isolation. |
| `src/pro/workload.ts` | 207 | ENGINE | Aggregation, hierarchy tree, per-room explanation. Zero hospital strings. |
| `src/pro/WorkloadApp.tsx` | 719 | ENGINE / hospital strings | "EVS Cleanable Area" (138, 179), "excluded from normal EVS workload" (605), "ISSA-style healthcare starting rates" (643), "Counts toward EVS workload" (653). |
| `src/pro/floorcare.ts` / `FloorCareApp.tsx` | 286 / 844 | ENGINE | Floor-tech scheduling, equipment-priced. Hotels have floor crews too (marble lobbies, carpet corridors). Agnostic. |
| `src/pro/equipment.ts` | 230 | ENGINE | OEM machine catalog. |
| `src/pro/routes.ts` | 310 | ENGINE / hospital eligibility | `sanTiming` (real-distance pricing through `plan.ratio`) is exactly the travel engine the hotel labor spec needs — reuse it. `isSoiledUtility` (88) and `POLICE_TYPES` (93) are hospital eligibility predicates → pack. |
| `src/pro/SanitationApp.tsx` / `PolicingApp.tsx` | 289 / 271 | ENGINE / hospital strings | UI strings ("soiled utility room") throughout Sanitation. Hotel equivalent: linen/trash collection run. Rename via pack labels. |

### 2d. Scheduling, printing, reports — ENGINE with hospital strings

| Module | Lines | Class | Notes |
|---|---|---|---|
| `src/pro/MapsApp.tsx` | 2023 | ENGINE / hospital strings | Hub shell, hash router (54–92), `SideNav` (1953–1998), Map/Rooms/Schedules tabs, Scope UI. Strings: `"e.g. Patient Room"` (1033), `"counts toward EVS workload"` (1071), `"Add non-space task (discharges…)"` (1257, 1716, 1783), `"Reset to healthcare standards"` (1846–1850). Nav labels are all "Max …". |
| `src/pro/MapCanvas.tsx` | 328 | ENGINE | The living map. Already has `flagFor`, per-room fill/stroke callbacks, pinch zoom, building picker. This is the House Map — it needs a status-layer fill callback, not a rewrite. |
| `src/pro/scheduleDoc.ts` | 335 | ENGINE | Time walk, breaks, midnight crossing. Comment-only EVS mention (83). |
| `src/pro/PrintSchedule.tsx` + `print.css` | 294 / 183 | ENGINE / hospital strings | Header `"Environmental Services · …"` (56), footer `"OpsMatrix EVS Management System"` (146, 289). |
| `src/pro/nav.ts` | 68 | ENGINE | Back-trail. |

### 2e. Auth, tenancy, cloud, AI transport — ENGINE

| Module | Lines | Class | Notes |
|---|---|---|---|
| `supabase/migrations/0001_init.sql` | 309 | ENGINE (tenancy) + LEGACY (row tables) | `organizations`, `profiles`, `invites`, RLS helpers = ENGINE. `rooms/employees/assignments/non_space_jobs/room_types/rate_tables/imports` = surface C, unused by the live app. |
| `0002_production.sql` | 237 | ENGINE | `workspaces` blob store with whitelist, `ai_usage`, `audit_log`. The **key whitelist** must grow for any new store (§4). `workspaceSchema.test.ts` enforces it. |
| `0003`, `0004` | — | ENGINE | Whitelist extensions. Pattern to copy. |
| `src/pro/workspaceStore.ts`, `syncEngine.ts` | 135 / 281 | ENGINE | Collect/restore/sync. |
| `src/pro/accountRole.ts` | 32 | ENGINE | `owner | director | supervisor | staff`; only `canEditFormula`. The hotel role list (GM, HK manager, Inspector, Engineering, Front desk) is a superset problem — §5 keeps the DB role column and adds a per-skin display mapping; a real role matrix is Josh's later spec. |
| `src/pro/AuthGate.tsx`, `CloudGate.tsx`, `cloud.ts`, `cloudConfig.ts` | — | ENGINE / one string | Org-name placeholder `"e.g. Demo Medical Center EVS"` (CloudGate 311). |
| `src/pro/aiTransport.ts`, `anthropicRequest()` | 29 / — | ENGINE | Direct-key vs proxy selection. The intent parser (phase 5) calls this. |
| `supabase/functions/claude-proxy/index.ts` | 212 | ENGINE | Server-side key, budget, metering, `FORCE_MODEL`. |
| `src/lib/logger.ts` | 43 | ENGINE | Sentry, lazy. |

### 2f. Classic + fusion layer — HOSPITAL SKIN

| Module | Lines | Class | Notes |
|---|---|---|---|
| `opsmatrix-v5-maxplans.html` | 614 KB | HOSPITAL SKIN, read-only | Dashboard, Max AI, Calendar, Inspections, Logs, Reports, Notes, Team, Admin Settings. 29 "EVS", 22 "Patient", 18 "Isolation" occurrences. Cannot be relabeled at source. |
| `scripts/fusion-ui.js` | 1807 | HOSPITAL SKIN (mostly) | DOM injections into Classic, Hey Max tool extensions (43 tools; descriptions at 850–1027 say EVS/discharge). Hospital tenants keep it; hotel tenants never load Classic (§5). |
| `scripts/fusion-seed.js` | 63 | HOSPITAL SKIN | Demo seeder for Classic. |
| `scripts/make-classic.cjs` | 92 | ENGINE (build) | Builds classic.html; CDN guard. |
| `src/bridge/fusionEntry.ts` `buildClassicDemo` | — | HOSPITAL SKIN | See 2a. |

### 2g. Old React scheduler (surface C) — LEGACY

`src/App.tsx`, `src/components/*`, `src/lib/{compute,demo,seeds,types,migrate}.ts`, `src/storage/*`, `src/state/*`, `src/auth/*`, `src/styles.css`. Hospital-typed throughout (`JobType = "discharge" | "porter" | …`, seeded `rt_patient`, "Discharge / terminal clean multiplier"). Tested (compute engine tests are part of the 302). **Recommendation: do not skin it.** Leave it deployed at `/` for now; retire in a separate decision.

---

## 3. Hard-coded hospital assumptions inside ENGINE modules

Grouped by the kind of change each needs. Every item moves into the hospital pack; the hotel pack supplies its own.

**A. Scope defaults (data, not code)** — `src/pro/rules.ts`
- `defaultRules().roomTypes` 147–175 — 23 built-in types, 12 of them clinical.
- `defaultRules().nonSpaceDefs` 176–180 — Discharges (40 min + travel), Day Porter.
- `defaultRules().tasks` 131–146 — the nine tasks are actually agnostic (scrub, dust mop, burnish, high dust, trash, mop, vacuum). Keep in engine; packs may add.
- `general` 127–130 — 33 / 40 sq ft per min, 420 productive min, 5 shifts. Engine defaults; hotel pack overrides rates only.
- `breaks` 184–188 — agnostic.

**B. Alias / classification tables (data)** — these decide what an imported or spoken name becomes
- `rules.ts` `typeIdFromLabel` 301–312 and `typeIdFromLabelStrict` 323–335 — legacy label maps (`isolationroom`, `nursesstation`, `orroom`, `erroom`).
- `fusionEntry.ts` `TYPE_GUESSES` 32–48 and `V5_RATES` 13–29 — magicplan name → type guess + archive-era rate mirror.
- `roomListImport.ts` `TYPE_RULES` 263–290 and header synonym `hospitalcampus` 75.
- `roverParse.ts` spoken aliases 62–66.
- `aiPlanImport.ts` room-name vocabulary 26–28.
- `routes.ts` `isSoiledUtility` 88, `POLICE_TYPES` 93.

**C. Prompt text sent to the model (data)**
- `aiPlanImport.ts` 79 ("hospital cleaning system"), 86, 110, 116.
- `roomTypeSuggest.ts` 49–51.
- `fusion-ui.js` Hey Max tool descriptions 850–1027 (hospital-only surface; no change needed).

**D. UI strings (data)** — ~20 sites
- `MapsApp.tsx` 1033, 1071, 1257, 1716, 1783, 1846, 1850.
- `SpacesApp.tsx` 202, 224. `WorkloadApp.tsx` 138, 179, 605, 643, 653.
- `PrintSchedule.tsx` 56, 146, 289. `AiPlanImport.tsx` 234. `PlanStudio.tsx` 785. `CloudGate.tsx` 311. `buildingArt.ts` 18.
- `SanitationApp.tsx` ~14 "soiled utility" strings; `PolicingApp.tsx` "porter" strings.

**E. Navigation (data)** — `MapsApp.tsx` `SideNav` items 1983–1998 (nine of sixteen point into Classic).

**F. Theme (data)** — `pro.css` 930–950 "THE DEEP THEME" tokens (`--deep-bg`, `--cyan`, `--teal`, `--ink`…). Already variable-driven, which makes the hotel theme an override block rather than a fork.

**G. Structural assumptions that are NOT strings** (worth naming because they shape phases 3–7)
- **No status model exists.** A space has `estimatedCleaningMinutes`, `priority`, `cleanability`, `notes`, and an `assignedScheduleId`. There is no occupancy, condition, work-order, inspection-freshness, or verdict layer anywhere in Hub data. Classic's inspections/logs live inside the archive's `opsmatrix_v7` blob and are not readable as typed engine data. → new engine store (§4).
- **Frequency is per room type per week** (`"7x / week"`), not per day per occupancy. Hotel demand (departures × departure minutes + stayovers × stayover minutes) is a *daily* forecast-driven quantity. `computeMinutes` stays; a demand layer sits above it (phase 7). Hospitals get the same layer via counted discharges, which `nonSpaceOccurrenceMinutes` already prices per occurrence.
- **Travel is a flat 5-min qualifier** in Scope, but `routes.ts` already prices travel by real plan distance. Phase 7 promotes the distance engine to the general assignment builder.
- **"Cluster" does not exist.** The handoff mentions `mergeShapes` (geometry union through doorways) — that is a drawing merge, not a logical grouping with one verdict. Suites need a lightweight `space.parentSpaceId` or a `clusters` list; recommendation in §5.
- **Room condition vocabulary is not modelled at all**, so there is no risk of a second one — but phase 3 must define it once, in the engine, and the hospital skin must display it as bed status.

---

## 4. Where `industry` lives

| Mode | Source of truth | Read by |
|---|---|---|
| Local build | `opsmatrix_v7 → settings.industry` (`'hospital' \| 'hotel'`, absent = hospital) | `loadSkin()` at every page entrance, same place `healApiKey()` runs (`mapsMain.tsx`, `fusion-seed.js`). Rides the existing workspace sync/backup — no new store, no migration for the setting itself. |
| Cloud build | `public.organizations.industry` (migration **0005**: `text not null default 'hospital' check (industry in ('hospital','hotel'))`) | Fetched once with the profile in `CloudGate`, mirrored into `settings.industry` so every downstream reader has one code path. Directors set it in Admin / Skin settings; `create_organization(org_name, user_display_name)` gains an `industry` argument. |

New engine stores planned for later phases (each is one whitelist migration, copying 0003/0004): `opsmatrix_status` (status layers + verdict inputs, phase 3–4), `opsmatrix_ledger` (capture ledger, phase 5), `opsmatrix_integrations` (adapter config + write-back log, phase 8–9). `workspaceSchema.test.ts` will fail CI if any is forgotten.

---

## 5. Minimum refactor — the plan

Goal: a tenant tagged `industry` swaps vocabulary, room types, Scope defaults, nav, theme, and alias tables, with the hospital tenant byte-identical to today. No big-bang rewrite. Estimated at one focused session including tests.

### 5.1 Directory

```
src/skins/
  types.ts            SkinPack interface
  index.ts            loadSkin(), useSkin(), activeSkin (memoised), applyTheme()
  hospital/
    pack.ts           labels, nav, roomTypes, nonSpaceDefs, aliases, prompts, reports
    theme.ts          the CURRENT deep-theme tokens, lifted verbatim from pro.css
  hotel/
    pack.ts
    theme.ts          ivory / sand / gold token set from the brief
    theme.css         [data-skin="hotel"] overrides (fonts, radii, hairline rules)
```

The brief says `skins/` at the repo root. Vite and `tsc -b` only see `src/`, so `src/skins/` is the working location; nothing else about the proposal changes.

### 5.2 The pack shape

```ts
interface SkinPack {
  id: 'hospital' | 'hotel';
  labels: {            // every string in §3.D, keyed by meaning
    productName: 'OpsMatrix' | 'OpsMatrix Hotels';
    workforceNoun: 'EVS' | 'Housekeeping';
    workloadNoun: 'EVS workload' | 'housekeeping workload';
    spaceExample: 'Patient Room' | 'King Guest Room';
    accountHint: 'your hospital system' | 'your hotel group';
    occurrenceTaskHint: 'discharges…' | 'departure cleans…';
    resetStandards: 'Reset to healthcare standards' | 'Reset to hotel standards';
    printHeader: 'Environmental Services' | 'Housekeeping';
    printFooter: string;
    collectionRoom: 'soiled utility room' | 'linen / trash room';
    // …
  };
  nav: NavItem[];      // SideNav + which items exist at all
  scope: {
    general: Partial<Rules['general']>;
    roomTypes: RoomTypeRule[];
    tasks?: TaskRule[];               // additions only
    nonSpaceDefs: NonSpaceDef[];
    nonSpaceQualifiers?: NonSpaceQualifier[];
  };
  aliases: {
    legacyLabels: Record<string, string>;      // rules.ts maps
    nameGuesses: [RegExp, string, number][];   // fusionEntry TYPE_GUESSES
    cadShorthand: [RegExp, string][];          // roomListImport table
    spoken: [string, string][];                // roverParse
    aiVocabulary: string[];                    // aiPlanImport
    headerSynonyms: Record<string, ...>;       // 'hospitalcampus' etc.
  };
  eligibility: {
    collectionRoute: (space) => boolean;       // isSoiledUtility
    policing: string[];                        // POLICE_TYPES
  };
  prompts: { planReaderContext: string; typeSuggestContext: string };
  reports: ReportTemplate[];                   // phase 6; empty in phase 1
  theme: ThemeTokens;
  classicSurface: boolean;   // hospital true, hotel false
}
```

### 5.3 Code changes, file by file

1. **`rules.ts`** — `defaultRules(industry = activeIndustry())` builds from `pack.scope` merged over engine defaults. `loadRules()` / `saveRules()` unchanged (tombstones keep working per account). `typeIdFromLabel*` read `pack.aliases.legacyLabels`. `TO_CLASSIC` stays (archive bridge, hospital-only in practice, harmless for hotel).
   **Lock-in test:** `defaultRules('hospital')` deep-equals a committed snapshot of today's output; existing `rules.*.test.ts` untouched.
2. **`fusionEntry.ts`** — `guessType` reads `pack.aliases.nameGuesses`; `V5_RATES` becomes hospital-pack data (only Classic's screens read those minutes). `buildClassicDemo` stays hospital.
3. **`roomListImport.ts`** — the shorthand table and `hospitalcampus` synonym come from the pack. All 512 lines of importer tests keep passing with the hospital pack active (default).
4. **`roverParse.ts`**, **`aiPlanImport.ts`**, **`roomTypeSuggest.ts`** — alias list and prompt context from the pack. Request-shape tests unchanged (they pin headers/schema, not prose).
5. **`routes.ts`** — `isSoiledUtility` / `POLICE_TYPES` delegate to `pack.eligibility`.
6. **UI strings (§3.D)** — replace with `skin.labels.*`. One `useSkin()` hook, no i18n framework.
7. **`MapsApp.tsx` `SideNav`** — items from `pack.nav`. Hotel nav (phase 1 placeholder → real screens in phases 3–7): House map, Next four hours, Labor, Handover, Scar map, Front desk, Max Space (renamed "Rooms & spaces"), Floor Care, Scope, Exporting, Admin / Skin settings. No links into Classic.
8. **Theme** — `applyTheme(pack.theme)` sets CSS variables on `<html data-skin="…">` at entrance. Hospital tokens are the values already in `pro.css` 938–950, so the hospital render is unchanged. Hotel overrides land in `src/skins/hotel/theme.css`, imported only when the skin is hotel. Google Fonts are blocked by hard rule 6 for pages holding the key → **vendor Cormorant Garamond + Manrope woff2 into `public/fonts/`** via a `copy-fonts.cjs` step like pdf.js.
9. **`mapsMain.tsx`** — `loadSkin()` before render; if `!pack.classicSurface`, the hub is the landing and every `classic:` nav token is absent. `fusion-seed.js` / `fusion-ui.js`: if `settings.industry === 'hotel'` redirect `classic.html` → `maps.html` (one line each). Classic stays exactly as it is for hospital tenants.
10. **Admin / Skin settings** — new hub view `#admin` (phase 1 minimal: industry picker, shows active pack; phase 8–9 adds integrations and write-back toggles). Changing industry re-runs `defaultRules` merge for *missing* built-ins only; it never deletes a tenant's edited types.
11. **Migration 0005** — `organizations.industry`; `create_organization` RPC accepts it; `CloudGate` (which already fetches the profile) mirrors it into settings.
12. **`/design` route** — `maps.html#design`, renders every hub primitive (buttons, tiles, chips, map cell, verdict lamp, capture card, drawer) in the active theme. Ships in phase 2 but the route stub lands in phase 1 so the review link exists.

### 5.4 What phase 1 explicitly does not do
- No status model, verdict, capture, ledger, reports, labor demand, or adapters. Those are phases 3–9 and get their own stores.
- No changes to the archive, geometry, parsers, test fixtures, or Classic's behaviour for hospital tenants.
- No role matrix. `accountRole.ts` gains a per-skin *display* name map only (director → "GM / AGM" in hotel).

### 5.5 Acceptance for phase 1
- `npm test` green with the hospital snapshot test added; `npm run build` and `npm run build:classic` clean.
- Local build with no `settings.industry`: hub and Classic pixel-identical to today (Playwright screenshot diff on Explorer, Map, Scope).
- Local build with `settings.industry = 'hotel'`: hub shows hotel nav, hotel room types in Scope (King, Queen, Suite, Accessible, Public restroom, Lobby, Corridor, Gym, Pool deck, Elevator lobby, Back of house, Linen room), hotel labels, hotel theme tokens; `classic.html` redirects to the hub.
- Cloud build: migration 0005 applied to staging; org created with `industry='hotel'` loads the hotel pack after sign-in.

---

## 6. Phase map to existing engine pieces (so phases 3–7 reuse, not fork)

| Hotel feature | Reuses | Adds in engine |
|---|---|---|
| House map + layers | `MapCanvas` fill/stroke/flag callbacks, building picker, floor stack | status-layer fill resolver, verdict lamp glyph |
| Suites as clusters | `space.department`-style grouping, `attachPlanToRooms` | `space.clusterId` + cluster verdict = worst child; hospital uses it for pods/wings |
| Manual adapter (CSV) | `roomListImport.ts` header detection + upsert | a `status` column set (condition, occupancy, promised time, OOO) into the status store |
| Ready Confidence | — | `src/engine/verdict.ts`, pure, freshness-gated; test: stale required signal ⇒ never green |
| Ambient capture | Rover's recognizer wrapper, `anthropicRequest()`, Hey Max's tool schema style | `src/engine/capture/` intents + readback + apply + ledger; 20+ utterance tests |
| Generated reports | `scheduleDoc` time walk, `PrintSchedule` print path, `exportData` | ledger → template → PDF/share |
| Space-based labor | `computeMinutes`, `weeklyMinutes`, `estimatedFte`, `nonSpaceOccurrenceMinutes`, `sanTiming` distance model, `scheduleDoc` boards | daily demand from forecast, contiguous-run builder, scattered-vs-contiguous delta in minutes and dollars |
| Mews adapter | `syncEngine` patterns, `claude-proxy` as the edge-function template | `supabase/functions/pms-mews`, webhook → status store |

---

## 7. Decisions needed before phase 1 starts

**A. Preview hosting.** The repo has no Vercel project. Options: (1) add `deploy-preview.yml` that deploys `claude/*` branches to Cloudflare Pages as branch previews using the secrets `deploy-staging.yml` already has — one link per phase, no new account; (2) you create a Vercel project and add its token as a secret. Recommendation: (1).

**B. Hotel tenants and Classic.** Recommendation: hotel tenants never see `classic.html`; the hub is the whole product for them. Dashboard, Calendar, Team, Inspections and Reports for hotels are built as hub views in phases 3–6 (they are needed anyway for the ledger-driven reports). Alternative would be relabeling the archive by DOM injection, which is fragile and hard rule 1 forbids fixing at source.

**C. Fonts.** Vendor Cormorant Garamond + Manrope (hard rule 6) rather than Google Fonts. ~300 KB total. Confirm.

**D. Skins path.** `src/skins/` (bundler-visible) rather than root `skins/`. Confirm.

**E. Surface C.** Leave deployed and untouched, or retire during phase 1 to avoid a third hospital-only surface confusing the skin story. Recommendation: leave it; retire separately.

**F. The 420 / 5 defaults.** The brief keeps 420 productive minutes and 5 shifts per FTE for hotels. Confirm the hotel starting rates you want in `skins/hotel/pack.ts` (departure clean by type, stayover, turndown, public-area sq ft per minute, travel per floor change) or I seed industry-typical placeholders clearly labelled "starting point, editable" like the hospital ones.

Reply on this document and I start phase 1.
