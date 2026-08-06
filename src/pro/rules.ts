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
}

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
      { id: "office", label: "Office", qualifierMin: 0, builtIn: true },
      { id: "exam-room", label: "Exam Room", qualifierMin: 4, builtIn: true },
      { id: "emergency-room", label: "Emergency Room", qualifierMin: 10, builtIn: true },
      { id: "patient-room", label: "Patient Room", qualifierMin: 6, builtIn: true },
      { id: "lounge", label: "Lounge", qualifierMin: 2, builtIn: true },
      { id: "lobby", label: "Lobby", qualifierMin: 2, builtIn: true },
      { id: "waiting-room", label: "Waiting Room", qualifierMin: 2, builtIn: true },
      { id: "procedure-room", label: "Procedure Room", qualifierMin: 8, builtIn: true },
      { id: "restroom", label: "Restroom", qualifierMin: 8, builtIn: true },
      { id: "operating-room", label: "Operating Room", qualifierMin: 25, builtIn: true },
      { id: "corridor", label: "Corridor", qualifierMin: 0, builtIn: true },
      { id: "hallway", label: "Hallway", qualifierMin: 0, builtIn: true }
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
      roomTypes: Array.isArray(parsed.roomTypes) ? parsed.roomTypes : def.roomTypes
    };
    for (const t of def.tasks) {
      if (!rules.tasks.some((x: TaskRule) => x.id === t.id)) rules.tasks.push(t);
    }
    for (const rt of def.roomTypes) {
      if (!rules.roomTypes.some((x: RoomTypeRule) => x.id === rt.id)) rules.roomTypes.push(rt);
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

/** The whole formula for one space, as visible line items. */
export function computeMinutes(
  rules: Rules,
  space: { squareFeet?: number; roomType?: string; floorType?: string; fusionTasks?: string[] }
): { lines: MinuteLine[]; total: number } {
  const sqft = Number(space.squareFeet) || 0;
  const carpet = isCarpet(space.floorType);
  const per = carpet ? rules.general.carpetSqftPerMin : rules.general.hardSqftPerMin;
  const lines: MinuteLine[] = [];
  const base = per > 0 ? sqft / per : 0;
  lines.push({
    label: `General cleaning — 1 min per ${per} sq ft (${carpet ? "carpet, vacuuming included" : "hard floor, mopping included"})`,
    minutes: base
  });
  const typeId = typeIdFromLabel(rules, space.roomType ?? "");
  const rt = rules.roomTypes.find((x) => x.id === typeId);
  if (rt && rt.qualifierMin) {
    lines.push({ label: `${rt.label} qualifier`, minutes: rt.qualifierMin });
  }
  const taskIds = space.fusionTasks ?? autoTasksFor(rules, typeId);
  for (const tid of taskIds) {
    const t = rules.tasks.find((x) => x.id === tid);
    if (!t) continue;
    const m = t.sqftPerMin ? sqft / t.sqftPerMin : t.flatMin;
    lines.push({ label: t.label + (t.sqftPerMin ? ` — 1 min per ${t.sqftPerMin} sq ft` : ` — ${t.flatMin} min`), minutes: m });
  }
  const total = Math.max(rules.general.minMinutes, Math.round(lines.reduce((s, l) => s + l.minutes, 0)));
  return { lines, total };
}

export function autoTasksFor(rules: Rules, typeId: string): string[] {
  return rules.tasks.filter((t) => t.autoFor.includes(typeId)).map((t) => t.id);
}

/** classic scope-task ids for a space's fusion tasks (keeps Classic screens sane) */
export function classicTaskIds(space: { floorType?: string; fusionTasks?: string[] }): string[] {
  const out = ["general-cleaning", "trash-pull", isCarpet(space.floorType) ? "vacuuming" : "wet-mop"];
  const map: Record<string, string> = {
    "auto-scrub": "floor-scrub", "dust-mop": "dust-mop", "high-dusting": "high-dusting",
    "burnish": "floor-scrub", "trash-pull": "trash-pull"
  };
  for (const t of space.fusionTasks ?? []) {
    const c = map[t];
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}
