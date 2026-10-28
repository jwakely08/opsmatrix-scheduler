// The pan/zoom floor-plan canvas — shared by Max Schedules' Map, Max Space's
// Map View, and the Floor Care / Sanitation / Policing map pickers. Pinch,
// wheel and drag to move; tap slop is bigger for touch so real thumbs can
// select rooms.
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { boundsOf, pointIn, type ClassicData, type ClassicPlan, type ClassicSpace } from "./classicStore";
import { buildingArtUrl } from "./buildingArt";
import { sortFloorsTopDown } from "./floorOrder";
import { neonPlanUrl } from "./neonMap";
import { Map3D, type Map3DApi } from "./Map3D";
import {
  FACING_WORDS, askCompass, compassWord, delta, loadFacing, loadPlanUp, mapTurn, northOnScreen, saveFacing,
  savePlanUp, smooth, watchHeading, type MapFacing
} from "./compass";

const WALL_STROKE = 13;

/** the 3D showcase toggle sticks for the session, across every map page */
export const MAP_3D_KEY = "om_map_3d";
function load3d(): boolean {
  try { return sessionStorage.getItem(MAP_3D_KEY) === "1"; } catch { return false; }
}
function save3d(on: boolean) {
  try { sessionStorage.setItem(MAP_3D_KEY, on ? "1" : "0"); } catch { /* storage off */ }
}

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

export function MapCanvas({ plan, plans, onPlan, spaces, shapes, fillFor, outlines, overlayFor, flagFor, selectedId, onRoom, legend, mode, badge, onCanvas, marker, keepView, follow, compass }: {
  /** offer the compass: the floor can face north, or turn with the walker (Max Space, Rover) */
  compass?: boolean;
  /** the view is the user's from the first fit on: a resize never refits (Rover's room card
   *  opening under the map, Josh 2026-10-28: "it zooms back out… I lose track of which room") */
  keepView?: boolean;
  /** keep this room in sight — when it changes, or the map is resized, slide it into view
   *  without touching the zoom */
  follow?: string | null;
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
  /** department borders in plan pixels, rendered above the plan, under the
   *  labels: solid runs on the rooms' own walls; a run carrying TWO colors
   *  is a wall two departments share, drawn hatched between them */
  outlines?: { pts: { x: number; y: number }[]; color: string; color2?: string; closed?: boolean }[];
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
  // the 3D showcase view (Josh, 2026-09-04): same data, same colors, same
  // taps — the rooms just stand up
  const [view3d, setView3d] = useState(load3d);
  const map3dApi = useRef<Map3DApi | null>(null);
  // the matrix image is BAKED (neonMap.ts) — live CSS filter+blend washed out
  // on iOS Safari; until the bake lands we show the plain plan, not a broken one
  const [neon, setNeon] = useState<string | null>(null);
  // canvas width drives how small a room can be and still carry its label —
  // a phone fitting the whole floor deserves labels too, just sooner-smaller
  const [mapW, setMapW] = useState(1000);
  useEffect(() => {
    let live = true;
    setNeon(null);
    neonPlanUrl(plan.img).then((u) => { if (live) setNeon(u); }).catch(() => { /* plain plan stands */ });
    return () => { live = false; };
  }, [plan.img]);
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

  // ── which way the map faces (compass.ts; Josh, 2026-10-28): as drawn, north up, or turning
  // with the walker like Google Maps. The pan/zoom math stays in the un-turned frame; screen
  // points come back through `unturn`, and the drawing turns around the map's middle. ─────────
  const building = String(plan.building ?? "").trim();
  const [facing, setFacing] = useState<MapFacing>(loadFacing);
  const [planUp, setPlanUp] = useState<number | null>(() => loadPlanUp(building));
  useEffect(() => { setPlanUp(loadPlanUp(building)); }, [building]);
  const [heading, setHeading] = useState<number | null>(null);
  const [compassMenu, setCompassMenu] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [compassNote, setCompassNote] = useState("");
  const facingRef = useRef(facing);
  facingRef.current = facing;
  const planUpRef = useRef(planUp);
  planUpRef.current = planUp;
  const listening = Boolean(compass) && !view3d && ((facing === "heading" && planUp !== null) || calibrating);
  useEffect(() => {
    if (!listening) return;
    let eased: number | null = null, shown = NaN, raf = 0;
    const stop = watchHeading((h) => {
      eased = smooth(eased, h);
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (eased !== null && !(Math.abs(delta(shown, eased)) < 0.7)) {
          shown = eased;
          // the pivot's view change lands in the same render as the turn (React batches them)
          pivotRef.current(mapTurn(facingRef.current, planUpRef.current, eased));
          setHeading(eased);
        }
      });
    });
    return () => { stop(); cancelAnimationFrame(raf); };
  }, [listening]);
  useEffect(() => {
    if (!calibrating || heading !== null) return;
    const t = setTimeout(() => setCompassNote(NO_COMPASS), 3500);
    return () => clearTimeout(t);
  }, [calibrating, heading]);
  const turn2d = compass ? mapTurn(facing, planUp, heading) : 0;
  const turn = view3d ? 0 : turn2d;
  const turnRef = useRef(turn);
  turnRef.current = turn;
  const [mapH, setMapH] = useState(640);
  const centerRef = useRef({ x: 500, y: 320 });
  centerRef.current = { x: mapW / 2, y: mapH / 2 };
  /** a screen point (or, with `vec`, a movement) in the un-turned frame the pan/zoom math uses */
  const unturn = (x: number, y: number, vec = false, by = -turnRef.current) => {
    if (!by) return { x, y };
    const a = (by * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const o = vec ? { x: 0, y: 0 } : centerRef.current;
    const dx = x - o.x, dy = y - o.y;
    return { x: o.x + dx * c - dy * s, y: o.y + dx * s + dy * c };
  };
  /** an un-turned point as it shows on the screen */
  const onScreen = (x: number, y: number) => unturn(x, y, false, turnRef.current);
  const unturnRef = useRef(unturn);
  unturnRef.current = unturn;
  const chooseFacing = (f: MapFacing) => {
    setFacing(f);
    saveFacing(f);
    setCompassNote("");
    if (f === "plan") { setCompassMenu(false); return; }
    // the building's north comes first; turning with the walker needs the compass
    if (planUp === null) { startCalibrating(); return; }
    if (f === "heading") void askCompass().then((ok) => { if (!ok) setCompassNote(NO_COMPASS); });
    setCompassMenu(false);
  };
  const startCalibrating = () => {
    // asked inside the tap: iPad Safari only shares the compass from one
    void askCompass().then((ok) => {
      if (!ok) { setCompassNote(NO_COMPASS); return; }
      setHeading(null);
      setCompassNote("");
      setCalibrating(true);
      setCompassMenu(false);
    });
  };

  const zoomAt = (sx: number, sy: number, factor: number) => {
    userDrove.current = true;
    const p = unturn(sx, sy);
    setView((v) => {
      const k2 = Math.max(0.2, Math.min(12, v.k * factor));
      const f = k2 / v.k;
      return { k: k2, tx: p.x - (p.x - v.tx) * f, ty: p.y - (p.y - v.ty) * f };
    });
  };
  const zoomCenter = (factor: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    zoomAt(svg.clientWidth / 2, svg.clientHeight / 2, factor);
  };

  // ── following a room: slide it into sight, zoom untouched ──────────────────
  const viewRef = useRef(view);
  viewRef.current = view;
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;
  const followRef = useRef(follow ?? null);
  followRef.current = follow ?? null;
  const keepViewRef = useRef(Boolean(keepView));
  keepViewRef.current = Boolean(keepView);
  const panAnim = useRef(0);
  const ensureVisible = (id: string) => {
    const svg = svgRef.current;
    const sh = shapesRef.current.get(id);
    if (!svg || !sh) return;
    const w = svg.clientWidth, h = svg.clientHeight;
    const v = viewRef.current;
    const b = boundsOf(sh.pts);
    const m = 28;
    // the room's corners as they show on screen (the map may be turned)
    const corners = [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]]
      .map(([x, y]) => onScreen(v.tx + x * v.k, v.ty + y * v.k));
    const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
    if (Math.min(...xs) >= m && Math.max(...xs) <= w - m && Math.min(...ys) >= m && Math.max(...ys) <= h - m) return; // in sight
    const c = onScreen(v.tx + sh.c.x * v.k, v.ty + sh.c.y * v.k);
    const { x: dx, y: dy } = unturn(w / 2 - c.x, h / 2 - c.y, true);
    // a short glide, so the eye can follow where the room went
    cancelAnimationFrame(panAnim.current);
    const t0 = performance.now(), dur = 240;
    let done = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - (1 - p) * (1 - p);
      const f = eased - done;
      done = eased;
      setView((cur) => ({ ...cur, tx: cur.tx + dx * f, ty: cur.ty + dy * f }));
      if (p < 1) panAnim.current = requestAnimationFrame(step);
    };
    panAnim.current = requestAnimationFrame(step);
  };
  const ensureRef = useRef(ensureVisible);
  ensureRef.current = ensureVisible;
  useEffect(() => {
    if (!follow) return;
    // after the layout settles (a card opening under the map shrinks it)
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => ensureRef.current(follow)); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [follow]);
  useEffect(() => () => cancelAnimationFrame(panAnim.current), []);

  // ── a turning floor pivots on the walker — the room being worked (where they stand now), else
  // the YOU pin, whichever is in sight (Google Maps turns around its blue dot) — so it never
  // swings off the screen; with neither in sight it turns on the middle ──────────────────────
  const markerRef = useRef(marker ?? null);
  markerRef.current = marker ?? null;
  const pivotTurn = useRef(turn2d); // the turn the view was last squared with
  const pivot = (to: number) => {
    const from = pivotTurn.current;
    pivotTurn.current = to;
    const svg = svgRef.current;
    if (from === to || !svg || view3d) return;
    const id = followRef.current;
    const spots = [id ? shapesRef.current.get(id)?.c : undefined, markerRef.current]
      .filter((p): p is { x: number; y: number } => Boolean(p));
    if (!spots.length) return;
    const w = svg.clientWidth, h = svg.clientHeight;
    setView((v) => {
      for (const p of spots) {
        const u = { x: v.tx + p.x * v.k, y: v.ty + p.y * v.k }; // un-turned
        const s = unturnRef.current(u.x, u.y, false, from); // where it shows now
        if (s.x < 0 || s.y < 0 || s.x > w || s.y > h) continue;
        const u2 = unturnRef.current(s.x, s.y, false, -to); // where it has to sit to stay put
        return { ...v, tx: v.tx + u2.x - u.x, ty: v.ty + u2.y - u.y };
      }
      return v;
    });
  };
  const pivotRef = useRef(pivot);
  pivotRef.current = pivot;
  useLayoutEffect(() => { pivotRef.current(turn2d); }, [turn2d]);

  /** the whole floor in sight, centred — a turned floor needs the room its turned corners take */
  const fitView = (w: number, h: number) => {
    const a = (turnRef.current * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
    const k = Math.min(w / (plan.w * c + plan.h * s), h / (plan.w * s + plan.h * c)) * 0.94;
    return { k, tx: (w - plan.w * k) / 2, ty: (h - plan.h * k) / 2 };
  };
  // a floor nobody has moved fits again when it takes a new facing (turned, it's another shape)
  const fittedFacing = useRef(`${facing}|${planUp}`);
  useLayoutEffect(() => {
    const was = fittedFacing.current;
    fittedFacing.current = `${facing}|${planUp}`;
    const svg = svgRef.current;
    if (!compass || was === fittedFacing.current || !svg || view3d || userDrove.current || keepViewRef.current) return;
    setView(fitView(svg.clientWidth || 1000, svg.clientHeight || 640));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing, planUp]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const fit = () => setView(fitView(svg.clientWidth || 1000, svg.clientHeight || 640));
    userDrove.current = false; // a new plan starts fitted
    fit();
    setMapW(svg.clientWidth || 1000);
    setMapH(svg.clientHeight || 640);
    const ro = new ResizeObserver(() => {
      setMapW(svg.clientWidth || 1000);
      setMapH(svg.clientHeight || 640);
      if (!userDrove.current && !keepViewRef.current) fit();
      if (followRef.current) ensureRef.current(followRef.current);
    });
    ro.observe(svg);
    return () => ro.disconnect();
    // identity, not object: `plan` is rebuilt on EVERY commit, and refitting
    // then yanked the zoom out after each room tap while assigning a
    // schedule (Josh, production, 2026-09-25). Refit only when the floor
    // actually changes (or a remodel re-ships new dimensions on the same id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id, plan.w, plan.h]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      userDrove.current = true;
      const r = svg.getBoundingClientRect();
      const p = unturnRef.current(e.clientX - r.left, e.clientY - r.top);
      setView((v) => {
        const k2 = Math.max(0.2, Math.min(12, v.k * Math.exp(-e.deltaY * 0.0015)));
        const f = k2 / v.k;
        return { k: k2, tx: p.x - (p.x - v.tx) * f, ty: p.y - (p.y - v.ty) * f };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  function click(e: React.PointerEvent) {
    if (drag.current.moved) return;
    const svg = svgRef.current!;
    const r = svg.getBoundingClientRect();
    const p = unturn(e.clientX - r.left, e.clientY - r.top);
    const x = (p.x - view.tx) / view.k;
    const y = (p.y - view.ty) / view.k;
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
      {view3d ? (
        <Map3D plan={plan} spaces={spaces} shapes={shapes} fillFor={fillFor}
          overlayFor={overlayFor} flagFor={flagFor} selectedId={selectedId}
          onRoom={onRoom} onCanvas={onCanvas} marker={marker}
          groundSrc={neon ?? plan.img} api={map3dApi} keepView={keepView} follow={follow} />
      ) : (
      <svg ref={svgRef} className="pro-map"
        onPointerDown={(e) => {
          cancelAnimationFrame(panAnim.current); // a finger on the map stops any glide
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
            const d = unturn(dx, dy, true);
            setView((v) => ({ ...v, tx: v.tx + d.x, ty: v.ty + d.y }));
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
        <g transform={turn ? `rotate(${turn} ${mapW / 2} ${mapH / 2})` : undefined}>
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
          <image href={neon ?? plan.img} width={plan.w} height={plan.h}
            className={neon ? "planneon" : "planimg"} style={{ pointerEvents: "none" }} />
          {/* department borders: on the rooms' own walls; a wall two
              departments share draws ONCE, hatched between their colors */}
          {outlines?.map((o, i) => {
            const d = o.pts.map((p, k) => `${k === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ") + (o.closed ? " Z" : "");
            return o.color2 ? (
              <g key={"dept-border-" + i} className="deptborder">
                <path d={d} fill="none" stroke={o.color} strokeWidth={5}
                  strokeLinejoin="round" strokeLinecap="butt" strokeDasharray="10 10"
                  vectorEffect="non-scaling-stroke" />
                <path d={d} fill="none" stroke={o.color2} strokeWidth={5}
                  strokeLinejoin="round" strokeLinecap="butt" strokeDasharray="10 10"
                  strokeDashoffset={10} vectorEffect="non-scaling-stroke" />
              </g>
            ) : (
              <path key={"dept-border-" + i} className="deptborder" d={d}
                fill="none" stroke={o.color} strokeWidth={5}
                strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            );
          })}
          {marker && (
            <g className="mapmarker" transform={`translate(${marker.x} ${marker.y})${turn ? ` rotate(${-turn})` : ""} scale(${1 / Math.max(0.4, view.k)})`}>
              <circle r={13} />
              <text y={5}>📍</text>
              <text className="mklabel" y={30}>{marker.label}</text>
            </g>
          )}
          {spaces.map((sp) => {
            const sh = shapes.get(sp.id);
            if (!sh) return null;
            const b = boundsOf(sh.pts);
            // a phone fitting the whole floor renders every room small — on a
            // narrow canvas, labels appear sooner so the map reads like desktop
            if ((b.maxX - b.minX) * view.k < (mapW < 700 ? 24 : 44)) return null;
            const mins = Number(sp.estimatedCleaningMinutes) || 0;
            return (
              <g key={"l" + sp.id} className="prolabel" transform={`translate(${sh.c.x} ${sh.c.y})${turn ? ` rotate(${-turn})` : ""} scale(${1 / Math.max(0.34, view.k)})`}>
                {flagFor?.(sp) && <text className="proflag" y={-22}>{flagFor(sp)}</text>}
                <text y={-4}>{sp.roomNumber || sp.roomName}</text>
                <text className="sub" y={12}>{Math.round(Number(sp.squareFeet) || 0)} ft² · {mins}m</text>
              </g>
            );
          })}
        </g>
        </g>
      </svg>
      )}
      {plans.length > 1 && (
        <div className="floorstack">
          {sortFloorsTopDown(plans).map((p) => (
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
        <button aria-label="Zoom in"
          onClick={() => view3d ? map3dApi.current?.zoom(1.35) : zoomCenter(1.35)}>＋</button>
        <button aria-label="Zoom out"
          onClick={() => view3d ? map3dApi.current?.zoom(1 / 1.35) : zoomCenter(1 / 1.35)}>－</button>
        <button aria-label="Fit plan" onClick={() => {
          if (view3d) { map3dApi.current?.fit(); return; }
          const svg = svgRef.current;
          if (!svg) return;
          userDrove.current = false;
          setView(fitView(svg.clientWidth || 1000, svg.clientHeight || 640));
        }}>⤢</button>
        <button aria-label={view3d ? "Flat view" : "3D view"}
          className={"map3dbtn" + (view3d ? " on" : "")}
          onClick={() => setView3d((v) => { save3d(!v); return !v; })}>
          {view3d ? "2D" : "3D"}
        </button>
      </div>
      {/* the compass has its own corner, top-left: the zoom stack already meets the floor list
          when Rover's room card shortens the map */}
      {compass && !view3d && (
        <div className="pro-compass">
          <button aria-label={"Which way the map faces: " + FACING_WORDS[facing]} title={FACING_WORDS[facing]}
            className={"compassbtn" + (facing !== "plan" && planUp !== null ? " on" : "")}
            onClick={() => { setCompassMenu((m) => !m); setCompassNote(""); }}>
            {/* the needle points at real north once the building's north is set */}
            <svg viewBox="0 0 20 20" width="22" height="22"
              style={{ transform: `rotate(${northOnScreen(turn, planUp) ?? 0}deg)`, opacity: planUp === null ? 0.5 : 1 }}>
              <path d="M10 1.5 L13.2 10 L10 8.8 L6.8 10 Z" fill="#ef4444" />
              <path d="M10 18.5 L13.2 10 L10 11.2 L6.8 10 Z" fill="#cbd5e1" />
            </svg>
          </button>
          {compassMenu && (
            <div className="compassmenu">
              <b>Map faces</b>
              {(["plan", "north", "heading"] as MapFacing[]).map((f) => (
                <button key={f} className={"pbtn small" + (facing === f ? " primary" : "")} onClick={() => chooseFacing(f)}>
                  {FACING_WORDS[f]}
                </button>
              ))}
              <button className="plink" onClick={startCalibrating}>
                {planUp === null ? "Set north" : "Set north again"} for {building || "this building"}…
              </button>
              {compassNote && <p className="warntext">{compassNote}</p>}
            </div>
          )}
        </div>
      )}
      {compass && calibrating && (
        <div className="compasscal">
          <b>Set north for {building || "this building"}</b>
          <p>
            Hold the iPad flat and point the top of the screen the way the top of this floor plan points —
            for example, stand looking down a hallway that runs straight up the screen. Then tap Set.
          </p>
          <p className="compassreading">
            {heading === null ? "Waiting for the compass…" : `Facing ${Math.round(heading)}° ${compassWord(heading)}`}
          </p>
          {compassNote && <p className="warntext">{compassNote}</p>}
          <div className="prow">
            <button className="pbtn primary" disabled={heading === null} onClick={() => {
              if (heading === null) return;
              savePlanUp(building, heading);
              setPlanUp(heading);
              setCalibrating(false);
              if (facing === "plan") { setFacing("north"); saveFacing("north"); }
            }}>Set</button>
            <button className="pbtn" onClick={() => { setCalibrating(false); setCompassNote(""); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

const NO_COMPASS = "No compass reading here — North up and Turns with me need a device with a compass (an iPad or phone) and motion access allowed.";

