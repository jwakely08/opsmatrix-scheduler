// Core domain types.
// NO PHI BY DESIGN: this schema stores spaces, rates and staff work assignments only —
// never patient names, room-occupant data, or any medical information.

export interface Building { id: string; name: string; }

export interface FloorGeometry {
  walls: { points: [number, number][]; closed: boolean }[];
  labels: { text: string; x: number; y: number }[];
  openings: { name: string; x: number; y: number }[];
  units: string;
}

export interface Floor {
  id: string;
  buildingId: string;
  name: string;
  geometry: FloorGeometry | null;
  /** includes wall footprint — REFERENCE ONLY, never used in workload math */
  grossSqFt: number | null;
  /** interior floor only — the working number for all workload math */
  cleanableSqFt: number | null;
  importedAt: string;
}

export interface Room {
  id: string;
  floorId: string;
  department: string;
  name: string;
  roomType: string;
  floorType: string;
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

export interface Shift { id: string; name: string; start: string; end: string; }

export interface Employee {
  id: string;
  name: string;
  role: string;
  shiftId: string;
  pattern: boolean[]; // Sun..Sat
}

export interface BaseRate { id: string; roomType: string; floorType: string; minutesPer1000: number; }
export interface Modifier { id: string; name: string; kind: "multiplier" | "per1000"; value: number; }
export interface Frequency { id: string; label: string; perWeek: number; }
export interface RoomTypeTemplate {
  id: string; name: string; floorType: string; fixtures: number; frequency: string; tasks: string[];
}

export interface Rates {
  baseRates: BaseRate[];
  fixtureMinutes: number;
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
  colorBy: string;
}

export type Scope =
  | { type: "building"; buildingId: string }
  | { type: "floor"; floorId: string }
  | { type: "dept"; floorId: string; dept: string }
  | { type: "room"; roomId: string };

export interface AppState {
  version: number;
  buildings: Building[];
  floors: Floor[];
  rooms: Room[];
  jobs: NonSpaceJob[];
  shifts: Shift[];
  employees: Employee[];
  rates: Rates;
  roomTypes: RoomTypeTemplate[];
  floorTypes: string[];
  frequencies: Frequency[];
  ui: UIState;
}

export function uid(prefix: string): string {
  return prefix + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}
