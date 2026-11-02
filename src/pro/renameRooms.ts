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
}

/** the ready-made patterns, in the order the panel offers them */
export const NAME_PRESETS: { id: string; label: string; pattern: string }[] = [
  { id: "type", label: "Room type", pattern: "{type}" },
  { id: "type-number", label: "Room type + number", pattern: "{type} {number}" },
  { id: "custom", label: "Custom…", pattern: "" }
];

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

/** fill a pattern for one room; {n} is the room's place in the renamed set, counted from 1 */
export function renderName(pattern: string, sp: ClassicSpace, n: number): string {
  return pattern
    .replace(/\{type\}/gi, typeWord(sp))
    .replace(/\{number\}/gi, String(sp.roomNumber ?? "").trim())
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
export function planRename(picked: ClassicSpace[], pattern: string): RenamePlan {
  const sorted = [...picked].sort((a, b) => natural(String(a.roomNumber ?? ""), String(b.roomNumber ?? "")));
  const usesType = /\{type\}/i.test(pattern);
  const changes: RenameChange[] = [];
  let noType = 0, same = 0, soiled = 0, k = 0;
  for (const sp of sorted) {
    if (usesType && !typeWord(sp)) { noType++; continue; }
    const from = String(sp.roomName ?? "");
    const to = renderName(pattern, sp, k + 1);
    if (!to || to === from.trim()) { same++; k++; continue; }
    if (/soil/i.test(from) && !/soil/i.test(to) && !/soil/i.test(String(sp.roomType ?? ""))) { soiled++; continue; }
    k++;
    changes.push({ id: sp.id, from, to });
  }
  return { changes, noType, same, soiled };
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
