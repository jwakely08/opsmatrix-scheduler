// Max Sanitation + Max Policing — the route engines (Josh's spec, 2026-08-31).
//
// MAX SANITATION: a soiled-utility collection route. On the building's map
// only soiled utility rooms are selectable; the manager drops a PIN on the
// sanitation dock, then clicks rooms in running order. Every leg is priced
// by real distance on the plan (the plan's own px-per-foot scale) at a
// walking pace, plus pickup minutes at each room and unload minutes back at
// the dock. Clicking the dock button mid-route inserts a return trip (cart
// full → unload → continue). The finished route SHIPS into Max Schedules.
//
// MAX POLICING (shell): the day-porter engine in the same vein — only
// lobbies, restrooms, waiting rooms and corridors are selectable, and only
// their NON-floor-care tasks are offered. Josh will grind the final spec;
// this is the working shell.
import {
  computeMinutes, typeIdFromLabelStrict, toClassicRoomTasks, type Rules, type SpaceLike
} from "./rules";
import {
  centroidOf,
  type ClassicData, type ClassicSchedule, type ClassicSpace
} from "./classicStore";

export const ROUTES_KEY = "opsmatrix_fusion_routes";

// ── sanitation timing constants (all honest estimates, named so they can be
// challenged): there is no published cart-route standard. Normal adult
// walking is ~264 ft/min (3 mph); pushing a collection cart through doors
// and past traffic runs slower, so the route is priced at 250 ft/min.
export const SAN_FT_PER_MIN = 250;
/** minutes at each soiled utility room: collect and load the cart */
export const SAN_PICKUP_MINUTES = 3;
/** minutes at the dock per return: unload everything */
export const SAN_UNLOAD_MINUTES = 4;

/** the sequence token for "return to the dock and unload" */
export const DOCK = "DOCK";

export interface SanRoute {
  id: string;
  name: string;
  shift: string;
  building: string;
  planId: string;
  /** the sanitation dock pin, in plan pixel coordinates */
  dock: { x: number; y: number } | null;
  /** running order: spaceIds, with DOCK tokens for mid-route unload returns */
  seq: string[];
  linkedScheduleId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PoliceStop { spaceId: string; taskId: string }

export interface PoliceRoute {
  id: string;
  name: string;
  shift: string;
  building: string;
  planId: string;
  stops: PoliceStop[];
  linkedScheduleId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RouteStore { sanitation: SanRoute[]; policing: PoliceRoute[] }

export function loadRoutes(): RouteStore {
  try {
    const parsed = JSON.parse(localStorage.getItem(ROUTES_KEY) ?? "{}") ?? {};
    return {
      sanitation: Array.isArray(parsed.sanitation) ? parsed.sanitation : [],
      policing: Array.isArray(parsed.policing) ? parsed.policing : []
    };
  } catch {
    return { sanitation: [], policing: [] };
  }
}

export function saveRoutes(store: RouteStore) {
  localStorage.setItem(ROUTES_KEY, JSON.stringify(store));
}

// ── who is selectable ───────────────────────────────────────────────────────

/** Max Sanitation's rooms: soiled utility / soiled hold rooms only */
export function isSoiledUtility(sp: SpaceLike & { roomName?: unknown; roomNumber?: unknown }): boolean {
  return /soil/i.test(String(sp.roomName ?? "")) || /soil/i.test(String(sp.roomType ?? ""));
}

/** Max Policing's rooms: lobbies, restrooms, waiting rooms, corridors */
const POLICE_TYPES = new Set(["lobby", "restroom", "waiting-room", "corridor", "hallway"]);

export function isPoliceable(rules: Rules, sp: SpaceLike): boolean {
  const tid = typeIdFromLabelStrict(rules, sp.roomType as string | undefined);
  return tid !== null && POLICE_TYPES.has(tid);
}

/** the tasks a porter can carry on a policing pass: never floor care */
export function policeTasks(rules: Rules): string[] {
  return rules.tasks.filter((t) => t.addable && !t.floorCare).map((t) => t.id);
}

/** minutes for one policing pass of one task in one room (never under 2) */
export function policeStopMinutes(rules: Rules, sp: SpaceLike, taskId: string): number {
  return Math.max(2, computeMinutes(rules, sp, { tasks: [taskId], includeBase: false }).total);
}

// ── sanitation timing ───────────────────────────────────────────────────────

export interface SanLeg {
  /** display labels of the two endpoints */
  from: string;
  to: string;
  feet: number | null;      // null = the plan has no scale
  minutes: number;          // travel only (0 when feet is null)
  /** service minutes AT the destination (pickup or unload) */
  serviceMinutes: number;
}

export interface SanTiming {
  legs: SanLeg[];
  travelMinutes: number;
  serviceMinutes: number;
  total: number;
  /** true when the plan carries no px-per-foot scale — travel unpriceable */
  unscaled: boolean;
}

function roomPoint(sp: ClassicSpace): { x: number; y: number } | null {
  const pts = sp.visualPts;
  if (!pts || pts.length < 3) return null;
  return centroidOf(pts);
}

/**
 * Price a sanitation route: dock → each entry in order → back to the dock.
 * The final return is implicit — a route always ends unloading at the dock.
 * Distances are centroid-to-centroid straight lines on the plan, converted
 * through the plan's own ratio (px per foot).
 */
export function sanTiming(
  plan: { ratio?: unknown } | null,
  spaces: ClassicSpace[],
  route: Pick<SanRoute, "dock" | "seq">
): SanTiming {
  const byId = new Map(spaces.map((s) => [s.id, s]));
  const ratio = Number(plan?.ratio) > 0 ? Number(plan?.ratio) : null;
  const legs: SanLeg[] = [];
  let unscaled = false;

  const labelOf = (tok: string): string => {
    if (tok === DOCK) return "Dock";
    const sp = byId.get(tok);
    return String(sp?.roomNumber ?? sp?.roomName ?? "?");
  };
  const pointOf = (tok: string): { x: number; y: number } | null => {
    if (tok === DOCK) return route.dock;
    const sp = byId.get(tok);
    return sp ? roomPoint(sp) : null;
  };

  // the walked sequence, dock at both ends (no double dock when the manager
  // already ended the route with a return)
  const seq = [DOCK, ...route.seq];
  if (seq[seq.length - 1] !== DOCK) seq.push(DOCK);

  for (let i = 1; i < seq.length; i++) {
    const a = pointOf(seq[i - 1]);
    const b = pointOf(seq[i]);
    let feet: number | null = null;
    let minutes = 0;
    if (a && b && ratio) {
      feet = Math.round(Math.hypot(b.x - a.x, b.y - a.y) / ratio);
      minutes = feet / SAN_FT_PER_MIN;
    } else if (a && b && !ratio) {
      unscaled = true;
    }
    legs.push({
      from: labelOf(seq[i - 1]),
      to: labelOf(seq[i]),
      feet,
      minutes,
      serviceMinutes: seq[i] === DOCK ? SAN_UNLOAD_MINUTES : SAN_PICKUP_MINUTES
    });
  }
  // an empty route is a walk to nowhere: no legs, no minutes
  if (route.seq.length === 0) legs.length = 0;

  const travelMinutes = legs.reduce((s, l) => s + l.minutes, 0);
  const serviceMinutes = legs.reduce((s, l) => s + l.serviceMinutes, 0);
  return {
    legs,
    travelMinutes,
    serviceMinutes,
    total: Math.round(travelMinutes + serviceMinutes),
    unscaled
  };
}

// ── shipping to Max Schedules ───────────────────────────────────────────────
// Same canonical stores as Max Floor Care's ship: the route becomes a real
// schedule (prints, reports, counts toward hours) marked routeOnly so it
// never reads as cleaning coverage, with per-stop minutes carried for the
// printed running order.

export function sanScheduleId(route: SanRoute): string {
  return route.linkedScheduleId || "sched-san-" + route.id;
}

export function policeScheduleId(route: PoliceRoute): string {
  return route.linkedScheduleId || "sched-pol-" + route.id;
}

function upsertRouteSchedule(
  data: ClassicData,
  schedId: string,
  fields: Record<string, unknown>
): ClassicSchedule {
  const scheds = data.v7.schedules ?? (data.v7.schedules = []);
  let sched = scheds.find((s) => s.id === schedId);
  const now = new Date().toISOString();
  if (!sched) {
    sched = {
      id: schedId,
      num: String(101 + scheds.filter((s) => !s.projectNoteId).length),
      targetHours: 8, tasks: [], notes: "", roomTasks: {},
      createdAt: now
    } as ClassicSchedule;
    scheds.push(sched);
  }
  Object.assign(sched, fields, { updatedAt: now });
  return sched;
}

export function shipSanitation(data: ClassicData, plan: { ratio?: unknown } | null, route: SanRoute): ClassicSchedule {
  const spaces = data.v7.spaces ?? [];
  const t = sanTiming(plan, spaces, route);
  const order = [...new Set(route.seq.filter((x) => x !== DOCK))];
  // per-room minutes for the printed running order: the leg INTO the room
  // plus its pickup (dock returns fold into the route total)
  const stopMinutes: Record<string, number> = {};
  let li = 0;
  const seq = [DOCK, ...route.seq];
  if (seq[seq.length - 1] !== DOCK) seq.push(DOCK);
  for (let i = 1; i < seq.length; i++, li++) {
    const tok = seq[i];
    const leg = t.legs[li];
    if (!leg || tok === DOCK) continue;
    stopMinutes[tok] = (stopMinutes[tok] ?? 0) + Math.round(leg.minutes + leg.serviceMinutes);
  }
  const sched = upsertRouteSchedule(data, sanScheduleId(route), {
    name: route.name,
    shift: route.shift,
    color: "#06b6d4",
    employee: "Sanitation route",
    spaceOrder: order,
    roomTasks: {},
    routeOnly: true,
    sanitationId: route.id,
    fixedMinutes: t.total,
    routeStopMinutes: stopMinutes
  });
  route.linkedScheduleId = sched.id;
  return sched;
}

export function shipPolicing(data: ClassicData, rules: Rules, route: PoliceRoute): ClassicSchedule {
  const spaces = data.v7.spaces ?? [];
  const byId = new Map(spaces.map((s) => [s.id, s]));
  const order: string[] = [];
  const tasksByRoom: Record<string, string[]> = {};
  const stopMinutes: Record<string, number> = {};
  let total = 0;
  for (const stop of route.stops) {
    const sp = byId.get(stop.spaceId);
    if (!sp) continue;
    if (!order.includes(stop.spaceId)) order.push(stop.spaceId);
    const list = tasksByRoom[stop.spaceId] ?? (tasksByRoom[stop.spaceId] = []);
    if (!list.includes(stop.taskId)) list.push(stop.taskId);
    const m = policeStopMinutes(rules, sp, stop.taskId);
    stopMinutes[stop.spaceId] = (stopMinutes[stop.spaceId] ?? 0) + m;
    total += m;
  }
  const roomTasks: Record<string, string[]> = {};
  for (const [spaceId, taskIds] of Object.entries(tasksByRoom)) {
    roomTasks[spaceId] = toClassicRoomTasks(byId.get(spaceId)!, taskIds, false);
  }
  const sched = upsertRouteSchedule(data, policeScheduleId(route), {
    name: route.name,
    shift: route.shift,
    color: "#8b5cf6",
    employee: "Day porter",
    spaceOrder: order,
    roomTasks,
    routeOnly: true,
    policingId: route.id,
    fixedMinutes: Math.round(total),
    routeStopMinutes: stopMinutes
  });
  route.linkedScheduleId = sched.id;
  return sched;
}

/** remove the shipped counterpart when a route is deleted */
export function unshipRoute(data: ClassicData, route: { linkedScheduleId?: string }) {
  if (!route.linkedScheduleId) return;
  data.v7.schedules = (data.v7.schedules ?? []).filter((s) => s.id !== route.linkedScheduleId);
}
