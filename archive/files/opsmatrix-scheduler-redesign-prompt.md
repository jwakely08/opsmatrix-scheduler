# OpsMatrix Scheduler — Redesign Prompt for Claude Code

Paste everything below this line into Claude Code, in the folder containing your current OpsMatrix HTML file and `opsmatrix-scan-importer.html`.

---

## Mission

Rebuild OpsMatrix as **a scheduling-only platform for hospital EVS**. Strip everything that is not scheduling. The result is a focused tool: import scanned floor data, see the facility as a tree and a map, and build/manage cleaning schedules with accurate workload math. All removed features (Max AI assistant tools, inspections, AI floor-plan detection, pitch/report modules) may return later — do not design around them now, just remove them cleanly.

Produce a single new file: `opsmatrix-scheduler.html`. Do not modify the original app file; it stays as the archive.

## Hard architectural rules (unchanged from OpsMatrix conventions)

- Single-file HTML application. All CSS and JS inline.
- All JSX pre-compiled — no in-browser Babel. Plain React.createElement or precompiled output only, or use vanilla JS + no framework if simpler. Choose one and be consistent.
- External libraries only from cdnjs.cloudflare.com, and only if genuinely needed.
- No optional chaining (`?.`) and no nullish coalescing (`??`) anywhere.
- Use `Object.assign()` for object merging.
- Persistence: localStorage under a NEW key `opsmatrix_sched_v1` (do not read or write `opsmatrix_v6`/`v7`).
- Export/backup: a Settings action that downloads the full localStorage state as JSON and can re-import it.

## Feature 1 — Intake page (new first-run workflow)

A clean landing/intake screen shown when no facility data exists (and reachable anytime via "Import"):

- Drag-and-drop or tap-to-browse upload accepting **magicplan exports: floor plan `.dxf` + Statistics `.csv`** (multiple floors = multiple file pairs; each DXF is one floor).
- Lift the working parser functions **verbatim** from `opsmatrix-scan-importer.html` in this folder: `parseDXF`, `parseStatsCSV`, `decodeDxfText`. They are tested against real magicplan exports. Key facts:
  - DXF: wall geometry as LWPOLYLINE on layer `walls` (units: feet), room labels as TEXT, door/window markers as INSERT blocks named `W-*`. Rooms are NOT closed polygons — walls are strips with door gaps. Render walls as-is; do not attempt room-polygon reconstruction.
  - CSV: authoritative numbers. Per-room: name, area sq ft (interior), perimeter, ceiling height, door/window areas. Plan totals: `grossSqFt` (with walls) and `cleanableSqFt` (without walls).
  - **`cleanableSqFt` and per-room interior areas are the only numbers used in workload math.** Gross is stored for reference only and labeled as such.
- After files parse, show an **intake review step**: table of imported rooms with editable name, room type, floor type, department, fixtures. Include:
  - Room-type **templates**: choosing a room type auto-fills floor type, fixture count, and default task set (all overridable).
  - **Sticky defaults**: building, floor, and department persist from the previous row until changed.
- Confirm → rooms merge into the facility hierarchy. Re-importing the same floor offers replace/merge.

## Feature 2 — Facility tree + room data

- Left panel: parent/child tree — Building → Floor → Department → Room — with expand/collapse, counts, and rollup totals at every level (rooms, cleanable sq ft, scheduled hours, unscheduled rooms).
- Selecting any node scopes the whole UI (map, lists, schedule board) to that branch.
- Room detail view: name/number, type, department, floor type, fixtures, cleanable sq ft, ceiling height, assigned tasks, computed minutes, assigned shift/employee, frequency.

## Feature 3 — Map view (kept, simplified)

- Canvas render of each floor's DXF walls + door markers + room labels (reuse the rendering approach from the importer file: fit-to-extent, Y-flip, scale bar).
- Rooms are clickable: since DXF lacks room polygons, place clickable markers at the room-label positions (fall back to a list link when a room has no label). Clicking opens the room detail / schedule action.
- Room highlighting via **filters**: by shift, department, room type, schedule status (scheduled / unscheduled / partial), employee, frequency. Filters combine. Distinct color per active filter value with a legend.

## Feature 4 — Workload formulas (the math engine)

- A rates table, fully editable in Settings, seeded with industry-typical defaults (label clearly as editable estimates, e.g. ISSA-style production rates):
  - Base minutes per 1,000 cleanable sq ft by **room type × floor type** (e.g. patient room/VCT, office/carpet, restroom/tile, corridor/VCT, OR/sheet vinyl).
  - Per-fixture add-on minutes (restroom fixtures).
  - Task-level modifiers: daily clean, discharge/terminal clean multiplier, project work (strip/wax, extraction) as separate rate rows.
  - Frequency schedule per room type (7x/week, 5x/week, weekly, etc.), overridable per room.
- Computed outputs everywhere: minutes per room per task, hours per shift, per department, per employee, per floor, facility total. FTE estimate = total daily minutes / productive minutes per shift (editable, default 420).

## Feature 5 — Scheduling board (the core)

- **Drag-and-drop** scheduling: drag rooms (or whole tree branches) onto shifts/employees; drag between employees to rebalance.
- Shift model: named shifts with start/end (e.g. Days 0700–1530), editable.
- Employee model: name, role, shift, weekly pattern; capacity bar showing assigned minutes vs. productive minutes, turning amber near capacity and red over.
- Schedule views: by employee (row = person, load bar + assigned rooms/tasks), by area (tree branch → who covers it), and a printable daily schedule per employee.
- **Non-space jobs** (not tied to rooms): discharge/bed cleans, porters/patient transport, trash & linen runs, laundry workers, floor techs, and custom roles. These are scheduled as time blocks or unit-based workloads (e.g. discharge cleans: expected count/day × minutes each) and count against employee capacity exactly like room work.
- Unscheduled-work tray: rooms and jobs not yet assigned, visible and draggable.

## Feature 6 — Design direction

- Clean operations-dashboard aesthetic; information-dense but calm. Pick a deliberate palette and type pairing (not default Tailwind grays). Dark-on-light is fine; prioritize legibility on a laptop in a hospital office.
- Layout: tree (left) / map or board (center) / detail (right drawer). Responsive down to tablet.
- Fast interactions: no page reloads, keyboard-friendly, visible focus states.

## Build order

1. Data model + localStorage layer + intake (parsers, review step, templates, sticky defaults).
2. Tree + room detail + rollups.
3. Rates engine + computed minutes.
4. Scheduling board with drag-and-drop + non-space jobs + capacity math.
5. Map view with filters/highlighting.
6. Settings (rates editor, shifts, backup/restore), print view, polish pass.

After each step, verify against the real test files in this folder (`Test_project_-_1st_Floor.dxf` + statistics CSV): 4 rooms, 653.88 cleanable sq ft, 799.11 gross.
