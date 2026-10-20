// The structured CAD importer (Josh, 2026-09-12): a facilities-managed DXF
// carries the answers as DATA — closed space polylines for room boundaries,
// and block attributes holding each room's number and usage. When that
// structure exists we don't DETECT rooms, we TRANSCRIBE them: exact shapes,
// exact numbers, exact square footage, no AI pass at all. The proving file
// is the client's FV-01 hospital first floor (858 tagged rooms, 859 space
// polylines, every tag matched) — the file itself stays out of the repo,
// like every client fixture.
//
// This module is PURE (no DOM, no canvas) so the whole pipeline is
// unit-testable and the harness can drive it in node. The browser side
// pairs it with dxfRaster.dxfToPicture, which draws the same file into the
// plan picture; polygons map into picture pixels through the SAME transform
// (dxfTransform) so the shapes land exactly on the drawn walls.
//
// DWG stays outside the app on purpose: the only open-source reader is
// GPL-licensed and the format is undocumented. DWG files get converted to
// DXF on the way in (one Save-As in any CAD tool).

export interface XY { x: number; y: number }

// ── the DXF entity reader (string-aware — dxfRaster's is numbers-only) ─────

interface RawEnt {
  type: string;
  /** last value per group code (enough for everything except vertices) */
  d: Record<number, string>;
  /** every 10/20 pair in order — polyline vertices */
  xs: number[];
  ys: number[];
}

export interface CadParse {
  /** $INSUNITS header value (0 = unitless/unknown) */
  insunits: number;
  /** closed polylines only — open ones can't be rooms */
  polys: { layer: string; pts: XY[] }[];
  texts: { layer: string; text: string; x: number; y: number }[];
  /** block inserts that carry attributes (tag → value) */
  tags: { block: string; x: number; y: number; attrs: Record<string, string> }[];
}

/** MTEXT inline formatting → plain text ("\P" is a newline; {\fArial;…}) */
export function cleanMtext(s: string): string {
  return s
    .replace(/\\P/g, " ")
    .replace(/\\[A-Za-z][^;\\{}]*;/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function readPairs(lines: string[], start: number): { ent: RawEnt; next: number } {
  const ent: RawEnt = { type: "", d: {}, xs: [], ys: [] };
  let i = start;
  while (i < lines.length - 1) {
    const code = Number(lines[i].trim());
    if (code === 0) break;
    const val = (lines[i + 1] ?? "").trim();
    if (Number.isFinite(code)) {
      if (code === 10) ent.xs.push(Number(val));
      else if (code === 20) ent.ys.push(Number(val));
      // code 1/3 can repeat (MTEXT chunks) — concatenate those, keep last otherwise
      if ((code === 1 || code === 3) && ent.d[code] !== undefined) ent.d[code] += val;
      else ent.d[code] = val;
    }
    i += 2;
  }
  return { ent, next: i };
}

/** DXF text → the structures the room builder needs. Pure. */
export function parseCad(text: string): CadParse {
  const lines = text.split(/\r\n|\r|\n/);
  const out: CadParse = { insunits: 0, polys: [], texts: [], tags: [] };
  let i = 0;
  let pendingInsert: CadParse["tags"][0] | null = null;

  // $INSUNITS lives in the HEADER section as 9/$INSUNITS then 70/value
  for (let k = 0; k < lines.length - 3 && k < 4000; k += 2) {
    if (lines[k].trim() === "9" && lines[k + 1].trim() === "$INSUNITS") {
      out.insunits = Number(lines[k + 3]?.trim()) || 0;
      break;
    }
  }

  const flushInsert = () => {
    if (pendingInsert && Object.keys(pendingInsert.attrs).length) out.tags.push(pendingInsert);
    pendingInsert = null;
  };

  while (i < lines.length - 1) {
    const code = lines[i].trim();
    const value = (lines[i + 1] ?? "").trim();
    i += 2;
    if (code !== "0") continue;

    if (value === "LWPOLYLINE") {
      flushInsert();
      const { ent, next } = readPairs(lines, i);
      i = next;
      const closed = (Number(ent.d[70] ?? 0) & 1) === 1;
      const pts = ent.xs.map((x, k) => ({ x, y: ent.ys[k] })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (closed && pts.length >= 3) out.polys.push({ layer: ent.d[8] ?? "", pts });
    } else if (value === "POLYLINE") {
      flushInsert();
      const head = readPairs(lines, i);
      i = head.next;
      const closed = (Number(head.ent.d[70] ?? 0) & 1) === 1;
      const pts: XY[] = [];
      while (i < lines.length - 1) {
        const c2 = lines[i].trim(), v2 = (lines[i + 1] ?? "").trim();
        if (c2 !== "0") { i += 2; continue; }
        if (v2 === "VERTEX") {
          i += 2;
          const { ent, next } = readPairs(lines, i);
          i = next;
          if (ent.xs.length && ent.ys.length) pts.push({ x: ent.xs[0], y: ent.ys[0] });
        } else if (v2 === "SEQEND") { i += 2; break; }
        else break;
      }
      if (closed && pts.length >= 3) out.polys.push({ layer: head.ent.d[8] ?? "", pts });
    } else if (value === "TEXT" || value === "MTEXT") {
      flushInsert();
      const { ent, next } = readPairs(lines, i);
      i = next;
      const t = cleanMtext(String(ent.d[1] ?? "")); // TEXT is already plain; cleaning is a no-op
      if (t && ent.xs.length) out.texts.push({ layer: ent.d[8] ?? "", text: t, x: ent.xs[0], y: ent.ys[0] ?? 0 });
    } else if (value === "INSERT") {
      flushInsert();
      const { ent, next } = readPairs(lines, i);
      i = next;
      pendingInsert = { block: ent.d[2] ?? "", x: ent.xs[0] ?? 0, y: ent.ys[0] ?? 0, attrs: {} };
    } else if (value === "ATTRIB") {
      const { ent, next } = readPairs(lines, i);
      i = next;
      if (pendingInsert) {
        const tag = (ent.d[2] ?? "").trim();
        const val = cleanMtext(String(ent.d[1] ?? ""));
        if (tag) pendingInsert.attrs[tag] = val;
      }
    } else if (value === "SEQEND") {
      flushInsert();
    } else if (value !== "VERTEX") {
      flushInsert();
    }
  }
  flushInsert();
  return out;
}

// ── geometry ────────────────────────────────────────────────────────────────

export function polyArea(pts: XY[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s / 2);
}

export function pointInPts(pts: XY[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// ── units: $INSUNITS → feet per drawing unit ───────────────────────────────

const UNIT_FT: Record<number, number> = {
  1: 1 / 12,      // inches (the architectural-imperial standard)
  2: 1,           // feet
  4: 0.00328084,  // mm
  5: 0.0328084,   // cm
  6: 3.28084      // m
};

/**
 * Feet per drawing unit. When the header doesn't say (INSUNITS 0/unknown),
 * pick the interpretation that makes the median candidate room land in a
 * believable band — hospital rooms are ~40–1000 sq ft, not 0.4 or 40,000.
 */
export function unitFtPerUnit(insunits: number, medianAreaUnits2: number): number {
  if (UNIT_FT[insunits]) return UNIT_FT[insunits];
  for (const ft of [1 / 12, 1, 0.00328084, 3.28084, 0.0328084]) {
    const sqft = medianAreaUnits2 * ft * ft;
    if (sqft >= 30 && sqft <= 2000) return ft;
  }
  return 1 / 12; // the most common architectural convention
}

// ── room-tag recognition ────────────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

export function isNumberTag(tag: string): boolean {
  const n = norm(tag);
  return /^(room(no|num(ber)?)|rm(no|num|number)|number|roomid)$/.test(n) ||
    (n.includes("room") && (n.includes("num") || n.endsWith("no")));
}

export function isNameTag(tag: string): boolean {
  const n = norm(tag);
  return n.includes("usage") || n.includes("use") ||
    /^(room)?(name|desc(ription)?)$/.test(n) ||
    (n.includes("room") && (n.includes("name") || n.includes("desc")));
}

/** CAD usage abbreviations → the packaged Scope room-type label ("" = let
 *  the manager decide). Conservative on purpose: a wrong type silently
 *  mis-prices a room; "Needs review" never does. */
export function cadUsageToScopeLabel(usage: string): string {
  const u = " " + String(usage ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim() + " ";
  const has = (re: RegExp) => re.test(u);
  if (has(/ (PAT|PATIENT) (RM|ROOM) /) || has(/ ISO (PAT|ROOM) /)) return "Patient Room";
  if (has(/ (TLT|TOILET|RESTROOM|LAV|WC) /)) return "Restroom";
  if (has(/ CORR /)) return "Corridor";
  if (has(/ HALL(WAY)? /)) return "Hallway";
  if (has(/ EXAM /)) return "Exam Room";
  if (has(/ (PROC|PROCEDURE) /)) return "Procedure Room";
  if (has(/ (OR|OPERATING) (RM|ROOM|\d) /) || has(/ ^ ?O R /)) return "Operating Room";
  if (has(/ (TRAUMA|EMERG(ENCY)?) /)) return "Emergency Room";
  if (has(/ (OFF|OFFICE|CONF|CONFERENCE|WORK (AREA|RM|ROOM)) /)) return "Office";
  if (has(/ LOBBY /)) return "Lobby";
  if (has(/ (WAIT|WAITING) /)) return "Waiting Room";
  if (has(/ (LOUNGE|BREAK (RM|ROOM)) /)) return "Lounge";
  if (has(/ (STOR|STORAGE|CLST|CLOSET) /)) return "Storage";
  if (has(/ ELEC(T(RICAL)?)? /)) return "Electrical Room";
  if (has(/ MECH(ANICAL)? /)) return "Mechanical Room";
  if (has(/ (DATA|TELECOM|TELE|IT (RM|ROOM)) /)) return "Data / Telecom Room";
  if (has(/ SHAFT /)) return "Shaft";
  if (has(/ STAIR /)) return "Stairwell";
  if (has(/ ELEV(ATOR)? /)) return "Elevator";
  // soiled utility keeps its own words in the NAME (Max Sanitation matches
  // /soil/i on the room name) — the TYPE still lands as Utility Room
  if (has(/ (UTIL(ITY)?|SOIL(ED)?|EVS|JAN(ITOR)?|HSKP|HOUSEKEEPING) /)) return "Utility Room";
  if (has(/ LOCKER /)) return "Locker Room";
  return "";
}

// ── the room builder ────────────────────────────────────────────────────────

export interface CadRoom {
  /** DXF drawing coordinates (y UP) — map with dxfTransform for pictures */
  pts: XY[];
  roomNumber: string;
  roomName: string;
  /** mapped Scope label ("" = needs review) */
  roomType: string;
  sqFt: number;
  layer: string;
}

export interface CadRoomsResult {
  rooms: CadRoom[];
  /** feet per drawing unit used for areas */
  ftPerUnit: number;
  /** how many tags never landed in a boundary (file quality signal) */
  orphanTags: number;
  /** untagged boundary polylines kept from the winning layer */
  unlabeled: number;
}

/**
 * Turn a parsed CAD file into rooms. The rules, in order:
 * 1. candidates = closed polylines whose area is room-plausible;
 * 2. every tag (block attrs first, free text as fallback) lands in the
 *    SMALLEST candidate containing it;
 * 3. tagged candidates are rooms. Untagged candidates survive only on the
 *    layer that won the most tags — that's the drawing's space layer, and
 *    its leftovers are real unlabeled spaces, not furniture outlines.
 */
export function buildCadRooms(parsed: CadParse): CadRoomsResult {
  const areas = parsed.polys.map((p) => polyArea(p.pts)).sort((a, b) => a - b);
  const median = areas[Math.floor(areas.length / 2)] ?? 0;
  const ftPerUnit = unitFtPerUnit(parsed.insunits, median);
  const ft2 = ftPerUnit * ftPerUnit;

  const cands = parsed.polys
    .map((p) => ({ ...p, area: polyArea(p.pts), tags: [] as { num: string; name: string }[] }))
    .filter((p) => {
      const sqft = p.area * ft2;
      return sqft >= 10 && sqft <= 60000;
    });

  // labels: block-attribute tags first (the strong signal)
  const labels: { num: string; name: string; x: number; y: number; strong: boolean }[] = [];
  for (const t of parsed.tags) {
    let num = "", name = "";
    for (const [tag, val] of Object.entries(t.attrs)) {
      if (!num && isNumberTag(tag)) num = val.trim();
      if (!name && isNameTag(tag)) name = val.trim();
    }
    if (num || name) labels.push({ num, name, x: t.x, y: t.y, strong: true });
  }
  // free text is only a fallback signal — grid bubbles and notes live there too
  for (const t of parsed.texts) {
    const s = t.text.trim();
    if (!s || s.length > 40) continue;
    const numish = /^[A-Z]{0,4}[-.]?\d{1,5}[A-Z]?$/i.test(s);
    labels.push(numish ? { num: s, name: "", x: t.x, y: t.y, strong: false }
      : { num: "", name: s, x: t.x, y: t.y, strong: false });
  }

  // matching runs TWICE. Pass 1 lets every label claim the smallest
  // containing candidate and the strong tags VOTE for the space layer.
  // Pass 2 rematches with that layer preferred — without it, a room tag
  // sitting over a desk claims the desk's outline (smaller container) and
  // the real boundary goes unlabeled; FV-01 lost 44 rooms to exactly that.
  let orphanTags = 0;
  const match = (preferLayer?: string) => {
    for (const c of cands) c.tags = [];
    orphanTags = 0;
    for (const lb of labels) {
      let hits = cands.filter((c) => pointInPts(c.pts, lb.x, lb.y));
      if (preferLayer !== undefined) {
        const onLayer = hits.filter((c) => c.layer === preferLayer);
        if (onLayer.length) hits = onLayer;
      }
      if (!hits.length) { if (lb.strong) orphanTags++; continue; }
      hits.sort((a, b) => a.area - b.area);
      const c = hits[0];
      // strong labels lead; weak text only fills holes
      if (lb.strong) c.tags.unshift({ num: lb.num, name: lb.name });
      else if (!c.tags.length) c.tags.push({ num: lb.num, name: lb.name });
      else {
        // merge a weak label's missing half into an existing weak tag
        const t0 = c.tags[0];
        if (!t0.num && lb.num) t0.num = lb.num;
        if (!t0.name && lb.name) t0.name = lb.name;
      }
    }
  };
  match();
  const layerWins: Record<string, number> = {};
  let matchedTags = 0;
  for (const c of cands) if (c.tags.length) {
    layerWins[c.layer] = (layerWins[c.layer] ?? 0) + 1;
    matchedTags++;
  }
  const top = Object.entries(layerWins).sort((a, b) => b[1] - a[1])[0];
  const spaceLayer = top?.[0];
  // a clear majority layer = the drawing HAS a space layer — trust it
  if (top && matchedTags > 0 && top[1] >= matchedTags * 0.5) match(spaceLayer);

  const rooms: CadRoom[] = [];
  let unlabeled = 0;
  for (const c of cands) {
    if (!c.tags.length) {
      if (c.layer !== spaceLayer || spaceLayer === undefined) continue;
      unlabeled++;
    }
    const t = c.tags[0] ?? { num: "", name: "" };
    rooms.push({
      pts: c.pts,
      roomNumber: t.num,
      roomName: t.name,
      roomType: cadUsageToScopeLabel(t.name),
      sqFt: Math.round(c.area * ft2),
      layer: c.layer
    });
  }
  return { rooms, ftPerUnit, orphanTags, unlabeled };
}

/** how confident are we that this file carries REAL room data? The upload
 *  flow skips the AI read entirely above this bar. */
export function cadLooksStructured(r: CadRoomsResult): boolean {
  const numbered = r.rooms.filter((x) => x.roomNumber).length;
  return numbered >= 5 && numbered >= r.rooms.length * 0.5;
}
