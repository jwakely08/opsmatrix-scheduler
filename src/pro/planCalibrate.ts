// Calibrate-with-Max (Josh, 2026-08-28): for a floor plan with NO readable
// sizes, Max still reads and draws every room (the §11 two-pass reader), and
// the manager then types the square footage of 1–3 rooms they KNOW. Those
// anchors set the plan's scale, every other room's square footage comes from
// its own drawn area, and the plan arrives matrix-style like every other
// import — no tracing, no measuring wheel.
//
// Math matches the reader's printed-size path exactly: ratio = px per foot,
// estimated from each anchor as sqrt(pixelArea / knownSqFt), median across
// anchors so one bad guess can't skew the building.

export interface CalRoomLike {
  id: string;
  roomNumber?: string;
  roomName?: string;
  squareFeet?: number;
  visualPts?: { x: number; y: number }[];
  [k: string]: unknown;
}

/** shoelace area of a polygon in plan pixels */
export function pixelArea(pts: { x: number; y: number }[] | undefined): number {
  if (!pts || pts.length < 3) return 0;
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  }
  return Math.abs(a) / 2;
}

export interface CalibrationResult {
  /** px per foot — store on the plan as plan.ratio (same as the reader) */
  pxPerFt: number;
  /** room id → the square footage calibration assigns it */
  sqftById: Map<string, number>;
  applied: number;
}

/**
 * anchors: the rooms the manager knows, with their true square footage.
 * Returns null when no anchor is usable (no geometry, or nonsense sqft).
 * Anchor rooms keep the EXACT number the manager typed; every other room
 * gets its drawn area divided by the calibrated scale.
 */
export function calibrateFromKnownRooms(
  rooms: CalRoomLike[],
  anchors: { id: string; sqft: number }[]
): CalibrationResult | null {
  const ratios: number[] = [];
  const anchorById = new Map<string, number>();
  for (const a of anchors) {
    if (!(a.sqft > 0)) continue;
    const room = rooms.find((r) => r.id === a.id);
    const areaPx = pixelArea(room?.visualPts);
    if (!room || areaPx <= 0) continue;
    ratios.push(Math.sqrt(areaPx / a.sqft));
    anchorById.set(a.id, a.sqft);
  }
  if (!ratios.length) return null;
  ratios.sort((x, y) => x - y);
  const mid = Math.floor(ratios.length / 2);
  const pxPerFt = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  if (!(pxPerFt > 0)) return null;

  const sqftById = new Map<string, number>();
  let applied = 0;
  for (const room of rooms) {
    const known = anchorById.get(room.id);
    if (known !== undefined) {
      sqftById.set(room.id, Math.round(known));
      applied++;
      continue;
    }
    const areaPx = pixelArea(room.visualPts);
    if (areaPx <= 0) continue; // no drawn shape → nothing honest to compute
    sqftById.set(room.id, Math.round(areaPx / (pxPerFt * pxPerFt)));
    applied++;
  }
  return { pxPerFt, sqftById, applied };
}
