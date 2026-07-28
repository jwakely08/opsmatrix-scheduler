// Migrates any saved state (v1 matrix-rates model, or partial v2) to the
// current v2 shape, so Josh's imported building survives the rates overhaul.
import type { AppState, Room } from "./types";
import { defaultState, ensureDepartment, finishFromLegacyFloorType, nextColor, seedRoomTypes } from "./seeds";
import { uid } from "./types";

export function migrateState(parsed: any): AppState {
  const def = defaultState();
  if (!parsed || typeof parsed !== "object") return def;

  const isV1 = !parsed.version || parsed.version < 2 || (parsed.rates && Array.isArray(parsed.rates.baseRates));

  const state: AppState = {
    ...def,
    ...parsed,
    version: 2,
    rates: isV1 ? def.rates : { ...def.rates, ...(parsed.rates ?? {}) },
    ui: { ...def.ui, ...(parsed.ui ?? {}) }
  };
  // drop v1-only ui key, ensure new one exists
  (state.ui as any).colorBy = undefined;
  if (state.ui.mapColorBy !== "schedule" && state.ui.mapColorBy !== "department") {
    state.ui.mapColorBy = "department";
  }

  if (isV1) {
    // plain-language frequency labels (same ids and perWeek values as v1)
    state.frequencies = def.frequencies;
    // room types: fresh v2 templates (qualifiers tuned to approximate the old
    // matrix numbers), keeping any custom template names as simple types
    const seeded = seedRoomTypes();
    const oldTemplates: any[] = Array.isArray(parsed.roomTypes) ? parsed.roomTypes : [];
    state.roomTypes = seeded;
    for (const old of oldTemplates) {
      if (!seeded.some((t) => t.id === old.id || t.name === old.name)) {
        state.roomTypes.push({
          id: old.id || uid("rt"),
          name: old.name || "Custom type",
          floorFinish: finishFromLegacyFloorType(old.floorType || ""),
          fixtures: old.fixtures || 0,
          frequency: old.frequency || "7x",
          tasks: Array.isArray(old.tasks) ? old.tasks : ["Daily clean"],
          qualifiers: []
        });
      }
    }
    // carry over the v1 scalars that still exist
    if (parsed.rates) {
      if (typeof parsed.rates.productiveMinutes === "number") {
        state.rates.productiveMinutes = parsed.rates.productiveMinutes;
      }
      if (Array.isArray(parsed.rates.modifiers) && parsed.rates.modifiers.length) {
        state.rates.modifiers = parsed.rates.modifiers;
      }
    }
    // rooms: floorType (free text) → one of the three finishes
    state.rooms = (parsed.rooms ?? []).map((r: any): Room => ({
      ...r,
      floorFinish: r.floorFinish ?? finishFromLegacyFloorType(r.floorType ?? ""),
      tasks: Array.isArray(r.tasks) ? r.tasks : []
    }));
  }

  // shifts: guarantee colors
  const usedShiftColors: string[] = [];
  state.shifts = (state.shifts ?? []).map((s: any) => {
    const color = s.color || nextColor(usedShiftColors);
    usedShiftColors.push(color);
    return { ...s, color };
  });

  // departments: guarantee an entry (with color) for every department in use
  if (!Array.isArray(state.departments)) state.departments = [];
  for (const r of state.rooms) ensureDepartment(state, r.department || "Unassigned");

  return state;
}
