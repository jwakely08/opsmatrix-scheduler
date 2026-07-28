// Seed content: starting numbers you can adjust (industry-typical, ISSA-style
// estimates), common hospital room types, and two example shifts.
// NO PHI BY DESIGN — spaces and rates only.
import type {
  AppState, Frequency, Modifier, Qualifier, RoomTypeTemplate, Shift, Department, FloorFinish
} from "./types";
import { uid } from "./types";

/** Pleasant, distinct colors handed out to departments (and custom shifts) in order. */
export const COLOR_PALETTE = [
  "#0f6b62", // teal
  "#d98e1f", // amber
  "#3f6fb5", // blue
  "#b5533f", // brick
  "#7a4fb0", // violet
  "#2e8f63", // green
  "#b03f7e", // magenta
  "#8a7a1f", // olive
  "#3fa3b5", // cyan
  "#c26b34", // orange
  "#5b7083", // slate
  "#946bc2"  // lavender
];

export function nextColor(used: string[]): string {
  for (const c of COLOR_PALETTE) if (!used.includes(c)) return c;
  return COLOR_PALETTE[used.length % COLOR_PALETTE.length];
}

/** Make sure a department exists (rooms reference departments by name). */
export function ensureDepartment(state: AppState, name: string): Department {
  const found = state.departments.find((d) => d.name.toLowerCase() === name.toLowerCase());
  if (found) return found;
  const dept: Department = { name, color: nextColor(state.departments.map((d) => d.color)) };
  state.departments.push(dept);
  return dept;
}

// Reusable qualifier presets — the checklist shown when building a custom room type.
export function qualifierPresets(): Qualifier[] {
  return [
    { id: "q_hightouch", label: "Extra care for high-touch surfaces", kind: "per1000", value: 12 },
    { id: "q_deepclean", label: "Deeper cleaning & disinfecting", kind: "per1000", value: 25 },
    { id: "q_fixture", label: "Extra time per restroom fixture", kind: "perFixture", value: 3 },
    { id: "q_terminal", label: "Terminal-clean intensity (ORs)", kind: "per1000", value: 40 },
    { id: "q_kitchen", label: "Kitchen / food surfaces", kind: "per1000", value: 8 },
    { id: "q_glass", label: "Glass spot-cleaning", kind: "flatPerVisit", value: 2 },
    { id: "q_equipment", label: "Big open area — machine does most of it", kind: "multiplier", value: 0.6 },
    { id: "q_lightduty", label: "Light duty — quick once-over", kind: "multiplier", value: 0.8 }
  ];
}

function q(id: string, value?: number): Qualifier {
  const preset = qualifierPresets().find((p) => p.id === id)!;
  return { ...preset, id: uid("q"), value: value ?? preset.value };
}

export function seedRoomTypes(): RoomTypeTemplate[] {
  return [
    { id: "rt_patient",  name: "Patient Room",      floorFinish: "hard",   fixtures: 1, frequency: "7x", tasks: ["Daily clean", "High-touch wipe-down"], qualifiers: [q("q_hightouch"), q("q_fixture")] },
    { id: "rt_restroom", name: "Restroom",          floorFinish: "hard",   fixtures: 3, frequency: "7x", tasks: ["Clean & disinfect", "Restock supplies"], qualifiers: [q("q_deepclean"), q("q_fixture")] },
    { id: "rt_office",   name: "Office",            floorFinish: "carpet", fixtures: 0, frequency: "5x", tasks: ["Light clean"], qualifiers: [q("q_lightduty")] },
    { id: "rt_corridor", name: "Corridor",          floorFinish: "hard",   fixtures: 0, frequency: "7x", tasks: ["Dust & damp mop"], qualifiers: [q("q_equipment")] },
    { id: "rt_or",       name: "Operating Room",    floorFinish: "hard",   fixtures: 1, frequency: "7x", tasks: ["Terminal clean"], qualifiers: [q("q_terminal"), q("q_fixture")] },
    { id: "rt_exam",     name: "Exam Room",         floorFinish: "hard",   fixtures: 1, frequency: "5x", tasks: ["Daily clean", "High-touch wipe-down"], qualifiers: [q("q_hightouch"), q("q_fixture")] },
    { id: "rt_lobby",    name: "Lobby / Waiting",   floorFinish: "hard",   fixtures: 0, frequency: "7x", tasks: ["Daily clean", "Glass spot-clean"], qualifiers: [q("q_glass")] },
    { id: "rt_utility",  name: "Utility / Storage", floorFinish: "other",  fixtures: 0, frequency: "1x", tasks: ["Weekly clean"], qualifiers: [q("q_lightduty", 0.7)] },
    { id: "rt_nursesta", name: "Nurse Station",     floorFinish: "hard",   fixtures: 0, frequency: "7x", tasks: ["Daily clean", "High-touch wipe-down"], qualifiers: [q("q_hightouch", 10)] },
    { id: "rt_breakrm",  name: "Break Room",        floorFinish: "hard",   fixtures: 1, frequency: "7x", tasks: ["Daily clean"], qualifiers: [q("q_kitchen"), q("q_fixture")] }
  ];
}

export function seedModifiers(): Modifier[] {
  return [
    { id: "mod_discharge", name: "Discharge / terminal clean multiplier",          kind: "multiplier", value: 1.5 },
    { id: "mod_isolation", name: "Isolation room multiplier",                      kind: "multiplier", value: 1.25 },
    { id: "mod_stripwax",  name: "Project: strip & wax (min / 1,000 sq ft)",       kind: "per1000",    value: 240 },
    { id: "mod_extract",   name: "Project: carpet extraction (min / 1,000 sq ft)", kind: "per1000",    value: 90 }
  ];
}

export function seedFrequencies(): Frequency[] {
  return [
    { id: "7x", label: "Every day", perWeek: 7 },
    { id: "6x", label: "6 days a week", perWeek: 6 },
    { id: "5x", label: "Weekdays only", perWeek: 5 },
    { id: "3x", label: "3 days a week", perWeek: 3 },
    { id: "2x", label: "2 days a week", perWeek: 2 },
    { id: "1x", label: "Once a week", perWeek: 1 },
    { id: "bi", label: "Every other week", perWeek: 0.5 },
    { id: "mo", label: "Once a month", perWeek: 0.25 }
  ];
}

export function seedShifts(): Shift[] {
  return [
    { id: "sh_days", name: "Days", start: "07:00", end: "15:30", color: "#3f6fb5" },
    { id: "sh_eves", name: "Evenings", start: "15:00", end: "23:30", color: "#7a4fb0" }
  ];
}

export function defaultState(): AppState {
  return {
    version: 2,
    buildings: [],
    floors: [],
    rooms: [],
    jobs: [],
    shifts: seedShifts(),
    employees: [],
    rates: {
      baseMinutesPer1000: 15,
      floorFinishAdjust: { hard: 0, other: 3, carpet: 6 },
      modifiers: seedModifiers(),
      productiveMinutes: 420
    },
    roomTypes: seedRoomTypes(),
    departments: [],
    frequencies: seedFrequencies(),
    ui: {
      view: "schedule", scope: null, expanded: {}, boardMode: "employee",
      mapFloorId: null, filters: {}, mapColorBy: "department"
    }
  };
}

export function guessRoomType(name: string): string {
  const n = name.toLowerCase();
  const map: [string, string][] = [
    ["bath", "rt_restroom"], ["restroom", "rt_restroom"], ["toilet", "rt_restroom"], ["wc", "rt_restroom"],
    ["patient", "rt_patient"], ["bed", "rt_patient"],
    ["office", "rt_office"], ["admin", "rt_office"],
    ["corridor", "rt_corridor"], ["hall", "rt_corridor"],
    ["or ", "rt_or"], ["operating", "rt_or"], ["surgery", "rt_or"],
    ["exam", "rt_exam"],
    ["lobby", "rt_lobby"], ["waiting", "rt_lobby"], ["reception", "rt_lobby"],
    ["util", "rt_utility"], ["storage", "rt_utility"], ["closet", "rt_utility"], ["mech", "rt_utility"],
    ["nurse", "rt_nursesta"], ["station", "rt_nursesta"],
    ["break", "rt_breakrm"], ["lounge", "rt_breakrm"], ["kitchen", "rt_breakrm"]
  ];
  for (const [needle, rt] of map) if (n.indexOf(needle) !== -1) return rt;
  return "";
}

/** Map an old (v1) free-text floor type onto the three finishes. */
export function finishFromLegacyFloorType(floorType: string): FloorFinish {
  const t = (floorType || "").toLowerCase();
  if (t.includes("carpet")) return "carpet";
  if (["vct", "sheet vinyl", "ceramic tile", "tile", "terrazzo", "rubber", "epoxy", "vinyl"].some((k) => t.includes(k))) return "hard";
  return "other";
}
