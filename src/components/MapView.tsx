import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import { useUI } from "../state/ui";
import { roomStatus, deptKey, deptColor, byId } from "../lib/compute";
import {
  deriveShapes, snapToWalls, polygonArea, polygonCentroid, polygonBounds,
  pointInShape, type Pt
} from "../lib/geometry";
import type { Floor, Room, StoredShape } from "../lib/types";
import { FLOOR_FINISH_SHORT } from "../lib/types";
import { fmt } from "../lib/format";
import { MinutesButton } from "./Breakdown";
import { RoomDrawer } from "./RoomDrawer";
import { toast } from "./Toast";

const GRAY = "#cfd8de";

interface ViewT { k: number; tx: number; ty: number; }
type Mode = { kind: "view" } | { kind: "trace"; roomId: string } | { kind: "editShape"; roomId: string };

function shapePath(s: { outer: Pt[]; holes: Pt[][] }): string {
  const ring = (poly: Pt[]) =>
    poly.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(3)} ${p[1].toFixed(3)}`).join(" ") + " Z";
  return [ring(s.outer), ...s.holes.map(ring)].join(" ");
}

export function MapView({ pendingShapeEdit, onShapeEditStart }: {
  pendingShapeEdit?: string | null;
  onShapeEditStart?: () => void;
}) {
  const { state, update } = useStore();
  const ui = useUI();
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const floors = state.floors.filter((f) => f.geometry && f.geometry.walls.length);
  const cur: Floor | null = floors.find((f) => f.id === state.ui.mapFloorId) ?? floors[0] ?? null;
  const filters = state.ui.filters;
  const colorBy = state.ui.mapColorBy;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editRoomId, setEditRoomId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const [draft, setDraft] = useState<Pt[]>([]);
  const [cursorPt, setCursorPt] = useState<Pt | null>(null);
  const [view, setView] = useState<ViewT>({ k: 20, tx: 0, ty: 0 });

  const floorRooms = useMemo(
    () => (cur ? state.rooms.filter((r) => r.floorId === cur.id) : []),
    [state.rooms, cur]
  );
  const shapes: Record<string, StoredShape> = cur?.shapes ?? {};

  // ---- legacy floors (imported before this feature): derive once, persist ----
  const derivedOnce = useRef(new Set<string>());
  useEffect(() => {
    if (!cur || !cur.geometry || cur.shapes || derivedOnce.current.has(cur.id)) return;
    derivedOnce.current.add(cur.id);
    const res = deriveShapes(cur.geometry, floorRooms.map((r) => ({
      id: r.id, mapX: r.mapX, mapY: r.mapY, cleanableSqFt: r.cleanableSqFt
    })));
    update((d) => {
      const fl = byId(d.floors, cur.id);
      if (fl && !fl.shapes) fl.shapes = res.shapes;
    });
  }, [cur, floorRooms, update]);

  const unresolved = useMemo(
    () => (cur?.shapes ? floorRooms.filter((r) => !cur.shapes![r.id]) : []),
    [cur?.shapes, floorRooms]
  );

  // ---- coloring & filters ----
  const matchesFilters = useCallback((r: Room): boolean => {
    if (filters.shift && r.shiftId !== filters.shift) return false;
    if (filters.dept && deptKey(r) !== filters.dept) return false;
    if (filters.rtype && r.roomType !== filters.rtype) return false;
    if (filters.status && roomStatus(r) !== filters.status) return false;
    if (filters.emp && r.employeeId !== filters.emp) return false;
    if (filters.freq && r.frequency !== filters.freq) return false;
    return true;
  }, [filters]);

  const roomFill = useCallback((r: Room): string => {
    if (colorBy === "schedule") {
      const sh = byId(state.shifts, r.shiftId);
      return sh ? sh.color : GRAY;
    }
    const d = state.departments.find((x) => x.name.toLowerCase() === deptKey(r).toLowerCase());
    if (!d || deptKey(r) === "Unassigned") return GRAY;
    return d.color;
  }, [colorBy, state.shifts, state.departments]);

  // ---- view transform: screen = (tx + k·wx, ty − k·wy) ----
  const worldBounds = useMemo(() => {
    if (!cur?.geometry) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const w of cur.geometry.walls) for (const p of w.points) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    return { minX, minY, maxX, maxY };
  }, [cur?.geometry]);

  const animRef = useRef<number | null>(null);
  const animateTo = useCallback((target: ViewT, ms = 240) => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    const t0 = performance.now();
    setView((from0) => {
      const from = { ...from0 };
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / ms);
        const e = 1 - Math.pow(1 - t, 3);
        setView({
          k: from.k + (target.k - from.k) * e,
          tx: from.tx + (target.tx - from.tx) * e,
          ty: from.ty + (target.ty - from.ty) * e
        });
        if (t < 1) animRef.current = requestAnimationFrame(step);
      };
      animRef.current = requestAnimationFrame(step);
      return from0;
    });
  }, []);

  const fitView = useCallback((b: { minX: number; minY: number; maxX: number; maxY: number } | null, animate: boolean) => {
    const svg = svgRef.current;
    if (!svg || !b) return;
    const w = svg.clientWidth || 900, h = svg.clientHeight || 600;
    const pad = 50;
    const k = Math.min((w - pad * 2) / Math.max(1, b.maxX - b.minX), (h - pad * 2) / Math.max(1, b.maxY - b.minY));
    const target: ViewT = {
      k,
      tx: (w - (b.minX + b.maxX) * k) / 2,
      ty: (h + (b.minY + b.maxY) * k) / 2
    };
    if (animate) animateTo(target);
    else setView(target);
  }, [animateTo]);

  useEffect(() => { fitView(worldBounds, false); }, [worldBounds, fitView]);

  // refit on first real layout (pane hidden at mount, resizes)
  const hadSize = useRef(false);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ro = new ResizeObserver(() => {
      if (svg.clientWidth > 0 && !hadSize.current) {
        hadSize.current = true;
        fitView(worldBounds, false);
      }
    });
    ro.observe(svg);
    return () => ro.disconnect();
  }, [worldBounds, fitView]);

  // tree scope → animated zoom-to-fit of that branch
  useEffect(() => {
    const sc = state.ui.scope;
    if (!sc || !cur) return;
    const scoped = floorRooms.filter((r) => {
      if (sc.type === "room") return r.id === sc.roomId;
      if (sc.type === "dept") return sc.floorId === cur.id && deptKey(r) === sc.dept;
      if (sc.type === "floor") return sc.floorId === cur.id;
      return true;
    });
    const withShapes = scoped.filter((r) => shapes[r.id]);
    if (!withShapes.length) { fitView(worldBounds, true); return; }
    let b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const r of withShapes) {
      const rb = polygonBounds(shapes[r.id].outer);
      b = {
        minX: Math.min(b.minX, rb.minX), minY: Math.min(b.minY, rb.minY),
        maxX: Math.max(b.maxX, rb.maxX), maxY: Math.max(b.maxY, rb.maxY)
      };
    }
    fitView(b, true);
    if (sc.type === "room") setSelectedId(sc.roomId);
  }, [state.ui.scope]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- shape edit requests from elsewhere (RoomDrawer "Adjust shape") ----
  useEffect(() => {
    if (!pendingShapeEdit || !cur) return;
    const room = byId(state.rooms, pendingShapeEdit);
    if (!room) return;
    if (room.floorId !== cur.id) {
      update((d) => { d.ui.mapFloorId = room.floorId; });
      return; // effect re-runs once the right floor is current
    }
    startShapeWork(pendingShapeEdit);
    onShapeEditStart?.();
  }, [pendingShapeEdit, cur]); // eslint-disable-line react-hooks/exhaustive-deps

  function startShapeWork(roomId: string) {
    const existing = shapes[roomId];
    setSelectedId(roomId);
    if (existing) {
      setDraft(existing.outer.map((p) => [...p] as Pt));
      setMode({ kind: "editShape", roomId });
    } else {
      setDraft([]);
      setMode({ kind: "trace", roomId });
    }
  }

  function saveShape(roomId: string, verts: Pt[], source: "traced" | "edited") {
    if (verts.length < 3) { toast("Click at least three corners first", true); return; }
    update((d) => {
      const fl = byId(d.floors, cur!.id);
      if (!fl) return;
      if (!fl.shapes) fl.shapes = {};
      fl.shapes[roomId] = {
        outer: verts, holes: [], source, areaSqFt: polygonArea(verts)
      };
    });
    setMode({ kind: "view" });
    setDraft([]);
    const room = byId(state.rooms, roomId);
    toast(`${room?.name ?? "Room"} outlined ✓`);
  }

  // ---- coordinate helpers ----
  const toWorld = useCallback((sx: number, sy: number): Pt => {
    return [(sx - view.tx) / view.k, (view.ty - sy) / view.k];
  }, [view]);

  function localXY(e: { clientX: number; clientY: number }): [number, number] {
    const rect = svgRef.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  const snapPoint = useCallback((w: Pt, prev?: Pt): Pt => {
    let p: Pt = [...w];
    if (cur?.geometry) {
      const snapped = snapToWalls(cur.geometry, p[0], p[1], 10 / view.k);
      if (snapped) p = snapped;
    }
    if (prev) { // right-angle assist
      if (Math.abs(p[0] - prev[0]) < 7 / view.k) p = [prev[0], p[1]];
      else if (Math.abs(p[1] - prev[1]) < 7 / view.k) p = [p[0], prev[1]];
    }
    return p;
  }, [cur?.geometry, view.k]);

  // ---- pointer interactions ----
  const pointers = useRef(new Map<number, [number, number]>());
  const gesture = useRef<{ moved: boolean; lastX: number; lastY: number; pinch: number | null; dragVertex: number | null }>(
    { moved: false, lastX: 0, lastY: 0, pinch: null, dragVertex: null });

  const zoomAt = useCallback((sx: number, sy: number, factor: number) => {
    setView((v) => {
      const k2 = Math.max(1, Math.min(400, v.k * factor));
      const real = k2 / v.k;
      return { k: k2, tx: sx - (sx - v.tx) * real, ty: sy - (sy - v.ty) * real };
    });
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); // the page never scrolls while over the map
      const rect = svg.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0016));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomAt, cur]);

  const onPointerDown = (e: React.PointerEvent) => {
    try { svgRef.current!.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    const [x, y] = localXY(e);
    pointers.current.set(e.pointerId, [x, y]);
    gesture.current = { moved: false, lastX: x, lastY: y, pinch: null, dragVertex: gesture.current.dragVertex };
    if (animRef.current) cancelAnimationFrame(animRef.current);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const [x, y] = localXY(e);
    if (mode.kind === "trace") {
      const w = toWorld(x, y);
      setCursorPt(snapPoint(w, draft[draft.length - 1]));
    }
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, [x, y]);

    // vertex dragging (edit mode)
    if (gesture.current.dragVertex !== null && mode.kind === "editShape") {
      const w = snapPoint(toWorld(x, y));
      setDraft((dv) => dv.map((p, i) => (i === gesture.current.dragVertex ? w : p)));
      gesture.current.moved = true;
      return;
    }

    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      const dist = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
      const mid: [number, number] = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
      if (gesture.current.pinch) zoomAt(mid[0], mid[1], dist / gesture.current.pinch);
      gesture.current.pinch = dist;
      gesture.current.moved = true;
      return;
    }
    const dx = x - gesture.current.lastX, dy = y - gesture.current.lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) gesture.current.moved = true;
    if (gesture.current.moved && mode.kind !== "trace") {
      setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
    }
    gesture.current.lastX = x; gesture.current.lastY = y;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    gesture.current.pinch = null;
    const wasVertexDrag = gesture.current.dragVertex !== null;
    gesture.current.dragVertex = null;
    if (gesture.current.moved || wasVertexDrag) return;

    const [x, y] = localXY(e);
    const w = toWorld(x, y);

    if (mode.kind === "trace") {
      const p = snapPoint(w, draft[draft.length - 1]);
      // close if clicking near the first vertex
      if (draft.length >= 3 && Math.hypot(p[0] - draft[0][0], p[1] - draft[0][1]) < 12 / view.k) {
        saveShape(mode.roomId, draft, "traced");
        return;
      }
      setDraft((dv) => [...dv, p]);
      return;
    }
    if (mode.kind === "editShape") return; // clicks only move vertices in edit mode

    // view mode: select the room under the cursor (topmost = smallest area wins)
    let hit: Room | null = null;
    let hitArea = Infinity;
    for (const r of floorRooms) {
      const s = shapes[r.id];
      if (s && pointInShape(w[0], w[1], s) && s.areaSqFt < hitArea) {
        hit = r; hitArea = s.areaSqFt;
      }
    }
    setSelectedId(hit ? hit.id : null);
  };

  // Esc / Enter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (mode.kind !== "view") { setMode({ kind: "view" }); setDraft([]); }
        else setSelectedId(null);
      }
      if (e.key === "Enter" && mode.kind === "trace" && draft.length >= 3) {
        saveShape(mode.roomId, draft, "traced");
      }
      if (e.key === "Enter" && mode.kind === "editShape") {
        saveShape(mode.roomId, draft, "edited");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // deliberately unmemoized: cheap, always fresh

  if (!cur) {
    return (
      <div className="card"><div className="emptystate">
        <div className="big">No floor plans yet</div>
        <p>Import a magicplan floor scan and it will show up here as a map you can click.</p>
        <button className="btn primary" onClick={() => update((d) => { d.ui.view = "import"; })}>Go to Import</button>
      </div></div>
    );
  }

  const selected = selectedId ? floorRooms.find((r) => r.id === selectedId) ?? null : null;
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const anyFilter = activeFilterCount > 0;
  const traceRoom = mode.kind !== "view" ? byId(state.rooms, mode.roomId) : null;

  // legend
  const legend: [string, string][] = [];
  if (colorBy === "department") {
    const seen = new Set<string>();
    for (const r of floorRooms) {
      const d = deptKey(r);
      if (d !== "Unassigned" && !seen.has(d)) { seen.add(d); legend.push([d, deptColor(state, d)]); }
    }
    legend.push(["No department yet", GRAY]);
  } else {
    for (const sh of state.shifts) {
      if (floorRooms.some((r) => r.shiftId === sh.id)) legend.push([sh.name + " shift", sh.color]);
    }
    legend.push(["Not scheduled yet", GRAY]);
  }

  const wallsPath = cur.geometry!.walls
    .map((w) => w.points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]} ${p[1]}`).join(" ") + " Z")
    .join(" ");

  return (
    <div className="mappage">
      {/* ---- info panel ABOVE the map ---- */}
      <div className={"card infopanel" + (selected ? " has" : "")}>
        {selected ? (
          <div className="cbody infobody">
            <div className="infomain">
              <h2 className="roomname">{selected.name}</h2>
              <div className="infochips">
                <span className="badge">{selected.roomType}</span>
                <span className="badge">
                  <i className="cdot" style={{ background: deptColor(state, deptKey(selected)) }} />
                  {deptKey(selected)}
                </span>
                <span className="badge">{FLOOR_FINISH_SHORT[selected.floorFinish]}</span>
                <span className="badge">{fmt(selected.cleanableSqFt, 0)} ft²</span>
              </div>
              <div className="infosched">
                {(() => {
                  const emp = byId(state.employees, selected.employeeId);
                  const sh = byId(state.shifts, selected.shiftId);
                  if (emp) return <>Scheduled — {emp.name}{sh ? ` on ${sh.name}` : ""} · <MinutesButton room={selected} mode="daily" /></>;
                  if (sh) return <>On the {sh.name} shift, nobody assigned yet · <MinutesButton room={selected} mode="daily" /></>;
                  return <>Not scheduled yet · <MinutesButton room={selected} mode="daily" /></>;
                })()}
              </div>
            </div>
            <div className="infoactions">
              {ui.canEditFacility && (
                <button className="btn big" onClick={() => setEditRoomId(selected.id)}>✏️ Edit room</button>
              )}
              {ui.canEditSchedule && (
                <button className="btn big primary" onClick={() =>
                  update((d) => { d.ui.scope = { type: "room", roomId: selected.id }; d.ui.view = "schedule"; })
                }>📋 Schedule this room</button>
              )}
            </div>
          </div>
        ) : (
          <div className="cbody infohint">
            👆 Click any room on the map to see its details here.
          </div>
        )}
      </div>

      {/* ---- two friendly controls + Filters ---- */}
      <div className="mapcontrols">
        {floors.length > 1 ? (
          floors.length <= 4 ? (
            <div className="segmented">
              {floors.map((f) => {
                const b = byId(state.buildings, f.buildingId);
                return (
                  <button key={f.id} className={f.id === cur.id ? "on" : ""}
                    onClick={() => update((d) => { d.ui.mapFloorId = f.id; })}>
                    {(b && floors.some((x) => x.buildingId !== f.buildingId) ? b.name + " — " : "") + f.name}
                  </button>
                );
              })}
            </div>
          ) : (
            <select value={cur.id} onChange={(e) => update((d) => { d.ui.mapFloorId = e.target.value; })}>
              {floors.map((f) => {
                const b = byId(state.buildings, f.buildingId);
                return <option key={f.id} value={f.id}>{(b ? b.name + " — " : "") + f.name}</option>;
              })}
            </select>
          )
        ) : (
          <span className="floorname">{(byId(state.buildings, cur.buildingId)?.name ?? "") + " — " + cur.name}</span>
        )}

        <span className="colorlabel">Color rooms by:</span>
        <div className="segmented">
          <button className={colorBy === "schedule" ? "on" : ""}
            onClick={() => update((d) => { d.ui.mapColorBy = "schedule"; })}>Schedule</button>
          <button className={colorBy === "department" ? "on" : ""}
            onClick={() => update((d) => { d.ui.mapColorBy = "department"; })}>Department</button>
        </div>

        <span className="spacer" />
        <button className={"btn" + (activeFilterCount ? " primary" : "")} onClick={() => setFiltersOpen(true)}>
          Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
        </button>
      </div>

      {/* ---- unresolved-rooms queue ---- */}
      {mode.kind === "view" && unresolved.length > 0 && ui.canEditFacility && (
        <div className="hintbar">
          <span>
            ✏️ {unresolved.length === 1
              ? `"${unresolved[0].name}" doesn't have an outline on the plan yet.`
              : `${unresolved.length} rooms don't have outlines on the plan yet.`}
          </span>
          <button className="btn small primary" style={{ marginLeft: "auto" }}
            onClick={() => startShapeWork(unresolved[0].id)}>
            Outline "{unresolved[0].name}"
          </button>
        </div>
      )}

      {/* ---- trace / edit toolbar ---- */}
      {mode.kind !== "view" && traceRoom && (
        <div className="tracebar">
          {mode.kind === "trace" ? (
            <span>✏️ Outlining <b>{traceRoom.name}</b> — click corner to corner around the room, then press Enter or click the first corner to finish.</span>
          ) : (
            <span>✏️ Adjusting <b>{traceRoom.name}</b> — drag the corner dots. Press Enter or Done when it looks right.</span>
          )}
          <span className="spacer" />
          {mode.kind === "editShape" && (
            <>
              <button className="btn small" onClick={() => { setDraft([]); setMode({ kind: "trace", roomId: mode.roomId }); }}>Start over</button>
              <button className="btn small primary" onClick={() => saveShape(mode.roomId, draft, "edited")}>Done</button>
            </>
          )}
          {mode.kind === "trace" && (
            <button className="btn small primary" disabled={draft.length < 3}
              onClick={() => saveShape(mode.roomId, draft, "traced")}>Finish outline</button>
          )}
          <button className="btn small" onClick={() => { setMode({ kind: "view" }); setDraft([]); }}>Cancel</button>
        </div>
      )}

      {/* ---- the map ---- */}
      <div className="card mapcard" ref={wrapRef}>
        <svg ref={svgRef} className={"floorsvg" + (mode.kind !== "view" ? " tracing" : "")}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k} ${-view.k})`}>
            {/* room fills — the rooms ARE the interface */}
            {floorRooms.map((r) => {
              const s = shapes[r.id];
              if (!s) return null;
              const active = !anyFilter || matchesFilters(r);
              const fill = active ? roomFill(r) : "#e3e9ed";
              const isSel = r.id === selectedId;
              const beingEdited = mode.kind !== "view" && mode.roomId === r.id;
              if (beingEdited) return null; // drawn as draft overlay instead
              return (
                <g key={r.id} className={"roomG" + (isSel ? " sel" : "") + (active ? "" : " dim")}>
                  <path className="roomfill" d={shapePath(s)} fill={fill}
                    fillRule="evenodd" vectorEffect="non-scaling-stroke" />
                </g>
              );
            })}
            {/* walls on top — crisp structure */}
            <path className="wallsP" d={wallsPath} fillRule="nonzero" />
            {/* door/window markers */}
            {cur.geometry!.openings.map((o, i) => (
              <circle key={i} className="openingDot" cx={o.x} cy={o.y} r={0.32} />
            ))}
            {/* labels (upright via counter-flip), auto-hide when small */}
            {floorRooms.map((r) => {
              const s = shapes[r.id];
              if (!s || (mode.kind !== "view" && mode.roomId === r.id)) return null;
              const bb = polygonBounds(s.outer);
              const pxW = (bb.maxX - bb.minX) * view.k;
              if (pxW < 64) return null;
              const [cx, cy] = polygonCentroid(s.outer);
              const active = !anyFilter || matchesFilters(r);
              const dark = !active ? false : luminance(roomFill(r)) < 0.55;
              return (
                <g key={"lb" + r.id} className="roomlabel"
                  transform={`translate(${cx} ${cy}) scale(${1 / view.k} ${-1 / view.k})`}>
                  <text className={dark ? "onDark" : "onLight"} y={pxW > 110 ? -3 : 4}>{r.name}</text>
                  {pxW > 110 && (
                    <text className={"sqft " + (dark ? "onDark" : "onLight")} y={14}>
                      {fmt(r.cleanableSqFt, 0)} ft²
                    </text>
                  )}
                </g>
              );
            })}
            {/* trace / edit overlay */}
            {mode.kind !== "view" && (
              <g className="traceG">
                {draft.length > 0 && (
                  <path
                    d={draft.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]} ${p[1]}`).join(" ") +
                      (mode.kind === "editShape" ? " Z" : cursorPt && mode.kind === "trace" ? ` L${cursorPt[0]} ${cursorPt[1]}` : "")}
                    className={"tracePath" + (mode.kind === "editShape" || draft.length >= 3 ? " closable" : "")}
                    vectorEffect="non-scaling-stroke" />
                )}
                {mode.kind === "trace" && cursorPt && (
                  <circle className="traceCursor" cx={cursorPt[0]} cy={cursorPt[1]} r={5 / view.k} />
                )}
                {draft.map((p, i) => (
                  <circle key={i} className={"traceVert" + (i === 0 && mode.kind === "trace" && draft.length >= 3 ? " first" : "")}
                    cx={p[0]} cy={p[1]} r={(mode.kind === "editShape" ? 6 : 4.5) / view.k}
                    onPointerDown={(e) => {
                      if (mode.kind !== "editShape") return;
                      e.stopPropagation();
                      try { svgRef.current!.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
                      pointers.current.set(e.pointerId, localXY(e));
                      gesture.current.dragVertex = i;
                      gesture.current.moved = false;
                    }} />
                ))}
              </g>
            )}
          </g>
        </svg>
        <div className="zoomctl">
          <button aria-label="Zoom in" onClick={() => {
            const svg = svgRef.current!;
            zoomAt(svg.clientWidth / 2, svg.clientHeight / 2, 1.35);
          }}>+</button>
          <button aria-label="Zoom out" onClick={() => {
            const svg = svgRef.current!;
            zoomAt(svg.clientWidth / 2, svg.clientHeight / 2, 1 / 1.35);
          }}>−</button>
          <button aria-label="Fit whole floor" className="fitbtn" onClick={() => fitView(worldBounds, true)}>⤢</button>
        </div>
      </div>

      <div className="maplegend">
        {legend.map(([label, color]) => (
          <span className="li" key={label}><span className="sw" style={{ background: color }} /><span>{label}</span></span>
        ))}
      </div>

      {/* ---- filters slide-over ---- */}
      <div className={"slideover" + (filtersOpen ? " open" : "")} aria-hidden={!filtersOpen}>
        <div className="sohead">
          <h3>Filters</h3>
          <button className="closex" aria-label="Close filters" onClick={() => setFiltersOpen(false)}>✕</button>
        </div>
        <div className="sobody">
          <p className="note" style={{ marginBottom: 12 }}>
            Rooms that don't match fade out on the map. Leave everything on "All" to see the whole floor.
          </p>
          {([
            ["shift", "Shift", state.shifts.map((s) => [s.id, s.name])],
            ["dept", "Department", [...new Set(floorRooms.map(deptKey))].sort().map((d) => [d, d])],
            ["rtype", "Room type", [...new Set(floorRooms.map((r) => r.roomType))].sort().map((t) => [t, t])],
            ["status", "Scheduled?", [["scheduled", "Yes — person assigned"], ["partial", "Halfway — shift only"], ["unscheduled", "Not yet"]]],
            ["emp", "Person", state.employees.map((e) => [e.id, e.name])],
            ["freq", "How often", state.frequencies.filter((f) => floorRooms.some((r) => r.frequency === f.id)).map((f) => [f.id, f.label])]
          ] as [string, string, string[][]][]).map(([key, label, opts]) => (
            <div className="field" style={{ marginBottom: 12 }} key={key}>
              <label>{label}</label>
              <select value={filters[key] ?? ""} onChange={(e) => update((d) => { d.ui.filters[key] = e.target.value; })}>
                <option value="">All</option>
                {opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </div>
          ))}
          <button className="btn" onClick={() => update((d) => { d.ui.filters = {}; })}>Show everything</button>
        </div>
      </div>
      {filtersOpen && <div className="soback" onClick={() => setFiltersOpen(false)} />}

      {editRoomId && (
        <RoomDrawer roomId={editRoomId} onClose={() => setEditRoomId(null)}
          onAdjustShape={(roomId) => { setEditRoomId(null); startShapeWork(roomId); }} />
      )}
    </div>
  );
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
