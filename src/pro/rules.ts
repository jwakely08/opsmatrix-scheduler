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
  /** floor-tech work: scheduled in Max Floor Care, not in Max Schedules */
  floorCare?: boolean;
  builtIn?: boolean;
}

export interface RoomTypeRule {
  id: string;
  label: string;
  /** flat qualifier minutes on top of general cleaning (optional add-on) */
  qualifierMin: number;
  /**
   * The ISSA space category this type is priced as (an ISSA_CATEGORIES id).
   * Names the source on the breakdown line while sqftPerHour still equals
   * that category's published rate.
   */
  issaCategory?: string;
  /**
   * This type's own production rate, sq ft per HOUR, for the whole general
   * clean (floor included). Set → it replaces the floor-type formula;
   * absent → the type falls back to that formula (rules saved before
   * 2026-10-12 keep pricing exactly as they did).
   */
  sqftPerHour?: number;
  /**
   * A hospital's own per-room standard: this many minutes per clean no
   * matter the size (e.g. "an OR turnover is 45 min"). Wins over any rate.
   */
  flatMinutes?: number;
  /** how often this type is cleaned, e.g. "7x / week" — editable per account */
  frequency: string;
  /**
   * Whether rooms of this type normally count toward EVS cleaning workload.
   * A mechanical room is real hospital square footage — it stays in Max Space
   * and in Total Facility Area — it just doesn't drive standard EVS staffing.
   * Absent = cleanable (every pre-existing type keeps its old behavior).
   */
  cleanability?: "cleanable" | "non-cleanable";
  builtIn?: boolean;
}

/**
 * Reusable non-space work definitions (discharges, porters). Reworked
 * 2026-08-31 (Josh): a non-space task is priced PER OCCURRENCE — minutes for
 * one discharge — plus its attached qualifiers (travel time between
 * discharges). Schedules pick a def and a COUNT in Max Schedules; adding to
 * a schedule from Scope is gone.
 */
export interface NonSpaceDef {
  id: string;
  label: string;
  /** legacy flat-block sizing (pre-2026-08-31 schedules still carry hours) */
  defaultHours: number;
  /** minutes ONE occurrence takes (one discharge, one run) */
  minutes: number;
  /** qualifiers added per occurrence (e.g. travel time) */
  qualifierIds: string[];
  builtIn?: boolean;
}

/**
 * A per-occurrence add-on for non-space tasks. Travel time is built in: no
 * published industry standard breaks it out separately (terminal-clean
 * standards fold it into the 35–45 min figure), so the 5-minute default is
 * an honest editable starting point, not gospel.
 */
export interface NonSpaceQualifier {
  id: string;
  label: string;
  minutes: number;
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

/**
 * Named break plans for the Client Schedule Export (Josh, 2026-09-03):
 * "Break Schedule A, B, C…", each carrying its own 15-minute break(s) and
 * lunch. Managed in Scope's Breaks section; a schedule in Max Schedules
 * PICKS one by id, and the export writes its times into the client's
 * template. Times are 24h "HH:MM".
 */
export interface BreakWindow {
  kind: "break" | "lunch";
  start: string;
  minutes: number;
}

export interface BreakSchedule {
  id: string;
  label: string;
  windows: BreakWindow[];
}

export interface Rules {
  version: number;
  general: {
    hardSqftPerMin: number;    // includes damp mop on hard floor (unless mopIncluded is off)
    carpetSqftPerMin: number;  // includes vacuuming pass (unless vacuumIncluded is off)
    /** does the hard-floor rate include mopping? off = schedule Mopping as its own task */
    mopIncluded: boolean;
    /** does the carpet rate include vacuuming? off = schedule Vacuuming as its own task */
    vacuumIncluded: boolean;
    /**
     * The nuclear option: the General Clean formula itself was deleted in
     * Scope. Rooms then price ONLY their explicit tasks + type qualifier —
     * the warning in Scope says exactly that until it's restored or a
     * replacement per-sq-ft task exists.
     */
    formulaOff?: boolean;
    minMinutes: number;
    /**
     * Productive cleaning minutes in one shift, breaks and setup excluded.
     * Same idea (and same 420-minute starting value) as the original
     * OpsMatrix staffing engine: FTE = workload minutes ÷ productive minutes.
     */
    productiveMinutes: number;
    /** shifts one full-time employee works per week */
    shiftsPerWeekPerFte: number;
  };
  tasks: TaskRule[];
  roomTypes: RoomTypeRule[];
  nonSpaceDefs: NonSpaceDef[];
  nonSpaceQualifiers: NonSpaceQualifier[];
  breaks: BreakRule[];
  breakSchedules: BreakSchedule[];
}

/**
 * ISSA 612 production rates per space category (Josh, 2026-10-12: "ISSA by
 * default for everything" until a hospital supplies its own per-room times).
 * Midpoints of the published ranges, sq ft per hour, as listed at
 * os.xiri.ai/blog/issa-612-cleaning-rates-explained. Editable per room type.
 */
export interface IssaCategory { id: string; label: string; sqftPerHour: number; }

export const ISSA_CATEGORIES: IssaCategory[] = [
  { id: "office", label: "General office", sqftPerHour: 4250 },
  { id: "conference", label: "Conference", sqftPerHour: 3500 },
  { id: "lobby-corridor", label: "Lobbies & corridors", sqftPerHour: 5500 },
  { id: "elevator", label: "Elevator", sqftPerHour: 600 },
  { id: "restroom", label: "Restroom", sqftPerHour: 1000 },
  { id: "break-room", label: "Break room / cafeteria", sqftPerHour: 3150 },
  { id: "clinical", label: "Medical / clinical", sqftPerHour: 2150 },
  { id: "lab", label: "Laboratory", sqftPerHour: 1850 },
  { id: "locker", label: "Locker room", sqftPerHour: 1850 }
];

export function issaCategory(id: string | undefined): IssaCategory | undefined {
  return ISSA_CATEGORIES.find((c) => c.id === id);
}

/** built-in room type → its ISSA category (the nearest one where ISSA has none) */
export const ISSA_TYPE_CATEGORY: Record<string, string> = {
  office: "office", storage: "office", "conference-room": "conference",
  lobby: "lobby-corridor", "waiting-room": "lobby-corridor", corridor: "lobby-corridor",
  hallway: "lobby-corridor", stairwell: "lobby-corridor",
  elevator: "elevator", restroom: "restroom",
  lounge: "break-room", "break-room": "break-room",
  "exam-room": "clinical", "emergency-room": "clinical", "patient-room": "clinical",
  "procedure-room": "clinical", "operating-room": "clinical", "utility-room": "clinical",
  "nurses-station": "clinical", "clean-utility": "clinical",
  lab: "lab", "locker-room": "locker",
  // infrastructure is rarely cleaned; when it is, it prices like storage
  "mechanical-room": "office", "electrical-room": "office", "data-telecom": "office",
  shaft: "office", "shell-space": "office", roof: "office"
};

/** a built-in room type at its ISSA default (no qualifier — ISSA rates are all-in) */
function issaType(id: string, label: string, frequency: string, extra?: Partial<RoomTypeRule>): RoomTypeRule {
  const cat = issaCategory(ISSA_TYPE_CATEGORY[id])!;
  return {
    id, label, qualifierMin: 0, frequency, issaCategory: cat.id, sqftPerHour: cat.sqftPerHour,
    ...extra, builtIn: true
  };
}

export type BasePricing = "formula" | "rate" | "flat";

/** how a room type prices its general clean: flat minutes › own rate › floor formula */
export function basePricing(rt: RoomTypeRule | undefined): BasePricing {
  if (rt && Number(rt.flatMinutes) > 0) return "flat";
  if (rt && Number(rt.sqftPerHour) > 0) return "rate";
  return "formula";
}

/** "ISSA Medical / clinical" while the rate is still ISSA's, else "your rate" */
export function rateSourceLabel(rt: RoomTypeRule): string {
  const cat = issaCategory(rt.issaCategory);
  return cat && Number(rt.sqftPerHour) === cat.sqftPerHour ? `ISSA ${cat.label}` : "your rate";
}

/** 2150 sq ft/hr → "35.8" (sq ft per minute, one decimal, no trailing .0) */
export function perMinuteText(sqftPerHour: number): string {
  return String(Math.round((sqftPerHour / 60) * 10) / 10);
}

/** ids of the tasks the 2026-10-12 operator workaround added (one per ISSA category) */
export const ISSA_HELPER_TASK = /^issa-/;
const ISSA_HELPER_CATEGORY: Record<string, string> = {
  "issa-office": "office", "issa-conference": "conference", "issa-elevator": "elevator",
  "issa-restroom": "restroom", "issa-breakroom": "break-room", "issa-clinical": "clinical",
  "issa-lab": "lab", "issa-locker": "locker"
};
/** the workaround's base rate: Lobbies & corridors, 5,500 sq ft/hr as sq ft/min */
const ISSA_HELPER_BASE = 5500 / 60;

/**
 * Put every room type on the built-in ISSA rates — the one-click move for an
 * account saved before they existed, and the clean-up for the operator
 * workaround (base rate 5,500 sq ft/hr + one "issa-*" auto task per
 * category). Each type gets its category's rate (built-in mapping, else the
 * workaround task that was riding on it, else the base the workaround priced
 * it at, else General office), qualifiers go to 0 (ISSA rates are all-in),
 * flat minutes are cleared, the helper tasks are removed and a workaround
 * base rate goes back to the stock floor formula. Cleanable rooms price the
 * same as the workaround did, to rounding. Returns a NEW rulebook.
 */
export function applyIssaStandards(rules: Rules): Rules {
  const next: Rules = JSON.parse(JSON.stringify(rules));
  const helpers = next.tasks.filter((t) => ISSA_HELPER_TASK.test(t.id));
  const helperCat = (typeId: string) =>
    ISSA_HELPER_CATEGORY[helpers.find((t) => (t.autoFor ?? []).includes(typeId))?.id ?? ""];
  for (const rt of next.roomTypes) {
    const catId = rt.issaCategory ?? helperCat(rt.id) ?? ISSA_TYPE_CATEGORY[rt.id]
      ?? (helpers.length ? "lobby-corridor" : "office");
    const cat = issaCategory(catId) ?? issaCategory("office")!;
    rt.issaCategory = cat.id;
    rt.sqftPerHour = cat.sqftPerHour;
    rt.qualifierMin = 0;
    delete rt.flatMinutes;
  }
  if (helpers.length) {
    next.tasks = next.tasks.filter((t) => !ISSA_HELPER_TASK.test(t.id));
    const def = defaultRules().general;
    if (Math.abs(next.general.hardSqftPerMin - ISSA_HELPER_BASE) < 0.05) next.general.hardSqftPerMin = def.hardSqftPerMin;
    if (Math.abs(next.general.carpetSqftPerMin - ISSA_HELPER_BASE) < 0.05) next.general.carpetSqftPerMin = def.carpetSqftPerMin;
  }
  return next;
}

/** does this rulebook still need applyIssaStandards? (helper tasks, or a type on the floor formula) */
export function needsIssaMigration(rules: Rules): { helperTasks: number; formulaTypes: number } {
  return {
    helperTasks: rules.tasks.filter((t) => ISSA_HELPER_TASK.test(t.id)).length,
    formulaTypes: rules.roomTypes.filter((rt) => basePricing(rt) === "formula").length
  };
}

export const FREQUENCIES = [
  "7x / week", "6x / week", "5x / week", "3x / week", "2x / week", "1x / week", "Every other week", "Monthly"
];

export const RULES_KEY = "opsmatrix_fusion_rules";

export function defaultRules(): Rules {
  return {
    version: 1,
    general: {
      hardSqftPerMin: 33, carpetSqftPerMin: 40, mopIncluded: true, vacuumIncluded: true,
      minMinutes: 3, productiveMinutes: 420, shiftsPerWeekPerFte: 5
    },
    tasks: [
      // floor-tech work (Max Floor Care owns scheduling these)
      { id: "auto-scrub", label: "Machine Scrubbing", sqftPerMin: 200, flatMin: 0, autoFor: ["corridor", "hallway"], addable: true, floorCare: true, builtIn: true },
      { id: "dust-mop", label: "Dust Mopping", sqftPerMin: 150, flatMin: 0, autoFor: ["corridor", "hallway"], addable: true, floorCare: true, builtIn: true },
      { id: "burnish", label: "Burnishing", sqftPerMin: 100, flatMin: 0, autoFor: [], addable: true, floorCare: true, builtIn: true },
      { id: "machine-sweep", label: "Machine Sweeping", sqftPerMin: 300, flatMin: 0, autoFor: [], addable: true, floorCare: true, builtIn: true },
      { id: "machine-carpet", label: "Machine Carpet Cleaning", sqftPerMin: 180, flatMin: 0, autoFor: [], addable: true, floorCare: true, builtIn: true },
      // everyone-else tasks
      { id: "high-dusting", label: "High Dusting", sqftPerMin: 120, flatMin: 0, autoFor: [], addable: true, builtIn: true },
      { id: "trash-pull", label: "Trash Pull", sqftPerMin: null, flatMin: 2, autoFor: [], addable: true, builtIn: true },
      // standalone mopping/vacuuming (Josh, 2026-08-31): normally the General
      // Clean rate includes them, but with the formula toggles off — or the
      // formula deleted — these price the work as explicit space tasks
      { id: "damp-mop", label: "Mopping", sqftPerMin: 60, flatMin: 0, autoFor: [], addable: true, builtIn: true },
      { id: "vacuum", label: "Vacuuming", sqftPerMin: 55, flatMin: 0, autoFor: [], addable: true, builtIn: true }
    ],
    // ISSA production rates per room type (2026-10-12) — the floor formula
    // above only prices a type that has no rate of its own
    roomTypes: [
      issaType("office", "Office", "5x / week"),
      issaType("exam-room", "Exam Room", "7x / week"),
      issaType("emergency-room", "Emergency Room", "7x / week"),
      issaType("patient-room", "Patient Room", "7x / week"),
      issaType("lounge", "Lounge", "7x / week"),
      issaType("lobby", "Lobby", "7x / week"),
      issaType("waiting-room", "Waiting Room", "7x / week"),
      issaType("procedure-room", "Procedure Room", "7x / week"),
      issaType("restroom", "Restroom", "7x / week"),
      issaType("operating-room", "Operating Room", "7x / week"),
      issaType("corridor", "Corridor", "7x / week"),
      issaType("hallway", "Hallway", "7x / week"),
      // spaces a hospital CAD export names that EVS still cleans
      issaType("stairwell", "Stairwell", "2x / week"),
      issaType("elevator", "Elevator", "7x / week"),
      issaType("storage", "Storage", "1x / week"),
      issaType("utility-room", "Utility Room", "7x / week"),
      issaType("locker-room", "Locker Room", "7x / week"),
      issaType("conference-room", "Conference Room", "5x / week"),
      issaType("nurses-station", "Nurses Station", "7x / week"),
      issaType("break-room", "Break Room / Kitchen", "7x / week"),
      issaType("lab", "Laboratory", "7x / week"),
      issaType("clean-utility", "Clean Supply / Med Room", "7x / week"),
      // infrastructure: real square footage, but not normal EVS workload
      issaType("mechanical-room", "Mechanical Room", "1x / week", { cleanability: "non-cleanable" }),
      issaType("electrical-room", "Electrical Room", "1x / week", { cleanability: "non-cleanable" }),
      issaType("data-telecom", "Data / Telecom Room", "1x / week", { cleanability: "non-cleanable" }),
      issaType("shaft", "Shaft", "1x / week", { cleanability: "non-cleanable" }),
      issaType("shell-space", "Shell Space", "1x / week", { cleanability: "non-cleanable" }),
      issaType("roof", "Roof", "1x / week", { cleanability: "non-cleanable" })
    ],
    // Sanitation Route left this list 2026-08-31 — routes are built in the
    // Max Sanitation engine now, not booked as a flat block of hours.
    nonSpaceDefs: [
      // 40 min = the middle of the published 35–45 min terminal-clean range
      { id: "discharge", label: "Discharges", defaultHours: 2, minutes: 40, qualifierIds: ["travel-time"], builtIn: true },
      { id: "day-porter", label: "Day Porter", defaultHours: 8, minutes: 480, qualifierIds: [], builtIn: true }
    ],
    nonSpaceQualifiers: [
      { id: "travel-time", label: "Travel time", minutes: 5, builtIn: true }
    ],
    breaks: [
      { id: "break-am", label: "Morning Break", minutes: 15, start: "9:30 AM", builtIn: true },
      { id: "lunch", label: "Lunch", minutes: 30, start: "12:30 PM", builtIn: true },
      { id: "break-pm", label: "Afternoon Break", minutes: 15, start: "2:00 PM", builtIn: true }
    ],
    // one starter so the picker never opens empty; delete it and it stays gone
    breakSchedules: [
      {
        id: "bs-a", label: "Break Schedule A",
        windows: [
          { kind: "break", start: "09:00", minutes: 15 },
          { kind: "lunch", start: "11:15", minutes: 45 }
        ]
      }
    ]
  };
}

/** ids of built-ins the account deliberately deleted — stamped by saveRules
 *  so loadRules doesn't resurrect them on the next visit */
interface DeletedBuiltIns {
  tasks?: string[]; roomTypes?: string[]; nonSpaceDefs?: string[]; nonSpaceQualifiers?: string[];
}

export function loadRules(): Rules {
  try {
    const raw = localStorage.getItem(RULES_KEY);
    if (!raw) return defaultRules();
    const parsed = JSON.parse(raw);
    const def = defaultRules();
    const gone: DeletedBuiltIns = (parsed.deletedBuiltIns && typeof parsed.deletedBuiltIns === "object")
      ? parsed.deletedBuiltIns : {};
    // merge: keep user edits, guarantee every built-in exists — EXCEPT the
    // ones the account deleted on purpose (the tombstones saveRules stamps)
    const rules: Rules = {
      version: 1,
      general: { ...def.general, ...(parsed.general ?? {}) },
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : def.tasks,
      roomTypes: Array.isArray(parsed.roomTypes) ? parsed.roomTypes : def.roomTypes,
      nonSpaceDefs: def.nonSpaceDefs,
      nonSpaceQualifiers: Array.isArray(parsed.nonSpaceQualifiers) ? parsed.nonSpaceQualifiers : def.nonSpaceQualifiers,
      // an account that predates break setup keeps the standard ones
      breaks: Array.isArray(parsed.breaks) ? parsed.breaks : def.breaks,
      // a saved EMPTY list means the account deleted them all — only a
      // missing field (pre-feature account) gets the starter
      breakSchedules: Array.isArray(parsed.breakSchedules) ? parsed.breakSchedules : def.breakSchedules
    };
    rules.nonSpaceDefs = Array.isArray(parsed.nonSpaceDefs) ? parsed.nonSpaceDefs : def.nonSpaceDefs;
    // Sanitation Route retired 2026-08-31: the Max Sanitation engine builds
    // routes now. The stock def goes away; a renamed/custom one stays.
    rules.nonSpaceDefs = rules.nonSpaceDefs.filter(
      (x: NonSpaceDef) => !(x.id === "sanitation-route" && x.builtIn && x.label === "Sanitation Route"));
    const OLD_TASK_LABELS: Record<string, string> = { "auto-scrub": "Auto Scrub", "dust-mop": "Dust Mop" };
    for (const t of def.tasks) {
      const saved = rules.tasks.find((x: TaskRule) => x.id === t.id);
      if (!saved) {
        if (!gone.tasks?.includes(t.id)) rules.tasks.push(t);
        continue;
      }
      // floor-care membership is structural, not a per-account edit
      if (t.floorCare) saved.floorCare = true;
      // accounts saved before the rename keep custom labels, but the old
      // DEFAULT labels move to the new defaults ("Dust Mop" → "Dust Mopping")
      if (saved.label === OLD_TASK_LABELS[t.id]) saved.label = t.label;
    }
    for (const rt of def.roomTypes) {
      if (!rules.roomTypes.some((x: RoomTypeRule) => x.id === rt.id) && !gone.roomTypes?.includes(rt.id)) {
        rules.roomTypes.push(rt);
      }
    }
    for (const rt of rules.roomTypes) {
      if (!rt.frequency) rt.frequency = def.roomTypes.find((x) => x.id === rt.id)?.frequency ?? "7x / week";
    }
    for (const ns of def.nonSpaceDefs) {
      if (!rules.nonSpaceDefs.some((x: NonSpaceDef) => x.id === ns.id) && !gone.nonSpaceDefs?.includes(ns.id)) {
        rules.nonSpaceDefs.push(ns);
      }
    }
    for (const q of def.nonSpaceQualifiers) {
      if (!rules.nonSpaceQualifiers.some((x: NonSpaceQualifier) => x.id === q.id) && !gone.nonSpaceQualifiers?.includes(q.id)) {
        rules.nonSpaceQualifiers.push(q);
      }
    }
    // per-occurrence migration: defs saved before minutes existed derive it
    // from their hours block (their built-in default when they still match)
    for (const ns of rules.nonSpaceDefs) {
      if (!(Number(ns.minutes) > 0)) {
        ns.minutes = def.nonSpaceDefs.find((x) => x.id === ns.id)?.minutes
          ?? (Math.round((Number(ns.defaultHours) || 0) * 60) || 30);
      }
      if (!Array.isArray(ns.qualifierIds)) {
        ns.qualifierIds = def.nonSpaceDefs.find((x) => x.id === ns.id)?.qualifierIds ?? [];
      }
    }
    return rules;
  } catch {
    return defaultRules();
  }
}

export function saveRules(rules: Rules) {
  // stamp the tombstones: built-ins missing from the lists were DELETED by
  // the account, and must not come back on the next load
  const def = defaultRules();
  const missing = (defs: { id: string }[], cur: { id: string }[]) =>
    defs.filter((d) => !cur.some((c) => c.id === d.id)).map((d) => d.id);
  const stamped = {
    ...rules,
    deletedBuiltIns: {
      tasks: missing(def.tasks, rules.tasks),
      roomTypes: missing(def.roomTypes, rules.roomTypes),
      nonSpaceDefs: missing(def.nonSpaceDefs, rules.nonSpaceDefs),
      nonSpaceQualifiers: missing(def.nonSpaceQualifiers, rules.nonSpaceQualifiers ?? [])
    }
  };
  localStorage.setItem(RULES_KEY, JSON.stringify(stamped));
}

/**
 * Minutes a schedule spends on `count` occurrences of a non-space task:
 * count × (the task's own minutes + every attached qualifier's minutes).
 * Five discharges at 40 min with 5-min travel = 5 × 45 = 225.
 */
export function nonSpaceOccurrenceMinutes(rules: Rules, def: NonSpaceDef): number {
  const qual = (def.qualifierIds ?? [])
    .map((id) => rules.nonSpaceQualifiers.find((q) => q.id === id)?.minutes ?? 0)
    .reduce((s, m) => s + m, 0);
  return (Number(def.minutes) || 0) + qual;
}

export function typeIdFromLabel(rules: Rules, label: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, "");
  const hit = rules.roomTypes.find((rt) => norm(rt.label) === norm(label) || norm(rt.id) === norm(label));
  if (hit) return hit.id;
  // legacy classic labels → our ids
  const m: Record<string, string> = {
    orroom: "operating-room", utilityroom: "utility-room", storage: "storage", other: "office",
    erroom: "emergency-room"
  };
  return m[norm(label)] ?? legacyNewType(rules, norm(label)) ?? "office";
}

/**
 * Legacy labels that have a dedicated built-in type since 2026-10-12 — used
 * only while the account has that type (deleted it → the old stand-in).
 */
const LEGACY_NEW_TYPES: Record<string, [string, string]> = {
  nursesstation: ["nurses-station", "office"],
  breakroom: ["break-room", "lounge"],
  conferenceroom: ["conference-room", "office"]
};
function legacyNewType(rules: Rules, key: string): string | undefined {
  const pair = LEGACY_NEW_TYPES[key];
  if (!pair) return undefined;
  return rules.roomTypes.some((rt) => rt.id === pair[0]) ? pair[0] : pair[1];
}

export function isCarpet(floorType: string | undefined): boolean {
  return /carpet/i.test(floorType ?? "");
}

/**
 * Like typeIdFromLabel, but honest about failure: null when the label maps to
 * nothing, instead of quietly falling back to Office. Validation and
 * cleanability decisions need the truth; pricing keeps the forgiving version.
 */
export function typeIdFromLabelStrict(rules: Rules, label: string | undefined): string | null {
  const raw = String(label ?? "").trim();
  if (!raw) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, "");
  const hit = rules.roomTypes.find((rt) => norm(rt.label) === norm(raw) || norm(rt.id) === norm(raw));
  if (hit) return hit.id;
  const m: Record<string, string> = {
    orroom: "operating-room", utilityroom: "utility-room", storage: "storage",
    erroom: "emergency-room", isolationroom: "patient-room"
  };
  return m[norm(raw)] ?? legacyNewType(rules, norm(raw)) ?? null;
}

/** "7x / week" → 7, "Every other week" → 0.5, "Monthly" → 12/52. */
export function freqPerWeek(frequency: string | undefined): number {
  const f = String(frequency ?? "").trim().toLowerCase();
  const m = f.match(/^(\d+(?:\.\d+)?)\s*x/);
  if (m) return Number(m[1]);
  if (/every other week/.test(f)) return 0.5;
  if (/month/.test(f)) return 12 / 52;
  return 7; // unset frequency reads as daily, matching the built-in defaults
}

export type Cleanability = "Cleanable" | "Non-cleanable" | "Needs review";

export interface CleanableSpaceLike extends SpaceLike {
  /** manual override set in Space Validation; wins over the room type */
  cleanability?: string;
}

/**
 * Does this room count toward normal EVS workload?
 * Manual override → room type's cleanability → "Needs review" when the room
 * type is missing or maps to nothing we know. Unresolved rooms are NEVER
 * silently counted as cleanable.
 */
export function spaceCleanability(rules: Rules, space: CleanableSpaceLike): Cleanability {
  const o = String(space.cleanability ?? "").toLowerCase();
  if (o === "cleanable") return "Cleanable";
  if (o === "non-cleanable" || o === "noncleanable") return "Non-cleanable";
  if (o === "needs review" || o === "review") return "Needs review";
  const tid = typeIdFromLabelStrict(rules, space.roomType);
  if (!tid) return "Needs review";
  const rt = rules.roomTypes.find((x) => x.id === tid);
  if (!rt) return "Needs review";
  return rt.cleanability === "non-cleanable" ? "Non-cleanable" : "Cleanable";
}

/**
 * One room's weekly EVS workload minutes: the SAME per-visit formula every
 * other screen uses (computeMinutes) × the room type's cleaning frequency.
 * null = cannot be calculated yet (no usable square footage, or the room
 * still needs classification) — callers must report that, not hide it.
 * Non-cleanable rooms are a real 0, not an unknown.
 */
export function weeklyMinutes(rules: Rules, space: CleanableSpaceLike): number | null {
  const clean = spaceCleanability(rules, space);
  if (clean === "Non-cleanable") return 0;
  if (clean === "Needs review") return null;
  if (!(Number(space.squareFeet) > 0)) return null;
  const per = computeMinutes(rules, space).total;
  const tid = typeIdFromLabelStrict(rules, space.roomType);
  const rt = rules.roomTypes.find((x) => x.id === tid);
  return per * freqPerWeek(rt?.frequency);
}

/**
 * Estimated FTE for a weekly workload. The original OpsMatrix staffing
 * engine's algorithm — workload minutes ÷ productive minutes — carried to a
 * week: one FTE supplies (productive minutes per shift × shifts per week).
 */
export function estimatedFte(weeklyMin: number, rules: Rules): number {
  const perWeek = Math.max(1, rules.general.productiveMinutes * rules.general.shiftsPerWeekPerFte);
  return weeklyMin / perWeek;
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
  /** floor-care tasks the manager marked "does not need" for this room */
  fcNotNeeded?: string[];
}

export function requiredTasks(rules: Rules, space: SpaceLike): string[] {
  const explicit = space.spaceTasks ?? space.fusionTasks;
  if (Array.isArray(explicit)) return explicit;
  return autoTasksFor(rules, typeIdFromLabel(rules, space.roomType ?? ""));
}

/** is this task the floor crew's (scheduled ONLY in Max Floor Care)? */
export function isFloorCareTask(rules: Rules, taskId: string): boolean {
  return Boolean(rules.tasks.find((t) => t.id === taskId)?.floorCare);
}

/**
 * A room's required tasks split by WHO schedules them (Josh's rule,
 * 2026-08-28: floor-care work — machine scrubbing, dust mopping, burnishing,
 * machine sweeping, machine carpet cleaning, and anything a manager flags as
 * floor care in Scope — can never be put on a schedule in Max Schedules;
 * it belongs to Max Floor Care exclusively).
 */
export function splitRequiredTasks(rules: Rules, space: SpaceLike): { cleaning: string[]; floorCare: string[] } {
  const req = requiredTasks(rules, space);
  return {
    cleaning: req.filter((id) => !isFloorCareTask(rules, id)),
    floorCare: req.filter((id) => isFloorCareTask(rules, id))
  };
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

  if (includeBase && !rules.general.formulaOff) {
    const rt = rules.roomTypes.find((x) => x.id === typeIdFromLabel(rules, space.roomType ?? ""));
    const pricing = basePricing(rt);
    if (rt && pricing === "flat") {
      // the hospital's own standard for this room type: size doesn't matter
      lines.push({ label: `General cleaning — ${rt.flatMinutes} min per clean (${rt.label} standard)`, minutes: Number(rt.flatMinutes) });
    } else if (rt && pricing === "rate") {
      // a per-type production rate (ISSA by default) replaces the floor formula
      const sfh = Number(rt.sqftPerHour);
      lines.push({
        label: `General cleaning — 1 min per ${perMinuteText(sfh)} sq ft (${rateSourceLabel(rt)})`,
        minutes: sqft * 60 / sfh
      });
    } else {
      const per = carpet ? rules.general.carpetSqftPerMin : rules.general.hardSqftPerMin;
      const included = carpet
        ? (rules.general.vacuumIncluded !== false ? "carpet, vacuuming included" : "carpet")
        : (rules.general.mopIncluded !== false ? "hard floor, mopping included" : "hard floor");
      lines.push({
        label: `General cleaning — 1 min per ${per} sq ft (${included})`,
        minutes: per > 0 ? sqft / per : 0
      });
    }
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
