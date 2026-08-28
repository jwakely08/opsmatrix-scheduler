// Scope's per-section Save buttons (Josh, 2026-08-28): each section of the
// rulebook edits a shared DRAFT, but Save commits ONLY that section — hitting
// Save on Room types must never sneak in half-finished Space task edits.
// The one wrinkle: a room type's "automatic tasks" chips live ON the tasks
// (task.autoFor), so the Room types section owns autoFor while the Space
// tasks section owns everything else about a task.
import type { Rules } from "./rules";

export type ScopeSection = "general" | "roomTypes" | "tasks" | "nonSpace" | "breaks";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** the comparable slice a section owns */
function slice(r: Rules, section: ScopeSection): unknown {
  switch (section) {
    case "general": return r.general;
    case "roomTypes": return {
      types: r.roomTypes,
      autoFor: r.tasks.map((t) => [t.id, [...(t.autoFor ?? [])].sort()])
    };
    case "tasks": return r.tasks.map(({ autoFor: _a, ...rest }) => rest);
    case "nonSpace": return r.nonSpaceDefs;
    case "breaks": return r.breaks ?? [];
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
        return d ? { ...t, autoFor: clone(d.autoFor ?? []) } : t;
      });
      break;
    }
    case "tasks":
      // rates, labels, floor-care flags, additions and deletions — but each
      // surviving task keeps its SAVED autoFor (that's Room types' business)
      next.tasks = draft.tasks.map((t) => {
        const s = saved.tasks.find((x) => x.id === t.id);
        return { ...clone(t), autoFor: s ? clone(s.autoFor ?? []) : clone(t.autoFor ?? []) };
      });
      break;
    case "nonSpace":
      next.nonSpaceDefs = clone(draft.nonSpaceDefs);
      break;
    case "breaks":
      next.breaks = clone(draft.breaks ?? []);
      break;
  }
  return next;
}
