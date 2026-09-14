// OpsMatrix Hotels — the data model and its ONE store.
//
// This is a separate product from the hospital OpsMatrix. It never reads or
// writes opsmatrix_v7 or any opsmatrix_fusion_* key. Everything lives in the
// browser under opsmatrix_hotels_v1 (local concept build — no cloud, no
// login, no integration until Josh decides to hook it up).

export type Pt = { x: number; y: number };

// ── spaces ──────────────────────────────────────────────────────────────────
/** what kind of space a room type describes */
export type SpaceKind = "guest" | "public" | "boh";

export interface RoomType {
  id: string;
  label: string;
  kind: SpaceKind;
  /** guest rooms: minutes for a departure (checkout) clean */
  departureMin: number;
  /** guest rooms: minutes for a stayover (occupied) clean */
  stayoverMin: number;
  /** guest rooms: minutes for evening turndown (luxury) */
  turndownMin: number;
  /** public / back-of-house: 1 minute per this many sq ft per pass */
  sqftPerMin: number | null;
  /** public / back-of-house: passes per day */
  passesPerDay: number;
  builtIn?: boolean;
}

export interface Space {
  id: string;
  /** the room number guests know ("412"); public areas use a short code ("LOBBY") */
  number: string;
  name: string;
  floor: string;
  typeId: string;
  sqft: number;
  /** a suite is a CLUSTER: several spaces, one guest-facing verdict */
  clusterId?: string;
  /** polygon on the plan, plan pixels */
  pts?: Pt[];
  planId?: string;
  notes?: string;
  updatedAt: string;
}

export interface Cluster {
  id: string;
  /** the number the guest sees ("Suite 420") */
  number: string;
  name: string;
  floor: string;
  memberIds: string[];
}

export interface Plan {
  id: string;
  floor: string;
  /** SVG data URL, drawn in the OpsMatrix house style */
  img: string;
  w: number;
  h: number;
  /** plan pixels per foot (null = unscaled) */
  ratio: number | null;
}

// ── status layers (stacked; every layer carries WHEN and FROM WHERE) ────────
export type Occupancy = "vacant" | "occupied" | "arriving" | "departing" | "stayover";
/** the ONE official room condition. If the PMS says dirty and we say clean, we are wrong. */
export type Condition = "dirty" | "in_progress" | "clean" | "inspected" | "pickup";
export type SignalSource = "manual" | "pms" | "capture" | "demo";

export interface Signal<T> {
  value: T;
  /** ISO time the signal was last CONFIRMED (freshness runs on this) */
  at: string;
  /** ISO time the VALUE last changed (absent = same as `at`) */
  since?: string;
  source: SignalSource;
  by?: string;
}

export interface WorkOrder {
  id: string;
  spaceId: string;
  text: string;
  category: "hvac" | "plumbing" | "electrical" | "furniture" | "minibar" | "tv" | "housekeeping" | "other";
  /** blocks the room from being sold until closed */
  blocking: boolean;
  assignedTo?: string;
  status: "open" | "done";
  createdAt: string;
  createdBy: string;
  closedAt?: string;
}

export interface Inspection {
  result: "pass" | "fail";
  at: string;
  by: string;
  notes?: string;
  photo?: string;
}

export interface GuestFlags {
  vip: boolean;
  doNotWalk: boolean;
  /** ISO time the room was promised to an arriving guest */
  promisedAt?: string;
  /** the guest, as a CODE — privacy mode for wall screens never shows names */
  guestCode?: string;
  at: string;
}

export interface ReadyStep {
  step: "dirty" | "repair" | "clean" | "inspect" | "stage" | "ready";
  at: string;
  by?: string;
}

export interface RoomStatus {
  spaceId: string;
  occupancy: Signal<Occupancy> | null;
  condition: Signal<Condition> | null;
  /** engineering layer: out-of-order flag, confirmed at a time */
  engineering: { ooo: boolean; reason?: string; at: string } | null;
  flags: GuestFlags;
  inspection: Inspection | null;
  readyPath: ReadyStep[];
  /** a GM override of a hold — logged, never silent, never from the front desk */
  override?: { level: "green"; by: string; reason: string; at: string } | null;
}

// ── people, queues, ledger ──────────────────────────────────────────────────
export type StaffRole = "attendant" | "inspector" | "engineering" | "manager" | "frontdesk" | "gm";

export interface Staff {
  id: string;
  name: string;
  role: StaffRole;
  /** the floors this person normally works ("4") */
  floors?: string[];
}

export type TaskKind = "departure" | "stayover" | "turndown" | "deep" | "inspect" | "repair" | "public";

export interface Assignment {
  id: string;
  spaceId: string;
  staffId: string;
  task: TaskKind;
  at: string;
  by: string;
  done?: boolean;
}

export interface Reservation {
  id: string;
  spaceId: string;
  guestCode: string;
  arrivalAt: string;
  vip: boolean;
}

export type IntentType =
  | "set_condition" | "create_work_order" | "assign" | "inspect_pass" | "inspect_fail"
  | "note" | "flag" | "report_line";

/** one line in the day's report ledger — every capture lands here */
export interface LedgerEntry {
  id: string;
  at: string;
  by: string;
  spaceId?: string;
  kind: IntentType | "status" | "override" | "import" | "system";
  /** plain English, exactly what the handover prints */
  text: string;
  /** failure category, when the entry is one (feeds the scar map) */
  failure?: WorkOrder["category"] | "inspection";
}

export interface ForecastDay {
  date: string;          // YYYY-MM-DD
  arrivals: number;
  departures: number;
  stayovers: number;
}

export interface Settings {
  hotelName: string;
  /** privacy mode for wall screens: room codes only, never guest names */
  privacyMode: boolean;
  /** freshness threshold per signal, minutes — a stale required signal never produces green */
  freshnessMin: { condition: number; occupancy: number; engineering: number };
  /** which adapter is feeding the status layers */
  adapter: { kind: "manual" | "mews" | "cloudbeds"; connected: boolean };
  /** tenant setting: apply capture intents without the readback when confidence ≥ this */
  autoApplyAbove: number | null;
  hourlyRate: number;
  productiveMinutes: number;
  shiftsPerWeekPerFte: number;
  /** minutes added every time an attendant changes floors */
  travelPerFloorChangeMin: number;
  /** minutes between rooms on the same floor */
  travelBetweenRoomsMin: number;
  /** luxury property: turndown scheduled nightly */
  turndown: boolean;
  /** the current user, for the concept build (who is talking / applying) */
  me: string;
  demoStamp?: string;
  updatedAt?: string;
}

export interface HotelState {
  version: 1;
  settings: Settings;
  roomTypes: RoomType[];
  spaces: Space[];
  clusters: Cluster[];
  plans: Plan[];
  status: Record<string, RoomStatus>;
  workOrders: WorkOrder[];
  assignments: Assignment[];
  staff: Staff[];
  reservations: Reservation[];
  ledger: LedgerEntry[];
  forecast: ForecastDay[];
}

export const HOTEL_KEY = "opsmatrix_hotels_v1";
export const HOTEL_API_KEY = "opsmatrix_hotels_api_key";

export function defaultSettings(): Settings {
  return {
    hotelName: "The Meridian",
    privacyMode: true,
    freshnessMin: { condition: 15, occupancy: 15, engineering: 15 },
    adapter: { kind: "manual", connected: true },
    autoApplyAbove: null,
    hourlyRate: 18,
    productiveMinutes: 420,
    shiftsPerWeekPerFte: 5,
    travelPerFloorChangeMin: 4,
    travelBetweenRoomsMin: 1,
    turndown: false,
    me: "Manager"
  };
}

export function emptyState(): HotelState {
  return {
    version: 1,
    settings: defaultSettings(),
    roomTypes: [],
    spaces: [],
    clusters: [],
    plans: [],
    status: {},
    workOrders: [],
    assignments: [],
    staff: [],
    reservations: [],
    ledger: [],
    forecast: []
  };
}

export function loadState(): HotelState | null {
  try {
    const raw = localStorage.getItem(HOTEL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1) return null;
    const base = emptyState();
    return {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...(parsed.settings ?? {}),
        freshnessMin: { ...base.settings.freshnessMin, ...(parsed.settings?.freshnessMin ?? {}) },
        adapter: { ...base.settings.adapter, ...(parsed.settings?.adapter ?? {}) } }
    };
  } catch {
    return null;
  }
}

export function saveState(state: HotelState) {
  try {
    localStorage.setItem(HOTEL_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("OpsMatrix Hotels: could not save", e);
  }
}

// ── small helpers every screen uses ─────────────────────────────────────────
let uidCounter = 0;
export function uid(prefix = "h"): string {
  uidCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${uidCounter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function nowIso(): string { return new Date().toISOString(); }

export function emptyStatus(spaceId: string): RoomStatus {
  return {
    spaceId,
    occupancy: null,
    condition: null,
    engineering: null,
    flags: { vip: false, doNotWalk: false, at: "" },
    inspection: null,
    readyPath: [],
    override: null
  };
}

export function statusFor(state: HotelState, spaceId: string): RoomStatus {
  return state.status[spaceId] ?? emptyStatus(spaceId);
}

export function typeOf(state: HotelState, sp: Space): RoomType | undefined {
  return state.roomTypes.find((t) => t.id === sp.typeId);
}

export function spaceByNumber(state: HotelState, number: string): Space | undefined {
  const n = String(number).trim().toLowerCase();
  return state.spaces.find((s) => s.number.toLowerCase() === n)
    ?? state.spaces.find((s) => s.name.toLowerCase() === n);
}

export function clusterOf(state: HotelState, sp: Space): Cluster | undefined {
  return sp.clusterId ? state.clusters.find((c) => c.id === sp.clusterId) : undefined;
}

/** the guest-facing label: suite number for cluster members, room number otherwise */
export function displayNumber(state: HotelState, sp: Space): string {
  const c = clusterOf(state, sp);
  return c ? `${c.number} · ${sp.name}` : sp.number;
}

export function floorsOf(state: HotelState): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of state.spaces) if (!seen.has(s.floor)) { seen.add(s.floor); out.push(s.floor); }
  return out.sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
}

export function staffByName(state: HotelState, name: string): Staff | undefined {
  const n = name.trim().toLowerCase();
  return state.staff.find((s) => s.name.toLowerCase() === n)
    ?? state.staff.find((s) => s.name.toLowerCase().split(/\s+/)[0] === n);
}

/** who is holding this room right now (open assignment, not done) */
export function assigneeOf(state: HotelState, spaceId: string): Staff | undefined {
  const a = [...state.assignments].reverse().find((x) => x.spaceId === spaceId && !x.done);
  return a ? state.staff.find((s) => s.id === a.staffId) : undefined;
}

export function openWorkOrders(state: HotelState, spaceId: string): WorkOrder[] {
  return state.workOrders.filter((w) => w.spaceId === spaceId && w.status === "open");
}

export function fmtTime(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

export function fmtAgo(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "never";
  const min = Math.round((now - t) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hr${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export const CONDITION_LABEL: Record<Condition, string> = {
  dirty: "Dirty", in_progress: "Being cleaned", clean: "Clean", inspected: "Inspected", pickup: "Pickup"
};
export const OCCUPANCY_LABEL: Record<Occupancy, string> = {
  vacant: "Vacant", occupied: "Occupied", arriving: "Arriving", departing: "Departing", stayover: "Stayover"
};
