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
}

/** spoken commands that drive the flow instead of filling fields */
export type RoverCommand = "confirm" | "clear" | "cancel" | null;

export interface RoverParse {
  draft: RoverDraft;      // ONLY the fields this utterance mentioned
  command: RoverCommand;
}

// ── number words the recognizer sometimes emits instead of digits ──────────
const NUM_WORDS: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20
};

function normalize(text: string): string {
  let t = " " + text.toLowerCase().replace(/[.,!?;:()"']/g, " ").replace(/\s+/g, " ").trim() + " ";
  // spelled digit runs → digits ("one oh two" → 102), only for runs of 2+
  t = t.replace(/((?:\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)\b ){1,}\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)\b)/g,
    (run) => " " + run.trim().split(/\s+/).map((w) => String(NUM_WORDS[w] ?? "")).join("") + " ");
  return t;
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
  "room", "name", "number", "type", "floor", "the", "is", "a", "an", "it",
  "its", "it's", "this", "that", "with", "and", "uh", "um", "of", "for", "has"
]);

/**
 * Parse one utterance. Returns only what was said (merge onto the running
 * draft yourself), plus any spoken command. Handles both the labeled form
 * and the terse form, including "…zero fixtures confirm" in one breath.
 */
export function parseRoverUtterance(text: string, rules: Rules): RoverParse {
  const draft: RoverDraft = {};
  let command: RoverCommand = null;
  let t = normalize(text);

  // spoken commands — alone, or trailing after the data
  const cmd = /\b(confirm(ed)?|save it|looks good|next room|next)\s*$/;
  if (cmd.test(t)) { command = "confirm"; t = t.replace(cmd, " "); }
  else if (/^\s*(clear|start over|reset)\s*$/.test(t)) return { draft, command: "clear" };
  else if (/^\s*(cancel|never mind|nevermind|close)\s*$/.test(t)) return { draft, command: "cancel" };

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

  // 3 · room number — labeled first, else the first digit-bearing token
  const labeledNum = /\b(?:room )?number ([a-z]?\d[\w-]*)\b/;
  const mNum = labeledNum.exec(t);
  if (mNum) {
    draft.roomNumber = mNum[1].toUpperCase();
    t = t.replace(labeledNum, " ");
  } else {
    const bare = /(?:^| )([a-z]?\d[\w-]*)(?= |$)/.exec(t);
    if (bare) {
      draft.roomNumber = bare[1].toUpperCase();
      t = t.replace(bare[1], " ");
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
    for (const [spoken, label] of vocab) {
      const at = t.indexOf(" " + spoken + " ");
      if (at >= 0 && (best === null || at < best.at ||
        (at === best.at && spoken.length > best.spoken.length))) {
        best = { at, spoken, label };
      }
    }
    if (best) {
      draft.roomType = best.label;
      t = t.slice(0, best.at) + " " + t.slice(best.at + best.spoken.length + 1);
    }
  }

  // 5 · room name — labeled phrase wins; otherwise whatever meaningful words
  // are left over ("dr smith s office") become the name
  const labeledName = /\broom name (.+?)(?=\broom (?:type|number)\b|$)/.exec(t);
  let nameRaw = labeledName ? labeledName[1] : "";
  if (labeledName) t = t.replace(labeledName[0], " ");
  if (!nameRaw) {
    nameRaw = t.split(/\s+/).filter((w) => w && !FILLERS.has(w)).join(" ");
  }
  nameRaw = nameRaw.replace(/\s+s\b/g, "'s").replace(/\s+/g, " ").trim();
  if (nameRaw) {
    // Title Case, keeping possessives ("dr smith's office" → "Dr Smith's Office")
    draft.roomName = nameRaw.split(" ")
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
  }

  return { draft, command };
}

/** merge an utterance's fields onto the running draft (spoken-last wins) */
export function mergeDraft(base: RoverDraft, add: RoverDraft): RoverDraft {
  const out = { ...base };
  if (add.roomNumber !== undefined) out.roomNumber = add.roomNumber;
  if (add.roomName !== undefined) out.roomName = add.roomName;
  if (add.roomType !== undefined) out.roomType = add.roomType;
  if (add.floorType !== undefined) out.floorType = add.floorType;
  if (add.fixtureCount !== undefined) out.fixtureCount = add.fixtureCount;
  return out;
}
