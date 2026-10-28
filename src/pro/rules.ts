// Cleaning rules engine for the Map Scheduler ("how long does a room take?").
// Every number is visible and editable in the Rules panel; starting values
// follow ISSA-style healthcare production-rate conventions (editable
// estimates, not gospel). Persisted under its own key; classic app data is
// kept in sync by writing each space's estimatedCleaningMinutes.
import type { IntakeProfile } from "./intakeScope";

export interface TaskRule {
  id: string;
  label: string;
  /** 1 minute per this many sq ft (null → flat minutes instead) */
  sqftPerMin: number | null;
  flatMin: number;
  /** room types that get this task automatically */
  autoFor: string[];
  /**
   * Floor types that get this task automatically, on top of autoFor (Josh,
   * 2026-10-12: mopping on every hard floor, vacuuming on every carpet).
   * Never applies to non-cleanable room types.
   */
  autoForFloor?: FloorKind[];
  /** room types the floor rule skips (corridors: their floors are the floor crew's) */
  floorSkipTypes?: string[];
  /** shown in the picker for manual adds */
  addable: boolean;
  /** floor-tech work: scheduled in Max Floor Care, not in Max Schedules */
  floorCare?: boolean;
  /**
   * How often the task is done when that ISN'T every clean (Josh, 2026-10-28:
   * an intake's floor care runs on its own days — burnishing patient rooms 3
   * days a week while they're cleaned daily). `frequencyFor` is per room type,
   * `frequency` everywhere else; absent = with every clean, as before. Only
   * weekly workload uses it: a scheduled visit is still one visit.
   */
  frequency?: string;
  frequencyFor?: Record<string, string>;
  builtIn?: boolean;
}

/** the three floor types a room can have, as a task's floor trigger names them */
export type FloorKind = "carpet" | "hard-finished" | "hard-unfinished";

export const FLOOR_KINDS: { id: FloorKind; label: string }[] = [
  { id: "carpet", label: "Carpet" },
  { id: "hard-finished", label: "Hard floor — finished" },
  { id: "hard-unfinished", label: "Hard floor — unfinished" }
];

/**
 * A room's floor type as a FloorKind. Anything not carpet is hard floor, and
 * a blank one reads as finished hard floor — what the room sidebar has always
 * promised ("unset: prices as hard floor"), and Max Space flags it missing.
 */
export function floorKind(floorType: string | undefined): FloorKind {
  const s = String(floorType ?? "").trim();
  if (isCarpet(s)) return "carpet";
  return /unfinished/i.test(s) ? "hard-unfinished" : "hard-finished";
}

/**
 * Where a built-in floor task's starting rate comes from (ISSA 540 cleaning
 * times). Shown in Scope while the task still uses that rate.
 */
export const FLOOR_TASK_SOURCES: Record<string, { sqftPerMin: number; source: string }> = {
  "damp-mop": { sqftPerMin: 68.67, source: "ISSA 540 #429 — 18\" microfiber flat mop, single-use pad per room: 14.56 min per 1,000 sq ft (4,120 sq ft/hr)" },
  vacuum: { sqftPerMin: 47.62, source: "ISSA 540 #280 — 14\" upright vacuum: 21 min per 1,000 sq ft (2,857 sq ft/hr)" }
};

/** the ISSA source line for a task still at its ISSA rate, else null */
export function taskSourceLabel(t: TaskRule): string | null {
  const src = FLOOR_TASK_SOURCES[t.id];
  return src && t.sqftPerMin !== null && Math.abs(Number(t.sqftPerMin) - src.sqftPerMin) < 0.01 ? src.source : null;
}

/** the floor rule the built-in floor tasks start with (and pre-feature accounts get) */
const FLOOR_TASK_DEFAULTS: Record<string, { autoForFloor: FloorKind[]; floorSkipTypes: string[] }> = {
  "damp-mop": { autoForFloor: ["hard-finished", "hard-unfinished"], floorSkipTypes: ["corridor", "hallway"] },
  vacuum: { autoForFloor: ["carpet"], floorSkipTypes: ["corridor", "hallway"] }
};

/**
 * How a room type builds its General Clean time (Josh, 2026-10-12):
 * by size (sq ft ÷ rate), a fixed number of minutes per room, or both.
 */
export type GcMethod = "size" | "fixed" | "both";

/** the unit a rate is TYPED in — a hospital's numbers go in exactly as given */
export type RateUnit = "sqftPerHour" | "sqftPerMin" | "minPer100" | "minPer1000";

export interface RoomTypeRule {
  id: string;
  label: string;
  /**
   * The room type's General Clean formula — General Clean ACTIVATES it.
   * Floor type never changes it, and nothing else adds to it: a room that
   * needs more gets an extra task, a room that differs gets its own type.
   * Optional only because rules saved before 2026-10-12 lack it; loadRules
   * fills it in (gcFormula reads an unmigrated type the same way).
   */
  method?: GcMethod;
  /** fixed minutes per room ("fixed" and "both") */
  fixedMin?: number;
  /** the rate, stored ONE way: sq ft per hour ("size" and "both") */
  sqftPerHour?: number;
  /** the unit the rate was entered in — display only, the math uses sqftPerHour */
  rateUnit?: RateUnit;
  /** the ISSA space category this type matches (ISSA_CATEGORIES id) — "Reset to ISSA" */
  issaCategory?: string;
  /**
   * Tasks this type's General Clean already covers (trash, damp mop, vacuum
   * by default). They can't be added as extras to rooms of this type and
   * never add time; a room still listing one is flagged.
   */
  includedTasks?: string[];
  /** @deprecated pre-2026-10-12 flat add-on; loadRules moves it into fixedMin */
  qualifierMin?: number;
  /** how often this type is cleaned, e.g. "7x / week" — editable per account */
  frequency: string;
  /**
   * Whether rooms of this type normally count toward EVS cleaning workload.
   * A mechanical room is real hospital square footage — it stays in Max Space
   * and in Total Facility Area — it just doesn't drive standard EVS staffing.
   * Absent = cleanable (every pre-existing type keeps its old behavior).
   */
  cleanability?: "cleanable" | "non-cleanable";
  /** from an intake form: the shifts that primarily clean this type ("1st, Weekends") */
  cleanedOn?: string;
  /** from an intake form: the facility does more here than the general clean (pick its extras) */
  beyondGeneral?: boolean;
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
  /**
   * When in the shift it happens (Josh, 2026-10-12). "start" and "end"
   * duties print as the first and last stops of the day (cart setup and
   * teardown); "anytime" — or absent — is an ongoing duty worked around
   * the rooms.
   */
  position?: DutyPosition;
  builtIn?: boolean;
}

export type DutyPosition = "start" | "end" | "anytime";

/** one step of the account's cleaning procedure, printed above the room list */
export interface ProcedureStep {
  title: string;
  detail?: string;
}

/**
 * The cleaning procedure printed on every schedule (Josh, 2026-10-12). The
 * packaged steps are an EXAMPLE, and the sheet says so, until the account
 * edits them into its own.
 */
export interface CleaningProcedure {
  steps: ProcedureStep[];
  /** print it on schedules */
  show: boolean;
  /** still the packaged example (any edit makes it the facility's own) */
  example: boolean;
}

export const EXAMPLE_PROCEDURE_STEPS: ProcedureStep[] = [
  { title: "Empty trash", detail: "Remove trash and recycling; replace liners. Bag soiled linen if present." },
  { title: "High dust", detail: "Dust vents, ledges and high surfaces first: work top to bottom." },
  { title: "Damp wipe / disinfect", detail: "Disinfect high-touch surfaces clean-to-dirty; follow the product's wet contact time." },
  { title: "Spot clean", detail: "Spot clean walls, doors, glass and mirrors." },
  { title: "Clean the restroom", detail: "Clean and disinfect sink, toilet and fixtures; restock soap, paper and towels." },
  { title: "Dust mop", detail: "Dust mop or vacuum the floor, removing loose debris from corners and under furniture." },
  { title: "Damp mop", detail: "Damp mop hard floors with a fresh microfiber pad, working toward the door. Place a wet-floor sign." }
];

export function exampleProcedure(): CleaningProcedure {
  return { steps: EXAMPLE_PROCEDURE_STEPS.map((s) => ({ ...s })), show: true, example: true };
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
  /**
   * Unpaid (Josh, 2026-10-12): the break is ADDED to the day instead of
   * coming out of the paid shift — an 8-hour shift with a 30-minute unpaid
   * lunch runs 7:00 AM – 3:30 PM. Absent = paid, as before.
   */
  unpaid?: boolean;
  builtIn?: boolean;
}

/** minutes in one paid shift — a shift is 8 paid hours */
export const PAID_SHIFT_MINUTES = 480;

/**
 * Room-work minutes in one paid shift, from Scope: 8 paid hours less the
 * paid breaks and the start/end-of-shift duties (cart setup, teardown).
 * Unpaid breaks don't come out of it — they lengthen the day instead.
 */
export function productiveFromScope(rules: Rules): number {
  const paidBreaks = (rules.breaks ?? []).filter((b) => !b.unpaid)
    .reduce((s, b) => s + (Number(b.minutes) || 0), 0);
  const duties = rules.nonSpaceDefs.filter((d) => d.position === "start" || d.position === "end")
    .reduce((s, d) => s + nonSpaceOccurrenceMinutes(rules, d), 0);
  return PAID_SHIFT_MINUTES - paidBreaks - duties;
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
  /** unpaid — the export marks it "(unpaid)" */
  unpaid?: boolean;
}

export interface BreakSchedule {
  id: string;
  label: string;
  windows: BreakWindow[];
}

export interface Rules {
  version: number;
  general: {
    /**
     * RETIRED 2026-10-12 — the old per-floor-type General Clean rates and
     * the mop/vacuum toggles. Nothing prices from them any more (each room
     * type has its own formula and included-tasks list); kept so saved
     * accounts round-trip and migration can seed custom types' rates.
     */
    hardSqftPerMin: number;
    carpetSqftPerMin: number;
    mopIncluded: boolean;
    vacuumIncluded: boolean;
    /**
     * The nuclear option: General Clean itself was deleted in Scope. Rooms
     * then price ONLY their extra tasks — the warning in Scope says exactly
     * that until it's restored.
     */
    formulaOff?: boolean;
    /** RETIRED 2026-10-12: General Clean time is the pure formula, no minimum */
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
  procedure: CleaningProcedure;
  /** the intake form Scope was set up from — kept for reference (intakeScope.ts) */
  intake?: IntakeProfile;
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

/** what ISSA rates already cover, so these never add time on top (default list) */
export const DEFAULT_INCLUDED_TASKS = ["trash-pull", "damp-mop", "vacuum"];

/** a built-in room type at its ISSA default: by size, at its category's rate */
function issaType(id: string, label: string, frequency: string, extra?: Partial<RoomTypeRule>): RoomTypeRule {
  const cat = issaCategory(ISSA_TYPE_CATEGORY[id])!;
  return {
    id, label, frequency, method: "size", fixedMin: 0, sqftPerHour: cat.sqftPerHour, rateUnit: "sqftPerHour",
    issaCategory: cat.id, includedTasks: [...DEFAULT_INCLUDED_TASKS], ...extra, builtIn: true
  };
}

// ── the General Clean formula ───────────────────────────────────────────────

export const RATE_UNITS: { id: RateUnit; label: string; short: string }[] = [
  { id: "sqftPerHour", label: "sq ft per hour", short: "sq ft/hr" },
  { id: "sqftPerMin", label: "sq ft per minute", short: "sq ft/min" },
  { id: "minPer100", label: "minutes per 100 sq ft", short: "min per 100 sq ft" },
  { id: "minPer1000", label: "minutes per 1,000 sq ft", short: "min per 1,000 sq ft" }
];

/** a rate as typed in `unit` → the one stored form, sq ft per hour (0 = no rate) */
export function rateFromUnit(value: number, unit: RateUnit): number {
  const v = Number(value);
  if (!(v > 0)) return 0;
  switch (unit) {
    case "sqftPerMin": return v * 60;
    case "minPer100": return 6000 / v;
    case "minPer1000": return 60000 / v;
    default: return v;
  }
}

/** the stored sq ft per hour shown in `unit` (exact inverse of rateFromUnit, 4 decimals) */
export function rateInUnit(sqftPerHour: number, unit: RateUnit): number {
  const r = Number(sqftPerHour);
  if (!(r > 0)) return 0;
  const v = unit === "sqftPerMin" ? r / 60 : unit === "minPer100" ? 6000 / r : unit === "minPer1000" ? 60000 / r : r;
  return Math.round(v * 10000) / 10000;
}

export interface GcFormula {
  method: GcMethod;
  fixedMin: number;
  /** stored rate, sq ft per hour (0 = none) */
  sqftPerHour: number;
  rateUnit: RateUnit;
}

/** ids of the tasks the 2026-10-12 operator workaround added (one per ISSA category) */
export const ISSA_HELPER_TASK = /^issa-/;
const ISSA_HELPER_CATEGORY: Record<string, string> = {
  "issa-office": "office", "issa-conference": "conference", "issa-elevator": "elevator",
  "issa-restroom": "restroom", "issa-breakroom": "break-room", "issa-clinical": "clinical",
  "issa-lab": "lab", "issa-locker": "locker"
};

/** the ISSA category a type matches: its own, the workaround task riding on it, the built-in map */
export function categoryFor(rules: Rules, rt: RoomTypeRule): IssaCategory | undefined {
  const helpers = rules.tasks.filter((t) => ISSA_HELPER_TASK.test(t.id));
  const helper = helpers.find((t) => (t.autoFor ?? []).includes(rt.id));
  return issaCategory(rt.issaCategory)
    ?? issaCategory(helper ? ISSA_HELPER_CATEGORY[helper.id] : undefined)
    ?? issaCategory(ISSA_TYPE_CATEGORY[rt.id])
    // the workaround priced every type without a helper at its 5,500 sf/hr base
    ?? (helpers.length ? issaCategory("lobby-corridor") : undefined);
}

/**
 * A room type's General Clean formula. Types saved since 2026-10-12 carry
 * it; an older one is read the way migrateRules converts it: its ISSA rate
 * where ISSA applies (else the old hard-floor rate), its old qualifier as
 * the fixed minutes.
 */
export function gcFormula(rules: Rules, rt: RoomTypeRule): GcFormula {
  const num = (v: unknown) => (Number(v) > 0 ? Number(v) : 0);
  if (rt.method) {
    return { method: rt.method, fixedMin: num(rt.fixedMin), sqftPerHour: num(rt.sqftPerHour), rateUnit: rt.rateUnit ?? "sqftPerHour" };
  }
  const cat = categoryFor(rules, rt);
  const own = num(rt.sqftPerHour);
  const sqftPerHour = own || (cat ? cat.sqftPerHour : num(rules.general.hardSqftPerMin) * 60);
  const fixedMin = num(rt.fixedMin) || num(rt.qualifierMin);
  return {
    method: fixedMin > 0 ? (sqftPerHour > 0 ? "both" : "fixed") : "size",
    fixedMin, sqftPerHour,
    // an old floor rate reads in the unit it was known by
    rateUnit: own || cat ? "sqftPerHour" : "sqftPerMin"
  };
}

/** minutes the formula gives a room of `sqft` — unrounded, so audits reproduce */
export function gcMinutes(f: GcFormula, sqft: number): number {
  const fixed = f.method === "size" ? 0 : f.fixedMin;
  const size = f.method === "fixed" || !(f.sqftPerHour > 0) ? 0 : (Number(sqft) || 0) * 60 / f.sqftPerHour;
  return fixed + size;
}

const fmtNum = (n: number, digits = 1) =>
  (Math.round(n * 10 ** digits) / 10 ** digits).toLocaleString("en-US", { maximumFractionDigits: digits });

/** "4,250 sq ft/hr", "3 min per 100 sq ft" — the rate as it was typed */
export function rateText(f: GcFormula): string {
  const unit = RATE_UNITS.find((u) => u.id === f.rateUnit) ?? RATE_UNITS[0];
  return `${fmtNum(rateInUnit(f.sqftPerHour, unit.id), 4)} ${unit.short}`;
}

const timesUnit = (f: GcFormula) => f.rateUnit === "minPer100" || f.rateUnit === "minPer1000";

/**
 * The ONE General Clean line, worked so anyone can redo it by hand:
 * "Office: 152 sq ft ÷ 4,250 sq ft/hr = 2.1 min", "Exam Room: 10 min",
 * "Exam Room: 4 min + 161 sq ft ÷ 2,150 sq ft/hr = 8.5 min".
 */
export function gcText(typeLabel: string, f: GcFormula, sqft: number): string {
  const total = fmtNum(gcMinutes(f, sqft));
  const size = `${fmtNum(Number(sqft) || 0)} sq ft ${timesUnit(f) ? "×" : "÷"} ${rateText(f)}`;
  if (f.method === "fixed") return `${typeLabel}: ${fmtNum(f.fixedMin)} min`;
  if (f.method === "size") return `${typeLabel}: ${size} = ${total} min`;
  return `${typeLabel}: ${fmtNum(f.fixedMin)} min + ${size} = ${total} min`;
}

/** the formula in words, no room: "4 min + sq ft ÷ 2,150 sq ft/hr" */
export function gcFormulaText(f: GcFormula): string {
  const size = `sq ft ${timesUnit(f) ? "×" : "÷"} ${rateText(f)}`;
  if (f.method === "fixed") return `${fmtNum(f.fixedMin)} min per room`;
  if (f.method === "size") return size;
  return `${fmtNum(f.fixedMin)} min + ${size}`;
}

/** "ISSA Medical / clinical" while the formula is still ISSA's own, else null */
export function issaSourceLabel(rules: Rules, rt: RoomTypeRule): string | null {
  const f = gcFormula(rules, rt);
  const cat = categoryFor(rules, rt);
  return cat && f.method === "size" && Math.abs(f.sqftPerHour - cat.sqftPerHour) < 0.01 ? `ISSA ${cat.label}` : null;
}

/** put a type back on its ISSA formula (category given, else its own/built-in, else General office) */
export function resetToIssa(rules: Rules, rt: RoomTypeRule, categoryId?: string): void {
  const cat = issaCategory(categoryId) ?? categoryFor(rules, rt) ?? issaCategory("office")!;
  rt.issaCategory = cat.id;
  rt.method = "size";
  rt.fixedMin = 0;
  rt.sqftPerHour = cat.sqftPerHour;
  rt.rateUnit = "sqftPerHour";
}

/** tasks a type's General Clean already covers */
export function includedTasksFor(rules: Rules, typeId: string): string[] {
  const rt = rules.roomTypes.find((x) => x.id === typeId);
  return rt?.includedTasks ?? defaultIncluded(rules);
}

function defaultIncluded(rules: Rules): string[] {
  const g = rules.general;
  return DEFAULT_INCLUDED_TASKS.filter((id) =>
    !(id === "damp-mop" && g.mopIncluded === false) && !(id === "vacuum" && g.vacuumIncluded === false));
}

/**
 * Bring a saved rulebook up to the 2026-10-12 model, in place: every room
 * type gets its formula (gcFormula's reading — ISSA where it applies, the
 * old hard-floor rate otherwise, the old qualifier as fixed minutes) and an
 * included-tasks list (trash + the mop/vacuum the old floor rates covered),
 * and the operator workaround's "issa-*" helper tasks are removed — their
 * categories already landed on the types. Rooms and schedules drop the
 * helper ids through stripIssaHelperTasks (classicStore).
 */
export function migrateRules(rules: Rules): Rules {
  const hadHelpers = rules.tasks.some((t) => ISSA_HELPER_TASK.test(t.id));
  for (const rt of rules.roomTypes) {
    if (!rt.method) {
      const f = gcFormula(rules, rt);
      const cat = categoryFor(rules, rt);
      rt.method = f.method;
      rt.fixedMin = f.fixedMin;
      rt.sqftPerHour = f.sqftPerHour;
      rt.rateUnit = f.rateUnit;
      if (cat && !rt.issaCategory) rt.issaCategory = cat.id;
    }
    if (!Array.isArray(rt.includedTasks)) rt.includedTasks = defaultIncluded(rules);
    delete rt.qualifierMin;
  }
  if (hadHelpers) {
    rules.tasks = rules.tasks.filter((t) => !ISSA_HELPER_TASK.test(t.id));
    // the workaround's 5,500 sf/hr base goes back to the stock numbers
    const def = defaultRules().general;
    rules.general.hardSqftPerMin = def.hardSqftPerMin;
    rules.general.carpetSqftPerMin = def.carpetSqftPerMin;
  }
  // an included task is never an automatic extra for that type
  for (const t of rules.tasks) {
    t.autoFor = (t.autoFor ?? []).filter((typeId) => !includedTasksFor(rules, typeId).includes(t.id));
  }
  rules.version = 2;
  return rules;
}

export const FREQUENCIES = [
  "7x / week", "6x / week", "5x / week", "4x / week", "3x / week", "2x / week", "1x / week", "Every other week", "Monthly",
  // cleaned only when someone asks (an intake form's "As needed / on request"): no routine weekly time
  "As needed"
];

export const RULES_KEY = "opsmatrix_fusion_rules";

function floorRule(id: string): { autoForFloor: FloorKind[]; floorSkipTypes: string[] } {
  const d = FLOOR_TASK_DEFAULTS[id];
  return { autoForFloor: [...d.autoForFloor], floorSkipTypes: [...d.floorSkipTypes] };
}

/** the floor tasks' stock values before ISSA 540 (2026-10-12) — untouched ones move up */
const OLD_FLOOR_TASK_RATES: Record<string, { label: string; sqftPerMin: number }> = {
  "damp-mop": { label: "Mopping", sqftPerMin: 60 },
  vacuum: { label: "Vacuuming", sqftPerMin: 55 }
};

export function defaultRules(): Rules {
  return {
    version: 2,
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
      // mopping/vacuuming/trash are INCLUDED in every type's General Clean by
      // default (ISSA rates cover them); untick one on a type in Scope and it
      // becomes an extra that adds its own time there — on every room of that
      // type whose FLOOR matches (mop: hard floors, vacuum: carpet; corridors
      // and hallways skipped, their floors are the floor crew's). Rates: ISSA
      // 540 (FLOOR_TASK_SOURCES).
      { id: "damp-mop", label: "Mopping", sqftPerMin: 68.67, flatMin: 0, autoFor: [], ...floorRule("damp-mop"), addable: true, builtIn: true },
      { id: "vacuum", label: "Vacuuming", sqftPerMin: 47.62, flatMin: 0, autoFor: [], ...floorRule("vacuum"), addable: true, builtIn: true }
    ],
    // each type's General Clean formula — ISSA midpoints by default (2026-10-12)
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
      { id: "day-porter", label: "Day Porter", defaultHours: 8, minutes: 480, qualifierIds: [], builtIn: true },
      // 15 min each — HFM Magazine EVS staffing guidance (Josh, 2026-10-12)
      { id: "cart-setup", label: "Cart Setup", defaultHours: 0.25, minutes: 15, qualifierIds: [], position: "start", builtIn: true },
      { id: "cart-teardown", label: "Cart Teardown", defaultHours: 0.25, minutes: 15, qualifierIds: [], position: "end", builtIn: true }
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
    ],
    procedure: exampleProcedure()
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
      version: Number(parsed.version) || 1,
      general: { ...def.general, ...(parsed.general ?? {}) },
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : def.tasks,
      roomTypes: Array.isArray(parsed.roomTypes) ? parsed.roomTypes : def.roomTypes,
      nonSpaceDefs: def.nonSpaceDefs,
      nonSpaceQualifiers: Array.isArray(parsed.nonSpaceQualifiers) ? parsed.nonSpaceQualifiers : def.nonSpaceQualifiers,
      // an account that predates break setup keeps the standard ones
      breaks: Array.isArray(parsed.breaks) ? parsed.breaks : def.breaks,
      // a saved EMPTY list means the account deleted them all — only a
      // missing field (pre-feature account) gets the starter
      breakSchedules: Array.isArray(parsed.breakSchedules) ? parsed.breakSchedules : def.breakSchedules,
      // accounts saved before the procedure existed start on the example
      procedure: parsed.procedure && Array.isArray(parsed.procedure.steps)
        ? { show: parsed.procedure.show !== false, example: parsed.procedure.example === true, steps: parsed.procedure.steps }
        : def.procedure,
      ...(parsed.intake && typeof parsed.intake === "object" ? { intake: parsed.intake } : {})
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
      // floor tasks saved before the floor trigger existed get the stock
      // floor rule (an account that cleared it saved [] and keeps that), and
      // an untouched stock rate moves to the ISSA 540 one
      if (FLOOR_TASK_DEFAULTS[t.id]) {
        const rule = floorRule(t.id);
        if (!Array.isArray(saved.autoForFloor)) saved.autoForFloor = rule.autoForFloor;
        if (!Array.isArray(saved.floorSkipTypes)) saved.floorSkipTypes = rule.floorSkipTypes;
        const old = OLD_FLOOR_TASK_RATES[t.id];
        if (saved.label === old.label && Number(saved.sqftPerMin) === old.sqftPerMin) saved.sqftPerMin = t.sqftPerMin;
      }
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
      // cart setup/teardown saved before positions existed take the built-in's
      if (!ns.position) {
        const pos = def.nonSpaceDefs.find((x) => x.id === ns.id)?.position;
        if (pos) ns.position = pos;
      }
    }
    // the 2026-10-12 General Clean model: per-type formulas + included tasks
    return migrateRules(rules);
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

/** "7x / week" → 7, "Every other week" → 0.5, "Monthly" → 12/52, "As needed" → 0. */
export function freqPerWeek(frequency: string | undefined): number {
  const f = String(frequency ?? "").trim().toLowerCase();
  const m = f.match(/^(\d+(?:\.\d+)?)\s*x/);
  if (m) return Number(m[1]);
  if (/every other week/.test(f)) return 0.5;
  if (/month/.test(f)) return 12 / 52;
  if (/as needed|on request/.test(f)) return 0;
  return 7; // unset frequency reads as daily, matching the built-in defaults
}

/** how often a task is done in rooms of a type, when that isn't with every clean */
export function taskFrequency(t: TaskRule, typeId: string | null | undefined): string | undefined {
  return (typeId ? t.frequencyFor?.[typeId] : undefined) || t.frequency || undefined;
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
  const visits = freqPerWeek(rt?.frequency);
  // a task done on its own days (an intake's floor care) counts at its own frequency
  const own: { minutes: number; perWeek: number }[] = [];
  const included = rt ? includedTasksFor(rules, rt.id) : [];
  for (const id of requiredTasks(rules, space)) {
    if (included.includes(id)) continue;
    const t = rules.tasks.find((x) => x.id === id);
    const f = t ? taskFrequency(t, rt?.id) : undefined;
    if (!t || !f) continue;
    const sqft = Number(space.squareFeet) || 0;
    own.push({ minutes: t.sqftPerMin ? sqft / t.sqftPerMin : t.flatMin, perWeek: freqPerWeek(f) });
  }
  if (!own.length) return per * visits;
  const rest = Math.max(0, per - own.reduce((s, x) => s + x.minutes, 0));
  return rest * visits + own.reduce((s, x) => s + x.minutes * x.perWeek, 0);
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

/**
 * The extra tasks a room needs — what gets priced, scheduled and reported
 * uncovered. A task the room type's General Clean already includes is not
 * one of them, even if the room still lists it (see includedConflicts).
 */
export function requiredTasks(rules: Rules, space: SpaceLike): string[] {
  const typeId = typeIdFromLabel(rules, space.roomType ?? "");
  const included = includedTasksFor(rules, typeId);
  return rawSpaceTasks(rules, space).filter((id) => !included.includes(id));
}

/** the room's task list exactly as stored (the editors' view) */
export function rawSpaceTasks(rules: Rules, space: SpaceLike): string[] {
  const explicit = space.spaceTasks ?? space.fusionTasks;
  if (Array.isArray(explicit)) return explicit;
  return autoTasksForSpace(rules, space);
}

/** tasks a room lists that its type's General Clean already covers — flag these */
export function includedConflicts(rules: Rules, space: SpaceLike): string[] {
  const included = includedTasksFor(rules, typeIdFromLabel(rules, space.roomType ?? ""));
  return rawSpaceTasks(rules, space).filter((id) => included.includes(id));
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
  const includeBase = opts?.includeBase !== false;
  const lines: MinuteLine[] = [];
  const typeId = typeIdFromLabel(rules, space.roomType ?? "");
  const rt = rules.roomTypes.find((x) => x.id === typeId);

  if (includeBase && !rules.general.formulaOff) {
    // ONE line: the room type's own formula, worked out. Floor type never
    // changes it and there is no minimum — the time is the pure formula.
    const g = generalCleanLine(rules, space);
    lines.push({ label: "General Clean — " + g.text, minutes: g.minutes });
  }
  // extras on their own lines; anything the type's General Clean already
  // includes adds nothing (requiredTasks drops it; a subset passed in is
  // filtered the same way)
  const included = rt ? includedTasksFor(rules, rt.id) : [];
  const taskIds = (opts?.tasks ?? requiredTasks(rules, space)).filter((id) => !included.includes(id));
  for (const tid of taskIds) {
    const t = rules.tasks.find((x) => x.id === tid);
    if (!t) continue;
    const m = t.sqftPerMin ? sqft / t.sqftPerMin : t.flatMin;
    lines.push({ label: t.label + (t.sqftPerMin ? ` — 1 min per ${t.sqftPerMin} sq ft` : ` — ${t.flatMin} min`), minutes: m });
  }
  const raw = lines.reduce((s, l) => s + l.minutes, 0);
  return { lines, total: Math.round(raw) };
}

/**
 * The room's General Clean, worked: "Office: 152 sq ft ÷ 4,250 sq ft/hr =
 * 2.1 min". A room whose type is gone prices as ISSA General office.
 */
export function generalCleanLine(rules: Rules, space: SpaceLike): { text: string; minutes: number } {
  const sqft = Number(space.squareFeet) || 0;
  const rt = rules.roomTypes.find((x) => x.id === typeIdFromLabel(rules, space.roomType ?? ""));
  const f: GcFormula = rt ? gcFormula(rules, rt)
    : { method: "size", fixedMin: 0, sqftPerHour: issaCategory("office")!.sqftPerHour, rateUnit: "sqftPerHour" };
  const name = rt?.label ?? (String(space.roomType ?? "").trim() || "Room");
  return { text: gcText(name, f, sqft), minutes: gcMinutes(f, sqft) };
}

/**
 * The extras a room gets automatically: the ones Scope gives its room type,
 * plus the ones its FLOOR type triggers (an unset or omitted floor reads as
 * hard floor, see floorKind). Never one its General Clean already includes.
 */
export function autoTasksFor(rules: Rules, typeId: string, floorType?: string): string[] {
  const included = includedTasksFor(rules, typeId);
  return rules.tasks.filter((t) => ((t.autoFor ?? []).includes(typeId) || floorTriggers(rules, t, typeId, floorType))
    && !included.includes(t.id)).map((t) => t.id);
}

/** autoTasksFor for a room as it stands: its type and its floor */
export function autoTasksForSpace(rules: Rules, space: SpaceLike): string[] {
  return autoTasksFor(rules, typeIdFromLabel(rules, space.roomType ?? ""), space.floorType);
}

/** does this room's floor give it task t? (cleanable types not on the task's skip list) */
function floorTriggers(rules: Rules, t: TaskRule, typeId: string, floorType: string | undefined): boolean {
  const kind = floorKind(floorType);
  if (!(t.autoForFloor ?? []).includes(kind)) return false;
  if ((t.floorSkipTypes ?? []).includes(typeId)) return false;
  return rules.roomTypes.find((x) => x.id === typeId)?.cleanability !== "non-cleanable";
}

/**
 * A room's task list after its floor type changes to nextFloorType: the
 * automatic tasks the OLD floor gave it come off, the ones the NEW floor
 * gives it go on (carpet → hard floor: Vacuuming out, Mopping in). Every
 * other entry — manual adds, and manual removals the change doesn't touch —
 * stays exactly as it was, so nothing duplicates and nothing a manager took
 * off comes back unless the floor itself now calls for something new.
 */
export function tasksAfterFloorChange(rules: Rules, space: SpaceLike, nextFloorType: string | undefined): string[] {
  const typeId = typeIdFromLabel(rules, space.roomType ?? "");
  const before = autoTasksFor(rules, typeId, space.floorType);
  const after = autoTasksFor(rules, typeId, nextFloorType);
  const out = rawSpaceTasks(rules, space).filter((id) => !before.includes(id) || after.includes(id));
  for (const id of after) if (!before.includes(id) && !out.includes(id)) out.push(id);
  return out;
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
