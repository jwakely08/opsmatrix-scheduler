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
  shoelacePx, overlapRatio, type Gray, type XY
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
  const seated = alignEdgesToNeighbors(walled, others, 12);
  return snapCollapsed(drawn, seated) ? walled : seated;
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
  rules: Rules
): { shapes: IngestedShape[]; dropped: number } {
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
    // the hard rule guards against DUPLICATE readings — two shapes carrying
    // different printed numbers are different rooms however much their
    // outlines overlap, so only same/no-number overlaps drop
    const num = (c.seed.roomNumber || "").trim();
    if (blockers.some((b) => {
      const bn = (b.roomNumber || "").trim();
      if (num && bn && num !== bn) return false;
      return overlapRatio(b.pts, pts) > OVERLAP_LIMIT;
    })) continue; // dupe — dropped
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
  return { shapes, dropped: seeds.length - shapes.length };
}
