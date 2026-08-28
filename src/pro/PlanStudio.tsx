// PLAN STUDIO — the one tool for turning a plan with no readable sizes into
// a real OpsMatrix floor plan (Josh's spec, 2026-08-28 night):
//
//   1. The plan is ON SCREEN the whole time. Trace a room you know with
//      rough corner taps — the ported snap engine (planSnap.ts, the exact
//      code Josh likes) pulls the shape onto the walls. Type its square
//      footage: that's the calibration. 1 room works, 2–3 are better.
//   2. THEN "✨ Max draws the rest" — the AI reads the same picture, its
//      shapes arrive auto-snapped and stay SELECTABLE: drag any of them,
//      nudge with arrow keys, hit ⌖ Snap again, or delete and retrace.
//      Every room's square footage comes from the calibration. Max never
//      runs before the calibration exists.
//   3. "✓ Create floor plan" rebuilds everything matrix-style (the same
//      buildPlanFromRooms every import uses) — the scan is never the
//      product, the OpsMatrix drawing is.
//
// Undo (↩ / Ctrl+Z) covers every shape operation; while tracing, ⌫ removes
// the last point. Clicking a finished room re-opens its details.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  buildGray, snapToWalls, shoelacePx, centroid, type Gray, type XY
} from "./planSnap";
import { calibrateFromKnownRooms } from "./planCalibrate";
import {
  readPlanWithAI, buildPlanFromRooms, AiPlanError, AI_ROOM_TYPES,
  type ImportResult
} from "../bridge/aiPlanImport";
import { loadApiKey } from "./classicStore";
import { aiProxy } from "./aiTransport";

export interface StudioPicture { dataUrl: string; width: number; height: number; aspect: number }

interface Shape {
  id: string;
  pts: XY[];              // picture pixels
  roomNumber: string;
  roomName: string;
  roomType: string;
  /** the manager's typed square footage — a calibration anchor */
  knownSqFt: number | null;
  source: "traced" | "ai";
}

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

export function PlanStudio({ picture, building, floor, onDone, onCancel }: {
  picture: StudioPicture;
  building: string;
  floor: string;
  onDone: (result: ImportResult) => void;
  onCancel: () => void;
}) {
  const W = picture.width, H = picture.height;
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [tool, setTool] = useState<"select" | "trace">("trace");
  const [tracePts, setTracePts] = useState<XY[]>([]);
  const [gray, setGray] = useState<Gray | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [err, setErr] = useState("");
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  const undoStack = useRef<Shape[][]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: "none" | "pan" | "shape"; id?: string; x: number; y: number; moved: boolean }>(
    { kind: "none", x: 0, y: 0, moved: false });

  // wall detection grid, built once from the picture
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

  // fit the plan into the viewport
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth || 1000, h = el.clientHeight || 640;
      const k = Math.min(w / W, h / H) * 0.94;
      setView({ k, tx: (w - W * k) / 2, ty: (h - H * k) / 2 });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);

  // gray in image-native resolution vs picture px: buildGray may downscale.
  const graySc = gray ? gray.w / W : 1;
  const snapPx = useCallback((pts: XY[]): XY[] => {
    if (!gray) return pts;
    const scaled = pts.map((p) => ({ x: p.x * graySc, y: p.y * graySc }));
    return snapToWalls(gray, scaled).map((p) => ({ x: p.x / graySc, y: p.y / graySc }));
  }, [gray, graySc]);

  // ── calibration: the shapes whose square footage the manager TYPED ────────
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
    if (prev) { setShapes(prev); setSelId(null); }
  }, []);
  const patchShape = (id: string, patch: Partial<Shape>) =>
    setShapes((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  // ── coordinates ────────────────────────────────────────────────────────────
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

  // ── tracing ────────────────────────────────────────────────────────────────
  const finishTrace = useCallback(() => {
    if (tracePts.length < 3) return;
    const snapped = snapPx(tracePts);
    const id = uid();
    mutate((prev) => [...prev, {
      id, pts: snapped, roomNumber: "", roomName: "", roomType: "",
      knownSqFt: null, source: "traced"
    }]);
    setTracePts([]);
    setSelId(id);
    setTool("select");
    setErr("");
  }, [tracePts, snapPx, mutate]);

  // ── keyboard ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = /INPUT|TEXTAREA|SELECT/.test((e.target as Element)?.tagName ?? "");
      if (inField) return;
      if (e.key === "Escape") { setTracePts([]); setSelId(null); }
      else if (e.key === "Enter" && tool === "trace") { e.preventDefault(); finishTrace(); }
      else if ((e.key === "Backspace" || e.key === "Delete") && tool === "trace") {
        e.preventDefault();
        setTracePts((p) => p.slice(0, -1));
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault(); undo();
      } else if (selId && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const d = e.shiftKey ? 8 : 1.5;
        const dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0;
        const dy = e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0;
        mutate((prev) => prev.map((s) => s.id === selId
          ? { ...s, pts: s.pts.map((p) => ({ x: p.x + dx / 1, y: p.y + dy / 1 })) } : s));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, selId, finishTrace, undo, mutate]);

  // ── pointer interactions ───────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toPic(e);
    if (tool === "trace") {
      setTracePts((prev) => [...prev, p]);
      return;
    }
    // select tool: hit-test shapes (smallest wins so nested picks work)
    let hit: Shape | null = null, hitArea = Infinity;
    for (const s of shapes) {
      if (pointIn(s.pts, p.x, p.y)) {
        const a = shoelacePx(s.pts);
        if (a < hitArea) { hit = s; hitArea = a; }
      }
    }
    if (hit) {
      setSelId(hit.id);
      undoStack.current.push(shapes); // move is undoable as one step
      drag.current = { kind: "shape", id: hit.id, x: e.clientX, y: e.clientY, moved: false };
    } else {
      setSelId(null);
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
    } else if (d.kind === "shape" && d.id) {
      const px = dx / view.k, py = dy / view.k;
      setShapes((prev) => prev.map((s) => s.id === d.id
        ? { ...s, pts: s.pts.map((q) => ({ x: q.x + px, y: q.y + py })) } : s));
    }
    d.x = e.clientX; d.y = e.clientY;
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (d.kind === "shape" && !d.moved) undoStack.current.pop(); // plain click — no move to undo
    drag.current = { kind: "none", x: 0, y: 0, moved: false };
  };

  // ── Max draws the rest (only AFTER calibration) ───────────────────────────
  async function maxDrawRest() {
    if (!cal || aiBusy) return;
    setAiBusy(true);
    setErr("");
    try {
      const proxy = await aiProxy();
      const reading = await readPlanWithAI({
        apiKey: loadApiKey(),
        proxy,
        imageDataUrl: picture.dataUrl,
        imageWidth: W, imageHeight: H,
        building, floor,
        onProgress: setNotice
      });
      const existing = shapes;
      const added: Shape[] = [];
      for (const r of reading.rooms) {
        const pts = r.polygon.map((q) => ({ x: q[0] * W, y: q[1] * H }));
        const c = centroid(pts);
        // don't double-draw a room the manager already traced
        if (existing.some((s) => pointIn(s.pts, c.x, c.y))) continue;
        added.push({
          id: uid(),
          pts: snapPx(pts), // arrive pre-snapped; still draggable + re-snappable
          roomNumber: r.roomNumber, roomName: r.name, roomType: r.roomType,
          knownSqFt: null, source: "ai"
        });
      }
      if (!added.length) {
        setErr("Max found no rooms beyond the ones you traced. Trace the rest by hand, or try a sharper file.");
      } else {
        mutate((prev) => [...prev, ...added]);
        setNotice(`✓ Max drew ${added.length} more room${added.length === 1 ? "" : "s"} — sized from your calibration. Drag any shape that sits off its walls, then ⌖ Snap it.`);
      }
    } catch (e) {
      setErr(e instanceof AiPlanError ? e.message : String((e as Error)?.message ?? e));
    } finally {
      setAiBusy(false);
    }
  }

  // ── create the OpsMatrix plan ──────────────────────────────────────────────
  function createPlan() {
    if (!shapes.length) { setErr("Trace at least one room first."); return; }
    if (!cal) { setErr("Type the square footage of at least one room you traced — that's the calibration everything is measured from."); return; }
    const nameless = shapes.filter((s) => !s.roomNumber.trim() && !s.roomName.trim());
    if (nameless.length) {
      setSelId(nameless[0].id);
      setErr(`${nameless.length} room${nameless.length === 1 ? " still needs" : "s still need"} a number or a name — tap the highlighted one.`);
      return;
    }
    const result = buildPlanFromRooms({
      buildingName: "", floorName: "",
      rooms: shapes.map((s) => ({
        name: s.roomName.trim() || s.roomNumber.trim(),
        roomNumber: s.roomNumber.trim(),
        squareFeet: sqftOf(s) ?? 0,
        roomType: s.roomType,
        polygon: s.pts.map((p) => [p.x / W, p.y / H])
      }))
    }, { building, floor, aspect: W / H });
    onDone(result);
  }

  const sel = shapes.find((s) => s.id === selId) ?? null;

  return createPortal(
    <div className="studio">
      <header className="studio-head">
        <button className="pbtn ghost" onClick={onCancel}>‹ Cancel</button>
        <h1>Plan Studio <span>{[building, floor].filter(Boolean).join(" · ") || "New floor plan"}</span></h1>
        <span className="grow" />
        <button className="pbtn" disabled={!undoStack.current.length} onClick={undo}>↩ Undo</button>
      </header>

      <div className="studio-body">
        <div className="studio-canvaswrap" ref={wrapRef}>
          <svg ref={svgRef} className={"studio-canvas tool-" + tool}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove}
            onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
            onDoubleClick={(e) => {
              if (tool !== "trace") return;
              e.preventDefault();
              finishTrace();
            }}>
            <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
              <image href={picture.dataUrl} width={W} height={H} />
              {shapes.map((s) => {
                const col = s.source === "ai" ? AI : TRACED;
                const on = s.id === selId;
                const c = centroid(s.pts);
                const sq = sqftOf(s);
                return (
                  <g key={s.id}>
                    <polygon points={s.pts.map((p) => `${p.x},${p.y}`).join(" ")}
                      fill={col} fillOpacity={on ? 0.4 : 0.24}
                      stroke={on ? "#ffffff" : col} strokeWidth={on ? 3 / view.k : 2 / view.k}
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
              {tracePts.length > 0 && (
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

          {/* trace controls float on the plan, exactly where the eyes are */}
          {tool === "trace" && (
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
          <div className={"studio-calbox" + (cal ? " ok" : "")}>
            {cal
              ? <><b>✓ Calibrated</b><span>{anchors.length} known room{anchors.length === 1 ? "" : "s"} set the scale{anchors.length < 3 ? " — 2–3 is even better" : ""}. Every other room is measured from it.</span></>
              : <><b>1 · Calibrate first</b><span>Trace a room you KNOW, then type its square footage below. Max can't measure anything until you do.</span></>}
          </div>

          <div className="prow">
            <button className={"pbtn" + (tool === "trace" ? " primary" : "")}
              onClick={() => { setTool("trace"); setSelId(null); }}>✏ Trace a room</button>
            <button className="pbtn" disabled={!cal || aiBusy} onClick={maxDrawRest}
              title={cal ? "Max reads the plan and draws every room you haven't traced" : "Calibrate a room first"}>
              {aiBusy ? "✨ Max is drawing…" : "✨ Max draws the rest"}
            </button>
          </div>
          {notice && <p className="pnote">{notice}</p>}
          {err && <p className="warntext">⚠ {err}</p>}

          {sel && (
            <div className="studio-info">
              <div className="pshead"><h2>{sel.source === "ai" ? "Max's drawing" : "Your room"}</h2>
                <button className="pbtn ghost" onClick={() => setSelId(null)}>✕</button></div>
              <div className="prow">
                <label className="pfield">Room number
                  <input value={sel.roomNumber} placeholder="e.g. 1230"
                    onChange={(e) => patchShape(sel.id, { roomNumber: e.target.value })} />
                </label>
                <label className="pfield">Room name
                  <input value={sel.roomName} placeholder="e.g. Patient Room"
                    onChange={(e) => patchShape(sel.id, { roomName: e.target.value })} />
                </label>
              </div>
              <label className="pfield">Room type <small>optional — refine it later in Max Space</small>
                <select value={sel.roomType} onChange={(e) => patchShape(sel.id, { roomType: e.target.value })}>
                  <option value="">— pick later —</option>
                  {AI_ROOM_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </label>
              <label className="pfield">Square feet
                <input type="number" min={0}
                  value={sel.knownSqFt ?? ""}
                  placeholder={cal ? `measured: ${sqftOf(sel) ?? "—"}` : "type it if you KNOW it"}
                  onChange={(e) => patchShape(sel.id, { knownSqFt: Number(e.target.value) > 0 ? Number(e.target.value) : null })} />
                <small>{(sel.knownSqFt ?? 0) > 0
                  ? "⚓ You set this — it anchors the calibration."
                  : cal ? "Measured from your calibration. Type a number only if you KNOW this room." : ""}</small>
              </label>
              <div className="prow">
                <button className="pbtn small" onClick={() => {
                  mutate((prev) => prev.map((s) => s.id === sel.id ? { ...s, pts: snapPx(s.pts) } : s));
                }}>⌖ Snap to walls</button>
                <button className="pbtn small danger" onClick={() => {
                  mutate((prev) => prev.filter((s) => s.id !== sel.id));
                  setSelId(null);
                }}>✕ Delete</button>
              </div>
              <small className="pnote">Drag the shape to move it; arrow keys nudge it; then ⌖ Snap seats it on the walls.</small>
            </div>
          )}

          <div className="studio-list">
            {shapes.map((s) => (
              <button key={s.id} className={"studio-row" + (s.id === selId ? " on" : "")}
                onClick={() => { setSelId(s.id); setTool("select"); }}>
                <i style={{ background: s.source === "ai" ? AI : TRACED }} />
                <b>{s.roomNumber || s.roomName || "(no name yet)"}</b>
                <em>{(s.knownSqFt ?? 0) > 0 ? `⚓ ${s.knownSqFt}` : sqftOf(s) ?? "—"} ft²</em>
              </button>
            ))}
            {!shapes.length && <p className="pnote">No rooms yet — tap ✏ Trace a room and start with one you know the size of.</p>}
          </div>

          <button className="pbtn primary wide" onClick={createPlan}>
            ✓ Create floor plan
          </button>
          <small className="pnote">
            OpsMatrix redraws everything in its own clean style — the scan is only the guide, never the product.
          </small>
        </aside>
      </div>
    </div>,
    document.body
  );
}
