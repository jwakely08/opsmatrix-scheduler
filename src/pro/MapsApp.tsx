import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  loadClassic, saveClassic, syncSpaceMinutes, refreshAutoTasks, coverageForSpace, uncovered, setCoverage,
  coverageMinutes, scheduleMinutes, createSchedule, deleteSchedule, scheduleColor,
  spaceIncomplete, FLOOR_TYPES, rectifyForDisplay, pathFrom, centroidOf, boundsOf, pointIn,
  moveInSchedule, spacePriority, PRIORITIES,
  type ClassicData, type ClassicSpace, type ClassicSchedule, type NonSpaceTask
} from "./classicStore";
import { PrintSchedule } from "./PrintSchedule";
import { AiPlanImport } from "./AiPlanImport";
import { WorkloadApp, ImportResult } from "./WorkloadApp";
import { FloorCareApp, HoursBar } from "./FloorCareApp";
import { buildScheduleDoc, parseClock, type SchedBreak } from "./scheduleDoc";
import { importScan } from "../bridge/fusionEntry";
import {
  attachPlanToRooms, resolvePendingRoomTypes, loadAliases,
  importRoomListIntoStorage, type ImportSummary
} from "./roomListImport";
import { fileToSheets, isSpreadsheet } from "./sheetFile";
import {
  loadRules, saveRules, defaultRules, computeMinutes, requiredTasks, autoTasksFor,
  typeIdFromLabel, isCarpet, FREQUENCIES, type Rules
} from "./rules";

const WALL_STROKE = 13;
const GRAY = "#64748b";
const RED = "#dc2626";

function uid(p: string) { return p + "-" + Math.random().toString(36).slice(2, 9); }

type Tab = "map" | "schedules" | "spaces" | "scope" | "workload" | "floorcare";

export function MapsApp() {
  const [data, setData] = useState<ClassicData>(() => loadClassic());
  const [rules, setRules] = useState<Rules>(() => loadRules());
  // #scope = the Admin Settings → Scope manager; #spaces = Max Space's own
  // Map View; #workload = Admin Settings → Workload Intelligence. None is a
  // Max Schedules tab — the hub itself is Map + Schedules.
  const scopeOnly = window.location.hash === "#scope";
  const spacesOnly = window.location.hash === "#spaces";
  const workloadOnly = window.location.hash === "#workload";
  const floorcareOnly = window.location.hash.indexOf("#floorcare") === 0;
  const [tab, setTab] = useState<Tab>(() =>
    scopeOnly ? "scope" : spacesOnly ? "spaces" : workloadOnly ? "workload" : floorcareOnly ? "floorcare" : "map");
  const [roomSel, setRoomSel] = useState<string | null>(null);
  const [schedSel, setSchedSel] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [report, setReport] = useState(false);
  const [planId, setPlanId] = useState<string | null>(null);
  const [printId, setPrintId] = useState<string | null>(null);

  const plans = data.plans;
  const plan = plans.find((p) => p.id === planId) ?? plans[0] ?? null;
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
      // recalculate every room's minutes under the new rules
      resolvePendingRoomTypes((d.v7.spaces ?? []) as never, next, loadAliases());
      refreshAutoTasks(d.v7.spaces ?? [], prev, next);
      for (const sp of d.v7.spaces ?? []) syncSpaceMinutes(sp, next);
    });
  }, [commit]);

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
          sp.spaceTasks = sp.fusionTasks ?? autoTasksFor(rules, typeIdFromLabel(rules, sp.roomType ?? ""));
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
    return true;
  }, [filters, rules, data, schedules]);

  const anyFilter = Object.values(filters).some(Boolean);

  return (
    <div className="pro-shell">
      <header className="pro-head">
        <a className="pbtn ghost" href="./classic.html">← OpsMatrix</a>
        {scopeOnly ? (
          <h1>Admin Settings — <span>Scope</span></h1>
        ) : workloadOnly ? (
          <h1>Workload <span>Intelligence</span></h1>
        ) : floorcareOnly ? (
          <h1>Max Floor <span>Care</span></h1>
        ) : spacesOnly ? (
          <h1>Max <span>Space</span> — Map View</h1>
        ) : (
          <>
            <h1>Max <span>Schedules</span></h1>
            <nav className="ptabs">
              {(["map", "schedules"] as Tab[]).map((t) => (
                <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                  {t === "map" ? "Map" : "Schedules"}
                </button>
              ))}
            </nav>
          </>
        )}
        <span className="grow" />
        {/* uploading lives in ONE place: Max Space's ⬆ Upload button — the
            same three options here as in Classic, nothing anywhere else */}
        {spacesOnly && <UploadHub commit={commit} rules={rules} />}
        {!scopeOnly && !spacesOnly && !workloadOnly && !floorcareOnly && (
          <button className="pbtn" onClick={() => setReport(true)}>⚠ Unassigned Tasks</button>
        )}
      </header>

      {(tab === "map" || tab === "spaces") && (
        <div className="pro-filters">
          {tab === "map" && <>
            <Sel label="Schedule" v={filters.schedule ?? ""} on={(v) => setFilters({ ...filters, schedule: v })}
              opts={schedules.map((s) => [s.id, `${s.num ?? ""} ${s.name ?? ""}`.trim()])} />
            <Sel label="Coverage" v={filters.coverage ?? ""} on={(v) => setFilters({ ...filters, coverage: v })}
              opts={[["unscheduled", "Unscheduled rooms"], ["untasked", "Has unscheduled tasks"]]} />
            <Sel label="Shift" v={filters.shift ?? ""} on={(v) => setFilters({ ...filters, shift: v })}
              opts={["1st Shift", "2nd Shift", "3rd Shift"].map((s) => [s, s])} />
          </>}
          <Sel label="Room type" v={filters.rtype ?? ""} on={(v) => setFilters({ ...filters, rtype: v })}
            opts={rules.roomTypes.map((rt) => [rt.id, rt.label])} />
          <Sel label="Task" v={filters.task ?? ""} on={(v) => setFilters({ ...filters, task: v })}
            opts={rules.tasks.map((t) => [t.id, t.label])} />
          {anyFilter && <button className="pbtn small" onClick={() => setFilters({})}>Clear</button>}
          {tab === "map" && schedSelected && (
            <span className="linkhint">
              ✏ Editing <b style={{ color: String(schedSelected.color) }}>{schedSelected.num} {schedSelected.name}</b> —
              click rooms to add/remove
              <button className="pbtn small primary" onClick={() => setSchedSel(null)}>Done</button>
            </span>
          )}
        </div>
      )}

      <div className="pro-main">
        {(tab === "map" || tab === "spaces") && plan && (
          <MapCanvas
            key={tab + (plan?.id ?? "")}
            plan={plan} plans={plans} onPlan={setPlanId}
            spaces={spaces} shapes={shapes}
            mode={tab}
            fillFor={(sp) => {
              if (tab === "spaces") {
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
            } : undefined}
            selectedId={roomSel}
            onRoom={(sp) => {
              if (!sp) { setRoomSel(null); return; }
              if (tab === "map" && schedSelected && schedSelected.floorCareId) {
                // floor-care schedules are edited in Max Floor Care only
                alert("This schedule was built in Max Floor Care — edit it there. (Schedules tab → Edit in Floor Care)");
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
                    // (any other schedule keeps only its extra tasks, e.g. high dusting)
                    const u = uncovered(d, rules, d.v7.spaces!.find((s) => s.id === sp.id)!);
                    setCoverage(d, sp.id, schedSelected.id, true, u.tasks);
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
              </div>
            ) : (
              <div className="pro-legend">
                <span><i style={{ background: "#475569" }} />Room data complete</span>
                <span><i style={{ background: RED }} />Needs attention</span>
              </div>
            )}
          />
        )}

        {(tab === "map" || tab === "spaces") && !plan && (
          <div className="pro-empty">
            <h2>No floor plan has been added{spaces.length ? " for these rooms" : " yet"}</h2>
            {spaces.length > 0 ? (
              <p>
                Your {spaces.length} imported room{spaces.length === 1 ? "" : "s"} are already
                working — in Max Space's list, on schedules, and in Workload Intelligence.
                A floor plan is optional: add one any time (a picture, PDF, or magicplan scan)
                and it attaches to these same rooms.
              </p>
            ) : tab === "spaces" ? (
              <p>Use the ⬆ Upload button above — a floor plan (picture or PDF), a room list, or a magicplan scan all get you started.</p>
            ) : (
              <p>Go to Max Space and use its ⬆ Upload button — a floor plan (picture or PDF), a room list, or a magicplan scan all get you started.</p>
            )}
            <a className="pbtn primary" href="./classic.html">← Back to OpsMatrix</a>
          </div>
        )}

        {tab === "map" && roomSelected && (
          <ScheduleRoomSidebar
            key={roomSelected.id}
            space={roomSelected} data={data} rules={rules} schedules={schedules}
            onClose={() => setRoomSel(null)}
            onEditSpace={() => setTab("spaces")}
            commit={commit}
          />
        )}

        {tab === "spaces" && roomSelected && (
          <SpaceSidebar
            key={roomSelected.id}
            space={roomSelected} rules={rules}
            onClose={() => setRoomSel(null)}
            onChange={(patch) => commit((d) => {
              const sp = (d.v7.spaces ?? []).find((s) => s.id === roomSelected.id)!;
              Object.assign(sp, patch);
              if (patch.roomType !== undefined && patch.spaceTasks === undefined) {
                sp.spaceTasks = autoTasksFor(rules, typeIdFromLabel(rules, String(patch.roomType)));
              }
              syncSpaceMinutes(sp, rules);
            })}
          />
        )}

        {tab === "schedules" && (
          <SchedulesTab data={data} rules={rules} schedules={schedules} employees={employees}
            commit={commit} onPrint={setPrintId}
            onOpenOnMap={(id) => { setSchedSel(id); setTab("map"); }} />
        )}

        {tab === "scope" && (
          <ScopeTab rules={rules} onChange={commitRules} data={data} commit={commit} schedules={schedules} />
        )}

        {tab === "workload" && (
          <WorkloadApp data={data} rules={rules} commit={commit} commitRules={commitRules} />
        )}

        {tab === "floorcare" && (
          <FloorCareApp data={data} rules={rules} commit={commit} />
        )}
      </div>

      {report && (
        <ReportModal data={data} rules={rules} spaces={spaces} schedules={schedules}
          onClose={() => setReport(false)}
          onJump={(id) => { setReport(false); setTab("map"); setRoomSel(id); }} />
      )}

      {printId && (
        <PrintPreview data={data} rules={rules} scheduleId={printId}
          onClose={() => setPrintId(null)} />
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
function UploadHub({ commit, rules }: {
  commit: (mut: (d: ClassicData) => void) => void;
  rules: Rules;
}) {
  const [chooser, setChooser] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
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
      window.location.reload();
    } catch (err) {
      alert("Could not read that scan: " + err);
    }
  };

  return (
    <>
      <button className="pbtn primary" onClick={() => setChooser(true)}>⬆ Upload</button>

      {chooser && (
        <div className="pro-modalback" onClick={(e) => { if (e.target === e.currentTarget) setChooser(false); }}>
          <div className="pro-modal">
            <div className="pshead"><h2>Upload space data</h2>
              <button className="pbtn ghost" onClick={() => setChooser(false)}>✕</button></div>
            <p className="pnote">Pick what you have — OpsMatrix knows what to do with each.</p>
            <button className="upltile" onClick={() => { setChooser(false); setPlanOpen(true); }}>
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
        </div>
      )}

      <AiPlanImport open={planOpen} onClose={() => setPlanOpen(false)}
        commit={commit} onImported={() => window.location.reload()} />

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

      {rlPhase !== "idle" && (
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
        </div>
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

// ── the map canvas (shared by Map + Spaces tabs) ────────────────────────────

function MapCanvas({ plan, plans, onPlan, spaces, shapes, fillFor, overlayFor, selectedId, onRoom, legend, mode }: {
  plan: NonNullable<ClassicData["plans"][0]>;
  plans: ClassicData["plans"];
  onPlan: (id: string) => void;
  spaces: ClassicSpace[];
  shapes: Map<string, { pts: { x: number; y: number }[]; path: string; c: { x: number; y: number } }>;
  fillFor: (sp: ClassicSpace) => string;
  /** second schedule's color → the room renders two-tone striped */
  overlayFor?: (sp: ClassicSpace) => string | null;
  selectedId: string | null;
  onRoom: (sp: ClassicSpace | null) => void;
  legend: React.ReactNode;
  mode: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  // sx/sy = where the gesture STARTED: a tap is judged by total travel from
  // there, not per-event deltas. A fingertip naturally wobbles a few pixels,
  // so touch gets a much bigger tap slop than a mouse — without this, real
  // thumbs "click" rooms and nothing happens.
  const drag = useRef({ x: 0, y: 0, sx: 0, sy: 0, moved: false, on: false, slop: 5 });
  // live pointers — two fingers on a phone means pinch-zoom, not a tap
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; cx: number; cy: number } | null>(null);

  const zoomAt = (sx: number, sy: number, factor: number) => {
    setView((v) => {
      const k2 = Math.max(0.2, Math.min(12, v.k * factor));
      const f = k2 / v.k;
      return { k: k2, tx: sx - (sx - v.tx) * f, ty: sy - (sy - v.ty) * f };
    });
  };
  const zoomCenter = (factor: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    zoomAt(svg.clientWidth / 2, svg.clientHeight / 2, factor);
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const fit = () => {
      const w = svg.clientWidth || 1000, h = svg.clientHeight || 640;
      const k = Math.min(w / plan.w, h / plan.h) * 0.94;
      setView({ k, tx: (w - plan.w * k) / 2, ty: (h - plan.h * k) / 2 });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(svg);
    return () => ro.disconnect();
  }, [plan]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      setView((v) => {
        const k2 = Math.max(0.2, Math.min(12, v.k * Math.exp(-e.deltaY * 0.0015)));
        const f = k2 / v.k;
        return { k: k2, tx: sx - (sx - v.tx) * f, ty: sy - (sy - v.ty) * f };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  function click(e: React.PointerEvent) {
    if (drag.current.moved) return;
    const svg = svgRef.current!;
    const r = svg.getBoundingClientRect();
    const x = (e.clientX - r.left - view.tx) / view.k;
    const y = (e.clientY - r.top - view.ty) / view.k;
    let hit: ClassicSpace | null = null;
    let hitArea = Infinity;
    for (const sp of spaces) {
      const sh = shapes.get(sp.id);
      if (!sh || !pointIn(sh.pts, x, y)) continue;
      const b = boundsOf(sh.pts);
      const area = (b.maxX - b.minX) * (b.maxY - b.minY);
      if (area < hitArea) { hit = sp; hitArea = area; }
    }
    onRoom(hit);
  }

  return (
    <div className="pro-mapwrap">
      <svg ref={svgRef} className="pro-map"
        onPointerDown={(e) => {
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* not capturable — fine */ }
          if (pointers.current.size === 2) {
            // second finger down → this gesture is a pinch, never a tap
            const [a, b] = [...pointers.current.values()];
            pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
            drag.current.on = false;
            drag.current.moved = true;
          } else {
            drag.current = {
              x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY,
              moved: false, on: true,
              slop: e.pointerType === "touch" ? 14 : 5
            };
          }
        }}
        onPointerMove={(e) => {
          if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pinch.current && pointers.current.size >= 2) {
            const [a, b] = [...pointers.current.values()];
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            if (dist > 0 && pinch.current.dist > 0) {
              const r = svgRef.current!.getBoundingClientRect();
              zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, dist / pinch.current.dist);
            }
            pinch.current.dist = dist;
            return;
          }
          if (!drag.current.on) return;
          const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
          const travel = Math.hypot(e.clientX - drag.current.sx, e.clientY - drag.current.sy);
          if (travel > drag.current.slop) drag.current.moved = true;
          if (drag.current.moved) {
            setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
            drag.current.x = e.clientX; drag.current.y = e.clientY;
          }
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
          drag.current.on = false;
          if (pointers.current.size === 0) {
            click(e);
            setTimeout(() => { drag.current.moved = false; }, 0);
          }
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
          drag.current.on = false;
        }}>
        <defs>
          {[...new Set(spaces.map((sp) => overlayFor?.(sp)).filter(Boolean) as string[])].map((c) => (
            <pattern key={c} id={"st-" + c.slice(1)} width="16" height="16"
              patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
              <rect width="8" height="16" fill={c} />
            </pattern>
          ))}
        </defs>
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
          {spaces.map((sp) => {
            const sh = shapes.get(sp.id);
            if (!sh) return null;
            const color = fillFor(sp);
            const overlay = overlayFor?.(sp) ?? null;
            return (
              <g key={sp.id} className={"proom" + (sp.id === selectedId ? " sel" : "") + (color === "#33404d" ? " dim" : "")}>
                <path d={sh.path} fill={color} stroke={color}
                  strokeWidth={WALL_STROKE} strokeLinejoin="round" />
                {overlay && (
                  <path d={sh.path} fill={"url(#st-" + overlay.slice(1) + ")"}
                    stroke="none" style={{ pointerEvents: "none", opacity: 0.8 }} />
                )}
              </g>
            );
          })}
          <image href={plan.img} width={plan.w} height={plan.h}
            style={{ mixBlendMode: "multiply", pointerEvents: "none" }} />
          {spaces.map((sp) => {
            const sh = shapes.get(sp.id);
            if (!sh) return null;
            const b = boundsOf(sh.pts);
            if ((b.maxX - b.minX) * view.k < 60) return null;
            const mins = Number(sp.estimatedCleaningMinutes) || 0;
            return (
              <g key={"l" + sp.id} className="prolabel" transform={`translate(${sh.c.x} ${sh.c.y}) scale(${1 / Math.max(0.6, view.k)})`}>
                <text y={-4}>{sp.roomNumber || sp.roomName}</text>
                <text className="sub" y={12}>{Math.round(Number(sp.squareFeet) || 0)} ft² · {mins}m</text>
              </g>
            );
          })}
        </g>
      </svg>
      {plans.length > 1 && (
        <div className="floorstack">
          {[...plans].reverse().map((p) => (
            <button key={p.id} className={"floorcard" + (p.id === plan.id ? " on" : "")}
              onClick={() => onPlan(p.id)}>
              <span>{p.floor ?? p.id}</span>
            </button>
          ))}
        </div>
      )}
      {legend}
      {/* touch-friendly zoom controls — pinch works too, but thumbs deserve buttons */}
      <div className="pro-zoomctl">
        <button aria-label="Zoom in" onClick={() => zoomCenter(1.35)}>＋</button>
        <button aria-label="Zoom out" onClick={() => zoomCenter(1 / 1.35)}>－</button>
        <button aria-label="Fit plan" onClick={() => {
          const svg = svgRef.current;
          if (!svg) return;
          const w = svg.clientWidth || 1000, h = svg.clientHeight || 640;
          const k = Math.min(w / plan.w, h / plan.h) * 0.94;
          setView({ k, tx: (w - plan.w * k) / 2, ty: (h - plan.h * k) / 2 });
        }}>⤢</button>
      </div>
    </div>
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
  const req = requiredTasks(rules, space);
  const freq = rules.roomTypes.find((r) => r.id === typeIdFromLabel(rules, space.roomType ?? ""))?.frequency;
  const [addOpen, setAddOpen] = useState(false);

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

      <div className="pfield"><span>This room needs</span>
        <div className="ptasks readonly">
          <span className="ptask locked">General Clean</span>
          {req.map((t) => {
            const covered = cov.some((c) => c.tasks.includes(t));
            return <span key={t} className={"ptask" + (covered ? " on" : " warn")}>
              {rules.tasks.find((x) => x.id === t)?.label ?? t}{covered ? "" : " ⚠"}
            </span>;
          })}
        </div>
        {(un.baseUncovered || un.tasks.length > 0) && (
          <small className="warntext">
            ⚠ Not yet on a schedule: {[un.baseUncovered ? "General Clean" : "", ...un.tasks.map((t) => rules.tasks.find((x) => x.id === t)?.label ?? t)].filter(Boolean).join(", ")}
          </small>
        )}
      </div>

      <div className="pfield"><span>Schedules covering this room</span></div>
      {cov.length === 0 && <p className="pnote">None yet — add one below.</p>}
      {cov.map((c) => {
        const sched = schedules.find((s) => s.id === c.scheduleId);
        if (!sched) return null;
        const mins = coverageMinutes(rules, space, c);
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
                    {rules.tasks.find((x) => x.id === t)?.label ?? t}
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

      {(() => {
        const available = schedules.filter((s) => !cov.some((c) => c.scheduleId === s.id));
        if (!available.length) return null;
        return (
          <div className="pfield big">
            {!addOpen ? (
              <button className="pbtn primary wide" onClick={() => setAddOpen(true)}>+ Add to schedule</button>
            ) : (
              <div className="addlist">
                <span>Tap a schedule — it's added instantly, then pick its tasks above:</span>
                {available.map((s) => (
                  <button key={s.id} className="addrow" style={{ borderLeftColor: String(s.color) }}
                    onClick={() => {
                      commit((d) => {
                        const hasPrimary = coverageForSpace(d, space.id).some((c) => c.primary);
                        const u = uncovered(d, rules, d.v7.spaces!.find((x) => x.id === space.id)!);
                        // instant add: base clean if unclaimed, else the leftover
                        // tasks — and even with nothing left, the row appears so
                        // tasks can be picked right here (keepEmpty)
                        setCoverage(d, space.id, s.id, !hasPrimary, hasPrimary ? u.tasks : req, true);
                      });
                      setAddOpen(false);
                    }}>
                    <i style={{ background: String(s.color) }} />
                    <b>{s.num} · {s.name}</b>
                    <em>{s.shift} · {s.employee || "unassigned"}</em>
                  </button>
                ))}
                <button className="pbtn small" onClick={() => setAddOpen(false)}>Cancel</button>
              </div>
            )}
            <small>First schedule gets General Clean automatically; extra schedules pick up remaining tasks (e.g. High Dusting for someone else). Rooms on two schedules show striped on the map.</small>
          </div>
        );
      })()}
    </aside>
  );
}

// ── Spaces tab sidebar: the room's OWN details + required tasks ─────────────

function SpaceSidebar({ space, rules, onClose, onChange }: {
  space: ClassicSpace;
  rules: Rules;
  onClose: () => void;
  onChange: (patch: Partial<ClassicSpace>) => void;
}) {
  const typeId = typeIdFromLabel(rules, space.roomType ?? "");
  const carpet = isCarpet(space.floorType);
  const req = requiredTasks(rules, space);
  const issues = spaceIncomplete(space);
  const breakdown = computeMinutes(rules, space);

  return (
    <aside className="pro-side">
      <div className="pshead">
        <h2>{space.roomNumber || space.roomName || "Room"}</h2>
        <button className="pbtn ghost" onClick={onClose}>✕</button>
      </div>
      {issues.length > 0 && <p className="warntext">⚠ Missing: {issues.join(", ")}</p>}

      <div className="prow">
        <label className="pfield">Room number
          <input value={String(space.roomNumber ?? "")} placeholder="e.g. 4E-102"
            onChange={(e) => onChange({ roomNumber: e.target.value })} />
        </label>
        <label className="pfield">Room name
          <input value={String(space.roomName ?? "")} placeholder="e.g. Patient Room"
            onChange={(e) => onChange({ roomName: e.target.value })} />
        </label>
      </div>
      <label className="pfield">Room type
        <select value={typeId} onChange={(e) => {
          const rt = rules.roomTypes.find((x) => x.id === e.target.value);
          onChange({ roomType: rt?.label ?? e.target.value });
        }}>
          {rules.roomTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.label} · {rt.frequency}</option>)}
        </select>
      </label>
      <div className="prow">
        <label className="pfield">Floor type
          <select value={space.floorType || ""}
            onChange={(e) => onChange({ floorType: e.target.value })}>
            <option value="">— pick floor type —</option>
            {FLOOR_TYPES.map((f) => <option key={f}>{f}</option>)}
          </select>
        </label>
        <label className="pfield">Square feet
          <input type="number" min={0} value={Number(space.squareFeet) || 0}
            onChange={(e) => onChange({ squareFeet: Number(e.target.value) || 0 })} />
        </label>
      </div>
      <div className="pfield"><span>How urgent is this room?</span>
        <div className="prio">
          {PRIORITIES.map((p) => (
            <button key={p} className={"priobtn " + p.toLowerCase() + (spacePriority(space) === p ? " on" : "")}
              onClick={() => onChange({ priority: p })}>{p}</button>
          ))}
        </div>
        <small>Prints on every schedule this room appears on, so the worker knows what cannot wait.</small>
      </div>

      <div className="prow">
        <label className="pfield">Fixtures
          <input type="number" min={0} value={Number(space.fixtureCount) || 0}
            onChange={(e) => onChange({ fixtureCount: Number(e.target.value) || 0 })} />
        </label>
        {carpet && (
          <label className="pfield accent">Vacuum days/week
            <input type="number" min={1} max={7} value={Number(space.vacuumDaysPerWeek) || 5}
              onChange={(e) => onChange({ vacuumDaysPerWeek: Math.max(1, Math.min(7, Number(e.target.value) || 5)) })} />
          </label>
        )}
      </div>

      <div className="pfield"><span>Tasks this room needs (General Clean is always included)</span>
        <div className="ptasks">
          <span className="ptask locked">General Clean</span>
          {rules.tasks.filter((t) => t.addable).map((t) => {
            const on = req.includes(t.id);
            const auto = t.autoFor.includes(typeId);
            return (
              <button key={t.id} className={"ptask" + (on ? " on" : "")}
                onClick={() => onChange({ spaceTasks: on ? req.filter((x) => x !== t.id) : [...req, t.id] })}>
                {t.label}{auto ? " •" : ""}
              </button>
            );
          })}
        </div>
        <small>• = automatic for this room type. Who does each task is decided on the Map tab — different tasks can go to different schedules.</small>
      </div>

      <div className="pbreak">
        <span>Full clean, all tasks</span>
        {breakdown.lines.map((l, i) => (
          <div key={i} className="pline"><em>{l.label}</em><b>{l.minutes.toFixed(1)}m</b></div>
        ))}
        <div className="pline total"><em>Total per visit</em><b>{breakdown.total} min</b></div>
      </div>
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
  const [draft, setDraft] = useState({ name: "", shift: "1st Shift", employeeId: "" });
  const spaces = data.v7.spaces ?? [];

  return (
    <div className="pro-list">
      <div className="prule add big">
        <input placeholder="New schedule name (e.g. East Wing — Daily)" value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <select value={draft.shift} onChange={(e) => setDraft({ ...draft, shift: e.target.value })}>
          <option>1st Shift</option><option>2nd Shift</option><option>3rd Shift</option>
        </select>
        <select value={draft.employeeId} onChange={(e) => setDraft({ ...draft, employeeId: e.target.value })}>
          <option value="">— assign later —</option>
          {(employees ?? []).map((e) => <option key={e.id} value={e.id}>{String(e.displayName ?? "")}</option>)}
        </select>
        <button className="pbtn primary" disabled={!draft.name.trim()} onClick={() => {
          commit((d) => { createSchedule(d, draft.name.trim(), draft.shift, draft.employeeId); });
          setDraft({ name: "", shift: "1st Shift", employeeId: "" });
        }}>Create schedule</button>
      </div>

      {schedules.map((s) => {
        const mins = Math.round(scheduleMinutes(data, rules, s));
        const target = (Number(s.targetHours) || 8) * 60;
        const members = (s.spaceOrder ?? [])
          .map((id) => spaces.find((sp) => sp.id === id))
          .filter(Boolean) as ClassicSpace[];
        const ns = data.nonSpace.filter((t) => t.scheduleId === s.id);
        return (
          <div key={s.id} className="schedcard" style={{ borderLeftColor: String(s.color) }}>
            <div className="schedhead">
              <b>{s.num} · {s.name}</b>
              <span>{s.shift} · {s.employee || "unassigned"}</span>
              <em className={mins > target ? "over" : ""}>{mins}m of {target}m</em>
              <HoursBar minutes={mins} />
              <span className="schedacts">
                <button className="pbtn small primary" onClick={() => onPrint(s.id)}>🖨 Print schedule</button>
                {s.floorCareId ? (
                  <a className="pbtn small" href={"./maps.html#floorcare?fc=" + s.floorCareId}>Edit in Floor Care</a>
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
            <div className="schedrooms">
              {members.length > 1 && (
                <p className="pnote" style={{ margin: "0 0 4px" }}>
                  Cleaned in this order — the order rooms were tapped. Use ↑ ↓ to fix a mis-tap.
                </p>
              )}
              {members.map((sp, i) => {
                const c = coverageForSpace(data, sp.id).find((x) => x.scheduleId === s.id)!;
                return (
                  <div key={sp.id} className="schedroom">
                    <span className="ordnum">{i + 1}</span>
                    <b>{sp.roomNumber}</b>
                    <span>{[c.primary ? "General Clean" : "", ...c.tasks.map((t) => rules.tasks.find((x) => x.id === t)?.label ?? t)].filter(Boolean).join(" + ") || "no tasks picked yet"}</span>
                    <em>{coverageMinutes(rules, sp, c)}m</em>
                    <span className="ordmove">
                      <button disabled={i === 0} title="Move earlier"
                        onClick={() => commit((d) => moveInSchedule(d, s.id, sp.id, -1))}>↑</button>
                      <button disabled={i === members.length - 1} title="Move later"
                        onClick={() => commit((d) => moveInSchedule(d, s.id, sp.id, 1))}>↓</button>
                    </span>
                  </div>
                );
              })}
              {ns.map((t) => (
                <div key={t.id} className="schedroom nonspace">
                  <b>◇ {t.name}</b>
                  <span>non-space task{t.roomIds.length ? ` · ${t.roomIds.length} linked rooms` : ""}</span>
                  <em>{Math.round(t.hours * 60)}m</em>
                </div>
              ))}
              {!members.length && !ns.length && <p className="pnote">Empty — click "Edit on map" and tap rooms to add them.</p>}
            </div>
          </div>
        );
      })}
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
    ? taken.map((b) => `${b.label} ${overrides.find((o) => o.id === b.id)?.start ?? b.start}`).join(" · ")
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
                {(ov?.start !== undefined || ov?.minutes !== undefined) && (
                  <button className="plink" onClick={() => setOv(b.id, { start: undefined, minutes: undefined })}>
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

// ── Scope tab: ultimate customization (room types, tasks, non-space) ────────

function ScopeTab({ rules, onChange, data, commit, schedules }: {
  rules: Rules;
  onChange: (r: Rules) => void;
  data: ClassicData;
  commit: (mut: (d: ClassicData) => void) => void;
  schedules: ClassicSchedule[];
}) {
  const [newType, setNewType] = useState({ label: "", freq: "7x / week", qual: "", tasks: [] as string[] });
  const [newTask, setNewTask] = useState({ label: "", per: "", flat: "" });
  const [newNS, setNewNS] = useState({ label: "", hours: "2" });
  const [newBreak, setNewBreak] = useState({ label: "", start: "", minutes: "15" });
  const set = (mut: (r: Rules) => void) => {
    const next: Rules = JSON.parse(JSON.stringify(rules));
    mut(next);
    onChange(next);
  };

  return (
    <div className="pro-list">
      <h3>The general cleaning formula (always applied to every room)</h3>
      <div className="pformula">
        1 minute per <input type="number" value={rules.general.hardSqftPerMin}
          onChange={(e) => set((r) => { r.general.hardSqftPerMin = Number(e.target.value) || 1; })} />
        sq ft on <b>hard floor</b> (mopping included) · 1 minute per <input type="number" value={rules.general.carpetSqftPerMin}
          onChange={(e) => set((r) => { r.general.carpetSqftPerMin = Number(e.target.value) || 1; })} />
        sq ft on <b>carpet</b> (vacuuming included)
      </div>
      <p className="pnote">Starting numbers follow standard healthcare (ISSA-style) production rates — adjust to your facility. Every change recalculates all rooms.</p>

      <h3>Room types — frequency and automatic tasks, all editable</h3>
      {rules.roomTypes.map((rt) => (
        <div key={rt.id} className="prule">
          <b>{rt.label}</b>
          <select value={rt.frequency}
            onChange={(e) => set((r) => { r.roomTypes.find((x) => x.id === rt.id)!.frequency = e.target.value; })}>
            {FREQUENCIES.map((f) => <option key={f}>{f}</option>)}
          </select>
          <span>+<input type="number" value={rt.qualifierMin}
            onChange={(e) => set((r) => { r.roomTypes.find((x) => x.id === rt.id)!.qualifierMin = Number(e.target.value) || 0; })} /> min</span>
          <span className="ptasks inline">
            <span className="ptask locked sm">General</span>
            {rules.tasks.filter((t) => t.addable).map((t) => {
              const on = t.autoFor.includes(rt.id);
              return (
                <button key={t.id} className={"ptask sm" + (on ? " on" : "")}
                  onClick={() => set((r) => {
                    const task = r.tasks.find((x) => x.id === t.id)!;
                    task.autoFor = on ? task.autoFor.filter((x) => x !== rt.id) : [...task.autoFor, rt.id];
                  })}>{t.label}</button>
              );
            })}
          </span>
          {!rt.builtIn && (
            <button className="pbtn small danger" onClick={() => set((r) => { r.roomTypes = r.roomTypes.filter((x) => x.id !== rt.id); })}>✕</button>
          )}
        </div>
      ))}
      <div className="prule add">
        <input placeholder="New room type name" value={newType.label}
          onChange={(e) => setNewType({ ...newType, label: e.target.value })} />
        <select value={newType.freq} onChange={(e) => setNewType({ ...newType, freq: e.target.value })}>
          {FREQUENCIES.map((f) => <option key={f}>{f}</option>)}
        </select>
        <input type="number" placeholder="+min" value={newType.qual} style={{ width: 70 }}
          onChange={(e) => setNewType({ ...newType, qual: e.target.value })} />
        <button className="pbtn small primary" onClick={() => {
          if (!newType.label.trim()) return;
          set((r) => r.roomTypes.push({
            id: uid("rt"), label: newType.label.trim(), frequency: newType.freq,
            qualifierMin: Number(newType.qual) || 0
          }));
          setNewType({ label: "", freq: "7x / week", qual: "", tasks: [] });
        }}>Add room type</button>
      </div>
      <p className="pnote">New room types always come with General Clean attached. Toggle which tasks auto-attach using the chips on each row.</p>

      <h3>Space tasks — work done inside rooms (each is a qualifier that adds time)</h3>
      {rules.tasks.map((t) => (
        <div key={t.id} className="prule">
          <b>{t.label}</b>
          {t.sqftPerMin !== null ? (
            <span>1 min per <input type="number" value={t.sqftPerMin}
              onChange={(e) => set((r) => { r.tasks.find((x) => x.id === t.id)!.sqftPerMin = Number(e.target.value) || 1; })} /> sq ft</span>
          ) : (
            <span><input type="number" value={t.flatMin}
              onChange={(e) => set((r) => { r.tasks.find((x) => x.id === t.id)!.flatMin = Number(e.target.value) || 0; })} /> min flat</span>
          )}
          <em>{t.autoFor.length ? "auto: " + t.autoFor.map((id) => rules.roomTypes.find((x) => x.id === id)?.label ?? id).join(", ") : "added per room"}</em>
          {!t.builtIn && (
            <button className="pbtn small danger" onClick={() => set((r) => { r.tasks = r.tasks.filter((x) => x.id !== t.id); })}>✕</button>
          )}
        </div>
      ))}
      <div className="prule add">
        <input placeholder="New space task name" value={newTask.label}
          onChange={(e) => setNewTask({ ...newTask, label: e.target.value })} />
        <input type="number" placeholder="1 min per __ sq ft" value={newTask.per}
          onChange={(e) => setNewTask({ ...newTask, per: e.target.value, flat: "" })} />
        <input type="number" placeholder="or flat min" value={newTask.flat}
          onChange={(e) => setNewTask({ ...newTask, flat: e.target.value, per: "" })} />
        <button className="pbtn small primary" onClick={() => {
          if (!newTask.label.trim()) return;
          set((r) => r.tasks.push({
            id: uid("task"), label: newTask.label.trim(),
            sqftPerMin: newTask.per ? Number(newTask.per) : null,
            flatMin: newTask.flat ? Number(newTask.flat) : 0,
            autoFor: [], addable: true
          }));
          setNewTask({ label: "", per: "", flat: "" });
        }}>Create space task</button>
      </div>

      <h3>Break and lunch times — used by every printed schedule</h3>
      {(rules.breaks ?? []).map((b) => (
        <div key={b.id} className="prule">
          <b>{b.label}</b>
          <span>starts at <input value={b.start} style={{ width: 92 }}
            onChange={(e) => set((r) => { r.breaks.find((x) => x.id === b.id)!.start = e.target.value; })} /></span>
          <span>for <input type="number" min={0} value={b.minutes} style={{ width: 64 }}
            onChange={(e) => set((r) => { r.breaks.find((x) => x.id === b.id)!.minutes = Number(e.target.value) || 0; })} /> min</span>
          <em>{parseClock(b.start) === null ? "⚠ write the time like 12:30 PM" : "on schedules whose shift covers it"}</em>
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
      <p className="pnote">
        A schedule only takes the breaks that fall inside its own shift, so day-shift lunches never land on a night sheet.
        Any single schedule can move, shorten or skip one on the Schedules tab. The clock on the printed schedule stops for
        these, so the times a worker reads are real.
      </p>

      <h3>Non-space tasks — discharges, sanitation routes, day porters</h3>
      {rules.nonSpaceDefs.map((ns) => {
        const active = data.nonSpace.filter((t) => t.name === ns.label);
        return (
          <div key={ns.id} className="prule">
            <b>◇ {ns.label}</b>
            <span><input type="number" step={0.5} value={ns.defaultHours}
              onChange={(e) => set((r) => { r.nonSpaceDefs.find((x) => x.id === ns.id)!.defaultHours = Number(e.target.value) || 0; })} /> h default</span>
            <select value="" onChange={(e) => {
              if (!e.target.value) return;
              commit((d) => d.nonSpace.push({
                id: uid("nst"), name: ns.label, hours: ns.defaultHours,
                scheduleId: e.target.value, roomIds: []
              }));
            }}>
              <option value="">+ add to schedule…</option>
              {schedules.map((s) => <option key={s.id} value={s.id}>{s.num} · {s.name}</option>)}
            </select>
            <em>{active.length ? `on ${active.length} schedule(s)` : "not scheduled yet"}</em>
            {!ns.builtIn && (
              <button className="pbtn small danger" onClick={() => set((r) => { r.nonSpaceDefs = r.nonSpaceDefs.filter((x) => x.id !== ns.id); })}>✕</button>
            )}
          </div>
        );
      })}
      <div className="prule add">
        <input placeholder="New non-space task (e.g. Evening Trash Route)" value={newNS.label}
          onChange={(e) => setNewNS({ ...newNS, label: e.target.value })} />
        <input type="number" step={0.5} placeholder="hours" value={newNS.hours} style={{ width: 80 }}
          onChange={(e) => setNewNS({ ...newNS, hours: e.target.value })} />
        <button className="pbtn small primary" onClick={() => {
          if (!newNS.label.trim()) return;
          set((r) => r.nonSpaceDefs.push({ id: uid("ns"), label: newNS.label.trim(), defaultHours: Number(newNS.hours) || 0 }));
          setNewNS({ label: "", hours: "2" });
        }}>Create non-space task</button>
      </div>
      <p className="pnote">Assigned non-space tasks show on the schedule's card and count toward its hours. Linking rooms to them (like a sanitation route) is optional — do it from the schedule card on the map.</p>

      <button className="pbtn" onClick={() => onChange(defaultRules())}>Reset to healthcare standards</button>
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
                  {[un.baseUncovered ? "General Clean" : "", ...un.tasks.map((t) => rules.tasks.find((x) => x.id === t)?.label ?? t)]
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
