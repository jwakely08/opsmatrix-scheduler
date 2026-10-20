// The Calibration Editor's ingest/snap chain, extracted pure so the scoring
// harness drives EXACTLY what the editor does (and so every stage is
// unit-testable without React).
//
// cleanSnap = wall snap + Josh's border rule, each stage guarded: a snap may
// refine a shape, never destroy it (snapCollapsed) — and for an AI seed the
// snap reach is a fraction of the seed's OWN size (snapReachFor), because on
// a dense sheet the sheet-sized default reach equals a whole room pitch and
// teleports correctly-placed boxes onto the neighbour's walls.
import {
  snapToWalls, alignEdgesToNeighbors, rectify, snapCollapsed, snapReachFor,
  dropSpikes, shoelacePx, overlapRatio, boundarySupport, avgWidth,
  autoDetectRooms, type Gray, type XY
} from "./planSnap";
import { typeIdFromLabelStrict, type Rules } from "./rules";

/** the hard rule: a new box covering this much of an existing one is a dupe */
export const OVERLAP_LIMIT = 0.35;

export interface SeedIn {
  name: string;
  roomNumber: string;
  roomType: string;
  polygon: number[][];
  squareFeet?: number;
}

export interface IngestedShape {
  pts: XY[];
  roomNumber: string;
  roomName: string;
  roomType: string;
  floorType: string;
  fixtureCount: number;
  department: string;
  knownSqFt: number | null;
  source: "ai";
}

export function cleanSnapPts(
  gray: Gray | null,
  picW: number,
  pts: XY[],
  others: XY[][],
  opts?: { tight?: boolean; reach?: number }
): XY[] {
  const graySc = gray ? gray.w / picW : 1;
  const snapPx = (p: XY[]): XY[] => {
    if (!gray) return p;
    const scaled = p.map((q) => ({ x: q.x * graySc, y: q.y * graySc }));
    const maxOffset = opts?.reach != null
      ? Math.max(4, opts.reach * graySc)
      : opts?.tight ? Math.max(6, 14 * graySc) : undefined;
    const snapped = snapToWalls(gray, scaled, maxOffset != null ? { maxOffset } : undefined);
    return snapped.map((q) => ({ x: q.x / graySc, y: q.y / graySc }));
  };
  const drawn = rectify(pts);
  const snapped = snapPx(pts);
  const walled = snapCollapsed(drawn, snapped) ? drawn : snapped;
  // the border rule runs in GRAY space so it can see the walls: a gap with
  // wall ink inside it is a real wall with WIDTH, never closed
  const seated = gray
    ? alignEdgesToNeighbors(
      walled.map((q) => ({ x: q.x * graySc, y: q.y * graySc })),
      others.map((poly) => poly.map((q) => ({ x: q.x * graySc, y: q.y * graySc }))),
      12, gray
    ).map((q) => ({ x: q.x / graySc, y: q.y / graySc }))
    : alignEdgesToNeighbors(walled, others, 12);
  const clean = snapCollapsed(drawn, seated) ? walled : seated;
  // the snap's corner rebuild can fire a needle triangle out of a door gap
  const spiked = dropSpikes(clean);
  return snapCollapsed(drawn, spiked) ? clean : spiked;
}

/** what Max read ("Exam Room", "OR") → the account's own Scope label, or "" */
export function scopeLabelFor(rules: Rules, read: string): string {
  const id = typeIdFromLabelStrict(rules, read);
  return id ? rules.roomTypes.find((rt) => rt.id === id)?.label ?? "" : "";
}

/**
 * Max's boxes: scale-aware snap + THE HARD NO-OVERLAP RULE. Boxes are taken
 * largest-first; a box covering more than OVERLAP_LIMIT of one already kept
 * is a duplicate reading and is dropped.
 */
export function ingestAiSeeds(
  seeds: SeedIn[],
  existing: { pts: XY[]; roomNumber?: string }[],
  gray: Gray | null,
  picW: number,
  picH: number,
  rules: Rules,
  opts?: {
    /** after the AI seeds land, find enclosed rooms nothing covers from the
     *  plan's own lines and add them unnamed (the local detector) */
    fillGaps?: boolean;
  }
): { shapes: IngestedShape[]; dropped: number; gapFilled: number } {
  const candidates = seeds
    .map((r) => ({ seed: r, pts: r.polygon.map((q) => ({ x: q[0] * picW, y: q[1] * picH })) }))
    .sort((a, b) => shoelacePx(b.pts) - shoelacePx(a.pts));
  const shapes: IngestedShape[] = [];
  for (const c of candidates) {
    const blockers: { pts: XY[]; roomNumber?: string }[] =
      [...existing, ...shapes.map((s) => ({ pts: s.pts, roomNumber: s.roomNumber }))];
    // reach in PICTURE px — cleanSnapPts converts to grid px itself
    const reach = snapReachFor(c.pts, picW);
    const pts = cleanSnapPts(gray, picW, c.pts, blockers.map((b) => b.pts), { reach });
    // the hard rule guards against DUPLICATE readings. A printed number is
    // evidence read off the plan: a numbered seed only ever loses to the
    // SAME number — never to a different number, and never to an unnumbered
    // shape (a sloppy corridor polygon must not eat the rooms it brushes).
    // Unnumbered seeds drop on any big overlap.
    const num = (c.seed.roomNumber || "").trim();
    if (blockers.some((b) => {
      const bn = (b.roomNumber || "").trim();
      if (num && bn !== num) return false; // numbered dies only to its own number
      return overlapRatio(b.pts, pts) > OVERLAP_LIMIT;
    })) continue; // dupe — dropped
    // a shape floating in blank space (no drawn walls under its boundary)
    // is a hallucination — a printed number is evidence enough to keep, an
    // unnumbered shape is not
    if (!num && gray) {
      const gPts = pts.map((q) => ({ x: q.x * (gray.w / picW), y: q.y * (gray.w / picW) }));
      if (boundarySupport(gray, gPts) < 0.3) continue;
    }
    shapes.push({
      pts,
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
  const dropped = seeds.length - shapes.length;

  // ── the gap fill: rooms the reader missed, from the plan's own lines ──────
  let gapFilled = 0;
  if (opts?.fillGaps && gray) {
    const toPic = picW / gray.w;
    for (const poly of detectGapRooms(gray)) {
      const pts = poly.map((q) => ({ x: q.x * toPic, y: q.y * toPic }));
      const blockers = [...existing.map((b) => b.pts), ...shapes.map((s) => s.pts)];
      if (blockers.some((b) => overlapRatio(b, pts) > 0.3)) continue; // already drawn
      shapes.push({
        pts: dropSpikes(pts),
        roomNumber: "", roomName: "", roomType: "",
        floorType: "", fixtureCount: 0, department: "",
        knownSqFt: null, source: "ai"
      });
      gapFilled++;
    }
  }
  return { shapes, dropped, gapFilled };
}

/**
 * Enclosed rooms straight from the plan's own lines (bubble-erased,
 * door/window gaps sealed), as candidates for the gap fill. Pure over the
 * gray; polygons come back in GRAY pixels.
 */
export function detectGapRooms(gray: Gray): XY[][] {
  const minDim = Math.min(gray.w, gray.h);
  const sheet = gray.w * gray.h;
  return autoDetectRooms(gray, {
    keepBubbles: true, // the studio's gray is already label-erased
    maxSide: 1400,
    dilate: 3,
    minAreaFrac: 0.0004
  }).filter((poly) => {
    const area = shoelacePx(poly);
    // a COURTYARD is enclosed too — by the building's outer walls. No real
    // room approaches that size (the biggest auditorium is ~2-3% of the
    // sheet), so oversized enclosures are open air, not floor.
    return avgWidth(poly) >= Math.max(6, minDim * 0.005) &&
      area >= minDim * minDim * 0.0004 &&
      area <= sheet * 0.05;
  });
}
