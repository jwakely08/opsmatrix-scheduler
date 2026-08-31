// Max Floor Care — the floor-tech scheduling engine.
//
// Floor-care tasks (machine scrubbing, dust mopping, burnishing, machine
// sweeping, machine carpet cleaning) are built into schedules HERE, not in
// Max Schedules. A confirmed floor-care schedule ships INTO Max Schedules as
// a finished schedule (same canonical stores, so coverage, printing and
// Workload Intelligence all see it) — but its home for editing stays Max
// Floor Care.
//
// Timing: a stop is priced by the SELECTED EQUIPMENT's manufacturer rate
// when the schedule has equipment for that task; otherwise by the Scope
// task rate — so the same room can take 12 minutes behind a walk-behind and
// 4 minutes on a rider, per the maker's published productivity.
import {
  type Rules, type SpaceLike, computeMinutes, isCarpet, requiredTasks, toClassicRoomTasks
} from "./rules";
import type { ClassicData, ClassicSpace, ClassicSchedule } from "./classicStore";

export const FLOORCARE_KEY = "opsmatrix_fusion_floorcare";

export interface FcEquip {
  label: string;            // "Tennant T7" / '36" dust mop' / custom name
  sqftPerHour: number;      // the scheduling rate in force for this schedule
  basis?: string;           // OEM practical / OEM max / custom…
}

export interface FcTech {
  key: string;              // "T1".."T4" — the role; printable without a name
  employeeId?: string;
  name?: string;            // display name when an employee is attached
}

export interface FcStop {
  spaceId: string;
  taskId: string;           // one of the five floor-care task ids
  techKey: string;          // which technician role runs this stop
}

export interface FcSchedule {
  id: string;
  name: string;
  shift: string;
  techs: FcTech[];
  /** taskId → the equipment selected for that task on THIS schedule */
  equipment: Record<string, FcEquip>;
  /** ordered — the order rooms/tasks were clicked is the running order */
  stops: FcStop[];
  /** the Max Schedules schedule this shipped to (edit redirects back here) */
  linkedScheduleId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FcProject {
  id: string;
  task: string;             // Carpet Extraction | Scrub | Scrub & Recoat | Strip & Refinish | Miscellaneous
  date: string;             // YYYY-MM-DD
  hours: number;            // estimated duration 1–8
  teamMembers: number;
  manHours: number;         // hours × teamMembers — recorded, not recomputed
  spaceId?: string;
  location?: string;        // display text for the picked room
  note?: string;
  noteId?: string;          // the Classic project note this created
  createdAt: string;
}

export interface FcStore { schedules: FcSchedule[]; projects: FcProject[] }

export const FC_PROJECT_TASKS = [
  "Carpet Extraction", "Scrub", "Scrub & Recoat", "Strip & Refinish", "Miscellaneous"
];

export function loadFloorCare(): FcStore {
  try {
    const parsed = JSON.parse(localStorage.getItem(FLOORCARE_KEY) ?? "{}") ?? {};
    return {
      schedules: Array.isArray(parsed.schedules) ? parsed.schedules : [],
      projects: Array.isArray(parsed.projects) ? parsed.projects : []
    };
  } catch {
    return { schedules: [], projects: [] };
  }
}

export function saveFloorCare(store: FcStore) {
  localStorage.setItem(FLOORCARE_KEY, JSON.stringify(store));
}

/** the five floor-care task rules, in Scope's order */
export function floorCareTasks(rules: Rules) {
  return rules.tasks.filter((t) => t.floorCare);
}

/**
 * Which rooms belong on the floor-care map/list: ONLY rooms whose required
 * task list carries floor-care work — because their room type comes with it
 * in Scope (corridors and hallways get Machine Scrubbing + Dust Mopping), or
 * because a manager added a floor-care task to that room in Max Space.
 * A carpet floor by itself is NOT a ticket in (Josh's rule, 2026-08-24):
 * carpeted offices don't belong to the floor crew unless someone says so.
 */
export function fcEligible(rules: Rules, space: SpaceLike): boolean {
  const fcIds = new Set(floorCareTasks(rules).map((t) => t.id));
  const notNeeded = new Set(space.fcNotNeeded ?? []);
  return requiredTasks(rules, space).some((id) => fcIds.has(id) && !notNeeded.has(id));
}

/** which of the five tasks make sense for one specific room */
export function fcTasksForSpace(rules: Rules, space: SpaceLike): string[] {
  const notNeeded = new Set(space.fcNotNeeded ?? []);
  const fcIds = floorCareTasks(rules).map((t) => t.id).filter((id) => !notNeeded.has(id));
  const required = new Set(requiredTasks(rules, space));
  const out = fcIds.filter((id) => required.has(id));
  if (isCarpet(space.floorType)) {
    if (!out.includes("machine-carpet") && !notNeeded.has("machine-carpet")) out.push("machine-carpet");
    // wet-scrub/burnish tasks don't apply to carpet
    return out.filter((id) => ["machine-carpet", "machine-sweep"].includes(id) || required.has(id));
  }
  // hard floors: every floor-care task except carpet cleaning is offerable
  return fcIds.filter((id) => id !== "machine-carpet");
}

// ── same work, with or without the machine — never schedule both ───────────
// Josh (2026-08-31): dust mopping and machine sweeping are the same pass;
// picking one eliminates the other for that room.
export const FC_EXCLUSIVE: Record<string, string> = {
  "dust-mop": "machine-sweep",
  "machine-sweep": "dust-mop"
};

/**
 * The tasks actually OFFERABLE for a room right now: what makes sense for it
 * (fcTasksForSpace, "does not need" respected) minus any task whose exclusive
 * twin is already booked for this room — on any floor-care schedule.
 */
export function fcOfferable(rules: Rules, space: SpaceLike, bookedTaskIds: Set<string>): string[] {
  return fcTasksForSpace(rules, space).filter((id) => {
    const twin = FC_EXCLUSIVE[id];
    return !(twin && bookedTaskIds.has(twin));
  });
}

// ── industry-realistic stop timing (recalibrated 2026-08-24, Josh's ask) ────
// A machine's published rate is squeegee-down cruising speed. Real stops also
// carry getting the machine to the room, doors, cones, cords/charge checks and
// edge work — and when a maker publishes only a MAXIMUM/theoretical figure,
// nobody schedules a crew at 100% of it. So every stop gets flat setup
// minutes, "maximum" rates are derated to a practical pace, and no machine
// stop is ever booked under a floor. All three knobs are named constants.

/** flat minutes added to every stop: reach the room, set up, edge, move on */
export const FC_SETUP_MINUTES = 2;
/** the floor: no room is entered, machined and left faster than this */
export const FC_MIN_STOP_MINUTES = 3;
/** OEM "maximum"/theoretical rates are scheduled at this practical fraction */
export const FC_PRACTICAL_FACTOR = 0.67;

/**
 * The sq ft/hr a stop is actually SCHEDULED at. Rates whose basis says
 * maximum/theoretical get the practical derate; rates already published as
 * practical (TASKI practical, ISSA dust-mop rates, custom entries) are used
 * as given.
 */
export function fcScheduledRate(eq: FcEquip): number {
  const theoretical = /max|theoretical/i.test(eq.basis ?? "");
  return eq.sqftPerHour * (theoretical ? FC_PRACTICAL_FACTOR : 1);
}

/**
 * Minutes for ONE stop. Equipment rate wins when the schedule carries
 * equipment for that task; the Scope task rate is the fallback. Either way
 * the stop includes setup minutes and never dips under the minimum — a
 * 60 sq ft office with a carpet machine is a real visit, not "1 minute".
 */
export function stopMinutes(rules: Rules, space: SpaceLike, taskId: string, equipment: Record<string, FcEquip>): number {
  const sqft = Number(space.squareFeet) || 0;
  const eq = equipment[taskId];
  const machineMin = eq && eq.sqftPerHour > 0
    ? sqft / (fcScheduledRate(eq) / 60)
    : computeMinutes(rules, space, { tasks: [taskId], includeBase: false }).total;
  return Math.max(FC_MIN_STOP_MINUTES, Math.round(machineMin + FC_SETUP_MINUTES));
}

export interface FcTiming {
  perTech: Record<string, number>;  // techKey → minutes
  total: number;                    // minutes (max per-tech when multi-tech? no — summed work; see below)
  longestTech: number;              // the slowest technician's minutes = wall-clock
}

/**
 * Timing for a whole floor-care schedule. Each technician's minutes are the
 * sum of their own stops; `total` is all labor minutes combined (man-time),
 * `longestTech` is the wall-clock length of the schedule (the slowest tech).
 */
export function fcTiming(rules: Rules, spaces: ClassicSpace[], fc: FcSchedule): FcTiming {
  const byId = new Map(spaces.map((s) => [s.id, s]));
  const perTech: Record<string, number> = {};
  for (const t of fc.techs) perTech[t.key] = 0;
  for (const stop of fc.stops) {
    const sp = byId.get(stop.spaceId);
    if (!sp) continue;
    const min = stopMinutes(rules, sp, stop.taskId, fc.equipment);
    perTech[stop.techKey] = (perTech[stop.techKey] ?? 0) + min;
  }
  const values = Object.values(perTech);
  return {
    perTech,
    total: values.reduce((s, v) => s + v, 0),
    longestTech: values.length ? Math.max(...values) : 0
  };
}

/**
 * The Max Schedules id a floor-care schedule ships to. Deterministic on
 * purpose: callers can know the link BEFORE the ship runs (React state
 * updaters run later than they look), so the floor-care store never saves
 * without its linkage.
 */
export function fcScheduleId(fc: FcSchedule): string {
  return fc.linkedScheduleId || "sched-fc-" + fc.id;
}

/**
 * Ship a confirmed floor-care schedule into Max Schedules as a finished
 * schedule. Coverage-true: each room's roomTasks are exactly the floor-care
 * tasks scheduled there (never the base clean — that belongs to the EVS
 * schedules), so the "Unassigned Tasks" report sees floor-care work as
 * covered. `floorCareId` marks it so Max Schedules redirects edits here,
 * and `floorCareMinutes` carries the equipment-priced total.
 */
export function shipToSchedules(data: ClassicData, rules: Rules, fc: FcSchedule): ClassicSchedule {
  const spaces = data.v7.spaces ?? [];
  const byId = new Map(spaces.map((s) => [s.id, s]));
  const order: string[] = [];
  const tasksByRoom: Record<string, string[]> = {};
  for (const stop of fc.stops) {
    if (!byId.has(stop.spaceId)) continue;
    if (!order.includes(stop.spaceId)) order.push(stop.spaceId);
    const list = tasksByRoom[stop.spaceId] ?? (tasksByRoom[stop.spaceId] = []);
    if (!list.includes(stop.taskId)) list.push(stop.taskId);
  }
  const roomTasks: Record<string, string[]> = {};
  for (const [spaceId, taskIds] of Object.entries(tasksByRoom)) {
    roomTasks[spaceId] = toClassicRoomTasks(byId.get(spaceId)!, taskIds, false);
  }
  const timing = fcTiming(rules, spaces, fc);
  const now = new Date().toISOString();

  const scheds = data.v7.schedules ?? (data.v7.schedules = []);
  const schedId = fcScheduleId(fc);
  let sched = scheds.find((s) => s.id === schedId);
  if (!sched) {
    sched = {
      id: schedId,
      num: String(101 + scheds.filter((s) => !s.projectNoteId).length),
      color: "#f59e0b",
      targetHours: 8,
      tasks: [], notes: "",
      createdAt: now
    } as ClassicSchedule;
    scheds.push(sched);
  }
  const lead = fc.techs.find((t) => t.employeeId);
  Object.assign(sched, {
    name: fc.name,
    shift: fc.shift,
    employeeId: lead?.employeeId ?? "",
    employee: fc.techs.length > 1
      ? fc.techs.length + " floor technicians"
      : (lead?.name ?? ""),
    spaceOrder: order,
    roomTasks,
    floorCareId: fc.id,
    floorCareMinutes: timing.total,
    updatedAt: now
  });
  fc.linkedScheduleId = schedId;
  return sched;
}

/** remove the shipped counterpart when a floor-care schedule is deleted */
export function unship(data: ClassicData, fc: FcSchedule) {
  if (!fc.linkedScheduleId) return;
  data.v7.schedules = (data.v7.schedules ?? []).filter((s) => s.id !== fc.linkedScheduleId);
}
