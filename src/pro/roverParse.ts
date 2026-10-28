// ROVER MODE's ears (Josh's spec, 2026-09-01): a walker taps a room and
// speaks its data points — room number, room name, room type, floor type,
// fixtures — either labeled ("room number 101 room type office…") or terse
// ("102 office Dr. Smith's office carpet zero fixtures"). Parsing is LOCAL
// and instant, on purpose: the vocabulary is tiny and known (Scope's room
// types, three floor types, a number), so a grammar fills the fields the
// moment a sentence lands. No AI round-trip, no network, no loading — a
// walk-and-talk pace survives hospital dead zones.
//
// This module is pure so every phrasing can be unit-tested.
import { FLOOR_TYPES } from "./classicStore";
import type { Rules } from "./rules";

export interface RoverDraft {
  roomNumber?: string;
  roomName?: string;
  roomType?: string;      // a Scope label
  floorType?: string;     // one of FLOOR_TYPES
  fixtureCount?: number;
  /** free text — departments are whatever the account calls them */
  department?: string;
}

/** spoken commands that drive the flow instead of filling fields */
export type RoverCommand = "confirm" | "clear" | "cancel" | null;

export interface RoverParse {
  draft: RoverDraft;      // ONLY the fields this utterance mentioned
  command: RoverCommand;
  /** the name was said with a label ("room name …", "called …"), not left over */
  nameLabeled?: boolean;
}

/**
 * What the walker is standing in (Josh, 2026-10-28: Fairview's CAD numbers are "FV4-297" —
 * spoken "F V 4 297", or just "297"). A spoken number lands on the room number it means.
 */
export interface RoverContext {
  /** the open room's number as stored */
  currentNumber?: string;
  /** every room number on this floor */
  floorNumbers?: string[];
}

// ── number words the recognizer sometimes emits instead of digits ──────────
const NUM_WORDS: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20
};

const DIGIT_WORDS = new Set(["zero", "oh", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]);
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/**
 * Spoken number runs → digits, for runs of 2+ number words: "one oh two" → 102, "two ninety
 * seven" → 297, "four twenty one" → 421, "one hundred two" → 102. A single number word stays a
 * word ("exam room one", "two fixtures" read on their own).
 */
function spokenNumbers(t: string): string {
  const words = t.trim().split(/\s+/);
  const isNum = (w: string) => DIGIT_WORDS.has(w) || w in TEENS || w in TENS || w === "hundred";
  const out: string[] = [];
  for (let i = 0; i < words.length;) {
    let j = i;
    while (j < words.length && isNum(words[j])) j++;
    if (j - i >= 2) {
      let digits = "";
      for (let k = i; k < j;) {
        const w = words[k];
        if (w === "hundred") {
          // "one hundred" → 1·00; "one hundred two" → 102
          const rest = k + 1 < j ? words[k + 1] : "";
          digits += rest && (DIGIT_WORDS.has(rest) && rest !== "oh") ? "0" : rest ? "" : "00";
          k++;
        } else if (w in TENS) {
          const unit = k + 1 < j && DIGIT_WORDS.has(words[k + 1]) && words[k + 1] !== "oh" && words[k + 1] !== "zero" ? NUM_WORDS[words[k + 1]] : null;
          digits += String(TENS[w] + (unit ?? 0));
          k += unit === null ? 1 : 2;
        } else if (w in TEENS) {
          digits += String(TEENS[w]);
          k++;
        } else {
          digits += String(NUM_WORDS[w]);
          k++;
        }
      }
      out.push(digits);
      i = j;
    } else {
      out.push(words[i]);
      i++;
    }
  }
  return " " + out.join(" ") + " ";
}

function normalize(text: string): string {
  const t = " " + text.toLowerCase().replace(/#/g, " number ").replace(/[.,!?;:()"']/g, " ").replace(/\s+/g, " ").trim() + " ";
  return spokenNumbers(t);
}

// ── room numbers as the facility writes them ────────────────────────────────

const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const digitsOf = (s: string) => s.replace(/\D/g, "");

/** the room number a spoken code means: one on this floor, the open room's own, or as said */
function resolveNumber(letters: string, groups: string[], tail: string, ctx: RoverContext, anyRoom: boolean): string | null {
  const said = alnum(letters + groups.join("") + tail);
  const d = digitsOf(groups.join(""));
  const cur = String(ctx.currentNumber ?? "").trim();
  const curDigits = digitsOf(cur);
  // the open room's own number, said in full or by its last digits
  if (cur && (alnum(cur) === said || (d && (curDigits === d || (d.length >= 2 && curDigits.endsWith(d)))) && (!tail || alnum(cur).endsWith(tail)))) {
    return cur;
  }
  if (!anyRoom) return null;
  const nums = (ctx.floorNumbers ?? []).map((n) => String(n ?? "").trim()).filter(Boolean);
  const exact = nums.filter((n) => alnum(n) === said);
  if (exact.length === 1) return exact[0];
  let hits = nums.filter((n) => d && (digitsOf(n) === d || (d.length >= 3 && digitsOf(n).endsWith(d))) && (!tail || alnum(n).endsWith(tail)));
  if (hits.length > 1 && letters) hits = hits.filter((n) => alnum(n).startsWith(letters));
  if (hits.length === 1) return hits[0];
  // not on this floor: written the way this floor writes its numbers ("F V 4 3 1 0" → FV4-310)
  const styled = inFloorStyle(letters, d, tail, nums);
  if (styled) return styled;
  // …or as said: "F V 4 297" → FV4-297, "102" → 102, "12 b" → 12B
  const parts = groups.every((g) => /^\d$/.test(g)) ? [groups.join("")] : groups;
  return letters + parts.join("-") + tail;
}

/** the floor's usual number shape ("FV4-297" → letters, 1 digit, dash, 3 digits), filled in */
function inFloorStyle(letters: string, digits: string, tail: string, nums: string[]): string | null {
  if (!nums.length || !digits) return null;
  const shape = (n: string) => n.toUpperCase().replace(/[A-Z]/g, "L").replace(/\d/g, "D");
  const count = new Map<string, number>();
  for (const n of nums) count.set(shape(n), (count.get(shape(n)) ?? 0) + 1);
  const [best] = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  const m = /^(L*)(D+)-(D+)$/.exec(best);
  if (!m || m[2].length + m[3].length !== digits.length || tail) return null;
  // the letters said, or the ones this floor's numbers of that shape use
  const own = letters || (() => {
    const lead = new Map<string, number>();
    for (const n of nums) if (shape(n) === best) { const l = /^[A-Z]*/.exec(n.toUpperCase())![0]; lead.set(l, (lead.get(l) ?? 0) + 1); }
    return [...lead.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  })();
  if (own.length !== m[1].length) return null;
  return `${own}${digits.slice(0, m[2].length)}-${digits.slice(m[2].length)}`;
}

/**
 * Find the spoken room numbers: a run of number pieces — letters the floor's numbers start with
 * ("f v", "fv"), digit groups, an optional letter tag — that holds a digit.
 */
function codeRuns(t: string, ctx: RoverContext): { start: number; end: number; letters: string; groups: string[]; tail: string }[] {
  const prefixes = new Set<string>();
  for (const n of ctx.floorNumbers ?? []) {
    const m = /^[A-Z]+/.exec(alnum(String(n ?? "")));
    if (m) for (let i = 1; i <= m[0].length; i++) prefixes.add(m[0].slice(0, i));
  }
  const words = t.trim().split(/\s+/);
  const runs: { start: number; end: number; letters: string; groups: string[]; tail: string }[] = [];
  for (let i = 0; i < words.length; i++) {
    let j = i, letters = "";
    // letters in front: single letters ("f v"), or the start of the floor's own prefixes ("fv")
    while (j < words.length && /^[a-z]{1,3}$/.test(words[j]) && prefixes.has((letters + words[j]).toUpperCase())) {
      letters += words[j].toUpperCase();
      j++;
    }
    // then the pieces that carry digits: "4", "297", "4-297", "fv4", "4e-210", "12b"
    const groups: string[] = [];
    while (j < words.length && /^[a-z]{0,3}\d[a-z0-9]*(?:-[a-z0-9]+)*$/.test(words[j])) {
      groups.push(...(/^\d+(?:-\d+)+$/.test(words[j]) ? words[j].split("-") : [words[j].toUpperCase()]));
      j++;
    }
    if (!groups.length) continue;
    let tail = "";
    if (j < words.length && /^[a-z]$/.test(words[j]) && words[j] !== "a" && words[j] !== "i") { tail = words[j].toUpperCase(); j++; }
    runs.push({ start: i, end: j, letters, groups, tail });
    i = j - 1;
  }
  return runs;
}

/** "seventeen" → 17 for a single count word */
function wordToCount(w: string): number | null {
  if (/^\d+$/.test(w)) return Number(w);
  return w in NUM_WORDS ? NUM_WORDS[w] : null;
}

// ── floor-type vocabulary: what people actually say on a walk ──────────────
const FLOOR_PATTERNS: [RegExp, string][] = [
  [/\bcarpet(ed)?\b/, "Carpet"],
  [/\b(hard floors? unfinished|unfinished(?: hard)? floors?|concrete|bare floors?)\b/, "Hard floor — unfinished"],
  [/\b(hard floors?(?: finished)?|finished(?: hard)? floors?|tiled?|vct|vinyl|linoleum|terrazzo|waxed floors?)\b/, "Hard floor — finished"]
];
void FLOOR_TYPES; // documented source of the three labels above

// aliases the strict mapper knows, spoken forms included
const TYPE_ALIASES: [string, string][] = [
  ["or room", "Operating Room"], ["operating room", "Operating Room"],
  ["er room", "Emergency Room"], ["emergency room", "Emergency Room"],
  ["patient room", "Patient Room"], ["exam room", "Exam Room"],
  ["break room", "Lounge"], ["conference room", "Office"],
  ["nurses station", "Office"], ["isolation room", "Patient Room"],
  ["bathroom", "Restroom"], ["rest room", "Restroom"],
  ["utility room", "Utility Room"], ["waiting room", "Waiting Room"],
  ["locker room", "Locker Room"], ["procedure room", "Procedure Room"],
  ["mechanical room", "Mechanical Room"], ["electrical room", "Electrical Room"]
];

/** every way a room type can be said, longest phrasing first */
function typeVocabulary(rules: Rules): [string, string][] {
  const out: [string, string][] = [];
  for (const rt of rules.roomTypes) {
    const label = rt.label;
    out.push([label.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim(), label]);
  }
  for (const [spoken, label] of TYPE_ALIASES) {
    if (rules.roomTypes.some((rt) => rt.label === label)) out.push([spoken, label]);
  }
  return out.sort((a, b) => b[0].length - a[0].length);
}

const FILLERS = new Set([
  "room", "name", "number", "type", "floor", "department", "the", "is", "a", "an", "it",
  "its", "it's", "this", "that", "with", "and", "uh", "um", "of", "for", "has"
]);

/**
 * Parse one utterance. Returns only what was said (merge onto the running
 * draft yourself), plus any spoken command. Handles both the labeled form
 * and the terse form, including "…zero fixtures confirm" in one breath.
 */
export function parseRoverUtterance(text: string, rules: Rules, ctx: RoverContext = {}): RoverParse {
  const draft: RoverDraft = {};
  let command: RoverCommand = null;
  let t = normalize(text);

  // spoken commands — alone, or trailing after the data
  const cmd = /\b(confirm(ed)?|save it|looks good|next room|next)\s*$/;
  if (cmd.test(t)) { command = "confirm"; t = t.replace(cmd, " "); }
  else if (/^\s*(clear|start over|reset)\s*$/.test(t)) return { draft, command: "clear" };
  else if (/^\s*(cancel|never mind|nevermind|close)\s*$/.test(t)) return { draft, command: "cancel" };

  // 0 · department — labeled, BEFORE the room-number step: departments carry
  // digits ("4 east", "med surg 2") and must not donate them to the number.
  // Capture runs to the next labeled section or the end of the utterance.
  const labeledDept = /\bdepartment (?:is )?(.+?)(?= \broom (?:number|name|type)\b| \bfloor type\b| \bnumber\b| \bfixtures?\b|$)/;
  const mDept = labeledDept.exec(t);
  if (mDept) {
    const words = mDept[1].trim().replace(/\s+/g, " ");
    if (words) {
      draft.department = words.split(" ")
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
    }
    t = t.replace(labeledDept, " ");
  }

  // 1 · fixtures — "<n> fixtures", "fixtures <n>", "no fixtures"
  t = t.replace(/\b(no|\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty) (fixtures?|sinks?)\b/,
    (_m, n: string) => {
      draft.fixtureCount = n === "no" ? 0 : wordToCount(n) ?? 0;
      return " ";
    });
  t = t.replace(/\bfixtures? (\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/, (_m, n: string) => {
    draft.fixtureCount = wordToCount(n) ?? 0;
    return " ";
  });

  // 2 · floor type — keyworded, with or without the "floor type" label
  t = t.replace(/\bfloor type\b/g, " ");
  for (const [re, label] of FLOOR_PATTERNS) {
    if (re.test(t)) {
      draft.floorType = label;
      t = t.replace(re, " ");
      break;
    }
  }

  // 3 · room number — said after "number", or first thing in the breath ("102 office…",
  // "F V 4 297 patient room…"), matched to this floor's own numbers. Digits further in are the
  // name's ("exam room 2", "med room 4") unless they're the open room's own number said again.
  {
    const words = t.trim().split(/\s+/);
    const runs = codeRuns(t, ctx);
    const lead = (() => { let i = 0; while (i < words.length && FILLERS.has(words[i])) i++; return i; })();
    let taken: { start: number; end: number; value: string } | null = null;
    for (const r of runs) {
      const labeled = r.start > 0 && words[r.start - 1] === "number";
      const first = r.start === lead || (labeled && words.slice(0, r.start - 1).every((w) => FILLERS.has(w)));
      const value = resolveNumber(r.letters, r.groups, r.tail, ctx, labeled || first);
      if (value === null) continue;
      taken = { start: labeled ? r.start - 1 : r.start, end: r.end, value };
      if (labeled && words[r.start - 2] === "room") taken.start = r.start - 2;
      break;
    }
    if (taken) {
      draft.roomNumber = taken.value;
      t = " " + [...words.slice(0, taken.start), ...words.slice(taken.end)].join(" ") + " ";
    }
  }

  // 4 · room type — labeled, else the EARLIEST vocabulary hit. Only that
  // first occurrence is consumed, so "office … dr smith's office" keeps the
  // second "office" for the room's NAME.
  const vocab = typeVocabulary(rules);
  const labeledType = /\broom type ([a-z][a-z /-]*?)(?=\broom\b|$)/.exec(t);
  let typed = false;
  if (labeledType) {
    const said = labeledType[1].trim();
    const hit = vocab.find(([spoken]) => said.startsWith(spoken)) ??
      vocab.find(([spoken]) => said.includes(spoken));
    if (hit) {
      draft.roomType = hit[1];
      t = t.replace("room type " + hit[0], " ");
      typed = true;
    }
  }
  if (!typed) {
    let best: { at: number; spoken: string; label: string } | null = null;
    let hits = 0;
    for (const [spoken, label] of vocab) {
      const at = t.indexOf(" " + spoken + " ");
      if (at < 0) continue;
      // count every occurrence of the winning phrase later; here pick earliest
      if (best === null || at < best.at || (at === best.at && spoken.length > best.spoken.length)) {
        best = { at, spoken, label };
      }
    }
    if (best) {
      draft.roomType = best.label;
      const needle = " " + best.spoken + " ";
      for (let i = t.indexOf(needle); i >= 0; i = t.indexOf(needle, i + 1)) hits++;
      // Josh's rule (2026-09-01): one mention can serve BOTH fields. "Dr
      // Smith's office" or "exam room one" names the room WITH its type in
      // the phrase — so when the type phrase appears once and has a real
      // word right before it (…smith's OFFICE) or a short tag right after
      // it (exam room ONE / exam room B), it stays in the room NAME too.
      // Said twice ("office dr smith's office"), the first is the type and
      // only the second belongs to the name — exactly as before.
      const before = t.slice(0, best.at).trim().split(/\s+/).filter(Boolean).pop() ?? "";
      const after = t.slice(best.at + best.spoken.length + 2).trim().split(/\s+/)[0] ?? "";
      const beforeIsWord = !!before && !FILLERS.has(before) && !/^\d/.test(before);
      const afterIsTag = !!after && (/^\d+$/.test(after) || after in NUM_WORDS || /^[a-z]$/.test(after));
      const keepInName = hits === 1 && (beforeIsWord || afterIsTag);
      if (!keepInName) {
        t = t.slice(0, best.at) + " " + t.slice(best.at + best.spoken.length + 1);
      } else {
        // bind the kept phrase into one token so the filler strip below
        // can't eat its "room" ("exam~room" survives, then unbinds)
        t = t.slice(0, best.at + 1) + best.spoken.replace(/ /g, "~") +
          t.slice(best.at + 1 + best.spoken.length);
      }
    }
  }

  // 5 · room name — labeled phrase wins ("room name …", "name is …", "called …"); otherwise the
  // meaningful words left over ("dr smith s office"), minus the talk around them ("okay…", "so…")
  const labeledName = /\b(?:room name|name is|named|called)\b (.+?)(?=\broom (?:type|number)\b|$)/.exec(t);
  let nameRaw = labeledName ? labeledName[1] : "";
  if (labeledName) t = t.replace(labeledName[0], " ");
  if (!nameRaw) {
    // "room" after a name word is the name's ("Med Room", "Clean Room"); on its own it's talk
    const left: string[] = [];
    for (const w of t.split(/\s+/)) {
      if (!w) continue;
      if (!FILLERS.has(w) || (w === "room" && left.length > 0 && !TALK.has(left[left.length - 1]))) left.push(w);
    }
    while (left.length && TALK.has(left[0])) left.shift();
    while (left.length && TALK.has(left[left.length - 1])) left.pop();
    // a lone number or number word is never a name
    if (!(left.length === 1 && (/^\d+$/.test(left[0]) || left[0] in NUM_WORDS))) nameRaw = left.join(" ");
  }
  nameRaw = nameRaw.replace(/~/g, " ").replace(/\s+s\b/g, "'s").replace(/\s+/g, " ").trim();
  if (nameRaw) {
    // Title Case, keeping possessives ("dr smith's office" → "Dr Smith's Office")
    draft.roomName = nameRaw.split(" ")
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
  }

  return { draft, command, ...(labeledName && nameRaw ? { nameLabeled: true } : {}) };
}

/** talk around the data that never belongs in a room name, at either end of what's left */
const TALK = new Set([
  "okay", "ok", "so", "yeah", "yes", "yep", "alright", "like", "just", "well", "actually", "then",
  "also", "now", "please", "sure", "let's", "lets", "see", "put", "change", "set", "make", "here",
  "there", "um", "uh", "hmm", "oh", "right", "go", "got", "i", "i'm", "im", "we", "you", "to", "be",
  // the "s" of "it's" once its apostrophe is gone
  "s"
]);

/**
 * Merge an utterance's fields onto the running draft (spoken-last wins). With `keepName` (a name
 * was already said for this room), a one-word leftover — a stray word the recognizer caught —
 * doesn't replace it; a labeled name or a longer one does.
 */
export function mergeDraft(base: RoverDraft, add: RoverDraft, opts?: { keepName?: boolean; nameLabeled?: boolean }): RoverDraft {
  const out = { ...base };
  if (add.roomNumber !== undefined) out.roomNumber = add.roomNumber;
  const strayWord = opts?.keepName && !opts.nameLabeled && String(add.roomName ?? "").trim().split(/\s+/).length < 2;
  if (add.roomName !== undefined && !strayWord) out.roomName = add.roomName;
  if (add.roomType !== undefined) out.roomType = add.roomType;
  if (add.floorType !== undefined) out.floorType = add.floorType;
  if (add.fixtureCount !== undefined) out.fixtureCount = add.fixtureCount;
  if (add.department !== undefined) out.department = add.department;
  return out;
}
