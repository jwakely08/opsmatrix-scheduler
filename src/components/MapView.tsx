import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import { useUI } from "../state/ui";
import { roomStatus, deptKey, deptColor, byId } from "../lib/compute";
import { deriveRoomRegions, pointInPolygon, polygonCentroid, polygonBounds, type RoomRegion } from "../lib/regions";
import type { Floor, Room } from "../lib/types";
import { FLOOR_FINISH_SHORT } from "../lib/types";
import { fmt } from "../lib/format";
import { MinutesButton } from "./Breakdown";
import { RoomDrawer } from "./RoomDrawer";

const GRAY = "#cfd8de";
const EASE = (t: number) => 1 - Math.pow(1 - t, 3);

interface ViewT { k: number; tx: number; ty: number; }

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function MapView() {
  const { state, update } = useStore();
  const ui = useUI();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const floors = state.floors.filter((f) => f.geometry && f.geometry.walls.length);
  const cur: Floor | null = floors.find((f) => f.id === state.ui.mapFloorId) ?? floors[0] ?? null;
  const filters = state.ui.filters;
  const colorBy = state.ui.mapColorBy;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editRoomId, setEditRoomId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const floorRooms = useMemo(
    () => (cur ? state.rooms.filter((r) => r.floorId === cur.id) : []),
    [state.rooms, cur]
  );

  // ---- derived clickable room shapes (memoized per floor geometry + rooms) ----
  const regions = useMemo(() => {
    if (!cur?.geometry) return new Map<string, RoomRegion>();
    return deriveRoomRegions(cur.geometry, floorRooms.map((r) => ({
      id: r.id, mapX: r.mapX, mapY: r.mapY, cleanableSqFt: r.cleanableSqFt
    })));
  }, [cur?.geometry, floorRooms]);

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

  // ---- view transform + animation state (refs so handlers stay stable) ----
  const viewRef = useRef<ViewT>({ k: 1, tx: 0, ty: 0 });
  const animRef = useRef<{ from: ViewT; to: ViewT; t0: number; dur: number } | null>(null);
  const hoverRef = useRef<{ id: string | null; progress: Map<string, number> }>({ id: null, progress: new Map() });
  const needsDraw = useRef(true);
  const lastFrame = useRef(0);

  const worldBounds = useMemo(() => {
    if (!cur?.geometry) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const w of cur.geometry.walls) for (const p of w.points) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    return { minX, minY, maxX, maxY };
  }, [cur?.geometry]);

  const fitView = useCallback((b: { minX: number; minY: number; maxX: number; maxY: number } | null, animate: boolean) => {
    const cv = canvasRef.current;
    if (!cv || !b) return;
    const w = cv.clientWidth, h = cv.clientHeight;
    const pad = 46;
    const k = Math.min((w - pad * 2) / Math.max(1, b.maxX - b.minX), (h - pad * 2) / Math.max(1, b.maxY - b.minY));
    const target: ViewT = {
      k,
      tx: (w - (b.minX + b.maxX) * k) / 2,
      ty: (h + (b.minY + b.maxY) * k) / 2
    };
    if (animate) {
      animRef.current = { from: { ...viewRef.current }, to: target, t0: performance.now(), dur: 260 };
    } else {
      viewRef.current = target;
    }
    needsDraw.current = true;
  }, []);

  // world → screen (Y flipped)
  const toS = (v: ViewT, wx: number, wy: number): [number, number] => [v.tx + wx * v.k, v.ty - wy * v.k];
  const toW = (v: ViewT, sx: number, sy: number): [number, number] => [(sx - v.tx) / v.k, (v.ty - sy) / v.k];

  // ---- draw ----
  const draw = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv || !cur?.geometry) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const v = viewRef.current;
    const hover = hoverRef.current;
    const anyFilter = Object.values(filters).some(Boolean);

    // room shapes
    for (const r of floorRooms) {
      const region = regions.get(r.id);
      if (!region) continue;
      const active = !anyFilter || matchesFilters(r);
      const fill = active ? roomFill(r) : "#e3e9ed";
      const hp = hover.progress.get(r.id) ?? 0;
      const [ccx, ccy] = polygonCentroid(region.polygon);
      const [scx, scy] = toS(v, ccx, ccy);
      const lift = 1 + hp * 0.025;

      ctx.save();
      ctx.translate(scx, scy);
      ctx.scale(lift, lift);
      ctx.translate(-scx, -scy);
      if (hp > 0.01) {
        ctx.shadowColor = "rgba(28,43,51," + 0.28 * hp + ")";
        ctx.shadowBlur = 14 * hp;
        ctx.shadowOffsetY = 4 * hp;
      }
      ctx.beginPath();
      region.polygon.forEach((p, i) => {
        const [sx, sy] = toS(v, p[0], p[1]);
        i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
      });
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.globalAlpha = active ? (0.88 + hp * 0.12) : 0.5;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowColor = "transparent";
      ctx.lineWidth = r.id === selectedId ? 3 : 1.5;
      ctx.strokeStyle = r.id === selectedId ? "#1c2b33" : "rgba(255,255,255,0.9)";
      ctx.stroke();

      // name + sq ft inside, when there is room for it
      const bb = polygonBounds(region.polygon);
      const pxW = (bb.maxX - bb.minX) * v.k;
      if (pxW > 72) {
        const dark = luminance(fill) < 0.55 && active;
        ctx.fillStyle = dark ? "rgba(255,255,255,0.96)" : "#243640";
        ctx.font = "600 12.5px 'Segoe UI', sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(r.name, scx, scy - (pxW > 110 ? 8 : 0), pxW * 0.92);
        if (pxW > 110) {
          ctx.font = "11px Consolas, monospace";
          ctx.fillStyle = dark ? "rgba(255,255,255,0.75)" : "rgba(36,54,64,0.65)";
          ctx.fillText(fmt(r.cleanableSqFt, 0) + " ft²", scx, scy + 10);
        }
      }
      ctx.restore();
    }

    // walls on top for crisp structure
    ctx.fillStyle = "rgba(30,45,54,0.9)";
    for (const wall of cur.geometry.walls) {
      ctx.beginPath();
      wall.points.forEach((p, i) => {
        const [sx, sy] = toS(v, p[0], p[1]);
        i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
      });
      ctx.closePath(); ctx.fill();
    }
    // door/window markers
    ctx.fillStyle = "#d98e1f";
    for (const o of cur.geometry.openings) {
      const [sx, sy] = toS(v, o.x, o.y);
      ctx.beginPath(); ctx.arc(sx, sy, Math.max(2, 0.35 * v.k), 0, Math.PI * 2); ctx.fill();
    }
    // scale bar
    const bar = 10 * v.k;
    ctx.strokeStyle = "#5b7083"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(16, h - 16); ctx.lineTo(16 + bar, h - 16); ctx.stroke();
    ctx.fillStyle = "#5b7083"; ctx.font = "10px Consolas, monospace"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText("10 ft", 16 + bar + 6, h - 13);
  }, [cur, floorRooms, regions, filters, matchesFilters, roomFill, selectedId]);

  // ---- animation loop ----
  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(50, now - (lastFrame.current || now));
      lastFrame.current = now;
      let animating = false;

      const anim = animRef.current;
      if (anim) {
        const t = Math.min(1, (now - anim.t0) / anim.dur);
        const e = EASE(t);
        viewRef.current = {
          k: anim.from.k + (anim.to.k - anim.from.k) * e,
          tx: anim.from.tx + (anim.to.tx - anim.from.tx) * e,
          ty: anim.from.ty + (anim.to.ty - anim.from.ty) * e
        };
        if (t >= 1) animRef.current = null;
        animating = true;
      }
      const hover = hoverRef.current;
      for (const r of floorRooms) {
        const cur2 = hover.progress.get(r.id) ?? 0;
        const target = hover.id === r.id ? 1 : 0;
        if (Math.abs(cur2 - target) > 0.001) {
          const step = dt / 180;
          const next = cur2 + Math.sign(target - cur2) * Math.min(step, Math.abs(target - cur2));
          hover.progress.set(r.id, next);
          animating = true;
        }
      }
      if (animating || needsDraw.current) {
        needsDraw.current = false;
        draw();
      }
    };
    raf = requestAnimationFrame(loop);
    // rAF never fires in hidden/background tabs — a slow fallback keeps the
    // canvas from staying blank if the page loads while not visible
    const fallback = window.setInterval(() => {
      if (needsDraw.current) { needsDraw.current = false; draw(); }
    }, 500);
    return () => { cancelAnimationFrame(raf); window.clearInterval(fallback); };
  }, [draw, floorRooms]);

  // initial fit + refit on floor change
  useEffect(() => { fitView(worldBounds, false); }, [worldBounds, fitView]);

  // redraw (and fit, on first real layout) whenever the canvas gets resized —
  // covers the pane being hidden at mount, window resizes, and layout shifts
  const hadSize = useRef(false);
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ro = new ResizeObserver(() => {
      if (cv.clientWidth > 0 && !hadSize.current) {
        hadSize.current = true;
        fitView(worldBounds, false);
      }
      needsDraw.current = true;
    });
    ro.observe(cv);
    return () => ro.disconnect();
  }, [worldBounds, fitView]);

  // tree scope → animated zoom to that branch
  useEffect(() => {
    const sc = state.ui.scope;
    if (!sc || !cur) return;
    const scoped = floorRooms.filter((r) => {
      if (sc.type === "room") return r.id === sc.roomId;
      if (sc.type === "dept") return sc.floorId === cur.id && deptKey(r) === sc.dept;
      if (sc.type === "floor") return sc.floorId === cur.id;
      return true; // building → whole floor
    });
    if (!scoped.length) { fitView(worldBounds, true); return; }
    let b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const r of scoped) {
      const region = regions.get(r.id);
      if (!region) continue;
      const rb = polygonBounds(region.polygon);
      b = {
        minX: Math.min(b.minX, rb.minX), minY: Math.min(b.minY, rb.minY),
        maxX: Math.max(b.maxX, rb.maxX), maxY: Math.max(b.maxY, rb.maxY)
      };
    }
    if (b.minX !== Infinity) fitView(b, true);
    if (sc.type === "room") setSelectedId(sc.roomId);
  }, [state.ui.scope]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- pointer interactions: pan / click / pinch ----
  const pointers = useRef(new Map<number, [number, number]>());
  const drag = useRef<{ moved: boolean; lastX: number; lastY: number; pinchDist: number | null }>({ moved: false, lastX: 0, lastY: 0, pinchDist: null });

  const hitTest = useCallback((sx: number, sy: number): Room | null => {
    const [wx, wy] = toW(viewRef.current, sx, sy);
    // topmost = last drawn; iterate reversed
    for (let i = floorRooms.length - 1; i >= 0; i--) {
      const region = regions.get(floorRooms[i].id);
      if (region && pointInPolygon(wx, wy, region.polygon)) return floorRooms[i];
    }
    return null;
  }, [floorRooms, regions]);

  function localXY(e: { clientX: number; clientY: number }): [number, number] {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  const onPointerDown = (e: React.PointerEvent) => {
    try { canvasRef.current!.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    const [x, y] = localXY(e);
    pointers.current.set(e.pointerId, [x, y]);
    drag.current = { moved: false, lastX: x, lastY: y, pinchDist: null };
    animRef.current = null;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const [x, y] = localXY(e);
    if (!pointers.current.has(e.pointerId)) {
      // plain hover
      const hit = hitTest(x, y);
      const id = hit ? hit.id : null;
      if (hoverRef.current.id !== id) {
        hoverRef.current.id = id;
        canvasRef.current!.style.cursor = id ? "pointer" : "grab";
      }
      return;
    }
    pointers.current.set(e.pointerId, [x, y]);
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      // pinch zoom
      const dist = Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
      const mid: [number, number] = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
      if (drag.current.pinchDist) {
        zoomAt(mid[0], mid[1], dist / drag.current.pinchDist);
      }
      drag.current.pinchDist = dist;
      drag.current.moved = true;
      return;
    }
    const dx = x - drag.current.lastX, dy = y - drag.current.lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
    if (drag.current.moved) {
      viewRef.current.tx += dx;
      viewRef.current.ty += dy;
      needsDraw.current = true;
    }
    drag.current.lastX = x; drag.current.lastY = y;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    drag.current.pinchDist = null;
    if (!drag.current.moved) {
      const [x, y] = localXY(e);
      const hit = hitTest(x, y);
      setSelectedId(hit ? hit.id : null);
      needsDraw.current = true;
    }
  };

  const zoomAt = useCallback((sx: number, sy: number, factor: number) => {
    const v = viewRef.current;
    const k2 = Math.max(0.4, Math.min(200, v.k * factor));
    const real = k2 / v.k;
    viewRef.current = {
      k: k2,
      tx: sx - (sx - v.tx) * real,
      ty: sy - (sy - v.ty) * real
    };
    needsDraw.current = true;
  }, []);

  // wheel zoom — non-passive so the PAGE never scrolls over the map
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0016));
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  }, [zoomAt, cur]);

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
  const noShape = floorRooms.filter((r) => !regions.has(r.id));

  // legend entries for the active coloring
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

      {/* ---- exactly two friendly controls + Filters ---- */}
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

      {/* ---- the map ---- */}
      <div className="card mapcard" ref={wrapRef}>
        <canvas ref={canvasRef} className="floorcv2"
          onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onPointerLeave={() => { hoverRef.current.id = null; }}
        />
        <div className="zoomctl">
          <button aria-label="Zoom in" onClick={() => {
            const cv = canvasRef.current!;
            zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1.35);
          }}>+</button>
          <button aria-label="Zoom out" onClick={() => {
            const cv = canvasRef.current!;
            zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, 1 / 1.35);
          }}>−</button>
          <button aria-label="Fit whole floor" className="fitbtn" onClick={() => fitView(worldBounds, true)}>⤢</button>
        </div>
      </div>

      {noShape.length > 0 && (
        <div className="nolabel">
          <span>No spot on the map for: </span>
          {noShape.map((r) => (
            <span key={r.id} className="chiplink" tabIndex={0}
              onClick={() => ui.openRoom(r.id)}
              onKeyDown={(e) => { if (e.key === "Enter") ui.openRoom(r.id); }}>{r.name}</span>
          ))}
        </div>
      )}

      <div className="maplegend">
        {legend.map(([label, color]) => (
          <span className="li" key={label}><span className="sw" style={{ background: color }} /><span>{label}</span></span>
        ))}
      </div>

      {/* ---- filters slide-over (power users) ---- */}
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

      {editRoomId && <RoomDrawer roomId={editRoomId} onClose={() => setEditRoomId(null)} />}
    </div>
  );
}
