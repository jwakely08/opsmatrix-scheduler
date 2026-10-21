// A floor whose rooms are in but whose floor map isn't (Josh, 2026-10-21: floor 4 went in while the
// iPad was out of room — its 338 rooms saved, its map didn't, so it never showed on the maps).
// A floor map is a drawing made from the rooms' own outlines (buildPlanFromRooms), so it can be
// drawn again from the rooms that point at it: the same id, the same size, the same outlines.
// The rooms themselves are not touched. Runs when a page starts.
import { buildPlanFromRooms } from "../bridge/aiPlanImport";

interface Pt { x: number; y: number }
interface SpaceLike {
  id?: string;
  building?: string; floor?: string; visualBuilding?: string; visualFloor?: string;
  visualPlanId?: string; visualW?: number; visualH?: number; visualPts?: Pt[];
  roomNumber?: string; roomName?: string; roomType?: string; squareFeet?: number;
}
type PlanLike = Record<string, unknown> & { id?: unknown };

/** the value most of the list shares (first seen wins a tie) */
function most<T>(xs: T[]): T | undefined {
  const seen = new Map<T, number>();
  let best: T | undefined, n = 0;
  for (const x of xs) {
    const c = (seen.get(x) ?? 0) + 1;
    seen.set(x, c);
    if (c > n) { best = x; n = c; }
  }
  return best;
}

const usable = (pts: unknown): pts is Pt[] =>
  Array.isArray(pts) && pts.length >= 3 && pts.every((p) => p && Number.isFinite((p as Pt).x) && Number.isFinite((p as Pt).y));

/** Floor maps drawn again for rooms that point at a map that isn't there. */
export function rebuildMissingPlans(spaces: SpaceLike[], plans: PlanLike[], now = new Date().toISOString()): PlanLike[] {
  const known = new Set(plans.map((p) => String(p.id ?? "")));
  const orphans = new Map<string, SpaceLike[]>();
  for (const sp of spaces) {
    const id = String(sp.visualPlanId ?? "");
    if (!id || known.has(id) || !sp.id || !usable(sp.visualPts)) continue;
    let group = orphans.get(id);
    if (!group) orphans.set(id, (group = []));
    group.push(sp);
  }
  const rebuilt: PlanLike[] = [];
  for (const [id, group] of orphans) {
    const W = Number(most(group.map((s) => Number(s.visualW) || 0)));
    const H = Number(most(group.map((s) => Number(s.visualH) || 0)));
    if (!(W > 0 && H > 0)) continue;
    const building = String(most(group.map((s) => String(s.visualBuilding || s.building || "").trim())) ?? "");
    const floor = String(most(group.map((s) => String(s.visualFloor || s.floor || "").trim())) ?? "");
    const result = buildPlanFromRooms({
      buildingName: building,
      floorName: floor,
      rooms: group.map((s) => ({
        name: String(s.roomName ?? ""),
        roomNumber: String(s.roomNumber ?? ""),
        roomType: String(s.roomType ?? ""),
        squareFeet: Number(s.squareFeet) || 0,
        polygon: (s.visualPts as Pt[]).map((p) => [p.x / W, p.y / H])
      }))
    }, { building, floor, aspect: W / H, size: Math.max(W, H), now });
    const plan = result.plan as PlanLike;
    plan.id = id;
    plan.building = building;
    plan.floor = floor;
    plan.w = W;
    plan.h = H;
    plan.rooms = group.map((s) => ({ spaceId: s.id, pts: s.visualPts }));
    plan.source = "rebuilt-from-rooms";
    rebuilt.push(plan);
  }
  return rebuilt;
}

/** Draws any missing floor maps on this device and saves them. Returns how many. */
export function healMissingPlans(store: Pick<Storage, "getItem" | "setItem"> = localStorage): number {
  try {
    const v7 = JSON.parse(store.getItem("opsmatrix_v7") ?? "null");
    const plans = JSON.parse(store.getItem("opsmatrix_v7_plans") ?? "[]");
    if (!v7 || !Array.isArray(v7.spaces) || !Array.isArray(plans)) return 0;
    const rebuilt = rebuildMissingPlans(v7.spaces, plans);
    if (!rebuilt.length) return 0;
    store.setItem("opsmatrix_v7_plans", JSON.stringify([...plans, ...rebuilt]));
    return rebuilt.length;
  } catch {
    return 0; // never block the app
  }
}
