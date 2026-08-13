import { describe, it, expect } from "vitest";
import {
  sanitizeRooms, normalizeCoordinateScale, polygonArea, derivePxPerFt,
  buildPlanFromRooms, planSchema, AI_ROOM_TYPES, type AiRoom
} from "./aiPlanImport";

/** a 10x10 unit square room occupying a quarter of the image */
const square = (x: number, y: number, s: number): number[][] =>
  [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];

function room(over: Partial<AiRoom> = {}): AiRoom {
  return {
    name: "Patient Room 101", roomNumber: "101", squareFeet: 0,
    roomType: "Patient Room", polygon: square(0.1, 0.1, 0.2), ...over
  };
}

describe("sanitizeRooms", () => {
  it("keeps good rooms and clamps stray coordinates into the image", () => {
    const out = sanitizeRooms([room({ polygon: [[-0.5, 0.2], [1.4, 0.2], [1.4, 0.6], [-0.5, 0.6]] })]);
    expect(out).toHaveLength(1);
    expect(out[0].polygon).toEqual([[0, 0.2], [1, 0.2], [1, 0.6], [0, 0.6]]);
  });

  it("drops shapes that are not a usable outline", () => {
    expect(sanitizeRooms([room({ polygon: [[0, 0], [1, 1]] })])).toHaveLength(0);       // 2 points
    expect(sanitizeRooms([room({ polygon: [[0, 0], [0, 0], [0, 0]] })])).toHaveLength(0); // zero area
    expect(sanitizeRooms([room({ polygon: [] })])).toHaveLength(0);
    expect(sanitizeRooms(undefined)).toEqual([]);
  });

  it("ignores non-numeric points rather than trusting them", () => {
    const out = sanitizeRooms([room({
      polygon: [[0.1, 0.1], ["x" as unknown as number, 0.2], [0.4, 0.1], [0.4, 0.4], [0.1, 0.4]]
    })]);
    expect(out[0].polygon).toHaveLength(4);
  });

  it("leaves the room number BLANK when the plan printed none — the manager types it later", () => {
    const out = sanitizeRooms([room({ roomNumber: "  ", name: "Soiled Utility" })]);
    expect(out[0].roomNumber).toBe("");
    expect(out[0].name).toBe("Soiled Utility");
  });

  it("still keeps a room that has a type and size but no number at all", () => {
    const out = sanitizeRooms([room({ roomNumber: "", name: "Patient Room", squareFeet: 240 })]);
    expect(out).toHaveLength(1);
    expect(out[0].squareFeet).toBe(240);
  });

  it("treats a missing or nonsense area as unmeasured, never as zero-size", () => {
    expect(sanitizeRooms([room({ squareFeet: NaN })])[0].squareFeet).toBe(0);
    expect(sanitizeRooms([room({ squareFeet: -40 })])[0].squareFeet).toBe(0);
    expect(sanitizeRooms([room({ squareFeet: 240 })])[0].squareFeet).toBe(240);
  });

  it("rejects a room type outside the rate table", () => {
    expect(sanitizeRooms([room({ roomType: "Helipad" })])[0].roomType).toBe("");
  });
});

describe("coordinate scale rescue (the 'clear plan reads as no rooms' bug)", () => {
  const px = (pts: number[][]) => [room({ polygon: pts })];

  it("passes already-normalised answers through untouched", () => {
    const rooms = px([[0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.1, 0.5]]);
    expect(normalizeCoordinateScale(rooms)).toEqual(rooms);
  });

  it("rescues a 0–1000 scale answer instead of clamping every room to a dot", () => {
    const fixed = normalizeCoordinateScale(px([[100, 100], [500, 100], [500, 500], [100, 500]]));
    expect(fixed[0].polygon).toEqual([[0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.1, 0.5]]);
    // and the whole pipeline keeps the room where it used to lose it
    expect(sanitizeRooms(fixed)).toHaveLength(1);
  });

  it("rescues a percentage answer", () => {
    const fixed = normalizeCoordinateScale(px([[10, 10], [50, 10], [50, 50], [10, 50]]));
    expect(fixed[0].polygon).toEqual([[0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.1, 0.5]]);
  });

  it("rescues pixel coordinates exactly when the picture size is known", () => {
    const fixed = normalizeCoordinateScale(
      px([[200, 150], [1600, 150], [1600, 1200], [200, 1200]]),
      { width: 2000, height: 1500 }
    );
    expect(fixed[0].polygon).toEqual([[0.1, 0.1], [0.8, 0.1], [0.8, 0.8], [0.1, 0.8]]);
  });

  it("prefers permille over pixels when the answer tops out near 1000 — plans fill our pictures", () => {
    const fixed = normalizeCoordinateScale(
      px([[100, 100], [1000, 100], [1000, 900], [100, 900]]),
      { width: 2000, height: 1500 }
    );
    expect(fixed[0].polygon[1]).toEqual([1, 0.1]);
  });

  it("keeps the shape even for an unknown pixel scale", () => {
    const fixed = normalizeCoordinateScale(px([[300, 300], [3000, 300], [3000, 3000], [300, 3000]]));
    const p = fixed[0].polygon;
    expect(Math.max(...p.flat())).toBeLessThanOrEqual(1);
    expect(sanitizeRooms(fixed)).toHaveLength(1); // survives, does not vanish
  });

  it("uses ONE divisor for the whole answer, so small rooms are not treated differently", () => {
    const fixed = normalizeCoordinateScale([
      room({ polygon: [[10, 10], [900, 10], [900, 900], [10, 900]] }),   // big
      room({ polygon: [[0.5, 0.5], [80, 0.5], [80, 60], [0.5, 60]] })     // small, low coords
    ]);
    // both divided by 1000 — the small one must NOT be mistaken for normalised
    expect(fixed[1].polygon[1][0]).toBeCloseTo(0.08, 6);
  });
});

describe("scale from printed areas", () => {
  it("derives pixels-per-foot from the areas the plan printed", () => {
    // a 0.5 x 0.5 slice of a 1000x1000 plan = 250,000 px² holding 250 sq ft
    // → 1000 px² per sq ft → ~31.6 px per ft
    const rooms = sanitizeRooms([room({ polygon: square(0.1, 0.1, 0.5), squareFeet: 250 })]);
    const px = derivePxPerFt(rooms, 1000, 1000)!;
    expect(px).toBeCloseTo(Math.sqrt(1000), 4);
  });

  it("uses the median so one mis-read label cannot skew the plan", () => {
    const rooms = sanitizeRooms([
      room({ polygon: square(0.0, 0.0, 0.2), squareFeet: 100 }),
      room({ polygon: square(0.3, 0.0, 0.2), squareFeet: 100 }),
      room({ polygon: square(0.6, 0.0, 0.2), squareFeet: 1 }) // fat-fingered label
    ]);
    const px = derivePxPerFt(rooms, 1000, 1000)!;
    const honest = Math.sqrt((0.2 * 1000 * 0.2 * 1000) / 100);
    expect(px).toBeCloseTo(honest, 6);
  });

  it("returns null when the plan printed no areas at all", () => {
    expect(derivePxPerFt(sanitizeRooms([room()]), 1000, 1000)).toBeNull();
  });

  it("measures a polygon's area independent of winding direction", () => {
    const cw = square(0, 0, 0.5);
    const ccw = [...cw].reverse();
    expect(Math.abs(polygonArea(cw))).toBeCloseTo(0.25, 6);
    expect(Math.abs(polygonArea(ccw))).toBeCloseTo(0.25, 6);
  });
});

describe("buildPlanFromRooms", () => {
  const reading = {
    buildingName: "Mercy General", floorName: "4 East",
    rooms: sanitizeRooms([
      room({ roomNumber: "4E-101", name: "Patient Room", polygon: square(0.05, 0.05, 0.3), squareFeet: 240 }),
      room({ roomNumber: "4E-102", name: "Patient Room", polygon: square(0.45, 0.05, 0.3), squareFeet: 240 }),
      room({ roomNumber: "4E-07", name: "Soiled Utility", roomType: "Utility Room", polygon: square(0.05, 0.5, 0.2), squareFeet: 0 })
    ])
  };
  const built = buildPlanFromRooms(reading, { building: "", floor: "", now: "T", stamp: "s", aspect: 1.5 });

  it("redraws the plan in the house style instead of reusing the upload", () => {
    const svg = atob(String(built.plan.img).split(",")[1]);
    expect(String(built.plan.img).startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(svg).toContain('fill="#fcfdfe"');  // the same white ground a scan gets
    expect(svg).toContain('stroke="#2b3f4a"'); // the same wall colour
    // no trace of the source picture survives into the plan
    expect(svg).not.toContain("image");
    expect(String(built.plan.source)).toBe("ai-plan-read");
  });

  it("keeps the manager's own room numbers and printed areas", () => {
    expect(built.spaces.map((s) => s.roomNumber)).toEqual(["4E-101", "4E-102", "4E-07"]);
    expect(built.spaces[0].squareFeet).toBe(240);
  });

  it("measures a room the plan did not label, using the scale it derived", () => {
    const utility = built.spaces[2];
    expect(Number(utility.squareFeet)).toBeGreaterThan(0);
    // 0.2x0.2 vs the 0.3x0.3 rooms that were printed at 240 sq ft
    expect(Number(utility.squareFeet)).toBeCloseTo(240 * (0.04 / 0.09), 0);
  });

  it("sets the plan scale so nobody has to calibrate by hand", () => {
    expect(Number(built.plan.ratio)).toBeGreaterThan(0);
  });

  it("leaves the plan uncalibrated when no areas were printed", () => {
    const noAreas = buildPlanFromRooms(
      { buildingName: "B", floorName: "F", rooms: sanitizeRooms([room()]) },
      { building: "", floor: "", now: "T", stamp: "s" }
    );
    expect(noAreas.plan.ratio).toBeUndefined();
  });

  it("produces the shapes the rest of OpsMatrix already expects", () => {
    const sp = built.spaces[0];
    expect(sp).toMatchObject({
      building: "Mercy General", floor: "4 East",
      visualPlanId: built.plan.id, importSource: "ai-plan-read"
    });
    expect(Array.isArray(sp.visualPts)).toBe(true);
    expect(Number(sp.estimatedCleaningMinutes)).toBeGreaterThan(0);
    // every room is drawn on the plan, so nothing needs hand-tracing
    expect((built.plan.rooms as unknown[]).length).toBe(built.spaces.length);
    expect(built.summary.needsTracing).toBe(0);
  });

  it("lets a typed-in building and floor win over the model's reading", () => {
    const named = buildPlanFromRooms(reading, { building: "Saint Anne", floor: "2", now: "T", stamp: "s" });
    expect(named.spaces[0].building).toBe("Saint Anne");
    expect(named.spaces[0].floor).toBe("2");
  });

  it("scales the canvas to the picture's shape", () => {
    const wide = buildPlanFromRooms(reading, { building: "", floor: "", aspect: 2, size: 1000, now: "T", stamp: "s" });
    expect([wide.plan.w, wide.plan.h]).toEqual([1000, 500]);
    const tall = buildPlanFromRooms(reading, { building: "", floor: "", aspect: 0.5, size: 1000, now: "T", stamp: "s" });
    expect([tall.plan.w, tall.plan.h]).toEqual([500, 1000]);
  });
});

describe("request schema", () => {
  it("constrains the reply so a malformed answer cannot reach the app", () => {
    const s = planSchema() as { properties: Record<string, { items?: { required?: string[]; additionalProperties?: boolean; properties?: Record<string, { enum?: string[] }> } }> };
    const item = s.properties.rooms.items!;
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual(["name", "roomNumber", "squareFeet", "roomType", "polygon"]);
    expect(item.properties!.roomType.enum).toEqual(AI_ROOM_TYPES);
  });
});
