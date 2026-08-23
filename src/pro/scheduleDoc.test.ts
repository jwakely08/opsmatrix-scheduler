import { describe, it, expect } from "vitest";
import { buildScheduleDoc, parseClock, formatClock, shiftFor } from "./scheduleDoc";
import { setCoverage, moveInSchedule, spacePriority, type ClassicData } from "./classicStore";
import { defaultRules } from "./rules";

/**
 * A tiny but realistic hospital floor: two patient rooms and a corridor,
 * wired through the real coverage model (no hand-built roomTasks).
 */
function fixture(): ClassicData {
  const data: ClassicData = {
    v7: {
      spaces: [
        {
          id: "sp-101", roomNumber: "101", roomName: "Patient Room 101",
          roomType: "Patient Room", floorType: "Hard floor — finished",
          squareFeet: 400, spaceTasks: [], priority: "High"
        },
        {
          id: "sp-102", roomNumber: "102", roomName: "Patient Room 102",
          roomType: "Patient Room", floorType: "Hard floor — finished",
          squareFeet: 400, spaceTasks: ["high-dusting"], priority: "Low"
        },
        {
          id: "sp-c1", roomNumber: "C-1", roomName: "Corridor",
          roomType: "Corridor", floorType: "Hard floor — finished",
          squareFeet: 600, spaceTasks: ["auto-scrub", "dust-mop"]
        }
      ],
      schedules: [{
        id: "sched-a", num: "101", name: "East Wing", shift: "1st Shift",
        color: "#22c55e", targetHours: 8, spaceOrder: [], roomTasks: {}
      }],
      employees: [],
      shifts: [{ id: "sh1", name: "1st Shift", start: "7:00 AM", end: "3:00 PM", active: true }]
    },
    plans: [],
    nonSpace: []
  };
  return data;
}

/** rules with no breaks — most tests are about rooms, not the clock stopping */
const RULES: ReturnType<typeof defaultRules> = { ...defaultRules(), breaks: [] };
/** the account's standard breaks, as a manager would set them up */
const RULES_BREAKS = defaultRules();
const DATE = new Date(2026, 3, 14); // April 14 2026 — fixed so the doc is deterministic

describe("clock helpers", () => {
  it("parses 12- and 24-hour times", () => {
    expect(parseClock("7:00 AM")).toBe(420);
    expect(parseClock("3:30 PM")).toBe(930);
    expect(parseClock("12:00 AM")).toBe(0);
    expect(parseClock("12:30 PM")).toBe(750);
    expect(parseClock("23:00")).toBe(1380);
  });

  it("rejects nonsense rather than guessing", () => {
    expect(parseClock("")).toBeNull();
    expect(parseClock("lunchtime")).toBeNull();
    expect(parseClock("25:00")).toBeNull();
  });

  it("formats back to the way EVS schedules are written", () => {
    expect(formatClock(420)).toBe("7:00 AM");
    expect(formatClock(750)).toBe("12:30 PM");
    expect(formatClock(0)).toBe("12:00 AM");
    expect(formatClock(1395)).toBe("11:15 PM");
  });

  it("reads the shift from Classic, with a fallback when it is missing", () => {
    const data = fixture();
    expect(shiftFor(data, data.v7.schedules![0])).toMatchObject({ start: 420, end: 900 });
    const noShifts: ClassicData = { ...data, v7: { ...data.v7, shifts: [] } };
    expect(shiftFor(noShifts, { id: "x", shift: "2nd Shift" })).toMatchObject({ start: 900, end: 1380 });
  });
});

describe("buildScheduleDoc", () => {
  it("numbers rooms in the order they were tapped onto the schedule", () => {
    const data = fixture();
    // tapped corridor first, then 102, then 101
    setCoverage(data, "sp-c1", "sched-a", true, ["auto-scrub", "dust-mop"]);
    setCoverage(data, "sp-102", "sched-a", true, ["high-dusting"]);
    setCoverage(data, "sp-101", "sched-a", true, []);

    const doc = buildScheduleDoc(data, RULES, data.v7.schedules![0], { date: DATE });
    expect(doc.rows.map((r) => r.roomNumber)).toEqual(["C-1", "102", "101"]);
    expect(doc.rows.map((r) => r.order)).toEqual([1, 2, 3]);
  });

  it("follows a re-order, so a mis-tap can be fixed", () => {
    const data = fixture();
    setCoverage(data, "sp-c1", "sched-a", true, []);
    setCoverage(data, "sp-101", "sched-a", true, []);
    moveInSchedule(data, "sched-a", "sp-101", -1);

    const doc = buildScheduleDoc(data, RULES, data.v7.schedules![0], { date: DATE });
    expect(doc.rows.map((r) => r.roomNumber)).toEqual(["101", "C-1"]);
  });

  it("lists each room's tasks from the schedule's own coverage, base clean first", () => {
    const data = fixture();
    setCoverage(data, "sp-101", "sched-a", true, []);
    setCoverage(data, "sp-102", "sched-a", true, ["high-dusting"]);
    setCoverage(data, "sp-c1", "sched-a", true, ["auto-scrub", "dust-mop"]);

    const doc = buildScheduleDoc(data, RULES, data.v7.schedules![0], { date: DATE });
    expect(doc.rows[0].tasks).toEqual(["General Clean"]);
    expect(doc.rows[1].tasks).toEqual(["General Clean", "High Dusting"]);
    expect(doc.rows[2].tasks).toEqual(["General Clean", "Machine Scrubbing", "Dust Mopping"]);
  });

  it("prints only the tasks THIS schedule covers when a room is shared", () => {
    const data = fixture();
    data.v7.schedules!.push({
      id: "sched-b", num: "102", name: "Floor Care", shift: "1st Shift",
      color: "#3b82f6", spaceOrder: [], roomTasks: {}
    });
    // EVS takes the base clean, the floor tech takes only the high dusting
    setCoverage(data, "sp-102", "sched-a", true, []);
    setCoverage(data, "sp-102", "sched-b", false, ["high-dusting"]);

    const a = buildScheduleDoc(data, RULES, data.v7.schedules![0], { date: DATE });
    const b = buildScheduleDoc(data, RULES, data.v7.schedules![1], { date: DATE });
    expect(a.rows[0].tasks).toEqual(["General Clean"]);
    expect(b.rows[0].tasks).toEqual(["High Dusting"]);
    // and the minutes split the same way — no double-counting the base clean
    expect(a.rows[0].minutes).toBe(18);
    expect(b.rows[0].minutes).toBe(3);
  });

  it("walks the clock from the shift start through each room's minutes", () => {
    const data = fixture();
    setCoverage(data, "sp-101", "sched-a", true, []);
    setCoverage(data, "sp-102", "sched-a", true, []);

    const doc = buildScheduleDoc(data, RULES, data.v7.schedules![0], { date: DATE });
    // 400 sq ft ÷ 33 = 12.1 min + 6 min patient-room qualifier = 18 min
    expect(doc.rows[0]).toMatchObject({ startTime: "7:00 AM", minutes: 18 });
    expect(doc.rows[1]).toMatchObject({ startTime: "7:18 AM", minutes: 18 });
    expect(doc.totals.roomMinutes).toBe(36);
  });

  it("puts a break between rooms, never in the middle of one", () => {
    const data = fixture();
    setCoverage(data, "sp-101", "sched-a", true, []);
    setCoverage(data, "sp-102", "sched-a", true, []);
    const rules = { ...RULES, breaks: [{ id: "b", label: "Break", minutes: 15, start: "7:10 AM" }] };

    const doc = buildScheduleDoc(data, rules, data.v7.schedules![0], { date: DATE });
    // room 1 runs 7:00–7:18, so the 7:10 break waits until the room is finished
    expect(doc.breaks).toHaveLength(1);
    expect(doc.breaks[0]).toMatchObject({ startTime: "7:18 AM", endTime: "7:33 AM", afterRow: 1 });
    expect(doc.rows[1].startTime).toBe("7:33 AM");
    expect(doc.totals.breakMinutes).toBe(15);
  });

  it("takes every account break, in order, across the day", () => {
    const data = fixture();
    setCoverage(data, "sp-101", "sched-a", true, []);
    setCoverage(data, "sp-102", "sched-a", true, []);
    setCoverage(data, "sp-c1", "sched-a", true, []);

    const doc = buildScheduleDoc(data, RULES_BREAKS, data.v7.schedules![0], { date: DATE });
    expect(doc.breaks.map((b) => b.label)).toEqual(["Morning Break", "Lunch", "Afternoon Break"]);
    expect(doc.totals.breakMinutes).toBe(60);
    // the rooms finish early, so the breaks still print at their real times
    expect(doc.breaks.map((b) => b.startTime)).toEqual(["9:30 AM", "12:30 PM", "2:00 PM"]);
  });

  it("lets one schedule move, shorten or drop a break", () => {
    const data = fixture();
    setCoverage(data, "sp-101", "sched-a", true, []);
    data.v7.schedules![0].breaks = [
      { id: "break-am", off: true },
      { id: "lunch", start: "11:00 AM", minutes: 45 }
    ];

    const doc = buildScheduleDoc(data, RULES_BREAKS, data.v7.schedules![0], { date: DATE });
    expect(doc.breaks.map((b) => b.label)).toEqual(["Lunch", "Afternoon Break"]);
    expect(doc.breaks[0]).toMatchObject({ startTime: "11:00 AM", endTime: "11:45 AM", minutes: 45 });
  });

  it("only takes breaks that fall inside the schedule's own shift", () => {
    const data = fixture();
    // a 2nd-shift schedule must not inherit a 12:30 PM lunch meant for days
    data.v7.schedules![0].shift = "2nd Shift";
    data.v7.shifts = [{ id: "sh2", name: "2nd Shift", start: "3:00 PM", end: "11:00 PM", active: true }];
    setCoverage(data, "sp-101", "sched-a", true, []);

    const doc = buildScheduleDoc(data, RULES_BREAKS, data.v7.schedules![0], { date: DATE });
    expect(doc.breaks).toEqual([]);
  });

  it("resolves breaks relative to a shift that crosses midnight", () => {
    const data = fixture();
    data.v7.schedules![0].shift = "3rd Shift";
    data.v7.shifts = [{ id: "sh3", name: "3rd Shift", start: "11:00 PM", end: "7:00 AM", active: true }];
    setCoverage(data, "sp-101", "sched-a", true, []);
    const rules = { ...RULES, breaks: [{ id: "n", label: "Lunch", minutes: 30, start: "3:00 AM" }] };

    const doc = buildScheduleDoc(data, rules, data.v7.schedules![0], { date: DATE });
    expect(doc.breaks[0]).toMatchObject({ startTime: "3:00 AM", endTime: "3:30 AM" });
  });

  it("carries room priority through, defaulting to Medium when never set", () => {
    const data = fixture();
    setCoverage(data, "sp-101", "sched-a", true, []);
    setCoverage(data, "sp-102", "sched-a", true, []);
    setCoverage(data, "sp-c1", "sched-a", true, []);

    const doc = buildScheduleDoc(data, RULES, data.v7.schedules![0], { date: DATE });
    expect(doc.rows.map((r) => r.priority)).toEqual(["High", "Low", "Medium"]);
    expect(doc.totals.priority).toEqual({ High: 1, Medium: 1, Low: 1 });
    expect(spacePriority({ id: "x" })).toBe("Medium");
  });

  it("builds the as-needed section from the schedule's non-space tasks", () => {
    const data = fixture();
    setCoverage(data, "sp-101", "sched-a", true, []);
    data.nonSpace.push({ id: "ns1", name: "Discharges", hours: 2, scheduleId: "sched-a", roomIds: ["sp-102"] });

    const doc = buildScheduleDoc(data, RULES, data.v7.schedules![0], { date: DATE });
    expect(doc.nonSpace).toEqual([
      { id: "ns1", name: "Discharges", minutes: 120, linkedRooms: ["102"] }
    ]);
    expect(doc.nonSpaceWindow).toEqual({ start: "7:18 AM", end: "3:00 PM" });
    expect(doc.totals.nonSpaceMinutes).toBe(120);
  });

  it("omits the as-needed section entirely when there is none", () => {
    const data = fixture();
    setCoverage(data, "sp-101", "sched-a", true, []);
    const doc = buildScheduleDoc(data, RULES, data.v7.schedules![0], { date: DATE });
    expect(doc.nonSpace).toEqual([]);
    expect(doc.nonSpaceWindow).toBeNull();
  });

  it("flags a schedule that does not fit its shift", () => {
    const data = fixture();
    setCoverage(data, "sp-101", "sched-a", true, []);
    data.nonSpace.push({ id: "ns1", name: "Day Porter", hours: 8, scheduleId: "sched-a", roomIds: [] });

    const doc = buildScheduleDoc(data, RULES, data.v7.schedules![0], { date: DATE });
    expect(doc.totals.shiftMinutes).toBe(480);
    expect(doc.totals.overShift).toBe(true);
  });

  it("counts the tasks across the whole schedule for the summary strip", () => {
    const data = fixture();
    setCoverage(data, "sp-101", "sched-a", true, []);
    setCoverage(data, "sp-102", "sched-a", true, ["high-dusting"]);
    setCoverage(data, "sp-c1", "sched-a", true, ["auto-scrub", "dust-mop"]);

    const doc = buildScheduleDoc(data, RULES, data.v7.schedules![0], { date: DATE });
    expect(doc.totals.taskCounts).toEqual([
      { label: "General Clean", count: 3 },
      { label: "Dust Mopping", count: 1 },
      { label: "High Dusting", count: 1 },
      { label: "Machine Scrubbing", count: 1 }
    ]);
  });

  it("never carries an employee name — any worker can run any schedule", () => {
    const data = fixture();
    data.v7.schedules![0].employee = "J. Martinez";
    setCoverage(data, "sp-101", "sched-a", true, []);

    const doc = buildScheduleDoc(data, RULES, data.v7.schedules![0], { date: DATE });
    expect(JSON.stringify(doc)).not.toContain("Martinez");
  });

  it("handles a 3rd shift that crosses midnight", () => {
    const data = fixture();
    data.v7.schedules![0].shift = "3rd Shift";
    data.v7.shifts = [{ id: "sh3", name: "3rd Shift", start: "11:00 PM", end: "7:00 AM", active: true }];
    setCoverage(data, "sp-101", "sched-a", true, []);

    const doc = buildScheduleDoc(data, RULES, data.v7.schedules![0], { date: DATE });
    expect(doc.rows[0].startTime).toBe("11:00 PM");
    expect(doc.totals.shiftMinutes).toBe(480);
    expect(doc.totals.overShift).toBe(false);
  });

  it("still prints a room whose tasks were never picked, rather than hiding it", () => {
    const data = fixture();
    setCoverage(data, "sp-101", "sched-a", true, []);
    // the one-tap add puts a room on a schedule before its tasks are chosen
    setCoverage(data, "sp-102", "sched-a", false, [], true);

    const doc = buildScheduleDoc(data, RULES, data.v7.schedules![0], { date: DATE });
    expect(doc.rows.map((r) => r.roomNumber)).toEqual(["101", "102"]);
    expect(doc.rows[1].tasks).toEqual([]);
    expect(doc.rows[1].minutes).toBe(0);
  });
});
