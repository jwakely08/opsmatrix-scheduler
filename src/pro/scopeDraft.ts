// Scope's per-section Save buttons (Josh, 2026-08-28): each section of the
// rulebook edits a shared DRAFT, but Save commits ONLY that section — hitting
// Save on Room types must never sneak in half-finished Space task edits.
// The one wrinkle: a room type's "automatic tasks" chips live ON the tasks
// (task.autoFor, and how often each runs there: task.frequencyFor), so the
// Room types section owns those while the Space tasks section owns
// everything else about a task.
import type { Rules } from "./rules";

export type ScopeSection = "general" | "roomTypes" | "tasks" | "nonSpace" | "breaks" | "procedure";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const sortedFreq = (f: Record<string, string> | undefined) =>
  Object.entries(f ?? {}).sort(([a], [b]) => a.localeCompare(b));

/** the comparable slice a section owns */
function slice(r: Rules, section: ScopeSection): unknown {
  switch (section) {
    case "general": return r.general;
    case "roomTypes": return {
      types: r.roomTypes,
      autoFor: r.tasks.map((t) => [t.id, [...(t.autoFor ?? [])].sort(), sortedFreq(t.frequencyFor)])
    };
    case "tasks": return r.tasks.map(({ autoFor: _a, frequencyFor: _f, ...rest }) => rest);
    case "nonSpace": return { defs: r.nonSpaceDefs, quals: r.nonSpaceQualifiers ?? [] };
    case "breaks": return { breaks: r.breaks ?? [], schedules: r.breakSchedules ?? [] };
    case "procedure": return r.procedure ?? null;
  }
}

export function sectionDirty(saved: Rules, draft: Rules, section: ScopeSection): boolean {
  return JSON.stringify(slice(saved, section)) !== JSON.stringify(slice(draft, section));
}

/** commit ONE section of the draft onto the saved rules; everything else
 *  keeps its saved state (other sections' unsaved edits stay unsaved) */
export function saveSection(saved: Rules, draft: Rules, section: ScopeSection): Rules {
  const next = clone(saved);
  switch (section) {
    case "general":
      next.general = clone(draft.general);
      break;
    case "roomTypes": {
      next.roomTypes = clone(draft.roomTypes);
      // autoFor belongs to this section — but only for tasks that exist in
      // BOTH: an unsaved new/deleted task stays the Space tasks section's call
      next.tasks = next.tasks.map((t) => {
        const d = draft.tasks.find((x) => x.id === t.id);
        if (!d) return t;
        const out = { ...t, autoFor: clone(d.autoFor ?? []) };
        if (d.frequencyFor && Object.keys(d.frequencyFor).length) out.frequencyFor = clone(d.frequencyFor);
        else delete out.frequencyFor;
        return out;
      });
      break;
    }
    case "tasks":
      // rates, labels, floor-care flags, additions and deletions — but each
      // surviving task keeps its SAVED autoFor and per-type frequencies
      // (that's Room types' business)
      next.tasks = draft.tasks.map((t) => {
        const s = saved.tasks.find((x) => x.id === t.id);
        const out = { ...clone(t), autoFor: s ? clone(s.autoFor ?? []) : clone(t.autoFor ?? []) };
        const freq = s ? s.frequencyFor : t.frequencyFor;
        if (freq && Object.keys(freq).length) out.frequencyFor = clone(freq);
        else delete out.frequencyFor;
        return out;
      });
      break;
    case "nonSpace":
      next.nonSpaceDefs = clone(draft.nonSpaceDefs);
      next.nonSpaceQualifiers = clone(draft.nonSpaceQualifiers ?? []);
      break;
    case "breaks":
      next.breaks = clone(draft.breaks ?? []);
      next.breakSchedules = clone(draft.breakSchedules ?? []);
      break;
    case "procedure":
      next.procedure = clone(draft.procedure);
      break;
  }
  return next;
}

/** one room type's own slice — its card in Scope saves just this */
function typeSlice(r: Rules, typeId: string): unknown {
  return {
    type: r.roomTypes.find((t) => t.id === typeId) ?? null,
    autoFor: r.tasks.filter((t) => (t.autoFor ?? []).includes(typeId))
      .map((t) => `${t.id}@${t.frequencyFor?.[typeId] ?? ""}`).sort()
  };
}

export function roomTypeDirty(saved: Rules, draft: Rules, typeId: string): boolean {
  return JSON.stringify(typeSlice(saved, typeId)) !== JSON.stringify(typeSlice(draft, typeId));
}

/**
 * Commit ONE room type's card (formula, included tasks, name, frequency,
 * its automatic extras) — every other unsaved edit stays a draft. A type
 * that is new in the draft (a duplicate) lands at its draft position.
 */
export function saveRoomType(saved: Rules, draft: Rules, typeId: string): Rules {
  const next = clone(saved);
  const d = draft.roomTypes.find((t) => t.id === typeId);
  const at = next.roomTypes.findIndex((t) => t.id === typeId);
  if (!d) {
    if (at >= 0) next.roomTypes.splice(at, 1);
  } else if (at >= 0) {
    next.roomTypes[at] = clone(d);
  } else {
    const prevId = draft.roomTypes[draft.roomTypes.findIndex((t) => t.id === typeId) - 1]?.id;
    const after = next.roomTypes.findIndex((t) => t.id === prevId);
    next.roomTypes.splice(after + 1, 0, clone(d));
  }
  for (const t of next.tasks) {
    const dt = draft.tasks.find((x) => x.id === t.id);
    const wants = Boolean(dt && (dt.autoFor ?? []).includes(typeId));
    const has = (t.autoFor ?? []).includes(typeId);
    if (wants && !has) t.autoFor = [...(t.autoFor ?? []), typeId];
    if (!wants && has) t.autoFor = t.autoFor.filter((x) => x !== typeId);
    // how often it runs on this type travels with the chip
    const freq = wants ? dt?.frequencyFor?.[typeId] : undefined;
    const map = { ...(t.frequencyFor ?? {}) };
    if (freq) map[typeId] = freq; else delete map[typeId];
    if (Object.keys(map).length) t.frequencyFor = map; else delete t.frequencyFor;
  }
  return next;
}
