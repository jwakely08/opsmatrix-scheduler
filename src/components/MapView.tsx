import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import { useUI } from "../state/ui";
import { roomStatus, deptKey, byId } from "../lib/compute";
import type { AppState, Floor, Room } from "../lib/types";
import { fmt } from "../lib/format";

const MAP_COLORS = ["#0f6b62", "#d98e1f", "#3f6fb5", "#b5533f", "#7a4fb0", "#2e8f63", "#b03f7e", "#5b7083", "#8a7a1f", "#3fa3b5"];

function colorKeyForRoom(state: AppState, r: Room, colorBy: string): string {
  switch (colorBy) {
    case "rtype": return r.roomType;
    case "status": return roomStatus(r);
    case "shift": return byId(state.shifts, r.shiftId)?.name ?? "no shift";
    case "emp": return byId(state.employees, r.employeeId)?.name ?? "unassigned";
    case "freq": return state.frequencies.find((f) => f.id === r.frequency)?.label ?? "?";
    default: return deptKey(r);
  }
}

export function MapView() {
  const { state, update } = useStore();
  const ui = useUI();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markersRef = useRef<{ x: number; y: number; r: number; roomId: string }[]>([]);
  const [legend, setLegend] = useState<[string, string][]>([]);

  const floors = state.floors.filter((f) => f.geometry && f.geometry.walls.length);
  const cur: Floor | null = floors.find((f) => f.id === state.ui.mapFloorId) ?? floors[0] ?? null;
  const filters = state.ui.filters;

  const floorRooms = useMemo(
    () => (cur ? state.rooms.filter((r) => r.floorId === cur.id) : []),
    [state.rooms, cur]
  );
  const visRooms = useMemo(() => floorRooms.filter((r) => {
    if (filters.shift && r.shiftId !== filters.shift) return false;
    if (filters.dept && deptKey(r) !== filters.dept) return false;
    if (filters.rtype && r.roomType !== filters.rtype) return false;
    if (filters.status && roomStatus(r) !== filters.status) return false;
    if (filters.emp && r.employeeId !== filters.emp) return false;
    if (filters.freq && r.frequency !== filters.freq) return false;
    return true;
  }), [floorRooms, filters]);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !cur?.geometry) return;
    // rendering approach carried over from the importer: fit-to-extent, Y-flip, scale bar
    const g = cur.geometry;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = 560;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const wall of g.walls) for (const p of wall.points) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    const pad = 46;
    const scale = Math.min((w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxY - minY));
    const tx = (x: number) => pad + (x - minX) * scale;
    const ty = (y: number) => h - pad - (y - minY) * scale; // flip Y

    ctx.fillStyle = "rgba(28,43,51,0.82)";
    ctx.strokeStyle = "#3a4d58"; ctx.lineWidth = 1;
    for (const wall of g.walls) {
      ctx.beginPath();
      wall.points.forEach((p, i) => { i === 0 ? ctx.moveTo(tx(p[0]), ty(p[1])) : ctx.lineTo(tx(p[0]), ty(p[1])); });
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = "#d98e1f";
    for (const o of g.openings) {
      ctx.beginPath(); ctx.arc(tx(o.x), ty(o.y), 3, 0, Math.PI * 2); ctx.fill();
    }

    const visIds = new Set(visRooms.map((r) => r.id));
    const colorMap = new Map<string, string>();
    markersRef.current = [];
    for (const r of floorRooms) {
      if (r.mapX === null || r.mapX === undefined) continue;
      const visible = visIds.has(r.id);
      const key = colorKeyForRoom(state, r, state.ui.colorBy);
      if (visible && !colorMap.has(key)) colorMap.set(key, MAP_COLORS[colorMap.size % MAP_COLORS.length]);
      const mx = tx(r.mapX), my = ty(r.mapY!);
      const rad = 11;
      ctx.beginPath(); ctx.arc(mx, my, rad, 0, Math.PI * 2);
      ctx.fillStyle = visible ? colorMap.get(key)! : "rgba(150,163,176,0.35)";
      ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = "#ffffff"; ctx.stroke();
      ctx.fillStyle = visible ? "#ffffff" : "rgba(255,255,255,0.7)";
      ctx.font = "700 9px Segoe UI, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const initials = r.name.split(/\s+/).map((wd) => wd.charAt(0)).join("").slice(0, 2).toUpperCase();
      ctx.fillText(initials, mx, my);
      if (visible) markersRef.current.push({ x: mx, y: my, r: rad + 2, roomId: r.id });
      ctx.fillStyle = visible ? "#1c2b33" : "rgba(91,112,131,0.5)";
      ctx.font = "600 10.5px Segoe UI, sans-serif";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(r.name, mx, my + rad + 12);
    }

    // scale bar (10 ft)
    const bar = 10 * scale;
    ctx.strokeStyle = "#5b7083"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pad, h - 16); ctx.lineTo(pad + bar, h - 16); ctx.stroke();
    ctx.fillStyle = "#5b7083"; ctx.font = "10px Consolas, monospace"; ctx.textAlign = "left";
    ctx.fillText("10 ft", pad + bar + 6, h - 13);

    setLegend([...colorMap.entries()]);
  }, [state, cur, floorRooms, visRooms]);

  if (!cur) {
    return (
      <div className="card"><div className="emptystate">
        <div className="big">No floor plans yet</div>
        <p>Import a magicplan .dxf (with its statistics .csv) and the floor plan will render here with clickable rooms and filters.</p>
        <button className="btn primary" onClick={() => update((d) => { d.ui.view = "import"; })}>Go to Import</button>
      </div></div>
    );
  }

  const b2 = byId(state.buildings, cur.buildingId);
  const setFilter = (key: string, v: string) => update((d) => { d.ui.filters[key] = v; });
  const deptOpts = [...new Set(floorRooms.map(deptKey))].sort();
  const typeOpts = [...new Set(floorRooms.map((r) => r.roomType))].sort();
  const freqIds = new Set(floorRooms.map((r) => r.frequency));
  const noLabel = visRooms.filter((r) => r.mapX === null || r.mapX === undefined);

  function Select({ label, value, onChange, children }: {
    label: string; value: string; onChange: (v: string) => void; children: React.ReactNode;
  }) {
    return (
      <div className="field">
        <label>{label}</label>
        <select value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
      </div>
    );
  }

  return (
    <div>
      <h1 className="pagetitle">Facility map</h1>
      <p className="pagesub">Rooms are clickable at their label markers. Filters combine; marker colors follow the “color by” dimension.</p>

      <div className="filterbar">
        <Select label="Floor" value={cur.id} onChange={(v) => update((d) => { d.ui.mapFloorId = v; })}>
          {floors.map((f) => {
            const b = byId(state.buildings, f.buildingId);
            return <option key={f.id} value={f.id}>{(b ? b.name + " / " : "") + f.name}</option>;
          })}
        </Select>
        <Select label="Shift" value={filters.shift ?? ""} onChange={(v) => setFilter("shift", v)}>
          <option value="">All</option>
          {state.shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Select label="Department" value={filters.dept ?? ""} onChange={(v) => setFilter("dept", v)}>
          <option value="">All</option>
          {deptOpts.map((d) => <option key={d} value={d}>{d}</option>)}
        </Select>
        <Select label="Room type" value={filters.rtype ?? ""} onChange={(v) => setFilter("rtype", v)}>
          <option value="">All</option>
          {typeOpts.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
        <Select label="Status" value={filters.status ?? ""} onChange={(v) => setFilter("status", v)}>
          <option value="">All</option>
          <option value="scheduled">Scheduled</option>
          <option value="partial">Partial</option>
          <option value="unscheduled">Unscheduled</option>
        </Select>
        <Select label="Employee" value={filters.emp ?? ""} onChange={(v) => setFilter("emp", v)}>
          <option value="">All</option>
          {state.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </Select>
        <Select label="Frequency" value={filters.freq ?? ""} onChange={(v) => setFilter("freq", v)}>
          <option value="">All</option>
          {state.frequencies.filter((f) => freqIds.has(f.id)).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </Select>
        <Select label="Color by" value={state.ui.colorBy} onChange={(v) => update((d) => { d.ui.colorBy = v; })}>
          <option value="department">Department</option>
          <option value="rtype">Room type</option>
          <option value="status">Schedule status</option>
          <option value="shift">Shift</option>
          <option value="emp">Employee</option>
          <option value="freq">Frequency</option>
        </Select>
        <button className="btn small" style={{ marginBottom: 2 }}
          onClick={() => update((d) => { d.ui.filters = {}; })}>Clear filters</button>
      </div>

      <div className="card">
        <div className="chead">
          <h2>{(b2 ? b2.name + " — " : "") + cur.name}</h2>
          <span className="sub">{fmt(cur.cleanableSqFt, 2)} ft² cleanable · gross {fmt(cur.grossSqFt, 2)} ft² (reference only)</span>
        </div>
        <canvas ref={canvasRef} className="floorcv" height={560}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left, y = e.clientY - rect.top;
            for (const m of markersRef.current) {
              const dx = x - m.x, dy = y - m.y;
              if (dx * dx + dy * dy <= m.r * m.r) { ui.openRoom(m.roomId); return; }
            }
          }} />
        {noLabel.length > 0 && (
          <div className="nolabel">
            <span>No map label — open from list: </span>
            {noLabel.map((r) => (
              <span key={r.id} className="chiplink" tabIndex={0} onClick={() => ui.openRoom(r.id)}>{r.name}</span>
            ))}
          </div>
        )}
      </div>

      <div className="maplegend">
        {legend.length === 0
          ? <span>No rooms match the current filters.</span>
          : legend.map(([k, c]) => (
            <span className="li" key={k}><span className="sw" style={{ background: c }} /><span>{k}</span></span>
          ))}
      </div>
    </div>
  );
}
