import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { reloadWhenSaved } from "./reloadWhenSaved";
import {
  loadClassic, saveClassic, syncSpaceMinutes, refreshAutoTasks, coverageForSpace, uncovered, setCoverage,
  coverageMinutes, scheduleMinutes, createSchedule, deleteSchedule, scheduleColor, SCHED_COLORS,
  spaceIncomplete, FLOOR_TYPES, rectifyForDisplay, pathFrom, centroidOf, boundsOf, pointIn,
  moveInSchedule, spacePriority, PRIORITIES, PRIORITY_WORD, nonSpaceTaskMinutes, stripIncludedTasks, renameRoomTypes,
  type ClassicData, type ClassicSpace, type ClassicSchedule, type NonSpaceTask
} from "./classicStore";
import {
  deptColorMap, colorForDept, assignDepartment, departmentsOf, departmentOutlineRuns, DEPT_PALETTE
} from "./departments";
import { navVisit, navBack, hubHashFor } from "./nav";
import {
  MapCanvas, BuildingPicker, BuildingBadge, planBuilding, planBuildings,
  loadMapBuilding, saveMapBuilding
} from "./MapCanvas";
import { buildingArtMap } from "./buildingArt";
import {
  SpaceExplorerView, RoomListView, RoomEditor, notesForSpace, type SpacesView
} from "./SpacesApp";
import { mergeRooms, type MergeStores } from "./mergeRooms";
import { IntakeSetup, IntakeProfileCard } from "./IntakeSetup";
import { loadRoutes, saveRoutes, type RouteStore } from "./routes";
import { loadFloorCare, saveFloorCare, type FcStore } from "./floorcare";
import { loadStudioSets, saveStudioSet, type StudioSet } from "./studioSets";
import { ExportApp } from "./ExportApp";
import { CalibrationEditorHome } from "./PlanStudio";
import { sectionDirty, saveSection, roomTypeDirty, saveRoomType, type ScopeSection } from "./scopeDraft";
import { downloadClientSchedule, type ClientExportInput } from "./clientSchedule";
import { downloadTemplateExport } from "./templateExport";
import { loadTemplates, b64ToBytes, type ClientTemplate } from "./templateStore";
import { fetchAccountRole, canEditFormula, type AccountRole } from "./accountRole";
import { cloudConfigured } from "./cloudConfig";
import { PrintSchedule } from "./PrintSchedule";
import { AiPlanImport } from "./AiPlanImport";
import { RoverMode } from "./RoverMode";
import { WorkloadApp, ImportResult } from "./WorkloadApp";
import { FloorCareApp, HoursBar } from "./FloorCareApp";
import { SanitationApp } from "./SanitationApp";
import { PolicingApp } from "./PolicingApp";
import { buildScheduleDoc, parseClock, scheduleCapacity, type SchedBreak } from "./scheduleDoc";
import { importScan } from "../bridge/fusionEntry";
import {
  attachPlanToRooms, resolvePendingRoomTypes, loadAliases,
  importRoomListIntoStorage, type ImportSummary
} from "./roomListImport";
import { fileToSheets, isSpreadsheet } from "./sheetFile";
import { collectWorkspace, applyWorkspace, backupFilename } from "./workspaceStore";
import {
  loadRules, saveRules, defaultRules, requiredTasks, autoTasksFor, autoTasksForSpace, tasksAfterFloorChange,
  taskSourceLabel, FLOOR_KINDS, typeIdFromLabel, isCarpet, spaceCleanability, splitRequiredTasks, isFloorCareTask,
  nonSpaceOccurrenceMinutes, FREQUENCIES, ISSA_CATEGORIES, DEFAULT_INCLUDED_TASKS, RATE_UNITS, computeMinutes,
  gcFormula, gcMinutes, rateFromUnit, rateInUnit, includedTasksFor, includedConflicts, rawSpaceTasks,
  issaSourceLabel, categoryFor, resetToIssa, typeIdFromLabelStrict, RULES_KEY, exampleProcedure,
  type Rules, type RoomTypeRule, type GcMethod, type GcFormula, type RateUnit,
  type DutyPosition, type ProcedureStep
} from "./rules";

const WALL_STROKE = 13;
const GRAY = "#517299"; // unscheduled: holo slate-blue, not dead gray
const RED = "#dc2626";

function uid(p: string) { return p + "-" + Math.random().toString(36).slice(2, 9); }

type Tab = "map" | "rooms" | "schedules" | "spaces" | "scope" | "workload" | "floorcare" | "exporting" | "sanitation" | "policing";

/**
 * The hash is the hub's single source of truth for WHICH view is on screen:
 *   (none)          Max Schedules — Map
 *   #tab-rooms      Max Schedules — Rooms (list scheduling)
 *   #tab-schedules  Max Schedules — Schedules
 *   #spaces?view=explorer|list|map (&add=1)   Max Space
 *   #scope / #workload / #floorcare           the standalone admin pages
 * Keeping it in the hash (and re-reading it reactively) is what makes the
 * universal back button able to return to an EXACT view.
 */
function parseHash(h: string): { tab: Tab; spacesView: SpacesView; autoAdd: boolean; planCal?: boolean; planRead?: boolean; planCad?: boolean } {
  if (h === "#scope") return { tab: "scope", spacesView: "explorer", autoAdd: false };
  if (h === "#workload") return { tab: "workload", spacesView: "explorer", autoAdd: false };
  if (h === "#exporting") return { tab: "exporting", spacesView: "explorer", autoAdd: false };
  if (h.indexOf("#floorcare") === 0) return { tab: "floorcare", spacesView: "explorer", autoAdd: false };
  if (h.indexOf("#sanitation") === 0) return { tab: "sanitation", spacesView: "explorer", autoAdd: false };
  if (h.indexOf("#policing") === 0) return { tab: "policing", spacesView: "explorer", autoAdd: false };
  if (h.indexOf("#spaces") === 0) {
    const m = /view=(explorer|list|map|studio)/.exec(h);
    return {
      tab: "spaces", spacesView: (m?.[1] as SpacesView) ?? "explorer",
      autoAdd: /[?&]add=1/.test(h),
      planCal: /[?&]plancal=1/.test(h), planRead: /[?&]plan=1/.test(h), planCad: /[?&]plan=cad/.test(h)
    };
  }
  if (h === "#tab-schedules") return { tab: "schedules", spacesView: "explorer", autoAdd: false };
  if (h === "#tab-rooms") return { tab: "rooms", spacesView: "explorer", autoAdd: false };
  return { tab: "map", spacesView: "explorer", autoAdd: false };
}

export function MapsApp() {
  const [data, setData] = useState<ClassicData>(() => loadClassic());
  const [rules, setRules] = useState<Rules>(() => loadRules());
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const { tab, spacesView, autoAdd, planCal, planRead, planCad } = parseHash(hash);

  // every view registers itself on the shared back-trail
  const navToken = tab === "spaces" ? "hub:spaces/" + spacesView : "hub:" + tab;
  useEffect(() => { navVisit(navToken); }, [navToken]);

  /** navigate the hub (or leave for classic) by nav token */
  const go = useCallback((token: string) => {
    if (token.indexOf("classic") === 0) {
      const page = token.split(":")[1];
      if (page) sessionStorage.setItem("fusion-goto-page", page);
      window.location.href = "./classic.html";
      return;
    }
    window.location.hash = hubHashFor(token);
  }, []);

  const goBack = useCallback(() => {
    const t = navBack();
    if (!t || t.indexOf("classic") === 0) {
      const page = t ? t.split(":")[1] : "";
      if (page) sessionStorage.setItem("fusion-goto-page", page);
      window.location.href = "./classic.html";
      return;
    }
    window.location.hash = hubHashFor(t);
  }, []);

  // room editor modal (add + edit) — Max Space's one editing surface
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTarget, setEditorTarget] = useState<ClassicSpace | null>(null);
  useEffect(() => {
    if (autoAdd) {
      setEditorTarget(null);
      setEditorOpen(true);
      // one-shot: strip add=1 so back/refresh doesn't reopen it
      history.replaceState(null, "", window.location.pathname + "#spaces?view=" + spacesView);
    }
  }, [autoAdd]); // eslint-disable-line react-hooks/exhaustive-deps
  const openEditor = useCallback((sp: ClassicSpace | null) => {
    setEditorTarget(sp);
    setEditorOpen(true);
  }, []);

  const [roomSel, setRoomSel] = useState<string | null>(null);
  const [schedSel, setSchedSel] = useState<string | null>(null);
  // department tooling (Josh, 2026-09-25): select rooms in Max Space, assign
  // a department + color; outline by department on the Schedules map
  const [deptMode, setDeptMode] = useState(false);
  const [deptPick, setDeptPick] = useState<Set<string>>(new Set());
  const [deptDraft, setDeptDraft] = useState({ name: "", color: "" });
  const [deptOutline, setDeptOutline] = useState(false);
  // merge (Josh, 2026-10-22): ⧉ Merge in Max Space's Map View — tap the room that stays, then
  // the room right next to it, and they are one room in all the data (mergeRooms.ts). Undo is
  // there right after, until anything else changes.
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeFirst, setMergeFirst] = useState<string | null>(null);
  const [mergeNote, setMergeNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [mergeUndo, setMergeUndo] = useState<{
    after: ClassicData; data: ClassicData; plans: boolean;
    routes: RouteStore | null; floorCare: FcStore | null; sets: StudioSet[];
  } | null>(null);
  useEffect(() => {
    setMergeMode(false); setMergeFirst(null); setMergeNote(null); setMergeUndo(null);
  }, [navToken]);
  // the first brick of the role system: local build = the owner; cloud =
  // the signed-in profile's role (directors administer, others don't)
  const [role, setRole] = useState<AccountRole>(() => (cloudConfigured ? "staff" : "owner"));
  useEffect(() => { void fetchAccountRole().then(setRole); }, []);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [report, setReport] = useState(false);
  const [planId, setPlanId] = useState<string | null>(null);
  const [printId, setPrintId] = useState<string | null>(null);
  // Rover Mode (Josh's final launch feature): full-screen voice validation
  const [roverOn, setRoverOn] = useState(false);

  const plans = data.plans;
  // building first (Josh, 2026-08-31): with plans in several buildings, the
  // map won't show a floor until the building is chosen — and the choice is
  // remembered across pages so every map opens where the manager works
  const buildings = useMemo(() => planBuildings(plans), [plans]);
  const [mapBuilding, setMapBuilding] = useState<string | null>(() => loadMapBuilding());
  const chooseBuilding = useCallback((b: string | null) => {
    setMapBuilding(b);
    saveMapBuilding(b);
    setPlanId(null);
    setRoomSel(null);
  }, []);
  const activeBuilding = buildings.length <= 1
    ? (buildings[0] ?? "")
    : (mapBuilding !== null && buildings.includes(mapBuilding) ? mapBuilding : null);
  const needsBuilding = buildings.length > 1 && activeBuilding === null;
  const buildingPlans = activeBuilding === null ? [] : plans.filter((p) => planBuilding(p) === activeBuilding);
  const plan = buildingPlans.find((p) => p.id === planId) ?? buildingPlans[0] ?? null;
  // a merge pairs two rooms on ONE floor — another floor starts over
  useEffect(() => { setMergeFirst(null); }, [plan?.id]);
  const spaces = useMemo(
    () => (data.v7.spaces ?? []).filter((s) => !plan || s.visualPlanId === plan.id || !s.visualPlanId),
    [data.v7.spaces, plan]
  );
  const schedules = (data.v7.schedules ?? []).filter((s) => !s.projectNoteId);
  const employees = data.v7.employees ?? [];

  const commit = useCallback((mut: (d: ClassicData) => void) => {
    setData((prev) => {
      const next: ClassicData = JSON.parse(JSON.stringify(prev));
      mut(next);
      saveClassic(next);
      return next;
    });
  }, []);

  const commitRules = useCallback((next: Rules) => {
    const prev = loadRules(); // the rulebook as it stood before this change
    setRules(next);
    saveRules(next);
    commit((d) => {
      // Scope determines everything, after the fact too: re-test rooms still
      // in Needs Review, move rulebook-following rooms to the new automatic
      // task lists (hand-customized rooms keep their custom lists), and
      // recalculate every room's minutes under the new rules. A renamed room
      // type takes its rooms with it (rooms store the type's label).
      renameRoomTypes(d.v7.spaces ?? [], prev, next);
      resolvePendingRoomTypes((d.v7.spaces ?? []) as never, next, loadAliases());
      refreshAutoTasks(d.v7.spaces ?? [], prev, next);
      for (const sp of d.v7.spaces ?? []) syncSpaceMinutes(sp, next);
    });
  }, [commit]);

  // ⧉ Merge: `otherId` becomes part of `keepId` everywhere — rooms, schedules, routes, Floor Care,
  // the floor map and the Calibration Editor's drawing — or nothing changes and the note says why
  const roomName = (sp: ClassicSpace) =>
    String(sp.roomNumber ?? "").trim() || String(sp.roomName ?? "").trim() || "the room";
  const mergeInto = (keepId: string, otherId: string) => {
    const routesBefore = loadRoutes(), floorCareBefore = loadFloorCare(), setsBefore = loadStudioSets();
    const work: MergeStores = {
      data: JSON.parse(JSON.stringify(data)),
      routes: loadRoutes(), floorCare: loadFloorCare(), sets: loadStudioSets()
    };
    const res = mergeRooms(work, keepId, [otherId], rules);
    if (!res.ok) { setMergeNote({ ok: false, text: res.reason }); return; }
    try {
      saveClassic(work.data);
      if (res.plansChanged) localStorage.setItem("opsmatrix_v7_plans", JSON.stringify(work.data.plans));
      if (res.routesChanged) saveRoutes(work.routes);
      if (res.floorCareChanged) saveFloorCare(work.floorCare);
    } catch {
      // the device refused the save: put back what was there, so nothing is half-merged
      try {
        saveClassic(data);
        if (res.plansChanged) localStorage.setItem("opsmatrix_v7_plans", JSON.stringify(data.plans));
        if (res.routesChanged) saveRoutes(routesBefore);
        if (res.floorCareChanged) saveFloorCare(floorCareBefore);
      } catch { /* nothing more to do */ }
      setMergeNote({ ok: false, text: "This device couldn't save the merge (it's out of storage space), so nothing changed." });
      return;
    }
    // the Calibration Editor's saved drawings are extras a full device may skip, as everywhere else
    for (const s of res.setsChanged) saveStudioSet(s);
    setData(work.data);
    setMergeUndo({
      after: work.data, data, plans: res.plansChanged,
      routes: res.routesChanged ? routesBefore : null,
      floorCare: res.floorCareChanged ? floorCareBefore : null,
      sets: setsBefore.filter((s) => res.setsChanged.some((c) => c.id === s.id))
    });
    setMergeFirst(null);
    setMergeNote({
      ok: true,
      text: `${res.merged.map(roomName).join(", ")} merged into ${roomName(res.keep)} — one room now, ` +
        `${Math.round(Number(res.keep.squareFeet) || 0).toLocaleString()} sq ft`
    });
  };
  const undoMerge = () => {
    const u = mergeUndo;
    if (!u || u.after !== data) return;
    try {
      saveClassic(u.data);
      if (u.plans) localStorage.setItem("opsmatrix_v7_plans", JSON.stringify(u.data.plans));
      if (u.routes) saveRoutes(u.routes);
      if (u.floorCare) saveFloorCare(u.floorCare);
    } catch {
      setMergeNote({ ok: false, text: "This device couldn't save the undo (it's out of storage space)." });
      return;
    }
    for (const s of u.sets) saveStudioSet(s);
    setData(u.data);
    setMergeUndo(null);
    setMergeNote({ ok: true, text: "Merge undone — both rooms are back as they were." });
  };

  // Scope's flag "rooms still list a task General Clean includes" → take it off
  const cleanIncluded = useCallback(() => {
    commit((d) => { stripIncludedTasks(d, rules); });
  }, [commit, rules]);

  // the 2026-10-12 General Clean model re-times every room once: rules saved
  // before it are migrated on load (persist that), and any room whose stored
  // minutes or task list (old issa-* helper ids) disagree is brought in line
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(RULES_KEY) ?? "null");
      if (stored && !(Number(stored.version) >= 2)) saveRules(rules);
    } catch { /* unreadable — loadRules already fell back to defaults */ }
    const stale = (sp: ClassicSpace) => sp.estimatedCleaningMinutes !== computeMinutes(rules, sp).total;
    if (!(data.v7.spaces ?? []).some(stale)) return;
    commit((d) => {
      for (const sp of d.v7.spaces ?? []) if (stale(sp)) syncSpaceMinutes(sp, rules);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // fresh page load: rooms left unclassified by an earlier import get another
  // chance against whatever Scope holds NOW (types added since, new aliases)
  useEffect(() => {
    const spacesAll = (data.v7.spaces ?? []);
    if (!spacesAll.some((sp) => !String(sp.roomType ?? "").trim())) return;
    commit((d) => {
      const n = resolvePendingRoomTypes((d.v7.spaces ?? []) as never, rules, loadAliases());
      if (n) for (const sp of d.v7.spaces ?? []) syncSpaceMinutes(sp, rules);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // first-run: guarantee spaceTasks + minutes; ensure existing assignments read as primary coverage
  useEffect(() => {
    const spacesAll = data.v7.spaces ?? [];
    const needs = spacesAll.some((sp) => !Array.isArray(sp.spaceTasks)) ||
      spacesAll.some((sp) => sp.assignedScheduleId && coverageForSpace(data, sp.id).length === 0);
    if (!needs) return;
    commit((d) => {
      for (const sp of d.v7.spaces ?? []) {
        if (!Array.isArray(sp.spaceTasks)) {
          sp.spaceTasks = sp.fusionTasks ?? autoTasksForSpace(rules, sp);
        }
        syncSpaceMinutes(sp, rules);
        if (sp.assignedScheduleId && coverageForSpace(d, sp.id).length === 0) {
          setCoverage(d, sp.id, sp.assignedScheduleId, true, sp.spaceTasks ?? []);
        }
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shapes = useMemo(() => {
    const out = new Map<string, { pts: { x: number; y: number }[]; path: string; c: { x: number; y: number } }>();
    for (const sp of spaces) {
      if (!sp.visualPts || sp.visualPts.length < 3) continue;
      const pts = rectifyForDisplay(sp.visualPts);
      out.set(sp.id, { pts, path: pathFrom(pts), c: centroidOf(pts) });
    }
    return out;
  }, [spaces]);

  // department borders: real geometry (grid union + contour trace), so it
  // runs only when the data or the toggles change — never per render
  const deptBorders = useMemo(() => {
    const on = (tab === "map" && deptOutline) || (tab === "spaces" && deptMode);
    if (!on || !plan) return undefined;
    return departmentOutlineRuns(
      spaces.map((sp) => ({ dept: String(sp.department ?? ""), pts: shapes.get(sp.id)?.pts ?? [] })),
      plan.w, plan.h, deptColorMap(data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, deptOutline, deptMode, plan, shapes, spaces, data]);

  const roomSelected = spaces.find((s) => s.id === roomSel) ?? null;
  const schedSelected = schedules.find((s) => s.id === schedSel) ?? null;

  const matches = useCallback((sp: ClassicSpace): boolean => {
    if (filters.rtype && typeIdFromLabel(rules, sp.roomType ?? "") !== filters.rtype) return false;
    if (filters.task && !requiredTasks(rules, sp).includes(filters.task)) return false;
    if (filters.floor && sp.floor !== filters.floor) return false;
    const cov = coverageForSpace(data, sp.id);
    if (filters.schedule && !cov.some((c) => c.scheduleId === filters.schedule)) return false;
    if (filters.shift) {
      if (!cov.some((c) => schedules.find((s) => s.id === c.scheduleId)?.shift === filters.shift)) return false;
    }
    if (filters.coverage === "unscheduled" && !uncovered(data, rules, sp).baseUncovered) return false;
    if (filters.coverage === "untasked") {
      const u = uncovered(data, rules, sp);
      if (!u.baseUncovered && u.tasks.length === 0) return false;
    }
    if (filters.coverage === "complete") {
      const u = uncovered(data, rules, sp);
      if (u.baseUncovered || u.tasks.length > 0) return false;
    }
    return true;
  }, [filters, rules, data, schedules]);

  const anyFilter = Object.values(filters).some(Boolean);

  const onMapView = tab === "map" || (tab === "spaces" && spacesView === "map");

  return (
    <div className="pro-shell withnav">
      {/* the always-there left menu (Josh, 2026-08-31): every Max page one
          click away, on every screen — classic's sidebar, mirrored here */}
      <SideNav tab={tab} go={go} />
      <div className="pro-shellmain">
      <header className="pro-head">
        {/* THE back button: same blue bubble on every screen, true history —
            it returns to the exact page the user came from (nav.ts) */}
        <button className="pbtn primary backbtn" onClick={goBack}>‹ Back</button>
        {tab === "scope" ? (
          <h1>Admin Settings — <span>Scope</span></h1>
        ) : tab === "exporting" ? (
          <h1>Admin Settings — <span>Exporting</span></h1>
        ) : tab === "workload" ? (
          <h1>Workload <span>Intelligence</span></h1>
        ) : tab === "floorcare" ? (
          <h1>Max Floor <span>Care</span></h1>
        ) : tab === "sanitation" ? (
          <h1>Max <span>Sanitation</span></h1>
        ) : tab === "policing" ? (
          <h1>Max <span>Policing</span></h1>
        ) : tab === "spaces" ? (
          <>
            <h1>Max <span>Space</span></h1>
            <nav className="ptabs">
              <button className={spacesView === "explorer" ? "on" : ""} onClick={() => go("hub:spaces/explorer")}>Explorer</button>
              <button className={spacesView === "list" ? "on" : ""} onClick={() => go("hub:spaces/list")}>Room List</button>
              <button className={spacesView === "map" ? "on" : ""} onClick={() => go("hub:spaces/map")}>Map View</button>
              <button className={spacesView === "studio" ? "on" : ""} onClick={() => go("hub:spaces/studio")}>Calibration Editor</button>
              <a className="ptab-link" href="./classic.html?fp=1">Floor Plans</a>
            </nav>
          </>
        ) : (
          <>
            <h1>Max <span>Schedules</span></h1>
            <nav className="ptabs">
              {(["map", "rooms", "schedules"] as Tab[]).map((t) => (
                <button key={t} className={tab === t ? "on" : ""} onClick={() => go("hub:" + t)}>
                  {t === "map" ? "Map" : t === "rooms" ? "Rooms" : "Schedules"}
                </button>
              ))}
            </nav>
          </>
        )}
        <span className="grow" />
        {/* Max Space's ONLY two entry points for data: ⬆ Import and ＋ Add Room */}
        {tab === "spaces" && <>
          {spacesView === "map" && plan && (
            <button className="pbtn rover-toggle" onClick={() => setRoverOn(true)}>🚙 Rover Mode</button>
          )}
          <UploadHub key={planCal ? "plancal" : planCad ? "plancad" : planRead ? "planread" : "plain"} commit={commit} rules={rules}
            autoPlan={planCal ? "calibrate" : planCad ? "cad" : planRead ? "choice" : undefined} />
          <button className="pbtn primary" onClick={() => openEditor(null)}>＋ Add Room</button>
        </>}
        {(tab === "map" || tab === "rooms" || tab === "schedules") && (
          <button className="pbtn" onClick={() => setReport(true)}>⚠ Unassigned Tasks</button>
        )}
      </header>

      {onMapView && !needsBuilding && (
        <div className="pro-filters">
          {buildings.length > 1 && (
            <label className="psel"><span>Building</span>
              <select value={activeBuilding ?? ""} onChange={(e) => chooseBuilding(e.target.value)}>
                {buildings.map((b) => <option key={b || "~none"} value={b}>{b || "No building set"}</option>)}
              </select>
            </label>
          )}
          {tab === "map" && <>
            <Sel label="Schedule" v={filters.schedule ?? ""} on={(v) => setFilters({ ...filters, schedule: v })}
              opts={schedules.map((s) => [s.id, `${s.num ?? ""} ${s.name ?? ""}`.trim()])} />
            <Sel label="Coverage" v={filters.coverage ?? ""} on={(v) => setFilters({ ...filters, coverage: v })}
              opts={[["unscheduled", "Unscheduled rooms"], ["untasked", "Has unscheduled tasks"], ["complete", "Fully scheduled"]]} />
            <Sel label="Shift" v={filters.shift ?? ""} on={(v) => setFilters({ ...filters, shift: v })}
              opts={["1st Shift", "2nd Shift", "3rd Shift"].map((s) => [s, s])} />
            <button className={"pbtn small" + (deptOutline ? " primary" : "")}
              onClick={() => setDeptOutline(!deptOutline)}>🏛 Dept outlines</button>
          </>}
          {tab === "spaces" && spacesView === "map" && (
            <button className={"pbtn small" + (deptMode ? " primary" : "")}
              onClick={() => {
                setDeptMode(!deptMode); setDeptPick(new Set()); setRoomSel(null);
                setMergeMode(false); setMergeFirst(null); setMergeNote(null); setMergeUndo(null);
              }}>
              🏷 Departments
            </button>
          )}
          {tab === "spaces" && spacesView === "map" && (
            <button className={"pbtn small" + (mergeMode ? " primary" : "")}
              title="Tap the room that stays, then the room right next to it — they become one room everywhere"
              onClick={() => {
                setMergeMode(!mergeMode); setMergeFirst(null); setMergeNote(null); setMergeUndo(null);
                setDeptMode(false); setDeptPick(new Set()); setRoomSel(null);
              }}>
              ⧉ Merge
            </button>
          )}
          <Sel label="Room type" v={filters.rtype ?? ""} on={(v) => setFilters({ ...filters, rtype: v })}
            opts={rules.roomTypes.map((rt) => [rt.id, rt.label])} />
          <Sel label="Task" v={filters.task ?? ""} on={(v) => setFilters({ ...filters, task: v })}
            opts={rules.tasks
              .filter((t) => tab !== "map" || !t.floorCare) // floor-care work is Max Floor Care's
              .map((t) => [t.id, t.label])} />
          {anyFilter && <button className="pbtn small" onClick={() => setFilters({})}>Clear</button>}
          {tab === "map" && schedSelected && (() => {
            // the SAME totaler and bar the Schedules tab uses — one truth,
            // live while tapping (Josh, 2026-09-25). Minutes can also DROP:
            // tapping a room already on this schedule removes it, and taking
            // a room's base clean makes the schedule that had it shrink.
            const liveMins = Math.round(scheduleMinutes(data, rules, schedSelected));
            // room work fits in the paid shift less its paid breaks
            const liveCap = scheduleCapacity(data, rules, schedSelected);
            const liveTarget = liveCap.workMinutes;
            return (
              <span className="linkhint schedlive">
                ✏ Editing <b style={{ color: String(schedSelected.color) }}>{schedSelected.num} {schedSelected.name}</b> —
                click rooms to add/remove
                <em className={"schedlivemins" + (liveMins > liveTarget ? " over" : "")}>{liveMins}m of {liveTarget}m</em>
                <HoursBar minutes={liveMins + liveCap.paidBreakMinutes} />
                <button className="pbtn small primary" onClick={() => setSchedSel(null)}>Done</button>
              </span>
            );
          })()}
          {tab === "spaces" && spacesView === "map" && deptMode && (
            <span className="linkhint schedlive">
              🏷 Tap rooms to select — <b>{deptPick.size}</b> picked
              <input list="dept-assign" placeholder="department name" value={deptDraft.name}
                style={{ minWidth: 150 }}
                onChange={(e) => setDeptDraft({ ...deptDraft, name: e.target.value })} />
              <datalist id="dept-assign">
                {departmentsOf(spaces).map((d) => <option key={d} value={d} />)}
              </datalist>
              {DEPT_PALETTE.map((c) => (
                <button key={c} className={"colordot" + (deptDraft.color === c ? " on" : "")}
                  style={{ background: c }} aria-label={"Department color " + c}
                  onClick={() => setDeptDraft({ ...deptDraft, color: deptDraft.color === c ? "" : c })} />
              ))}
              <button className="pbtn small primary" disabled={!deptPick.size || !deptDraft.name.trim()}
                onClick={() => {
                  commit((d) => {
                    assignDepartment(d, deptPick, deptDraft.name, deptDraft.color || undefined);
                  });
                  setDeptPick(new Set()); // stay in the mode for the next wing
                }}>
                ✓ Assign{deptPick.size ? ` ${deptPick.size} room${deptPick.size === 1 ? "" : "s"}` : ""}
              </button>
              <button className="pbtn small" onClick={() => { setDeptMode(false); setDeptPick(new Set()); }}>Done</button>
            </span>
          )}
          {tab === "spaces" && spacesView === "map" && mergeMode && (() => {
            const first = mergeFirst ? (data.v7.spaces ?? []).find((s) => s.id === mergeFirst) ?? null : null;
            return (
              <span className="linkhint schedlive mergebar">
                {mergeNote && (
                  <em className={mergeNote.ok ? "mergeok" : "mergewarn"}>{mergeNote.ok ? "✓ " : "⚠ "}{mergeNote.text}</em>
                )}
                {first
                  ? <span>⧉ <b>{roomName(first)}</b> stays — now tap the room right next to it</span>
                  : <span>⧉ Tap the room that stays, then the room right next to it</span>}
                {mergeUndo && mergeUndo.after === data && (
                  <button className="pbtn small" onClick={undoMerge}>↶ Undo</button>
                )}
                {first && (
                  <button className="pbtn small" onClick={() => { setMergeFirst(null); setMergeNote(null); }}>✕ Start over</button>
                )}
                <button className="pbtn small primary" onClick={() => {
                  setMergeMode(false); setMergeFirst(null); setMergeNote(null); setMergeUndo(null);
                }}>Done</button>
              </span>
            );
          })()}
        </div>
      )}

      <div className="pro-main">
        {onMapView && needsBuilding && (
          <BuildingPicker art={buildingArtMap(data)} plans={plans} spaces={data.v7.spaces ?? []} onPick={chooseBuilding} />
        )}
        {onMapView && plan && (
          <MapCanvas
            key={tab + spacesView + (plan?.id ?? "")}
            plan={plan} plans={buildingPlans} onPlan={setPlanId}
            badge={<BuildingBadge building={activeBuilding ?? ""}
              onChange={buildings.length > 1 ? () => chooseBuilding(null) : undefined} />}
            spaces={spaces} shapes={shapes}
            mode={tab === "spaces" ? "spaces" : "map"}
            fillFor={(sp) => {
              if (tab === "spaces") {
                if (deptMode) {
                  // the department view: rooms wear their department's color,
                  // unassigned rooms recede
                  return colorForDept(sp.department, deptColorMap(data)) ?? "#33404d";
                }
                return spaceIncomplete(sp).length ? RED : "#475569";
              }
              const active = !anyFilter || matches(sp);
              if (!active) return "#33404d";
              if (schedSelected) {
                const cov = coverageForSpace(data, sp.id).find((c) => c.scheduleId === schedSelected.id);
                return cov ? String(schedSelected.color) : "#33404d";
              }
              const primary = coverageForSpace(data, sp.id).find((c) => c.primary);
              return scheduleColor(schedules, primary?.scheduleId);
            }}
            overlayFor={tab === "map" ? (sp) => {
              const cov = coverageForSpace(data, sp.id);
              if (cov.length < 2) return null;
              const secondary = cov.find((c) => !c.primary) ?? cov[1];
              const col = scheduleColor(schedules, secondary.scheduleId);
              return col === "#64748b" ? null : col;
            } : deptMode ? (sp) => (deptPick.has(sp.id) ? "#ffffff" : null)
              : mergeMode ? (sp) => (sp.id === mergeFirst ? "#ffffff" : null) : undefined}
            outlines={deptBorders}
            flagFor={tab === "map" ? (sp) => {
              // ⚠ = this room isn't fully scheduled yet: its base clean or
              // one of its tasks (floor care counts — shipped Floor Care
              // schedules clear it) still has nobody assigned
              const u = uncovered(data, rules, sp);
              return u.baseUncovered || u.tasks.length > 0 ? "⚠" : null;
            } : undefined}
            selectedId={roomSel}
            onRoom={(sp) => {
              // department assign mode: taps SELECT rooms, nothing else
              if (tab === "spaces" && deptMode) {
                if (!sp) return;
                setDeptPick((prev) => {
                  const next = new Set(prev);
                  if (next.has(sp.id)) next.delete(sp.id);
                  else next.add(sp.id);
                  return next;
                });
                return;
              }
              // merge mode: the first tap picks the room that stays, the second merges its
              // neighbour into it (or says why it can't, keeping the first room picked)
              if (tab === "spaces" && mergeMode) {
                if (!sp) return;
                if (!mergeFirst) { setMergeFirst(sp.id); setMergeNote(null); return; }
                if (sp.id === mergeFirst) { setMergeFirst(null); return; }
                mergeInto(mergeFirst, sp.id);
                return;
              }
              if (!sp) { setRoomSel(null); return; }
              if (tab === "map" && schedSelected && (schedSelected.floorCareId || schedSelected.routeOnly)) {
                // engine-built schedules are edited in their engine only
                const home = schedSelected.floorCareId ? "Max Floor Care"
                  : schedSelected.sanitationId ? "Max Sanitation" : "Max Policing";
                alert("This schedule was built in " + home + " — edit it there. (Schedules tab → Edit in " + home + ")");
                return;
              }
              if (tab === "map" && schedSelected) {
                // one-click membership editing on the selected schedule —
                // on desktop the sidebar opens too, so tasks are right there;
                // on a phone the sheet would cover the map after every tap,
                // so rapid assigning stays sheet-free (the room recolors as
                // feedback) and a plain tap outside edit mode opens the sheet
                commit((d) => {
                  const cov = coverageForSpace(d, sp.id).find((c) => c.scheduleId === schedSelected.id);
                  if (cov) {
                    setCoverage(d, sp.id, schedSelected.id, false, []);
                  } else {
                    // one click = this schedule takes the room's base clean
                    // (any other schedule keeps only its extra tasks, e.g.
                    // high dusting) — floor-care tasks never ride along, they
                    // are Max Floor Care's alone
                    const u = uncovered(d, rules, d.v7.spaces!.find((s) => s.id === sp.id)!);
                    setCoverage(d, sp.id, schedSelected.id, true,
                      u.tasks.filter((t) => !isFloorCareTask(rules, t)));
                  }
                });
                if (!window.matchMedia("(max-width: 640px)").matches) setRoomSel(sp.id);
                return;
              }
              setRoomSel(sp ? sp.id : null);
            }}
            legend={tab === "map" ? (
              <div className="pro-legend">
                {schedules.map((s) => (
                  <span key={s.id} className={"lgrow" + (schedSel === s.id ? " on" : "")}
                    onClick={() => setSchedSel(schedSel === s.id ? null : s.id)}>
                    <i style={{ background: String(s.color) || GRAY }} />
                    {s.num} {s.name}
                    <em>{Math.round(scheduleMinutes(data, rules, s))}m</em>
                  </span>
                ))}
                <span className="lgrow"><i style={{ background: GRAY }} />Unscheduled</span>
                {deptOutline && departmentsOf(spaces).map((dp) => (
                  <span key={"dept-" + dp}>
                    <i style={{ background: "transparent", border: `2.5px solid ${colorForDept(dp, deptColorMap(data))}` }} />
                    {dp}
                  </span>
                ))}
              </div>
            ) : deptMode ? (
              <div className="pro-legend">
                {departmentsOf(spaces).map((dp) => (
                  <span key={dp}><i style={{ background: colorForDept(dp, deptColorMap(data)) ?? "#33404d" }} />{dp}</span>
                ))}
                <span><i style={{ background: "#33404d" }} />No department yet</span>
              </div>
            ) : (
              <div className="pro-legend">
                <span><i style={{ background: "#475569" }} />Room data complete</span>
                <span><i style={{ background: RED }} />Needs attention</span>
              </div>
            )}
          />
        )}

        {onMapView && !needsBuilding && !plan && (
          <div className="pro-empty">
            <h2>No floor plan has been added{spaces.length ? " for these rooms" : " yet"}</h2>
            {spaces.length > 0 ? (
              <p>
                Your {spaces.length} imported room{spaces.length === 1 ? "" : "s"} are already
                working — in the Explorer, the Room List, on schedules, and in Workload
                Intelligence. A floor plan is optional: add one any time (a picture, PDF, or
                magicplan scan) and it attaches to these same rooms.
              </p>
            ) : tab === "spaces" ? (
              <p>Use the ⬆ Import button above — a floor plan (picture or PDF), a room list, or a magicplan scan all get you started.</p>
            ) : (
              <p>Go to Max Space and use its ⬆ Import button — a floor plan (picture or PDF), a room list, or a magicplan scan all get you started.</p>
            )}
          </div>
        )}

        {tab === "spaces" && spacesView === "explorer" && (
          <SpaceExplorerView data={data} rules={rules} commit={commit} onEdit={openEditor} />
        )}
        {tab === "spaces" && spacesView === "list" && (
          <RoomListView data={data} rules={rules} commit={commit} onEdit={openEditor} />
        )}
        {tab === "spaces" && spacesView === "studio" && (
          <CalibrationEditorHome rules={rules} />
        )}

        {tab === "map" && roomSelected && (
          <ScheduleRoomSidebar
            key={roomSelected.id}
            space={roomSelected} data={data} rules={rules} schedules={schedules}
            onClose={() => setRoomSel(null)}
            onEditSpace={() => go("hub:spaces/map")}
            commit={commit}
          />
        )}

        {tab === "spaces" && spacesView === "map" && roomSelected && (
          <SpaceSidebar
            key={roomSelected.id}
            space={roomSelected} rules={rules}
            deptOptions={[...new Set(spaces.map((s) => String(s.department ?? "").trim()).filter(Boolean))].sort()}
            onClose={() => setRoomSel(null)}
            onOpenEditor={() => openEditor(roomSelected)}
            onChange={(patch) => commit((d) => {
              const sp = (d.v7.spaces ?? []).find((s) => s.id === roomSelected.id)!;
              // a floor change with no task list swaps the floor's tasks
              // against the room as it was (the sidebar sends its own list)
              const floorTasks = patch.floorType !== undefined && patch.spaceTasks === undefined
                ? tasksAfterFloorChange(rules, sp, String(patch.floorType)) : null;
              Object.assign(sp, patch);
              if (patch.roomType !== undefined && patch.spaceTasks === undefined) {
                sp.spaceTasks = autoTasksForSpace(rules, sp);
              } else if (floorTasks) {
                sp.spaceTasks = floorTasks;
              }
              syncSpaceMinutes(sp, rules);
            })}
          />
        )}

        {tab === "rooms" && (
          <RoomsScheduleTab data={data} rules={rules} schedules={schedules}
            commit={commit} onNewSchedule={() => go("hub:schedules")} />
        )}

        {tab === "schedules" && (
          <SchedulesTab data={data} rules={rules} schedules={schedules} employees={employees}
            commit={commit} onPrint={setPrintId}
            onOpenOnMap={(id) => { setSchedSel(id); go("hub:map"); }} />
        )}

        {tab === "scope" && (
          <ScopeTab rules={rules} onChange={commitRules} onCleanIncluded={cleanIncluded} data={data} isAdmin={canEditFormula(role)} />
        )}

        {tab === "workload" && (
          <WorkloadApp data={data} rules={rules} commit={commit} commitRules={commitRules} />
        )}

        {tab === "exporting" && (
          <ExportApp data={data} rules={rules} commit={commit} />
        )}

        {tab === "floorcare" && (
          <FloorCareApp data={data} rules={rules} commit={commit} />
        )}

        {tab === "sanitation" && (
          <SanitationApp data={data} rules={rules} commit={commit} />
        )}

        {tab === "policing" && (
          <PolicingApp data={data} rules={rules} commit={commit} />
        )}
      </div>
      </div>

      {report && (
        <ReportModal data={data} rules={rules} spaces={spaces} schedules={schedules}
          onClose={() => setReport(false)}
          onJump={(id) => { setReport(false); setRoomSel(id); go("hub:map"); }} />
      )}

      {editorOpen && (
        <RoomEditor data={data} rules={rules}
          space={editorTarget ? (data.v7.spaces ?? []).find((s) => s.id === editorTarget.id) ?? editorTarget : null}
          commit={commit} onClose={() => setEditorOpen(false)} />
      )}

      {printId && (
        <PrintPreview data={data} rules={rules} scheduleId={printId}
          onClose={() => setPrintId(null)} />
      )}

      {roverOn && plan && (
        <RoverMode
          plan={plan} plans={buildingPlans} onPlan={setPlanId}
          spaces={spaces} shapes={shapes} rules={rules} commit={commit}
          building={activeBuilding ?? ""}
          onExit={() => setRoverOn(false)} />
      )}
    </div>
  );
}

// ── print preview: see the schedule exactly as it prints, then print it ─────

function PrintPreview({ data, rules, scheduleId, onClose }: {
  data: ClassicData;
  rules: Rules;
  scheduleId: string;
  onClose: () => void;
}) {
  const sched = (data.v7.schedules ?? []).find((s) => s.id === scheduleId);
  const doc = useMemo(
    () => (sched ? buildScheduleDoc(data, rules, sched) : null),
    [data, rules, sched]
  );

  // the floor plan this schedule's rooms actually live on
  const plan = useMemo(() => {
    if (!doc) return null;
    const spaces = data.v7.spaces ?? [];
    for (const r of doc.rows) {
      const sp = spaces.find((s) => s.id === r.spaceId);
      const hit = data.plans.find((p) => p.id === sp?.visualPlanId);
      if (hit) return hit;
    }
    return data.plans[0] ?? null;
  }, [doc, data]);

  // Escape closes, like every other overlay in the app
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!doc) return null;

  // Rendered straight into <body>, deliberately: printing hides the whole app
  // shell, and anything nested inside it would be hidden along with it.
  return createPortal(
    <div className="printwrap">
      <div className="printbar noprint">
        <button className="pbtn ghost" onClick={onClose}>← Back</button>
        <h2>Schedule #{doc.num} · {doc.name}</h2>
        <span className="hint">
          This is exactly what prints. Two pages: the room list, and your area on the floor plan.
        </span>
        <span className="grow" />
        <button className="pbtn primary" onClick={() => window.print()}>🖨 Print / Save as PDF</button>
      </div>
      <PrintSchedule doc={doc} plan={plan} spaces={data.v7.spaces ?? []} />
    </div>,
    document.body
  );
}

// ── shared bits ──────────────────────────────────────────────────────────────

// ── ⬆ Upload: THE one front door for bringing data in (Josh's rule,
//    2026-08-24 — "the only place to upload anything in OpsMatrix, period").
//    One button, three options: floor plan (always read by Max — there is no
//    manual path), room list, magicplan export. The exact same chooser fronts
//    Classic's Max Space (fusion-ui.js); this is its hub twin. ─────────────
function UploadHub({ commit, rules, autoPlan }: {
  commit: (mut: (d: ClassicData) => void) => void;
  rules: Rules;
  /** open the plan modal on arrival: "choice" (classic's Floor plan tile),
      "calibrate" (classic's no-sizes tile / legacy links) or "cad" (classic's
      CAD drawing tile) */
  autoPlan?: "choice" | "calibrate" | "cad";
}) {
  const [chooser, setChooser] = useState(false);
  const [planOpen, setPlanOpen] = useState(() => Boolean(autoPlan));
  // the plan modal's starting point: the arrival link's, or the tile just picked
  const arrivalMode = autoPlan === "calibrate" ? "calibrate" : autoPlan === "cad" ? "cad" : undefined;
  const [planMode, setPlanMode] = useState<"read" | "calibrate" | "cad" | undefined>(arrivalMode);
  const [rlPhase, setRlPhase] = useState<"idle" | "working" | "done" | "error">("idle");
  const [rlError, setRlError] = useState("");
  const [rlSummary, setRlSummary] = useState<ImportSummary | null>(null);
  const rlRef = useRef<HTMLInputElement>(null);
  const mpRef = useRef<HTMLInputElement>(null);

  const handleRoomList = async (file: File) => {
    setRlPhase("working");
    try {
      if (!isSpreadsheet(file)) throw new Error("Pick an Excel (.xlsx), CSV or raw-data text file of rooms.");
      const sheets = await fileToSheets(file);
      const s = importRoomListIntoStorage(sheets, { fileName: file.name });
      setRlSummary(s);
      setRlPhase("done");
    } catch (e) {
      setRlError(String((e as Error)?.message ?? e));
      setRlPhase("error");
    }
  };

  const handleMagicplan = async (files: File[]) => {
    const dxfF = files.find((f) => f.name.toLowerCase().endsWith(".dxf"));
    const csvF = files.find((f) => f.name.toLowerCase().endsWith(".csv"));
    if (!dxfF || !csvF) { alert("Pick both files from the same export: the .dxf and the .csv"); return; }
    const [dxfT, csvT] = await Promise.all([dxfF.text(), csvF.text()]);
    try {
      const result = importScan(dxfT, csvT, {});
      let outcome = { attached: 0, added: 0 };
      commit((d) => {
        // a scan of rooms already imported from a list ATTACHES to them
        d.v7.spaces = d.v7.spaces ?? [];
        outcome = attachPlanToRooms(d.v7.spaces as never, result as never);
        d.plans.push(result.plan as unknown as ClassicData["plans"][0]);
        localStorage.setItem("opsmatrix_v7_plans", JSON.stringify(d.plans));
        for (const sp of d.v7.spaces ?? []) syncSpaceMinutes(sp, rules);
      });
      alert(`✓ ${result.summary.rooms} rooms imported, ${result.summary.autoDetected} drawn automatically` +
        (outcome.attached ? `, ${outcome.attached} matched to rooms you already had` : ""));
      reloadWhenSaved();
    } catch (err) {
      alert("Could not read that scan: " + err);
    }
  };

  return (
    <>
      <button className="pbtn primary" onClick={() => setChooser(true)}>⬆ Import</button>

      {chooser && createPortal(
        <div className="pro-modalback" onClick={(e) => { if (e.target === e.currentTarget) setChooser(false); }}>
          <div className="pro-modal">
            <div className="pshead"><h2>Upload space data</h2>
              <button className="pbtn ghost" onClick={() => setChooser(false)}>✕</button></div>
            <p className="pnote">Pick what you have — OpsMatrix knows what to do with each.</p>
            <button className="upltile" onClick={() => { setChooser(false); setPlanMode("cad"); setPlanOpen(true); }}>
              <b>🗂 CAD floor with room data (.omfloor or DXF)</b>
              <span>A floor file from our CAD converter, or a CAD drawing that carries its rooms. Every room,
                number, name and square foot comes straight from the file — exact, nothing guessed. No AI and no API key.</span>
            </button>
            <button className="upltile" onClick={() => { setChooser(false); setPlanMode(arrivalMode === "cad" ? undefined : arrivalMode); setPlanOpen(true); }}>
              <b>🗺 Floor plan — picture or PDF</b>
              <span>Max reads the rooms, numbers and sizes, then redraws the plan in OpsMatrix's own style.</span>
            </button>
            <button className="upltile" onClick={() => { setChooser(false); rlRef.current?.click(); }}>
              <b>📊 Room list — Excel, CSV or raw data</b>
              <span>A spreadsheet or export of rooms and details, imported straight into Max Space.</span>
            </button>
            <button className="upltile" onClick={() => { setChooser(false); mpRef.current?.click(); }}>
              <b>⚡ magicplan export — DXF + CSV</b>
              <span>A laser-measured scan. Rooms are detected and drawn exactly.</span>
            </button>
          </div>
        </div>,
        document.body
      )}

      <AiPlanImport key={planMode ?? "choice"} open={planOpen} onClose={() => setPlanOpen(false)}
        defaultMode={planMode} rules={rules}
        commit={commit} onImported={() => reloadWhenSaved()} />

      <input ref={rlRef} type="file" style={{ display: "none" }}
        accept=".xlsx,.xlsm,.xls,.csv,.tsv"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          setChooser(false);
          if (f) handleRoomList(f);
        }} />
      <input ref={mpRef} type="file" multiple accept=".dxf,.csv" style={{ display: "none" }}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          setChooser(false);
          if (files.length) handleMagicplan(files);
        }} />

      {rlPhase !== "idle" && createPortal(
        <div className="pro-modalback" onClick={(e) => {
          if (e.target === e.currentTarget && rlPhase !== "working") setRlPhase("idle");
        }}>
          <div className="pro-modal">
            {rlPhase === "working" && (
              <div className="aiworking"><div className="aispin" /><b>Reading the room list…</b></div>
            )}
            {rlPhase === "error" && (<>
              <div className="pshead"><h2>Import room list</h2>
                <button className="pbtn ghost" onClick={() => setRlPhase("idle")}>✕</button></div>
              <p className="warntext">⚠ {rlError}</p>
            </>)}
            {rlPhase === "done" && rlSummary && <ImportResult summary={rlSummary} />}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function Sel({ label, v, on, opts }: {
  label: string; v: string; on: (v: string) => void; opts: [string, string][];
}) {
  return (
    <label className="psel">
      <span>{label}</span>
      <select value={v} onChange={(e) => on(e.target.value)}>
        <option value="">All</option>
        {opts.map(([val, txt]) => <option key={val} value={val}>{txt}</option>)}
      </select>
    </label>
  );
}

// ── Map tab sidebar: schedule THIS room (coverage per schedule) ─────────────

function ScheduleRoomSidebar({ space, data, rules, schedules, onClose, onEditSpace, commit }: {
  space: ClassicSpace;
  data: ClassicData;
  rules: Rules;
  schedules: ClassicSchedule[];
  onClose: () => void;
  onEditSpace: () => void;
  commit: (mut: (d: ClassicData) => void) => void;
}) {
  const cov = coverageForSpace(data, space.id);
  const un = uncovered(data, rules, space);
  // floor-care work shows here for the full picture, but is NEVER schedulable
  // from Max Schedules — it belongs to Max Floor Care exclusively
  const { cleaning: req, floorCare: fcReq } = splitRequiredTasks(rules, space);
  const freq = rules.roomTypes.find((r) => r.id === typeIdFromLabel(rules, space.roomType ?? ""))?.frequency;
  const [addOpen, setAddOpen] = useState(false);
  const notes = notesForSpace(data, space);
  const taskLabelOf = (t: string) => rules.tasks.find((x) => x.id === t)?.label ?? t;
  const unClean = un.tasks.filter((t) => !isFloorCareTask(rules, t));
  const unFc = un.tasks.filter((t) => isFloorCareTask(rules, t));

  return (
    <aside className="pro-side">
      <div className="pshead">
        <h2>{space.roomNumber || space.roomName || "Room"}</h2>
        <button className="pbtn ghost" onClick={onClose}>✕</button>
      </div>
      <p className="pnote">
        {space.roomType} · {Math.round(Number(space.squareFeet) || 0)} ft² · {space.floorType || "hard floor"} · {freq}
        {" "}<button className="plink" onClick={onEditSpace}>edit room details →</button>
      </p>
      {/* the room's notes ride along into scheduling, so they get acknowledged */}
      {(notes.own || notes.linked.length > 0) && (
        <div className="roomnote">
          {notes.own && <p>📝 {notes.own}</p>}
          {notes.linked.map((n) => (
            <p key={n.id}>📝 {n.title || ""}{n.title && n.body ? " — " : ""}{n.body ?? ""}</p>
          ))}
        </div>
      )}

      <div className="pfield"><span>This room needs</span>
        <div className="ptasks readonly">
          <span className="ptask locked">General Clean</span>
          {req.map((t) => {
            const covered = cov.some((c) => c.tasks.includes(t));
            return <span key={t} className={"ptask" + (covered ? " on" : " warn")}>
              {taskLabelOf(t)}{covered ? "" : " ⚠"}
            </span>;
          })}
          {fcReq.map((t) => {
            const covered = cov.some((c) => c.tasks.includes(t));
            return <span key={t} className={"ptask fc" + (covered ? " on" : " warn")}
              title="Floor-care work — scheduled in Max Floor Care only">
              {taskLabelOf(t)}{covered ? "" : " ⚠"}
            </span>;
          })}
        </div>
        {(un.baseUncovered || unClean.length > 0) && (
          <small className="warntext">
            ⚠ Not yet on a schedule: {[un.baseUncovered ? "General Clean" : "", ...unClean.map(taskLabelOf)].filter(Boolean).join(", ")}
          </small>
        )}
        {unFc.length > 0 && (
          <small className="warntext">
            🧽 Waiting on a <a className="plink" href="./maps.html#floorcare">Max Floor Care</a> schedule: {unFc.map(taskLabelOf).join(", ")}
          </small>
        )}
      </div>

      <div className="pfield"><span>Who cleans this room</span></div>
      {cov.length === 0 && <p className="pnote">Nobody yet — tap <b>＋ Add to schedule</b> below to give it to a schedule.</p>}
      {cov.map((c) => {
        const sched = schedules.find((s) => s.id === c.scheduleId);
        if (!sched) return null;
        const mins = coverageMinutes(rules, space, c);
        // a schedule shipped from Max Floor Care is read-only here — its
        // stops, machines and hours are edited over there
        if (sched.floorCareId) {
          return (
            <div key={c.scheduleId} className="covrow" style={{ borderLeftColor: String(sched.color) }}>
              <div className="covhead">
                <b>🧽 {sched.num} · {sched.name}</b>
                <em>{sched.employee || sched.shift} · {mins}m</em>
              </div>
              <div className="ptasks">
                {c.tasks.map((t) => <span key={t} className="ptask locked sm">{taskLabelOf(t)}</span>)}
              </div>
              <small className="pnote">Floor-care schedule — <a className="plink" href={"./maps.html#floorcare?fc=" + sched.floorCareId}>edit it in Max Floor Care</a>.</small>
            </div>
          );
        }
        return (
          <div key={c.scheduleId} className="covrow" style={{ borderLeftColor: String(sched.color) }}>
            <div className="covhead">
              <b>{sched.num} · {sched.name}</b>
              <em>{sched.employee || sched.shift} · {mins}m</em>
              <button className="pbtn ghost small" onClick={() =>
                commit((d) => setCoverage(d, space.id, c.scheduleId, false, []))
              }>✕</button>
            </div>
            <div className="ptasks">
              {c.primary && <span className="ptask locked">General Clean ✓</span>}
              {req.map((t) => {
                const on = c.tasks.includes(t);
                return (
                  <button key={t} className={"ptask" + (on ? " on" : "")}
                    onClick={() => commit((d) => setCoverage(d, space.id, c.scheduleId, c.primary,
                      on ? c.tasks.filter((x) => x !== t) : [...c.tasks, t]))}>
                    {taskLabelOf(t)}
                  </button>
                );
              })}
              {!c.primary && (
                <button className="ptask" onClick={() =>
                  commit((d) => setCoverage(d, space.id, c.scheduleId, true, c.tasks))
                }>+ General Clean</button>
              )}
            </div>
          </div>
        );
      })}

      <AddToScheduleBlock space={space} rules={rules} schedules={schedules}
        cov={cov} req={req} commit={commit} addOpen={addOpen} setAddOpen={setAddOpen} />
    </aside>
  );
}

/**
 * "＋ Add to schedule" — ALWAYS there when a room is open (the old version
 * vanished when no schedules existed yet, which read as "there's nowhere to
 * add a schedule"). Tap an existing schedule to add the room instantly, or
 * make a brand-new schedule right here — name, shift, color — and the room
 * lands on it in the same tap.
 */
function AddToScheduleBlock({ space, rules, schedules, cov, req, commit, addOpen, setAddOpen }: {
  space: ClassicSpace;
  rules: Rules;
  schedules: ClassicSchedule[];
  cov: { scheduleId: string; primary: boolean; tasks: string[] }[];
  req: string[];
  commit: (mut: (d: ClassicData) => void) => void;
  addOpen: boolean;
  setAddOpen: (v: boolean) => void;
}) {
  // floor-care schedules never take rooms from here (Max Floor Care's job)
  const available = schedules.filter((s) => !s.floorCareId && !cov.some((c) => c.scheduleId === s.id));
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(() => ({ name: "", shift: "1st Shift", color: "" }));
  const usedColors = schedules.map((s) => String(s.color ?? ""));
  const nextColor = SCHED_COLORS.find((c) => !usedColors.includes(c)) ?? SCHED_COLORS[0];

  const addTo = (schedId: string) => {
    commit((d) => {
      const hasPrimary = coverageForSpace(d, space.id).some((c) => c.primary);
      const u = uncovered(d, rules, d.v7.spaces!.find((x) => x.id === space.id)!);
      // instant add: base clean if unclaimed, else the leftover tasks (never
      // floor-care ones) — and even with nothing left, the row appears so
      // tasks can be picked here
      const leftover = u.tasks.filter((t) => !isFloorCareTask(rules, t));
      setCoverage(d, space.id, schedId, !hasPrimary, hasPrimary ? leftover : req, true);
    });
    setAddOpen(false);
    setCreating(false);
  };

  return (
    <div className="pfield big">
      {!addOpen ? (
        <button className="pbtn primary wide" onClick={() => setAddOpen(true)}>＋ Add to schedule</button>
      ) : (
        <div className="addlist">
          {available.length > 0 && <span>Tap a schedule — it's added instantly, then pick its tasks above:</span>}
          {available.map((s) => (
            <button key={s.id} className="addrow" style={{ borderLeftColor: String(s.color) }}
              onClick={() => addTo(s.id)}>
              <i style={{ background: String(s.color) }} />
              <b>{s.num} · {s.name}</b>
              <em>{s.shift} · {s.employee || "unassigned"}</em>
            </button>
          ))}
          {!creating ? (
            <button className="addrow newsched" onClick={() => { setDraft({ name: "", shift: "1st Shift", color: nextColor }); setCreating(true); }}>
              <i className="dashed" />
              <b>＋ Make a new schedule…</b>
            </button>
          ) : (
            <div className="newschedform">
              <input autoFocus placeholder="Schedule name (e.g. East Wing — Days)" value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <select value={draft.shift} onChange={(e) => setDraft({ ...draft, shift: e.target.value })}>
                <option>1st Shift</option><option>2nd Shift</option><option>3rd Shift</option>
              </select>
              <div className="colorrow">
                <span>Color:</span>
                {SCHED_COLORS.map((c) => (
                  <button key={c} className={"colordot" + (draft.color === c ? " on" : "")}
                    style={{ background: c }} aria-label={"color " + c}
                    onClick={() => setDraft({ ...draft, color: c })} />
                ))}
              </div>
              <button className="pbtn primary" disabled={!draft.name.trim()} onClick={() => {
                let newId = "";
                commit((d) => {
                  const s = createSchedule(d, draft.name.trim(), draft.shift, "", draft.color || nextColor);
                  newId = s.id;
                  const hasPrimary = coverageForSpace(d, space.id).some((c) => c.primary);
                  const u = uncovered(d, rules, d.v7.spaces!.find((x) => x.id === space.id)!);
                  const leftover = u.tasks.filter((t) => !isFloorCareTask(rules, t));
                  setCoverage(d, space.id, s.id, !hasPrimary, hasPrimary ? leftover : req, true);
                });
                void newId;
                setAddOpen(false);
                setCreating(false);
              }}>Create schedule + add this room</button>
            </div>
          )}
          <button className="pbtn small" onClick={() => { setAddOpen(false); setCreating(false); }}>Cancel</button>
        </div>
      )}
      <small>First schedule gets General Clean automatically; extra schedules pick up remaining tasks (e.g. High Dusting for someone else). Rooms on two schedules show striped on the map.</small>
    </div>
  );
}

// ── Spaces tab sidebar: the room's OWN details + required tasks ─────────────

function SpaceSidebar({ space, rules, deptOptions, onClose, onChange, onOpenEditor }: {
  space: ClassicSpace;
  rules: Rules;
  /** every department the account already uses — typing a new one creates it */
  deptOptions: string[];
  onClose: () => void;
  onChange: (patch: Partial<ClassicSpace>) => void;
  onOpenEditor: () => void;
}) {
  // edits BUFFER locally and commit on 💾 Save (Josh, 2026-09-25: "a save
  // button confirms it was finished"). Nothing is ever lost: switching rooms
  // or closing the sidebar saves any pending changes automatically — the
  // button exists for confirmation, not as a trap.
  const [draft, setDraft] = useState<Partial<ClassicSpace>>({});
  const cur = { ...space, ...draft } as ClassicSpace;
  const dirty = Object.keys(draft).length > 0;
  const set = (patch: Partial<ClassicSpace>) => setDraft((prev) => ({ ...prev, ...patch }));
  const save = () => {
    if (Object.keys(draft).length) onChange(draft);
    setDraft({});
  };
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => () => {
    // unmount = room switched or sidebar closed — save what's pending
    if (Object.keys(draftRef.current).length) onChangeRef.current(draftRef.current);
  }, []);

  const typeId = typeIdFromLabel(rules, cur.roomType ?? "");
  const carpet = isCarpet(cur.floorType);
  // the stored list (an editor shows what's really there), and the tasks
  // this type's General Clean already covers — those can't be extras
  const req = rawSpaceTasks(rules, cur);
  const included = includedTasksFor(rules, typeId);
  const autoTasks = autoTasksFor(rules, typeId, cur.floorType);
  const issues = spaceIncomplete(cur);

  return (
    <aside className="pro-side">
      <div className="pshead">
        <h2>{cur.roomNumber || cur.roomName || "Room"}</h2>
        <button className="pbtn ghost" onClick={onClose}>✕</button>
      </div>
      {issues.length > 0 && <p className="warntext">⚠ Missing: {issues.join(", ")}</p>}
      <p className="pnote">
        {[cur.building, cur.floor, cur.department].map((v) => String(v ?? "").trim()).filter(Boolean).join(" · ") || " "}
        {" "}<button className="plink" onClick={onOpenEditor}>open the full editor →</button>
      </p>

      <div className="prow">
        <label className="pfield">Room number
          <input value={String(cur.roomNumber ?? "")} placeholder="e.g. 4E-102"
            onChange={(e) => set({ roomNumber: e.target.value })} />
        </label>
        <label className="pfield">Room name
          <input value={String(cur.roomName ?? "")} placeholder="e.g. Patient Room"
            onChange={(e) => set({ roomName: e.target.value })} />
        </label>
      </div>
      <label className="pfield">Room type
        <select value={typeId} onChange={(e) => {
          const rt = rules.roomTypes.find((x) => x.id === e.target.value);
          // changing the type refreshes its automatic tasks in the draft, so
          // the chips below update live before anything is saved
          set({ roomType: rt?.label ?? e.target.value, spaceTasks: autoTasksFor(rules, e.target.value, cur.floorType) });
        }}>
          {rules.roomTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.label} · {rt.frequency}</option>)}
        </select>
      </label>
      <div className="prow">
        <label className="pfield">Floor type
          <select value={cur.floorType || ""}
            onChange={(e) => {
              // swap the floor's automatic tasks, worked from the LATEST draft
              const floorType = e.target.value;
              setDraft((prev) => ({
                ...prev, floorType,
                spaceTasks: tasksAfterFloorChange(rules, { ...space, ...prev } as ClassicSpace, floorType)
              }));
            }}>
            <option value="">— unset: prices as hard floor —</option>
            {FLOOR_TYPES.map((f) => <option key={f}>{f}</option>)}
          </select>
        </label>
        <label className="pfield">Square feet
          <input type="number" min={0} value={Number(cur.squareFeet) || 0}
            onChange={(e) => set({ squareFeet: Number(e.target.value) || 0 })} />
        </label>
      </div>
      <div className="pfield"><span>Priority</span>
        <div className="prio">
          {PRIORITIES.map((p) => (
            <button key={p} className={"priobtn " + p.toLowerCase() + (spacePriority(cur) === p ? " on" : "")}
              onClick={() => set({ priority: p })}>{PRIORITY_WORD[p]}</button>
          ))}
        </div>
        <small>Prints on every schedule this room appears on, so the worker knows what cannot wait.</small>
      </div>

      <label className="pfield checkline">
        <input type="checkbox" checked={spaceCleanability(rules, cur) !== "Non-cleanable"}
          onChange={(e) => set({ cleanability: e.target.checked ? "Cleanable" : "Non-cleanable" })} />
        <span>Cleanable — counts toward EVS workload</span>
      </label>

      <div className="prow">
        <label className="pfield">Department
          <input list="side-depts" value={String(cur.department ?? "")}
            placeholder="pick one, or type a new one"
            onChange={(e) => set({ department: e.target.value })} />
          <datalist id="side-depts">
            {deptOptions.map((d) => <option key={d} value={d} />)}
          </datalist>
        </label>
      </div>

      <div className="prow">
        <label className="pfield">Fixtures
          <input type="number" min={0} value={Number(cur.fixtureCount) || 0}
            onChange={(e) => set({ fixtureCount: Number(e.target.value) || 0 })} />
        </label>
        {carpet && (
          <label className="pfield accent">Vacuum days/week
            <input type="number" min={1} max={7} value={Number(cur.vacuumDaysPerWeek) || 5}
              onChange={(e) => set({ vacuumDaysPerWeek: Math.max(1, Math.min(7, Number(e.target.value) || 5)) })} />
          </label>
        )}
      </div>

      <div className="pfield"><span>Tasks this room needs (General Clean is always included)</span>
        <div className="ptasks">
          <span className="ptask locked">General Clean</span>
          {rules.tasks.filter((t) => t.addable).map((t) => {
            const on = req.includes(t.id);
            const auto = autoTasks.includes(t.id);
            if (included.includes(t.id)) {
              // part of General Clean here: never an extra — flagged if listed
              return on ? (
                <button key={t.id} className="ptask warn"
                  onClick={() => set({ spaceTasks: req.filter((x) => x !== t.id) })}>
                  ⚠ {t.label} is in General Clean — tap to remove
                </button>
              ) : <span key={t.id} className="ptask incl">{t.label} ✓ in General Clean</span>;
            }
            return (
              <button key={t.id} className={"ptask" + (on ? " on" : "") + (t.floorCare ? " fc" : "")}
                onClick={() => set({ spaceTasks: on ? req.filter((x) => x !== t.id) : [...req, t.id] })}>
                {t.label}{auto ? " •" : ""}
              </button>
            );
          })}
        </div>
        <small>• = automatic for this room type or floor type. Who does each task is decided on the Map tab — different tasks can go to different schedules.</small>
      </div>

      <button className="pbtn primary wide" disabled={!dirty} onClick={save}>
        {dirty ? "💾 Save room" : "✓ Saved"}
      </button>
      <small className="pnote">Changes also save automatically when you close this panel or switch rooms — nothing is lost either way.</small>

    </aside>
  );
}

// ── Schedules tab: the list view, bidirectional with the map ────────────────

function SchedulesTab({ data, rules, schedules, employees, commit, onOpenOnMap, onPrint }: {
  data: ClassicData;
  rules: Rules;
  schedules: ClassicSchedule[];
  employees: ClassicData["v7"]["employees"] & {};
  commit: (mut: (d: ClassicData) => void) => void;
  onOpenOnMap: (id: string) => void;
  onPrint: (id: string) => void;
}) {
  const [draft, setDraft] = useState({ name: "", shift: "1st Shift", employeeId: "", color: "" });
  const spaces = data.v7.spaces ?? [];
  const usedColors = schedules.map((s) => String(s.color ?? ""));
  const nextColor = SCHED_COLORS.find((c) => !usedColors.includes(c)) ?? SCHED_COLORS[0];

  // Client template exports: every named template uploaded in Admin
  // Settings → Exporting is a button here; with none saved, the bundled
  // client template stands in (clientSchedule.ts owns the mechanics)
  const templates = loadTemplates(data);
  const exportInput = (s: ClassicSchedule, members: ClassicSpace[]): ClientExportInput => {
    const bs = (rules.breakSchedules ?? []).find((b) => b.id === s.breakScheduleId);
    const orgName = String(((data.v7.settings ?? {}) as Record<string, unknown>).orgName ?? "").trim();
    return {
      scheduleName: [s.num, s.name].filter(Boolean).join(" · "),
      orgName: orgName || "OpsMatrix",
      days: s.days,
      hoursStart: s.hoursStart,
      hoursEnd: s.hoursEnd,
      windows: bs?.windows ?? [],
      assignments: members.map((sp) =>
        [String(sp.roomNumber ?? ""), String(sp.roomName ?? "").trim() || String(sp.roomType ?? "")]
          .filter(Boolean).join(" — "))
    };
  };
  const exportClient = (s: ClassicSchedule, members: ClassicSpace[]) => {
    downloadClientSchedule(exportInput(s, members))
      .catch((e) => alert("The client schedule export hit a snag: " + (e as Error).message));
  };
  const exportViaTemplate = (t: ClientTemplate, s: ClassicSchedule, members: ClassicSpace[]) => {
    downloadTemplateExport(b64ToBytes(t.dataB64), t.map, exportInput(s, members), t.label)
      .then((leftOver) => {
        if (leftOver.length) {
          alert(`"${t.label}" holds ${t.map.assignmentCells.length} assignment rows — these didn't fit:\n` +
            leftOver.join("\n"));
        }
      })
      .catch((e) => alert(`The "${t.label}" export hit a snag: ` + (e as Error).message));
  };

  return (
    <div className="pro-list">
      <div className="prule add big">
        <input placeholder="New schedule name (e.g. East Wing — Daily)" value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <select value={draft.shift} onChange={(e) => setDraft({ ...draft, shift: e.target.value })}>
          <option>1st Shift</option><option>2nd Shift</option><option>3rd Shift</option>
        </select>
        <select value={draft.employeeId} onChange={(e) => setDraft({ ...draft, employeeId: e.target.value })}
          title="Optional — you can hand the schedule to a worker any time">
          <option value="">Worker — add later (optional)</option>
          {(employees ?? []).map((e) => <option key={e.id} value={e.id}>{String(e.displayName ?? "")}</option>)}
        </select>
        <span className="colorrow" title="Schedule color — how it shows on the map">
          {SCHED_COLORS.map((c) => (
            <button key={c} className={"colordot" + ((draft.color || nextColor) === c ? " on" : "")}
              style={{ background: c }} aria-label={"color " + c}
              onClick={() => setDraft({ ...draft, color: c })} />
          ))}
        </span>
        <button className="pbtn primary" disabled={!draft.name.trim()} onClick={() => {
          commit((d) => { createSchedule(d, draft.name.trim(), draft.shift, draft.employeeId, draft.color || nextColor); });
          setDraft({ name: "", shift: "1st Shift", employeeId: "", color: "" });
        }}>Create schedule</button>
      </div>

      {schedules.map((s) => {
        const mins = Math.round(scheduleMinutes(data, rules, s));
        // paid shift less paid breaks; the bar shows paid hours (work + paid breaks)
        const cap = scheduleCapacity(data, rules, s);
        const target = cap.workMinutes;
        const members = (s.spaceOrder ?? [])
          .map((id) => spaces.find((sp) => sp.id === id))
          .filter(Boolean) as ClassicSpace[];
        const ns = data.nonSpace.filter((t) => t.scheduleId === s.id);
        return (
          <div key={s.id} className="schedcard" style={{ borderLeftColor: String(s.color) }}>
            <div className="schedhead">
              <SchedColorDot sched={s} commit={commit} />
              <b>{s.num} · {s.name}</b>
              <span>{s.shift} · {s.employee || "unassigned"}</span>
              <em className={mins > target ? "over" : ""}
                title={`${cap.paidMinutes} paid min − ${cap.paidBreakMinutes} min paid breaks${cap.unpaidBreakMinutes ? ` (+ ${cap.unpaidBreakMinutes} min unpaid, added to the day)` : ""}`}>
                {mins}m of {target}m
              </em>
              <HoursBar minutes={mins + cap.paidBreakMinutes} />
              <span className="schedacts">
                <button className="pbtn small primary" onClick={() => onPrint(s.id)}>🖨 Print schedule</button>
                {templates.length ? templates.map((t) => (
                  <button key={t.id} className="pbtn small"
                    title={`Fill the "${t.label}" template with this schedule`}
                    onClick={() => exportViaTemplate(t, s, members)}>⬇ {t.label}</button>
                )) : (
                  <button className="pbtn small" title="Fill the client's Excel template with this schedule"
                    onClick={() => exportClient(s, members)}>⬇ Client schedule export</button>
                )}
                {s.floorCareId ? (
                  <a className="pbtn small" href={"./maps.html#floorcare?fc=" + s.floorCareId}>Edit in Floor Care</a>
                ) : s.sanitationId ? (
                  <a className="pbtn small" href={"./maps.html#sanitation?sr=" + s.sanitationId}>Edit in Max Sanitation</a>
                ) : s.policingId ? (
                  <a className="pbtn small" href={"./maps.html#policing?pr=" + s.policingId}>Edit in Max Policing</a>
                ) : (
                  <button className="pbtn small" onClick={() => onOpenOnMap(s.id)}>🗺 Edit on map</button>
                )}
                <button className="pbtn small danger" onClick={() => {
                  if (confirm(`Delete schedule "${s.name}"? Rooms stay, just unscheduled.`)) {
                    commit((d) => deleteSchedule(d, s.id));
                  }
                }}>✕</button>
              </span>
            </div>
            <BreakRow sched={s} rules={rules} commit={commit} />
            <ClientRow sched={s} rules={rules} commit={commit} />
            <div className="schedrooms">
              {members.length > 1 && (
                <p className="pnote" style={{ margin: "0 0 4px" }}>
                  Cleaned in this order — the order rooms were tapped. Use ↑ ↓ to fix a mis-tap.
                </p>
              )}
              {members.map((sp, i) => {
                // a Sanitation/Policing route carries its own per-stop
                // minutes and never has cleaning coverage — rendering it
                // through coverage crashed this whole page (2026-09-01 fix)
                const routeStops = s.routeOnly
                  ? ((s.routeStopMinutes as Record<string, number> | undefined) ?? {})
                  : null;
                const c = coverageForSpace(data, sp.id).find((x) => x.scheduleId === s.id);
                if (!c && !routeStops) return null;
                return (
                  <div key={sp.id} className="schedroom">
                    <span className="ordnum">{i + 1}</span>
                    <b>{sp.roomNumber}</b>
                    <span>{routeStops
                      ? (s.sanitationId ? "Collection stop" : "Porter pass")
                      : [c!.primary ? "General Clean" : "", ...c!.tasks.map((t) => rules.tasks.find((x) => x.id === t)?.label ?? t)].filter(Boolean).join(" + ") || "no tasks picked yet"}</span>
                    <em>{routeStops ? Math.round(Number(routeStops[sp.id]) || 0) : coverageMinutes(rules, sp, c!)}m</em>
                    {!routeStops && (
                      <span className="ordmove">
                        <button disabled={i === 0} title="Move earlier"
                          onClick={() => commit((d) => moveInSchedule(d, s.id, sp.id, -1))}>↑</button>
                        <button disabled={i === members.length - 1} title="Move later"
                          onClick={() => commit((d) => moveInSchedule(d, s.id, sp.id, 1))}>↓</button>
                      </span>
                    )}
                  </div>
                );
              })}
              {ns.map((t) => {
                const counted = Number(t.count) > 0 && Number(t.minutesPer) > 0;
                return (
                  <div key={t.id} className="schedroom nonspace">
                    <b>◇ {t.name}</b>
                    {counted ? (
                      <span>
                        <input className="nscount" type="number" min={1} value={Number(t.count)}
                          onChange={(e) => {
                            const c = Math.max(1, Number(e.target.value) || 1);
                            commit((d) => {
                              const row = d.nonSpace.find((x) => x.id === t.id);
                              if (!row) return;
                              row.count = c;
                              row.hours = Math.round((c * (row.minutesPer ?? 0)) / 60 * 100) / 100;
                            });
                          }} />
                        × {t.minutesPer}m each (qualifiers included)
                      </span>
                    ) : (
                      <span>non-space task{t.roomIds.length ? ` · ${t.roomIds.length} linked rooms` : ""}</span>
                    )}
                    <em>{Math.round(nonSpaceTaskMinutes(t))}m</em>
                    <button className="pbtn small ghost" title="Take this off the schedule"
                      onClick={() => commit((d) => { d.nonSpace = d.nonSpace.filter((x) => x.id !== t.id); })}>✕</button>
                  </div>
                );
              })}
              {!s.floorCareId && rules.nonSpaceDefs.length > 0 && (
                <div className="schedroom nonspace add">
                  <select value="" onChange={(e) => {
                    const def = rules.nonSpaceDefs.find((x) => x.id === e.target.value);
                    if (!def) return;
                    const per = nonSpaceOccurrenceMinutes(rules, def);
                    commit((d) => d.nonSpace.push({
                      id: uid("nst"), name: def.label, defId: def.id, count: 1, minutesPer: per,
                      hours: Math.round(per / 60 * 100) / 100, scheduleId: s.id, roomIds: []
                    }));
                  }}>
                    <option value="">＋ Add non-space task (discharges…)</option>
                    {rules.nonSpaceDefs.map((def) => (
                      <option key={def.id} value={def.id}>
                        {def.label} · {nonSpaceOccurrenceMinutes(rules, def)}m each
                      </option>
                    ))}
                  </select>
                  <span className="pnote">then set how many — the time multiplies out, qualifiers included</span>
                </div>
              )}
              {!members.length && !ns.length && <p className="pnote">Empty — click "Edit on map" and tap rooms to add them.</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** the schedule's color, changeable in place — tap the dot, pick a new one */
function SchedColorDot({ sched, commit }: {
  sched: ClassicSchedule;
  commit: (mut: (d: ClassicData) => void) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="colordot-wrap">
      <button className="colordot big" style={{ background: String(sched.color) }}
        title="Change this schedule's color" onClick={() => setOpen(!open)} />
      {open && (
        <span className="colorpop">
          {SCHED_COLORS.map((c) => (
            <button key={c} className={"colordot" + (c === sched.color ? " on" : "")} style={{ background: c }}
              aria-label={"color " + c}
              onClick={() => {
                commit((d) => {
                  const t = (d.v7.schedules ?? []).find((x) => x.id === sched.id);
                  if (t) t.color = c;
                });
                setOpen(false);
              }} />
          ))}
        </span>
      )}
    </span>
  );
}

// ── Rooms tab: schedule from a list, not just the map ───────────────────────
// Josh's ask (2026-08-28): "I want to be able to schedule both ways." Every
// room in one table — what it needs, who has it — with the same instant
// add-to-schedule as the map sidebar.

function RoomsScheduleTab({ data, rules, schedules, commit, onNewSchedule }: {
  data: ClassicData;
  rules: Rules;
  schedules: ClassicSchedule[];
  commit: (mut: (d: ClassicData) => void) => void;
  onNewSchedule: () => void;
}) {
  const spaces = data.v7.spaces ?? [];
  const [q, setQ] = useState("");
  const [fB, setFB] = useState("");
  const [fF, setFF] = useState("");
  const [onlyUnscheduled, setOnlyUnscheduled] = useState(false);

  const opts = (get: (sp: ClassicSpace) => unknown, pred?: (sp: ClassicSpace) => boolean) =>
    [...new Set(spaces.filter(pred ?? (() => true)).map((sp) => String(get(sp) ?? "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const rows = spaces.filter((sp) => {
    if (fB && String(sp.building ?? "").trim() !== fB) return false;
    if (fF && String(sp.floor ?? "").trim() !== fF) return false;
    if (onlyUnscheduled && !uncovered(data, rules, sp).baseUncovered) return false;
    if (q && !`${sp.roomNumber} ${sp.roomName} ${sp.department}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const addTo = (sp: ClassicSpace, schedId: string) => commit((d) => {
    const hasPrimary = coverageForSpace(d, sp.id).some((c) => c.primary);
    const u = uncovered(d, rules, d.v7.spaces!.find((x) => x.id === sp.id)!);
    // floor-care tasks never board a cleaning schedule — Max Floor Care's job
    const leftover = u.tasks.filter((t) => !isFloorCareTask(rules, t));
    setCoverage(d, sp.id, schedId, !hasPrimary,
      hasPrimary ? leftover : splitRequiredTasks(rules, sp).cleaning, true);
  });

  return (
    <div className="pro-list spaces">
      <div className="pro-filters wrap">
        <label className="psel"><span>Building</span>
          <select value={fB} onChange={(e) => setFB(e.target.value)}>
            <option value="">All</option>
            {opts((s) => s.building).map((b) => <option key={b}>{b}</option>)}
          </select>
        </label>
        <label className="psel"><span>Floor</span>
          <select value={fF} onChange={(e) => setFF(e.target.value)}>
            <option value="">All</option>
            {opts((s) => s.floor, (s) => !fB || String(s.building ?? "").trim() === fB).map((b) => <option key={b}>{b}</option>)}
          </select>
        </label>
        <label className="checkline psel">
          <input type="checkbox" checked={onlyUnscheduled} onChange={(e) => setOnlyUnscheduled(e.target.checked)} />
          <span>Only rooms nobody cleans yet</span>
        </label>
        <span className="grow" />
        <button className="pbtn small" onClick={onNewSchedule}>＋ New schedule…</button>
      </div>
      <input className="wi-search wide" placeholder="🔎 Search rooms — number, name or department…"
        value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="pnote counts">{rows.length} of {spaces.length} rooms{schedules.length === 0 ? " — make your first schedule with ＋ New schedule…" : ""}</p>
      <div className="wi-tablewrap">
        <table className="wi-table rooms">
          <thead><tr>
            <th>Room</th><th>Name</th><th>Department</th><th>Needs</th><th>On schedules</th><th>Add</th>
          </tr></thead>
          <tbody>
            {rows.map((sp) => {
              const cov = coverageForSpace(data, sp.id);
              const un = uncovered(data, rules, sp);
              const { cleaning: req, floorCare: fcReq } = splitRequiredTasks(rules, sp);
              const available = schedules.filter((s) => !s.floorCareId && !cov.some((c) => c.scheduleId === s.id));
              return (
                <tr key={sp.id} className={un.baseUncovered ? "warn" : ""}>
                  <td><b>{String(sp.roomNumber ?? "") || "—"}</b></td>
                  <td>{String(sp.roomName ?? "")}</td>
                  <td>{String(sp.department ?? "")}</td>
                  <td className="needcell">
                    <span className={"ptask sm" + (un.baseUncovered ? " warn" : " on")}>General Clean{un.baseUncovered ? " ⚠" : ""}</span>
                    {req.map((t) => {
                      const covd = cov.some((c) => c.tasks.includes(t));
                      return <span key={t} className={"ptask sm" + (covd ? " on" : " warn")}>
                        {rules.tasks.find((x) => x.id === t)?.label ?? t}{covd ? "" : " ⚠"}
                      </span>;
                    })}
                    {fcReq.map((t) => {
                      const covd = cov.some((c) => c.tasks.includes(t));
                      return <span key={t} className={"ptask sm fc" + (covd ? " on" : " warn")}
                        title="Floor-care work — scheduled in Max Floor Care only">
                        {rules.tasks.find((x) => x.id === t)?.label ?? t}{covd ? "" : " ⚠"}
                      </span>;
                    })}
                  </td>
                  <td className="covcell">
                    {cov.length === 0 && <em className="dim">nobody yet</em>}
                    {cov.map((c) => {
                      const s = schedules.find((x) => x.id === c.scheduleId);
                      if (!s) return null;
                      return (
                        <span key={c.scheduleId} className="covchip" style={{ borderColor: String(s.color) }}>
                          <i style={{ background: String(s.color) }} />
                          {s.num} {s.name}
                          <button title="Take this room off the schedule"
                            onClick={() => commit((d) => setCoverage(d, sp.id, c.scheduleId, false, []))}>✕</button>
                        </span>
                      );
                    })}
                  </td>
                  <td>
                    {available.length > 0 && (
                      <select value="" onChange={(e) => { if (e.target.value) addTo(sp, e.target.value); }}>
                        <option value="">＋ Add to…</option>
                        {available.map((s) => <option key={s.id} value={s.id}>{s.num} · {s.name} ({s.shift})</option>)}
                      </select>
                    )}
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={6}><p className="pnote">No rooms match.</p></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Per-schedule break control. The account's breaks are the starting point;
 * this is where one crew's lunch moves without disturbing anyone else's.
 */
function BreakRow({ sched, rules, commit }: {
  sched: ClassicSchedule;
  rules: Rules;
  commit: (mut: (d: ClassicData) => void) => void;
}) {
  const [open, setOpen] = useState(false);
  const all = rules.breaks ?? [];
  if (!all.length) return null;

  const overrides = (sched.breaks ?? []) as SchedBreak[];
  const setOv = (id: string, patch: Partial<SchedBreak>) => commit((d) => {
    const target = (d.v7.schedules ?? []).find((x) => x.id === sched.id);
    if (!target) return;
    const list = [...((target.breaks ?? []) as SchedBreak[])];
    const at = list.findIndex((o) => o.id === id);
    if (at < 0) list.push({ id, ...patch });
    else list[at] = { ...list[at], ...patch };
    target.breaks = list;
  });

  const taken = all.filter((b) => !overrides.find((o) => o.id === b.id)?.off);
  const summary = taken.length
    ? taken.map((b) => { const ov = overrides.find((o) => o.id === b.id); return `${b.label} ${ov?.start ?? b.start}${(ov?.unpaid ?? b.unpaid) ? " (unpaid)" : ""}`; }).join(" · ")
    : "no breaks on this schedule";

  return (
    <div className="schedbreaks">
      <button className="plink" onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} Breaks — {summary}
      </button>
      {open && (
        <div className="brklist">
          {all.map((b) => {
            const ov = overrides.find((o) => o.id === b.id);
            const on = !ov?.off;
            return (
              <div key={b.id} className="brkrow">
                <button className={"ptask" + (on ? " on" : "")}
                  onClick={() => setOv(b.id, { off: on })}>{on ? "✓ " : ""}{b.label}</button>
                <label>starts
                  <input value={ov?.start ?? b.start} disabled={!on}
                    onChange={(e) => setOv(b.id, { start: e.target.value })} />
                </label>
                <label>for
                  <input type="number" min={0} value={Number(ov?.minutes ?? b.minutes)} disabled={!on}
                    onChange={(e) => setOv(b.id, { minutes: Number(e.target.value) || 0 })} />
                  min
                </label>
                <label className="checkline">
                  <input type="checkbox" checked={Boolean(ov?.unpaid ?? b.unpaid)} disabled={!on}
                    onChange={(e) => setOv(b.id, { unpaid: e.target.checked })} />
                  unpaid
                </label>
                {(ov?.start !== undefined || ov?.minutes !== undefined || ov?.unpaid !== undefined) && (
                  <button className="plink" onClick={() => setOv(b.id, { start: undefined, minutes: undefined, unpaid: undefined })}>
                    reset to account time
                  </button>
                )}
              </div>
            );
          })}
          <small>
            Set the standard times in Admin Settings → Scope. Changes here affect only this schedule, and a break is
            skipped when it falls outside the shift.
          </small>
        </div>
      )}
    </div>
  );
}

const DAYS_UI = [
  ["S", "Sunday"], ["M", "Monday"], ["T", "Tuesday"], ["W", "Wednesday"],
  ["T", "Thursday"], ["F", "Friday"], ["S", "Saturday"]
] as const;

/**
 * Day bubbles + shift hours + the Scope break schedule this crew follows —
 * the three things the Client Schedule Export prints in the template's
 * header (Days: / Hours: / Break: / Lunch:). Josh, 2026-09-03.
 */
function ClientRow({ sched, rules, commit }: {
  sched: ClassicSchedule;
  rules: Rules;
  commit: (mut: (d: ClassicData) => void) => void;
}) {
  const patch = (mut: (t: ClassicSchedule) => void) => commit((d) => {
    const t = (d.v7.schedules ?? []).find((x) => x.id === sched.id);
    if (t) mut(t);
  });
  const days = sched.days ?? [];
  return (
    <div className="clientrow">
      <span className="daypills">
        {DAYS_UI.map(([letter, full], i) => (
          <button key={full} className={"daypill" + (days.includes(i) ? " on" : "")}
            aria-label={full} title={full}
            onClick={() => patch((t) => {
              const cur = new Set(t.days ?? []);
              if (cur.has(i)) cur.delete(i); else cur.add(i);
              t.days = [...cur].sort((a, b) => a - b);
            })}>{letter}</button>
        ))}
      </span>
      <label className="clienthours">hours
        <input type="time" value={String(sched.hoursStart ?? "")}
          onChange={(e) => patch((t) => { t.hoursStart = e.target.value || undefined; })} />
        –
        <input type="time" value={String(sched.hoursEnd ?? "")}
          onChange={(e) => patch((t) => { t.hoursEnd = e.target.value || undefined; })} />
      </label>
      <label className="clientbreaks">break schedule
        <select value={String(sched.breakScheduleId ?? "")}
          onChange={(e) => patch((t) => { t.breakScheduleId = e.target.value || undefined; })}>
          <option value="">— pick one (set up in Scope) —</option>
          {(rules.breakSchedules ?? []).map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
      </label>
    </div>
  );
}

// ── Scope tab: the rulebook, plain and quiet (reworked 2026-08-28) ──────────
// Josh's rules: no explainer prose, each section saves ITSELF (a Save button
// per section, drafts never leak between them), everything is deletable —
// built-ins included — breaks live at the bottom, and the general cleaning
// formula is the account administrator's alone (2026-10-12: each room type's
// General Clean formula — editing it is the admin's; names, frequency and
// extras are anyone's).

/** a number box that keeps what's typed ("0.5" survives) while the stored value follows */
function NumBox({ value, onValue, disabled }: { value: number; onValue: (n: number) => void; disabled?: boolean }) {
  const show = (v: number) => (v > 0 ? String(v) : "");
  const [text, setText] = useState(show(value));
  useEffect(() => {
    if (Math.abs((parseFloat(text) || 0) - value) > 1e-6) setText(show(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input type="number" min={0} step="any" value={text} disabled={disabled}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseFloat(e.target.value);
        onValue(Number.isFinite(n) && n > 0 ? n : 0);
      }} />
  );
}

const METHOD_WORDS: Record<GcMethod, string> = {
  size: "by size",
  fixed: "fixed minutes per room",
  both: "fixed minutes + size"
};

/**
 * One room type's card (Josh, 2026-10-12): its General Clean formula —
 * "General Clean = [fixed min] + sq ft ÷ [rate] [unit]" typed exactly as a
 * hospital gives it — a live example, Reset to ISSA, the tasks General Clean
 * already includes, the automatic extras, and its own Save. A room that
 * differs gets its own type: Duplicate, rename, adjust.
 */
function RoomTypeCard({ rt, draft, edit, editAll, isAdmin, sampleSqft, conflicts, dirty, nameTaken, autoFocusName,
  onSave, onDuplicate, onDelete, onCleanIncluded }: {
  rt: RoomTypeRule;
  draft: Rules;
  edit: (mut: (t: RoomTypeRule) => void) => void;
  editAll: (mut: (r: Rules) => void) => void;
  isAdmin: boolean;
  sampleSqft: { sqft: number; fromRooms: boolean };
  conflicts: number;
  dirty: boolean;
  nameTaken: boolean;
  autoFocusName: boolean;
  onSave: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onCleanIncluded: () => void;
}) {
  const f = gcFormula(draft, rt);
  const included = includedTasksFor(draft, rt.id);
  const issa = issaSourceLabel(draft, rt);
  const cat = categoryFor(draft, rt);
  const times = f.rateUnit === "minPer100" || f.rateUnit === "minPer1000";
  // every edit writes the whole formula, so an older type becomes explicit
  const setF = (patch: Partial<GcFormula>) => edit((t) => {
    const cur = gcFormula(draft, t);
    const next = { ...cur, ...patch };
    t.method = next.method; t.fixedMin = next.fixedMin; t.sqftPerHour = next.sqftPerHour; t.rateUnit = next.rateUnit;
    delete t.qualifierMin;
  });
  const example = gcMinutes(f, sampleSqft.sqft);
  const extras = draft.tasks.filter((t) => t.addable && !included.includes(t.id));
  return (
    <div className="gccard">
      <div className="gchead">
        <input type="text" className="gcname" value={rt.label} autoFocus={autoFocusName}
          onChange={(e) => edit((t) => { t.label = e.target.value; })} />
        <select value={rt.frequency} onChange={(e) => edit((t) => { t.frequency = e.target.value; })}>
          {FREQUENCIES.map((x) => <option key={x}>{x}</option>)}
        </select>
        <span className="gcsrc">{issa ?? "your formula"}</span>
        <span className="gcgrow" />
        <button className="pbtn small" onClick={onDuplicate}>Duplicate type</button>
        <button className="pbtn small danger" onClick={onDelete}>✕</button>
      </div>
      {(rt.cleanedOn || rt.beyondGeneral) && (
        <p className="gcnote">
          {rt.cleanedOn ? `Cleaned on ${rt.cleanedOn}` : ""}
          {rt.cleanedOn && rt.beyondGeneral ? " · " : ""}
          {rt.beyondGeneral ? "Needs more than the general clean — add its extras below" : ""}
        </p>
      )}

      <div className="gcformula">
        <select value={f.method} disabled={!isAdmin}
          onChange={(e) => {
            const method = e.target.value as GcMethod;
            setF({
              method,
              fixedMin: method !== "size" && !(f.fixedMin > 0) ? 10 : f.fixedMin,
              sqftPerHour: method !== "fixed" && !(f.sqftPerHour > 0) ? (cat?.sqftPerHour ?? 2150) : f.sqftPerHour
            });
          }}>
          {(Object.keys(METHOD_WORDS) as GcMethod[]).map((m) => <option key={m} value={m}>Timed {METHOD_WORDS[m]}</option>)}
        </select>
        <span className="gceq">
          <b>General Clean =</b>
          {f.method !== "size" && (<>
            <NumBox value={f.fixedMin} disabled={!isAdmin} onValue={(n) => setF({ fixedMin: n })} /> min per room
          </>)}
          {f.method === "both" && <b>+</b>}
          {f.method !== "fixed" && (<>
            sq ft {times ? "×" : "÷"}
            <NumBox value={rateInUnit(f.sqftPerHour, f.rateUnit)} disabled={!isAdmin}
              onValue={(n) => setF({ sqftPerHour: rateFromUnit(n, f.rateUnit) })} />
            <select value={f.rateUnit} disabled={!isAdmin} onChange={(e) => setF({ rateUnit: e.target.value as RateUnit })}>
              {RATE_UNITS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
            </select>
          </>)}
        </span>
      </div>

      <div className="gcexample">
        {sampleSqft.fromRooms ? "Your typical " : "A "}{Math.round(sampleSqft.sqft).toLocaleString()} sq ft {rt.label || "room"}
        {" = "}<b>{(Math.round(example * 10) / 10).toLocaleString()} min</b>
        {isAdmin && (
          <span className="gcissa">
            ISSA match
            <select value={cat?.id ?? ""} onChange={(e) => edit((t) => resetToIssa(draft, t, e.target.value))}>
              {!cat && <option value="">—</option>}
              {ISSA_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label} — {c.sqftPerHour.toLocaleString()} sq ft/hr</option>)}
            </select>
            <button className="pbtn small" disabled={Boolean(issa)} onClick={() => edit((t) => resetToIssa(draft, t))}>Reset to ISSA</button>
          </span>
        )}
      </div>

      <div className="gcrow">
        <span className="gclabel">Included in General Clean</span>
        <span className="ptasks inline">
          {draft.tasks.filter((t) => t.addable && !t.floorCare).map((t) => {
            const on = included.includes(t.id);
            return (
              <button key={t.id} className={"ptask sm" + (on ? " on" : "")} disabled={!isAdmin}
                onClick={() => editAll((r) => {
                  const type = r.roomTypes.find((x) => x.id === rt.id)!;
                  const list = includedTasksFor(r, rt.id);
                  type.includedTasks = on ? list.filter((x) => x !== t.id) : [...list, t.id];
                  // included work can't also be an automatic extra here
                  if (!on) {
                    const task = r.tasks.find((x) => x.id === t.id)!;
                    task.autoFor = task.autoFor.filter((x) => x !== rt.id);
                  }
                })}>
                {on ? "✓ " : ""}{t.label}
              </button>
            );
          })}
        </span>
      </div>

      <div className="gcrow">
        <span className="gclabel">Extras every {rt.label || "room"} gets</span>
        <span className="ptasks inline">
          {extras.filter((t) => (t.autoFor ?? []).includes(rt.id)).map((t) => (
            <span key={t.id} className={"ptask sm on" + (t.floorCare ? " fc" : "")}>
              {t.label}
              {/* how often it runs on this type, when that isn't every clean (an intake's floor care) */}
              <select className="chipfreq" value={t.frequencyFor?.[rt.id] ?? ""} aria-label={`How often: ${t.label}`}
                onChange={(e) => editAll((r) => {
                  const task = r.tasks.find((x) => x.id === t.id)!;
                  const map = { ...(task.frequencyFor ?? {}) };
                  if (e.target.value) map[rt.id] = e.target.value; else delete map[rt.id];
                  if (Object.keys(map).length) task.frequencyFor = map; else delete task.frequencyFor;
                })}>
                <option value="">every clean</option>
                {FREQUENCIES.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <button className="chipx" onClick={() => editAll((r) => {
                const task = r.tasks.find((x) => x.id === t.id)!;
                task.autoFor = task.autoFor.filter((x) => x !== rt.id);
                if (task.frequencyFor?.[rt.id]) {
                  const map = { ...task.frequencyFor };
                  delete map[rt.id];
                  if (Object.keys(map).length) task.frequencyFor = map; else delete task.frequencyFor;
                }
              })}>✕</button>
            </span>
          ))}
          {extras.some((t) => !(t.autoFor ?? []).includes(rt.id)) && (
            <select className="chipadd" value="" onChange={(e) => {
              const id = e.target.value;
              if (!id) return;
              editAll((r) => {
                const task = r.tasks.find((x) => x.id === id)!;
                if (!task.autoFor.includes(rt.id)) task.autoFor = [...task.autoFor, rt.id];
              });
            }}>
              <option value="">＋ extra…</option>
              {extras.filter((t) => !(t.autoFor ?? []).includes(rt.id))
                .map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          )}
        </span>
      </div>

      {conflicts > 0 && (
        <p className="warntext">
          ⚠ {conflicts} {conflicts === 1 ? "room still lists" : "rooms still list"} a task this General Clean includes — it adds no time there.{" "}
          <button className="plink" onClick={onCleanIncluded}>Take it off {conflicts === 1 ? "that room" : "those rooms"}</button>
        </p>
      )}
      {nameTaken && <p className="warntext">⚠ Another room type already has this name.</p>}
      {dirty && (
        <div className="scopesave">
          <button className="pbtn primary" disabled={!rt.label.trim() || nameTaken} onClick={onSave}>
            Save {rt.label.trim() || "room type"}
          </button>
        </div>
      )}
    </div>
  );
}

function ScopeTab({ rules, onChange, onCleanIncluded, data, isAdmin }: {
  rules: Rules;
  onChange: (r: Rules) => void;
  onCleanIncluded: () => void;
  data: ClassicData;
  isAdmin: boolean;
}) {
  const [draft, setDraft] = useState<Rules>(() => JSON.parse(JSON.stringify(rules)));
  const [newType, setNewType] = useState({ label: "", freq: "7x / week", cat: "office" });
  const [focusType, setFocusType] = useState<string | null>(null);
  const [newTask, setNewTask] = useState({ label: "", per: "", flat: "", floorCare: false });
  const [newNS, setNewNS] = useState({ label: "", hours: "30" });
  const [newQual, setNewQual] = useState({ label: "", minutes: "5" });
  const [newBreak, setNewBreak] = useState({ label: "", start: "", minutes: "15" });
  const set = (mut: (r: Rules) => void) => setDraft((prev) => {
    const n: Rules = JSON.parse(JSON.stringify(prev));
    mut(n);
    return n;
  });

  // the live example on each card: the median size of that type's rooms
  const byType = useMemo(() => {
    const sizes = new Map<string, number[]>();
    const conflicts = new Map<string, number>();
    for (const sp of data.v7.spaces ?? []) {
      const tid = typeIdFromLabelStrict(rules, String(sp.roomType ?? ""));
      if (!tid) continue;
      if (Number(sp.squareFeet) > 0) sizes.set(tid, [...(sizes.get(tid) ?? []), Number(sp.squareFeet)]);
      if (includedConflicts(rules, sp).length) conflicts.set(tid, (conflicts.get(tid) ?? 0) + 1);
    }
    const median = new Map<string, number>();
    for (const [tid, list] of sizes) {
      const s = [...list].sort((a, b) => a - b);
      const m = s.length >> 1;
      median.set(tid, s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
    }
    return { median, conflicts };
  }, [data, rules]);

  const SectionSave = ({ sec }: { sec: ScopeSection }) => {
    const dirty = sectionDirty(rules, draft, sec);
    return (
      <div className="scopesave">
        <button className={"pbtn" + (dirty ? " primary" : "")} disabled={!dirty}
          onClick={() => onChange(saveSection(rules, draft, sec))}>
          {dirty ? "Save changes" : "✓ Saved"}
        </button>
      </div>
    );
  };

  return (
    <div className="pro-list">
      {rules.general.formulaOff && (
        <p className="warntext">
          ⚠ General Clean was deleted — room times only count their extra tasks now. {isAdmin && (
            <button className="plink" onClick={() => {
              const next: Rules = JSON.parse(JSON.stringify(rules));
              next.general.formulaOff = false;
              setDraft((prev) => { const d: Rules = JSON.parse(JSON.stringify(prev)); d.general.formulaOff = false; return d; });
              onChange(next);
            }}>Restore General Clean</button>
          )}
        </p>
      )}

      {isAdmin && (
        <IntakeSetup rules={rules} onApply={(next) => {
          onChange(next);
          setDraft(JSON.parse(JSON.stringify(next)));
        }} />
      )}
      {rules.intake && <IntakeProfileCard profile={rules.intake} />}

      <h3>Room types</h3>
      {draft.roomTypes.map((rt) => {
        const norm = (s: string) => s.trim().toLowerCase();
        const nameTaken = draft.roomTypes.some((x) => x.id !== rt.id && norm(x.label) === norm(rt.label));
        const median = byType.median.get(rt.id);
        return (
          <RoomTypeCard key={rt.id} rt={rt} draft={draft} isAdmin={isAdmin}
            edit={(mut) => set((r) => mut(r.roomTypes.find((x) => x.id === rt.id)!))}
            editAll={set}
            sampleSqft={median ? { sqft: median, fromRooms: true } : { sqft: 150, fromRooms: false }}
            conflicts={byType.conflicts.get(rt.id) ?? 0}
            dirty={roomTypeDirty(rules, draft, rt.id)}
            nameTaken={nameTaken}
            autoFocusName={focusType === rt.id}
            onSave={() => onChange(saveRoomType(rules, draft, rt.id))}
            onCleanIncluded={onCleanIncluded}
            onDuplicate={() => {
              const id = uid("rt");
              set((r) => {
                const at = r.roomTypes.findIndex((x) => x.id === rt.id);
                const src = r.roomTypes[at];
                const f = gcFormula(r, src);
                const copy: RoomTypeRule = {
                  ...JSON.parse(JSON.stringify(src)), id, label: `${src.label} (copy)`,
                  method: f.method, fixedMin: f.fixedMin, sqftPerHour: f.sqftPerHour, rateUnit: f.rateUnit,
                  includedTasks: [...includedTasksFor(r, src.id)]
                };
                delete copy.builtIn;
                delete copy.qualifierMin;
                r.roomTypes.splice(at + 1, 0, copy);
                for (const t of r.tasks) if ((t.autoFor ?? []).includes(src.id)) t.autoFor = [...t.autoFor, id];
              });
              setFocusType(id);
            }}
            onDelete={() => {
              if (!confirm(`Delete room type "${rt.label}"? Rooms of this type keep their label but show as Needs review until you pick a new type. Takes effect when you hit Save changes below.`)) return;
              set((r) => { r.roomTypes = r.roomTypes.filter((x) => x.id !== rt.id); });
            }} />
        );
      })}
      <div className="prule add">
        <input placeholder="New room type name" value={newType.label}
          onChange={(e) => setNewType({ ...newType, label: e.target.value })} />
        <select value={newType.freq} onChange={(e) => setNewType({ ...newType, freq: e.target.value })}>
          {FREQUENCIES.map((f) => <option key={f}>{f}</option>)}
        </select>
        <select value={newType.cat} onChange={(e) => setNewType({ ...newType, cat: e.target.value })}>
          {ISSA_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>ISSA {c.label} — {c.sqftPerHour.toLocaleString()} sq ft/hr</option>
          ))}
        </select>
        <button className="pbtn small primary" onClick={() => {
          if (!newType.label.trim()) return;
          set((r) => {
            const t: RoomTypeRule = {
              id: uid("rt"), label: newType.label.trim(), frequency: newType.freq,
              includedTasks: [...DEFAULT_INCLUDED_TASKS]
            };
            resetToIssa(r, t, newType.cat);
            r.roomTypes.push(t);
          });
          setNewType({ label: "", freq: "7x / week", cat: "office" });
        }}>Add room type</button>
      </div>
      <SectionSave sec="roomTypes" />

      <h3>Space tasks <small className="scopekey"><i className="keydot clean" /> cleaning · <i className="keydot fc" /> floor care</small></h3>
      {/* General Clean lives here too (Josh, 2026-08-31): it's the account
          formula wearing a task's clothes, so it's visible — and deletable,
          past a very loud warning */}
      {!rules.general.formulaOff && (
        <div className="prule">
          <b className="tname clean">General Clean</b>
          <span>on every room automatically — timed by its room type's formula (Room types, above)</span>
          {isAdmin && (
            <button className="pbtn small danger" onClick={() => {
              if (!confirm("Delete General Clean? This is the general cleaning formula — without it, room times stop counting the base clean entirely and only count added tasks and type minutes. Nothing will calculate correctly unless you restore it or build a replacement per-square-foot task. Are you sure?")) return;
              const next: Rules = JSON.parse(JSON.stringify(rules));
              next.general.formulaOff = true;
              setDraft((prev) => { const d: Rules = JSON.parse(JSON.stringify(prev)); d.general.formulaOff = true; return d; });
              onChange(next);
            }}>✕</button>
          )}
        </div>
      )}
      {draft.tasks.map((t) => (
        <div key={t.id} className="prule">
          <b className={"tname " + (t.floorCare ? "fc" : "clean")}>{t.label}</b>
          {t.sqftPerMin !== null ? (
            <span>1 min per <input type="number" value={t.sqftPerMin}
              onChange={(e) => set((r) => { r.tasks.find((x) => x.id === t.id)!.sqftPerMin = Number(e.target.value) || 1; })} /> sq ft</span>
          ) : (
            <span><input type="number" value={t.flatMin}
              onChange={(e) => set((r) => { r.tasks.find((x) => x.id === t.id)!.flatMin = Number(e.target.value) || 0; })} /> min flat</span>
          )}
          {/* the toggle that decides WHERE this task is scheduled */}
          <button className={"ptask sm" + (t.floorCare ? " on fc" : "")}
            title="Floor-care tasks can only be scheduled in Max Floor Care; everything else schedules in Max Schedules"
            onClick={() => set((r) => { const x = r.tasks.find((y) => y.id === t.id)!; x.floorCare = !x.floorCare; })}>
            Floor care only
          </button>
          <button className="pbtn small danger" onClick={() => {
            if (!confirm(`Delete the task "${t.label}"? It comes off every room and schedule that uses it${t.floorCare ? ", and out of Max Floor Care" : ""}. Takes effect when you hit Save.`)) return;
            set((r) => { r.tasks = r.tasks.filter((x) => x.id !== t.id); });
          }}>✕</button>
          {/* the floor trigger (Josh, 2026-10-12): rooms with these floors get
              this task automatically, the way room types get theirs */}
          <div className="pfloorrule">
            <span>Automatic on every room with</span>
            {FLOOR_KINDS.map((f) => {
              const on = (t.autoForFloor ?? []).includes(f.id);
              return (
                <button key={f.id} className={"ptask sm" + (on ? " on" : "")}
                  onClick={() => set((r) => {
                    const x = r.tasks.find((y) => y.id === t.id)!;
                    x.autoForFloor = on ? (x.autoForFloor ?? []).filter((k) => k !== f.id) : [...(x.autoForFloor ?? []), f.id];
                  })}>
                  {f.label}
                </button>
              );
            })}
            {(t.autoForFloor ?? []).length > 0 && (<>
              <span>except</span>
              {(t.floorSkipTypes ?? []).map((typeId) => (
                <span key={typeId} className="ptask sm on">
                  {draft.roomTypes.find((rt) => rt.id === typeId)?.label ?? typeId}
                  <button className="chipx" aria-label="Stop skipping this room type"
                    onClick={() => set((r) => {
                      const x = r.tasks.find((y) => y.id === t.id)!;
                      x.floorSkipTypes = (x.floorSkipTypes ?? []).filter((k) => k !== typeId);
                    })}>✕</button>
                </span>
              ))}
              <select className="chipadd" value="" onChange={(e) => {
                const typeId = e.target.value;
                if (!typeId) return;
                set((r) => {
                  const x = r.tasks.find((y) => y.id === t.id)!;
                  x.floorSkipTypes = [...(x.floorSkipTypes ?? []), typeId];
                });
              }}>
                <option value="">＋ skip a room type…</option>
                {draft.roomTypes.filter((rt) => !(t.floorSkipTypes ?? []).includes(rt.id))
                  .map((rt) => <option key={rt.id} value={rt.id}>{rt.label}</option>)}
              </select>
              <span>how often</span>
              <select className="chipadd" value={t.frequency ?? ""} aria-label={`How often: ${t.label}`}
                onChange={(e) => set((r) => {
                  const x = r.tasks.find((y) => y.id === t.id)!;
                  if (e.target.value) x.frequency = e.target.value; else delete x.frequency;
                })}>
                <option value="">every clean</option>
                {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </>)}
            {taskSourceLabel(t) && <span className="gcsrc">Rate: {taskSourceLabel(t)}</span>}
          </div>
        </div>
      ))}
      <div className="prule add">
        <input placeholder="New space task name" value={newTask.label}
          onChange={(e) => setNewTask({ ...newTask, label: e.target.value })} />
        <input type="number" placeholder="1 min per __ sq ft" value={newTask.per}
          onChange={(e) => setNewTask({ ...newTask, per: e.target.value, flat: "" })} />
        <input type="number" placeholder="or flat min" value={newTask.flat}
          onChange={(e) => setNewTask({ ...newTask, flat: e.target.value, per: "" })} />
        <label className="checkline">
          <input type="checkbox" checked={newTask.floorCare}
            onChange={(e) => setNewTask({ ...newTask, floorCare: e.target.checked })} />
          <span>Floor care — schedules only in Max Floor Care</span>
        </label>
        <button className="pbtn small primary" onClick={() => {
          if (!newTask.label.trim()) return;
          set((r) => r.tasks.push({
            id: uid("task"), label: newTask.label.trim(),
            sqftPerMin: newTask.per ? Number(newTask.per) : null,
            flatMin: newTask.flat ? Number(newTask.flat) : 0,
            autoFor: [], addable: true,
            ...(newTask.floorCare ? { floorCare: true } : {})
          }));
          setNewTask({ label: "", per: "", flat: "", floorCare: false });
        }}>Create space task</button>
      </div>
      <SectionSave sec="tasks" />

      <h3>Non-space tasks</h3>
      <p className="pnote">
        Work that isn't a room: priced per occurrence, plus any qualifiers attached. Schedules
        pick these up in Max Schedules — choose the task and how many (5 discharges = 5 × the
        minutes below, qualifiers included).
      </p>
      {draft.nonSpaceDefs.map((ns) => {
        const active = data.nonSpace.filter((t) => t.defId === ns.id || t.name === ns.label);
        return (
          <div key={ns.id} className="prule">
            <b>◇ {ns.label}</b>
            <span><input type="number" min={0} value={ns.minutes}
              onChange={(e) => set((r) => { r.nonSpaceDefs.find((x) => x.id === ns.id)!.minutes = Number(e.target.value) || 0; })} /> min each</span>
            <span className="ptasks inline">
              {(ns.qualifierIds ?? []).map((qid) => {
                const q = (draft.nonSpaceQualifiers ?? []).find((x) => x.id === qid);
                if (!q) return null;
                return (
                  <span key={qid} className="ptask sm on">
                    {q.label} +{q.minutes}m
                    <button className="chipx" title={"Detach " + q.label}
                      onClick={() => set((r) => {
                        const d = r.nonSpaceDefs.find((x) => x.id === ns.id)!;
                        d.qualifierIds = (d.qualifierIds ?? []).filter((x) => x !== qid);
                      })}>✕</button>
                  </span>
                );
              })}
              {(draft.nonSpaceQualifiers ?? []).some((q) => !(ns.qualifierIds ?? []).includes(q.id)) && (
                <select className="chipadd" value="" onChange={(e) => {
                  const qid = e.target.value;
                  if (!qid) return;
                  set((r) => {
                    const d = r.nonSpaceDefs.find((x) => x.id === ns.id)!;
                    d.qualifierIds = [...(d.qualifierIds ?? []), qid];
                  });
                }}>
                  <option value="">＋ qualifier…</option>
                  {(draft.nonSpaceQualifiers ?? []).filter((q) => !(ns.qualifierIds ?? []).includes(q.id))
                    .map((q) => <option key={q.id} value={q.id}>{q.label} (+{q.minutes}m)</option>)}
                </select>
              )}
            </span>
            {/* when in the shift: start/end duties print as the first/last stops */}
            <select value={ns.position ?? "anytime"} title="When in the shift this happens"
              onChange={(e) => set((r) => { r.nonSpaceDefs.find((x) => x.id === ns.id)!.position = e.target.value as DutyPosition; })}>
              <option value="anytime">Any time (ongoing duty)</option>
              <option value="start">Start of shift (first stop)</option>
              <option value="end">End of shift (last stop)</option>
            </select>
            <em>{active.length ? `on ${active.length} schedule(s)` : "not on a schedule yet"}</em>
            <button className="pbtn small danger" onClick={() => {
              if (!confirm(`Delete "${ns.label}"? Takes effect when you hit Save.`)) return;
              set((r) => { r.nonSpaceDefs = r.nonSpaceDefs.filter((x) => x.id !== ns.id); });
            }}>✕</button>
          </div>
        );
      })}
      <div className="prule add">
        <input placeholder="New non-space task (e.g. Evening Trash Route)" value={newNS.label}
          onChange={(e) => setNewNS({ ...newNS, label: e.target.value })} />
        <input type="number" placeholder="min each" value={newNS.hours} style={{ width: 90 }}
          onChange={(e) => setNewNS({ ...newNS, hours: e.target.value })} />
        <button className="pbtn small primary" onClick={() => {
          if (!newNS.label.trim()) return;
          const mins = Number(newNS.hours) || 30;
          set((r) => r.nonSpaceDefs.push({
            id: uid("ns"), label: newNS.label.trim(),
            defaultHours: Math.round((mins / 60) * 100) / 100, minutes: mins, qualifierIds: []
          }));
          setNewNS({ label: "", hours: "30" });
        }}>Create non-space task</button>
      </div>

      <h4 className="scopesub">Non-space task qualifiers</h4>
      <p className="pnote">
        Per-occurrence add-ons any non-space task can carry. Travel time is built in — there is
        no published industry standard for travel between discharges, so the 5-minute default is
        an honest starting point. Edit it to match your building.
      </p>
      {(draft.nonSpaceQualifiers ?? []).map((q) => (
        <div key={q.id} className="prule">
          <b>◈ {q.label}</b>
          <span><input type="number" min={0} value={q.minutes}
            onChange={(e) => set((r) => { r.nonSpaceQualifiers.find((x) => x.id === q.id)!.minutes = Number(e.target.value) || 0; })} /> min per occurrence</span>
          <em>{draft.nonSpaceDefs.filter((d) => (d.qualifierIds ?? []).includes(q.id)).map((d) => d.label).join(", ") || "not attached yet"}</em>
          <button className="pbtn small danger" onClick={() => {
            if (!confirm(`Delete the qualifier "${q.label}"? It detaches from every non-space task. Takes effect when you hit Save.`)) return;
            set((r) => {
              r.nonSpaceQualifiers = r.nonSpaceQualifiers.filter((x) => x.id !== q.id);
              for (const d of r.nonSpaceDefs) d.qualifierIds = (d.qualifierIds ?? []).filter((x) => x !== q.id);
            });
          }}>✕</button>
        </div>
      ))}
      <div className="prule add">
        <input placeholder="New qualifier (e.g. Cart restock)" value={newQual.label}
          onChange={(e) => setNewQual({ ...newQual, label: e.target.value })} />
        <input type="number" placeholder="min" value={newQual.minutes} style={{ width: 80 }}
          onChange={(e) => setNewQual({ ...newQual, minutes: e.target.value })} />
        <button className="pbtn small primary" onClick={() => {
          if (!newQual.label.trim()) return;
          set((r) => r.nonSpaceQualifiers.push({ id: uid("nsq"), label: newQual.label.trim(), minutes: Number(newQual.minutes) || 0 }));
          setNewQual({ label: "", minutes: "5" });
        }}>Add qualifier</button>
      </div>
      <SectionSave sec="nonSpace" />

      <h3>Cleaning procedure</h3>
      <p className="pnote">
        The steps every room is cleaned in, printed above the room list on each schedule.
        {draft.procedure.example && " These are an EXAMPLE and print labeled as one — edit them into your facility's own steps."}
      </p>
      <label className="checkline">
        <input type="checkbox" checked={draft.procedure.show}
          onChange={(e) => set((r) => { r.procedure.show = e.target.checked; })} />
        <span>Print the procedure on schedules</span>
      </label>
      {draft.procedure.steps.map((s, i) => {
        const edit = (mut: (st: ProcedureStep) => void) => set((r) => { mut(r.procedure.steps[i]); r.procedure.example = false; });
        const move = (d: number) => set((r) => {
          const st = r.procedure.steps;
          if (i + d < 0 || i + d >= st.length) return;
          [st[i], st[i + d]] = [st[i + d], st[i]];
          r.procedure.example = false;
        });
        return (
          <div key={i} className="prule">
            <b>{i + 1}.</b>
            <input value={s.title} placeholder="Step" style={{ width: 170 }}
              onChange={(e) => edit((st) => { st.title = e.target.value; })} />
            <input value={s.detail ?? ""} placeholder="How (optional)" style={{ flex: 1, minWidth: 220 }}
              onChange={(e) => edit((st) => { st.detail = e.target.value; })} />
            <button className="pbtn small" disabled={i === 0} title="Move up" onClick={() => move(-1)}>↑</button>
            <button className="pbtn small" disabled={i === draft.procedure.steps.length - 1} title="Move down" onClick={() => move(1)}>↓</button>
            <button className="pbtn small danger" onClick={() => set((r) => {
              r.procedure.steps.splice(i, 1);
              r.procedure.example = false;
            })}>✕</button>
          </div>
        );
      })}
      <div className="prule add">
        <button className="pbtn small primary" onClick={() => set((r) => {
          r.procedure.steps.push({ title: "", detail: "" });
          r.procedure.example = false;
        })}>Add step</button>
        {!draft.procedure.example && (
          <button className="pbtn small" onClick={() => {
            if (!confirm("Replace these steps with the example procedure? Takes effect when you hit Save.")) return;
            set((r) => { r.procedure = { ...exampleProcedure(), show: r.procedure.show }; });
          }}>Use the example steps</button>
        )}
      </div>
      <SectionSave sec="procedure" />

      <h3>Break and lunch times</h3>
      {(draft.breaks ?? []).map((b) => (
        <div key={b.id} className="prule">
          <b>{b.label}</b>
          <span>starts at <input value={b.start} style={{ width: 92 }}
            onChange={(e) => set((r) => { r.breaks.find((x) => x.id === b.id)!.start = e.target.value; })} /></span>
          <span>for <input type="number" min={0} value={b.minutes} style={{ width: 64 }}
            onChange={(e) => set((r) => { r.breaks.find((x) => x.id === b.id)!.minutes = Number(e.target.value) || 0; })} /> min</span>
          {/* unpaid breaks lengthen the day instead of coming out of the paid shift */}
          <label className="checkline" title="Unpaid: added on to the shift (8 paid hours + an unpaid 30-min lunch = 7:00 AM – 3:30 PM)">
            <input type="checkbox" checked={Boolean(b.unpaid)}
              onChange={(e) => set((r) => { r.breaks.find((x) => x.id === b.id)!.unpaid = e.target.checked; })} />
            <span>Unpaid</span>
          </label>
          {parseClock(b.start) === null && <em>⚠ write the time like 12:30 PM</em>}
          <button className="pbtn small danger" onClick={() => set((r) => { r.breaks = r.breaks.filter((x) => x.id !== b.id); })}>✕</button>
        </div>
      ))}
      <div className="prule add">
        <input placeholder="New break name (e.g. Second Lunch)" value={newBreak.label}
          onChange={(e) => setNewBreak({ ...newBreak, label: e.target.value })} />
        <input placeholder="starts at, e.g. 6:00 PM" value={newBreak.start} style={{ width: 130 }}
          onChange={(e) => setNewBreak({ ...newBreak, start: e.target.value })} />
        <input type="number" placeholder="min" value={newBreak.minutes} style={{ width: 76 }}
          onChange={(e) => setNewBreak({ ...newBreak, minutes: e.target.value })} />
        <button className="pbtn small primary" onClick={() => {
          if (!newBreak.label.trim() || parseClock(newBreak.start) === null) return;
          set((r) => r.breaks.push({
            id: uid("brk"), label: newBreak.label.trim(),
            start: newBreak.start.trim(), minutes: Number(newBreak.minutes) || 0
          }));
          setNewBreak({ label: "", start: "", minutes: "15" });
        }}>Add break</button>
      </div>

      <h3>Break schedules</h3>
      {(draft.breakSchedules ?? []).map((bs) => (
        <div key={bs.id} className="prule bsched">
          <input className="bsname" value={bs.label}
            onChange={(e) => set((r) => { r.breakSchedules.find((x) => x.id === bs.id)!.label = e.target.value; })} />
          {bs.windows.map((w, wi) => (
            <span key={wi} className="bswin">
              <select value={w.kind}
                onChange={(e) => set((r) => { r.breakSchedules.find((x) => x.id === bs.id)!.windows[wi].kind = e.target.value as "break" | "lunch"; })}>
                <option value="break">Break</option><option value="lunch">Lunch</option>
              </select>
              <input type="time" value={w.start}
                onChange={(e) => set((r) => { r.breakSchedules.find((x) => x.id === bs.id)!.windows[wi].start = e.target.value; })} />
              <input type="number" min={5} value={w.minutes} style={{ width: 60 }}
                onChange={(e) => set((r) => { r.breakSchedules.find((x) => x.id === bs.id)!.windows[wi].minutes = Number(e.target.value) || 0; })} /> min
              <label className="checkline" title="Unpaid — the export marks it (unpaid)">
                <input type="checkbox" checked={Boolean(w.unpaid)}
                  onChange={(e) => set((r) => { r.breakSchedules.find((x) => x.id === bs.id)!.windows[wi].unpaid = e.target.checked; })} />
                <span>unpaid</span>
              </label>
              <button className="plink" onClick={() => set((r) => {
                const t = r.breakSchedules.find((x) => x.id === bs.id)!;
                t.windows = t.windows.filter((_, j) => j !== wi);
              })}>✕</button>
            </span>
          ))}
          <button className="pbtn small" onClick={() => set((r) => {
            r.breakSchedules.find((x) => x.id === bs.id)!.windows.push({ kind: "break", start: "14:00", minutes: 15 });
          })}>+ Break</button>
          <button className="pbtn small" onClick={() => set((r) => {
            r.breakSchedules.find((x) => x.id === bs.id)!.windows.push({ kind: "lunch", start: "12:00", minutes: 30 });
          })}>+ Lunch</button>
          <button className="pbtn small danger" onClick={() => set((r) => {
            r.breakSchedules = r.breakSchedules.filter((x) => x.id !== bs.id);
          })}>✕</button>
        </div>
      ))}
      <div className="prule add">
        <button className="pbtn small primary" onClick={() => set((r) => {
          const letter = String.fromCharCode(65 + ((r.breakSchedules ?? []).length % 26));
          r.breakSchedules = [...(r.breakSchedules ?? []), {
            id: uid("bs"), label: `Break Schedule ${letter}`,
            windows: [
              { kind: "break", start: "09:00", minutes: 15 },
              { kind: "lunch", start: "11:15", minutes: 45 }
            ]
          }];
        })}>Add break schedule</button>
      </div>
      <SectionSave sec="breaks" />

      {isAdmin && (
        <button className="pbtn" onClick={() => {
          if (!confirm("Reset EVERYTHING in Scope to the packaged healthcare standards? All sections, saved immediately.")) return;
          const fresh = defaultRules();
          setDraft(JSON.parse(JSON.stringify(fresh)));
          onChange(fresh);
        }}>Reset to healthcare standards</button>
      )}

      <BackupCard />
    </div>
  );
}

// ── data backup: download / restore the whole workspace as one file ─────────
// Until the shared backend is live this is the ONLY backup that exists —
// browser data is one "Clear browsing data" away from gone. The file never
// contains the API key (workspaceStore strips it), and restoring keeps the
// device's own key.
function BackupCard() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState("");
  return (
    <div className="prule-block backupcard">
      <h3>Data backup</h3>
      <p className="pnote">
        Everything OpsMatrix knows — rooms, plans, schedules, rules, floor care — saved as one
        file you keep. Your API key is never included. Restore replaces what's on this device.
      </p>
      <div className="prow">
        <button className="pbtn primary" onClick={() => {
          const snap = collectWorkspace((k) => localStorage.getItem(k));
          const blob = new Blob([JSON.stringify(snap)], { type: "application/json" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = backupFilename();
          a.click();
          URL.revokeObjectURL(a.href);
          setMsg("✓ Backup downloaded — keep it somewhere safe (email it to yourself, or a USB stick).");
        }}>💾 Download backup</button>
        <button className="pbtn" onClick={() => fileRef.current?.click()}>Restore from a backup…</button>
        <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: "none" }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              const snap = JSON.parse(await f.text());
              const when = String(snap?.exportedAt ?? "").slice(0, 10) || "an unknown date";
              if (!confirm(`Replace everything on this device with the backup from ${when}? This cannot be undone.`)) return;
              const skipped: string[] = [];
              applyWorkspace(snap, (k) => localStorage.getItem(k), (k, v) => localStorage.setItem(k, v), skipped);
              setMsg(skipped.length
                ? "✓ Backup restored — your floors, rooms and schedules are all in. This device didn't have room for the editable copies of the floor pictures. Reloading…"
                : "✓ Backup restored — reloading…");
              reloadWhenSaved(skipped.length ? 3500 : 600);
            } catch (err) {
              setMsg("⚠ " + String((err as Error)?.message ?? err));
            }
          }} />
      </div>
      {msg && <p className={msg.startsWith("⚠") ? "warntext" : "pnote keysaved"}>{msg}</p>}
    </div>
  );
}

// ── on-screen quick report: what's not assigned anywhere ────────────────────

function ReportModal({ data, rules, spaces, schedules, onClose, onJump }: {
  data: ClassicData;
  rules: Rules;
  spaces: ClassicSpace[];
  schedules: ClassicSchedule[];
  onClose: () => void;
  onJump: (spaceId: string) => void;
}) {
  const rows = spaces.map((sp) => ({ sp, un: uncovered(data, rules, sp) }))
    .filter((r) => r.un.baseUncovered || r.un.tasks.length > 0);
  return (
    <div className="pro-modalback" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pro-modal">
        <div className="pshead"><h2>⚠ Unassigned tasks</h2>
          <button className="pbtn ghost" onClick={onClose}>✕</button></div>
        {rows.length === 0 ? (
          <p className="pnote big">✓ Every room's tasks are covered by a schedule. Nothing is falling through the cracks.</p>
        ) : (
          <>
            <p className="pnote">{rows.length} room{rows.length > 1 ? "s" : ""} with work nobody is scheduled to do. Click one to fix it on the map.</p>
            {rows.map(({ sp, un }) => (
              <button key={sp.id} className="reportrow" onClick={() => onJump(sp.id)}>
                <b>{sp.roomNumber || sp.roomName}</b>
                <span>
                  {[un.baseUncovered ? "General Clean" : "", ...un.tasks.map((t) =>
                    (rules.tasks.find((x) => x.id === t)?.label ?? t) +
                    (isFloorCareTask(rules, t) ? " (Max Floor Care)" : ""))]
                    .filter(Boolean).join(", ")}
                </span>
              </button>
            ))}
          </>
        )}
        <p className="pnote">{schedules.length} schedules · {spaces.length} rooms checked</p>
      </div>
    </div>
  );
}

// ── the persistent left menu (Josh, 2026-08-31) ─────────────────────────────
// Every Max destination, on every hub screen — classic.html keeps its own
// sidebar, and this rail is its twin, so navigation never dead-ends.

// monochrome 16px line icons (mockup language: clean glyphs, never emoji)
const NAV_PATHS: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5M5.5 9v11h13V9M10 20v-6h4v6",
  layers: "M12 3 3 8l9 5 9-5-9-5ZM3 12.5l9 5 9-5M3 17l9 5 9-5",
  calendar: "M4 5.5h16v15H4zM4 10h16M8 3v4M16 3v4",
  machine: "M17 3l-6 8M5 16a5 5 0 0 0 10 0 5 5 0 0 0-10 0ZM3 22h18",
  cart: "M3 5h3l2 10h10M8 8h12l-1.5 7M10 19.5a1.5 1.5 0 1 0 .01 0M17 19.5a1.5 1.5 0 1 0 .01 0",
  bell: "M5 17h14M6.5 17a5.5 5.5 0 0 1 11 0M12 6.5v-1M4 20h16",
  caldays: "M4 5.5h16v15H4zM4 10h16M8 3v4M16 3v4M8 13.5h.01M12 13.5h.01M16 13.5h.01M8 17h.01M12 17h.01",
  note: "M6 3h9l4 4v14H6zM14.5 3v4.5H19M9 12h6M9 16h6",
  users: "M9 11a3.5 3.5 0 1 0-.01 0ZM3 20a6 6 0 0 1 12 0M16.5 11.5a3 3 0 1 0-.01 0M15.5 15.7a5.6 5.6 0 0 1 5.5 4.3",
  chart: "M4 20V4M4 20h16M8 16v-5M12 16V7M16 16v-8M20 16V11",
  compass: "M12 21a9 9 0 1 0-.01 0ZM15.5 8.5l-2 5-5 2 2-5 5-2Z",
  exporting: "M12 15V4M8 8l4-4 4 4M5 15v5h14v-5",
  inspect: "M12 21a9 9 0 1 0-.01 0ZM8.5 12l2.5 2.5 4.5-5",
  clipboard: "M9 4h6v3H9zM9 4H6.5v17h11V4H15M9 11h6M9 15h6",
  report: "M5 3h10l4 4v14H5zM15 3v4h4M9 17v-4M12 17v-7M15 17v-2",
  gear: "M12 15.2a3.2 3.2 0 1 0-.01 0ZM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2Z"
};

function NavIcon({ k }: { k: string }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={NAV_PATHS[k]} />
    </svg>
  );
}

function SideNav({ tab, go }: { tab: Tab; go: (token: string) => void }) {
  const items: { ico: string; label: string; token: string; on?: boolean }[] = [
    { ico: "home", label: "Dashboard", token: "classic:Dashboard" },
    { ico: "layers", label: "Max Space", token: "hub:spaces/explorer", on: tab === "spaces" },
    { ico: "calendar", label: "Max Schedules", token: "hub:map", on: tab === "map" || tab === "rooms" || tab === "schedules" },
    { ico: "machine", label: "Max Floor Care", token: "hub:floorcare", on: tab === "floorcare" },
    { ico: "cart", label: "Max Sanitation", token: "hub:sanitation", on: tab === "sanitation" },
    { ico: "bell", label: "Max Policing", token: "hub:policing", on: tab === "policing" },
    { ico: "caldays", label: "Max Calendar", token: "classic:Max Calendar" },
    { ico: "inspect", label: "Max Inspections", token: "classic:Max Inspections" },
    { ico: "clipboard", label: "Max Logs", token: "classic:Max Logs" },
    { ico: "report", label: "Max Reports", token: "classic:Max Reports" },
    { ico: "note", label: "Max Notes", token: "classic:Max Notes" },
    { ico: "users", label: "Max Team", token: "classic:Max Team" },
    { ico: "chart", label: "Workload Intelligence", token: "hub:workload", on: tab === "workload" },
    { ico: "compass", label: "Scope", token: "hub:scope", on: tab === "scope" },
    { ico: "exporting", label: "Exporting", token: "hub:exporting", on: tab === "exporting" },
    { ico: "gear", label: "Admin Settings", token: "classic:Admin Settings" }
  ];
  return (
    <aside className="pro-sidenav">
      {/* the brand tile — classic's sidebar identity, mirrored exactly */}
      <div className="pro-sidebrand">
        <i className="brandmark" aria-hidden="true">✻</i>
        <span className="brandtext"><b>Ops<span>Matrix</span></b><small>powered by Max</small></span>
      </div>
      <div className="pro-sidenavscroll">
        {items.map((it) => (
          <button key={it.label} className={it.on ? "on" : ""} onClick={() => go(it.token)}>
            <i className="navico"><NavIcon k={it.ico} /></i><span className="navlbl">{it.label}</span>
          </button>
        ))}
      </div>
      {/* Ask Max lives in classic (the Hey Max bubble) — one tap away */}
      <button className="askmax" onClick={() => go("classic:Dashboard")}>
        <i aria-hidden="true">✻</i>
        <span className="navlbl"><b>Ask Max</b><small>Your operations copilot</small></span>
        <em className="navlbl">AI</em>
      </button>
      <div className="sideversion navlbl">OpsMatrix · Max Schedules hub</div>
    </aside>
  );
}
