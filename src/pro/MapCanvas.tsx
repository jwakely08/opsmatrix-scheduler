// The pan/zoom floor-plan canvas — shared by Max Schedules' Map, Max Space's
// Map View, and the Floor Care / Sanitation / Policing map pickers. Pinch,
// wheel and drag to move; tap slop is bigger for touch so real thumbs can
// select rooms.
import React, { useEffect, useRef, useState } from "react";
import { boundsOf, pointIn, type ClassicData, type ClassicPlan, type ClassicSpace } from "./classicStore";
import { buildingArtUrl } from "./buildingArt";

const WALL_STROKE = 13;

// ── building-first hierarchy (Josh, 2026-08-31): every map view selects the
// BUILDING first, then that building's floor plans — and the chosen building
// is remembered across pages so the title in the corner always tells the
// manager whose floors they're editing. ─────────────────────────────────────

export const MAP_BUILDING_KEY = "om_map_building";

export function planBuilding(p: { building?: unknown }): string {
  return String(p.building ?? "").trim();
}

/** distinct buildings across the plans, in first-seen order ("" = unfiled) */
export function planBuildings(plans: { building?: unknown }[]): string[] {
  return [...new Set(plans.map(planBuilding))];
}

export function loadMapBuilding(): string | null {
  try { return sessionStorage.getItem(MAP_BUILDING_KEY); } catch { return null; }
}

export function saveMapBuilding(b: string | null) {
  try {
    if (b === null) sessionStorage.removeItem(MAP_BUILDING_KEY);
    else sessionStorage.setItem(MAP_BUILDING_KEY, b);
  } catch { /* storage off */ }
}

/** the full-width "pick a building" step that fronts every map view */
export function BuildingPicker({ plans, spaces, onPick, note, art }: {
  plans: ClassicPlan[];
  spaces: ClassicSpace[];
  onPick: (building: string) => void;
  note?: string;
  /** saved building-picture choices (buildingArtMap) — presets deal in automatically */
  art?: Record<string, string>;
}) {
  const buildings = planBuildings(plans);
  return (
    <div className="pro-empty buildpick">
      <h2>Which building?</h2>
      <p>{note ?? "Floor plans are filed by building. Pick one — then choose the floor."}</p>
      <div className="bcards">
        {buildings.map((b) => {
          const bPlans = plans.filter((p) => planBuilding(p) === b);
          const planIds = new Set(bPlans.map((p) => p.id));
          const roomCount = spaces.filter((sp) => planIds.has(String(sp.visualPlanId ?? ""))).length;
          return (
            <button key={b || "~none"} className="bcard" onClick={() => onPick(b)}>
              <span className="bcardimg" style={{ backgroundImage: `url(${buildingArtUrl(b, art ?? {})})` }} />
              <b>{b || "No building set"}</b>
              <span>{bPlans.length} floor plan{bPlans.length === 1 ? "" : "s"} · {roomCount} rooms drawn</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** the always-there corner badge: which building these floors belong to */
export function BuildingBadge({ building, onChange }: {
  building: string;
  onChange?: () => void;
}) {
  return (
    <div className="mapbuilding">
      <b>🏢 {building || "No building set"}</b>
      {onChange && <button className="plink" onClick={onChange}>change</button>}
    </div>
  );
}

// ── the map canvas (shared by Map + Spaces tabs, and Floor Care's builder) ──

export function MapCanvas({ plan, plans, onPlan, spaces, shapes, fillFor, overlayFor, flagFor, selectedId, onRoom, legend, mode, badge, onCanvas, marker }: {
  plan: NonNullable<ClassicData["plans"][0]>;
  plans: ClassicData["plans"];
  onPlan: (id: string) => void;
  spaces: ClassicSpace[];
  /** the persistent building title, top-right (BuildingBadge) */
  badge?: React.ReactNode;
  /** a tap that hit NO room, in plan coordinates (Max Sanitation's dock pin) */
  onCanvas?: (pt: { x: number; y: number }) => void;
  /** a dropped pin on the plan (Max Sanitation's sanitation dock) */
  marker?: { x: number; y: number; label: string } | null;
  shapes: Map<string, { pts: { x: number; y: number }[]; path: string; c: { x: number; y: number } }>;
  fillFor: (sp: ClassicSpace) => string;
  /** second schedule's color → the room renders two-tone striped */
  overlayFor?: (sp: ClassicSpace) => string | null;
  /** a small marker on the room (e.g. ⚠ when its tasks aren't all scheduled) */
  flagFor?: (sp: ClassicSpace) => string | null;
  selectedId: string | null;
  onRoom: (sp: ClassicSpace | null) => void;
  legend: React.ReactNode;
  mode: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  // once the user pans/zooms, resizes must never yank the view back —
  // iOS Safari fires a resize when its URL bar collapses mid-gesture
  const userDrove = useRef(false);
  // sx/sy = where the gesture STARTED: a tap is judged by total travel from
  // there, not per-event deltas. A fingertip naturally wobbles a few pixels,
  // so touch gets a much bigger tap slop than a mouse — without this, real
  // thumbs "click" rooms and nothing happens.
  const drag = useRef({ x: 0, y: 0, sx: 0, sy: 0, moved: false, on: false, slop: 5 });
  // live pointers — two fingers on a phone means pinch-zoom, not a tap
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; cx: number; cy: number } | null>(null);

  const zoomAt = (sx: number, sy: number, factor: number) => {
    userDrove.current = true;
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
    userDrove.current = false; // a new plan starts fitted
    fit();
    const ro = new ResizeObserver(() => { if (!userDrove.current) fit(); });
    ro.observe(svg);
    return () => ro.disconnect();
  }, [plan]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      userDrove.current = true;
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
    if (!hit && onCanvas && x >= 0 && y >= 0 && x <= plan.w && y <= plan.h) {
      onCanvas({ x, y });
      return;
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
            userDrove.current = true;
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
                  strokeWidth={WALL_STROKE} strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke" />
                {overlay && (
                  <path d={sh.path} fill={"url(#st-" + overlay.slice(1) + ")"}
                    stroke="none" style={{ pointerEvents: "none", opacity: 0.8 }} />
                )}
              </g>
            );
          })}
          {/* the matrix, rendered as the mockups envision it: the stored
              drawing stays a light blueprint (prints clean on paper), and
              the MAP inverts + colorizes it into glowing neon linework */}
          <image href={plan.img} width={plan.w} height={plan.h}
            className="planimg" style={{ pointerEvents: "none" }} />
          {marker && (
            <g className="mapmarker" transform={`translate(${marker.x} ${marker.y}) scale(${1 / Math.max(0.4, view.k)})`}>
              <circle r={13} />
              <text y={5}>📍</text>
              <text className="mklabel" y={30}>{marker.label}</text>
            </g>
          )}
          {spaces.map((sp) => {
            const sh = shapes.get(sp.id);
            if (!sh) return null;
            const b = boundsOf(sh.pts);
            if ((b.maxX - b.minX) * view.k < 44) return null;
            const mins = Number(sp.estimatedCleaningMinutes) || 0;
            return (
              <g key={"l" + sp.id} className="prolabel" transform={`translate(${sh.c.x} ${sh.c.y}) scale(${1 / Math.max(0.34, view.k)})`}>
                {flagFor?.(sp) && <text className="proflag" y={-22}>{flagFor(sp)}</text>}
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
      {badge}
      {legend}
      {/* touch-friendly zoom controls — pinch works too, but thumbs deserve buttons */}
      <div className="pro-zoomctl">
        <button aria-label="Zoom in" onClick={() => zoomCenter(1.35)}>＋</button>
        <button aria-label="Zoom out" onClick={() => zoomCenter(1 / 1.35)}>－</button>
        <button aria-label="Fit plan" onClick={() => {
          const svg = svgRef.current;
          if (!svg) return;
          userDrove.current = false;
          const w = svg.clientWidth || 1000, h = svg.clientHeight || 640;
          const k = Math.min(w / plan.w, h / plan.h) * 0.94;
          setView({ k, tx: (w - plan.w * k) / 2, ty: (h - plan.h * k) / 2 });
        }}>⤢</button>
      </div>
    </div>
  );
}

