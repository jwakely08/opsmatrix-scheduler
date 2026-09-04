// The 3D showcase view — the matrix as Josh's mockups imagine it: the baked
// neon blueprint laid down as a tilted holo-table, every detected room
// extruded into a glowing block, and a spin-and-settle sweep every time a
// floor loads. All geometry comes from iso3d.ts (orthographic + affine =
// TRUE to the detected rooms; a tap on a roof resolves to the exact same
// plan coordinates the 2D map uses).
//
// Canvas, not SVG: the intro animates every face every frame, and 200 rooms
// × ~6 faces would choke React reconciliation. Outside the intro and the
// short hover/press lerps the scene only repaints on change.
import React, { useEffect, useRef } from "react";
import { boundsOf, pointIn, type ClassicPlan, type ClassicSpace } from "./classicStore";
import {
  isoProject, isoUnproject, isoGroundMatrix, extrudeRoom, drawOrder,
  introPose, shadeHex, INTRO_MS, REST_SPIN, REST_TILT, WALL_H_FRAC,
  SEL_H_BOOST, type IsoPose, type XY
} from "./iso3d";

/** rooms colored the "not in this schedule" slate render low and dim */
const DIM_FILL = "#33404d";

export interface Map3DApi {
  zoom: (factor: number) => void;
  fit: () => void;
}

interface Shape { pts: XY[]; path: string; c: XY }

export function Map3D({ plan, spaces, shapes, fillFor, overlayFor, flagFor, selectedId, onRoom, onCanvas, marker, groundSrc, api }: {
  plan: ClassicPlan;
  spaces: ClassicSpace[];
  shapes: Map<string, Shape>;
  fillFor: (sp: ClassicSpace) => string;
  overlayFor?: (sp: ClassicSpace) => string | null;
  flagFor?: (sp: ClassicSpace) => string | null;
  selectedId: string | null;
  onRoom: (sp: ClassicSpace | null) => void;
  onCanvas?: (pt: XY) => void;
  marker?: { x: number; y: number; label: string } | null;
  /** the baked neon plan (or the plain plan while baking) — the floor */
  groundSrc: string;
  api?: React.MutableRefObject<Map3DApi | null>;
}) {
  const cvRef = useRef<HTMLCanvasElement>(null);
  // mutable scene state lives in refs — the render loop reads it directly
  const S = useRef({
    view: { k: 1, tx: 0, ty: 0 },
    pose: { spin: REST_SPIN, tilt: REST_TILT, cx: 0, cy: 0 } as IsoPose,
    introT: 1,            // 0..1 through the spin-and-settle
    introStart: 0,
    hoverId: null as string | null,
    hoverT: 0,            // 0..1 bloom progress on the hovered room
    pressedId: null as string | null,
    ground: null as HTMLImageElement | null,
    userDrove: false,
    raf: 0,
    lastTick: 0,
    needsPaint: true
  });
  // props snapshot for the paint loop (avoids re-binding the loop per render)
  const P = useRef({ plan, spaces, shapes, fillFor, overlayFor, flagFor, selectedId, marker });
  P.current = { plan, spaces, shapes, fillFor, overlayFor, flagFor, selectedId, marker };

  const wallH = () => Math.min(plan.w, plan.h) * WALL_H_FRAC;

  const reduced = () =>
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const fit = () => {
    const cv = cvRef.current;
    if (!cv) return;
    const st = S.current;
    st.pose = { spin: REST_SPIN, tilt: REST_TILT, cx: plan.w / 2, cy: plan.h / 2 };
    // fit the projected footprint INCLUDING the walls' height
    const h = wallH();
    const corners: XY[] = [];
    for (const [x, y] of [[0, 0], [plan.w, 0], [plan.w, plan.h], [0, plan.h]]) {
      corners.push(isoProject(st.pose, x, y, 0), isoProject(st.pose, x, y, h));
    }
    const b = boundsOf(corners);
    const w = cv.clientWidth || 1000, hh = cv.clientHeight || 640;
    const k = Math.min(w / (b.maxX - b.minX), hh / (b.maxY - b.minY)) * 0.9;
    st.view = {
      k,
      tx: (w - (b.maxX - b.minX) * k) / 2 - b.minX * k,
      ty: (hh - (b.maxY - b.minY) * k) / 2 - b.minY * k
    };
    st.userDrove = false;
    st.needsPaint = true;
  };

  const zoomAt = (sx: number, sy: number, factor: number) => {
    const st = S.current;
    st.userDrove = true;
    const k2 = Math.max(0.2, Math.min(12, st.view.k * factor));
    const f = k2 / st.view.k;
    st.view = { k: k2, tx: sx - (sx - st.view.tx) * f, ty: sy - (sy - st.view.ty) * f };
    st.needsPaint = true;
  };

  if (api) {
    api.current = {
      zoom: (f) => {
        const cv = cvRef.current;
        if (cv) zoomAt(cv.clientWidth / 2, cv.clientHeight / 2, f);
      },
      fit
    };
  }

  /** screen px → the room under the cursor (roof-plane hit, nearest first) */
  const roomAt = (sx: number, sy: number): ClassicSpace | null => {
    const st = S.current;
    const { spaces: sps, shapes: shs, selectedId: sel } = P.current;
    const px = (sx - st.view.tx) / st.view.k;
    const py = (sy - st.view.ty) / st.view.k;
    const base = wallH();
    let hit: ClassicSpace | null = null;
    let hitArea = Infinity;
    for (const sp of sps) {
      const sh = shs.get(sp.id);
      if (!sh) continue;
      const h = sp.id === sel ? base * SEL_H_BOOST : base;
      const q = isoUnproject(st.pose, px, py, h);
      if (!pointIn(sh.pts, q.x, q.y)) continue;
      const b = boundsOf(sh.pts);
      const area = (b.maxX - b.minX) * (b.maxY - b.minY);
      if (area < hitArea) { hit = sp; hitArea = area; }
    }
    return hit;
  };

  // ── the painter ───────────────────────────────────────────────────────────
  const paint = () => {
    const cv = cvRef.current;
    const st = S.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth || 1000, h = cv.clientHeight || 640;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    const { plan: pl, spaces: sps, shapes: shs, fillFor: fill, overlayFor: over,
      flagFor: flag, selectedId: sel, marker: mk } = P.current;

    const intro = introPose(st.introT);
    st.pose = { spin: intro.spin, tilt: intro.tilt, cx: pl.w / 2, cy: pl.h / 2 };
    const zoomK = st.view.k * intro.zoom;
    // zoom eases around the canvas center so the settle pulls forward in place
    const zc = { x: w / 2, y: h / 2 };
    const tx = zc.x + (st.view.tx - zc.x) * intro.zoom;
    const ty = zc.y + (st.view.ty - zc.y) * intro.zoom;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const toScreen = (p: XY): XY => ({ x: p.x * zoomK + tx, y: p.y * zoomK + ty });

    // the holo-table: a soft plate under the whole sheet
    const plate = [[0, 0], [pl.w, 0], [pl.w, pl.h], [0, pl.h]]
      .map(([x, y]) => toScreen(isoProject(st.pose, x, y, 0)));
    ctx.beginPath();
    plate.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.fillStyle = "rgba(8, 16, 32, 0.72)";
    ctx.fill();
    ctx.strokeStyle = "rgba(34, 211, 238, 0.28)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // the floor: the baked neon blueprint, laid onto the tilt by ONE affine
    if (st.ground) {
      const m = isoGroundMatrix(st.pose);
      ctx.save();
      ctx.transform(zoomK, 0, 0, zoomK, tx, ty);
      ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
      ctx.globalAlpha = 0.9;
      ctx.drawImage(st.ground, 0, 0, pl.w, pl.h);
      ctx.restore();
    }

    // rooms, back to front
    const base = wallH();
    const ordered = drawOrder(st.pose, sps
      .map((sp) => ({ pts: shs.get(sp.id)?.pts ?? [], item: sp }))
      .filter((r) => r.pts.length >= 3));
    const labels: { sp: ClassicSpace; at: XY; widthPx: number }[] = [];
    for (const { pts, item: sp } of ordered) {
      const color = fill(sp);
      const dim = color === DIM_FILL;
      const hovered = sp.id === st.hoverId;
      const selected = sp.id === sel;
      const pressed = sp.id === st.pressedId;
      // the motion system, canvas edition: hover blooms the block taller,
      // pressing sinks it back down
      let hMul = dim ? 0.35 : 1;
      if (selected) hMul *= SEL_H_BOOST;
      if (hovered) hMul *= 1 + 0.14 * st.hoverT;
      if (pressed) hMul *= 0.92;
      const ex = extrudeRoom(st.pose, pts, base * hMul);
      const glow = hovered ? 0.5 + 0.5 * st.hoverT : selected ? 1.35 : 1;

      for (const s of ex.sides) {
        ctx.beginPath();
        s.pts.forEach((q, i) => {
          const t = toScreen(q);
          i ? ctx.lineTo(t.x, t.y) : ctx.moveTo(t.x, t.y);
        });
        ctx.closePath();
        ctx.fillStyle = shadeHex(color, 0.28 + 0.5 * s.light);
        ctx.globalAlpha = dim ? 0.35 : 0.96;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.beginPath();
      ex.top.forEach((q, i) => {
        const t = toScreen(q);
        i ? ctx.lineTo(t.x, t.y) : ctx.moveTo(t.x, t.y);
      });
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.globalAlpha = dim ? 0.14 : hovered ? 0.42 + 0.12 * st.hoverT : selected ? 0.5 : 0.34;
      ctx.fill();
      ctx.globalAlpha = 1;
      const overlay = over?.(sp) ?? null;
      if (overlay && !dim) {
        ctx.fillStyle = overlay;
        ctx.globalAlpha = 0.3;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (selected || (hovered && st.hoverT > 0.05)) {
        ctx.save();
        ctx.shadowColor = selected ? "rgba(45,212,191,0.85)" : "rgba(34,211,238,0.6)";
        ctx.shadowBlur = selected ? 18 : 14 * st.hoverT;
        ctx.strokeStyle = selected ? "#ffffff" : shadeHex(color, 1.5);
        ctx.lineWidth = selected ? 3 : 2.5;
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.strokeStyle = shadeHex(color, dim ? 0.8 : 1.3 * glow);
        ctx.globalAlpha = dim ? 0.4 : 0.9;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      const b = boundsOf(ex.top);
      labels.push({ sp, at: toScreen(ex.labelAt), widthPx: (b.maxX - b.minX) * zoomK });
    }

    // labels float on the roofs, always upright — drawn last, never occluded
    ctx.textAlign = "center";
    for (const { sp, at, widthPx } of labels) {
      if (widthPx < 44 || st.introT < 0.75) continue;
      const mins = Number(sp.estimatedCleaningMinutes) || 0;
      const name = sp.roomNumber || sp.roomName || "";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(11, 18, 32, 0.7)";
      ctx.font = "700 13px 'Segoe UI', sans-serif";
      ctx.strokeText(name, at.x, at.y - 2);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(name, at.x, at.y - 2);
      ctx.font = "400 10.5px 'Segoe UI', sans-serif";
      const sub = `${Math.round(Number(sp.squareFeet) || 0)} ft² · ${mins}m`;
      ctx.strokeText(sub, at.x, at.y + 12);
      ctx.fillStyle = "#e2e8f0";
      ctx.fillText(sub, at.x, at.y + 12);
      const f = flag?.(sp);
      if (f) {
        ctx.font = "14px 'Segoe UI', sans-serif";
        ctx.fillText(f, at.x, at.y - 20);
      }
    }

    if (mk) {
      const at = toScreen(isoProject(st.pose, mk.x, mk.y, 0));
      ctx.font = "20px 'Segoe UI', sans-serif";
      ctx.fillText("📍", at.x, at.y);
      ctx.font = "700 12px 'Segoe UI', sans-serif";
      ctx.lineWidth = 3;
      ctx.strokeText(mk.label, at.x, at.y + 18);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(mk.label, at.x, at.y + 18);
    }
  };

  // ── the animation loop: runs only while something is actually moving ──────
  const tick = (now: number) => {
    const st = S.current;
    let animating = false;
    if (st.introT < 1) {
      st.introT = Math.min(1, (now - st.introStart) / INTRO_MS);
      animating = st.introT < 1;
      st.needsPaint = true;
    }
    const dt = st.lastTick ? Math.min(50, now - st.lastTick) : 16;
    st.lastTick = now;
    const hoverGoal = st.hoverId ? 1 : 0;
    if (st.hoverT !== hoverGoal) {
      const step = dt / 180; // the motion system's bloom pace
      st.hoverT = hoverGoal > st.hoverT
        ? Math.min(1, st.hoverT + step)
        : Math.max(0, st.hoverT - step);
      animating = animating || st.hoverT !== hoverGoal;
      st.needsPaint = true;
    }
    if (st.needsPaint) {
      st.needsPaint = false;
      paint();
    }
    st.raf = animating ? requestAnimationFrame(tick) : 0;
    if (!animating) st.lastTick = 0;
  };
  const wake = () => {
    const st = S.current;
    if (!st.raf) st.raf = requestAnimationFrame(tick);
  };

  // the spin-and-settle: every time a floor is pulled up
  useEffect(() => {
    const st = S.current;
    fit();
    if (reduced()) {
      st.introT = 1;
    } else {
      st.introT = 0;
      st.introStart = performance.now();
    }
    wake();
    return () => {
      if (st.raf) cancelAnimationFrame(st.raf);
      st.raf = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id]);

  // repaint when the data or selection changes (no animation needed)
  useEffect(() => {
    S.current.needsPaint = true;
    wake();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaces, shapes, selectedId, marker, groundSrc]);

  // the floor image
  useEffect(() => {
    let live = true;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      if (!live) return;
      S.current.ground = img;
      S.current.needsPaint = true;
      wake();
    };
    img.src = groundSrc;
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groundSrc]);

  // resize keeps the fit until the user drives
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const ro = new ResizeObserver(() => {
      if (!S.current.userDrove) fit();
      S.current.needsPaint = true;
      wake();
    });
    ro.observe(cv);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id]);

  // wheel zoom (non-passive)
  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
      wake();
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── gestures: same feel as the 2D map (tap slop, pinch, drag pan) ─────────
  const drag = useRef({ x: 0, y: 0, sx: 0, sy: 0, moved: false, on: false, slop: 5 });
  const pointers = useRef(new Map<number, XY>());
  const pinch = useRef<{ dist: number } | null>(null);

  const local = (e: React.PointerEvent): XY => {
    const r = cvRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <canvas ref={cvRef} className="pro-map pro-map3d"
      onPointerDown={(e) => {
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* fine */ }
        if (pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()];
          pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
          drag.current.on = false;
          drag.current.moved = true;
        } else {
          drag.current = {
            x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY,
            moved: false, on: true,
            slop: e.pointerType === "touch" ? 14 : 5
          };
          const pt = local(e);
          const hit = roomAt(pt.x, pt.y);
          S.current.pressedId = hit?.id ?? null;
          S.current.needsPaint = true;
          wake();
        }
      }}
      onPointerMove={(e) => {
        if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch.current && pointers.current.size >= 2) {
          const [a, b] = [...pointers.current.values()];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist > 0 && pinch.current.dist > 0) {
            const r = cvRef.current!.getBoundingClientRect();
            zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, dist / pinch.current.dist);
            wake();
          }
          pinch.current.dist = dist;
          return;
        }
        if (drag.current.on) {
          const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
          const travel = Math.hypot(e.clientX - drag.current.sx, e.clientY - drag.current.sy);
          if (travel > drag.current.slop) drag.current.moved = true;
          if (drag.current.moved) {
            const st = S.current;
            st.userDrove = true;
            st.view = { ...st.view, tx: st.view.tx + dx, ty: st.view.ty + dy };
            st.pressedId = null;
            st.needsPaint = true;
            drag.current.x = e.clientX; drag.current.y = e.clientY;
            wake();
            return;
          }
        }
        // hover: bloom the block under the cursor (mouse only — fingers
        // don't hover)
        if (e.pointerType === "mouse") {
          const pt = local(e);
          const hit = roomAt(pt.x, pt.y);
          const id = hit?.id ?? null;
          if (id !== S.current.hoverId) {
            S.current.hoverId = id;
            const cv = cvRef.current;
            if (cv) cv.style.cursor = id ? "pointer" : "grab";
            wake();
          }
        }
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2) pinch.current = null;
        drag.current.on = false;
        S.current.pressedId = null;
        S.current.needsPaint = true;
        wake();
        if (pointers.current.size === 0 && !drag.current.moved) {
          const pt = local(e);
          const hit = roomAt(pt.x, pt.y);
          if (!hit && onCanvas) {
            const st = S.current;
            const q = isoUnproject(st.pose,
              (pt.x - st.view.tx) / st.view.k, (pt.y - st.view.ty) / st.view.k, 0);
            if (q.x >= 0 && q.y >= 0 && q.x <= plan.w && q.y <= plan.h) {
              onCanvas(q);
              return;
            }
          }
          onRoom(hit);
        }
        setTimeout(() => { drag.current.moved = false; }, 0);
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2) pinch.current = null;
        drag.current.on = false;
        S.current.pressedId = null;
      }}
      onPointerLeave={() => {
        if (S.current.hoverId) {
          S.current.hoverId = null;
          wake();
        }
      }}
    />
  );
}
