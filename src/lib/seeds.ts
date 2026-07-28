// Seed content: starter rate table (editable estimates), common hospital room
// types, example shifts. NO PHI BY DESIGN — spaces and rates only.
import type { AppState, BaseRate, Frequency, Modifier, RoomTypeTemplate, Shift } from "./types";
import { uid } from "./types";

export function seedRoomTypes(): RoomTypeTemplate[] {
  return [
    { id: "rt_patient",  name: "Patient Room",      floorType: "VCT",          fixtures: 1, frequency: "7x", tasks: ["Daily clean", "High-touch disinfection"] },
    { id: "rt_restroom", name: "Restroom",          floorType: "Ceramic Tile", fixtures: 3, frequency: "7x", tasks: ["Daily clean", "Disinfect fixtures", "Restock"] },
    { id: "rt_office",   name: "Office",            floorType: "Carpet",       fixtures: 0, frequency: "5x", tasks: ["Daily clean"] },
    { id: "rt_corridor", name: "Corridor",          floorType: "VCT",          fixtures: 0, frequency: "7x", tasks: ["Dust mop + damp mop", "Spot clean"] },
    { id: "rt_or",       name: "Operating Room",    floorType: "Sheet Vinyl",  fixtures: 1, frequency: "7x", tasks: ["Terminal clean"] },
    { id: "rt_exam",     name: "Exam Room",         floorType: "VCT",          fixtures: 1, frequency: "5x", tasks: ["Daily clean", "High-touch disinfection"] },
    { id: "rt_lobby",    name: "Lobby / Waiting",   floorType: "VCT",          fixtures: 0, frequency: "7x", tasks: ["Daily clean", "Spot clean glass"] },
    { id: "rt_utility",  name: "Utility / Storage", floorType: "Concrete",     fixtures: 0, frequency: "1x", tasks: ["Weekly clean"] },
    { id: "rt_nursesta", name: "Nurse Station",     floorType: "VCT",          fixtures: 0, frequency: "7x", tasks: ["Daily clean", "High-touch disinfection"] },
    { id: "rt_breakrm",  name: "Break Room",        floorType: "VCT",          fixtures: 1, frequency: "7x", tasks: ["Daily clean"] }
  ];
}

export function seedFloorTypes(): string[] {
  return ["VCT", "Carpet", "Ceramic Tile", "Sheet Vinyl", "Rubber", "Terrazzo", "Concrete", "Epoxy"];
}

/** Editable estimates — ISSA-style production rates, minutes per 1,000 cleanable sq ft. */
export function seedBaseRates(): BaseRate[] {
  return [
    { id: uid("br"), roomType: "Patient Room",      floorType: "VCT",          minutesPer1000: 34 },
    { id: uid("br"), roomType: "Restroom",          floorType: "Ceramic Tile", minutesPer1000: 60 },
    { id: uid("br"), roomType: "Office",            floorType: "Carpet",       minutesPer1000: 22 },
    { id: uid("br"), roomType: "Corridor",          floorType: "VCT",          minutesPer1000: 12 },
    { id: uid("br"), roomType: "Operating Room",    floorType: "Sheet Vinyl",  minutesPer1000: 55 },
    { id: uid("br"), roomType: "Exam Room",         floorType: "VCT",          minutesPer1000: 30 },
    { id: uid("br"), roomType: "Lobby / Waiting",   floorType: "VCT",          minutesPer1000: 18 },
    { id: uid("br"), roomType: "Utility / Storage", floorType: "Concrete",     minutesPer1000: 10 },
    { id: uid("br"), roomType: "Nurse Station",     floorType: "VCT",          minutesPer1000: 26 },
    { id: uid("br"), roomType: "Break Room",        floorType: "VCT",          minutesPer1000: 24 },
    { id: uid("br"), roomType: "(any)",             floorType: "(any)",        minutesPer1000: 25 }
  ];
}

export function seedModifiers(): Modifier[] {
  return [
    { id: "mod_discharge", name: "Discharge / terminal clean multiplier",           kind: "multiplier", value: 1.5 },
    { id: "mod_isolation", name: "Isolation room multiplier",                       kind: "multiplier", value: 1.25 },
    { id: "mod_stripwax",  name: "Project: strip & wax (min / 1,000 sq ft)",        kind: "per1000",    value: 240 },
    { id: "mod_extract",   name: "Project: carpet extraction (min / 1,000 sq ft)",  kind: "per1000",    value: 90 }
  ];
}

export function seedFrequencies(): Frequency[] {
  return [
    { id: "7x", label: "7x / week (daily)", perWeek: 7 },
    { id: "6x", label: "6x / week", perWeek: 6 },
    { id: "5x", label: "5x / week (weekdays)", perWeek: 5 },
    { id: "3x", label: "3x / week", perWeek: 3 },
    { id: "2x", label: "2x / week", perWeek: 2 },
    { id: "1x", label: "Weekly", perWeek: 1 },
    { id: "bi", label: "Every other week", perWeek: 0.5 },
    { id: "mo", label: "Monthly", perWeek: 0.25 }
  ];
}

export function seedShifts(): Shift[] {
  return [
    { id: "sh_days", name: "Days", start: "07:00", end: "15:30" },
    { id: "sh_eves", name: "Evenings", start: "15:00", end: "23:30" }
  ];
}

export function defaultState(): AppState {
  return {
    version: 1,
    buildings: [],
    floors: [],
    rooms: [],
    jobs: [],
    shifts: seedShifts(),
    employees: [],
    rates: {
      baseRates: seedBaseRates(),
      fixtureMinutes: 3,
      modifiers: seedModifiers(),
      productiveMinutes: 420
    },
    roomTypes: seedRoomTypes(),
    floorTypes: seedFloorTypes(),
    frequencies: seedFrequencies(),
    ui: { view: "schedule", scope: null, expanded: {}, boardMode: "employee", mapFloorId: null, filters: {}, colorBy: "department" }
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
