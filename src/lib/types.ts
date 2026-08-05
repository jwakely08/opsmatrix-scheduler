// Core domain types (v2 — layered rates model).
// NO PHI BY DESIGN: this schema stores spaces, rates and staff work assignments only —
// never patient names, room-occupant data, or any medical information.

export interface Building { id: string; name: string; }

export interface FloorGeometry {
  walls: { points: [number, number][]; closed: boolean }[];
  labels: { text: string; x: number; y: number }[];
  openings: { name: string; x: number; y: number }[];
  units: string;
}

/** A room's map shape — derived by the geometry pipeline or drawn by hand. */
export interface StoredShape {
  outer: [number, number][];
  holes: [number, number][][];
  source: "derived" | "traced" | "edited";
  areaSqFt: number;
}

/** Undo record for a room merge — everything needed to split it back apart. */
export interface MergeRecord {
  id: string;
  intoRoomId: string;
  prevShape: StoredShape;
  prevSqFt: number;
  /** full copy of the absorbed room, when a real room was merged in */
  absorbedRoom: Room | null;
  absorbedShape: StoredShape;
  wasUnassigned: boolean;
}

export interface Floor {
  id: string;
  buildingId: string;
  name: string;
  geometry: FloorGeometry | null;
  /** roomId → wall-tight shape; persisted so manual edits are never lost */
  shapes?: Record<string, StoredShape>;
  /** enclosed spaces no room claimed — visible on the map, never lost */
  unassigned?: StoredShape[];
  /** merge history (undoable, persisted) */
  merges?: MergeRecord[];
  /** true when the outer boundary was closed approximately (open scan side) */
  approxBoundary?: boolean;
  /** includes wall footprint — REFERENCE ONLY, never used in workload math */
  grossSqFt: number | null;
  /** interior floor only — the working number for all workload math */
  cleanableSqFt: number | null;
  importedAt: string;
}

/** Exactly three floor finishes, in plain language. */
export type FloorFinish = "hard" | "other" | "carpet";

export const FLOOR_FINISH_LABELS: Record<FloorFinish, string> = {
  hard: "Finished hard floor (tile, VCT, vinyl, sealed concrete)",
  other: "Unfinished / other",
  carpet: "Carpet"
};

export const FLOOR_FINISH_SHORT: Record<FloorFinish, string> = {
  hard: "Hard floor",
  other: "Unfinished/other",
  carpet: "Carpet"
};

/** An additive/multiplying adjustment a room type carries, in plain English. */
export interface Qualifier {
  id: string;
  label: string; // e.g. "Extra time per restroom fixture"
  kind: "per1000" | "perFixture" | "flatPerVisit" | "multiplier";
  value: number;
}

export interface Room {
  id: string;
  floorId: string;
  department: string;
  name: string;
  roomType: string;
  floorFinish: FloorFinish;
  fixtures: number;
  /** interior area — THE ONLY number used in workload math */
  cleanableSqFt: number;
  ceilingHeight: string;
  perimeter: string;
  doorAreaSqFt: number;
  windowAreaSqFt: number;
  tasks: string[];
  frequency: string;
  shiftId: string | null;
  employeeId: string | null;
  mapX: number | null;
  mapY: number | null;
  source: string;
}

export type JobType = "discharge" | "porter" | "trashlinen" | "laundry" | "floortech" | "custom";

export interface NonSpaceJob {
  id: string;
  name: string;
  type: JobType;
  mode: "block" | "unit";
  minutes: number;
  unitsPerDay: number;
  minutesPerUnit: number;
  shiftId: string | null;
  employeeId: string | null;
}

export interface Shift { id: string; name: string; start: string; end: string; color: string; }

export interface Employee {
  id: string;
  name: string;
  role: string;
  shiftId: string;
  pattern: boolean[]; // Sun..Sat
}

export interface Modifier { id: string; name: string; kind: "multiplier" | "per1000"; value: number; }
export interface Frequency { id: string; label: string; perWeek: number; }

export interface RoomTypeTemplate {
  id: string;
  name: string;
  floorFinish: FloorFinish;
  fixtures: number;
  frequency: string;
  tasks: string[];
  qualifiers: Qualifier[];
}

/** A department with its map color. Keyed by name (rooms store the name). */
export interface Department { name: string; color: string; }

export interface Rates {
  /** minutes per 1,000 cleanable sq ft for a plain empty room */
  baseMinutesPer1000: number;
  /** extra minutes per 1,000 sq ft by floor finish */
  floorFinishAdjust: Record<FloorFinish, number>;
  /** discharge/terminal multipliers and project rates (fine-tune) */
  modifiers: Modifier[];
  productiveMinutes: number;
}

export interface UIState {
  view: string;
  scope: Scope | null;
  expanded: Record<string, boolean>;
  boardMode: "employee" | "area";
  mapFloorId: string | null;
  filters: Record<string, string>;
  mapColorBy: "schedule" | "department";
}

export type Scope =
  | { type: "building"; buildingId: string }
  | { type: "floor"; floorId: string }
  | { type: "dept"; floorId: string; dept: string }
  | { type: "room"; roomId: string };

export interface AppState {
  version: number; // 2
  /** set only on demo-seeded data; lets a newer build refresh a stale demo */
  demoStamp?: string;
  buildings: Building[];
  floors: Floor[];
  rooms: Room[];
  jobs: NonSpaceJob[];
  shifts: Shift[];
  employees: Employee[];
  rates: Rates;
  roomTypes: RoomTypeTemplate[];
  departments: Department[];
  frequencies: Frequency[];
  ui: UIState;
}

export function uid(prefix: string): string {
  return prefix + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}
