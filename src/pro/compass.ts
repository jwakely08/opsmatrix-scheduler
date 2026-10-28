// Which way the map faces (Josh, 2026-10-28): "an always point north, and then a relative option
// where it turns with me… like Google Maps", in Max Space and Rover Mode. Three ways to show a plan:
//   • As drawn — the plan as its drawing has it (the default)
//   • North up — north at the top of the screen, however the walker turns
//   • Turns with me — whatever's in front of the walker is up (the device's compass)
// A floor plan doesn't know where north is, so each building is set once on the device: face the
// way the top of the plan points and tap Set — the compass heading then is the plan's "up".

export type MapFacing = "plan" | "north" | "heading";

export const FACING_WORDS: Record<MapFacing, string> = {
  plan: "As drawn",
  north: "North up",
  heading: "Turns with me"
};

export const norm = (deg: number) => ((deg % 360) + 360) % 360;

/** the shortest signed turn from a to b, in degrees (−180…180) */
export const delta = (a: number, b: number) => ((b - a + 540) % 360) - 180;

/**
 * The heading the top of the SCREEN points: the compass gives the device's own top edge (as held
 * upright), so a landscape screen adds its turn ("landscape, home button right" = +90).
 */
export function screenHeading(deviceHeading: number, screenAngle: number): number {
  return norm(deviceHeading + screenAngle);
}

/**
 * How far to turn the map, in degrees clockwise. `planUp` is the heading the top of the plan
 * points (set once per building); `heading` the way the screen faces now.
 */
export function mapTurn(facing: MapFacing, planUp: number | null, heading: number | null): number {
  if (facing === "plan" || planUp === null) return 0;
  // north up: the plan's top sits at its own heading, clockwise from up
  if (facing === "north" || heading === null) return norm(planUp);
  // turns with me: what the walker faces is up
  return norm(planUp - heading);
}

/** where north points on the screen, degrees clockwise from up (for the compass needle) */
export function northOnScreen(turn: number, planUp: number | null): number | null {
  return planUp === null ? null : norm(turn - planUp);
}

/** compass readings jitter: ease toward each new one, across the 0/360 seam */
export function smooth(prev: number | null, next: number, k = 0.25): number {
  return prev === null ? norm(next) : norm(prev + delta(prev, next) * k);
}

export function compassWord(deg: number): string {
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(norm(deg) / 45) % 8];
}

// ── per device: how the maps face, and each building's north ────────────────

const FACING_KEY = "om_map_facing";
const NORTH_KEY = "om_map_north";

export function loadFacing(): MapFacing {
  try {
    const v = localStorage.getItem(FACING_KEY);
    return v === "north" || v === "heading" ? v : "plan";
  } catch { return "plan"; }
}

export function saveFacing(f: MapFacing) {
  try { localStorage.setItem(FACING_KEY, f); } catch { /* storage off */ }
}

export function loadPlanUp(building: string): number | null {
  try {
    const v = (JSON.parse(localStorage.getItem(NORTH_KEY) ?? "{}") ?? {})[building];
    return typeof v === "number" && Number.isFinite(v) ? norm(v) : null;
  } catch { return null; }
}

export function savePlanUp(building: string, deg: number) {
  try {
    const all = JSON.parse(localStorage.getItem(NORTH_KEY) ?? "{}") ?? {};
    all[building] = norm(deg);
    localStorage.setItem(NORTH_KEY, JSON.stringify(all));
  } catch { /* storage off */ }
}

// ── the device's compass ────────────────────────────────────────────────────

type CompassEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };

/**
 * The turn of the screen from the device's upright: 0, 90, 180 or 270. window.orientation first —
 * it's what iPad compass code pairs with webkitCompassHeading (heading + orientation) — then the
 * newer screen.orientation.
 */
function screenAngle(): number {
  const wo = (window as unknown as { orientation?: number }).orientation;
  if (typeof wo === "number" && Number.isFinite(wo)) return norm(wo);
  const so = (screen as unknown as { orientation?: { angle?: number } }).orientation;
  return norm(Number(so?.angle) || 0);
}

/** the compass heading in an orientation event (iPad: webkitCompassHeading; others: absolute alpha) */
export function eventHeading(e: { webkitCompassHeading?: number; absolute?: boolean; alpha?: number | null; type?: string }): number | null {
  if (typeof e.webkitCompassHeading === "number" && Number.isFinite(e.webkitCompassHeading)) return norm(e.webkitCompassHeading);
  if ((e.absolute || e.type === "deviceorientationabsolute") && typeof e.alpha === "number") return norm(360 - e.alpha);
  return null;
}

/** listen to the compass; `onHeading` gets the heading the top of the screen points. Returns stop. */
export function watchHeading(onHeading: (deg: number) => void): () => void {
  const on = (e: Event) => {
    const h = eventHeading(e as CompassEvent);
    if (h !== null) onHeading(screenHeading(h, screenAngle()));
  };
  window.addEventListener("deviceorientationabsolute", on);
  window.addEventListener("deviceorientation", on);
  return () => {
    window.removeEventListener("deviceorientationabsolute", on);
    window.removeEventListener("deviceorientation", on);
  };
}

/** iPad Safari asks before sharing the compass — it must be asked from a tap */
export function askCompass(): Promise<boolean> {
  const D = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
  if (D && typeof D.requestPermission === "function") {
    return D.requestPermission().then((r) => r === "granted").catch(() => false);
  }
  return Promise.resolve(typeof D !== "undefined");
}
