// The MANUAL adapter's import: a room list as CSV (or pasted spreadsheet
// rows) becomes spaces — and, when the file carries them, status signals.
// Pure and tested. Header matching is forgiving (Room / Room No / Number…).
import type { HotelState, Space, Condition, Occupancy, RoomType } from "./store";
import { uid } from "./store";

export interface ImportRow {
  number: string; name?: string; floor?: string; type?: string; sqft?: number; suite?: string;
  condition?: Condition; occupancy?: Occupancy; promised?: string; guestCode?: string; vip?: boolean; ooo?: string;
}

export function parseDelimited(text: string): string[][] {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim().length);
  if (!lines.length) return [];
  const delim = lines[0].includes("\t") ? "\t" : lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";
  return lines.map((line) => {
    const out: string[] = []; let cur = ""; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === delim && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  });
}

const HEADERS: [RegExp, keyof ImportRow][] = [
  [/^(room\s*(no|number|#)?|number|rm|unit)$/i, "number"],
  [/^(name|room\s*name|description)$/i, "name"],
  [/^(floor|level|flr)$/i, "floor"],
  [/^(type|room\s*type|category)$/i, "type"],
  [/^(sq\s*ft|sqft|square\s*feet|area|size)$/i, "sqft"],
  [/^(suite|cluster|group)$/i, "suite"],
  [/^(condition|hk\s*status|housekeeping|status|clean)$/i, "condition"],
  [/^(occupancy|occ|fo\s*status|front\s*office)$/i, "occupancy"],
  [/^(promised|arrival|eta|check[-\s]*in|arrival\s*time)$/i, "promised"],
  [/^(guest|guest\s*code|reservation|res)$/i, "guestCode"],
  [/^vip$/i, "vip"],
  [/^(ooo|out\s*of\s*order|maintenance)$/i, "ooo"]
];

export function normalizeCondition(s: string): Condition | undefined {
  const v = s.trim().toLowerCase();
  if (!v) return undefined;
  if (/^(vd|vacant\s*dirty|od|dirty|vacío sucio)$/.test(v) || /dirty/.test(v)) return "dirty";
  if (/progress|cleaning|in\s*prog|ip$/.test(v)) return "in_progress";
  if (/^(vc|vacant\s*clean|clean|oc|occupied\s*clean)$/.test(v) || /^clean$/.test(v)) return "clean";
  if (/insp|vi$|ready|vr$/.test(v)) return "inspected";
  if (/pick/.test(v)) return "pickup";
  return undefined;
}

export function normalizeOccupancy(s: string): Occupancy | undefined {
  const v = s.trim().toLowerCase();
  if (!v) return undefined;
  if (/arriv|due\s*in|expected/.test(v)) return "arriving";
  if (/depart|due\s*out|check\s*out|c\/o/.test(v)) return "departing";
  if (/stay/.test(v)) return "stayover";
  if (/occ/.test(v)) return "occupied";
  if (/vac|empty/.test(v)) return "vacant";
  return undefined;
}

export function rowsFromTable(table: string[][]): ImportRow[] {
  if (!table.length) return [];
  const head = table[0];
  const map: (keyof ImportRow | null)[] = head.map((h) => { const hit = HEADERS.find(([re]) => re.test(h.trim())); return hit ? hit[1] : null; });
  if (!map.includes("number")) return [];
  const out: ImportRow[] = [];
  for (const cells of table.slice(1)) {
    const r: Partial<ImportRow> = {};
    cells.forEach((c, i) => {
      const k = map[i]; if (!k || !c) return;
      if (k === "sqft") r.sqft = Number(String(c).replace(/[^0-9.]/g, "")) || undefined;
      else if (k === "vip") r.vip = /^(y|yes|true|1|vip)$/i.test(c);
      else if (k === "condition") r.condition = normalizeCondition(c);
      else if (k === "occupancy") r.occupancy = normalizeOccupancy(c);
      else (r as Record<string, unknown>)[k] = c;
    });
    if (r.number) out.push(r as ImportRow);
  }
  return out;
}

/** type label → the account's room type id (forgiving), or null */
export function matchType(types: RoomType[], label: string | undefined): string | null {
  if (!label) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const n = norm(label);
  const hit = types.find((t) => norm(t.label) === n || norm(t.id) === n);
  if (hit) return hit.id;
  const table: [RegExp, string][] = [
    [/^(k|kng|king)/, "king"], [/^(q|qn|queen)/, "queen"], [/(dq|dbl|double|qq|2q)/, "double-queen"], [/(ada|access)/, "accessible"],
    [/jr|junior/, "junior-suite"], [/parlor|living/, "suite-parlor"], [/suite|ste/, "suite-bedroom"], [/lobby/, "lobby"], [/elev/, "elevator-lobby"],
    [/corr|hall/, "corridor"], [/rest|toilet|wc/, "public-restroom"], [/gym|fitness/, "gym"], [/pool/, "pool-deck"], [/meet|board|ballroom/, "meeting"],
    [/linen|hk|housekeeping|closet/, "linen"], [/ice|vend/, "ice-vending"], [/stair/, "stairwell"]
  ];
  const m = table.find(([re]) => re.test(n));
  return m && types.some((t) => t.id === m[1]) ? m[1] : null;
}

export interface ImportSummary { created: number; updated: number; statusSet: number; unmatchedTypes: string[]; }

/** upsert by room number (floor from the number's first digit when missing) */
export function applyImport(state: HotelState, rows: ImportRow[], at = new Date().toISOString(), by = "Import"): ImportSummary {
  const sum: ImportSummary = { created: 0, updated: 0, statusSet: 0, unmatchedTypes: [] };
  for (const r of rows) {
    const number = String(r.number).trim();
    let sp = state.spaces.find((s) => s.number.toLowerCase() === number.toLowerCase());
    const typeId = matchType(state.roomTypes, r.type);
    if (r.type && !typeId && !sum.unmatchedTypes.includes(r.type)) sum.unmatchedTypes.push(r.type);
    const floor = r.floor?.trim() || (number.match(/^\d{3,4}$/) ? number.slice(0, -2) : "L");
    if (!sp) {
      sp = { id: uid("sp"), number, name: r.name?.trim() || `Room ${number}`, floor, typeId: typeId ?? "", sqft: r.sqft ?? 0, updatedAt: at } as Space;
      state.spaces.push(sp); sum.created += 1;
    } else {
      if (r.name) sp.name = r.name.trim();
      if (r.floor) sp.floor = floor;
      if (typeId) sp.typeId = typeId;
      if (r.sqft) sp.sqft = r.sqft;
      sp.updatedAt = at; sum.updated += 1;
    }
    if (r.suite) {
      const cid = "cl-" + r.suite.replace(/\s+/g, "-").toLowerCase();
      let cl = state.clusters.find((c) => c.id === cid);
      if (!cl) { cl = { id: cid, number: r.suite, name: r.suite, floor: sp.floor, memberIds: [] }; state.clusters.push(cl); }
      if (!cl.memberIds.includes(sp.id)) cl.memberIds.push(sp.id);
      sp.clusterId = cid;
    }
    const st = state.status[sp.id] ?? { spaceId: sp.id, occupancy: null, condition: null, engineering: null, flags: { vip: false, doNotWalk: false, at: "" }, inspection: null, readyPath: [], override: null };
    let touched = false;
    if (r.condition) { st.condition = { value: r.condition, at, source: "manual", by }; touched = true; }
    if (r.occupancy) { st.occupancy = { value: r.occupancy, at, source: "manual" }; touched = true; }
    if (r.promised) {
      const t = parsePromised(r.promised, at);
      if (t) { st.flags = { ...st.flags, promisedAt: t, guestCode: r.guestCode ?? st.flags.guestCode, vip: r.vip ?? st.flags.vip, at }; if (!r.occupancy) st.occupancy = { value: "arriving", at, source: "manual" }; touched = true; }
    } else if (r.vip !== undefined || r.guestCode) { st.flags = { ...st.flags, vip: r.vip ?? st.flags.vip, guestCode: r.guestCode ?? st.flags.guestCode, at }; touched = true; }
    if (r.ooo !== undefined) { const on = /^(y|yes|true|1|ooo)$/i.test(r.ooo) || r.ooo.length > 3; st.engineering = { ooo: on, reason: on && r.ooo.length > 3 ? r.ooo : undefined, at }; touched = true; }
    else if (touched && !st.engineering) st.engineering = { ooo: false, at };
    if (touched) { state.status[sp.id] = st; sum.statusSet += 1; }
  }
  return sum;
}

/** "3:30 PM", "15:30", "2026-09-14T15:30" → ISO today (or as given) */
export function parsePromised(s: string, baseIso: string): string | null {
  const v = s.trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
  const m = v.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/i);
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2] ?? 0); const ap = (m[3] ?? "").toLowerCase();
  if (ap.startsWith("p") && h < 12) h += 12;
  if (ap.startsWith("a") && h === 12) h = 0;
  const d = new Date(baseIso); d.setHours(h, min, 0, 0);
  return d.toISOString();
}

export const SAMPLE_CSV = `Room,Type,Floor,Sq Ft,Suite,Condition,Occupancy,Promised,Guest,VIP
501,King,5,338,,Dirty,Arriving,4:00 PM,G-5101,
502,Queen,5,338,,Clean,Arriving,3:30 PM,G-5102,yes
503,Double Queen,5,338,,Inspected,Stayover,,,
520,Suite bedroom,5,338,Suite 520,Clean,Arriving,6:00 PM,G-5120,yes
518,Suite parlor,5,338,Suite 520,Dirty,Arriving,6:00 PM,G-5120,yes
GYM5,Fitness,5,780,,Clean,,,,`;
