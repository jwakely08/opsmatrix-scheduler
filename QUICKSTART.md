# QUICKSTART — for a new EVS director

Five steps from floor scan to printed schedules.

## 1. Import scans

Open the app → **Import**. Drag in your magicplan exports — the floor plan
`.dxf` **and** its Statistics `.csv` (one pair per floor). The CSV is required;
the DXF adds the clickable map.

You'll see a review table. This is where you tag rooms:

- **Room type** — pick from the templates (Patient Room, Restroom, Corridor…).
  Picking a type auto-fills floor type, fixtures, tasks and cleaning frequency;
  you can still change any of them.
- **Building / Floor / Department are sticky** — type them once on the first
  room and they carry down until you type something different.

Click **Confirm import**. Your rooms appear in the facility tree on the left.

## 2. Tag rooms (anything you missed)

Click any room — in the tree, on the map, or on a board chip — to open its
detail drawer: rename it, move departments, fix the floor type or fixture
count, adjust frequency. The computed minutes update instantly.

## 3. Set rates

**Settings → Workload rates.** The table ships with industry-typical estimates
(minutes per 1,000 cleanable sq ft, by room type × floor type). Tune them to
your building. Also set:

- minutes per restroom fixture,
- productive minutes per shift (drives the FTE estimate),
- your shifts (names and hours).

Only *cleanable* (interior) square footage is ever used in the math.

## 4. Build the schedule

**Schedule** tab:

1. **+ Employee** for each of your staff (name, shift, weekly pattern).
2. Drag rooms from the **Unscheduled** tray onto an employee's card. Drag a
   whole tree branch (a department, a floor) to assign it all at once.
3. Watch the **capacity bar** — green is fine, amber is near capacity, red is
   overloaded. Drag rooms between employees to rebalance.
4. **+ Non-space job** for discharge cleans, porters, trash & linen runs,
   laundry, floor projects — they count against capacity like room work.
5. Switch to **By area** to check every department has coverage.

## 5. Print

**🖨 Print daily schedules** — one clean page per employee with their rooms,
tasks, minutes and a signature line. Print or save as PDF.

---

**Backup:** Settings → "Download backup JSON" saves everything; "Upload backup"
restores it (including backups from the old single-file version).
