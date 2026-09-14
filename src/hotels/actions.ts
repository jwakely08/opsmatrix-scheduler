// The mutation layer. Every change to a room lands in THREE places at once:
// the space's status layers, the relevant queue (work order / assignment /
// inspection), and the day's report ledger. Screens and the capture engine
// both call these — there is exactly one way to change a room.
import {
  type HotelState, type Condition, type Occupancy, type WorkOrder, type Space, type LedgerEntry,
  type ReadyStep, type SignalSource, statusFor, emptyStatus, uid, nowIso, staffByName, displayNumber
} from "./store";

export type Ctx = { by: string; source: SignalSource; at?: string };

function ledger(state: HotelState, e: Omit<LedgerEntry, "id" | "at"> & { at?: string }): void {
  state.ledger.push({ id: uid("lg"), at: e.at ?? nowIso(), ...e });
}

function step(state: HotelState, sp: Space, s: ReadyStep["step"], by: string | undefined, at: string) {
  const st = ensure(state, sp.id);
  // a new dirty resets the path; anything else appends
  if (s === "dirty") st.readyPath = [{ step: "dirty", at }];
  else st.readyPath = [...st.readyPath.filter((x) => x.step !== s), { step: s, at, by }];
}

function ensure(state: HotelState, spaceId: string) {
  if (!state.status[spaceId]) state.status[spaceId] = emptyStatus(spaceId);
  return state.status[spaceId];
}

export function label(state: HotelState, sp: Space): string { return displayNumber(state, sp); }

export function setCondition(state: HotelState, sp: Space, value: Condition, ctx: Ctx, why?: string) {
  const at = ctx.at ?? nowIso();
  const st = ensure(state, sp.id);
  st.condition = { value, at, since: at, source: ctx.source, by: ctx.by };
  if (value === "dirty") { st.inspection = null; step(state, sp, "dirty", ctx.by, at); }
  if (value === "in_progress") step(state, sp, "clean", ctx.by, at);
  if (value === "clean") step(state, sp, "clean", ctx.by, at);
  if (value === "inspected") { step(state, sp, "inspect", ctx.by, at); step(state, sp, "ready", ctx.by, at); }
  // any condition set is a fresh signal; the override dies with a new condition
  st.override = null;
  const words: Record<Condition, string> = { dirty: "dirty", in_progress: "being cleaned", clean: "clean", inspected: "inspected — ready", pickup: "needs a pickup" };
  ledger(state, { at, by: ctx.by, spaceId: sp.id, kind: "set_condition", text: `${label(state, sp)} ${words[value]}${why ? " — " + why : ""}.` });
}

export function setOccupancy(state: HotelState, sp: Space, value: Occupancy, ctx: Ctx) {
  const at = ctx.at ?? nowIso();
  ensure(state, sp.id).occupancy = { value, at, source: ctx.source };
  ledger(state, { at, by: ctx.by, spaceId: sp.id, kind: "status", text: `${label(state, sp)} occupancy: ${value}.` });
}

/** re-confirm every signal on a room (a walk-by, a PMS heartbeat) */
export function confirmSignals(state: HotelState, sp: Space, ctx: Ctx) {
  const at = ctx.at ?? nowIso();
  const st = ensure(state, sp.id);
  if (st.condition) st.condition = { ...st.condition, at, source: ctx.source };
  if (st.occupancy) st.occupancy = { ...st.occupancy, at, source: ctx.source };
  st.engineering = { ...(st.engineering ?? { ooo: false }), at };
}

export function setOutOfOrder(state: HotelState, sp: Space, ooo: boolean, reason: string | undefined, ctx: Ctx) {
  const at = ctx.at ?? nowIso();
  const st = ensure(state, sp.id);
  st.engineering = { ooo, reason: ooo ? reason : undefined, at };
  if (ooo) step(state, sp, "repair", ctx.by, at);
  ledger(state, { at, by: ctx.by, spaceId: sp.id, kind: "status", text: ooo ? `${label(state, sp)} out of order${reason ? ": " + reason : ""}.` : `${label(state, sp)} back in order.` });
}

export function createWorkOrder(state: HotelState, sp: Space, text: string, category: WorkOrder["category"], ctx: Ctx, opts?: { blocking?: boolean; assignTo?: string }): WorkOrder {
  const at = ctx.at ?? nowIso();
  const assignee = opts?.assignTo ? staffByName(state, opts.assignTo) : state.staff.find((s) => s.role === "engineering");
  const wo: WorkOrder = { id: uid("wo"), spaceId: sp.id, text, category, blocking: Boolean(opts?.blocking), assignedTo: assignee?.id, status: "open", createdAt: at, createdBy: ctx.by };
  state.workOrders.push(wo);
  ensure(state, sp.id).engineering = { ...(state.status[sp.id].engineering ?? { ooo: false }), at };
  step(state, sp, "repair", assignee?.name, at);
  ledger(state, { at, by: ctx.by, spaceId: sp.id, kind: "create_work_order", failure: category, text: `${label(state, sp)} ${text} → work order → ${assignee ? assignee.name : "Engineering"}${wo.blocking ? " (blocks the room)" : ""}.` });
  return wo;
}

export function closeWorkOrder(state: HotelState, woId: string, ctx: Ctx) {
  const wo = state.workOrders.find((w) => w.id === woId);
  if (!wo) return;
  const at = ctx.at ?? nowIso();
  wo.status = "done"; wo.closedAt = at;
  const sp = state.spaces.find((s) => s.id === wo.spaceId);
  if (sp) ledger(state, { at, by: ctx.by, spaceId: sp.id, kind: "status", text: `${label(state, sp)} work order closed: ${wo.text}.` });
}

export function assign(state: HotelState, sp: Space, staffName: string, task: "departure" | "stayover" | "turndown" | "deep" | "inspect" | "repair" | "public", ctx: Ctx) {
  const at = ctx.at ?? nowIso();
  const who = staffByName(state, staffName);
  if (!who) return null;
  // one open assignment per room per task
  for (const a of state.assignments) if (a.spaceId === sp.id && a.task === task && !a.done) a.done = true;
  state.assignments.push({ id: uid("as"), spaceId: sp.id, staffId: who.id, task, at, by: ctx.by });
  ledger(state, { at, by: ctx.by, spaceId: sp.id, kind: "assign", text: `${label(state, sp)} assigned to ${who.name} — ${task}.` });
  return who;
}

export function inspect(state: HotelState, sp: Space, result: "pass" | "fail", notes: string | undefined, ctx: Ctx, photo?: string) {
  const at = ctx.at ?? nowIso();
  const st = ensure(state, sp.id);
  st.inspection = { result, at, by: ctx.by, notes, photo };
  if (result === "pass") {
    st.condition = { value: "inspected", at, since: at, source: ctx.source, by: ctx.by };
    step(state, sp, "inspect", ctx.by, at); step(state, sp, "ready", ctx.by, at);
    for (const a of state.assignments) if (a.spaceId === sp.id && a.task === "inspect" && !a.done) a.done = true;
    ledger(state, { at, by: ctx.by, spaceId: sp.id, kind: "inspect_pass", text: `${label(state, sp)} inspected — pass${notes ? " (" + notes + ")" : ""}.` });
  } else {
    st.condition = { value: "dirty", at, since: at, source: ctx.source, by: ctx.by };
    step(state, sp, "dirty", ctx.by, at);
    ledger(state, { at, by: ctx.by, spaceId: sp.id, kind: "inspect_fail", failure: "inspection", text: `${label(state, sp)} inspection FAILED${notes ? " — " + notes : ""}. Back to dirty.` });
  }
}

export function flag(state: HotelState, sp: Space, what: "do_not_walk" | "walk_ok" | "vip" | "not_vip", ctx: Ctx, why?: string) {
  const at = ctx.at ?? nowIso();
  // a flag on a suite member flags the whole suite
  const targets = sp.clusterId ? state.spaces.filter((x) => x.clusterId === sp.clusterId) : [sp];
  for (const t of targets) {
    const st = ensure(state, t.id);
    if (what === "do_not_walk") st.flags = { ...st.flags, doNotWalk: true, at };
    if (what === "walk_ok") st.flags = { ...st.flags, doNotWalk: false, at };
    if (what === "vip") st.flags = { ...st.flags, vip: true, at };
    if (what === "not_vip") st.flags = { ...st.flags, vip: false, at };
  }
  const text = what === "do_not_walk" ? `${label(state, sp)} pulled from arrivals — do not walk${why ? " (" + why + ")" : ""}.`
    : what === "walk_ok" ? `${label(state, sp)} cleared to walk again.`
    : what === "vip" ? `${label(state, sp)} flagged VIP.` : `${label(state, sp)} VIP flag removed.`;
  ledger(state, { at, by: ctx.by, spaceId: sp.id, kind: "flag", text });
}

export function note(state: HotelState, sp: Space | null, text: string, ctx: Ctx) {
  ledger(state, { at: ctx.at ?? nowIso(), by: ctx.by, spaceId: sp?.id, kind: "note", text: sp ? `${label(state, sp)} — ${text}` : text });
}

export function reportLine(state: HotelState, text: string, ctx: Ctx, sp?: Space | null) {
  ledger(state, { at: ctx.at ?? nowIso(), by: ctx.by, spaceId: sp?.id ?? undefined, kind: "report_line", text: sp ? `${label(state, sp)}: ${text}` : text });
}

/** GM override of a HOLD — logged with who, why, when. Never from the front desk (the UI gates it; the engine logs it). */
export function overrideHold(state: HotelState, sp: Space, reason: string, ctx: Ctx) {
  const at = ctx.at ?? nowIso();
  const st = ensure(state, sp.id);
  st.override = { level: "green", by: ctx.by, reason, at };
  ledger(state, { at, by: ctx.by, spaceId: sp.id, kind: "override", text: `${label(state, sp)} hold OVERRIDDEN by ${ctx.by}: ${reason}.` });
}

export function clearOverride(state: HotelState, sp: Space, ctx: Ctx) {
  const st = ensure(state, sp.id);
  if (!st.override) return;
  st.override = null;
  ledger(state, { at: ctx.at ?? nowIso(), by: ctx.by, spaceId: sp.id, kind: "override", text: `${label(state, sp)} override cleared.` });
}

export function setPromise(state: HotelState, sp: Space, promisedAt: string | undefined, guestCode: string | undefined, ctx: Ctx) {
  const at = ctx.at ?? nowIso();
  const targets = sp.clusterId ? state.spaces.filter((x) => x.clusterId === sp.clusterId) : [sp];
  for (const t of targets) {
    const st = ensure(state, t.id);
    st.flags = { ...st.flags, promisedAt, guestCode, at };
    st.occupancy = { value: promisedAt ? "arriving" : (st.occupancy?.value ?? "vacant"), at, source: ctx.source };
  }
}

export function statusCounts(state: HotelState) {
  const c = { dirty: 0, in_progress: 0, clean: 0, inspected: 0, pickup: 0, ooo: 0, unknown: 0 };
  for (const sp of state.spaces) {
    const t = state.roomTypes.find((x) => x.id === sp.typeId);
    if (t?.kind !== "guest") continue;
    const st = statusFor(state, sp.id);
    if (st.engineering?.ooo) c.ooo += 1;
    if (!st.condition) { c.unknown += 1; continue; }
    c[st.condition.value] += 1;
  }
  return c;
}
