// One place, one name (Josh, 2026-10-20: a floor uploaded to "fairview" became a second building
// beside "Fairview"). Account, building and floor names that differ only in capitals or spacing
// are the same place. This module
//   1. lists the places OpsMatrix already has, for the upload form's drop-downs, and
//   2. repairs data that already has such twins: the spelling most rooms use wins — accounts
//      across the board, buildings within their account, floors within their building — in the
//      rooms, the plans, the sanitation/policing routes and the Calibration Editor's sets.
// Pure functions plus one storage wrapper (run when a page starts); unit-tested.

export const placeKey = (s: unknown): string => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

interface SpaceLike { system?: string; building?: string; floor?: string; visualBuilding?: string; visualFloor?: string; id?: string }
interface PlanLike { building?: string; floor?: string; rooms?: { spaceId: string }[]; id?: string }
interface SetLike { account?: string; building?: string; floor?: string; planId?: string }
interface RouteLike { building?: string; planId?: string }

export interface PlaceStores {
  spaces: SpaceLike[];
  plans: PlanLike[];
  sets: SetLike[];
  routes: { sanitation?: RouteLike[]; policing?: RouteLike[] };
}

/** the spelling most uses share; on a tie, the one written with more capitals ("2nd Floor" over
 *  "2nd floor"), then the first seen */
function winner(tally: Map<string, number>): string {
  let best = "", n = -1, caps = -1;
  for (const [name, c] of tally) {
    const k = (name.match(/[A-Z]/g) ?? []).length;
    if (c > n || (c === n && k > caps)) { best = name; n = c; caps = k; }
  }
  return best;
}
function vote(groups: Map<string, Map<string, number>>, key: string, name: string) {
  let g = groups.get(key);
  if (!g) groups.set(key, (g = new Map()));
  g.set(name, (g.get(name) ?? 0) + 1);
}
const clean = (s: unknown) => String(s ?? "").trim().replace(/\s+/g, " ");
const SEP = "\u0001";

/** Gives every account, building and floor one spelling. Returns how many names changed. */
export function mergePlaceNames(st: PlaceStores): number {
  const accountVotes = new Map<string, Map<string, number>>();
  const buildingVotes = new Map<string, Map<string, number>>(); // acct ␁ building
  const floorVotes = new Map<string, Map<string, number>>(); // acct ␁ building ␁ floor
  for (const sp of st.spaces) {
    const a = clean(sp.system), b = clean(sp.building), f = clean(sp.floor);
    if (a) vote(accountVotes, placeKey(a), a);
    if (b) vote(buildingVotes, placeKey(a) + SEP + placeKey(b), b);
    if (b && f) vote(floorVotes, placeKey(a) + SEP + placeKey(b) + SEP + placeKey(f), f);
  }
  // names only the Calibration Editor's sets know still get one spelling among themselves
  for (const s of st.sets) {
    const a = clean(s.account), b = clean(s.building), f = clean(s.floor);
    if (a && !accountVotes.has(placeKey(a))) vote(accountVotes, placeKey(a), a);
    const bk = placeKey(a) + SEP + placeKey(b);
    if (b && !buildingVotes.has(bk)) vote(buildingVotes, bk, b);
    const fk = bk + SEP + placeKey(f);
    if (b && f && !floorVotes.has(fk)) vote(floorVotes, fk, f);
  }
  const accountName = new Map([...accountVotes].map(([k, t]) => [k, winner(t)]));
  const buildingName = new Map([...buildingVotes].map(([k, t]) => [k, winner(t)]));
  const floorName = new Map([...floorVotes].map(([k, t]) => [k, winner(t)]));
  // the accounts a building name lives under (to place plans and routes, which carry no account)
  const accountsOfBuilding = new Map<string, Set<string>>();
  for (const k of buildingName.keys()) {
    const [a, b] = k.split(SEP);
    let s = accountsOfBuilding.get(b);
    if (!s) accountsOfBuilding.set(b, (s = new Set()));
    s.add(a);
  }

  let changed = 0;
  const fix = <T extends object>(obj: T, field: keyof T, to: string | undefined) => {
    const cur = obj[field] as unknown;
    if (typeof cur !== "string" || !cur.trim() || !to || cur === to) return;
    (obj as Record<string, unknown>)[field as string] = to;
    changed++;
  };
  const bName = (a: string, b: unknown) => buildingName.get(a + SEP + placeKey(b));
  const fName = (a: string, b: unknown, f: unknown) => floorName.get(a + SEP + placeKey(b) + SEP + placeKey(f));
  /** the account of a building with no account of its own: when its name lives under just one */
  const soleAccount = (b: unknown): string | undefined => {
    const s = accountsOfBuilding.get(placeKey(b));
    return s && s.size === 1 ? [...s][0] : undefined;
  };

  const accountOfSpace = new Map<string, string>();
  for (const sp of st.spaces) {
    const a = placeKey(sp.system);
    if (sp.id) accountOfSpace.set(sp.id, a);
    fix(sp, "system", accountName.get(a));
    fix(sp, "building", bName(a, sp.building));
    fix(sp, "visualBuilding", bName(a, sp.visualBuilding));
    fix(sp, "floor", fName(a, sp.building, sp.floor));
    fix(sp, "visualFloor", fName(a, sp.visualBuilding ?? sp.building, sp.visualFloor));
  }
  const accountOfPlan = new Map<string, string>();
  for (const p of st.plans) {
    const tally = new Map<string, number>();
    for (const r of p.rooms ?? []) { const a = accountOfSpace.get(r.spaceId); if (a !== undefined) tally.set(a, (tally.get(a) ?? 0) + 1); }
    const a = tally.size ? winner(tally) : soleAccount(p.building);
    if (a === undefined) continue;
    if (p.id) accountOfPlan.set(p.id, a);
    fix(p, "floor", fName(a, p.building, p.floor));
    fix(p, "building", bName(a, p.building));
  }
  for (const s of st.sets) {
    const a = placeKey(s.account);
    fix(s, "account", accountName.get(a));
    fix(s, "floor", fName(a, s.building, s.floor));
    fix(s, "building", bName(a, s.building));
  }
  for (const r of [...(st.routes.sanitation ?? []), ...(st.routes.policing ?? [])]) {
    const a = (r.planId && accountOfPlan.get(r.planId)) ?? soleAccount(r.building);
    if (a !== undefined) fix(r, "building", bName(a, r.building));
  }
  return changed;
}

// ── the places already in OpsMatrix, for the upload form ────────────────────

export interface KnownFloor { name: string; rooms: number }
export interface KnownBuilding { name: string; rooms: number; floors: KnownFloor[] }
export interface KnownAccount { name: string; rooms: number; buildings: KnownBuilding[] }

const byName = new Intl.Collator("en", { numeric: true, sensitivity: "base" }).compare;

export function knownPlaces(spaces: SpaceLike[]): KnownAccount[] {
  const accounts = new Map<string, { name: string; rooms: number; buildings: Map<string, { name: string; rooms: number; floors: Map<string, KnownFloor> }> }>();
  for (const sp of spaces) {
    const a = clean(sp.system), b = clean(sp.building), f = clean(sp.floor);
    if (!a || !b) continue;
    let acc = accounts.get(placeKey(a));
    if (!acc) accounts.set(placeKey(a), (acc = { name: a, rooms: 0, buildings: new Map() }));
    acc.rooms++;
    let bld = acc.buildings.get(placeKey(b));
    if (!bld) acc.buildings.set(placeKey(b), (bld = { name: b, rooms: 0, floors: new Map() }));
    bld.rooms++;
    if (f) {
      const fl = bld.floors.get(placeKey(f));
      if (fl) fl.rooms++; else bld.floors.set(placeKey(f), { name: f, rooms: 1 });
    }
  }
  return [...accounts.values()].map((a) => ({
    name: a.name, rooms: a.rooms,
    buildings: [...a.buildings.values()].map((b) => ({ name: b.name, rooms: b.rooms, floors: [...b.floors.values()].sort((x, y) => byName(x.name, y.name)) }))
      .sort((x, y) => byName(x.name, y.name))
  })).sort((x, y) => byName(x.name, y.name));
}

/** "1st Floor", "2nd Floor" → "3rd Floor"; "Level 2" → "Level 3"; nothing when there's no pattern */
export function nextFloorName(floors: { name: string }[]): string {
  const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th");
  let best: { n: number; make: (n: number) => string } | null = null;
  for (const { name } of floors) {
    const o = /^(\d+)(st|nd|rd|th)(\s+.*)$/i.exec(name.trim());
    if (o) { const n = +o[1]; if (!best || n > best.n) { const rest = o[3]; best = { n, make: (k) => ordinal(k) + rest }; } continue; }
    const l = /^(.*?\b)(\d+)$/.exec(name.trim());
    if (l) { const n = +l[2]; if (!best || n > best.n) { const head = l[1]; best = { n, make: (k) => head + k }; } }
  }
  return best ? best.make(best.n + 1) : "";
}

// ── on the device ───────────────────────────────────────────────────────────

const KEYS = { v7: "opsmatrix_v7", plans: "opsmatrix_v7_plans", sets: "opsmatrix_fusion_planstudio", routes: "opsmatrix_fusion_routes" } as const;

/** Merges name twins in this device's data and saves what changed. Safe to run on every start. */
export function repairPlaceNames(store: Pick<Storage, "getItem" | "setItem"> = localStorage): number {
  const read = (k: string, fallback: unknown) => { try { return JSON.parse(store.getItem(k) ?? "null") ?? fallback; } catch { return null; } };
  const v7 = read(KEYS.v7, {}) as { spaces?: SpaceLike[] } | null;
  const plans = read(KEYS.plans, []) as PlanLike[] | null;
  const sets = read(KEYS.sets, []) as SetLike[] | null;
  const routes = read(KEYS.routes, {}) as PlaceStores["routes"] | null;
  // a store that doesn't read cleanly is left exactly as it is
  if (!v7 || !Array.isArray(v7.spaces) || !v7.spaces.length) return 0;
  const before = [JSON.stringify(v7), JSON.stringify(plans), JSON.stringify(sets), JSON.stringify(routes)];
  const n = mergePlaceNames({
    spaces: v7.spaces,
    plans: Array.isArray(plans) ? plans : [],
    sets: Array.isArray(sets) ? sets : [],
    routes: routes && typeof routes === "object" ? routes : {}
  });
  if (!n) return 0;
  const after = [JSON.stringify(v7), JSON.stringify(plans), JSON.stringify(sets), JSON.stringify(routes)];
  const keys = [KEYS.v7, KEYS.plans, KEYS.sets, KEYS.routes];
  after.forEach((json, i) => {
    if (json === before[i] || json === "null") return;
    try { store.setItem(keys[i], json); } catch { /* out of room: the merge is redone on the next start */ }
  });
  return n;
}
