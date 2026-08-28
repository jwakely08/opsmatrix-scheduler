// Read a floor plan PICTURE with Claude Fable 5 and rebuild it as an
// OpsMatrix plan.
//
// The uploaded file (PDF page, photo, screenshot, coloured architectural
// export) is INPUT ONLY. We never show it back to the manager: whatever the
// source looked like — colour fills, furniture, title blocks, legends,
// dimension strings — the plan that lands in OpsMatrix is redrawn in the same
// clean house style as a magicplan import, so every plan in the app looks and
// behaves identically no matter how it arrived.
//
// What the model is asked for, and why:
//   • room outline, normalised 0..1  → we redraw it ourselves
//   • room number / name             → the manager's own labels, not guesses
//   • printed square footage         → when the plan states it, we trust it
//                                      and skip measuring entirely
//   • room type                      → drives cleaning rates
import { guessType, estimateMinutes, type ImportResult } from "./fusionEntry";

export const AI_MODEL = "claude-fable-5";
const API_URL = "https://api.anthropic.com/v1/messages";

/** Room types the model may choose from — the classic rate table's own keys. */
export const AI_ROOM_TYPES = [
  "Patient Room", "Isolation Room", "Exam Room", "OR Room", "ER Room",
  "Corridor", "Restroom", "Office", "Storage", "Lobby", "Utility Room",
  "Break Room", "Waiting Room", "Nurses Station", "Conference Room", "Other"
];

export interface AiRoom {
  name: string;
  roomNumber: string;
  /** as printed on the plan; 0 when the plan does not state it */
  squareFeet: number;
  roomType: string;
  /** closed outline in image space, normalised 0..1 (x right, y down) */
  polygon: number[][];
}

export interface AiPlanReading {
  floorName: string;
  buildingName: string;
  rooms: AiRoom[];
}

/** JSON schema — structured outputs, so the reply cannot come back malformed */
export function planSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      buildingName: { type: "string" },
      floorName: { type: "string" },
      rooms: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            roomNumber: { type: "string" },
            squareFeet: { type: "number" },
            roomType: { type: "string", enum: AI_ROOM_TYPES },
            polygon: {
              type: "array",
              items: { type: "array", items: { type: "number" } }
            }
          },
          required: ["name", "roomNumber", "squareFeet", "roomType", "polygon"],
          additionalProperties: false
        }
      }
    },
    required: ["buildingName", "floorName", "rooms"],
    additionalProperties: false
  };
}

export const PLAN_PROMPT = [
  "You are reading an architectural floor plan for a hospital cleaning system.",
  "This may be a professional CAD sheet: coloured room fills, furniture in",
  "every room, door swings, grid bubbles, dimension strings. Work from the",
  "wall lines and the printed room tags only.",
  "",
  "Trace the CLEANABLE FLOOR AREA of every enclosed room on this plan.",
  "",
  "EVERY ROOM SEPARATELY. Each enclosed room — every exam room, office,",
  "toilet, storage closet — is its own entry with its own outline. Never merge",
  "a row of rooms into one zone, and never return a department or wing as one",
  "big shape: if a large label covers an area that visibly contains smaller",
  "walled rooms, return the smaller rooms. Outlines must not overlap.",
  "",
  "Ignore everything that is not a room boundary: colour fills and shading,",
  "furniture, fixtures, beds, equipment symbols, door swings, north arrows,",
  "title blocks, legends, keys, scale bars, dimension lines and their text,",
  "and any surrounding page whitespace. Colour never means anything — a room",
  "shaded blue and a room shaded pink are both just rooms.",
  "",
  "For each room return:",
  "• polygon — the inside face of its walls as a closed outline, in normalised",
  "  image coordinates where [0,0] is the top-left of the image and [1,1] is",
  "  the bottom-right. Use as many points as the shape needs; follow L-shapes",
  "  and alcoves rather than approximating everything to a rectangle. Do not",
  "  let polygons overlap each other.",
  "  Coordinates MUST be decimal fractions between 0.0 and 1.0 — for example",
  "  [[0.12, 0.30], [0.35, 0.30], [0.35, 0.55], [0.12, 0.55]]. Never use pixel",
  "  positions or 0–100 or 0–1000 scales.",
  "• roomNumber — the number or code printed in or beside the room (e.g.",
  "  \"4E-102\", \"212\"). If the plan prints no number, return an empty string —",
  "  the manager fills numbers in later. Never invent one.",
  "• name — the printed room name (e.g. \"Patient Room\", \"Soiled Utility\").",
  "  If only a number is printed, repeat the number here.",
  "• squareFeet — ONLY if an area is printed for that room on the plan. Copy",
  "  the printed figure. If no area is printed, return 0 — do not estimate.",
  "• roomType — the closest match from the allowed list.",
  "",
  "Include corridors and hallways: they are cleaned too. Exclude anything",
  "outside the building envelope, and exclude shafts, chases and stairwells",
  "that are not cleaned floor area.",
  "",
  "Return every room you can see. Do not stop early."
].join("\n");

// ── pass 1: find the drawing on the sheet ───────────────────────────────────
// Architect sheets bury the plan in a page of title blocks, legends, detail
// views and margin. Read the whole sheet and the room tags are a few pixels
// tall — unreadable, which comes back as a handful of coarse "zones". So the
// reader works like a person: find the drawing first, then lean in close.

export interface DrawingBox { x0: number; y0: number; x1: number; y1: number }

export function boxSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      x0: { type: "number" }, y0: { type: "number" },
      x1: { type: "number" }, y1: { type: "number" }
    },
    required: ["x0", "y0", "x1", "y1"],
    additionalProperties: false
  };
}

export const LOCATE_PROMPT = [
  "This image is a page that contains an architectural floor plan, possibly",
  "surrounded by a title block, legends, notes, schedules, detail views and",
  "blank margin.",
  "",
  "Return the bounding box of the MAIN FLOOR PLAN DRAWING only — the walls",
  "and rooms — excluding the title block, legends, keys, notes, north arrows,",
  "scale bars, elevation/detail views and empty margin.",
  "",
  "Coordinates are fractions of the image between 0.0 and 1.0: x0,y0 is the",
  "box's top-left corner, x1,y1 its bottom-right. Include the whole drawing",
  "with a small margin rather than cutting any of it off."
].join("\n");

/** clamp/repair a located box; null when it is unusable */
export function sanitizeBox(box: Partial<DrawingBox> | null | undefined): DrawingBox | null {
  if (!box) return null;
  let { x0, y0, x1, y1 } = box as DrawingBox;
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  // undo a pixel/percent scale the same way room outlines are rescued
  const maxC = Math.max(Math.abs(x0), Math.abs(y0), Math.abs(x1), Math.abs(y1));
  if (maxC > 1.5) {
    const d = maxC <= 150 ? 100 : maxC <= 1500 ? 1000 : maxC;
    x0 /= d; y0 /= d; x1 /= d; y1 /= d;
  }
  const c = (n: number) => Math.min(1, Math.max(0, n));
  const bx: DrawingBox = {
    x0: c(Math.min(x0, x1)), y0: c(Math.min(y0, y1)),
    x1: c(Math.max(x0, x1)), y1: c(Math.max(y0, y1))
  };
  // too small to be the plan, or so large that cropping is pointless
  if (bx.x1 - bx.x0 < 0.12 || bx.y1 - bx.y0 < 0.12) return null;
  if (bx.x1 - bx.x0 > 0.97 && bx.y1 - bx.y0 > 0.97) return null;
  return bx;
}

/** grow the box slightly so a tight answer never clips a wall */
export function padBox(box: DrawingBox, pad = 0.02): DrawingBox {
  return {
    x0: Math.max(0, box.x0 - pad), y0: Math.max(0, box.y0 - pad),
    x1: Math.min(1, box.x1 + pad), y1: Math.min(1, box.y1 + pad)
  };
}

/**
 * How a request reaches Claude. Two transports, decided per call:
 *   • DIRECT (default, unchanged): the user's own key from this device,
 *     straight to api.anthropic.com — the standalone/demo mode.
 *   • PROXY (cloud builds, signed-in): the server-side claude-proxy edge
 *     function — the ORG's key lives on the server, the browser sends only
 *     its session token, usage is metered per organization.
 */
export interface AiProxy { url: string; token: string }

export function anthropicRequest(apiKey: string, proxy?: AiProxy | null, feature?: string): {
  url: string; headers: Record<string, string>;
} {
  if (proxy && proxy.url) {
    return {
      url: proxy.url,
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer " + proxy.token,
        "anthropic-version": "2023-06-01",
        ...(feature ? { "x-opsmatrix-feature": feature } : {})
      }
    };
  }
  return {
    url: API_URL,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey.trim(),
      "anthropic-version": "2023-06-01",
      // required for calling the API straight from a browser page
      "anthropic-dangerous-direct-browser-access": "true"
    }
  };
}

/** ask where the drawing is; null (never a throw) when it cannot say */
export async function locateDrawing(
  opts: Pick<ReadPlanOptions, "apiKey" | "imageDataUrl" | "model" | "signal" | "proxy">
): Promise<DrawingBox | null> {
  try {
    const { mediaType, data } = splitDataUrl(opts.imageDataUrl);
    const t = anthropicRequest(opts.apiKey, opts.proxy, "plan-locate");
    const res = await fetch(t.url, {
      method: "POST",
      signal: opts.signal,
      headers: t.headers,
      body: JSON.stringify({
        model: opts.model || AI_MODEL,
        max_tokens: 2000,
        output_config: { effort: "low", format: { type: "json_schema", schema: boxSchema() } },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data } },
            { type: "text", text: LOCATE_PROMPT }
          ]
        }]
      })
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.stop_reason === "refusal") return null;
    const text = (json.content || [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text).join("");
    return sanitizeBox(JSON.parse(text));
  } catch {
    return null; // the crop is an optimisation — never fail the import over it
  }
}

/** a rendered picture of the plan (or a region of it) */
export interface PlanPicture {
  dataUrl: string;
  width: number;
  height: number;
  aspect: number;
}

export interface ReadPlanOptions {
  apiKey: string;
  /** cloud builds: route through the server-side proxy instead of the key */
  proxy?: AiProxy | null;
  /** the plan picture, as a data URL (PNG/JPEG) */
  imageDataUrl: string;
  /** pixel size of that picture — lets pixel-scale answers be undone exactly */
  imageWidth?: number;
  imageHeight?: number;
  building?: string;
  floor?: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

/** thrown with a plain-English message the UI can show as-is */
export class AiPlanError extends Error {}

function splitDataUrl(dataUrl: string): { mediaType: string; data: string } {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) throw new AiPlanError("That image could not be read.");
  return { mediaType: m[1], data: m[2] };
}

/** Ask Fable 5 to read the plan. Network only — no drawing happens here. */
export async function readPlanWithAI(opts: ReadPlanOptions): Promise<AiPlanReading> {
  const key = (opts.apiKey || "").trim();
  if (!key && !opts.proxy) {
    throw new AiPlanError(
      "No Anthropic API key saved yet. Add one under Admin Settings → Max AI, then try again."
    );
  }
  const { mediaType, data } = splitDataUrl(opts.imageDataUrl);
  opts.onProgress?.("Max is reading your floor plan…");

  const t = anthropicRequest(key, opts.proxy, "plan-read");
  let res: Response;
  try {
    res = await fetch(t.url, {
      method: "POST",
      signal: opts.signal,
      headers: t.headers,
      body: JSON.stringify({
        model: opts.model || AI_MODEL,
        max_tokens: 16000,
        // Fable 5 thinks by default; effort is the depth control. No
        // temperature/top_p — that model rejects sampling parameters.
        output_config: {
          effort: opts.effort || "high",
          format: { type: "json_schema", schema: planSchema() }
        },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data } },
            { type: "text", text: PLAN_PROMPT }
          ]
        }]
      })
    });
  } catch (e) {
    throw new AiPlanError("Could not reach Claude. Check the internet connection and try again.");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AiPlanError(explainHttpError(res.status, body));
  }

  const json = await res.json();
  if (json.stop_reason === "refusal") {
    throw new AiPlanError("Claude declined to read that image. Try a different export of the plan.");
  }
  const text = (json.content || [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("");
  if (!text.trim()) {
    throw new AiPlanError("Claude returned nothing readable. Try again, or use a clearer image.");
  }

  let parsed: AiPlanReading;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AiPlanError("Claude's answer was not readable. Try again.");
  }
  const rooms = sanitizeRooms(normalizeCoordinateScale(parsed.rooms, {
    width: opts.imageWidth, height: opts.imageHeight
  }));
  if (!rooms.length) {
    // two very different situations — say which one happened
    const reported = Array.isArray(parsed.rooms) ? parsed.rooms.length : 0;
    throw new AiPlanError(reported > 0
      ? `Claude found ${reported} rooms but their outlines were unusable. Try again — if it repeats, send a sharper export of the plan.`
      : "No rooms could be found on that image. Make sure the whole plan is visible and the walls are legible.");
  }
  const kept = dropZoneWrappers(rooms);
  opts.onProgress?.(`Found ${kept.length} rooms — drawing the plan…`);
  return {
    buildingName: (parsed.buildingName || "").trim(),
    floorName: (parsed.floorName || "").trim(),
    rooms: kept
  };
}

/**
 * A model that read a department label sometimes returns the whole department
 * as one giant "room" wrapped around the real ones. A wrapper is recognisable:
 * far larger than the typical room AND holding several other rooms' centres
 * inside it. Corridors are long and thin, so they never match both tests.
 */
export function dropZoneWrappers(rooms: AiRoom[]): AiRoom[] {
  if (rooms.length < 4) return rooms;
  const areas = rooms.map((r) => Math.abs(polygonArea(r.polygon)));
  const sorted = [...areas].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  if (median <= 0) return rooms;
  return rooms.filter((r, i) => {
    if (areas[i] <= 6 * median) return true;
    let contained = 0;
    for (let j = 0; j < rooms.length; j++) {
      if (j === i) continue;
      const c = centroid(rooms[j].polygon);
      if (pointInPolygon(r.polygon, c[0], c[1])) contained++;
    }
    return contained < 3;
  });
}

function centroid(poly: number[][]): number[] {
  let x = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; }
  return [x / poly.length, y / poly.length];
}

function pointInPolygon(poly: number[][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if ((poly[i][1] > y) !== (poly[j][1] > y) &&
      x < ((poly[j][0] - poly[i][0]) * (y - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) {
      inside = !inside;
    }
  }
  return inside;
}

function explainHttpError(status: number, body: string): string {
  if (status === 401) return "That API key was rejected. Check it under Admin Settings → Max AI.";
  if (status === 400 && /retention/i.test(body)) {
    return "Claude Fable 5 needs 30-day data retention enabled on the Anthropic account.";
  }
  if (status === 429) return "Claude is rate limited right now. Wait a moment and try again.";
  if (status >= 500) return "Claude is having trouble right now. Try again in a moment.";
  return `Claude could not read the plan (error ${status}).`;
}

/**
 * Models sometimes ignore the coordinate instruction and answer in pixels or
 * a 0–100 / 0–1000 scale. Clamping those into 0..1 collapses every room to a
 * corner dot and the whole reading dies as "no rooms found" — which is
 * exactly what a perfectly readable plan looks like when this is skipped.
 * The scale is a property of the whole answer, so it is detected across ALL
 * rooms and undone with one divisor, never per-room.
 */
export function normalizeCoordinateScale(
  rooms: AiRoom[] | undefined,
  image?: { width?: number; height?: number }
): AiRoom[] {
  if (!Array.isArray(rooms)) return [];
  let maxC = 0;
  for (const r of rooms) {
    if (!r || !Array.isArray(r.polygon)) continue;
    for (const p of r.polygon) {
      if (!Array.isArray(p)) continue;
      if (Number.isFinite(p[0])) maxC = Math.max(maxC, Math.abs(p[0]));
      if (Number.isFinite(p[1])) maxC = Math.max(maxC, Math.abs(p[1]));
    }
  }
  if (maxC <= 1.5) return rooms; // already normalised (tiny overshoot is clamped later)

  let dx: number, dy: number;
  const imgLong = Math.max(image?.width ?? 0, image?.height ?? 0);
  if (imgLong > 0 && maxC > imgLong * 0.5 && maxC <= imgLong * 1.2) {
    // pixel coordinates on the picture we sent — divide each axis by its size
    dx = image!.width || imgLong;
    dy = image!.height || imgLong;
  } else if (maxC <= 150) {
    dx = dy = 100;         // percentages
  } else if (maxC <= 1500) {
    dx = dy = 1000;        // permille, a common habit
  } else {
    dx = dy = maxC;        // unknown pixel scale — same divisor keeps the shape
  }
  return rooms.map((r) => (!r || !Array.isArray(r.polygon)) ? r : {
    ...r,
    polygon: r.polygon.map((p) =>
      Array.isArray(p) ? [Number(p[0]) / dx, Number(p[1]) / dy] : p)
  });
}

/** drop anything unusable; clamp coordinates into the image */
export function sanitizeRooms(rooms: AiRoom[] | undefined): AiRoom[] {
  if (!Array.isArray(rooms)) return [];
  const out: AiRoom[] = [];
  for (const r of rooms) {
    if (!r || !Array.isArray(r.polygon)) continue;
    const poly = r.polygon
      .filter((p) => Array.isArray(p) && p.length >= 2 &&
        Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map((p) => [clamp01(p[0]), clamp01(p[1])] as number[]);
    if (poly.length < 3) continue;
    if (Math.abs(polygonArea(poly)) < 1e-6) continue; // degenerate sliver
    const name = String(r.name ?? "").trim();
    // a plan with no printed numbers is normal: the number stays BLANK so the
    // manager can type their own later — it is never faked from the name
    const number = String(r.roomNumber ?? "").trim();
    if (!name && !number) continue;
    const sqft = Number(r.squareFeet);
    out.push({
      name: name || number,
      roomNumber: number,
      squareFeet: Number.isFinite(sqft) && sqft > 0 ? sqft : 0,
      roomType: AI_ROOM_TYPES.includes(r.roomType) ? r.roomType : "",
      polygon: poly
    });
  }
  return out;
}

function clamp01(n: number): number { return n < 0 ? 0 : n > 1 ? 1 : n; }

/** shoelace area of a normalised polygon */
export function polygonArea(poly: number[][]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  return a / 2;
}

/**
 * Pixels-per-foot implied by the rooms whose area the plan printed. Using the
 * MEDIAN keeps one mis-read label from skewing the whole plan's scale. Null
 * when the plan printed no areas — then the manager still calibrates by hand.
 */
export function derivePxPerFt(rooms: AiRoom[], planW: number, planH: number): number | null {
  const ratios: number[] = [];
  for (const r of rooms) {
    if (!r.squareFeet) continue;
    const areaPx = Math.abs(polygonArea(r.polygon)) * planW * planH;
    if (areaPx <= 0) continue;
    ratios.push(Math.sqrt(areaPx / r.squareFeet));
  }
  if (!ratios.length) return null;
  ratios.sort((a, b) => a - b);
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return Number.isFinite(median) && median > 0 ? median : null;
}

export interface BuildPlanOptions {
  building: string;
  floor: string;
  /** long edge of the rebuilt plan, in pixels */
  size?: number;
  /** aspect ratio (width / height) of the source image */
  aspect?: number;
  now?: string;
  stamp?: string;
}

/**
 * Redraw the rooms as an OpsMatrix plan: the same white ground and solid dark
 * wall mass a magicplan import produces, so a plan read from a photo is
 * indistinguishable from a scanned one once it is in the app.
 */
export function buildPlanFromRooms(
  reading: AiPlanReading,
  opts: BuildPlanOptions
): ImportResult {
  const aspect = opts.aspect && opts.aspect > 0 ? opts.aspect : 1.4;
  const size = opts.size ?? 1400;
  const w = aspect >= 1 ? size : Math.round(size * aspect);
  const h = aspect >= 1 ? Math.round(size / aspect) : size;
  const now = opts.now ?? new Date().toISOString();
  const stamp = opts.stamp ?? Date.now().toString(36);
  const building = opts.building.trim() || reading.buildingName || "Main Building";
  const floorName = opts.floor.trim() || reading.floorName || "1st Floor";
  const planId = `ai-${slug(building)}-${slug(floorName)}-${stamp}`;

  // wall thickness follows the plan's real scale (~5–6 inches of wall) so a
  // dense clinic floor is not blotted out by cartoon-fat walls; without a
  // scale, stay thin — thin walls on a sparse plan still read fine
  const pxPerFtEarly = derivePxPerFt(reading.rooms, w, h);
  const WALL = pxPerFtEarly
    ? Math.max(3, Math.min(11, Math.round(pxPerFtEarly * 0.45)))
    : 5;
  const toPx = (p: number[]) => ({ x: Math.round(p[0] * w * 10) / 10, y: Math.round(p[1] * h * 10) / 10 });

  const roomPaths = reading.rooms
    .map((r) => r.polygon.map((p, i) => {
      const q = toPx(p);
      return `${i === 0 ? "M" : "L"}${q.x} ${q.y}`;
    }).join(" ") + " Z");

  // walls: stroke every room outline in the house wall colour, then knock the
  // floors back out in white — gives a solid wall mass exactly like a scan
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="#fcfdfe"/>` +
    roomPaths.map((d) =>
      `<path d="${d}" fill="none" stroke="#2b3f4a" stroke-width="${WALL}" stroke-linejoin="round"/>`).join("") +
    roomPaths.map((d) => `<path d="${d}" fill="#ffffff"/>`).join("") +
    `</svg>`;
  const img = "data:image/svg+xml;base64," + b64(svg);

  const pxPerFt = pxPerFtEarly;

  const spaces = reading.rooms.map((r, i) => {
    const guessed = guessType(r.name || r.roomNumber);
    const type = r.roomType || guessed.type;
    // printed area wins; otherwise measure the shape once we know the scale
    const sqft = r.squareFeet ||
      (pxPerFt ? Math.round((Math.abs(polygonArea(r.polygon)) * w * h) / (pxPerFt * pxPerFt)) : 0);
    const pts = r.polygon.map(toPx);
    return {
      id: `sp-ai-${stamp}-${i}`,
      roomNumber: r.roomNumber,
      roomName: r.name,
      building,
      floor: floorName,
      department: "",
      roomType: type,
      floorType: "",
      squareFeet: Math.round(sqft * 100) / 100,
      fixtureCount: guessed.fixtures,
      cleaningFrequency: "Daily",
      priorityLevel: "Medium",
      estimatedCleaningMinutes: estimateMinutes(type, sqft, guessed.fixtures),
      importSource: "ai-plan-read",
      updatedAt: now,
      floorPlanId: planId,
      visualPlanId: planId,
      visualBuilding: building,
      visualFloor: floorName,
      visualW: w,
      visualH: h,
      visualPts: pts,
      visualUpdatedAt: now
    } as Record<string, unknown>;
  });

  const plan: Record<string, unknown> = {
    id: planId,
    building,
    floor: floorName,
    img,
    w,
    h,
    createdAt: now,
    source: "ai-plan-read",
    rooms: spaces.map((sp) => ({ spaceId: sp.id, pts: sp.visualPts }))
  };
  // a scale derived from printed areas means nobody has to measure by hand
  if (pxPerFt) plan.ratio = pxPerFt;

  const measured = reading.rooms.filter((r) => r.squareFeet > 0).length;
  return {
    plan,
    spaces,
    summary: {
      rooms: spaces.length,
      autoDetected: spaces.length,
      needsTracing: 0,
      cleanableSqFt: spaces.reduce((s, sp) => s + (Number(sp.squareFeet) || 0), 0),
      grossSqFt: null,
      // extra, ignored by the classic summary consumers
      ...(({ printedAreas: measured, pxPerFt }) as object)
    } as ImportResult["summary"]
  };
}

/**
 * The whole job: picture in, finished OpsMatrix plan out. Two passes when the
 * caller can re-render regions: first find the drawing on the sheet, then
 * read the rooms from a full-resolution crop of just the drawing — the
 * difference between reading a blueprint at arm's length and leaning in.
 */
export async function importPlanFromImage(
  opts: ReadPlanOptions & {
    aspect?: number;
    /** re-render a region of the source at a target long edge, losslessly for PDFs */
    renderRegion?: (box: DrawingBox, targetLongEdge: number) => Promise<PlanPicture>;
  }
): Promise<ImportResult> {
  let picture: PlanPicture = {
    dataUrl: opts.imageDataUrl,
    width: opts.imageWidth ?? 0,
    height: opts.imageHeight ?? 0,
    aspect: opts.aspect ?? 1.4
  };

  if (opts.renderRegion) {
    opts.onProgress?.("Finding the drawing on the sheet…");
    const box = await locateDrawing(opts);
    if (box) {
      try {
        picture = await opts.renderRegion(padBox(box), 2576);
        opts.onProgress?.("Zooming in on the plan…");
      } catch { /* cropping is an optimisation — fall back to the full sheet */ }
    }
  }

  const reading = await readPlanWithAI({
    ...opts,
    imageDataUrl: picture.dataUrl,
    imageWidth: picture.width || undefined,
    imageHeight: picture.height || undefined
  });
  return buildPlanFromRooms(reading, {
    building: opts.building || "",
    floor: opts.floor || "",
    aspect: picture.aspect
  });
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function b64(s: string): string {
  if (typeof btoa === "function") return btoa(unescape(encodeURIComponent(s)));
  return Buffer.from(s, "utf8").toString("base64");
}
