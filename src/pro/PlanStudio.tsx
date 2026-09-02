// THE CALIBRATION EDITOR — Josh's flow, revision 2 (2026-08-29):
//
//   1. EDIT — Max draws EVERYTHING first, automatically, the moment the file
//      lands (auto-snapped, and a HARD RULE drops overlapping boxes). The
//      manager then makes the drawing match the plan with a real toolbar:
//      Select / Trace / Reshape / Merge, plus Snap, Delete, Undo and Redo.
//      Reshape shows pins on the selected room: pull an edge and it moves
//      straight along its own direction (clean horizontal/vertical pulls on
//      square rooms, clean angled pulls on angled ones), drag a pin (it
//      lines itself up with its neighbours), double-click an edge to add a
//      pin, double-click a pin to remove it. Merge: tap two touching rooms
//      and they become one outline.
//   2. ✓ Finish editing → CALIBRATE — select up to THREE rooms you know and
//      type each one's calibration measurement. Then 📏 MEASURE ALL ROOMS
//      fills in every room's square footage from your calibration.
//   3. DETAILS — the locked matrix rendering appears; per room enter number,
//      name, Scope type, floor type, fixtures, department. 🚀 Ship to Max
//      Space files it all under account → building → floor → department.
//
// Every ship saves an editable calibration set (studioSets.ts); re-editing
// from Max Space → Calibration Editor re-ships onto the SAME rooms.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  buildGray, snapToWalls, alignEdgesToNeighbors, shoelacePx, centroid,
  overlapRatio, unionPolygons, rectify, snapCollapsed, type Gray, type XY
} from "./planSnap";
import { calibrateFromKnownRooms } from "./planCalibrate";
import { neonPlanUrl } from "./neonMap";
import { buildPlanFromRooms, readPlanWithAI, AiPlanError } from "../bridge/aiPlanImport";
import {
  saveStudioSet, loadStudioSets, deleteStudioSet, applyStudioShip, applyStudioUpdate,
  type StudioSet, type StudioShapeData
} from "./studioSets";
import { loadApiKey, loadClassic, saveClassic, FLOOR_TYPES, type ClassicData } from "./classicStore";
import { aiProxy } from "./aiTransport";
import { typeIdFromLabelStrict, type Rules } from "./rules";

export interface StudioPicture { dataUrl: string; width: number; height: number; aspect: number }

export interface AiRoomSeed {
  name: string;
  roomNumber: string;
  roomType: string;
  polygon: number[][];
  /** square footage READ off the plan — preloads the calibration anchor */
  squareFeet?: number;
}

type Shape = StudioShapeData;
type Phase = "edit" | "calibrate" | "details";
type Tool = "select" | "trace" | "reshape" | "merge";

const uid = () => "shape-" + Math.random().toString(36).slice(2, 9);
const TRACED = "#14b8a6";
const AI = "#f59e0b";
const MAX_ANCHORS = 3;
/** the hard rule: a new box covering this much of an existing one is a dupe */
const OVERLAP_LIMIT = 0.35;

function pointIn(pts: XY[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    if ((pts[i].y > y) !== (pts[j].y > y) &&
      x < ((pts[j].x - pts[i].x) * (y - pts[i].y)) / (pts[j].y - pts[i].y) + pts[i].x) inside = !inside;
  }
  return inside;
}

export function PlanStudio({ picture, account, building, floor, rules, existingSet, initialAiRooms, initialNotice, sizesFromFile, onShipped, onCancel }: {
  picture: StudioPicture;
  account: string;
  building: string;
  floor: string;
  rules: Rules;
  /** re-editing a saved calibration set (remodels) — ships onto the SAME rooms */
  existingSet?: StudioSet;
  /** Max's automatic first drawing (already read by the host) */
  initialAiRooms?: AiRoomSeed[];
  initialNotice?: string;
  /** the file STATED its sizes — every room arrives already measured, so
   *  calibration is a spot-check, not a 3-room ceiling */
  sizesFromFile?: boolean;
  onShipped: (roomCount: number, setSaved: boolean) => void;
  onCancel: () => void;
}) {
  const W = picture.width, H = picture.height;
  // WITH-info uploads (Josh, 2026-09-01): there is NOTHING to calibrate —
  // the plan stated its sizes, Max read them. The flow is edit → ship:
  // check the drawing, fix what needs fixing, send it to Max Space.
  const direct = Boolean(sizesFromFile) || Boolean(existingSet?.readMode);
  const [shapes, setShapes] = useState<Shape[]>(() =>
    existingSet ? JSON.parse(JSON.stringify(existingSet.shapes)) : []);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("edit");
  const [tool, setTool] = useState<Tool>("select");
  const [tracePts, setTracePts] = useState<XY[]>([]);
  const [mergeFirst, setMergeFirst] = useState<string | null>(null);
  const [gray, setGray] = useState<Gray | null>(null);
  const [matrix, setMatrix] = useState<{ img: string; w: number; h: number } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [notice, setNotice] = useState(initialNotice ?? "");
  const [err, setErr] = useState("");
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  // the locked matrix wears BAKED neon (neonMap.ts) — the live CSS filter
  // route silently fails on iOS Safari and washed the phone view white
  const [neonMatrix, setNeonMatrix] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setNeonMatrix(null);
    const src = matrix?.img;
    if (src) neonPlanUrl(src).then((u) => { if (live) setNeonMatrix(u); }).catch(() => { /* plain matrix stands */ });
    return () => { live = false; };
  }, [matrix?.img]);
  const userDrove = useRef(false); // resizes never yank a driven view (iOS URL bar)
  const undoStack = useRef<Shape[][]>([]);
  const redoStack = useRef<Shape[][]>([]);
  const pendingSeeds = useRef<AiRoomSeed[] | null>(initialAiRooms?.length ? initialAiRooms : null);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    kind: "none" | "pan" | "shape" | "vertex" | "edge";
    idx: number; x: number; y: number; moved: boolean;
    /** edge tool: unit normal the edge slides along */
    nx: number; ny: number;
  }>({ kind: "none", idx: -1, x: 0, y: 0, moved: false, nx: 0, ny: 0 });

  const deptOptions = useMemo(() => {
    try {
      const v7 = JSON.parse(localStorage.getItem("opsmatrix_v7") ?? "{}") ?? {};
      return [...new Set(((v7.spaces ?? []) as { department?: string }[])
        .map((s) => String(s.department ?? "").trim()).filter(Boolean))].sort();
    } catch { return []; }
  }, []);

  // wall grid (contrast-stretched, so faint plans snap too)
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
    userDrove.current = false;
    fit();
    const ro = new ResizeObserver(() => { if (!userDrove.current) fit(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [surfW, surfH]);

  const graySc = gray ? gray.w / W : 1;
  const snapPx = useCallback((pts: XY[], tight = false): XY[] => {
    if (!gray) return pts;
    const scaled = pts.map((p) => ({ x: p.x * graySc, y: p.y * graySc }));
    // tight = RE-snapping an established shape: refine to the nearest line
    // only, never revert to a stronger wall the user deliberately left
    const snapped = snapToWalls(gray, scaled, tight ? { maxOffset: Math.max(6, 14 * graySc) } : undefined);
    return snapped.map((p) => ({ x: p.x / graySc, y: p.y / graySc }));
  }, [gray, graySc]);

  /** wall snap + Josh's border rule: seat against neighbouring rooms too —
   *  no sliver gaps, no overlaps between room borders. Each stage is guarded:
   *  in a corridor the wall snap can land BOTH long edges on the same strong
   *  line and collapse the trace to a sliver — when a stage destroys the
   *  drawn shape instead of refining it, the drawn shape wins. */
  const cleanSnap = useCallback((pts: XY[], others: XY[][], tight: boolean): XY[] => {
    const drawn = rectify(pts);
    const snapped = snapPx(pts, tight);
    const walled = snapCollapsed(drawn, snapped) ? drawn : snapped;
    const seated = alignEdgesToNeighbors(walled, others, 12);
    return snapCollapsed(drawn, seated) ? walled : seated;
  }, [snapPx]);

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

  // ── mutations with undo/redo ───────────────────────────────────────────────
  const mutate = useCallback((next: Shape[] | ((prev: Shape[]) => Shape[])) => {
    setShapes((prev) => {
      undoStack.current.push(prev);
      if (undoStack.current.length > 80) undoStack.current.shift();
      redoStack.current = [];
      return typeof next === "function" ? next(prev) : next;
    });
  }, []);
  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    setShapes((cur) => { redoStack.current.push(cur); return prev; });
  }, []);
  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    setShapes((cur) => { undoStack.current.push(cur); return next; });
  }, []);
  const patchShape = (id: string, patch: Partial<Shape>) =>
    setShapes((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  // ── Max's boxes: snap + THE HARD NO-OVERLAP RULE ───────────────────────────
  const ingestSeeds = useCallback((seeds: AiRoomSeed[], existing: Shape[]): Shape[] => {
    const candidates = seeds
      .map((r) => ({ seed: r, pts: r.polygon.map((q) => ({ x: q[0] * W, y: q[1] * H })) }))
      .sort((a, b) => shoelacePx(b.pts) - shoelacePx(a.pts));
    const kept: Shape[] = [];
    for (const c of candidates) {
      const blockers = [...existing, ...kept];
      const pts = cleanSnap(c.pts, blockers.map((s) => s.pts), false);
      if (blockers.some((s) => overlapRatio(s.pts, pts) > OVERLAP_LIMIT)) continue; // dupe — dropped
      kept.push({
        id: uid(), pts,
        roomNumber: c.seed.roomNumber, roomName: c.seed.name,
        // a plan that STATES its data preloads everything Max read: the room
        // type maps into Scope's vocabulary, and a stated square footage
        // becomes that room's calibration measurement
        roomType: scopeLabelFor(rules, c.seed.roomType),
        floorType: "", fixtureCount: 0, department: "",
        knownSqFt: Number(c.seed.squareFeet) > 0 ? Math.round(Number(c.seed.squareFeet)) : null,
        source: "ai"
      });
    }
    return kept;
  }, [W, H, cleanSnap, rules]);

  // the automatic first drawing, once the wall grid is ready to snap against
  useEffect(() => {
    if (!gray || !pendingSeeds.current) return;
    const seeds = pendingSeeds.current;
    pendingSeeds.current = null;
    const added = ingestSeeds(seeds, shapes);
    const dropped = seeds.length - added.length;
    if (added.length) {
      mutate((prev) => [...prev, ...added]);
      setNotice(`✓ Max ${direct ? "read" : "drew"} ${added.length} room${added.length === 1 ? "" : "s"}` +
        (dropped > 0 ? ` (${dropped} overlapping box${dropped === 1 ? "" : "es"} dropped)` : "") +
        (direct
          ? ". Numbers, names and square footage are filled in — check the drawing, then 🚀 Ship to Max Space."
          : ". Make the drawing match the plan — move, reshape, merge, trace what's missing — then ✓ Finish editing."));
    } else if (seeds.length) {
      setErr("Max's boxes all overlapped or were unusable — trace the rooms by hand.");
    }
  }, [gray]); // eslint-disable-line react-hooks/exhaustive-deps

  async function maxDrawMore() {
    if (aiBusy) return;
    setAiBusy(true);
    setErr("");
    try {
      const proxy = await aiProxy();
      const reading = await readPlanWithAI({
        apiKey: loadApiKey(), proxy,
        imageDataUrl: picture.dataUrl, imageWidth: W, imageHeight: H,
        building, floor, onProgress: setNotice
      });
      const added = ingestSeeds(reading.rooms.map((r) => ({
        name: r.name, roomNumber: r.roomNumber, roomType: r.roomType, polygon: r.polygon,
        squareFeet: direct ? r.squareFeet : 0
      })), shapes);
      if (!added.length) {
        setErr("Max found nothing new beyond what's drawn (overlapping boxes are dropped automatically).");
      } else {
        mutate((prev) => [...prev, ...added]);
        setSel(new Set(added.map((s) => s.id)));
        setNotice(`✓ Max added ${added.length} more room${added.length === 1 ? "" : "s"}.`);
      }
    } catch (e) {
      setErr(e instanceof AiPlanError ? e.message : String((e as Error)?.message ?? e));
    } finally {
      setAiBusy(false);
    }
  }

  // ── coordinates / zoom ─────────────────────────────────────────────────────
  const toPic = (e: { clientX: number; clientY: number }): XY => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.tx) / view.k, y: (e.clientY - r.top - view.ty) / view.k };
  };
  const zoomAt = (sx: number, sy: number, f: number) => { userDrove.current = true; return setView((v) => {
    const k2 = Math.max(0.15, Math.min(14, v.k * f));
    const q = k2 / v.k;
    return { k: k2, tx: sx - (sx - v.tx) * q, ty: sy - (sy - v.ty) * q };
  }); };
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
    const snapped = cleanSnap(tracePts, shapes.map((s) => s.pts), false);
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
  }, [tracePts, shapes, cleanSnap, mutate]);

  // ── keyboard ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = /INPUT|TEXTAREA|SELECT/.test((e.target as Element)?.tagName ?? "");
      if (inField) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") { setTracePts([]); setSel(new Set()); setMergeFirst(null); }
      else if (e.key === "Enter" && tool === "trace") { e.preventDefault(); finishTrace(); }
      else if ((e.key === "Backspace" || e.key === "Delete") && tool === "trace") {
        e.preventDefault();
        setTracePts((p) => p.slice(0, -1));
      } else if (mod && e.key.toLowerCase() === "z" && e.shiftKey) { e.preventDefault(); redo(); }
      else if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
      else if (phase === "edit" && sel.size && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
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
  }, [tool, sel, phase, finishTrace, undo, redo, mutate]);

  // ── pointer: per-tool behaviour ────────────────────────────────────────────
  const hitShape = (p: XY): Shape | null => {
    let hit: Shape | null = null, hitArea = Infinity;
    const sx = phase === "details" && matrix ? matrix.w / W : 1;
    for (const s of shapes) {
      const pts = sx === 1 ? s.pts : s.pts.map((q) => ({ x: q.x * sx, y: q.y * sx }));
      if (pointIn(pts, p.x, p.y)) {
        const a = shoelacePx(pts);
        if (a < hitArea) { hit = s; hitArea = a; }
      }
    }
    return hit;
  };

  const doMerge = (aId: string, bId: string) => {
    const a = shapes.find((s) => s.id === aId), b = shapes.find((s) => s.id === bId);
    if (!a || !b) return;
    const merged = unionPolygons(a.pts, b.pts);
    if (!merged) {
      setErr("Those two rooms don't touch — merge joins rooms that share a wall.");
      setMergeFirst(null);
      return;
    }
    // WITH-info plans: the merged room IS both rooms, so its square footage
    // is the sum of theirs (Josh, 2026-09-01). Calibrated plans re-measure
    // from the merged outline instead, so a stale anchor never survives.
    const summed = direct ? (sqftOf(a) ?? 0) + (sqftOf(b) ?? 0) : 0;
    mutate((prev) => prev
      .filter((s) => s.id !== bId)
      .map((s) => s.id === aId
        ? { ...s, pts: merged, knownSqFt: direct && summed > 0 ? Math.round(summed) : null }
        : s));
    setSel(new Set([aId]));
    setMergeFirst(null);
    setTool("select");
    setNotice("✓ Merged into one room. Reshape or ⌖ Snap it if the outline needs a touch-up.");
    setErr("");
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toPic(e);
    if (phase === "edit" && tool === "trace") {
      setTracePts((prev) => [...prev, p]);
      return;
    }
    if (phase === "edit" && tool === "merge") {
      const hit = hitShape(p);
      if (!hit) { setMergeFirst(null); return; }
      if (!mergeFirst) { setMergeFirst(hit.id); setSel(new Set([hit.id])); return; }
      if (hit.id !== mergeFirst) doMerge(mergeFirst, hit.id);
      return;
    }
    const hit = hitShape(p);
    if (hit) {
      setSel((prev) => {
        if (e.shiftKey && phase === "edit") {
          const next = new Set(prev);
          if (next.has(hit.id)) next.delete(hit.id); else next.add(hit.id);
          return next;
        }
        return prev.has(hit.id) && phase === "edit" ? prev : new Set([hit.id]);
      });
      if (phase === "edit" && tool !== "reshape") {
        undoStack.current.push(shapes);
        redoStack.current = [];
        drag.current = { kind: "shape", idx: -1, x: e.clientX, y: e.clientY, moved: false, nx: 0, ny: 0 };
      } else {
        drag.current = { kind: "none", idx: -1, x: 0, y: 0, moved: false, nx: 0, ny: 0 };
      }
    } else {
      if (!e.shiftKey) setSel(new Set());
      drag.current = { kind: "pan", idx: -1, x: e.clientX, y: e.clientY, moved: false, nx: 0, ny: 0 };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d.kind === "none") return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.hypot(dx, dy) > 2) d.moved = true;
    if (d.kind === "pan") {
      userDrove.current = true;
      setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
    } else if (d.kind === "shape") {
      const px = dx / view.k, py = dy / view.k;
      setShapes((prev) => prev.map((s) => sel.has(s.id)
        ? { ...s, pts: s.pts.map((q) => ({ x: q.x + px, y: q.y + py })) } : s));
    } else if (d.kind === "vertex" && one) {
      const p = toPic(e);
      setShapes((prev) => prev.map((s) => {
        if (s.id !== one.id) return s;
        const pts = s.pts.map((q) => ({ ...q }));
        const n = pts.length;
        let nx = p.x, ny = p.y;
        // clean lines: a pin near its neighbour's x or y clicks onto it
        const T = 6 / view.k + 2;
        const prevPt = pts[(d.idx - 1 + n) % n], nextPt = pts[(d.idx + 1) % n];
        if (Math.abs(nx - prevPt.x) < T) nx = prevPt.x;
        else if (Math.abs(nx - nextPt.x) < T) nx = nextPt.x;
        if (Math.abs(ny - prevPt.y) < T) ny = prevPt.y;
        else if (Math.abs(ny - nextPt.y) < T) ny = nextPt.y;
        pts[d.idx] = { x: nx, y: ny };
        return { ...s, pts };
      }));
      return; // don't advance d.x/d.y — vertex follows the cursor absolutely
    } else if (d.kind === "edge" && one) {
      // the edge slides along its own normal only — a straight, clean pull
      const px = dx / view.k, py = dy / view.k;
      const t = px * d.nx + py * d.ny;
      setShapes((prev) => prev.map((s) => {
        if (s.id !== one.id) return s;
        const pts = s.pts.map((q) => ({ ...q }));
        const n = pts.length;
        const j = (d.idx + 1) % n;
        pts[d.idx] = { x: pts[d.idx].x + d.nx * t, y: pts[d.idx].y + d.ny * t };
        pts[j] = { x: pts[j].x + d.nx * t, y: pts[j].y + d.ny * t };
        return { ...s, pts };
      }));
    }
    d.x = e.clientX; d.y = e.clientY;
  };
  const onPointerUp = () => {
    const d = drag.current;
    if ((d.kind === "shape" || d.kind === "vertex" || d.kind === "edge") && !d.moved) {
      undoStack.current.pop(); // a click, not a move
    }
    drag.current = { kind: "none", idx: -1, x: 0, y: 0, moved: false, nx: 0, ny: 0 };
  };

  const beginHandleDrag = (e: React.PointerEvent, kind: "vertex" | "edge", idx: number, nx = 0, ny = 0) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    undoStack.current.push(shapes);
    redoStack.current = [];
    drag.current = { kind, idx, x: e.clientX, y: e.clientY, moved: false, nx, ny };
  };

  // ── phase transitions ──────────────────────────────────────────────────────
  const buildReading = () => ({
    buildingName: "", floorName: "",
    rooms: shapes.map((s) => ({
      name: s.roomName.trim(),
      roomNumber: s.roomNumber.trim(),
      squareFeet: sqftOf(s) ?? 0,
      roomType: s.roomType,
      polygon: s.pts.map((p) => [p.x / W, p.y / H])
    }))
  });

  function finishEditing() {
    if (!shapes.length) { setErr("Draw at least one room first — ✏ Trace, or ✨ Max draws the rooms."); return; }
    setTracePts([]);
    setMergeFirst(null);
    setTool("select");
    setSel(new Set());
    setErr("");
    setNotice("");
    setPhase("calibrate");
  }

  function measureAll() {
    if (!cal) { setErr("Select a room you KNOW and type its calibration measurement first."); return; }
    const preview = buildPlanFromRooms(buildReading(), { building, floor, aspect: W / H });
    const plan = preview.plan as { img: string; w: number; h: number };
    setMatrix({ img: plan.img, w: plan.w, h: plan.h });
    setSel(new Set());
    setErr("");
    setNotice("");
    setPhase("details");
  }

  function ship() {
    // blanks ship fine (Josh: validation happens in Max Space anyway) — the
    // only hard requirement was the calibration, and measure-all enforced it
    const result = buildPlanFromRooms(buildReading(), { building, floor, aspect: W / H });
    const shapesData: StudioShapeData[] = JSON.parse(JSON.stringify(shapes));
    const d: ClassicData = loadClassic();
    const map = existingSet
      ? applyStudioUpdate(d, existingSet, result, shapesData, rules)
      : applyStudioShip(d, result, shapesData, account, rules);
    saveClassic(d);
    try { localStorage.setItem("opsmatrix_v7_plans", JSON.stringify(d.plans)); } catch { /* quota */ }
    const saved = saveStudioSet(existingSet
      ? {
        ...existingSet, shapes: shapesData, spaceIdByShape: map,
        account, building, floor, readMode: direct || existingSet.readMode,
        updatedAt: new Date().toISOString()
      }
      : {
        id: "set-" + Math.random().toString(36).slice(2, 9),
        account, building, floor,
        picture: { dataUrl: picture.dataUrl, width: W, height: H, aspect: picture.aspect },
        shapes: shapesData,
        spaceIdByShape: map,
        planId: String((result.plan as { id?: string }).id ?? ""),
        readMode: direct,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    onShipped(shapes.length, saved);
  }

  const selShapes = shapes.filter((s) => sel.has(s.id));
  const one = selShapes.length === 1 ? selShapes[0] : null;
  const detailScale = phase === "details" && matrix ? matrix.w / W : 1;
  const canReshape = phase === "edit" && tool === "reshape" && one;

  const ToolBtn = ({ id, label, title }: { id: Tool; label: string; title: string }) => (
    <button className={"pbtn small" + (tool === id ? " primary" : "")} title={title}
      onClick={() => { setTool(id); setTracePts([]); setMergeFirst(null); if (id === "reshape" && selShapes.length > 1) setSel(new Set()); }}>
      {label}
    </button>
  );

  return createPortal(
    <div className="studio">
      <header className="studio-head">
        <button className="pbtn ghost" onClick={onCancel}>‹ {existingSet ? "Back" : "Cancel"}</button>
        <h1>Calibration Editor <span>{[account, building, floor].filter(Boolean).join(" · ") || "New floor plan"}</span></h1>
        <span className="grow" />
        {phase === "calibrate" && <button className="pbtn" onClick={() => setPhase("edit")}>‹ Back to editing</button>}
        {phase === "details" && <button className="pbtn" onClick={() => { setMatrix(null); setPhase("calibrate"); }}>‹ Back to calibration</button>}
      </header>

      <div className="studio-body">
        <div className="studio-canvaswrap" ref={wrapRef}>
          <svg ref={svgRef} className={"studio-canvas tool-" + (phase === "edit" ? tool : "select")}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove}
            onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
            onDoubleClick={(e) => {
              if (phase !== "edit") return;
              if (tool === "trace") { e.preventDefault(); finishTrace(); }
            }}>
            <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
              {phase === "details" && matrix
                // the locked matrix wears the neon rendering; the UPLOADED
                // plan (edit/calibrate phases) stays exactly as the manager
                // knows it — you can't correct a drawing you can't recognise
                ? <image href={neonMatrix ?? matrix.img} width={matrix.w} height={matrix.h}
                    className={neonMatrix ? "planneon" : "planimg"} />
                : <image href={picture.dataUrl} width={W} height={H} />}
              {shapes.map((s) => {
                const col = s.source === "ai" ? AI : TRACED;
                const on = sel.has(s.id) || s.id === mergeFirst;
                const pts = detailScale === 1 ? s.pts : s.pts.map((q) => ({ x: q.x * detailScale, y: q.y * detailScale }));
                const c = centroid(pts);
                const sq = sqftOf(s);
                return (
                  <g key={s.id}>
                    <polygon points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                      fill={col} fillOpacity={phase === "details" ? (on ? 0.32 : 0.10) : on ? 0.4 : 0.24}
                      stroke={on ? "#ffffff" : col} strokeWidth={(on ? 4.5 : 3) / view.k}
                      strokeDasharray={on ? `${6 / view.k} ${4 / view.k}` : undefined} />
                    <g className="studio-label" transform={`translate(${c.x} ${c.y}) scale(${1 / Math.max(0.5, view.k)})`}>
                      <text y={-3}>{s.roomNumber || s.roomName || "?"}</text>
                      <text className="sub" y={12}>
                        {phase === "edit" && !direct
                          ? (s.source === "ai" ? "Max" : "traced")
                          : (s.knownSqFt ?? 0) > 0 ? `${direct ? "" : "⚓ "}${s.knownSqFt} ft²` : sq !== null ? `${sq} ft²` : "—"}
                      </text>
                    </g>
                  </g>
                );
              })}
              {/* reshape pins: vertices are circles, edge handles are squares */}
              {canReshape && (() => {
                const s = one!;
                const n = s.pts.length;
                return (
                  <g>
                    {s.pts.map((p, i) => {
                      const q = s.pts[(i + 1) % n];
                      const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
                      const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
                      const nx = -(q.y - p.y) / len, ny = (q.x - p.x) / len;
                      const hs = 5.5 / view.k;
                      return (
                        <rect key={"e" + i} x={mx - hs} y={my - hs} width={hs * 2} height={hs * 2}
                          className="studio-edgehandle"
                          onPointerDown={(e) => beginHandleDrag(e, "edge", i, nx, ny)}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            // add a pin in the middle of this edge
                            mutate((prev) => prev.map((sh) => {
                              if (sh.id !== s.id) return sh;
                              const pts = [...sh.pts];
                              pts.splice(i + 1, 0, { x: mx, y: my });
                              return { ...sh, pts };
                            }));
                          }} />
                      );
                    })}
                    {s.pts.map((p, i) => (
                      <circle key={"v" + i} cx={p.x} cy={p.y} r={6 / view.k}
                        className="studio-vertexhandle"
                        onPointerDown={(e) => beginHandleDrag(e, "vertex", i)}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (s.pts.length <= 3) return;
                          mutate((prev) => prev.map((sh) => sh.id === s.id
                            ? { ...sh, pts: sh.pts.filter((_, j) => j !== i) } : sh));
                        }} />
                    ))}
                  </g>
                );
              })()}
              {tracePts.length > 0 && phase === "edit" && (
                <g>
                  <polyline points={tracePts.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none" stroke="#2dd4bf" strokeWidth={3.2 / view.k} strokeDasharray={`${7 / view.k} ${5 / view.k}`} />
                  {tracePts.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={6 / view.k} fill="#2dd4bf" stroke="#0f1a2e" strokeWidth={2 / view.k} />
                  ))}
                </g>
              )}
            </g>
          </svg>

          {/* THE TOOLBAR (edit phase) */}
          {phase === "edit" && (
            <div className="studio-toolbar">
              <button className="pbtn small" disabled={!undoStack.current.length} title="Undo (Ctrl+Z)" onClick={undo}>↩</button>
              <button className="pbtn small" disabled={!redoStack.current.length} title="Redo (Ctrl+Shift+Z)" onClick={redo}>↪</button>
              <i className="tb-sep" />
              <ToolBtn id="select" label="☝ Select" title="Click a room; shift-click for several; drag to move" />
              <ToolBtn id="trace" label="✏ Trace" title="Tap corners of a missing room; the snap seats it" />
              <ToolBtn id="reshape" label="⬒ Reshape" title="Pins on the selected room: pull edges straight, drag pins, double-click an edge to add a pin, a pin to remove it" />
              <ToolBtn id="merge" label="⧉ Merge" title="Tap two touching rooms — they become one" />
              <i className="tb-sep" />
              <button className="pbtn small" disabled={!shapes.length} title="Select every room"
                onClick={() => { setSel(new Set(shapes.map((s) => s.id))); setTool("select"); }}>
                ▣ All
              </button>
              <button className="pbtn small" disabled={!selShapes.length}
                title="Seat the selected room(s): nearest wall lines + flush against neighbouring rooms (no gaps, no overlaps)"
                onClick={() => mutate((prev) => prev.map((s) => sel.has(s.id)
                  ? { ...s, pts: cleanSnap(s.pts, prev.filter((o) => o.id !== s.id).map((o) => o.pts), true) }
                  : s))}>
                ⌖ Snap
              </button>
              <button className="pbtn small danger" disabled={!selShapes.length}
                onClick={() => {
                  mutate((prev) => prev.filter((s) => !sel.has(s.id)));
                  setSel(new Set());
                }}>✕ Delete</button>
            </div>
          )}

          {phase === "edit" && tool === "trace" && (
            <div className="studio-tracebar">
              <b>{tracePts.length === 0
                ? "Tap roughly at each corner — the snap pulls the shape onto the walls."
                : `${tracePts.length} corner${tracePts.length === 1 ? "" : "s"} placed`}</b>
              <button className="pbtn small" disabled={!tracePts.length}
                onClick={() => setTracePts((p) => p.slice(0, -1))}>↩ Undo point</button>
              <button className="pbtn small primary" disabled={tracePts.length < 3}
                onClick={finishTrace}>✓ Finish room</button>
            </div>
          )}
          {phase === "edit" && tool === "merge" && (
            <div className="studio-tracebar">
              <b>{mergeFirst ? "Now tap the room to merge it with" : "Tap the FIRST of the two rooms to merge"}</b>
              {mergeFirst && <button className="pbtn small ghost" onClick={() => setMergeFirst(null)}>✕ Start over</button>}
            </div>
          )}
          {phase === "edit" && selShapes.length > 1 && tool === "select" && (
            <div className="studio-tracebar">
              <b>{selShapes.length} boxes selected — drag together, arrows nudge, ⌖ Snap seats them</b>
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
          {phase === "edit" && (
            <>
              <div className="studio-calbox ok">
                {direct ? (<>
                  <b>Check Max's reading, then ship</b>
                  <span>Room numbers, names and square footage came off the plan. Fix any box or
                    number, merge splits (their square footage adds up), trace anything missed —
                    then 🚀 Ship. Blanks are fine; rooms missing info get flagged in Max Space.</span>
                </>) : (<>
                  <b>1 · Make the drawing match the plan</b>
                  <span>Max drew first; you correct. Move boxes, reshape funky ones, merge splits,
                    trace anything missed. Overlapping boxes are dropped automatically.</span>
                </>)}
              </div>
              <button className="pbtn" disabled={aiBusy} onClick={maxDrawMore}>
                {aiBusy ? "✨ Max is drawing…" : "✨ Max draws the rooms"}
              </button>
              {shapes.some((s) => s.source === "ai") && (
                <button className="pbtn small" onClick={() => {
                  setSel(new Set(shapes.filter((s) => s.source === "ai").map((s) => s.id)));
                  setTool("select");
                }}>▣ Select all of Max's boxes</button>
              )}
            </>
          )}
          {phase === "calibrate" && (
            <div className={"studio-calbox" + (cal ? " ok" : "")}>
              {sizesFromFile ? (<>
                <b>2 · Sizes read from the plan — {anchors.length} room{anchors.length === 1 ? "" : "s"} measured</b>
                <span>Max copied the square footage stated on the plan. Spot-check a few against
                  what you know, fix any it misread, and fill in any it missed.</span>
              </>) : (<>
                <b>2 · Calibrate — {anchors.length} of {MAX_ANCHORS} rooms set</b>
                <span>Select up to three rooms you KNOW and type each one's calibration measurement.
                  Then measure everything.</span>
              </>)}
            </div>
          )}
          {phase === "details" && (
            <div className="studio-calbox ok">
              <b>3 · Every room measured ✓</b>
              <span>The matrix is locked. Select each room and enter its details, then ship.</span>
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

              {phase === "edit" && (
                <small className="pnote">
                  {tool === "reshape"
                    ? "Pull a square handle to slide that edge straight. Drag a round pin (it lines up with its neighbours). Double-click an edge to add a pin, a pin to remove it."
                    : "Drag to move · arrows nudge · ⬒ Reshape for pins · ⌖ Snap seats it on the walls."}
                </small>
              )}

              {direct && phase === "edit" && (
                <label className="pfield">Square feet <small>read from the plan — fix it, or type it for a room you traced</small>
                  <input type="number" min={0}
                    value={one.knownSqFt ?? ""}
                    placeholder={sqftOf(one) !== null ? `≈ ${sqftOf(one)} (measured from the plan's scale)` : "e.g. 240"}
                    onChange={(e) => {
                      const v = Number(e.target.value) > 0 ? Number(e.target.value) : null;
                      patchShape(one.id, { knownSqFt: v });
                    }} />
                </label>
              )}

              {phase === "calibrate" && (
                <label className="pfield">Calibration measurement <small>sq ft you KNOW</small>
                  <input type="number" min={0}
                    value={one.knownSqFt ?? ""}
                    placeholder="e.g. 600"
                    onChange={(e) => {
                      const v = Number(e.target.value) > 0 ? Number(e.target.value) : null;
                      // the 3-room ceiling is for plans with NO sizes; a plan
                      // that stated them arrives with every room measured
                      if (v && !sizesFromFile && (one.knownSqFt ?? 0) <= 0 && anchors.length >= MAX_ANCHORS) {
                        setErr(`Up to ${MAX_ANCHORS} calibration rooms — clear one first.`);
                        return;
                      }
                      setErr("");
                      patchShape(one.id, { knownSqFt: v });
                    }} />
                  <small>{(one.knownSqFt ?? 0) > 0 ? "⚓ A calibration room — it anchors the scale." : "Leave blank unless you truly know this room."}</small>
                </label>
              )}

              {(phase === "details" || (direct && phase === "edit")) && (
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
                        placeholder="pick one, or type a NEW department"
                        onChange={(e) => patchShape(one.id, { department: e.target.value })} />
                      <datalist id="studio-depts">{deptOptions.map((d) => <option key={d} value={d} />)}</datalist>
                      <small>Typing a name that doesn't exist yet creates the department when you ship.</small>
                    </label>
                  </div>
                  {phase === "details" &&
                    <p className="pnote">Measured: <b>{sqftOf(one) ?? "—"} ft²</b>{(one.knownSqFt ?? 0) > 0 ? " (⚓ your calibration)" : ""}</p>}
                </>
              )}
            </div>
          )}

          <div className="studio-list">
            {shapes.map((s) => (
              <button key={s.id} className={"studio-row" + (sel.has(s.id) ? " on" : "")}
                onClick={(e) => {
                  if (e.shiftKey && phase === "edit") {
                    setSel((prev) => {
                      const next = new Set(prev);
                      if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
                      return next;
                    });
                  } else setSel(new Set([s.id]));
                }}>
                <i style={{ background: s.source === "ai" ? AI : TRACED }} />
                <b>{s.roomNumber || s.roomName || "(no name yet)"}</b>
                {phase === "details" && !s.department && <em className="miss">dept?</em>}
                <em>
                  {phase === "edit" && !direct ? (s.source === "ai" ? "Max" : "traced")
                    : (s.knownSqFt ?? 0) > 0 ? `${direct ? "" : "⚓ "}${s.knownSqFt}` : sqftOf(s) ?? "—"}
                </em>
              </button>
            ))}
            {!shapes.length && <p className="pnote">Nothing drawn yet — ✨ Max draws the rooms, or ✏ Trace them yourself.</p>}
          </div>

          {phase === "edit" && (direct ? (
            <button className="pbtn primary wide" onClick={() => {
              if (!shapes.length) { setErr("Draw at least one room first — ✏ Trace, or ✨ Max draws the rooms."); return; }
              ship();
            }}>🚀 Ship to Max Space</button>
          ) : (
            <button className="pbtn primary wide" onClick={finishEditing}>✓ Finish editing — calibrate next</button>
          ))}
          {phase === "calibrate" && (
            <button className="pbtn primary wide" disabled={!cal} onClick={measureAll}>
              {sizesFromFile ? "📏 Sizes look right — build the matrix" : "📏 Measure all rooms"}
            </button>
          )}
          {phase === "details" && (
            <button className="pbtn primary wide" onClick={ship}>🚀 Ship to Max Space</button>
          )}
          <small className="pnote">
            {phase === "edit"
              ? (direct
                ? `Everything Max read ships into ${[account, building, floor].filter(Boolean).join(" → ") || "your account"}. Blanks are fine — rooms missing info get flagged in Max Space.`
                : "When the drawing matches the plan, finish editing and calibrate.")
              : phase === "calibrate"
                ? (sizesFromFile
                  ? "Rooms Max didn't find a size for are measured against the ones it did."
                  : "Every room's square footage will be measured from your calibration rooms.")
                : `Ships into ${[account, building, floor].filter(Boolean).join(" → ") || "your account"} → department → room. Blanks are fine — you'll validate rooms in Max Space.${existingSet ? " Same rooms update — schedules stay intact." : ""}`}
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

/** what Max read ("Exam Room", "OR") → the account's own Scope label, or "" */
function scopeLabelFor(rules: Rules, read: string): string {
  const id = typeIdFromLabelStrict(rules, read);
  return id ? rules.roomTypes.find((rt) => rt.id === id)?.label ?? "" : "";
}

// ── the Calibration Editor HOME (reached from Max Space's navigation) ──────
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
        remodel — move the boxes, reshape, merge, re-calibrate — and shipping the update lands on
        the SAME rooms in Max Space, so schedules and history never break.
      </p>
      {msg && <p className="pnote keysaved">{msg}</p>}
      {!sets.length && (
        <p className="pnote">
          Nothing here yet. Build one with <b>⬆ Import → 🗺 Floor plan → "No — it's just the floor
          plan, no sizes"</b> — Max draws it, you correct and calibrate.
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
