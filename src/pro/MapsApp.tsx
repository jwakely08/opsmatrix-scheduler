import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loadClassic, saveClassic, syncSpaceMinutes, assignSpaceToSchedule, scheduleColor,
  scheduleMinutes, rectifyForDisplay, pathFrom, centroidOf, boundsOf, pointIn,
  type ClassicData, type ClassicSpace, type ClassicSchedule, type NonSpaceTask
} from "./classicStore";
import {
  loadRules, saveRules, defaultRules, computeMinutes, autoTasksFor, typeIdFromLabel,
  isCarpet, classicTaskIds, type Rules
} from "./rules";

const WALL_STROKE = 13; // px — seals doorway gaps visually (data untouched)

function uid(p: string) { return p + "-" + Math.random().toString(36).slice(2, 9); }

export function MapsApp() {
  const [data, setData] = useState<ClassicData>(() => loadClassic());
  const [rules, setRules] = useState<Rules>(() => loadRules());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panel, setPanel] = useState<"none" | "rules" | "nonspace">("none");
  const [linkTask, setLinkTask] = useState<string | null>(null); // non-space room-link mode
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  const plan = data.plans[0] ?? null;
  const spaces = useMemo(
    () => (data.v7.spaces ?? []).filter((s) => !plan || s.visualPlanId === plan.id || !s.visualPlanId),
    [data.v7.spaces, plan]
  );
  const schedules = (data.v7.schedules ?? []).filter((s) => !s.projectNoteId);
  const projects = (data.v7.schedules ?? []).filter((s) => !!s.projectNoteId);

  const commit = useCallback((mut: (d: ClassicData) => void) => {
    setData((prev) => {
      const next: ClassicData = JSON.parse(JSON.stringify(prev));
      mut(next);
      saveClassic(next);
      return next;
    });
  }, []);

  const commitRules = useCallback((next: Rules, recalc = true) => {
    setRules(next);
    saveRules(next);
    if (recalc) {
      commit((d) => {
        for (const sp of d.v7.spaces ?? []) syncSpaceMinutes(sp, next);
      });
    }
  }, [commit]);

  // first run: make sure every space has fusion tasks + minutes from the rules
  useEffect(() => {
    const needs = (data.v7.spaces ?? []).some((sp) => !Array.isArray(sp.fusionTasks));
    if (!needs) return;
    commit((d) => {
      for (const sp of d.v7.spaces ?? []) {
        if (!Array.isArray(sp.fusionTasks)) {
          sp.fusionTasks = autoTasksFor(rules, typeIdFromLabel(rules, sp.roomType ?? ""));
        }
        syncSpaceMinutes(sp, rules);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // display geometry (rectified, memoized)
  const shapes = useMemo(() => {
    const out = new Map<string, { pts: { x: number; y: number }[]; path: string; c: { x: number; y: number } }>();
    for (const sp of spaces) {
      if (!sp.visualPts || sp.visualPts.length < 3) continue;
      const pts = rectifyForDisplay(sp.visualPts);
      out.set(sp.id, { pts, path: pathFrom(pts), c: centroidOf(pts) });
    }
    return out;
  }, [spaces]);

  // fit view
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !plan) return;
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

  // wheel zoom + drag pan
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
  const drag = useRef<{ x: number; y: number; moved: boolean; on: boolean }>({ x: 0, y: 0, moved: false, on: false });

  const matches = useCallback((sp: ClassicSpace): boolean => {
    if (filters.schedule && (sp.assignedScheduleId || "") !== filters.schedule) return false;
    if (filters.rtype && typeIdFromLabel(rules, sp.roomType ?? "") !== filters.rtype) return false;
    if (filters.task && !(sp.fusionTasks ?? []).includes(filters.task) && filters.task !== "general") return false;
    if (filters.floor && sp.floor !== filters.floor) return false;
    if (filters.shift) {
      const sched = schedules.find((s) => s.id === sp.assignedScheduleId);
      if (!sched || sched.shift !== filters.shift) return false;
    }
    return true;
  }, [filters, rules, schedules]);

  const anyFilter = Object.values(filters).some(Boolean);
  const selected = spaces.find((s) => s.id === selectedId) ?? null;
  const linkingTask = linkTask ? data.nonSpace.find((t) => t.id === linkTask) ?? null : null;

  function handleMapClick(e: React.MouseEvent) {
    if (drag.current.moved) return;
    const svg = svgRef.current!;
    const r = svg.getBoundingClientRect();
    const x = (e.clientX - r.left - view.tx) / view.k;
    const y = (e.clientY - r.top - view.ty) / view.k;
    let hit: ClassicSpace | null = null;
    let hitArea = Infinity;
    for (const sp of spaces) {
      const sh = shapes.get(sp.id);
      if (!sh) continue;
      if (pointIn(sh.pts, x, y)) {
        const b = boundsOf(sh.pts);
        const area = (b.maxX - b.minX) * (b.maxY - b.minY);
        if (area < hitArea) { hit = sp; hitArea = area; }
      }
    }
    if (linkingTask && hit) {
      commit((d) => {
        const t = d.nonSpace.find((x2) => x2.id === linkingTask.id)!;
        t.roomIds = t.roomIds.includes(hit!.id)
          ? t.roomIds.filter((id) => id !== hit!.id)
          : [...t.roomIds, hit!.id];
      });
      return;
    }
    setSelectedId(hit ? hit.id : null);
  }

  if (!plan) {
    return (
      <div className="pro-empty">
        <h2>No floor plan yet</h2>
        <p>Import a magicplan scan in OpsMatrix first (Max Space → Floor Plans → ⚡ Import magicplan Scan).</p>
        <a className="pbtn primary" href="./classic.html">← Back to OpsMatrix</a>
      </div>
    );
  }

  return (
    <div className="pro-shell">
      <header className="pro-head">
        <a className="pbtn ghost" href="./classic.html">← OpsMatrix</a>
        <h1>Max Plans <span>Pro</span> — Map Scheduler</h1>
        <span className="grow" />
        <button className={"pbtn" + (panel === "nonspace" ? " on" : "")}
          onClick={() => setPanel(panel === "nonspace" ? "none" : "nonspace")}>Non-Space Tasks</button>
        <button className={"pbtn" + (panel === "rules" ? " on" : "")}
          onClick={() => setPanel(panel === "rules" ? "none" : "rules")}>Cleaning Rules</button>
      </header>

      {/* filters */}
      <div className="pro-filters">
        <Sel label="Schedule" v={filters.schedule ?? ""} on={(v) => setFilters({ ...filters, schedule: v })}
          opts={schedules.map((s) => [s.id, `${s.num ?? ""} ${s.name ?? ""}`.trim()])} />
        <Sel label="Room type" v={filters.rtype ?? ""} on={(v) => setFilters({ ...filters, rtype: v })}
          opts={rules.roomTypes.map((rt) => [rt.id, rt.label])} />
        <Sel label="Task" v={filters.task ?? ""} on={(v) => setFilters({ ...filters, task: v })}
          opts={rules.tasks.map((t) => [t.id, t.label])} />
        <Sel label="Floor" v={filters.floor ?? ""} on={(v) => setFilters({ ...filters, floor: v })}
          opts={[...new Set(spaces.map((s) => s.floor ?? ""))].filter(Boolean).map((f) => [f, f])} />
        <Sel label="Shift" v={filters.shift ?? ""} on={(v) => setFilters({ ...filters, shift: v })}
          opts={["1st Shift", "2nd Shift", "3rd Shift"].map((s) => [s, s])} />
        {anyFilter && <button className="pbtn small" onClick={() => setFilters({})}>Clear</button>}
        <span className="grow" />
        {linkingTask && (
          <span className="linkhint">
            Linking rooms to “{linkingTask.name}” — click rooms, then
            <button className="pbtn small primary" onClick={() => setLinkTask(null)}>Done</button>
          </span>
        )}
      </div>

      <div className="pro-main">
        {/* ── the map ── */}
        <div className="pro-mapwrap">
          <svg ref={svgRef} className="pro-map"
            onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, moved: false, on: true }; }}
            onPointerMove={(e) => {
              if (!drag.current.on) return;
              const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
              if (Math.abs(dx) + Math.abs(dy) > 4) drag.current.moved = true;
              if (drag.current.moved) {
                setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
                drag.current.x = e.clientX; drag.current.y = e.clientY;
              }
            }}
            onPointerUp={(e) => { drag.current.on = false; handleMapClick(e); setTimeout(() => { drag.current.moved = false; }, 0); }}
          >
            <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
              {/* room fills: fat same-color stroke seals doorway gaps at thresholds */}
              {spaces.map((sp) => {
                const sh = shapes.get(sp.id);
                if (!sh) return null;
                const active = !anyFilter || matches(sp);
                const linked = linkingTask?.roomIds.includes(sp.id);
                const color = linked ? "#eab308" : active ? scheduleColor(schedules, sp.assignedScheduleId) : "#33404d";
                return (
                  <g key={sp.id} className={"proom" + (sp.id === selectedId ? " sel" : "") + (active ? "" : " dim")}>
                    <path d={sh.path} fill={color} stroke={color}
                      strokeWidth={WALL_STROKE} strokeLinejoin="round" />
                  </g>
                );
              })}
              {/* the scan's walls + door markers, multiplied over the colors */}
              <image href={plan.img} width={plan.w} height={plan.h}
                style={{ mixBlendMode: "multiply", pointerEvents: "none" }} />
              {/* labels */}
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
          {/* legend */}
          <div className="pro-legend">
            {schedules.map((s) => (
              <span key={s.id}><i style={{ background: (s.color as string) || "#64748b" }} />{s.num} {s.name}
                <em>{Math.round(scheduleMinutes(data, s))}m</em></span>
            ))}
            <span><i style={{ background: "#64748b" }} />Unscheduled</span>
          </div>
        </div>

        {/* ── click-a-room sidebar ── */}
        {selected && (
          <RoomSidebar
            key={selected.id}
            space={selected}
            rules={rules}
            schedules={schedules}
            onClose={() => setSelectedId(null)}
            onChange={(patch) => {
              commit((d) => {
                const sp = (d.v7.spaces ?? []).find((s) => s.id === selected.id)!;
                Object.assign(sp, patch);
                if (patch.roomType !== undefined && patch.fusionTasks === undefined) {
                  sp.fusionTasks = autoTasksFor(rules, typeIdFromLabel(rules, String(patch.roomType)));
                }
                syncSpaceMinutes(sp, rules);
                if (sp.assignedScheduleId) {
                  const sched = (d.v7.schedules ?? []).find((x) => x.id === sp.assignedScheduleId);
                  if (sched?.roomTasks) sched.roomTasks[sp.id] = classicTaskIds(sp);
                }
              });
            }}
            onAssign={(scheduleId) => {
              commit((d) => {
                assignSpaceToSchedule(d, selected.id, scheduleId);
              });
            }}
          />
        )}
      </div>

      {panel === "rules" && (
        <RulesPanel rules={rules} onChange={commitRules} onClose={() => setPanel("none")} />
      )}
      {panel === "nonspace" && (
        <NonSpacePanel data={data} commit={commit} schedules={schedules}
          onLink={(taskId) => { setLinkTask(taskId); setPanel("none"); }}
          onClose={() => setPanel("none")} />
      )}
    </div>
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

// ── the room sidebar: see everything, edit everything, schedule instantly ──
function RoomSidebar({ space, rules, schedules, onClose, onChange, onAssign }: {
  space: ClassicSpace;
  rules: Rules;
  schedules: ClassicSchedule[];
  onClose: () => void;
  onChange: (patch: Partial<ClassicSpace>) => void;
  onAssign: (scheduleId: string) => void;
}) {
  const typeId = typeIdFromLabel(rules, space.roomType ?? "");
  const breakdown = computeMinutes(rules, space);
  const carpet = isCarpet(space.floorType);
  const tasks = space.fusionTasks ?? autoTasksFor(rules, typeId);
  const sched = schedules.find((s) => s.id === space.assignedScheduleId);

  return (
    <aside className="pro-side">
      <div className="pshead">
        <h2>{space.roomNumber || space.roomName || "Room"}</h2>
        <button className="pbtn ghost" onClick={onClose}>✕</button>
      </div>

      <label className="pfield">Room name
        <input value={String(space.roomNumber ?? "")}
          onChange={(e) => onChange({ roomNumber: e.target.value, roomName: e.target.value })} />
      </label>

      <label className="pfield">Room type
        <select value={typeId}
          onChange={(e) => {
            const rt = rules.roomTypes.find((x) => x.id === e.target.value);
            onChange({ roomType: rt?.label ?? e.target.value });
          }}>
          {rules.roomTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.label}</option>)}
        </select>
      </label>

      <div className="prow">
        <label className="pfield">Floor type
          <select value={carpet ? "Carpet" : (space.floorType || "Hard floor")}
            onChange={(e) => onChange({ floorType: e.target.value })}>
            <option>Hard floor</option>
            <option>Carpet</option>
            <option>Other</option>
          </select>
        </label>
        <label className="pfield">Square feet
          <input type="number" min={0} value={Number(space.squareFeet) || 0}
            onChange={(e) => onChange({ squareFeet: Number(e.target.value) || 0 })} />
        </label>
      </div>

      {carpet && (
        <label className="pfield accent">Vacuum — days per week
          <input type="number" min={1} max={7} value={Number(space.vacuumDaysPerWeek) || 5}
            onChange={(e) => onChange({ vacuumDaysPerWeek: Math.max(1, Math.min(7, Number(e.target.value) || 5)) })} />
        </label>
      )}

      <div className="pfield">
        <span>Cleaning tasks</span>
        <div className="ptasks">
          {rules.tasks.filter((t) => t.addable).map((t) => {
            const on = tasks.includes(t.id);
            const auto = t.autoFor.includes(typeId);
            return (
              <button key={t.id} className={"ptask" + (on ? " on" : "")}
                onClick={() => onChange({
                  fusionTasks: on ? tasks.filter((x) => x !== t.id) : [...tasks, t.id]
                })}>
                {t.label}{auto ? " •" : ""}
              </button>
            );
          })}
        </div>
        <small>• = automatic for this room type. High Dusting can be scheduled to a different person than the room itself.</small>
      </div>

      <div className="pbreak">
        <span>Time to clean</span>
        {breakdown.lines.map((l, i) => (
          <div key={i} className="pline"><em>{l.label}</em><b>{l.minutes.toFixed(1)}m</b></div>
        ))}
        <div className="pline total"><em>Total per visit</em><b>{breakdown.total} min</b></div>
      </div>

      <label className="pfield big">Schedule
        <select value={space.assignedScheduleId ?? ""}
          onChange={(e) => onAssign(e.target.value)}
          style={{ borderLeft: `6px solid ${sched ? (sched.color as string) : "#64748b"}` }}>
          <option value="">— Unscheduled —</option>
          {schedules.map((s) => (
            <option key={s.id} value={s.id}>{s.num} · {s.name} ({s.shift})</option>
          ))}
        </select>
      </label>
      {sched && <p className="pnote">Colored {String(sched.color)} on the map · {sched.employee || "unassigned"}</p>}
    </aside>
  );
}

// ── cleaning rules: the formulas, visible and editable ──
function RulesPanel({ rules, onChange, onClose }: {
  rules: Rules; onChange: (r: Rules, recalc?: boolean) => void; onClose: () => void;
}) {
  const [newTask, setNewTask] = useState({ label: "", per: "", flat: "" });
  const [newType, setNewType] = useState({ label: "", qual: "" });
  const set = (mut: (r: Rules) => void) => {
    const next: Rules = JSON.parse(JSON.stringify(rules));
    mut(next);
    onChange(next);
  };
  return (
    <div className="pro-drawer">
      <div className="pshead"><h2>Cleaning Rules</h2>
        <button className="pbtn ghost" onClick={onClose}>✕</button></div>
      <p className="pnote">Starting numbers follow standard healthcare (ISSA-style) production rates. Every number here is yours to adjust — rooms recalculate instantly.</p>

      <h3>The general cleaning formula</h3>
      <div className="pformula">
        1 minute per <input type="number" value={rules.general.hardSqftPerMin}
          onChange={(e) => set((r) => { r.general.hardSqftPerMin = Number(e.target.value) || 1; })} />
        sq ft on <b>hard floor</b> (mopping included)
      </div>
      <div className="pformula">
        1 minute per <input type="number" value={rules.general.carpetSqftPerMin}
          onChange={(e) => set((r) => { r.general.carpetSqftPerMin = Number(e.target.value) || 1; })} />
        sq ft on <b>carpet</b> (vacuuming included — days/week is set per room and used by scheduling)
      </div>

      <h3>Tasks (each adds time on top)</h3>
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
          <em>{t.autoFor.length ? "auto: " + t.autoFor.join(", ") : "added manually"}</em>
          {!t.builtIn && (
            <button className="pbtn small danger" onClick={() => set((r) => { r.tasks = r.tasks.filter((x) => x.id !== t.id); })}>✕</button>
          )}
        </div>
      ))}
      <div className="prule add">
        <input placeholder="New task name" value={newTask.label}
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
        }}>Add task</button>
      </div>

      <h3>Room types (each adds a qualifier on top of general cleaning)</h3>
      {rules.roomTypes.map((rt) => (
        <div key={rt.id} className="prule">
          <b>{rt.label}</b>
          <span>+<input type="number" value={rt.qualifierMin}
            onChange={(e) => set((r) => { r.roomTypes.find((x) => x.id === rt.id)!.qualifierMin = Number(e.target.value) || 0; })} /> min</span>
          <em>{rules.tasks.filter((t) => t.autoFor.includes(rt.id)).map((t) => t.label).join(" + ") || "general clean only"}</em>
          {!rt.builtIn && (
            <button className="pbtn small danger" onClick={() => set((r) => { r.roomTypes = r.roomTypes.filter((x) => x.id !== rt.id); })}>✕</button>
          )}
        </div>
      ))}
      <div className="prule add">
        <input placeholder="New room type" value={newType.label}
          onChange={(e) => setNewType({ ...newType, label: e.target.value })} />
        <input type="number" placeholder="+ qualifier min" value={newType.qual}
          onChange={(e) => setNewType({ ...newType, qual: e.target.value })} />
        <button className="pbtn small primary" onClick={() => {
          if (!newType.label.trim()) return;
          set((r) => r.roomTypes.push({
            id: uid("rt"), label: newType.label.trim(), qualifierMin: Number(newType.qual) || 0
          }));
          setNewType({ label: "", qual: "" });
        }}>Add type</button>
      </div>
      <p className="pnote">New room types automatically get the general cleaning formula; add tasks to them from any room's sidebar.</p>

      <button className="pbtn" onClick={() => onChange(defaultRules())}>Reset to healthcare standards</button>
    </div>
  );
}

// ── non-space tasks: discharge, sanitation routes, day porters ──
function NonSpacePanel({ data, commit, schedules, onLink, onClose }: {
  data: ClassicData;
  commit: (mut: (d: ClassicData) => void) => void;
  schedules: ClassicSchedule[];
  onLink: (taskId: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState({ name: "", hours: "2" });
  return (
    <div className="pro-drawer">
      <div className="pshead"><h2>Non-Space Tasks</h2>
        <button className="pbtn ghost" onClick={onClose}>✕</button></div>
      <p className="pnote">Discharges, sanitation routes, day porters — time that fills a schedule without owning rooms. Linking rooms is optional (nice for showing a sanitation route on the map), never required.</p>

      {data.nonSpace.map((t) => (
        <div key={t.id} className="prule">
          <b>{t.name}</b>
          <span><input type="number" step={0.5} min={0} value={t.hours}
            onChange={(e) => commit((d) => { d.nonSpace.find((x) => x.id === t.id)!.hours = Number(e.target.value) || 0; })} /> h</span>
          <select value={t.scheduleId}
            onChange={(e) => commit((d) => { d.nonSpace.find((x) => x.id === t.id)!.scheduleId = e.target.value; })}>
            <option value="">— no schedule —</option>
            {schedules.map((s) => <option key={s.id} value={s.id}>{s.num} · {s.name}</option>)}
          </select>
          <button className="pbtn small" onClick={() => onLink(t.id)}>
            Link rooms ({t.roomIds.length})
          </button>
          <button className="pbtn small danger"
            onClick={() => commit((d) => { d.nonSpace = d.nonSpace.filter((x) => x.id !== t.id); })}>✕</button>
        </div>
      ))}

      <div className="prule add">
        <input placeholder="e.g. Sanitation Route A / Discharges / Day Porter" value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input type="number" step={0.5} min={0} placeholder="hours" value={draft.hours}
          onChange={(e) => setDraft({ ...draft, hours: e.target.value })} />
        <button className="pbtn small primary" onClick={() => {
          if (!draft.name.trim()) return;
          commit((d) => d.nonSpace.push({
            id: uid("nst"), name: draft.name.trim(), hours: Number(draft.hours) || 0,
            scheduleId: "", roomIds: []
          }));
          setDraft({ name: "", hours: "2" });
        }}>Add</button>
      </div>
      <p className="pnote">Hours count toward the schedule's total in the legend here. Yellow rooms on the map = linked to the task you're editing.</p>
    </div>
  );
}
