// Bulk rename (Josh, 2026-11-02): the plan read gives rooms numbers that are right and names that
// are not — "PK102PK103", "PAT. RM." — and renaming 300 patient rooms one at a time, by voice or
// keyboard, is a day's work. This module picks the rooms by rule, writes the new names from a
// pattern, shows the result before anything happens, and takes it back on Undo. Pure and
// unit-tested; RenameMode.tsx is the panel in Max Space's Map View.
import type { ClassicData, ClassicSpace } from "./classicStore";

export interface RenameChange { id: string; from: string; to: string }

export interface RenamePlan {
  changes: RenameChange[];
  /** picked rooms left alone: no room type to name them after */
  noType: number;
  /** picked rooms left alone: already named what the pattern gives */
  same: number;
  /** picked rooms left alone: the name says "soiled" and Max Sanitation finds its rooms by that word */
  soiled: number;
  /** picked rooms left alone: the pattern wants {prefix} and no letters rule covers this room's number */
  noRule: number;
}

/** the ready-made patterns, in the order the panel offers them */
export const NAME_PRESETS: { id: string; label: string; pattern: string }[] = [
  { id: "type", label: "The room's type", pattern: "{type}" },
  { id: "type-number", label: "The room's type + its number", pattern: "{type} {number}" },
  // Josh, 2026-11-02: "change the room number letter abbreviations to a specific value — FPKb to
  // PKT — then the number value, then whatever is already there for room name (TLT for a restroom)"
  { id: "letters", label: "New letters + number + an ending you choose", pattern: "{prefix}{num} {name}" },
  { id: "custom", label: "My own pattern…", pattern: "" }
];

/**
 * What follows the letters and number (Josh, 2026-11-02: "creating my own letter value, then adopting
 * the numerical value from the room number, and then having the option to add the room type
 * abbreviation, creating one room name")
 */
export const LETTER_ENDINGS: { id: "name" | "typeabbr" | "type" | "none"; label: string; pattern: string }[] = [
  { id: "name", label: "the name it has now", pattern: "{prefix}{num} {name}" },
  { id: "typeabbr", label: "the room type, shortened", pattern: "{prefix}{num} {typeabbr}" },
  { id: "type", label: "the room type in full", pattern: "{prefix}{num} {type}" },
  { id: "none", label: "nothing", pattern: "{prefix}{num}" }
];

/** short forms for room types, keyed by typeKey(label): { "patient room": "PT RM", "restroom": "TLT" } */
export type TypeAbbr = Record<string, string>;
export const typeKey = (label: unknown) => String(label ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** the room type's short form from the table, or the type itself when the table has none for it */
export function typeShort(sp: ClassicSpace, abbr: TypeAbbr = {}): string {
  const t = typeWord(sp);
  if (!t) return "";
  return String(abbr[typeKey(t)] ?? "").replace(/\s+/g, " ").trim() || t;
}

/** one row of the letters table: the letters a room number starts with → the letters the name gets */
export interface LetterRule { from: string; to: string }

/**
 * A room number in two parts: the letters (and floor) in front, and the number itself.
 * "FPKb-101" → FPKb / 101 · "FV4-297A" → FV4 / 297A · "4E-102" → 4E / 102 · "PK102" → PK / 102 · "102" → — / 102
 */
export function splitNumber(roomNumber: unknown): { prefix: string; num: string } {
  const s = String(roomNumber ?? "").trim();
  const sep = /^([A-Za-z0-9]*?)[\s\-_./]+(.+)$/.exec(s);
  if (sep) return { prefix: sep[1], num: sep[2].trim() };
  const run = /^([A-Za-z]+)(\d.*)$/.exec(s);
  if (run) return { prefix: run[1], num: run[2] };
  return { prefix: "", num: s };
}

/**
 * The letters the name gets for a room number's letters: the rule's, when one matches (case doesn't
 * matter); null when no rule covers these letters — that room is left alone. An empty table changes
 * nothing, so the preset can't rename a floor by accident before a rule is typed.
 */
export function mappedPrefix(prefix: string, rules: LetterRule[]): string | null {
  const hit = rules.find((r) => r.from.trim() && r.from.trim().toLowerCase() === prefix.toLowerCase());
  return hit ? hit.to.trim() : null;
}

export const PLACEHOLDERS = "{type} {typeabbr} {number} {prefix} {num} {name} {n} {floor} {dept}";

/** a room-number-like token the drawing leaves behind: "102", "4E-102", "PK102", "B2" */
const CODE = /[A-Z]{0,4}[-.]?\d{1,5}[A-Z]?/gi;

/**
 * Does this name look like the drawing's leftovers rather than a name a worker would use? Blank,
 * the room number again, nothing but number-like codes ("PK102PK103", "4E-102 4E-103"), or dotted
 * abbreviations ("PAT. RM.", "MECH. RM.", "E.R."). Real words — "ICU", "Soiled Utility", "OR 1" —
 * are left alone.
 */
export function looksRough(name: unknown, roomNumber?: unknown): boolean {
  const s = String(name ?? "").replace(/\s+/g, " ").trim();
  if (!s) return true;
  const num = String(roomNumber ?? "").trim();
  if (num && s.toLowerCase() === num.toLowerCase()) return true;
  if (!s.replace(CODE, " ").replace(/[\s/,\-_.#&()]+/g, "").length) return true;
  return s.split(/[\s/]+/).some((t) => /^[A-Za-z]{1,5}\.$/.test(t) || /^(?:[A-Za-z]\.){2,}$/.test(t));
}

/** natural order for room numbers: "FV4-2" before "FV4-10" */
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** the room's type as a name — "Other" is not a name */
export function typeWord(sp: ClassicSpace): string {
  const t = String(sp.roomType ?? "").replace(/\s+/g, " ").trim();
  return /^other$/i.test(t) ? "" : t;
}

/**
 * Fill a pattern for one room; {n} is the room's place in the renamed set, counted from 1. {prefix}
 * and {num} are the room number's two halves ({prefix} run through the letters rules), {name} the
 * name as it stands, {typeabbr} the room type's short form from the table. Null when {prefix} is
 * wanted and no rule covers this room's letters.
 */
export function renderName(pattern: string, sp: ClassicSpace, n: number, rules: LetterRule[] = [], abbr: TypeAbbr = {}): string | null {
  const { prefix, num } = splitNumber(sp.roomNumber);
  let letters = prefix;
  if (/\{prefix\}/i.test(pattern)) {
    const m = mappedPrefix(prefix, rules);
    if (m === null) return null;
    letters = m;
  }
  return pattern
    .replace(/\{typeabbr\}/gi, typeShort(sp, abbr))
    .replace(/\{type\}/gi, typeWord(sp))
    .replace(/\{number\}/gi, String(sp.roomNumber ?? "").trim())
    .replace(/\{prefix\}/gi, letters)
    .replace(/\{num\}/gi, num)
    .replace(/\{name\}/gi, String(sp.roomName ?? "").replace(/\s+/g, " ").trim())
    .replace(/\{floor\}/gi, String(sp.floor ?? "").trim())
    .replace(/\{dept\}/gi, String(sp.department ?? "").trim())
    .replace(/\{n\}/gi, String(n))
    .replace(/\s+/g, " ").trim();
}

/**
 * What a rename would do to the picked rooms — nothing is written. Rooms are numbered for {n} in
 * room-number order. A pattern that names a room after its type skips rooms with none, and a room
 * whose name says "soiled" keeps it unless the new name says so too (Max Sanitation's routes find
 * their soiled utility rooms by that word).
 */
export function planRename(picked: ClassicSpace[], pattern: string, rules: LetterRule[] = [], abbr: TypeAbbr = {}): RenamePlan {
  const sorted = [...picked].sort((a, b) => natural(String(a.roomNumber ?? ""), String(b.roomNumber ?? "")));
  const usesType = /\{type\}|\{typeabbr\}/i.test(pattern);
  const usesName = /\{name\}/i.test(pattern);
  const changes: RenameChange[] = [];
  let noType = 0, same = 0, soiled = 0, noRule = 0, k = 0;
  for (const sp of sorted) {
    if (usesType && !typeWord(sp)) { noType++; continue; }
    const from = String(sp.roomName ?? "");
    const to = renderName(pattern, sp, k + 1, rules, abbr);
    if (to === null) { noRule++; continue; }
    if (!to || to === from.trim()) { same++; k++; continue; }
    // a pattern that keeps the old name must not pile up on a second run: "PKT101 TLT" already
    // starts with what the pattern puts in front, so it's done
    if (usesName) {
      const head = renderName(pattern.replace(/\{name\}/gi, ""), sp, k + 1, rules, abbr) ?? "";
      if (head && from.replace(/\s+/g, " ").trim().toLowerCase().startsWith(head.toLowerCase())) { same++; k++; continue; }
    }
    if (/soil/i.test(from) && !/soil/i.test(to) && !/soil/i.test(String(sp.roomType ?? ""))) { soiled++; continue; }
    k++;
    changes.push({ id: sp.id, from, to });
  }
  return { changes, noType, same, soiled, noRule };
}

/** the plan grouped for the preview — "PAT. RM. → Patient Room × 262" — biggest group first */
export function renameGroups(changes: RenameChange[]): { from: string; to: string; count: number }[] {
  const m = new Map<string, { from: string; to: string; count: number }>();
  for (const c of changes) {
    const key = c.from.trim() + "\u0001" + c.to;
    const g = m.get(key);
    if (g) g.count++; else m.set(key, { from: c.from.trim(), to: c.to, count: 1 });
  }
  return [...m.values()].sort((a, b) => b.count - a.count || natural(a.to, b.to) || natural(a.from, b.from));
}

/** write the new names; returns how many rooms changed */
export function applyRename(data: ClassicData, changes: RenameChange[]): number {
  const byId = new Map((data.v7.spaces ?? []).map((s) => [s.id, s]));
  const now = new Date().toISOString();
  let n = 0;
  for (const c of changes) {
    const sp = byId.get(c.id);
    if (!sp) continue;
    sp.roomName = c.to;
    sp.updatedAt = now;
    n++;
  }
  return n;
}

/** put the old names back — only where the room still carries the name the rename gave it */
export function undoRename(data: ClassicData, changes: RenameChange[]): number {
  const byId = new Map((data.v7.spaces ?? []).map((s) => [s.id, s]));
  const now = new Date().toISOString();
  let n = 0;
  for (const c of changes) {
    const sp = byId.get(c.id);
    if (!sp || String(sp.roomName ?? "") !== c.to) continue;
    sp.roomName = c.from;
    sp.updatedAt = now;
    n++;
  }
  return n;
}
