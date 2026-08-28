// The universal back button's trail: visits dedupe, back pops the current
// page AND returns the previous one (which re-registers itself on arrival),
// and tokens translate to the right maps.html hashes.
import { describe, it, expect, beforeEach } from "vitest";
import { navVisit, navBack, navStack, hubHashFor, urlFor } from "./nav";

// nav.ts talks to sessionStorage — give the test a real-enough one
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as Record<string, unknown>).sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); }
  };
});

describe("the shared navigation trail", () => {
  it("records visits in order and dedupes repeats", () => {
    navVisit("classic:Dashboard");
    navVisit("hub:map");
    navVisit("hub:map"); // same page re-rendering must not stack up
    navVisit("hub:spaces/list");
    expect(navStack()).toEqual(["classic:Dashboard", "hub:map", "hub:spaces/list"]);
  });

  it("back returns the PREVIOUS page, not the homepage", () => {
    navVisit("classic:Dashboard");
    navVisit("classic:Max Team");
    navVisit("hub:map");
    expect(navBack()).toBe("classic:Max Team");
    // the destination re-registers itself on arrival — simulate that
    navVisit("classic:Max Team");
    expect(navBack()).toBe("classic:Dashboard");
  });

  it("back with no history returns null (caller falls back to classic)", () => {
    expect(navBack()).toBeNull();
    navVisit("hub:spaces/map");
    expect(navBack()).toBeNull(); // only the current page — nowhere to go
  });

  it("survives a poisoned stack", () => {
    store.set("om_nav_stack", "{not json");
    expect(navStack()).toEqual([]);
    navVisit("hub:scope");
    expect(navStack()).toEqual(["hub:scope"]);
  });

  it("never grows past 60 entries", () => {
    for (let i = 0; i < 100; i++) navVisit("classic:Page " + i);
    expect(navStack().length).toBeLessThanOrEqual(60);
    expect(navStack()[navStack().length - 1]).toBe("classic:Page 99");
  });
});

describe("token → hash mapping", () => {
  it("maps every hub view to its hash", () => {
    expect(hubHashFor("hub:map")).toBe("#");
    expect(hubHashFor("hub:schedules")).toBe("#tab-schedules");
    expect(hubHashFor("hub:rooms")).toBe("#tab-rooms");
    expect(hubHashFor("hub:spaces/explorer")).toBe("#spaces?view=explorer");
    expect(hubHashFor("hub:spaces/list")).toBe("#spaces?view=list");
    expect(hubHashFor("hub:spaces/map")).toBe("#spaces?view=map");
    expect(hubHashFor("hub:scope")).toBe("#scope");
    expect(hubHashFor("hub:workload")).toBe("#workload");
    expect(hubHashFor("hub:floorcare")).toBe("#floorcare");
  });

  it("builds full URLs for both documents", () => {
    expect(urlFor("classic:Max Team")).toBe("./classic.html");
    expect(urlFor("hub:spaces/list")).toBe("./maps.html#spaces?view=list");
  });
});
