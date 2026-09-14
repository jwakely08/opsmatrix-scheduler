// The demo hotel — "The Meridian", a 40-room boutique property with two
// suites, a lobby level and two guest floors. Seeds a lived-in afternoon:
// arrivals promised tonight, rooms in every condition, one out of order, one
// stale signal (so Unknown is on screen, never faked green), one failed
// inspection, open work orders, a morning's worth of ledger lines and a
// 14-day occupancy forecast. Refreshed by main.tsx when it is stale or the
// stamp bumps — never touches non-demo data.
import {
  type HotelState, type Space, type Cluster, type Staff, type RoomStatus, type WorkOrder,
  type LedgerEntry, type Reservation, type ForecastDay, emptyState, uid
} from "./store";
import { defaultRoomTypes } from "./rules";
import { buildPlan, rect, polygonArea } from "./plan";

export const DEMO_STAMP = "hotels-demo-v1";
const PX_PER_FT = 4;

function ago(min: number, base: number): string { return new Date(base - min * 60000).toISOString(); }
function ahead(min: number, base: number): string { return new Date(base + min * 60000).toISOString(); }

/** one double-loaded guest floor: 10 rooms each side of a 6-ft corridor */
function guestFloor(floor: string, base: number, clusters: Cluster[]): Space[] {
  const out: Space[] = [];
  const roomW = 13 * PX_PER_FT, roomD = 26 * PX_PER_FT, corr = 6 * PX_PER_FT;
  const x0 = 40, yTop = 30, yCorr = yTop + roomD, yBot = yCorr + corr;
  const stairW = 10 * PX_PER_FT;
  const n = 10;
  const mk = (number: string, name: string, typeId: string, pts: { x: number; y: number }[], clusterId?: string): Space =>
    ({ id: `sp-${floor}-${number}`, number, name, floor, typeId, sqft: Math.round(polygonArea(pts) / (PX_PER_FT * PX_PER_FT)), pts, clusterId, planId: `plan-${floor}`, updatedAt: new Date(base).toISOString() });
  // stairwells at both ends
  out.push(mk(`${floor}S1`, "West stair", "stairwell", rect(x0 - stairW, yTop, stairW, roomD * 2 + corr)));
  out.push(mk(`${floor}S2`, "East stair", "stairwell", rect(x0 + n * roomW, yTop, stairW, roomD * 2 + corr)));
  // corridor
  out.push(mk(`${floor}C`, "Guest corridor", "corridor", rect(x0, yCorr, n * roomW, corr)));
  // top row: 01..10 (odd numbering on the top side for realism: 01,03,...)
  const types = ["king", "queen", "double-queen", "king", "accessible", "queen", "double-queen", "king", "queen", "king"];
  for (let i = 0; i < n; i++) {
    const num = `${floor}${String(i * 2 + 1).padStart(2, "0")}`;
    if (i === 4) {
      // the middle of the top row is the elevator lobby + linen closet + ice
      out.push(mk(`${floor}E`, "Elevator lobby", "elevator-lobby", rect(x0 + i * roomW, yTop + roomD * 0.55, roomW, roomD * 0.45)));
      out.push(mk(`${floor}L`, "Linen closet", "linen", rect(x0 + i * roomW, yTop, roomW * 0.55, roomD * 0.55)));
      out.push(mk(`${floor}I`, "Ice / vending", "ice-vending", rect(x0 + i * roomW + roomW * 0.55, yTop, roomW * 0.45, roomD * 0.55)));
      continue;
    }
    out.push(mk(num, `Room ${num}`, types[i], rect(x0 + i * roomW, yTop, roomW, roomD)));
  }
  // bottom row: 02..20; the last two make the suite
  const btypes = ["queen", "king", "double-queen", "queen", "king", "queen", "double-queen", "king", "suite-parlor", "suite-bedroom"];
  for (let i = 0; i < n; i++) {
    const num = `${floor}${String(i * 2 + 2).padStart(2, "0")}`;
    const pts = rect(x0 + i * roomW, yBot, roomW, roomD);
    if (i >= 8) {
      const suiteNo = `${floor}20`;
      const cid = `cl-${suiteNo}`;
      if (!clusters.some((c) => c.id === cid)) clusters.push({ id: cid, number: `Suite ${suiteNo}`, name: `Suite ${suiteNo}`, floor, memberIds: [] });
      const sp = mk(num, i === 8 ? "Parlor" : "Bedroom", btypes[i], pts, cid);
      clusters.find((c) => c.id === cid)!.memberIds.push(sp.id);
      out.push(sp);
      continue;
    }
    out.push(mk(num, `Room ${num}`, btypes[i], pts));
  }
  return out;
}

function lobbyFloor(base: number): Space[] {
  const F = "L";
  const mk = (number: string, name: string, typeId: string, pts: { x: number; y: number }[]): Space =>
    ({ id: `sp-${F}-${number}`, number, name, floor: F, typeId, sqft: Math.round(polygonArea(pts) / (PX_PER_FT * PX_PER_FT)), pts, planId: `plan-${F}`, updatedAt: new Date(base).toISOString() });
  const u = PX_PER_FT;
  return [
    mk("LOBBY", "Lobby", "lobby", rect(40, 30, 60 * u, 40 * u)),
    mk("ELEV", "Elevator lobby", "elevator-lobby", rect(40 + 60 * u, 30, 18 * u, 20 * u)),
    mk("WC-W", "Women's restroom", "public-restroom", rect(40 + 60 * u, 30 + 20 * u, 9 * u, 20 * u)),
    mk("WC-M", "Men's restroom", "public-restroom", rect(40 + 69 * u, 30 + 20 * u, 9 * u, 20 * u)),
    mk("GYM", "Fitness center", "gym", rect(40 + 78 * u, 30, 30 * u, 26 * u)),
    mk("MTG", "Meridian Room", "meeting", rect(40 + 78 * u, 30 + 26 * u, 30 * u, 14 * u)),
    mk("POOL", "Pool deck", "pool-deck", rect(40, 30 + 40 * u + 6 * u, 60 * u, 30 * u)),
    mk("HK", "Housekeeping office", "linen", rect(40 + 60 * u, 30 + 40 * u + 6 * u, 24 * u, 14 * u)),
    mk("LS1", "Stair", "stairwell", rect(40 + 84 * u, 30 + 40 * u + 6 * u, 10 * u, 14 * u))
  ];
}

export function buildDemo(now = Date.now()): HotelState {
  const s = emptyState();
  s.settings.hotelName = "The Meridian";
  s.settings.demoStamp = DEMO_STAMP;
  s.settings.updatedAt = new Date(now).toISOString();
  s.settings.me = "Josh";
  s.roomTypes = defaultRoomTypes();

  const clusters: Cluster[] = [];
  const f3 = guestFloor("3", now, clusters);
  const f4 = guestFloor("4", now, clusters);
  const fl = lobbyFloor(now);
  s.spaces = [...fl, ...f3, ...f4];
  s.clusters = clusters;
  s.plans = [
    buildPlan("plan-L", "L", fl, PX_PER_FT),
    buildPlan("plan-3", "3", f3, PX_PER_FT),
    buildPlan("plan-4", "4", f4, PX_PER_FT)
  ];

  const staff: Staff[] = [
    { id: "st-rosa", name: "Rosa Delgado", role: "attendant", floors: ["3"] },
    { id: "st-ana", name: "Ana Petrova", role: "attendant", floors: ["3"] },
    { id: "st-luis", name: "Luis Moreno", role: "attendant", floors: ["4"] },
    { id: "st-ines", name: "Ines Okoro", role: "attendant", floors: ["4"] },
    { id: "st-dana", name: "Dana Whitfield", role: "inspector" },
    { id: "st-marco", name: "Marco Bianchi", role: "engineering" },
    { id: "st-priya", name: "Priya Nair", role: "frontdesk" },
    { id: "st-sam", name: "Sam Ferreira", role: "gm" },
    { id: "st-josh", name: "Josh", role: "manager" }
  ];
  s.staff = staff;

  // ── a lived-in afternoon (all times relative to now) ────────────────────
  const guest = s.spaces.filter((sp) => s.roomTypes.find((t) => t.id === sp.typeId)?.kind === "guest");
  const st: Record<string, RoomStatus> = {};
  const set = (num: string, patch: Partial<RoomStatus> & { cond?: RoomStatus["condition"]; occ?: RoomStatus["occupancy"] }) => {
    const sp = s.spaces.find((x) => x.number === num)!;
    const cur = st[sp.id] ?? { spaceId: sp.id, occupancy: null, condition: null, engineering: { ooo: false, at: ago(20, now) }, flags: { vip: false, doNotWalk: false, at: ago(20, now) }, inspection: null, readyPath: [], override: null };
    const { cond, occ, ...rest } = patch;
    st[sp.id] = { ...cur, ...rest, condition: cond ?? cur.condition, occupancy: occ ?? cur.occupancy };
  };
  // baseline: every guest room fresh, stayover, inspected this morning
  for (const sp of guest) {
    st[sp.id] = {
      spaceId: sp.id,
      occupancy: { value: "stayover", at: ago(12, now), source: "demo" },
      condition: { value: "inspected", at: ago(12, now), since: ago(90, now), source: "demo", by: "Dana Whitfield" },
      engineering: { ooo: false, at: ago(12, now) },
      flags: { vip: false, doNotWalk: false, at: ago(12, now) },
      inspection: { result: "pass", at: ago(85, now), by: "Dana Whitfield" },
      readyPath: [
        { step: "dirty", at: ago(200, now) }, { step: "clean", at: ago(120, now), by: "Rosa Delgado" },
        { step: "inspect", at: ago(85, now), by: "Dana Whitfield" }, { step: "ready", at: ago(85, now) }
      ],
      override: null
    };
  }
  // public areas: fresh, clean
  for (const sp of s.spaces) {
    if (st[sp.id]) continue;
    st[sp.id] = { spaceId: sp.id, occupancy: { value: "vacant", at: ago(30, now), source: "demo" }, condition: { value: "clean", at: ago(45, now), source: "demo" }, engineering: { ooo: false, at: ago(30, now) }, flags: { vip: false, doNotWalk: false, at: ago(30, now) }, inspection: null, readyPath: [], override: null };
  }
  // tonight's arrivals — promised times spread across the afternoon/evening
  const arrivals: [string, number, boolean][] = [
    ["301", 60, false], ["303", 90, true], ["306", 45, false], ["310", 150, false], ["312", 200, false],
    ["315", 120, false], ["402", 75, false], ["405", 240, true], ["407", 100, false], ["411", 180, false],
    ["412", 130, false], ["416", 300, false], ["420", 210, true], ["418", 160, false]
  ];
  const reservations: Reservation[] = [];
  for (const [num, mins, vip] of arrivals) {
    const sp = s.spaces.find((x) => x.number === num)!;
    const targets = sp.clusterId ? s.spaces.filter((x) => x.clusterId === sp.clusterId) : [sp];
    for (const t of targets) {
      set(t.number, { occ: { value: "arriving", at: ago(10, now), source: "demo" }, flags: { vip, doNotWalk: false, promisedAt: ahead(mins, now), guestCode: `G-${4400 + Number(num.replace(/\D/g, ""))}`, at: ago(10, now) } });
    }
    reservations.push({ id: uid("rv"), spaceId: sp.id, guestCode: `G-${4400 + Number(num.replace(/\D/g, ""))}`, arrivalAt: ahead(mins, now), vip });
  }
  // conditions on the arrival rooms — a real mix
  // `at` = last confirmed (the feed re-confirms every few minutes); `since` = when the value changed
  const fresh = (m: number) => ago(Math.min(m, 6), now);
  const dirty = (num: string, minsAgo: number) => set(num, { cond: { value: "dirty", at: fresh(minsAgo), since: ago(minsAgo, now), source: "demo" }, inspection: null, readyPath: [{ step: "dirty", at: ago(minsAgo, now) }] });
  const cleaning = (num: string, by: string, minsAgo: number) => set(num, { cond: { value: "in_progress", at: fresh(minsAgo), since: ago(minsAgo, now), source: "demo", by }, inspection: null, readyPath: [{ step: "dirty", at: ago(minsAgo + 60, now) }, { step: "clean", at: ago(minsAgo, now), by }] });
  const clean = (num: string, by: string, minsAgo: number) => set(num, { cond: { value: "clean", at: fresh(minsAgo), since: ago(minsAgo, now), source: "demo", by }, inspection: null, readyPath: [{ step: "dirty", at: ago(minsAgo + 90, now) }, { step: "clean", at: ago(minsAgo, now), by }, { step: "inspect", at: "", by: "" }] });
  dirty("301", 40); dirty("310", 30); dirty("312", 25); dirty("416", 15); dirty("411", 35);
  cleaning("306", "Rosa Delgado", 12); cleaning("402", "Luis Moreno", 8); cleaning("418", "Ines Okoro", 5);
  clean("303", "Ana Petrova", 9); clean("412", "Ines Okoro", 14); clean("405", "Luis Moreno", 6);
  // 315 failed inspection twenty minutes ago (scar), back to dirty
  set("315", { cond: { value: "dirty", at: ago(6, now), since: ago(20, now), source: "demo", by: "Dana Whitfield" }, inspection: { result: "fail", at: ago(20, now), by: "Dana Whitfield", notes: "Hair in tub, glasses not replaced" }, readyPath: [{ step: "dirty", at: ago(20, now) }] });
  // 407 out of order — plumbing
  set("407", { engineering: { ooo: true, reason: "Shower valve leaking into 305 ceiling", at: ago(8, now) }, cond: { value: "dirty", at: ago(6, now), since: ago(120, now), source: "demo" }, readyPath: [{ step: "dirty", at: ago(120, now) }, { step: "repair", at: ago(8, now), by: "Marco Bianchi" }] });
  // 311 (stayover) has a STALE condition — nobody has confirmed it in two hours
  set("311", { cond: { value: "inspected", at: ago(140, now), source: "demo", by: "Dana Whitfield" }, occ: { value: "stayover", at: ago(140, now), source: "demo" } });
  // 420 suite: bedroom inspected, parlor still being cleaned → suite verdict follows the parlor
  set("418", { cond: { value: "in_progress", at: ago(5, now), since: ago(5, now), source: "demo", by: "Ines Okoro" }, inspection: null, readyPath: [{ step: "dirty", at: ago(70, now) }, { step: "clean", at: ago(5, now), by: "Ines Okoro" }] });
  set("420", { cond: { value: "inspected", at: ago(10, now), since: ago(30, now), source: "demo", by: "Dana Whitfield" }, inspection: { result: "pass", at: ago(30, now), by: "Dana Whitfield" } });
  s.status = st;
  s.reservations = reservations;

  const wo: WorkOrder[] = [
    { id: "wo-1", spaceId: s.spaces.find((x) => x.number === "407")!.id, text: "Shower valve leaking into 305 ceiling", category: "plumbing", blocking: true, assignedTo: "st-marco", status: "open", createdAt: ago(8, now), createdBy: "Josh" },
    { id: "wo-2", spaceId: s.spaces.find((x) => x.number === "303")!.id, text: "Bedside lamp flickers", category: "electrical", blocking: false, assignedTo: "st-marco", status: "open", createdAt: ago(55, now), createdBy: "Ana Petrova" },
    { id: "wo-3", spaceId: s.spaces.find((x) => x.number === "307")!.id, text: "TV remote missing", category: "tv", blocking: false, status: "done", createdAt: ago(1500, now), createdBy: "Rosa Delgado", closedAt: ago(1400, now) },
    { id: "wo-4", spaceId: s.spaces.find((x) => x.number === "412")!.id, text: "AC not cooling — guest complaint last week", category: "hvac", blocking: false, status: "done", createdAt: ago(60 * 24 * 6, now), createdBy: "Priya Nair", closedAt: ago(60 * 24 * 5, now) },
    { id: "wo-5", spaceId: s.spaces.find((x) => x.number === "412")!.id, text: "AC blowing warm again", category: "hvac", blocking: false, status: "done", createdAt: ago(60 * 24 * 20, now), createdBy: "Luis Moreno", closedAt: ago(60 * 24 * 19, now) },
    { id: "wo-6", spaceId: s.spaces.find((x) => x.number === "315")!.id, text: "Tub drain slow", category: "plumbing", blocking: false, status: "done", createdAt: ago(60 * 24 * 12, now), createdBy: "Dana Whitfield", closedAt: ago(60 * 24 * 11, now) },
    { id: "wo-7", spaceId: s.spaces.find((x) => x.number === "POOL")!.id, text: "Deck chair strap torn", category: "furniture", blocking: false, status: "open", createdAt: ago(60 * 24 * 2, now), createdBy: "Josh" }
  ];
  s.workOrders = wo;
  s.assignments = [
    { id: "as-1", spaceId: s.spaces.find((x) => x.number === "306")!.id, staffId: "st-rosa", task: "departure", at: ago(12, now), by: "Josh" },
    { id: "as-2", spaceId: s.spaces.find((x) => x.number === "402")!.id, staffId: "st-luis", task: "departure", at: ago(8, now), by: "Josh" },
    { id: "as-3", spaceId: s.spaces.find((x) => x.number === "418")!.id, staffId: "st-ines", task: "departure", at: ago(5, now), by: "Josh" },
    { id: "as-4", spaceId: s.spaces.find((x) => x.number === "407")!.id, staffId: "st-marco", task: "repair", at: ago(8, now), by: "Josh" },
    { id: "as-5", spaceId: s.spaces.find((x) => x.number === "301")!.id, staffId: "st-ana", task: "departure", at: ago(3, now), by: "Josh" }
  ];
  const L = (minsAgo: number, by: string, text: string, spaceNum?: string, kind: LedgerEntry["kind"] = "status", failure?: LedgerEntry["failure"]): LedgerEntry =>
    ({ id: uid("lg"), at: ago(minsAgo, now), by, spaceId: spaceNum ? s.spaces.find((x) => x.number === spaceNum)?.id : undefined, kind, text, failure });
  s.ledger = [
    L(420, "Josh", "Shift started — 14 arrivals tonight, 3 VIP (303, 405, Suite 420).", undefined, "system"),
    L(200, "Dana Whitfield", "Floor 3 morning inspections: 8 of 8 passed.", undefined, "inspect_pass"),
    L(120, "Rosa Delgado", "301 stripped, linen down the chute.", "301"),
    L(55, "Ana Petrova", "303 bedside lamp flickers → work order → Engineering (Marco).", "303", "create_work_order", "electrical"),
    L(30, "Dana Whitfield", "420 bedroom inspected — pass.", "420", "inspect_pass"),
    L(20, "Dana Whitfield", "315 inspection FAILED — hair in tub, glasses not replaced. Back to dirty, Ana to redo.", "315", "inspect_fail", "inspection"),
    L(8, "Josh", "407 out of order — shower valve leaking into 305 ceiling → work order → Marco. Pulled from tonight's arrivals.", "407", "create_work_order", "plumbing"),
    L(3, "Josh", "301 assigned to Ana for departure clean.", "301", "assign")
  ];
  // 14-day forecast for a 40-room house
  const fc: ForecastDay[] = [];
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  const pattern = [14, 11, 9, 12, 18, 24, 22, 13, 10, 9, 14, 19, 26, 21];
  for (let i = 0; i < 14; i++) {
    const d = new Date(d0.getTime() + i * 86400000);
    const arrivals = pattern[i];
    const departures = pattern[(i + 13) % 14];
    const stayovers = Math.max(0, Math.min(40 - arrivals, 20 + ((i * 7) % 9)));
    fc.push({ date: d.toISOString().slice(0, 10), arrivals, departures, stayovers });
  }
  s.forecast = fc;
  return s;
}

/** demo data older than this is refreshed on load (a stale demo shows every room Unknown — honest, but not a demo) */
export const DEMO_MAX_AGE_MIN = 120;
