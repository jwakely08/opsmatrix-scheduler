// Cleaning rules engine for the Map Scheduler ("how long does a room take?").
// Every number is visible and editable in the Rules panel; starting values
// follow ISSA-style healthcare production-rate conventions (editable
// estimates, not gospel). Persisted under its own key; classic app data is
// kept in sync by writing each space's estimatedCleaningMinutes.

export interface TaskRule {
  id: string;
  label: string;
  /** 1 minute per this many sq ft (null → flat minutes instead) */
  sqftPerMin: number | null;
  flatMin: number;
  /** room types that get this task automatically */
  autoFor: string[];
  /** shown in the picker for manual adds */
  addable: boolean;
  builtIn?: boolean;
}

export interface RoomTypeRule {
  id: string;
  label: string;
  /** flat qualifier minutes on top of general cleaning */
  qualifierMin: number;
  /** how often this type is cleaned, e.g. "7x / week" — editable per account */
  frequency: string;
  builtIn?: boolean;
}

/** reusable non-space work definitions (discharges, sanitation routes, porters) */
export interface NonSpaceDef {
  id: string;
  label: string;
  defaultHours: number;
  builtIn?: boolean;
}

/**
 * Breaks and lunches for the account. Set once in Admin Settings; every
 * schedule picks these up automatically and can override the time. The clock
 * on a printed schedule stops for these, so the times workers read are real.
 */
export interface BreakRule {
  id: string;
  label: string;
  minutes: number;
  /** when it starts, e.g. "12:30 PM" — a schedule may override it */
  start: string;
  builtIn?: boolean;
}

export interface Rules {
  version: number;
  general: {
    hardSqftPerMin: number;    // includes damp mop on hard floor
    carpetSqftPerMin: number;  // includes vacuuming pass
    minMinutes: number;
  };
  tasks: TaskRule[];
  roomTypes: RoomTypeRule[];
  nonSpaceDefs: NonSpaceDef[];
  breaks: BreakRule[];
}

export const FREQUENCIES = [
  "7x / week", "6x / week", "5x / week", "3x / week", "2x / week", "1x / week", "Every other week", "Monthly"
];

export const RULES_KEY = "opsmatrix_fusion_rules";

export function defaultRules(): Rules {
  return {
    version: 1,
    general: { hardSqftPerMin: 33, carpetSqftPerMin: 40, minMinutes: 3 },
    tasks: [
      { id: "auto-scrub", label: "Auto Scrub", sqftPerMin: 200, flatMin: 0, autoFor: ["corridor", "hallway"], addable: true, builtIn: true },
      { id: "dust-mop", label: "Dust Mop", sqftPerMin: 150, flatMin: 0, autoFor: ["corridor", "hallway"], addable: true, builtIn: true },
      { id: "burnish", label: "Burnishing", sqftPerMin: 100, flatMin: 0, autoFor: [], addable: true, builtIn: true },
      { id: "high-dusting", label: "High Dusting", sqftPerMin: 120, flatMin: 0, autoFor: [], addable: true, builtIn: true },
      { id: "trash-pull", label: "Trash Pull", sqftPerMin: null, flatMin: 2, autoFor: [], addable: true, builtIn: true }
    ],
    roomTypes: [
      { id: "office", label: "Office", qualifierMin: 0, frequency: "5x / week", builtIn: true },
      { id: "exam-room", label: "Exam Room", qualifierMin: 4, frequency: "7x / week", builtIn: true },
      { id: "emergency-room", label: "Emergency Room", qualifierMin: 10, frequency: "7x / week", builtIn: true },
      { id: "patient-room", label: "Patient Room", qualifierMin: 6, frequency: "7x / week", builtIn: true },
      { id: "lounge", label: "Lounge", qualifierMin: 2, frequency: "7x / week", builtIn: true },
      { id: "lobby", label: "Lobby", qualifierMin: 2, frequency: "7x / week", builtIn: true },
      { id: "waiting-room", label: "Waiting Room", qualifierMin: 2, frequency: "7x / week", builtIn: true },
      { id: "procedure-room", label: "Procedure Room", qualifierMin: 8, frequency: "7x / week", builtIn: true },
      { id: "restroom", label: "Restroom", qualifierMin: 8, frequency: "7x / week", builtIn: true },
      { id: "operating-room", label: "Operating Room", qualifierMin: 25, frequency: "7x / week", builtIn: true },
      { id: "corridor", label: "Corridor", qualifierMin: 0, frequency: "7x / week", builtIn: true },
      { id: "hallway", label: "Hallway", qualifierMin: 0, frequency: "7x / week", builtIn: true }
    ],
    nonSpaceDefs: [
      { id: "discharge", label: "Discharges", defaultHours: 2, builtIn: true },
      { id: "sanitation-route", label: "Sanitation Route", defaultHours: 3, builtIn: true },
      { id: "day-porter", label: "Day Porter", defaultHours: 8, builtIn: true }
    ],
    breaks: [
      { id: "break-am", label: "Morning Break", minutes: 15, start: "9:30 AM", builtIn: true },
      { id: "lunch", label: "Lunch", minutes: 30, start: "12:30 PM", builtIn: true },
      { id: "break-pm", label: "Afternoon Break", minutes: 15, start: "2:00 PM", builtIn: true }
    ]
  };
}

export function loadRules(): Rules {
  try {
    const raw = localStorage.getItem(RULES_KEY);
    if (!raw) return defaultRules();
    const parsed = JSON.parse(raw);
    const def = defaultRules();
    // merge: keep user edits, guarantee every built-in exists
    const rules: Rules = {
      version: 1,
      general: { ...def.general, ...(parsed.general ?? {}) },
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : def.tasks,
      roomTypes: Array.isArray(parsed.roomTypes) ? parsed.roomTypes : def.roomTypes,
      nonSpaceDefs: def.nonSpaceDefs,
      // an account that predates break setup keeps the standard ones
      breaks: Array.isArray(parsed.breaks) ? parsed.breaks : def.breaks
    };
    rules.nonSpaceDefs = Array.isArray(parsed.nonSpaceDefs) ? parsed.nonSpaceDefs : def.nonSpaceDefs;
    for (const t of def.tasks) {
      if (!rules.tasks.some((x: TaskRule) => x.id === t.id)) rules.tasks.push(t);
    }
    for (const rt of def.roomTypes) {
      if (!rules.roomTypes.some((x: RoomTypeRule) => x.id === rt.id)) rules.roomTypes.push(rt);
    }
    for (const rt of rules.roomTypes) {
      if (!rt.frequency) rt.frequency = def.roomTypes.find((x) => x.id === rt.id)?.frequency ?? "7x / week";
    }
    for (const ns of def.nonSpaceDefs) {
      if (!rules.nonSpaceDefs.some((x: NonSpaceDef) => x.id === ns.id)) rules.nonSpaceDefs.push(ns);
    }
    return rules;
  } catch {
    return defaultRules();
  }
}

export function saveRules(rules: Rules) {
  localStorage.setItem(RULES_KEY, JSON.stringify(rules));
}

export function typeIdFromLabel(rules: Rules, label: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, "");
  const hit = rules.roomTypes.find((rt) => norm(rt.label) === norm(label) || norm(rt.id) === norm(label));
  if (hit) return hit.id;
  // legacy classic labels → our ids
  const m: Record<string, string> = {
    orroom: "operating-room", nursesstation: "office", utilityroom: "office",
    breakroom: "lounge", conferenceroom: "office", storage: "office", other: "office",
    erroom: "emergency-room"
  };
  return m[norm(label)] ?? "office";
}

export function isCarpet(floorType: string | undefined): boolean {
  return /carpet/i.test(floorType ?? "");
}

export interface MinuteLine { label: string; minutes: number; }

export interface SpaceLike {
  squareFeet?: number;
  roomType?: string;
  floorType?: string;
  /** tasks this SPACE requires (general clean is always implicit) */
  spaceTasks?: string[];
  /** legacy field name, migrated on read */
  fusionTasks?: string[];
}

export function requiredTasks(rules: Rules, space: SpaceLike): string[] {
  const explicit = space.spaceTasks ?? space.fusionTasks;
  if (Array.isArray(explicit)) return explicit;
  return autoTasksFor(rules, typeIdFromLabel(rules, space.roomType ?? ""));
}

export interface MinuteOptions {
  /** compute only these extra tasks (default: the space's required tasks) */
  tasks?: string[];
  /** include the general-clean base + room-type qualifier (default true) */
  includeBase?: boolean;
}

/**
 * The formula for one space, as visible line items.
 * With options it prices a SUBSET — e.g. what one schedule covers in a room.
 */
export function computeMinutes(
  rules: Rules,
  space: SpaceLike,
  opts?: MinuteOptions
): { lines: MinuteLine[]; total: number } {
  const sqft = Number(space.squareFeet) || 0;
  const carpet = isCarpet(space.floorType);
  const includeBase = opts?.includeBase !== false;
  const lines: MinuteLine[] = [];

  if (includeBase) {
    const per = carpet ? rules.general.carpetSqftPerMin : rules.general.hardSqftPerMin;
    lines.push({
      label: `General cleaning — 1 min per ${per} sq ft (${carpet ? "carpet, vacuuming included" : "hard floor, mopping included"})`,
      minutes: per > 0 ? sqft / per : 0
    });
    const rt = rules.roomTypes.find((x) => x.id === typeIdFromLabel(rules, space.roomType ?? ""));
    if (rt && rt.qualifierMin) {
      lines.push({ label: `${rt.label} qualifier`, minutes: rt.qualifierMin });
    }
  }
  const taskIds = opts?.tasks ?? requiredTasks(rules, space);
  for (const tid of taskIds) {
    const t = rules.tasks.find((x) => x.id === tid);
    if (!t) continue;
    const m = t.sqftPerMin ? sqft / t.sqftPerMin : t.flatMin;
    lines.push({ label: t.label + (t.sqftPerMin ? ` — 1 min per ${t.sqftPerMin} sq ft` : ` — ${t.flatMin} min`), minutes: m });
  }
  const raw = lines.reduce((s, l) => s + l.minutes, 0);
  const total = includeBase
    ? Math.max(rules.general.minMinutes, Math.round(raw))
    : Math.round(raw);
  return { lines, total };
}

export function autoTasksFor(rules: Rules, typeId: string): string[] {
  return rules.tasks.filter((t) => t.autoFor.includes(typeId)).map((t) => t.id);
}

// ── our-vocab ↔ classic-vocab bridges (schedules store classic-friendly ids) ──
const TO_CLASSIC: Record<string, string> = {
  "auto-scrub": "floor-scrub", "dust-mop": "dust-mop", "high-dusting": "high-dusting",
  "burnish": "burnish", "trash-pull": "trash-pull"
};
const FROM_CLASSIC: Record<string, string> = {
  "floor-scrub": "auto-scrub", "dust-mop": "dust-mop", "high-dusting": "high-dusting",
  "burnish": "burnish", "trash-pull": "trash-pull"
};

/**
 * roomTasks entry for a schedule covering `ourTaskIds` in a room.
 * "general" in the list marks primary coverage (base clean included).
 */
export function toClassicRoomTasks(space: SpaceLike, ourTaskIds: string[], primary: boolean): string[] {
  const out: string[] = [];
  if (primary) {
    out.push("general-cleaning", isCarpet(space.floorType) ? "vacuuming" : "wet-mop");
  }
  for (const t of ourTaskIds) {
    const c = TO_CLASSIC[t] ?? t;
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

export function fromClassicRoomTasks(ids: string[] | undefined): { primary: boolean; tasks: string[] } {
  const list = ids ?? [];
  const primary = list.includes("general-cleaning");
  const tasks: string[] = [];
  for (const id of list) {
    if (["general-cleaning", "wet-mop", "vacuuming"].includes(id)) continue;
    const ours = FROM_CLASSIC[id] ?? id;
    if (!tasks.includes(ours)) tasks.push(ours);
  }
  return { primary, tasks };
}
