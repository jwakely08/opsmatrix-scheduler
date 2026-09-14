// THE HOUSE MAP — the living floor plan, the HUD for everything. Rooms are
// rendered on the real plan as soft status tints with a thin gold outline on
// hover/selection; the verdict is a small lamp, never a giant color block.
// Pan/zoom/pinch logic is copied from the hospital MapCanvas (tap slop for
// thumbs, pinch = never a tap, resize never yanks a driven view back).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useApp, Shell, Lamp } from "./app";
import { type Space, statusFor, typeOf, assigneeOf, openWorkOrders, floorsOf } from "./store";
import { shapesFor, pointIn, boundsOf } from "./plan";
import { verdictFor } from "./verdict";
import { RoomDrawer } from "./RoomDrawer";

export type Layer = "verdict" | "condition" | "occupancy" | "engineering" | "attendant";
const LAYERS: { id: Layer; label: string }[] = [
  { id: "verdict", label: "Ready verdict" }, { id: "condition", label: "Cleaning" }, { id: "occupancy", label: "Occupancy" },
  { id: "engineering", label: "Engineering" }, { id: "attendant", label: "Who's on it" }
];
const TINT = {
  green: "rgba(79,122,91,.30)", yellow: "rgba(197,143,61,.34)", red: "rgba(158,59,54,.30)", unknown: "url(#hx-hatch)",
  gold: "rgba(184,148,90,.30)", sand: "rgba(217,205,184,.45)", none: "rgba(255,255,255,.0)", taupe: "rgba(122,110,98,.28)"
};
const STAFF_COLORS = ["#4F7A5B", "#B8945A", "#7A6E62", "#C58F3D", "#5B6E8C", "#8C5B7A", "#9E3B36", "#3B7A8C"];
const LAMP = { green: "#4F7A5B", yellow: "#C58F3D", red: "#9E3B36", unknown: "#8C8378" };

export function useShapes(spaces: Space[]) { return useMemo(() => shapesFor(spaces), [spaces]); }

export function MapCanvas({ plan, spaces, fillFor, lampFor, selectedId, onRoom, children, dimFor, bigFor }: {
  plan: { id: string; img: string; w: number; h: number };
  spaces: Space[];
  /** true = a guest room: show its NUMBER large in the serif; false = show its name small */
  bigFor?: (sp: Space) => boolean;
  fillFor: (sp: Space) => string;
  lampFor?: (sp: Space) => string | null;
  dimFor?: (sp: Space) => boolean;
  selectedId: string | null;
  onRoom: (sp: Space | null) => void;
  children?: React.ReactNode;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const shapes = useShapes(spaces);
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  const userDrove = useRef(false);
  const drag = useRef({ x: 0, y: 0, sx: 0, sy: 0, moved: false, on: false, slop: 5 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number } | null>(null);

  const fit = () => {
    const svg = svgRef.current; if (!svg) return;
    const w = svg.clientWidth || 1000, h = svg.clientHeight || 640;
    const k = Math.min(w / plan.w, h / plan.h) * 0.92;
    setView({ k, tx: (w - plan.w * k) / 2, ty: (h - plan.h * k) / 2 });
  };
  const zoomAt = (sx: number, sy: number, f0: number) => {
    userDrove.current = true;
    setView((v) => { const k2 = Math.max(0.2, Math.min(10, v.k * f0)); const f = k2 / v.k; return { k: k2, tx: sx - (sx - v.tx) * f, ty: sy - (sy - v.ty) * f }; });
  };
  const zoomCenter = (f: number) => { const svg = svgRef.current; if (svg) zoomAt(svg.clientWidth / 2, svg.clientHeight / 2, f); };

  useEffect(() => {
    userDrove.current = false; fit();
    const svg = svgRef.current; if (!svg) return;
    const ro = new ResizeObserver(() => { if (!userDrove.current) fit(); });
    ro.observe(svg);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id]);
  useEffect(() => {
    const svg = svgRef.current; if (!svg) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const r = svg.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015)); };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  function click(e: React.PointerEvent) {
    if (drag.current.moved) return;
    const svg = svgRef.current!; const r = svg.getBoundingClientRect();
    const x = (e.clientX - r.left - view.tx) / view.k, y = (e.clientY - r.top - view.ty) / view.k;
    let hit: Space | null = null, hitArea = Infinity;
    for (const sp of spaces) {
      const sh = shapes.get(sp.id); if (!sh || !pointIn(sh.pts, x, y)) continue;
      const b = boundsOf(sh.pts); const a = (b.maxX - b.minX) * (b.maxY - b.minY);
      if (a < hitArea) { hit = sp; hitArea = a; }
    }
    onRoom(hit);
  }

  return (
    <div className="map-wrap">
      <svg ref={svgRef} className="map-svg"
        onPointerDown={(e) => {
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* fine */ }
          if (pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) }; drag.current.on = false; drag.current.moved = true; }
          else drag.current = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, on: true, slop: e.pointerType === "touch" ? 14 : 5 };
        }}
        onPointerMove={(e) => {
          if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pinch.current && pointers.current.size >= 2) {
            const [a, b] = [...pointers.current.values()]; const dist = Math.hypot(a.x - b.x, a.y - b.y);
            if (dist > 0 && pinch.current.dist > 0) { const r = svgRef.current!.getBoundingClientRect(); zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, dist / pinch.current.dist); }
            pinch.current.dist = dist; return;
          }
          if (!drag.current.on) return;
          const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
          if (Math.hypot(e.clientX - drag.current.sx, e.clientY - drag.current.sy) > drag.current.slop) drag.current.moved = true;
          if (drag.current.moved) { userDrove.current = true; setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy })); drag.current.x = e.clientX; drag.current.y = e.clientY; }
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId); if (pointers.current.size < 2) pinch.current = null; drag.current.on = false;
          if (pointers.current.size === 0) { click(e); setTimeout(() => { drag.current.moved = false; }, 0); }
        }}
        onPointerCancel={(e) => { pointers.current.delete(e.pointerId); if (pointers.current.size < 2) pinch.current = null; drag.current.on = false; }}>
        <defs>
          <pattern id="hx-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="8" fill="rgba(140,131,120,.10)" /><rect width="3" height="8" fill="rgba(140,131,120,.32)" />
          </pattern>
        </defs>
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
          <image href={plan.img} width={plan.w} height={plan.h} style={{ pointerEvents: "none" }} />
          {spaces.map((sp) => {
            const sh = shapes.get(sp.id); if (!sh) return null;
            const dim = dimFor?.(sp) ?? false;
            return (
              <g key={sp.id} className={"hroom" + (sp.id === selectedId ? " sel" : "") + (dim ? " dim" : "")}>
                <path d={sh.path} fill={fillFor(sp)} stroke={sp.id === selectedId ? "#B8945A" : "rgba(184,148,90,.0)"} strokeWidth={2} vectorEffect="non-scaling-stroke" />
              </g>
            );
          })}
          {spaces.map((sp) => {
            const sh = shapes.get(sp.id); if (!sh) return null;
            const b = boundsOf(sh.pts);
            const w = b.maxX - b.minX, h = b.maxY - b.minY;
            if (Math.min(w, h) * view.k < 16) return null;
            const lamp = lampFor?.(sp) ?? null;
            const isGuest = bigFor ? bigFor(sp) : /^\d/.test(sp.number);
            // labels live at PLAN scale (like ink on a printed plan): sized to the room, never overlapping neighbours
            const fs = isGuest ? Math.min(22, w * 0.4, h * 0.3) : Math.min(11, w * 0.16);
            const showName = !isGuest && (w * view.k > 60 || sp.name.length <= 6);
            return (
              <g key={"l" + sp.id} className="hlabel" transform={`translate(${sh.c.x} ${sh.c.y})`}>
                {lamp && <circle className="lamp-svg" cx={0} cy={-fs * 0.95} r={Math.max(3, fs * 0.22)} fill={lamp} />}
                {(isGuest || showName) && <text y={isGuest ? fs * 0.35 : fs * 0.35} style={{ fontSize: fs, fontFamily: isGuest ? undefined : "var(--sans)", fontWeight: 600 }}>{isGuest ? sp.number : sp.name}</text>}
              </g>
            );
          })}
        </g>
      </svg>
      {children}
      <div className="map-zoom">
        <button aria-label="Zoom in" onClick={() => zoomCenter(1.35)}>＋</button>
        <button aria-label="Zoom out" onClick={() => zoomCenter(1 / 1.35)}>－</button>
        <button aria-label="Fit" onClick={() => { userDrove.current = false; fit(); }}>⤢</button>
      </div>
    </div>
  );
}

export function HouseMapView() {
  const { state, now, params, go } = useApp();
  const floors = floorsOf(state);
  const [floor, setFloor] = useState<string>(params.floor ?? (floors.includes("4") ? "4" : floors[0] ?? ""));
  const [layer, setLayer] = useState<Layer>("verdict");
  const [sel, setSel] = useState<string | null>(params.room ? (state.spaces.find((s) => s.number === params.room)?.id ?? null) : null);
  const plan = state.plans.find((p) => p.floor === floor);
  const spaces = state.spaces.filter((s) => s.floor === floor);
  const staffColor = (id: string) => STAFF_COLORS[Math.max(0, state.staff.findIndex((s) => s.id === id)) % STAFF_COLORS.length];

  const fillFor = (sp: Space) => {
    const st = statusFor(state, sp.id); const t = typeOf(state, sp);
    if (layer === "verdict") {
      if (t?.kind !== "guest") return TINT.none;
      return TINT[verdictFor(state, sp, now).level];
    }
    if (layer === "condition") {
      const c = st.condition?.value;
      return c === "dirty" ? TINT.red : c === "in_progress" ? TINT.yellow : c === "clean" ? TINT.gold : c === "inspected" ? TINT.green : c === "pickup" ? TINT.yellow : TINT.unknown;
    }
    if (layer === "occupancy") {
      const o = st.occupancy?.value;
      return o === "arriving" ? TINT.gold : o === "stayover" || o === "occupied" ? TINT.sand : o === "departing" ? TINT.taupe : TINT.none;
    }
    if (layer === "engineering") {
      if (st.engineering?.ooo) return TINT.red;
      return openWorkOrders(state, sp.id).length ? TINT.yellow : TINT.none;
    }
    const who = assigneeOf(state, sp.id);
    return who ? staffColor(who.id) + "66" : TINT.none;
  };
  const lampFor = (sp: Space) => (typeOf(state, sp)?.kind === "guest" ? LAMP[verdictFor(state, sp, now).level] : null);
  const selected = sel ? state.spaces.find((s) => s.id === sel) ?? null : null;

  const legend = layer === "verdict" ? [["green", "Ready — walk"], ["yellow", "Hold"], ["red", "Do not walk"], ["unknown", "Unknown"]]
    : layer === "condition" ? [["red", "Dirty"], ["yellow", "Being cleaned / pickup"], ["gold", "Clean"], ["green", "Inspected"], ["unknown", "Not confirmed"]]
    : layer === "occupancy" ? [["gold", "Arriving"], ["sand", "Stayover"], ["taupe", "Departing"], ["none", "Vacant"]]
    : layer === "engineering" ? [["red", "Out of order"], ["yellow", "Open work order"]]
    : state.staff.filter((s) => s.role === "attendant" || s.role === "engineering").map((s) => [staffColor(s.id), s.name.split(" ")[0]]);

  return (
    <Shell title="House map" flush actions={
      <div className="seg">{LAYERS.map((l) => <button key={l.id} className={layer === l.id ? "on" : ""} onClick={() => setLayer(l.id)}>{l.label}</button>)}</div>
    }>
      {!plan ? (
        <div className="empty"><h2>No floor plan yet</h2><p>Import a room list under Rooms & spaces, or open the demo hotel from Settings.</p></div>
      ) : (
        <MapCanvas plan={plan} spaces={spaces} fillFor={fillFor} lampFor={lampFor} bigFor={(sp) => typeOf(state, sp)?.kind === "guest"} selectedId={sel} onRoom={(sp) => setSel(sp?.id ?? null)}>
          <div className="floors">
            {[...floors].reverse().map((f) => <button key={f} className={f === floor ? "on" : ""} onClick={() => { setFloor(f); setSel(null); }}>{f}</button>)}
          </div>
          <div className="map-legend">
            {legend.map(([k, label]) => (
              <span key={String(k)}>
                {k in LAMP ? <Lamp level={k as "green"} /> : <i style={{ width: 12, height: 12, borderRadius: 3, background: String(k).startsWith("#") ? String(k) : (TINT as Record<string, string>)[String(k)] === TINT.none ? "#fff" : (TINT as Record<string, string>)[String(k)], border: "1px solid var(--tan)", display: "inline-block" }} />}
                {label}
              </span>
            ))}
          </div>
        </MapCanvas>
      )}
      {selected && <RoomDrawer space={selected} onClose={() => setSel(null)} onCapture={() => go("walk", { room: selected.number })} />}
    </Shell>
  );
}
