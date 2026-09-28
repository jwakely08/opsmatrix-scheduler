// Max Schedules → Matrix (Josh, 2026-09-27): every schedule as one colored
// block, recolorable by load / shift / department / worker. Click a block →
// the schedule opens in the side panel with its rooms, its load against
// target, and a same-shift rebalance hint. Logic: scheduleMatrix.ts.
import React, { useMemo, useState } from "react";
import {
  scheduleMinutes, coverageForSpace, coverageMinutes, nonSpaceTaskMinutes,
  type ClassicData, type ClassicSchedule, type ClassicSpace
} from "./classicStore";
import { deptColorMap, colorForDept } from "./departments";
import {
  LOAD_BANDS, SHIFT_STYLES, loadBand, loadPct, shiftKey, shiftStyle, sortItems, summarize,
  rebalanceHint, type MatrixItem, type MatrixSort
} from "./scheduleMatrix";
import type { Rules } from "./rules";

type ColorMode = "load" | "shift" | "dept" | "worker";

const MODES: [ColorMode, string][] = [["load", "Load"], ["shift", "Shift"], ["dept", "Department"], ["worker", "Worker"]];
const SORTS: [MatrixSort, string][] = [["num", "Number"], ["load", "Load"], ["shift", "Shift"]];
const NO_DEPT = "#64748b";
const ASSIGNED = "#2dd4bf";
const UNASSIGNED = "#f59e0b";

interface Row extends MatrixItem {
  sched: ClassicSchedule;
  dept: string;
  worker: string;
  roomMinutes: number;
  otherMinutes: number;
}

export function ScheduleMatrix({ data, rules, schedules, onOpenOnMap, onPrint, onOpenList }: {
  data: ClassicData;
  rules: Rules;
  schedules: ClassicSchedule[];
  onOpenOnMap: (id: string) => void;
  onPrint: (id: string) => void;
  onOpenList: () => void;
}) {
  const [mode, setMode] = useState<ColorMode>("load");
  const [sort, setSort] = useState<MatrixSort>("num");
  const [selId, setSelId] = useState<string>("");

  const deptMap = useMemo(() => deptColorMap(data), [data]);

  const rows: Row[] = useMemo(() => {
    const spaces = data.v7.spaces ?? [];
    const byId = new Map(spaces.map((sp) => [sp.id, sp] as [string, ClassicSpace]));
    return schedules.map((s) => {
      const minutes = Math.round(scheduleMinutes(data, rules, s));
      const target = (Number(s.targetHours) || 8) * 60;
      const routeStops = s.routeOnly ? ((s.routeStopMinutes as Record<string, number> | undefined) ?? {}) : null;
      const deptMins = new Map<string, number>();
      const rooms: Row["rooms"] = [];
      for (const id of s.spaceOrder ?? []) {
        const sp = byId.get(id);
        if (!sp) continue;
        let m = 0;
        if (routeStops) m = Math.round(Number(routeStops[id]) || 0);
        else {
          const c = coverageForSpace(data, id).find((x) => x.scheduleId === s.id);
          if (!c) continue;
          m = Math.round(coverageMinutes(rules, sp, c));
        }
        const label = String(sp.roomNumber ?? "").trim() || String(sp.roomName ?? "").trim() || "Room";
        rooms.push({ id, label, minutes: m });
        const d = String(sp.department ?? "").trim();
        if (d) deptMins.set(d, (deptMins.get(d) ?? 0) + Math.max(1, m));
      }
      const otherMinutes = Math.round(
        data.nonSpace.filter((t) => t.scheduleId === s.id).reduce((a, t) => a + nonSpaceTaskMinutes(t), 0));
      const dept = [...deptMins.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
      const lockedTo = s.floorCareId ? "Max Floor Care" : s.sanitationId ? "Max Sanitation"
        : s.policingId ? "Max Policing" : undefined;
      return {
        id: s.id, num: String(s.num ?? "").trim(), name: String(s.name ?? "").trim(),
        shift: shiftKey(s.shift), minutes, target, lockedTo, rooms,
        sched: s, dept, worker: String(s.employee ?? "").trim(),
        roomMinutes: rooms.reduce((a, r) => a + r.minutes, 0), otherMinutes
      };
    });
  }, [data, rules, schedules]);

  const sorted = useMemo(() => sortItems(rows, sort), [rows, sort]);
  const summary = useMemo(() => summarize(rows, rules.general.productiveMinutes), [rows, rules]);
  const sel = rows.find((r) => r.id === selId) ?? sorted[0];

  const fillFor = (r: Row): string => {
    if (mode === "load") return loadBand(loadPct(r)).color;
    if (mode === "shift") return shiftStyle(r.sched.shift).color;
    if (mode === "dept") return colorForDept(r.dept, deptMap) ?? NO_DEPT;
    return r.worker ? ASSIGNED : UNASSIGNED;
  };
  const captionFor = (r: Row): string => {
    const pct = loadPct(r);
    if (mode === "load") return `${r.minutes}m · ${pct}%`;
    if (mode === "shift") return shiftStyle(r.sched.shift).label;
    if (mode === "dept") return r.dept || "No department";
    return r.worker || "Unassigned";
  };

  const legend: { label: string; color: string }[] = (() => {
    if (mode === "load") return LOAD_BANDS.map((b) => ({ label: `${b.label} (${b.range})`, color: b.color }));
    if (mode === "shift") {
      const present = new Set(rows.map((r) => r.shift));
      return SHIFT_STYLES.filter((s) => s.key !== "other" || present.has("other"))
        .map((s) => ({ label: s.label, color: s.color }));
    }
    if (mode === "dept") {
      const depts = [...new Set(rows.map((r) => r.dept).filter(Boolean))].sort();
      const out = depts.map((d) => ({ label: d, color: colorForDept(d, deptMap) ?? NO_DEPT }));
      if (rows.some((r) => !r.dept)) out.push({ label: "No department", color: NO_DEPT });
      return out;
    }
    return [{ label: "Worker assigned", color: ASSIGNED }, { label: "Unassigned", color: UNASSIGNED }];
  })();

  if (!rows.length) {
    return (
      <div className="mx-wrap">
        <div className="mx-empty">
          <b>No schedules yet.</b>
          <span>Create your first schedule and it shows up here as a block.</span>
          <button className="pbtn primary" onClick={onOpenList}>Go to Schedules</button>
        </div>
      </div>
    );
  }

  const selPct = sel ? loadPct(sel) : 0;
  const selBand = loadBand(selPct);
  const selShift = sel ? shiftStyle(sel.sched.shift) : SHIFT_STYLES[4];

  return (
    <div className="mx-wrap">
      <div className="mx-toolbar">
        <div className="mx-group" role="group" aria-label="Color the blocks by">
          <span className="mx-lbl">Color by</span>
          <div className="mx-seg">
            {MODES.map(([k, label]) => (
              <button key={k} className={mode === k ? "on" : ""} aria-pressed={mode === k} onClick={() => setMode(k)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="mx-group" role="group" aria-label="Sort the blocks by">
          <span className="mx-lbl">Sort</span>
          <div className="mx-seg">
            {SORTS.map(([k, label]) => (
              <button key={k} className={sort === k ? "on" : ""} aria-pressed={sort === k} onClick={() => setSort(k)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="mx-legend">
          {legend.map((l) => (
            <span key={l.label}><i style={{ background: l.color }} />{l.label}</span>
          ))}
        </div>
      </div>

      <div className="mx-stats">
        <div><span>Schedules</span><b>{summary.count}<small> · {summary.fte} FTE</small></b></div>
        <div><span>Average load</span><b>{summary.avgPct}%<small> of target</small></b></div>
        <div className="on"><span>On target</span><b>{summary.on}</b></div>
        <div className="under"><span>Under-scheduled</span><b>{summary.under}</b></div>
        <div className="over"><span>Over-scheduled</span><b>{summary.over}</b></div>
      </div>

      <div className="mx-main">
        <div className="mx-gridcard">
          <p className="mx-hint">Tap a block to open that schedule.</p>
          <div className="mx-grid">
            {sorted.map((r) => {
              const pct = loadPct(r);
              const on = sel?.id === r.id;
              return (
                <button key={r.id} className={"mx-block" + (on ? " sel" : "")} style={{ background: fillFor(r) }}
                  aria-pressed={on}
                  aria-label={`Schedule ${r.num || r.name}, ${shiftStyle(r.sched.shift).label}, ${r.minutes} of ${r.target} minutes`}
                  onClick={() => setSelId(r.id)}>
                  <span className="mx-top">
                    <b>{r.num || r.name.slice(0, 6) || "—"}</b>
                    <em>{shiftStyle(r.sched.shift).short}</em>
                  </span>
                  <span className="mx-cap">{captionFor(r)}</span>
                  <span className="mx-bar"><i style={{ width: Math.min(100, pct / 1.4) + "%" }} /></span>
                </button>
              );
            })}
          </div>
        </div>

        {sel && (
          <aside className="mx-panel" key={sel.id}>
            <div className="mx-phead">
              <div>
                <span className="mx-lbl">Schedule</span>
                <div className="mx-pnum">{sel.num || "—"}</div>
                {sel.name && <div className="mx-pname">{sel.name}</div>}
              </div>
              <div className="mx-chips">
                <span style={{ background: selShift.color }}>{selShift.label}</span>
                <span style={{ background: selBand.color }}>{selBand.label}</span>
              </div>
            </div>
            <p className="mx-who">
              {sel.worker || "No worker assigned yet"}
              {sel.sched.hoursStart && sel.sched.hoursEnd ? ` · ${sel.sched.hoursStart}–${sel.sched.hoursEnd}` : ""}
              {sel.dept ? ` · ${sel.dept}` : ""}
            </p>

            <div className="mx-meter">
              <div className="mx-meterhead">
                <b>{sel.minutes}<small> of {sel.target} min</small></b>
                <b style={{ color: selBand.color }}>{selPct}%</b>
              </div>
              <div className="mx-track">
                <span className="mx-targetband" />
                <i style={{ width: Math.min(100, selPct / 1.4) + "%", background: selBand.color }} />
              </div>
              <div className="mx-scale"><span>0</span><span>green zone = 95–105% of target</span><span>140%</span></div>
            </div>

            <div className="mx-sect">
              <span className="mx-lbl">Workload</span>
              <div className="mx-line"><span>{sel.rooms.length} rooms</span><b>{sel.roomMinutes} min</b></div>
              {sel.otherMinutes > 0 && (
                <div className="mx-line"><span>Non-space tasks (discharges…)</span><b>{sel.otherMinutes} min</b></div>
              )}
            </div>

            {sel.rooms.length > 0 && (
              <div className="mx-sect">
                <span className="mx-lbl">First stops</span>
                {sel.rooms.slice(0, 5).map((rm, i) => (
                  <div key={rm.id} className="mx-line"><span>{i + 1}. {rm.label}</span><b>{rm.minutes}m</b></div>
                ))}
                {sel.rooms.length > 5 && <div className="mx-more">+ {sel.rooms.length - 5} more</div>}
              </div>
            )}

            <div className="mx-hintbox">
              <span className="mx-lbl">Rebalance</span>
              <p>{rebalanceHint(sel, rows)}</p>
            </div>

            <div className="mx-acts">
              {sel.sched.floorCareId ? (
                <a className="pbtn primary" href={"./maps.html#floorcare?fc=" + sel.sched.floorCareId}>Open in Floor Care</a>
              ) : sel.sched.sanitationId ? (
                <a className="pbtn primary" href={"./maps.html#sanitation?sr=" + sel.sched.sanitationId}>Open in Max Sanitation</a>
              ) : sel.sched.policingId ? (
                <a className="pbtn primary" href={"./maps.html#policing?pr=" + sel.sched.policingId}>Open in Max Policing</a>
              ) : (
                <button className="pbtn primary" onClick={() => onOpenOnMap(sel.id)}>🗺 Open on map</button>
              )}
              <button className="pbtn" onClick={() => onPrint(sel.id)}>🖨 Print</button>
              <button className="pbtn" onClick={onOpenList}>See in list</button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
