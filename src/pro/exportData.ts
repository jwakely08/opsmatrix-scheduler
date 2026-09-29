// Admin Settings → Exporting (§12g, reshaped 2026-08-28 evening): turn any
// slice of the room inventory — a whole building, one floor, one department,
// or a single room — into a spreadsheet, in two shapes:
//   • DATA EXPORT — the whole dataset, one row per room, columns exactly
//     like the tree reads (Building → Floor → Department → Room + the room's
//     data points). NOT a report: no totals, no summary page.
//   • RE-IMPORT — the round-trip one: headers drawn from the importer's own
//     vocabulary, so ⬆ Import accepts the file and upserts every row back
//     onto the same rooms (matched by Internal Handle, then the composite
//     identity) with nothing invented and nothing lost.
// Row building is pure so the round trip is provable by test; the UI layer
// (ExportApp) only feeds these rows to SheetJS.
//   • SCHEDULES EXPORT — the schedules as raw rows (one row per room stop,
//     in cleaning order, plus schedule-level tasks), so a client's own
//     system — or the partner digitizing their facilities data — can ingest
//     who cleans what, when, with which tasks and minutes. Raw on purpose:
//     no totals, no formatting, just columns.
import {
  spacePriority, PRIORITY_NUM, coverageForSpace,
  type ClassicData, type ClassicSpace
} from "./classicStore";
import { buildScheduleDoc, parseClock, formatClock } from "./scheduleDoc";
import { computeMinutes, type Rules } from "./rules";

const txt = (v: unknown) => String(v ?? "").trim();
export type Cell = string | number;

export interface ExportScope {
  building?: string;
  floor?: string;
  department?: string;
  roomId?: string;
}

/** the rooms a scope selects, in a stable reading order */
export function scopeSpaces(data: ClassicData, scope: ExportScope): ClassicSpace[] {
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  return (data.v7.spaces ?? [])
    .filter((sp) => {
      if (scope.roomId) return sp.id === scope.roomId;
      if (scope.building && txt(sp.building) !== scope.building) return false;
      if (scope.floor && txt(sp.floor) !== scope.floor) return false;
      if (scope.department && txt(sp.department) !== scope.department) return false;
      return true;
    })
    .sort((a, b) =>
      cmp(txt(a.building), txt(b.building)) ||
      cmp(txt(a.floor), txt(b.floor)) ||
      cmp(txt(a.department), txt(b.department)) ||
      cmp(txt(a.roomNumber), txt(b.roomNumber)));
}

/** plain-English name for what's being exported (also drives filenames) */
export function scopeLabel(data: ClassicData, scope: ExportScope): string {
  if (scope.roomId) {
    const sp = (data.v7.spaces ?? []).find((s) => s.id === scope.roomId);
    return sp ? `Room ${txt(sp.roomNumber) || txt(sp.roomName) || "?"}` : "One room";
  }
  const parts = [scope.building, scope.floor, scope.department].filter(Boolean) as string[];
  return parts.length ? parts.join(" · ") : "Everything";
}

export function exportFilename(data: ClassicData, scope: ExportScope, kind: "data" | "reimport" | "schedules"): string {
  const day = new Date().toISOString().slice(0, 10);
  if (kind === "schedules") return `opsmatrix-schedules-${day}.xlsx`;
  const slug = scopeLabel(data, scope).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "all";
  return `opsmatrix-${kind === "data" ? "export" : "reimport"}-${slug}-${day}.xlsx`;
}

interface SourceLike { key?: string; department?: string; site?: string; }

// ── the RE-IMPORT shape ─────────────────────────────────────────────────────
// Every header below normalizes into the importer's HEADER_KWDS vocabulary.
// Internal Handle carries the room's stable identity (the CAD handle when the
// room came from a file, else its OpsMatrix id) so a re-import matches by key
// before it ever needs the composite. Blank cells stay blank on purpose —
// the importer's rule is that a blank never overwrites anything.

export const REIMPORT_HEADERS = [
  "Campus", "Building", "Floor", "Room Number", "Room Name", "Room Type",
  "Department Code", "Department Name", "Cost Center", "Cost Center Description",
  "Floor Type", "Square Feet",
  "Fixture Count", "Priority", "Cleanable", "Notes",
  "Space Definition", "AHU", "Internal Handle"
] as const;
// deliberately NOT exported: Gross/Net S.F. — the importer's area-column
// selection could prefer them over Square Feet, and gross is display-only
// (hard rule 3). Square Feet here IS the cleanable area OpsMatrix uses.

export function reimportRows(data: ClassicData, scope: ExportScope): Cell[][] {
  const rows: Cell[][] = [[...REIMPORT_HEADERS]];
  for (const sp of scopeSpaces(data, scope)) {
    const src = sp.source as SourceLike | undefined;
    // departments grouped by cost center (identity "cc:<code>") re-import
    // through the importer's own cost-center path; everything else through
    // the department columns — identical identity either way
    const key = txt(sp.departmentKey);
    const isCC = key.startsWith("cc:");
    rows.push([
      txt(sp.system ?? src?.site),
      txt(sp.building),
      txt(sp.floor),
      txt(sp.roomNumber),
      txt(sp.roomName),
      txt(sp.roomType),
      isCC ? "" : key,
      isCC ? "" : txt(sp.department),
      isCC ? key.slice(3) : "",
      isCC ? txt(sp.department) : "",
      txt(sp.floorType),
      Number(sp.squareFeet) > 0 ? Number(sp.squareFeet) : "",
      Number.isFinite(Number(sp.fixtureCount)) ? Number(sp.fixtureCount) || 0 : "",
      // only an EXPLICIT priority exports — unset stays blank so a re-import
      // doesn't turn "never decided" into a decision
      sp.priority ? PRIORITY_NUM[spacePriority(sp)] : "",
      sp.cleanability ? (String(sp.cleanability) === "Non-cleanable" ? "No"
        : String(sp.cleanability) === "Needs review" ? "Needs review" : "Yes") : "",
      txt(sp.notes),
      txt((sp.source as { spaceDefinition?: string } | undefined)?.spaceDefinition),
      txt((sp.source as { ahu?: string } | undefined)?.ahu),
      txt(src?.key) || sp.id
    ]);
  }
  return rows;
}

// ── the DATA EXPORT shape ───────────────────────────────────────────────────
// Not a report (Josh, 2026-08-28): no totals, no summary page — the whole
// dataset, one row per room, columns laid out exactly like the tree reads:
// Building → Floor → Department → Room, then the room's own data points.

export const DATA_EXPORT_HEADERS = [
  "Building", "Floor", "Department", "Room Number", "Room Name", "Room Type",
  "Floor Type", "Fixtures", "Square Feet", "Priority (1-3)", "Internal Handle"
] as const;

export function dataExportRows(data: ClassicData, scope: ExportScope): Cell[][] {
  const rows: Cell[][] = [[...DATA_EXPORT_HEADERS]];
  for (const sp of scopeSpaces(data, scope)) {
    const src = sp.source as SourceLike | undefined;
    rows.push([
      txt(sp.building),
      txt(sp.floor),
      txt(sp.department),
      txt(sp.roomNumber),
      txt(sp.roomName),
      txt(sp.roomType),
      txt(sp.floorType),
      Number(sp.fixtureCount) || 0,
      Number(sp.squareFeet) > 0 ? Number(sp.squareFeet) : "",
      PRIORITY_NUM[spacePriority(sp)],
      txt(src?.key) || sp.id
    ]);
  }
  return rows;
}

// ── the SCHEDULES shape ─────────────────────────────────────────────────────
// One row per room stop, in the order the rooms are cleaned (the same order
// the printed sheet uses), then one row per schedule-level task (discharges,
// project work). Times, tasks and minutes come from the same engine as the
// map and the printed sheet, so the file always matches what's on screen.

export interface NamedSheet { name: string; rows: Cell[][] }

export const SCHEDULES_SHEET_HEADERS = [
  "Schedule #", "Schedule Name", "Shift", "Shift Start", "Shift End", "Days",
  "Worker", "Target Hours", "Room Stops", "Room Minutes",
  "Schedule-Task Minutes", "Break Minutes", "Total Est. Minutes"
] as const;

export const STOPS_SHEET_HEADERS = [
  "Schedule #", "Schedule Name", "Stop #", "Start Time", "End Time",
  "Room Number", "Room Name", "Building", "Floor", "Department", "Room Type",
  "Square Feet", "Priority (1-3)", "Tasks This Visit", "Est. Minutes"
] as const;

export const TASK_MINUTES_HEADERS = [
  "Schedule #", "Stop #", "Room Number", "Task", "Est. Minutes"
] as const;

export const SCHEDULE_TASKS_HEADERS = [
  "Schedule #", "Task", "Count", "Est. Minutes", "Linked Rooms"
] as const;

export const BREAKS_HEADERS = [
  "Schedule #", "Break", "Start", "End", "Minutes", "After Stop #"
] as const;

/** short weekday letters, Sunday-first — matches the day pills in the UI */
const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function daysText(days: unknown): string {
  const list = Array.isArray(days) ? days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
  if (!list.length || list.length === 7) return "Every day";
  return list.map((d) => DAY_ABBR[d as number]).join(" ");
}

/** an engine minute-line, reduced to the task's plain name */
function lineTaskName(label: string): string {
  const short = label.split(" — ")[0].trim();
  return /^general cleaning/i.test(short) ? "General Clean" : short;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The schedules as a RAW WORKBOOK another system can ingest and re-create
 * the schedule from — five sheets joined by Schedule # (and Stop #):
 *   Schedules       one row per schedule: shift hours, days, worker, totals
 *   Room Stops      one row per room, in cleaning order, timed start→end
 *   Task Minutes    one row per task per stop — how long EACH task takes
 *   Schedule Tasks  discharges / project work with counts and linked rooms
 *   Breaks          each break's window and where it falls in the run
 * Everything comes from buildScheduleDoc + computeMinutes — the same
 * engine as the map and the printed sheet, so the file matches the screen.
 */
export function schedulesWorkbookSheets(data: ClassicData, rules: Rules): NamedSheet[] {
  const spaces = data.v7.spaces ?? [];
  const byId = new Map(spaces.map((sp) => [sp.id, sp]));
  const schedRows: Cell[][] = [[...SCHEDULES_SHEET_HEADERS]];
  const stopRows: Cell[][] = [[...STOPS_SHEET_HEADERS]];
  const taskRows: Cell[][] = [[...TASK_MINUTES_HEADERS]];
  const nsRows: Cell[][] = [[...SCHEDULE_TASKS_HEADERS]];
  const breakRows: Cell[][] = [[...BREAKS_HEADERS]];

  for (const sched of data.v7.schedules ?? []) {
    const doc = buildScheduleDoc(data, rules, sched);
    schedRows.push([
      txt(doc.num), txt(doc.name), txt(doc.shift), txt(doc.shiftStart),
      txt(doc.shiftEnd), daysText(sched.days), txt(sched.employee),
      Number(sched.targetHours) || 8, doc.totals.rooms, doc.totals.roomMinutes,
      doc.totals.nonSpaceMinutes, doc.totals.breakMinutes, doc.totals.totalMinutes
    ]);

    for (const r of doc.rows) {
      const sp = byId.get(r.spaceId);
      const end = parseClock(r.startTime);
      stopRows.push([
        txt(doc.num), txt(doc.name), r.order, r.startTime,
        end == null ? "" : formatClock(end + r.minutes),
        txt(r.roomNumber), txt(r.roomName), txt(sp?.building), txt(sp?.floor),
        txt(sp?.department), txt(r.roomType), Number(sp?.squareFeet) || "",
        PRIORITY_NUM[r.priority], r.tasks.join(" + "), r.minutes
      ]);
      // per-task minutes: the engine's own itemized lines for this visit
      if (sp) {
        const cov = coverageForSpace(data, sp.id).find((c) => c.scheduleId === sched.id);
        if (cov) {
          const { lines, total } = computeMinutes(rules, sp, { tasks: cov.tasks, includeBase: cov.primary });
          let sum = 0;
          for (const l of lines) {
            taskRows.push([txt(doc.num), r.order, txt(r.roomNumber), lineTaskName(l.label), r1(l.minutes)]);
            sum += l.minutes;
          }
          // the per-room minimum can top the raw lines up — say so, so the
          // task rows always sum to the stop's minutes
          if (total - sum >= 0.5) {
            taskRows.push([txt(doc.num), r.order, txt(r.roomNumber), "Room minimum top-up", r1(total - sum)]);
          }
        }
      }
    }

    for (const t of doc.nonSpace) {
      const raw = data.nonSpace.find((x) => x.id === t.id);
      nsRows.push([
        txt(doc.num), txt(raw?.name ?? t.name), Number(raw?.count) || "",
        t.minutes, t.linkedRooms.join(", ")
      ]);
    }

    for (const b of doc.breaks) {
      breakRows.push([txt(doc.num), txt(b.label), b.startTime, b.endTime, b.minutes, b.afterRow]);
    }
  }

  return [
    { name: "Schedules", rows: schedRows },
    { name: "Room Stops", rows: stopRows },
    { name: "Task Minutes", rows: taskRows },
    { name: "Schedule Tasks", rows: nsRows },
    { name: "Breaks", rows: breakRows }
  ];
}
