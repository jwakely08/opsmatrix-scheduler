// Scope from a Rediscover Clean intake form (Josh, 2026-10-28). The facility fills in the intake —
// an HTML page that saves its answers inside itself — and OpsMatrix sets Scope up from it, as far
// as the answers go:
//   • room types: how often each is cleaned (the form's types matched to Scope's own, or added),
//     the shifts that clean them, and whether they need more than the general clean
//   • cleaning rates: industry standard per square foot — every type on its ISSA 612 rate. The
//     form's own benchmark rates (labor and census benchmarks) are deliberately not used.
//   • the general clean: the tasks it already covers, and the facility's own cleaning procedure
//   • floor care: which areas get which floor tasks, and how many days a week
//   • discharges: minutes per discharge clean, plus travel
//   • breaks and lunches, per shift
// Everything else the form holds (shifts, discharge volume, staffing, services…) is kept as the
// facility's profile, shown in Scope for building schedules.
import {
  DEFAULT_INCLUDED_TASKS, ISSA_CATEGORIES, freqPerWeek, productiveFromScope, resetToIssa,
  type BreakRule, type BreakSchedule, type FloorKind, type ProcedureStep, type RoomTypeRule, type Rules
} from "./rules";

export const INTAKE_FORM = "Rediscover Clean EVS Intake";

export interface IntakeData {
  form?: string;
  version?: number;
  saved_at?: string;
  fields: Record<string, string>;
  tables: Record<string, Record<string, string>[]>;
}

/** what the intake said that Scope keeps for reference (shown in Scope, never priced) */
export interface IntakeProfile {
  facility: string;
  system: string;
  completed: string;
  importedAt: string;
  /** answered facts: [label, value] */
  facts: [string, string][];
  shifts: string[];
  discharges: string[];
  staffing: string[];
  services: { handles: string[]; partly: string[] };
  betweenCases: string[];
  otherDepartments: string[];
  curtains: string[];
  floorCare: string[];
  floorTypes: string[];
  extraTasks: string[];
}

export interface IntakeChange { title: string; lines: string[] }

export interface IntakeResult {
  rules: Rules;
  /** what changes in Scope, for the review */
  changes: IntakeChange[];
  /** answers Scope doesn't use, and why */
  notUsed: string[];
}

export class IntakeError extends Error {}

/** the answers saved inside an intake form — its HTML page, or the answers on their own (JSON) */
export function readIntake(text: string): IntakeData {
  const parse = (raw: string): IntakeData | null => {
    try {
      const d = JSON.parse(raw);
      return d && typeof d === "object" && d.fields && typeof d.fields === "object" && d.tables && typeof d.tables === "object"
        ? d as IntakeData : null;
    } catch { return null; }
  };
  const t = String(text ?? "").trim();
  if (t.startsWith("{")) {
    const d = parse(t);
    if (d) return d;
    throw new IntakeError("This file isn't a Rediscover Clean intake form.");
  }
  const re = /<script[^>]*id=["']saved-data["'][^>]*>([\s\S]*?)<\/script>/gi;
  let sawEmpty = false;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const raw = m[1].trim();
    if (!raw) { sawEmpty = true; continue; }
    const d = parse(raw);
    if (d) return d;
  }
  if (sawEmpty) {
    throw new IntakeError("This intake form has no saved answers yet. Open it, fill it in, click “Save my answers”, and choose the file it downloads.");
  }
  throw new IntakeError("This file isn't a Rediscover Clean intake form.");
}

// ── vocabulary ──────────────────────────────────────────────────────────────

const key = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
/** "Other: Mid-Shift" → "Mid-Shift" */
const otherText = (s: unknown) => String(s ?? "").trim().replace(/^other:?\s*/i, "").trim();
const yes = (s: unknown) => /^y/i.test(String(s ?? "").trim());

/** the form's "How often cleaned" → Scope's words ("7x per week" → "7x / week") */
export function intakeFrequency(s: unknown): string | null {
  const f = key(s);
  if (!f) return null;
  const m = /^(\d+)\s*x\s*per\s*week/.exec(f);
  if (m) return `${m[1]}x / week`;
  if (/every other week/.test(f)) return "Every other week";
  if (/month/.test(f)) return "Monthly";
  if (/as needed|on request/.test(f)) return "As needed";
  return null;
}

interface NewType { id: string; label: string; cat: string; cleanability?: "non-cleanable" }

/** the form's room types → Scope's own (`use`) or a new one (`add`), at its ISSA category */
const INTAKE_ROOM_TYPES: Record<string, { use?: string[]; add?: NewType }> = {
  "patient room": { use: ["patient-room"] },
  "semi-private patient room": { add: { id: "semi-private-room", label: "Semi-Private Patient Room", cat: "clinical" } },
  "icu / critical care room": { add: { id: "icu-room", label: "ICU / Critical Care Room", cat: "clinical" } },
  "isolation / negative-pressure room": { add: { id: "isolation-room", label: "Isolation Room", cat: "clinical" } },
  "emergency department bay": { use: ["emergency-room"] },
  "trauma bay": { add: { id: "trauma-bay", label: "Trauma Bay", cat: "clinical" } },
  "exam room": { use: ["exam-room"] },
  "procedure room": { use: ["procedure-room"] },
  "operating room": { use: ["operating-room"] },
  "hybrid or": { add: { id: "hybrid-or", label: "Hybrid OR", cat: "clinical" } },
  "sterile core / sterile supply": { add: { id: "sterile-core", label: "Sterile Core / Supply", cat: "clinical" } },
  "sterile processing (spd)": { add: { id: "sterile-processing", label: "Sterile Processing (SPD)", cat: "lab" } },
  "cath lab / interventional suite": { add: { id: "cath-lab", label: "Cath Lab / Interventional", cat: "clinical" } },
  "endoscopy / gi suite": { add: { id: "endoscopy", label: "Endoscopy / GI Suite", cat: "clinical" } },
  "pre-op / pacu bay": { add: { id: "pacu-bay", label: "Pre-op / PACU Bay", cat: "clinical" } },
  "labor & delivery room": { add: { id: "labor-delivery", label: "Labor & Delivery Room", cat: "clinical" } },
  "c-section or": { add: { id: "c-section-or", label: "C-Section OR", cat: "clinical" } },
  "nicu": { add: { id: "nicu", label: "NICU", cat: "clinical" } },
  "nursery": { add: { id: "nursery", label: "Nursery", cat: "clinical" } },
  "dialysis bay": { add: { id: "dialysis-bay", label: "Dialysis Bay", cat: "clinical" } },
  "infusion bay": { add: { id: "infusion-bay", label: "Infusion Bay", cat: "clinical" } },
  "imaging room (mri / ct / x-ray)": { add: { id: "imaging-room", label: "Imaging Room (MRI / CT / X-ray)", cat: "clinical" } },
  "radiology reading room": { add: { id: "reading-room", label: "Radiology Reading Room", cat: "office" } },
  "laboratory": { use: ["lab"] },
  "pharmacy": { add: { id: "pharmacy", label: "Pharmacy", cat: "lab" } },
  "nurse station": { use: ["nurses-station"] },
  "medication room": { use: ["clean-utility"] },
  "clean utility / clean supply": { use: ["clean-utility"] },
  "soiled utility": { use: ["utility-room"] },
  "nourishment / pantry": { add: { id: "nourishment", label: "Nourishment / Pantry", cat: "break-room" } },
  "patient restroom": { use: ["restroom"] },
  "public restroom": { use: ["restroom"] },
  "staff restroom": { use: ["restroom"] },
  "shower / tub room": { add: { id: "shower-room", label: "Shower / Tub Room", cat: "restroom" } },
  "locker room": { use: ["locker-room"] },
  "office": { use: ["office"] },
  "conference room": { use: ["conference-room"] },
  "break room": { use: ["break-room"] },
  "lounge": { use: ["lounge"] },
  "lobby": { use: ["lobby"] },
  "waiting room": { use: ["waiting-room"] },
  "corridor / hallway": { use: ["corridor", "hallway"] },
  "elevator": { use: ["elevator"] },
  "stairwell": { use: ["stairwell"] },
  "vestibule / entrance": { add: { id: "vestibule", label: "Vestibule / Entrance", cat: "lobby-corridor" } },
  "chapel": { add: { id: "chapel", label: "Chapel", cat: "conference" } },
  "cafeteria / dining": { add: { id: "cafeteria", label: "Cafeteria / Dining", cat: "break-room" } },
  "kitchen": { add: { id: "kitchen", label: "Kitchen", cat: "break-room" } },
  "gift shop": { add: { id: "gift-shop", label: "Gift Shop", cat: "office" } },
  "rehab / therapy gym": { add: { id: "rehab-gym", label: "Rehab / Therapy Gym", cat: "clinical" } },
  "morgue": { add: { id: "morgue", label: "Morgue", cat: "lab" } },
  "linen room": { add: { id: "linen-room", label: "Linen Room", cat: "office" } },
  "storage room": { use: ["storage"] },
  "supply closet": { use: ["storage"] },
  "janitor / evs closet": { add: { id: "janitor-closet", label: "Janitor / EVS Closet", cat: "office" } },
  "general closet": { use: ["storage"] },
  "trash / soiled holding": { add: { id: "trash-holding", label: "Trash / Soiled Holding", cat: "clinical" } },
  "loading dock": { add: { id: "loading-dock", label: "Loading Dock", cat: "lobby-corridor" } },
  "mechanical room": { use: ["mechanical-room"] },
  "electrical room": { use: ["electrical-room"] },
  "data / telecom room": { use: ["data-telecom"] },
  "shaft": { use: ["shaft"] },
  "shell space": { use: ["shell-space"] },
  "roof": { use: ["roof"] },
  "penthouse": { add: { id: "penthouse", label: "Penthouse", cat: "office", cleanability: "non-cleanable" } }
};

/** a type the form doesn't list ("Other: Cardiac Rehab") prices at the nearest ISSA category */
function guessCategory(label: string): string {
  const s = label.toLowerCase();
  if (/restroom|toilet|shower|bath|tub/.test(s)) return "restroom";
  if (/locker/.test(s)) return "locker";
  if (/elevator/.test(s)) return "elevator";
  if (/lab|pharm|morgue|sterile proc|spd/.test(s)) return "lab";
  if (/corridor|hall|lobby|vestibule|entrance|dock|waiting/.test(s)) return "lobby-corridor";
  if (/break|lounge|dining|cafe|kitchen|pantry|nourish/.test(s)) return "break-room";
  if (/conference|meeting|chapel|class|training/.test(s)) return "conference";
  if (/office|admin|reading|work ?room|storage|closet/.test(s)) return "office";
  return "clinical";
}

/** the general-clean tasks Scope prices separately (and so can mark as covered) */
const GENERAL_TASKS: Record<string, string> = {
  "trash pull": "trash-pull", "high dusting": "high-dusting", "damp mopping": "damp-mop", "vacuuming": "vacuum"
};

/** the form's floor-care words → Scope's floor tasks */
function floorTasks(text: string): string[] {
  const s = otherText(text).toLowerCase();
  const out: string[] = [];
  if (/dust\s*mop/.test(s)) out.push("dust-mop");
  if (/damp\s*mop|wet\s*mop/.test(s)) out.push("damp-mop");
  if (/burnish|buff/.test(s)) out.push("burnish");
  else if (/scrub/.test(s)) out.push("auto-scrub");
  if (/sweep/.test(s)) out.push("machine-sweep");
  if (/vacuum/.test(s)) out.push("vacuum");
  if (/extract|bonnet|encapsul|shampoo/.test(s)) out.push("machine-carpet");
  return out;
}

/** the form's floor-care areas → Scope room types (only those Scope has) */
const AREA_TYPES: Record<string, string[]> = {
  "corridors / hallways": ["corridor", "hallway"],
  "patient rooms": ["patient-room", "semi-private-room"],
  "lobbies / public areas": ["lobby", "waiting-room", "vestibule"],
  "emergency department": ["emergency-room", "trauma-bay"],
  "operating rooms": ["operating-room"],
  "offices": ["office"]
};

/** the cleaning procedure, in working order: what each general-clean task becomes on a schedule */
const PROCEDURE: { match: RegExp; step: ProcedureStep }[] = [
  { match: /^trash/i, step: { title: "Empty trash", detail: "Remove trash and recycling; replace liners." } },
  { match: /^recycl/i, step: { title: "Pull recycling", detail: "Empty recycling bins; replace liners." } },
  { match: /linen removal/i, step: { title: "Remove linen", detail: "Bag soiled linen and take it to the soiled holding area." } },
  { match: /sharps/i, step: { title: "Check sharps containers", detail: "Swap any container at its fill line." } },
  { match: /high dust/i, step: { title: "High dust", detail: "Dust vents, ledges and high surfaces first: work top to bottom." } },
  { match: /low dust/i, step: { title: "Low dust", detail: "Dust low ledges, furniture and baseboards." } },
  { match: /damp wip/i, step: { title: "Damp wipe", detail: "Damp wipe surfaces and furniture, clean to dirty." } },
  { match: /disinfect/i, step: { title: "Disinfect high-touch surfaces", detail: "Disinfect high-touch surfaces clean-to-dirty; follow the product's wet contact time." } },
  { match: /bed making/i, step: { title: "Make the bed", detail: "Make the bed with fresh linen." } },
  { match: /glass|mirror/i, step: { title: "Glass and mirrors", detail: "Clean glass and mirrors streak-free." } },
  { match: /spot clean.*wall/i, step: { title: "Spot clean walls", detail: "Spot clean walls, doors and switch plates." } },
  { match: /wall wash/i, step: { title: "Wash walls", detail: "Wash walls top to bottom." } },
  { match: /restroom/i, step: { title: "Clean the restroom", detail: "Clean and disinfect sink, toilet and fixtures." } },
  { match: /restock/i, step: { title: "Restock supplies", detail: "Restock paper, soap and sanitizer." } },
  { match: /uv disinf/i, step: { title: "UV disinfection", detail: "Run the UV disinfection cycle." } },
  { match: /electrostatic/i, step: { title: "Electrostatic spray", detail: "Electrostatic spray the room's surfaces." } },
  { match: /dust mop/i, step: { title: "Dust mop", detail: "Dust mop the floor, removing loose debris from corners and under furniture." } },
  { match: /spot carpet/i, step: { title: "Spot clean carpet", detail: "Spot clean carpet stains." } },
  { match: /vacuum/i, step: { title: "Vacuum", detail: "Vacuum carpet, edges and under furniture." } },
  { match: /damp mop/i, step: { title: "Damp mop", detail: "Damp mop hard floors with a fresh microfiber pad, working toward the door. Place a wet-floor sign." } }
];

/** "9:00 AM" → "09:00" (break schedule windows are 24h) */
function to24h(s: string): string {
  const m = /^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i.exec(String(s ?? "").trim());
  if (!m) return "";
  let h = Number(m[1]) % 12;
  if (/p/i.test(m[3])) h += 12;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

const SHIFT_ORDER = ["1st", "2nd", "3rd", "weekends"];
const fmtInt = (s: unknown) => {
  const n = Number(String(s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && String(s ?? "").trim() !== "" ? n.toLocaleString("en-US") : "";
};

// ── the setup ───────────────────────────────────────────────────────────────

/**
 * Scope set up from an intake: a NEW rulebook (the one passed in is untouched), what changed, and
 * what the form said that Scope doesn't use.
 */
export function intakeToScope(current: Rules, intake: IntakeData, now = new Date().toISOString()): IntakeResult {
  const rules: Rules = JSON.parse(JSON.stringify(current));
  const F = intake.fields ?? {};
  const T = (name: string) => (intake.tables?.[name] ?? []).filter((r) => r && typeof r === "object");
  const changes: IntakeChange[] = [];
  const notUsed: string[] = [];
  const facility = String(F.facility_name ?? "").trim() || "this facility";

  // ── room types: how often, who cleans them, anything beyond the general clean ──
  type Want = { freq: string; shifts: Set<string>; beyond: boolean; from: string[] };
  const wants = new Map<string, Want>();
  const added: string[] = [];
  const blank: string[] = [];
  const typeById = (id: string) => rules.roomTypes.find((t) => t.id === id);
  const typeByLabel = (label: string) => rules.roomTypes.find((t) => key(t.label) === key(label));
  const ensureType = (nt: NewType): RoomTypeRule => {
    const have = typeById(nt.id) ?? typeByLabel(nt.label);
    if (have) return have;
    let id = nt.id, n = 2;
    while (typeById(id)) id = `${nt.id}-${n++}`;
    const t: RoomTypeRule = {
      id, label: nt.label, frequency: "7x / week", includedTasks: [...DEFAULT_INCLUDED_TASKS],
      ...(nt.cleanability ? { cleanability: nt.cleanability } : {})
    };
    resetToIssa(rules, t, nt.cat);
    rules.roomTypes.push(t);
    added.push(nt.label);
    return t;
  };
  for (const row of T("Rooms")) {
    const label = String(row.room_type ?? "").trim();
    if (!label || /^other$/i.test(label)) continue;
    const freq = intakeFrequency(row.frequency);
    if (!freq) { blank.push(otherText(label)); continue; }
    const map = INTAKE_ROOM_TYPES[key(label)];
    let ids: string[];
    if (map?.use) ids = map.use.filter((id) => typeById(id));
    else if (map?.add) ids = [ensureType(map.add).id];
    else {
      const own = otherText(label);
      const slug = own.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "room";
      ids = [ensureType({ id: slug, label: own, cat: guessCategory(own) }).id];
    }
    // a type Scope's account deleted: the form's room comes back as its own type
    if (!ids.length && map?.use) {
      const own = otherText(label);
      ids = [ensureType({ id: map.use[0], label: own, cat: guessCategory(own) }).id];
    }
    for (const id of ids) {
      const w = wants.get(id) ?? { freq, shifts: new Set<string>(), beyond: false, from: [] };
      // several of the form's types share one of Scope's: the most frequent wins
      if (freqPerWeek(freq) > freqPerWeek(w.freq)) w.freq = freq;
      for (const s of String(row.shifts ?? "").split(/;\s*/)) if (s.trim()) w.shifts.add(s.trim());
      if (yes(row.special)) w.beyond = true;
      w.from.push(otherText(label));
      wants.set(id, w);
    }
  }
  const typeLines: string[] = [];
  for (const [id, w] of wants) {
    const t = typeById(id)!;
    const was = t.frequency;
    t.frequency = w.freq;
    const shifts = [...w.shifts].sort((a, b) => SHIFT_ORDER.indexOf(a.toLowerCase()) - SHIFT_ORDER.indexOf(b.toLowerCase()));
    if (shifts.length) t.cleanedOn = shifts.join(", "); else delete t.cleanedOn;
    if (w.beyond) t.beyondGeneral = true; else delete t.beyondGeneral;
    const isNew = added.includes(t.label);
    typeLines.push(`${t.label}: ${w.freq}${isNew ? " (new)" : was !== w.freq ? ` (was ${was})` : ""}` +
      (shifts.length ? ` · cleaned on ${shifts.join(", ")}` : "") + (w.beyond ? " · needs more than the general clean" : ""));
  }
  if (typeLines.length) changes.push({ title: `Room types (${wants.size}, ${added.length} new)`, lines: typeLines });
  if (blank.length) notUsed.push(`Room types the form left without a frequency (not added): ${blank.join(", ")}.`);

  // ── cleaning rates: industry standard per square foot (ISSA 612) on every type ──
  let moved = 0;
  for (const t of rules.roomTypes) {
    const before = JSON.stringify([t.method, t.fixedMin, t.sqftPerHour, t.rateUnit]);
    resetToIssa(rules, t);
    if (JSON.stringify([t.method, t.fixedMin, t.sqftPerHour, t.rateUnit]) !== before) moved++;
  }
  changes.push({
    title: "Cleaning rates",
    lines: [
      "Every room type is timed by its ISSA 612 rate per square foot — the industry standard." +
        (moved ? ` ${moved} type${moved === 1 ? "" : "s"} moved back to ISSA.` : ""),
      ...ISSA_CATEGORIES.map((c) => `${c.label}: ${c.sqftPerHour.toLocaleString("en-US")} sq ft/hr`)
    ]
  });
  const rates = T("Rates").filter((r) => String(r.rate ?? "").trim());
  if (rates.length) {
    notUsed.push(`The form's own rates (${rates.map((r) => `${otherText(r.area)}: ${r.rate} ${otherText(r.unit)}`).join("; ")}) — benchmark rates, not cleaning rates; ISSA is used instead.`);
  }

  // ── the general clean: what it covers, and the facility's procedure ──
  const gen = T("GenTasks").map((r) => String(r.task ?? "").trim()).filter(Boolean);
  const covered = new Set<string>(DEFAULT_INCLUDED_TASKS);
  for (const g of gen) {
    const id = GENERAL_TASKS[key(g)];
    if (id && rules.tasks.some((t) => t.id === id && !t.floorCare)) covered.add(id);
  }
  for (const [field, id] of [["mopping_in_routine", "damp-mop"], ["vacuuming_in_routine", "vacuum"]] as const) {
    if (!String(F[field] ?? "").trim()) continue;
    if (yes(F[field])) covered.add(id); else covered.delete(id);
  }
  if (gen.length || F.mopping_in_routine || F.vacuuming_in_routine) {
    const list = rules.tasks.filter((t) => covered.has(t.id)).map((t) => t.id);
    for (const t of rules.roomTypes) t.includedTasks = [...list];
    // included work is never an automatic extra
    for (const t of rules.tasks) if (covered.has(t.id)) t.autoFor = [];
    changes.push({
      title: "General Clean",
      lines: [`Covers ${rules.tasks.filter((t) => covered.has(t.id)).map((t) => t.label).join(", ")} on every room type — none of them adds time on top.`]
    });
  }
  const steps: ProcedureStep[] = [];
  const procIn = [...gen];
  if (yes(F.vacuuming_in_routine) && !procIn.some((g) => /vacuum/i.test(g))) procIn.push("Vacuuming");
  if (yes(F.mopping_in_routine) && !procIn.some((g) => /damp mop/i.test(g))) procIn.push("Damp mopping");
  const known = PROCEDURE.filter((p) => procIn.some((g) => p.match.test(g)));
  for (const p of known) steps.push({ ...p.step });
  for (const g of procIn) if (!PROCEDURE.some((p) => p.match.test(g))) steps.push({ title: otherText(g) });
  if (steps.length) {
    if (current.procedure?.example !== false) {
      rules.procedure = { steps, show: current.procedure?.show !== false, example: false };
      changes.push({ title: "Cleaning procedure", lines: [`${facility}'s own ${steps.length} steps, printed on every schedule: ${steps.map((s) => s.title).join(" → ")}.`] });
    } else {
      notUsed.push("The general clean's task list — your own cleaning procedure is kept (Scope → Cleaning procedure).");
    }
  }
  const extras = T("ExtraTasks").map((r) => [otherText(r.task), intakeFrequency(r.frequency)] as const).filter(([t]) => t);

  // ── floor care: which areas get which floor tasks, how many days a week ──
  const floorLines: string[] = [];
  const program: string[] = [];
  const perType = new Map<string, number>(); // `${task}|${type}` → days
  const everywhere = new Map<string, { days: number; floors: Set<FloorKind> }>();
  for (const [table, floors] of [["HardFloor", ["hard-finished", "hard-unfinished"]], ["Carpet", ["carpet"]]] as const) {
    for (const row of T(table)) {
      const area = String(row.area ?? "").trim();
      const days = Number(row.days);
      const what = otherText(row.task);
      if (!area || !what) continue;
      program.push(`${otherText(area)}: ${what}${days ? ` — ${days} day${days === 1 ? "" : "s"} a week` : ""}${row.shift ? `, ${otherText(row.shift)}` : ""}`);
      const tasks = floorTasks(String(row.task ?? ""));
      if (!(days > 0) || !tasks.length) {
        if (!tasks.length) notUsed.push(`Floor care "${what}" (${otherText(area)}) — not a floor task Scope times.`);
        continue;
      }
      if (/^all areas$/i.test(area)) {
        for (const id of tasks) {
          const e = everywhere.get(id) ?? { days: 0, floors: new Set<FloorKind>() };
          e.days = Math.max(e.days, days);
          for (const f of floors) e.floors.add(f);
          everywhere.set(id, e);
        }
        continue;
      }
      const types = (AREA_TYPES[key(area)] ?? [typeByLabel(otherText(area))?.id].filter((x): x is string => Boolean(x)))
        .filter((id) => typeById(id));
      if (!types.length) { notUsed.push(`Floor care for "${otherText(area)}" — no matching room type.`); continue; }
      for (const id of tasks) for (const tid of types) {
        const k = `${id}|${tid}`;
        perType.set(k, Math.max(perType.get(k) ?? 0, days));
      }
    }
  }
  const coveredBy = (typeId: string) => typeById(typeId)?.includedTasks ?? [...DEFAULT_INCLUDED_TASKS];
  // dust mopping in the general clean: the routine already does it — only the floor crew's own
  // areas (corridors, by Scope's stock rule) keep it as a floor task
  const genDustMop = gen.some((g) => /dust mop/i.test(g));
  const byTask = new Map<string, string[]>();
  for (const [k, days] of perType) {
    const [taskId, typeId] = k.split("|");
    const task = rules.tasks.find((t) => t.id === taskId);
    const type = typeById(typeId)!;
    if (!task) continue;
    const freq = `${days}x / week`;
    if (coveredBy(typeId).includes(taskId) || (taskId === "dust-mop" && genDustMop && !task.autoFor.includes(typeId))) {
      if (freqPerWeek(freq) < freqPerWeek(type.frequency)) {
        notUsed.push(`${type.label}: ${task.label.toLowerCase()} ${freq} — part of its General Clean (${type.frequency}).`);
      }
      continue;
    }
    if (!task.autoFor.includes(typeId)) task.autoFor = [...task.autoFor, typeId];
    const map = { ...(task.frequencyFor ?? {}) };
    if (freqPerWeek(freq) === freqPerWeek(type.frequency)) delete map[typeId]; else map[typeId] = freq;
    if (Object.keys(map).length) task.frequencyFor = map; else delete task.frequencyFor;
    byTask.set(task.label, [...(byTask.get(task.label) ?? []), `${type.label} ${freq}`]);
  }
  for (const [label, list] of byTask) floorLines.push(`${label}: ${list.join(" · ")}`);
  for (const [id, e] of everywhere) {
    const task = rules.tasks.find((t) => t.id === id);
    if (!task) continue;
    task.autoForFloor = [...new Set([...(task.autoForFloor ?? []), ...e.floors])];
    task.frequency = `${e.days}x / week`;
    const floorWords = [...e.floors].includes("carpet") && e.floors.size === 1 ? "every carpeted room" : "every room with those floors";
    floorLines.push(`${task.label}: ${floorWords}, ${task.frequency}`);
  }
  if (floorLines.length) changes.push({ title: "Floor care", lines: floorLines });

  // ── discharges: minutes per clean, plus travel ──
  const dcMin = Number(F.discharge_turn_min);
  const travel = Number(F.travel_min);
  const dc = rules.nonSpaceDefs.find((d) => d.id === "discharge");
  if (dc && (dcMin > 0 || travel > 0)) {
    const was = dc.minutes;
    if (dcMin > 0) dc.minutes = dcMin;
    let travelLine = "";
    if (travel > 0) {
      let q = rules.nonSpaceQualifiers.find((x) => x.id === "travel-time");
      if (!q) { q = { id: "travel-time", label: "Travel time", minutes: travel, builtIn: true }; rules.nonSpaceQualifiers.push(q); }
      q.minutes = travel;
      if (!dc.qualifierIds.includes("travel-time")) dc.qualifierIds = [...dc.qualifierIds, "travel-time"];
      travelLine = ` + ${travel} min travel`;
    }
    changes.push({ title: "Discharges", lines: [`Each discharge clean: ${dc.minutes} min${travelLine}${was !== dc.minutes ? ` (was ${was} min)` : ""}.`] });
  }

  // ── breaks and lunches, per shift ──
  const shiftRows = T("Shifts").filter((r) => String(r.shift ?? "").trim());
  const shiftNames = shiftRows.map((r) => otherText(r.shift));
  const byShift = new Map<string, Record<string, string>[]>();
  for (const b of T("Breaks")) {
    const s = otherText(b.shift);
    if (!s || !(Number(b.minutes) > 0)) continue;
    byShift.set(s, [...(byShift.get(s) ?? []), b]);
  }
  if (byShift.size) {
    const order = [...byShift.keys()].sort((a, b) =>
      (shiftNames.indexOf(a) < 0 ? 99 : shiftNames.indexOf(a)) - (shiftNames.indexOf(b) < 0 ? 99 : shiftNames.indexOf(b)));
    const first = order[0];
    const seen = new Map<string, number>();
    rules.breaks = byShift.get(first)!.map((b, i): BreakRule => {
      const base = otherText(b.type) || "Break";
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return {
        id: `intake-break-${i + 1}`, label: n > 1 ? `${base} ${n}` : base, minutes: Number(b.minutes),
        start: String(b.start ?? "").trim(), ...(/^n/i.test(String(b.paid ?? "")) ? { unpaid: true } : {})
      };
    });
    const schedules: BreakSchedule[] = [...(rules.breakSchedules ?? [])];
    for (const s of order) {
      const windows = byShift.get(s)!.map((b) => ({
        kind: /lunch|meal/i.test(String(b.type ?? "")) ? "lunch" as const : "break" as const,
        start: to24h(String(b.start ?? "")), minutes: Number(b.minutes),
        ...(/^n/i.test(String(b.paid ?? "")) ? { unpaid: true } : {})
      })).filter((w) => w.start);
      const at = schedules.findIndex((x) => key(x.label) === key(s));
      const id = at >= 0 ? schedules[at].id : `bs-intake-${s.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      if (at >= 0) schedules[at] = { ...schedules[at], windows }; else schedules.push({ id, label: s, windows });
    }
    rules.breakSchedules = schedules;
    rules.general.productiveMinutes = productiveFromScope(rules);
    const fmt = (b: BreakRule) => `${b.label} ${b.minutes} min (${b.unpaid ? "unpaid" : "paid"}) ${b.start}`;
    changes.push({
      title: "Breaks and lunches",
      lines: [
        `Every schedule's breaks (the ${first}'s): ${rules.breaks.map(fmt).join(" · ")}.`,
        `Break schedules for ${order.join(", ")} — a schedule picks its own in Max Schedules.`,
        `${rules.general.productiveMinutes} productive minutes in an 8-hour shift (paid breaks and cart setup/teardown out).`
      ]
    });
  }

  // ── the facility profile, kept for building schedules ──
  const facts: [string, string][] = [];
  const fact = (label: string, v: unknown, fmt = fmtInt) => { const s = fmt(v); if (s && !/^other$/i.test(s)) facts.push([label, s]); };
  const text = (v: unknown) => String(v ?? "").trim();
  fact("Gross sq ft", F.gross_sqft);
  fact("Buildings", F.buildings);
  fact("Floors", F.floors);
  fact("Licensed beds", F.licensed_beds);
  fact("Inpatient beds", F.inpatient_beds);
  fact("Observation beds", F.obs_beds);
  fact("Average daily census", F.avg_daily_census);
  fact("ER visits a year", F.annual_er_visits);
  fact("Nursery bassinets", F.nursery_bassinets);
  fact("NICU bassinets", F.nicu_bassinets);
  fact("Facility type", F.facility_type, text);
  fact("EVS model", F.evs_model, text);
  if (text(F.or_start) || text(F.or_days)) facts.push(["OR hours", `${text(F.or_days)} ${text(F.or_start)}–${text(F.or_end)}`.trim()]);
  fact("Unionized", F.unionized, text);
  fact("UV disinfection", F.uv_disinfection, text);
  const dcByShift = T("DcShift").filter((r) => Number(r.avg) > 0).map((r) => `${otherText(r.shift)}: ${r.avg}`);
  const fte = T("Fte").filter((r) => Number(r.fte) > 0).map((r) => `${otherText(r.position)}: ${r.fte} FTE`);
  const leaders = ([["Leads", F.leads], ["Supervisors", F.supervisors], ["Managers", F.managers], ["Directors", F.directors]] as const)
    .filter(([, v]) => Number(v) > 0).map(([l, v]) => `${l}: ${v}`);
  const services = T("Scope");
  const curtainRows = T("Curtains").filter((r) => text(r.department) || Number(r.times) > 0);
  const profile: IntakeProfile = {
    facility,
    system: text(F.health_system),
    completed: text(F.completed_date) || text(intake.saved_at).slice(0, 10),
    importedAt: now,
    facts,
    shifts: shiftRows.map((r) => `${otherText(r.shift)}: ${text(r.start)}–${text(r.end)}${text(r.days) ? `, ${text(r.days)}` : ""}`),
    discharges: [
      ...(Number(F.dc_per_day) > 0 ? [`${F.dc_per_day} a day`] : []),
      ...(Number(F.dc_per_week) > 0 ? [`${F.dc_per_week} a week`] : []),
      ...(Number(F.dc_per_month) > 0 ? [`${F.dc_per_month} a month`] : []),
      ...(dcByShift.length ? [`By shift — ${dcByShift.join(", ")}`] : [])
    ],
    staffing: [...fte, ...leaders],
    services: {
      handles: services.filter((r) => /^y/i.test(text(r.handles))).map((r) => otherText(r.service) + (text(r.notes) ? ` (${text(r.notes)})` : "")),
      partly: services.filter((r) => /^p/i.test(text(r.handles))).map((r) => otherText(r.service) + (text(r.notes) ? ` (${text(r.notes)})` : ""))
    },
    betweenCases: T("Between").filter((r) => yes(r.between))
      .map((r) => otherText(r.area) + (yes(r.stretchers) ? " (stretchers too)" : "")),
    otherDepartments: T("OtherDept").filter((r) => text(r.room_type) && text(r.who)).map((r) => `${otherText(r.room_type)}: ${text(r.who)}`),
    curtains: [
      ...curtainRows.map((r) => `${text(r.department) || "Curtains"}: ${text(r.times)} per ${text(r.per)}${text(r.also) ? `, plus ${text(r.also).toLowerCase()}` : ""}`),
      ...(text(F.curtain_types) ? [`Types: ${text(F.curtain_types)}`] : []),
      ...(text(F.curtain_cleaning_method) ? [`Cleaned by: ${text(F.curtain_cleaning_method)}`] : [])
    ],
    floorCare: program,
    floorTypes: T("Floors").map((r) => otherText(r.floor_type)).filter(Boolean),
    extraTasks: extras.map(([t, f]) => (f ? `${t} — ${f}` : t))
  };
  rules.intake = profile;
  changes.push({
    title: "Kept for building schedules",
    lines: [
      `${facility}'s profile — shifts, discharge volume, staffing, the services EVS handles, curtains and the floor-care program — shows in Scope.`
    ]
  });
  if (extras.some(([t]) => /curtain/i.test(t))) {
    notUsed.push("Curtain changes — the form gives how often, not how long one takes; add a Curtain Change task in Space tasks once you have a time.");
  }
  return { rules, changes, notUsed };
}
