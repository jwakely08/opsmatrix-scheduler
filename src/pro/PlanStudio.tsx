// THE CALIBRATION EDITOR (Josh's 16-step spec, 2026-08-28 late night).
// One tool, one sequence, every time:
//
//   DRAW PHASE — the plan is on screen. Trace a room you know (rough corner
//   taps; the ported snap engine seats it on the walls), THEN type its
//   square footage: that's a calibration anchor. Repeat for as many rooms
//   as you like — every anchor feeds the eventual measuring. Only then does
//   "✨ Max draws the rest" arm: Max mimics the plan with drawn boxes laid
//   over it. Those boxes are NOT data yet — the user confirms them: click
//   to select, SHIFT-click to select several, "Select all of Max's boxes",
//   drag the puzzle pieces into place, and ⌖ Snap again as the double-check.
//
//   ✓ CONFIRM MATRIX — the boxes lock, every square footage is computed
//   from the calibration, and the canvas switches to the FINAL matrix-style
//   rendering (the same drawing every other import produces).
//
//   DETAILS PHASE — still in the editor: select each room and enter what
//   Max Space needs — room number, name, room type, floor type, fixtures,
//   and DEPARTMENT (account/building/floor were set at upload; department
//   is chosen here, per room). Then 🚀 SHIP TO MAX SPACE files everything
//   into the hierarchy: account → building → floor → department → room.
//
// Every set ships as an editable CALIBRATION SET (studioSets.ts): reopen it
// any time from Max Space → Calibration Editor, move boxes after a remodel,
// re-ship — and the SAME rooms update, schedules intact.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  buildGray, snapToWalls, shoelacePx, centroid, autoDetectRooms, type Gray, type XY
} from "./planSnap";
import { calibrateFromKnownRooms } from "./planCalibrate";
import {
  buildPlanFromRooms, readPlanMultiPass, AiPlanError,
  type ImportResult, type AiRoom, type DrawingBox
} from "../bridge/aiPlanImport";
import { loadImageEl, cropClean } from "./planImagePrep";
import {
  saveStudioSet, loadStudioSets, deleteStudioSet, applyStudioShip, applyStudioUpdate,
  type StudioSet, type StudioShapeData
} from "./studioSets";
import { loadApiKey, loadClassic, saveClassic, FLOOR_TYPES, type ClassicData } from "./classicStore";
import { aiProxy } from "./aiTransport";
import type { Rules } from "./rules";

export interface StudioPicture { dataUrl: string; width: number; height: number; aspect: number }

type Shape = StudioShapeData;
type Phase = "draw" | "details";

const uid = () => "shape-" + Math.random().toString(36).slice(2, 9);
const TRACED = "#14b8a6";
const AI = "#f59e0b";

function pointIn(pts: XY[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if ((pts[i].y > y) !== (pts[j].y > y) &&
      x < ((pts[j].x - pts[i].x) * (y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside;
  }
  return inside;
}

export function PlanStudio({ picture, account, building, floor, rules, existingSet, onShipped, onCancel }: {
  picture: StudioPicture;
  account: string;
  building: string;
  floor: string;
  rules: Rules;
  /** re-editing a saved calibration set (remodels) — ships onto the SAME rooms */
  existingSet?: StudioSet;
  onShipped: (roomCount: number, setSaved: boolean) => void;
  onCancel: () => void;
}) {
  const W = picture.width, H = picture.height;
  const [shapes, setShapes] = useState<Shape[]>(() =>
    existingSet ? JSON.parse(JSON.stringify(existingSet.shapes)) : []);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("draw");
  const [tool, setTool] = useState<"select" | "trace">(existingSet ? "select" : "trace");
  const [tracePts, setTracePts] = useState<XY[]>([]);
  const [gray, setGray] = useState<Gray | null>(null);
  const [matrix, setMatrix] = useState<{ img: string; w: number; h: number } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [err, setErr] = useState("");
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  const undoStack = useRef<Shape[][]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: "none" | "pan" | "shape"; x: number; y: number; moved: boolean }>(
    { kind: "none", x: 0, y: 0, moved: false });

  // datalist options come straight from what the account already holds
  const deptOptions = useMemo(() => {
    try {
      const v7 = JSON.parse(localStorage.getItem("opsmatrix_v7") ?? "{}") ?? {};
      return [...new Set(((v7.spaces ?? []) as { department?: string }[])
        .map((s) => String(s.department ?? "").trim()).filter(Boolean))].sort();
    } catch { return []; }
  }, []);

  // wall grid from the picture
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      setGray(buildGray(cv));
    };
    img.src = picture.dataUrl;
  }, [picture.dataUrl]);

  // fit whichever surface is showing (scan in draw phase, matrix in details)
  const surfW = phase === "details" && matrix ? matrix.w : W;
  const surfH = phase === "details" && matrix ? matrix.h : H;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth || 1000, h = el.clientHeight || 640;
      const k = Math.min(w / surfW, h / surfH) * 0.94;
      setView({ k, tx: (w - surfW * k) / 2, ty: (h - surfH * k) / 2 });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [surfW, surfH]);

  const graySc = gray ? gray.w / W : 1;
  const snapPx = useCallback((pts: XY[]): XY[] => {
    if (!gray) return pts;
    const scaled = pts.map((p) => ({ x: p.x * graySc, y: p.y * graySc }));
    return snapToWalls(gray, scaled).map((p) => ({ x: p.x / graySc, y: p.y / graySc }));
  }, [gray, graySc]);

  // ── calibration ────────────────────────────────────────────────────────────
  const calRooms = useMemo(() => shapes.map((s) => ({ id: s.id, visualPts: s.pts })), [shapes]);
  const anchors = useMemo(() =>
    shapes.filter((s) => (s.knownSqFt ?? 0) > 0).map((s) => ({ id: s.id, sqft: s.knownSqFt! })),
    [shapes]);
  const cal = useMemo(() => calibrateFromKnownRooms(calRooms, anchors), [calRooms, anchors]);
  const sqftOf = useCallback((s: Shape): number | null => {
    if ((s.knownSqFt ?? 0) > 0) return s.knownSqFt!;
    if (!cal) return null;
    return Math.round(shoelacePx(s.pts) / (cal.pxPerFt * cal.pxPerFt));
  }, [cal]);

  // ── mutations with undo ────────────────────────────────────────────────────
  const mutate = useCallback((next: Shape[] | ((prev: Shape[]) => Shape[])) => {
    setShapes((prev) => {
      undoStack.current.push(prev);
      if (undoStack.current.length > 60) undoStack.current.shift();
      return typeof next === "function" ? next(prev) : next;
    });
  }, []);
  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (prev) setShapes(prev);
  }, []);
  const patchShape = (id: string, patch: Partial<Shape>) =>
    setShapes((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const toPic = (e: { clientX: number; clientY: number }): XY => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.tx) / view.k, y: (e.clientY - r.top - view.ty) / view.k };
  };
  const zoomAt = (sx: number, sy: number, f: number) => setView((v) => {
    const k2 = Math.max(0.15, Math.min(14, v.k * f));
    const q = k2 / v.k;
    return { k: k2, tx: sx - (sx - v.tx) * q, ty: sy - (sy - v.ty) * q };
  });
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  const finishTrace = useCallback(() => {
    if (tracePts.length < 3) return;
    const snapped = snapPx(tracePts);
    const id = uid();
    mutate((prev) => [...prev, {
      id, pts: snapped, roomNumber: "", roomName: "", roomType: "",
      floorType: "", fixtureCount: 0, department: "",
      knownSqFt: null, source: "traced"
    }]);
    setTracePts([]);
    setSel(new Set([id]));
    setTool("select");
    setErr("");
  }, [tracePts, snapPx, mutate]);

  // keyboard: undo point / finish / cancel / nudge selection / global undo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = /INPUT|TEXTAREA|SELECT/.test((e.target as Element)?.tagName ?? "");
      if (inField) return;
      if (e.key === "Escape") { setTracePts([]); setSel(new Set()); }
      else if (e.key === "Enter" && tool === "trace") { e.preventDefault(); finishTrace(); }
      else if ((e.key === "Backspace" || e.key === "Delete") && tool === "trace") {
        e.preventDefault();
        setTracePts((p) => p.slice(0, -1));
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault(); undo();
      } else if (phase === "draw" && sel.size && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const d = e.shiftKey ? 8 : 1.5;
        const dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0;
        const dy = e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0;
        mutate((prev) => prev.map((s) => sel.has(s.id)
          ? { ...s, pts: s.pts.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : s));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, sel, phase, finishTrace, undo, mutate]);

  // ── pointer: trace taps, select/shift-select, drag the whole selection ────
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toPic(e);
    if (phase === "draw" && tool === "trace") {
      setTracePts((prev) => [...prev, p]);
      return;
    }
    let hit: Shape | null = null, hitArea = Infinity;
    const sx = phase === "details" && matrix ? matrix.w / W : 1;
    for (const s of shapes) {
      const pts = sx === 1 ? s.pts : s.pts.map((q) => ({ x: q.x * sx, y: q.y * sx }));
      if (pointIn(pts, p.x, p.y)) {
        const a = shoelacePx(pts);
        if (a < hitArea) { hit = s; hitArea = a; }
      }
    }
    if (hit) {
      setSel((prev) => {
        if (e.shiftKey) {
          const next = new Set(prev);
          if (next.has(hit!.id)) next.delete(hit!.id); else next.add(hit!.id);
          return next;
        }
        return prev.has(hit.id) ? prev : new Set([hit.id]);
      });
      if (phase === "draw") {
        undoStack.current.push(shapes); // one undo step per drag
        drag.current = { kind: "shape", x: e.clientX, y: e.clientY, moved: false };
      } else {
        drag.current = { kind: "none", x: 0, y: 0, moved: false };
      }
    } else {
      if (!e.shiftKey) setSel(new Set());
      drag.current = { kind: "pan", x: e.clientX, y: e.clientY, moved: false };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d.kind === "none") return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.hypot(dx, dy) > 2) d.moved = true;
    if (d.kind === "pan") {
      setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
    } else if (d.kind === "shape") {
      const px = dx / view.k, py = dy / view.k;
      setShapes((prev) => prev.map((s) => sel.has(s.id)
        ? { ...s, pts: s.pts.map((q) => ({ x: q.x + px, y: q.y + py })) } : s));
    }
    d.x = e.clientX; d.y = e.clientY;
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (d.kind === "shape" && !d.moved) undoStack.current.pop(); // click, not a move
    drag.current = { kind: "none", x: 0, y: 0, moved: false };
  };

  // ── Max draws the rest (only after calibration) ───────────────────────────
  // High-recall read: a cleaned copy of the plan is read as a whole AND in
  // overlapping tiles (so small, dense tags resolve), the free local wall-tracer
  // is folded in, and everything is merged. See readPlanMultiPass. Nothing here
  // is data yet — every box is confirmed before it becomes a room.
  async function maxDrawRest() {
    if (!cal || aiBusy) return;
    setAiBusy(true);
    setErr("");
    try {
      const proxy = await aiProxy();
      const img = await loadImageEl(picture.dataUrl);
      const cleanFull = cropClean(img, { x0: 0, y0: 0, x1: 1, y1: 1 }, 2000);
      const renderTile = (box: DrawingBox) => Promise.resolve(cropClean(img, box, 1600));
      // the free local detector: rooms straight from the plan's own wall lines.
      // autoDetectRooms returns coords in the Gray grid's pixel space, so
      // normalise straight off gray.w / gray.h into full 0..1, blank labels
      // (the manager names them later).
      const auto: AiRoom[] = gray
        ? autoDetectRooms(gray).map((poly) => ({
            name: "", roomNumber: "", squareFeet: 0, roomType: "",
            polygon: poly.map((p) => [p.x / gray.w, p.y / gray.h])
          }))
        : [];
      const reading = await readPlanMultiPass({
        apiKey: loadApiKey(), proxy,
        imageDataUrl: cleanFull.dataUrl, imageWidth: cleanFull.width, imageHeight: cleanFull.height,
        building, floor, onProgress: setNotice,
        renderTile, grid: { cols: 2, rows: 2, overlap: 0.12 },
        extraRooms: auto
      });
      const existing = shapes;
      const added: Shape[] = [];
      for (const r of reading.rooms) {
        const pts = r.polygon.map((q) => ({ x: q[0] * W, y: q[1] * H }));
        const c = centroid(pts);
        if (existing.some((s) => pointIn(s.pts, c.x, c.y))) continue;
        added.push({
          id: uid(), pts: snapPx(pts),
          roomNumber: r.roomNumber, roomName: r.name, roomType: "",
          floorType: "", fixtureCount: 0, department: "",
          knownSqFt: null, source: "ai"
        });
      }
      if (!added.length) {
        setErr("Max found no rooms beyond the ones you traced. Trace the rest by hand, or try a sharper file.");
      } else {
        mutate((prev) => [...prev, ...added]);
        setSel(new Set(added.map((s) => s.id)));
        setNotice(`✓ Max drew ${added.length} box${added.length === 1 ? "" : "es"} over the plan — they're all selected. Line up any that sit off like a puzzle piece (drag, or arrows), then ⌖ Snap selected as the double-check.`);
      }
    } catch (e) {
      setErr(e instanceof AiPlanError ? e.message : String((e as Error)?.message ?? e));
    } finally {
      setAiBusy(false);
    }
  }

  const buildReading = () => ({
    buildingName: "", floorName: "",
    rooms: shapes.map((s) => ({
      name: s.roomName.trim() || s.roomNumber.trim() || "Room",
      roomNumber: s.roomNumber.trim(),
      squareFeet: sqftOf(s) ?? 0,
      roomType: s.roomType,
      polygon: s.pts.map((p) => [p.x / W, p.y / H])
    }))
  });

  // ── ✓ Confirm Matrix: lock the boxes, compute every ft², show the render ──
  function confirmMatrix() {
    if (!shapes.length) { setErr("Trace at least one room first."); return; }
    if (!cal) { setErr("Type the square footage of a room you traced — that's the calibration everything is measured from."); return; }
    const preview = buildPlanFromRooms(buildReading(), { building, floor, aspect: W / H });
    const plan = preview.plan as { img: string; w: number; h: number };
    setMatrix({ img: plan.img, w: plan.w, h: plan.h });
    setTracePts([]);
    setTool("select");
    setSel(new Set());
    setErr("");
    setNotice("");
    setPhase("details");
  }

  // ── 🚀 Ship to Max Space ───────────────────────────────────────────────────
  function ship() {
    const nameless = shapes.filter((s) => !s.roomNumber.trim() && !s.roomName.trim());
    if (nameless.length) {
      setSel(new Set([nameless[0].id]));
      setErr(`${nameless.length} room${nameless.length === 1 ? " still needs" : "s still need"} a number or a name — it's selected, fill it in.`);
      return;
    }
    const result = buildPlanFromRooms(buildReading(), { building, floor, aspect: W / H });
    const shapesData: StudioShapeData[] = JSON.parse(JSON.stringify(shapes));
    // shipping writes the stores DIRECTLY (the same separate-document rule
    // every importer follows) and the host reloads — no in-memory races,
    // and the id-map lands in the saved set synchronously
    const d: ClassicData = loadClassic();
    const map = existingSet
      ? applyStudioUpdate(d, existingSet, result, shapesData, rules)
      : applyStudioShip(d, result, shapesData, account, rules);
    saveClassic(d);
    try { localStorage.setItem("opsmatrix_v7_plans", JSON.stringify(d.plans)); } catch { /* quota */ }
    const saved = saveStudioSet(existingSet
      ? {
        ...existingSet, shapes: shapesData, spaceIdByShape: map,
        account, building, floor, updatedAt: new Date().toISOString()
      }
      : {
        id: "set-" + Math.random().toString(36).slice(2, 9),
        account, building, floor,
        picture: { dataUrl: picture.dataUrl, width: W, height: H, aspect: picture.aspect },
        shapes: shapesData,
        spaceIdByShape: map,
        planId: String((result.plan as { id?: string }).id ?? ""),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    onShipped(shapes.length, saved);
  }

  const selShapes = shapes.filter((s) => sel.has(s.id));
  const one = selShapes.length === 1 ? selShapes[0] : null;
  const detailScale = phase === "details" && matrix ? matrix.w / W : 1;
  const aiCount = shapes.filter((s) => s.source === "ai").length;

  return createPortal(
    <div className="studio">
      <header className="studio-head">
        <button className="pbtn ghost" onClick={onCancel}>‹ {existingSet ? "Back" : "Cancel"}</button>
        <h1>Calibration Editor <span>{[account, building, floor].filter(Boolean).join(" · ") || "New floor plan"}</span></h1>
        <span className="grow" />
        {phase === "details" && (
          <button className="pbtn" onClick={() => { setMatrix(null); setPhase("draw"); }}>‹ Back to adjusting</button>
        )}
        <button className="pbtn" disabled={!undoStack.current.length || phase === "details"} onClick={undo}>↩ Undo</button>
      </header>

      <div className="studio-body">
        <div className="studio-canvaswrap" ref={wrapRef}>
          <svg ref={svgRef} className={"studio-canvas tool-" + (phase === "draw" ? tool : "select")}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove}
            onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
            onDoubleClick={(e) => {
              if (phase !== "draw" || tool !== "trace") return;
              e.preventDefault();
              finishTrace();
            }}>
            <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
              {phase === "details" && matrix
                ? <image href={matrix.img} width={matrix.w} height={matrix.h} />
                : <image href={picture.dataUrl} width={W} height={H} />}
              {shapes.map((s) => {
                const col = s.source === "ai" ? AI : TRACED;
                const on = sel.has(s.id);
                const pts = detailScale === 1 ? s.pts : s.pts.map((q) => ({ x: q.x * detailScale, y: q.y * detailScale }));
                const c = centroid(pts);
                const sq = sqftOf(s);
                return (
                  <g key={s.id}>
                    <polygon points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                      fill={col} fillOpacity={phase === "details" ? (on ? 0.32 : 0.10) : on ? 0.4 : 0.24}
                      stroke={on ? "#ffffff" : col} strokeWidth={(on ? 3 : 2) / view.k}
                      strokeDasharray={on ? `${6 / view.k} ${4 / view.k}` : undefined} />
                    <g className="studio-label" transform={`translate(${c.x} ${c.y}) scale(${1 / Math.max(0.5, view.k)})`}>
                      <text y={-3}>{s.roomNumber || s.roomName || "?"}</text>
                      <text className="sub" y={12}>
                        {(s.knownSqFt ?? 0) > 0 ? `⚓ ${s.knownSqFt} ft²` : sq !== null ? `${sq} ft²` : "size after calibration"}
                      </text>
                    </g>
                  </g>
                );
              })}
              {tracePts.length > 0 && phase === "draw" && (
                <g>
                  <polyline points={tracePts.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none" stroke="#2dd4bf" strokeWidth={2.5 / view.k} strokeDasharray={`${7 / view.k} ${5 / view.k}`} />
                  {tracePts.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={4.5 / view.k} fill="#2dd4bf" stroke="#0f1a2e" strokeWidth={1.5 / view.k} />
                  ))}
                </g>
              )}
            </g>
          </svg>

          {phase === "draw" && tool === "trace" && (
            <div className="studio-tracebar">
              <b>{tracePts.length === 0
                ? "Tap roughly at each corner of a room — the snap pulls it onto the walls."
                : `${tracePts.length} corner${tracePts.length === 1 ? "" : "s"} placed`}</b>
              <button className="pbtn small" disabled={!tracePts.length}
                onClick={() => setTracePts((p) => p.slice(0, -1))}>↩ Undo point</button>
              <button className="pbtn small primary" disabled={tracePts.length < 3}
                onClick={finishTrace}>✓ Finish room</button>
              <button className="pbtn small ghost" onClick={() => { setTracePts([]); setTool("select"); }}>✕</button>
            </div>
          )}

          {phase === "draw" && selShapes.length > 1 && (
            <div className="studio-tracebar">
              <b>{selShapes.length} boxes selected — drag them together, arrows nudge</b>
              <button className="pbtn small primary" onClick={() => {
                mutate((prev) => prev.map((s) => sel.has(s.id) ? { ...s, pts: snapPx(s.pts) } : s));
              }}>⌖ Snap selected</button>
              <button className="pbtn small ghost" onClick={() => setSel(new Set())}>✕ Clear</button>
            </div>
          )}

          <div className="pro-zoomctl">
            <button aria-label="Zoom in" onClick={() => {
              const el = wrapRef.current!;
              zoomAt(el.clientWidth / 2, el.clientHeight / 2, 1.35);
            }}>＋</button>
            <button aria-label="Zoom out" onClick={() => {
              const el = wrapRef.current!;
              zoomAt(el.clientWidth / 2, el.clientHeight / 2, 1 / 1.35);
            }}>－</button>
          </div>
        </div>

        <aside className="studio-rail">
          {phase === "draw" ? (
            <>
              <div className={"studio-calbox" + (cal ? " ok" : "")}>
                {cal
                  ? <><b>✓ Calibrated</b><span>{anchors.length} known room{anchors.length === 1 ? "" : "s"} set the scale — every anchor you add sharpens the eventual measuring.</span></>
                  : <><b>1 · Calibrate first</b><span>Trace a room you KNOW, snap it into place, then type its square footage. Max can't draw or measure anything until you do.</span></>}
              </div>

              <div className="prow">
                <button className={"pbtn" + (tool === "trace" ? " primary" : "")}
                  onClick={() => { setTool("trace"); setSel(new Set()); }}>✏ Trace a room</button>
                <button className="pbtn" disabled={!cal || aiBusy} onClick={maxDrawRest}
                  title={cal ? "Max mimics the plan: drawn boxes over every room you haven't traced" : "Calibrate a room first"}>
                  {aiBusy ? "✨ Max is drawing…" : "✨ Max draws the rest"}
                </button>
              </div>
              {aiCount > 0 && (
                <button className="pbtn small" onClick={() => {
                  setSel(new Set(shapes.filter((s) => s.source === "ai").map((s) => s.id)));
                  setTool("select");
                }}>▣ Select all of Max's boxes ({aiCount})</button>
              )}
            </>
          ) : (
            <div className="studio-calbox ok">
              <b>✓ Matrix confirmed</b>
              <span>The boxes are locked in and every square footage is measured from your calibration.
                Select each room and enter its details, then ship it.</span>
            </div>
          )}
          {notice && <p className="pnote">{notice}</p>}
          {err && <p className="warntext">⚠ {err}</p>}

          {one && (
            <div className="studio-info">
              <div className="pshead"><h2>{one.source === "ai" ? "Max's box" : "Your room"}</h2>
                <button className="pbtn ghost" onClick={() => setSel(new Set())}>✕</button></div>
              <div className="prow">
                <label className="pfield">Room number
                  <input value={one.roomNumber} placeholder="e.g. 1230"
                    onChange={(e) => patchShape(one.id, { roomNumber: e.target.value })} />
                </label>
                <label className="pfield">Room name
                  <input value={one.roomName} placeholder="e.g. Patient Room"
                    onChange={(e) => patchShape(one.id, { roomName: e.target.value })} />
                </label>
              </div>

              {phase === "draw" ? (
                <>
                  <label className="pfield">Square feet
                    <input type="number" min={0}
                      value={one.knownSqFt ?? ""}
                      placeholder={cal ? `measured: ${sqftOf(one) ?? "—"}` : "type it if you KNOW it"}
                      onChange={(e) => patchShape(one.id, { knownSqFt: Number(e.target.value) > 0 ? Number(e.target.value) : null })} />
                    <small>{(one.knownSqFt ?? 0) > 0
                      ? "⚓ You set this — it anchors the calibration."
                      : cal ? "Measured from your calibration. Type a number only if you KNOW this room." : ""}</small>
                  </label>
                  <div className="prow">
                    <button className="pbtn small" onClick={() => {
                      mutate((prev) => prev.map((s) => s.id === one.id ? { ...s, pts: snapPx(s.pts) } : s));
                    }}>⌖ Snap to walls</button>
                    <button className="pbtn small danger" onClick={() => {
                      mutate((prev) => prev.filter((s) => s.id !== one.id));
                      setSel(new Set());
                    }}>✕ Delete</button>
                  </div>
                  <small className="pnote">Drag to move it; arrow keys nudge; SHIFT-click to select several at once.</small>
                </>
              ) : (
                <>
                  <div className="prow">
                    <label className="pfield grow">Room type
                      <select value={typeIdOf(rules, one.roomType)} onChange={(e) => {
                        const rt = rules.roomTypes.find((x) => x.id === e.target.value);
                        patchShape(one.id, { roomType: rt?.label ?? "" });
                      }}>
                        <option value="">— pick room type —</option>
                        {rules.roomTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.label}</option>)}
                      </select>
                    </label>
                    <label className="pfield">Floor type
                      <select value={one.floorType} onChange={(e) => patchShape(one.id, { floorType: e.target.value })}>
                        <option value="">— pick —</option>
                        {FLOOR_TYPES.map((f) => <option key={f}>{f}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="prow">
                    <label className="pfield">Fixtures
                      <input type="number" min={0} value={one.fixtureCount || 0}
                        onChange={(e) => patchShape(one.id, { fixtureCount: Number(e.target.value) || 0 })} />
                    </label>
                    <label className="pfield grow">Department
                      <input list="studio-depts" value={one.department}
                        placeholder="e.g. Oncology (7 East)"
                        onChange={(e) => patchShape(one.id, { department: e.target.value })} />
                      <datalist id="studio-depts">{deptOptions.map((d) => <option key={d} value={d} />)}</datalist>
                    </label>
                  </div>
                  <p className="pnote">Measured: <b>{sqftOf(one) ?? "—"} ft²</b>{(one.knownSqFt ?? 0) > 0 ? " (⚓ your number)" : ""}</p>
                </>
              )}
            </div>
          )}

          <div className="studio-list">
            {shapes.map((s) => (
              <button key={s.id} className={"studio-row" + (sel.has(s.id) ? " on" : "")}
                onClick={(e) => {
                  if (e.shiftKey) {
                    setSel((prev) => {
                      const next = new Set(prev);
                      if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
                      return next;
                    });
                  } else setSel(new Set([s.id]));
                  if (phase === "draw") setTool("select");
                }}>
                <i style={{ background: s.source === "ai" ? AI : TRACED }} />
                <b>{s.roomNumber || s.roomName || "(no name yet)"}</b>
                {phase === "details" && !s.department && <em className="miss">dept?</em>}
                <em>{(s.knownSqFt ?? 0) > 0 ? `⚓ ${s.knownSqFt}` : sqftOf(s) ?? "—"} ft²</em>
              </button>
            ))}
            {!shapes.length && <p className="pnote">No rooms yet — tap ✏ Trace a room and start with one you know the size of.</p>}
          </div>

          {phase === "draw" ? (
            <button className="pbtn primary wide" onClick={confirmMatrix}>
              ✓ Confirm Matrix
            </button>
          ) : (
            <button className="pbtn primary wide" onClick={ship}>
              🚀 Ship to Max Space
            </button>
          )}
          <small className="pnote">
            {phase === "draw"
              ? "Confirm locks the boxes in, measures every room from your calibration, and shows the final OpsMatrix rendering."
              : `Ships into ${[account, building, floor].filter(Boolean).join(" → ") || "your account"} → department → room. ${existingSet ? "Same rooms update — schedules stay intact." : ""}`}
          </small>
        </aside>
      </div>
    </div>,
    document.body
  );
}

function typeIdOf(rules: Rules, label: string): string {
  return rules.roomTypes.find((rt) => rt.label === label)?.id ?? "";
}

// ── the Calibration Editor HOME (reached from Max Space's navigation) ──────
// Every plan built through the editor lives here as an editable set: reopen
// it after a remodel, move the boxes, fix details, re-ship — the SAME rooms
// in Max Space update.

export function CalibrationEditorHome({ rules }: {
  rules: Rules;
}) {
  const [sets, setSets] = useState<StudioSet[]>(() => loadStudioSets());
  const [editing, setEditing] = useState<StudioSet | null>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    const m = sessionStorage.getItem("fusion-studio-updated");
    if (m) { setMsg(m); sessionStorage.removeItem("fusion-studio-updated"); }
  }, []);

  if (editing) {
    return (
      <PlanStudio
        picture={editing.picture}
        account={editing.account} building={editing.building} floor={editing.floor}
        rules={rules} existingSet={editing}
        onShipped={(n, saved) => {
          // the stores were written directly — reload so every view (map,
          // lists, schedules) sees the remodel; the message survives it
          sessionStorage.setItem("fusion-studio-updated",
            `✓ ${editing.building || "The plan"}${editing.floor ? " · " + editing.floor : ""} updated — ${n} rooms, same rooms in Max Space, schedules intact.` +
            (saved ? "" : " (The editable set could not be re-saved — storage is full — but Max Space is updated.)"));
          window.location.reload();
        }}
        onCancel={() => setEditing(null)} />
    );
  }

  return (
    <div className="pro-list spaces">
      <p className="pnote">
        Every floor plan built in the Calibration Editor stays editable here. Reopen one after a
        remodel — move the boxes, re-snap, fix the details — and shipping the update lands on the
        SAME rooms in Max Space, so schedules and history never break.
      </p>
      {msg && <p className="pnote keysaved">{msg}</p>}
      {!sets.length && (
        <p className="pnote">
          Nothing here yet. Build one with <b>⬆ Import → 🗺 Floor plan → "No — it's just the floor
          plan, no sizes"</b> — that opens this editor on your file.
        </p>
      )}
      <div className="studio-sets">
        {[...sets].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((s) => (
          <div key={s.id} className="studio-set">
            <img src={s.picture.dataUrl} alt="" />
            <div className="studio-setinfo">
              <b>{[s.building, s.floor].filter(Boolean).join(" · ") || "Floor plan"}</b>
              <span>{s.account || "—"} · {s.shapes.length} room{s.shapes.length === 1 ? "" : "s"}</span>
              <span>edited {new Date(s.updatedAt).toLocaleDateString()}</span>
            </div>
            <span className="studio-setacts">
              <button className="pbtn small primary" onClick={() => { setMsg(""); setEditing(s); }}>✏ Edit</button>
              <button className="pbtn small danger" onClick={() => {
                if (!confirm("Delete this calibration set? The floor plan and rooms STAY in Max Space — only the editable set goes away.")) return;
                deleteStudioSet(s.id);
                setSets(loadStudioSets());
              }}>✕</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
