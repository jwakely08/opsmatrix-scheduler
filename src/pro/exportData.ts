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
  spacePriority, PRIORITY_NUM,
  type ClassicData, type ClassicSpace
} from "./classicStore";
import { buildScheduleDoc } from "./scheduleDoc";
import type { Rules } from "./rules";

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

export const SCHEDULES_EXPORT_HEADERS = [
  "Schedule #", "Schedule Name", "Shift", "Shift Start", "Shift End", "Worker",
  "Stop #", "Start Time", "Room Number", "Room Name", "Building", "Floor",
  "Department", "Room Type", "Square Feet", "Priority (1-3)",
  "Tasks This Visit", "Est. Minutes"
] as const;

export function schedulesExportRows(data: ClassicData, rules: Rules): Cell[][] {
  const rows: Cell[][] = [[...SCHEDULES_EXPORT_HEADERS]];
  const spaces = data.v7.spaces ?? [];
  const byId = new Map(spaces.map((sp) => [sp.id, sp]));
  for (const sched of data.v7.schedules ?? []) {
    const doc = buildScheduleDoc(data, rules, sched);
    const head: Cell[] = [
      txt(doc.num), txt(doc.name), txt(doc.shift), txt(doc.shiftStart),
      txt(doc.shiftEnd), txt(sched.employee)
    ];
    for (const r of doc.rows) {
      const sp = byId.get(r.spaceId);
      rows.push([
        ...head, r.order, r.startTime, txt(r.roomNumber), txt(r.roomName),
        txt(sp?.building), txt(sp?.floor), txt(sp?.department), txt(r.roomType),
        Number(sp?.squareFeet) || "", PRIORITY_NUM[r.priority],
        r.tasks.join(" + "), r.minutes
      ]);
    }
    // schedule-level tasks (discharges, project work) — no room, still work
    for (const t of doc.nonSpace) {
      rows.push([...head, "", "", "", "", "", "", "", "", "", "", txt(t.name), t.minutes]);
    }
  }
  return rows;
}
