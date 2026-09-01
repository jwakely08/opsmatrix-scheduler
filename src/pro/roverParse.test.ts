// Rover Mode's ears, tested against how people actually talk on a walk.
import { describe, it, expect } from "vitest";
import { defaultRules } from "./rules";
import { parseRoverUtterance, mergeDraft } from "./roverParse";

const rules = defaultRules();
const parse = (s: string) => parseRoverUtterance(s, rules);

describe("Josh's labeled form", () => {
  it("room number 101 room type office room name Dr. Smith's office floor type carpet zero fixtures", () => {
    const { draft, command } = parse(
      "room number 101 room type office room name Dr. Smith's office floor type carpet zero fixtures");
    expect(draft.roomNumber).toBe("101");
    expect(draft.roomType).toBe("Office");
    expect(draft.roomName).toBe("Dr Smith's Office");
    expect(draft.floorType).toBe("Carpet");
    expect(draft.fixtureCount).toBe(0);
    expect(command).toBeNull();
  });

  it("labels in any order still land", () => {
    const { draft } = parse("floor type carpet room type exam room room number 4E-210 two fixtures");
    expect(draft.roomNumber).toBe("4E-210");
    expect(draft.roomType).toBe("Exam Room");
    expect(draft.floorType).toBe("Carpet");
    expect(draft.fixtureCount).toBe(2);
  });
});

describe("Josh's terse form", () => {
  it("102 office Dr. Smith's office carpet zero fixtures", () => {
    const { draft } = parse("102 office Dr. Smith's office carpet zero fixtures");
    expect(draft.roomNumber).toBe("102");
    expect(draft.roomType).toBe("Office");     // the FIRST office is the type…
    expect(draft.roomName).toBe("Dr Smith's Office"); // …the second stays in the name
    expect(draft.floorType).toBe("Carpet");
    expect(draft.fixtureCount).toBe(0);
  });

  it("310 patient room hard floor 1 fixture", () => {
    const { draft } = parse("310 patient room hard floor 1 fixture");
    expect(draft.roomNumber).toBe("310");
    expect(draft.roomType).toBe("Patient Room");
    expect(draft.floorType).toBe("Hard floor — finished");
    expect(draft.fixtureCount).toBe(1);
  });

  it("multi-word types win over their pieces", () => {
    const { draft } = parse("205 waiting room east waiting tile no fixtures");
    expect(draft.roomType).toBe("Waiting Room");
    expect(draft.floorType).toBe("Hard floor — finished");
    expect(draft.fixtureCount).toBe(0);
  });
});

describe("what recognizers actually emit", () => {
  it("spelled digits: room number one oh two", () => {
    expect(parse("room number one oh two office").draft.roomNumber).toBe("102");
  });

  it("spoken aliases: OR room → Operating Room, bathroom → Restroom", () => {
    expect(parse("12 or room concrete 3 fixtures").draft.roomType).toBe("Operating Room");
    expect(parse("15 bathroom tile two sinks").draft.roomType).toBe("Restroom");
  });

  it("unfinished beats finished when both words appear", () => {
    expect(parse("hard floor unfinished").draft.floorType).toBe("Hard floor — unfinished");
    expect(parse("unfinished floor").draft.floorType).toBe("Hard floor — unfinished");
  });

  it("fixtures forms: 'fixtures 4', 'no fixtures', 'seventeen fixtures'", () => {
    expect(parse("fixtures 4").draft.fixtureCount).toBe(4);
    expect(parse("no fixtures").draft.fixtureCount).toBe(0);
    expect(parse("seventeen fixtures").draft.fixtureCount).toBe(17);
  });
});

describe("voice commands", () => {
  it("bare confirm / next / save it", () => {
    for (const w of ["confirm", "confirmed", "next", "next room", "save it", "looks good"]) {
      expect(parse(w).command).toBe("confirm");
    }
  });

  it("data + trailing confirm in one breath", () => {
    const { draft, command } = parse("102 office carpet zero fixtures confirm");
    expect(command).toBe("confirm");
    expect(draft.roomNumber).toBe("102");
    expect(draft.floorType).toBe("Carpet");
  });

  it("clear and cancel", () => {
    expect(parse("clear").command).toBe("clear");
    expect(parse("start over").command).toBe("clear");
    expect(parse("cancel").command).toBe("cancel");
  });

  it("'confirm' never leaks into the room name", () => {
    const { draft } = parse("102 office confirm");
    expect(draft.roomName ?? "").not.toMatch(/confirm/i);
  });
});

describe("piecewise corrections merge", () => {
  it("speak, then fix one field", () => {
    const first = parse("102 office carpet zero fixtures").draft;
    const fix = parse("room type exam room").draft;
    const merged = mergeDraft(first, fix);
    expect(merged.roomType).toBe("Exam Room");
    expect(merged.roomNumber).toBe("102");   // untouched fields survive
    expect(merged.floorType).toBe("Carpet");
  });

  it("an utterance only carries what it said", () => {
    const { draft } = parse("three fixtures");
    expect(draft.fixtureCount).toBe(3);
    expect(draft.roomNumber).toBeUndefined();
    expect(draft.roomType).toBeUndefined();
    expect(draft.roomName).toBeUndefined();
  });
});

describe("one mention serves both fields (Josh, 2026-09-01)", () => {
  it("'101 Dr Smith's office carpet zero fixtures' — office is the type AND stays in the name", () => {
    const { draft } = parse("101 Dr Smith's office carpet zero fixtures");
    expect(draft.roomNumber).toBe("101");
    expect(draft.roomType).toBe("Office");
    expect(draft.roomName).toBe("Dr Smith's Office");
    expect(draft.floorType).toBe("Carpet");
    expect(draft.fixtureCount).toBe(0);
  });

  it("'12 exam room one tile one fixture' — Exam Room is the type, Exam Room One is the name", () => {
    const { draft } = parse("12 exam room one tile one fixture");
    expect(draft.roomNumber).toBe("12");
    expect(draft.roomType).toBe("Exam Room");
    expect(draft.roomName).toBe("Exam Room One");
    expect(draft.floorType).toBe("Hard floor — finished");
    expect(draft.fixtureCount).toBe(1);
  });

  it("'exam room b' keeps the letter tag in the name", () => {
    const { draft } = parse("14 exam room b carpet");
    expect(draft.roomType).toBe("Exam Room");
    expect(draft.roomName).toBe("Exam Room B");
  });

  it("a bare type mention still leaves the name empty", () => {
    const { draft } = parse("102 office carpet zero fixtures");
    expect(draft.roomType).toBe("Office");
    expect(draft.roomName).toBeUndefined();
  });

  it("two mentions still split cleanly: type from the first, name keeps the second", () => {
    const { draft } = parse("102 office Dr Smith's office carpet zero fixtures");
    expect(draft.roomType).toBe("Office");
    expect(draft.roomName).toBe("Dr Smith's Office");
  });

  it("'102 office dr smith's clinic' — clinic name, office type consumed alone", () => {
    const { draft } = parse("102 office dr smith's clinic carpet");
    expect(draft.roomType).toBe("Office");
    expect(draft.roomName).toBe("Dr Smith's Clinic");
  });
});
