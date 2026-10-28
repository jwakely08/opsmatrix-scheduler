import { describe, expect, it } from "vitest";
import { compassWord, delta, eventHeading, mapTurn, northOnScreen, screenHeading, smooth } from "./compass";

describe("which way the map faces", () => {
  // a plan whose top points east (heading 90)
  const planUp = 90;

  it("as drawn never turns", () => {
    expect(mapTurn("plan", planUp, 200)).toBe(0);
  });

  it("north up turns the plan so north is at the top", () => {
    expect(mapTurn("north", planUp, 200)).toBe(90);
    expect(northOnScreen(mapTurn("north", planUp, 200), planUp)).toBe(0);
  });

  it("turns with me: what the walker faces is up", () => {
    // facing the way the plan's top points: the plan as drawn
    expect(mapTurn("heading", planUp, 90)).toBe(0);
    // turned right (south): the plan's right side is ahead, so the plan turns left
    expect(mapTurn("heading", planUp, 180)).toBe(270);
    // the needle always points at real north
    expect(northOnScreen(mapTurn("heading", planUp, 180), planUp)).toBe(180);
  });

  it("without the building's north set, nothing turns", () => {
    expect(mapTurn("north", null, 10)).toBe(0);
    expect(northOnScreen(0, null)).toBeNull();
  });
});

describe("the compass", () => {
  it("a landscape screen adds its turn to the device's heading", () => {
    expect(screenHeading(270, 90)).toBe(0);
    expect(screenHeading(10, 270)).toBe(280);
  });

  it("reads the iPad's heading, or another device's absolute one", () => {
    expect(eventHeading({ webkitCompassHeading: 45 })).toBe(45);
    expect(eventHeading({ absolute: true, alpha: 90 })).toBe(270);
    expect(eventHeading({ absolute: false, alpha: 90 })).toBeNull();
  });

  it("smooths across north without spinning the long way round", () => {
    expect(delta(350, 10)).toBe(20);
    const s = smooth(350, 10, 0.5);
    expect(s).toBe(0);
    expect(compassWord(0)).toBe("N");
    expect(compassWord(260)).toBe("W");
  });
});
