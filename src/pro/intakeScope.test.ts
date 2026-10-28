import { describe, expect, it } from "vitest";
import { IntakeError, intakeFrequency, intakeToScope, readIntake, type IntakeData } from "./intakeScope";
import { computeMinutes, defaultRules, freqPerWeek, weeklyMinutes, type Rules } from "./rules";

// a made-up hospital, answered the way the Rediscover Clean intake saves its answers
const intake: IntakeData = {
  form: "Rediscover Clean EVS Intake",
  version: 1,
  saved_at: "2026-10-01T12:00:00.000Z",
  fields: {
    facility_name: "Test General", health_system: "TGH", gross_sqft: "250000", floors: "4", buildings: "1",
    licensed_beds: "120", completed_date: "2026-10-01", discharge_turn_min: "50", dc_per_day: "30", travel_min: "6",
    mopping_in_routine: "Yes", vacuuming_in_routine: "Yes", leads: "1", supervisors: "2", facility_type: "Other",
    c1_name: "Pat Example", c1_email: "pat@example.org"
  },
  tables: {
    Rates: [{ area: "Other: All cleaning tasks", rate: "0.5", unit: "Other: per sq ft" }],
    Rooms: [
      { room_type: "Patient room", count: "100", frequency: "7x per week", shifts: "1st; Weekends", special: "No" },
      { room_type: "ICU / critical care room", count: "", frequency: "7x per week", shifts: "1st; Weekends", special: "Yes" },
      { room_type: "Emergency department bay", count: "", frequency: "As needed / on request", shifts: "", special: "No" },
      { room_type: "Exam room", count: "", frequency: "5x per week", shifts: "2nd", special: "No" },
      { room_type: "Hybrid OR", count: "", frequency: "", shifts: "", special: "" },
      { room_type: "Public restroom", count: "", frequency: "7x per week", shifts: "1st; 2nd; 3rd", special: "No" },
      { room_type: "Staff restroom", count: "", frequency: "5x per week", shifts: "1st", special: "No" },
      { room_type: "Corridor / hallway", count: "", frequency: "7x per week", shifts: "1st", special: "No" },
      { room_type: "Office", count: "", frequency: "4x per week", shifts: "2nd", special: "No" },
      { room_type: "Storage room", count: "", frequency: "As needed / on request", shifts: "", special: "" },
      { room_type: "Other: Cardiac rehab gym", count: "", frequency: "3x per week", shifts: "2nd", special: "No" }
    ],
    GenTasks: [{ task: "High dusting" }, { task: "Trash pull" }, { task: "Damp wiping surfaces" }, { task: "Dust mopping" }, { task: "Damp mopping" }],
    ExtraTasks: [{ task: "Curtain change", frequency: "" }, { task: "Burnishing", frequency: "3x per week" }],
    HardFloor: [
      { area: "Corridors / hallways", task: "Auto-scrubbing", days: "7", shift: "1st shift" },
      { area: "Corridors / hallways", task: "Other: Scrub, buff, or burnish", days: "5", shift: "1st shift" },
      { area: "Patient rooms", task: "Other: dust mop and damp mop", days: "7", shift: "1st shift" },
      { area: "Patient rooms", task: "Burnishing", days: "3", shift: "1st shift" }
    ],
    Carpet: [
      { area: "Offices", task: "Vacuuming", days: "2", shift: "1st shift" },
      { area: "All areas", task: "Extraction", days: "1", shift: "2nd shift" }
    ],
    Shifts: [
      { shift: "1st shift", start: "7:00 AM", end: "3:30 PM", days: "Monday–Sunday" },
      { shift: "2nd shift", start: "3:00 PM", end: "11:30 PM", days: "Monday–Sunday" }
    ],
    Breaks: [
      { shift: "1st shift", type: "Break", start: "9:00 AM", minutes: "15", paid: "Yes" },
      { shift: "1st shift", type: "Lunch", start: "11:30 AM", minutes: "30", paid: "No" },
      { shift: "1st shift", type: "Break", start: "1:30 PM", minutes: "15", paid: "Yes" },
      { shift: "2nd shift", type: "Lunch", start: "7:00 PM", minutes: "30", paid: "No" }
    ],
    DcShift: [{ shift: "1st shift", avg: "20" }, { shift: "2nd shift", avg: "10" }],
    Fte: [{ position: "EVS housekeeper / technician", fte: "40" }],
    Scope: [
      { service: "Bed and mattress cleaning", handles: "Yes", notes: "" },
      { service: "Pest control / exterminating", handles: "Partial", notes: "vendor" },
      { service: "Grounds policing", handles: "No", notes: "" }
    ],
    Between: [{ area: "Emergency department exam rooms", between: "Yes", stretchers: "Yes" }, { area: "Operating rooms", between: "No", stretchers: "" }],
    Curtains: [{ department: "All units", times: "2", per: "6 months", also: "Isolation discharge" }],
    OtherDept: [{ room_type: "Kitchen", who: "Dietary" }],
    Floors: [{ floor_type: "VCT (vinyl composition tile)" }, { floor_type: "Carpet tile" }]
  }
};

const setup = () => intakeToScope(defaultRules(), intake, "2026-10-28T00:00:00.000Z");
const type = (r: Rules, id: string) => r.roomTypes.find((t) => t.id === id)!;
const task = (r: Rules, id: string) => r.tasks.find((t) => t.id === id)!;

describe("readIntake — the answers saved inside the form", () => {
  const page = (json: string) => `<!doctype html><html><body><form></form>
<script id="saved-data" type="application/json">${json}</script>
<script>function save(){ const html = '<script id="saved-data" type="application\\/json">' + JSON.stringify(data) + '<\\/script>'; }</script></body></html>`;

  it("reads the answers out of a saved form", () => {
    const d = readIntake(page(JSON.stringify(intake)));
    expect(d.fields.facility_name).toBe("Test General");
    expect(d.tables.Rooms).toHaveLength(11);
  });

  it("reads the answers on their own (JSON)", () => {
    expect(readIntake(JSON.stringify(intake)).fields.gross_sqft).toBe("250000");
  });

  it("says plainly when the form was never saved, or isn't an intake at all", () => {
    expect(() => readIntake(page(""))).toThrow(/no saved answers yet/);
    expect(() => readIntake("<html><body>hello</body></html>")).toThrow(IntakeError);
    expect(() => readIntake('{"rooms": []}')).toThrow(/isn't a Rediscover Clean intake form/);
  });

  it("reads the form's frequencies in Scope's words", () => {
    expect(["7x per week", "4x per week", "Every other week", "Monthly", "As needed / on request", ""].map(intakeFrequency))
      .toEqual(["7x / week", "4x / week", "Every other week", "Monthly", "As needed", null]);
  });
});

describe("intakeToScope — room types", () => {
  it("sets how often each type is cleaned, who cleans it, and adds the types Scope lacks", () => {
    const { rules } = setup();
    expect(type(rules, "patient-room")).toMatchObject({ frequency: "7x / week", cleanedOn: "1st, Weekends" });
    expect(type(rules, "exam-room")).toMatchObject({ frequency: "5x / week", cleanedOn: "2nd" });
    expect(type(rules, "office").frequency).toBe("4x / week");
    expect(type(rules, "icu-room")).toMatchObject({ label: "ICU / Critical Care Room", frequency: "7x / week", beyondGeneral: true, issaCategory: "clinical" });
    // a type the form doesn't list prices at its nearest ISSA category
    expect(rules.roomTypes.find((t) => t.label === "Cardiac rehab gym")).toMatchObject({ frequency: "3x / week", issaCategory: "clinical" });
    // left blank on the form → not added
    expect(rules.roomTypes.some((t) => /hybrid/i.test(t.label))).toBe(false);
  });

  it("several of the form's types on one of Scope's: the most frequent wins, shifts combine", () => {
    const { rules } = setup();
    expect(type(rules, "restroom")).toMatchObject({ frequency: "7x / week", cleanedOn: "1st, 2nd, 3rd" });
    expect(type(rules, "corridor").frequency).toBe("7x / week");
    expect(type(rules, "hallway").frequency).toBe("7x / week");
  });

  it("as needed means no routine weekly time", () => {
    const { rules } = setup();
    expect(type(rules, "storage").frequency).toBe("As needed");
    expect(freqPerWeek("As needed")).toBe(0);
    expect(weeklyMinutes(rules, { roomType: "Storage", squareFeet: 200 })).toBe(0);
  });

  it("leaves the rulebook it was given untouched", () => {
    const before = defaultRules();
    const snap = JSON.stringify(before);
    intakeToScope(before, intake);
    expect(JSON.stringify(before)).toBe(snap);
  });
});

describe("intakeToScope — rates, general clean, procedure", () => {
  it("times every room type by its ISSA 612 rate per sq ft — never the form's benchmark", () => {
    const start = defaultRules();
    const office = type(start, "office");
    office.method = "fixed"; office.fixedMin = 12;
    const { rules, notUsed } = intakeToScope(start, intake);
    for (const t of rules.roomTypes) expect(t.method).toBe("size");
    expect(type(rules, "office").sqftPerHour).toBe(4250);
    expect(type(rules, "restroom").sqftPerHour).toBe(1000);
    expect(notUsed.join(" ")).toMatch(/benchmark rates/);
  });

  it("the general clean covers what the facility said it does", () => {
    const { rules } = setup();
    expect([...type(rules, "office").includedTasks!].sort()).toEqual(["damp-mop", "high-dusting", "trash-pull", "vacuum"]);
    expect(computeMinutes(rules, { roomType: "Office", squareFeet: 300, spaceTasks: ["high-dusting"] }).lines).toHaveLength(1);
  });

  it("writes the facility's own procedure, in working order", () => {
    const { rules } = setup();
    expect(rules.procedure.example).toBe(false);
    expect(rules.procedure.steps.map((s) => s.title)).toEqual(["Empty trash", "High dust", "Damp wipe", "Dust mop", "Vacuum", "Damp mop"]);
  });

  it("keeps a procedure the account already wrote", () => {
    const start = defaultRules();
    start.procedure = { steps: [{ title: "Our way" }], show: true, example: false };
    expect(intakeToScope(start, intake).rules.procedure.steps).toEqual([{ title: "Our way" }]);
  });
});

describe("intakeToScope — floor care on its own days", () => {
  it("puts each area's floor tasks on its room types, with the form's days a week", () => {
    const { rules } = setup();
    const burnish = task(rules, "burnish");
    expect(burnish.autoFor).toEqual(expect.arrayContaining(["corridor", "hallway", "patient-room"]));
    expect(burnish.frequencyFor).toMatchObject({ corridor: "5x / week", hallway: "5x / week", "patient-room": "3x / week" });
    // auto-scrub every day on corridors cleaned every day: no separate frequency needed
    expect(task(rules, "auto-scrub").autoFor).toEqual(expect.arrayContaining(["corridor", "hallway"]));
    expect(task(rules, "auto-scrub").frequencyFor?.corridor).toBeUndefined();
    // dust mopping is in the general clean: patient rooms don't get it as a floor task
    expect(task(rules, "dust-mop").autoFor).not.toContain("patient-room");
    // "all areas" carpet work: every carpeted room, once a week
    expect(task(rules, "machine-carpet")).toMatchObject({ autoForFloor: ["carpet"], frequency: "1x / week" });
  });

  it("weekly workload counts floor care at its own frequency", () => {
    const { rules } = setup();
    const room = { roomType: "Patient Room", squareFeet: 300, floorType: "Hard floor — finished", spaceTasks: ["burnish"] };
    const visit = computeMinutes(rules, room);
    const burnishMin = 300 / task(rules, "burnish").sqftPerMin!;
    expect(weeklyMinutes(rules, room)).toBeCloseTo((visit.total - burnishMin) * 7 + burnishMin * 3, 6);
    // with no task frequencies, the old math exactly
    const plain = defaultRules();
    expect(weeklyMinutes(plain, room)).toBe(computeMinutes(plain, room).total * 7);
  });
});

describe("intakeToScope — discharges, breaks, profile", () => {
  it("discharge cleans and travel", () => {
    const { rules } = setup();
    expect(rules.nonSpaceDefs.find((d) => d.id === "discharge")).toMatchObject({ minutes: 50, qualifierIds: ["travel-time"] });
    expect(rules.nonSpaceQualifiers.find((q) => q.id === "travel-time")!.minutes).toBe(6);
  });

  it("breaks: the first shift's for every schedule, and a break schedule per shift", () => {
    const { rules } = setup();
    expect(rules.breaks).toEqual([
      { id: "intake-break-1", label: "Break", minutes: 15, start: "9:00 AM" },
      { id: "intake-break-2", label: "Lunch", minutes: 30, start: "11:30 AM", unpaid: true },
      { id: "intake-break-3", label: "Break 2", minutes: 15, start: "1:30 PM" }
    ]);
    const second = rules.breakSchedules.find((s) => s.label === "2nd shift")!;
    expect(second.windows).toEqual([{ kind: "lunch", start: "19:00", minutes: 30, unpaid: true }]);
    // 480 − 30 paid break minutes − 30 cart setup/teardown
    expect(rules.general.productiveMinutes).toBe(420);
  });

  it("keeps the facility's profile — and never its contact details", () => {
    const { rules } = setup();
    const p = rules.intake!;
    expect(p).toMatchObject({ facility: "Test General", system: "TGH", completed: "2026-10-01" });
    expect(p.facts).toContainEqual(["Gross sq ft", "250,000"]);
    expect(p.facts.some(([k]) => k === "Facility type")).toBe(false);
    expect(p.services).toEqual({ handles: ["Bed and mattress cleaning"], partly: ["Pest control / exterminating (vendor)"] });
    expect(p.betweenCases).toEqual(["Emergency department exam rooms (stretchers too)"]);
    expect(p.discharges).toEqual(["30 a day", "By shift — 1st shift: 20, 2nd shift: 10"]);
    expect(JSON.stringify(p)).not.toMatch(/Pat Example|example\.org/);
  });

  it("says what it couldn't use", () => {
    const { notUsed } = setup();
    const all = notUsed.join("\n");
    expect(all).toMatch(/Hybrid OR/);
    expect(all).toMatch(/Office: vacuuming 2x \/ week — part of its General Clean \(4x \/ week\)/);
    expect(all).toMatch(/Curtain changes/);
  });
});
