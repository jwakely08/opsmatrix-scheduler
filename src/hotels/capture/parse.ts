// The LOCAL grammar — pure, instant, works in a dead zone and without a key.
// It reads what a rooms manager actually says on a walk: room numbers,
// conditions, faults, hand-offs, holds, inspection calls, notes. The Claude
// parser (ai.ts) reads anything; this one reads the common 90% for free and
// is what the tests pin down. Utterances split into clauses; the room carries
// across clauses ("412 AC warm, minibar open, pull it, give it to Marco").
import type { Intent, CaptureContext } from "./intents";
import type { WorkOrder } from "../store";

const NUM_WORDS: Record<string, number> = {
  zero: 0, oh: 0, o: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100
};

/** "four twelve" → "412", "four twenty" → "420", "three oh one" → "301", "four hundred and seven" → "407" */
export function numberWordsToDigits(text: string): string {
  const orig = text.split(/\s+/);
  const toks = orig.map((t) => t.toLowerCase());
  const out: string[] = [];
  let i = 0;
  while (i < toks.length) {
    const w = toks[i].replace(/[^a-z-]/g, "");
    if (w in NUM_WORDS || /^[a-z]+-[a-z]+$/.test(w)) {
      // gather a run of number words
      const run: string[] = [];
      let j = i;
      while (j < toks.length) {
        const t = toks[j].replace(/[^a-z-]/g, "");
        const parts = t.split("-");
        if (parts.every((p) => p in NUM_WORDS) || t === "and") { run.push(...(t === "and" ? [] : parts)); j++; } else break;
      }
      if (run.length >= 2 || (run.length === 1 && NUM_WORDS[run[0]] >= 100)) {
        // spoken room numbers: [hundreds] [tens] [ones]; "four twelve" = 4,12; "four twenty" = 4,20; "three oh one" = 3,0,1
        let s = "";
        if (run.includes("hundred")) {
          const h = NUM_WORDS[run[0]] ?? 0;
          const rest = run.slice(run.indexOf("hundred") + 1).reduce((acc, r) => acc + NUM_WORDS[r], 0);
          s = String(h * 100 + rest);
        } else {
          const first = NUM_WORDS[run[0]];
          const rest = run.slice(1);
          let tail = 0;
          if (rest.length === 1) tail = NUM_WORDS[rest[0]];
          else if (rest.length === 2 && NUM_WORDS[rest[0]] >= 20 && NUM_WORDS[rest[1]] < 10) tail = NUM_WORDS[rest[0]] + NUM_WORDS[rest[1]];
          else tail = Number(rest.map((r) => String(NUM_WORDS[r])).join(""));
          s = String(first) + String(tail).padStart(2, "0");
        }
        out.push(s);
        i = j;
        continue;
      }
    }
    out.push(orig[i]);
    i++;
  }
  return out.join(" ");
}

const FAULTS: [RegExp, WorkOrder["category"]][] = [
  [/\b(a\.?c\.?|air|ac unit|cooling|heat(ing)?|thermostat|hvac|blowing warm|blowing hot|blowing cold|too hot|too cold|not cooling)\b/i, "hvac"],
  [/\b(leak|drip|drain|toilet|faucet|tap|shower|water|clog|valve|flush|tub|sink)\b/i, "plumbing"],
  [/\b(light|lamp|outlet|bulb|power|switch|flicker|breaker|socket)\b/i, "electrical"],
  [/\b(tv|television|remote|wifi|wi-fi|internet|phone|safe)\b/i, "tv"],
  [/\b(minibar|mini bar|mini-bar|fridge|refrigerator)\b/i, "minibar"],
  [/\b(chair|desk|bed|door|drawer|hinge|handle|curtain|blind|headboard|closet|mirror|carpet|stain|wobbl|iron|hair ?dryer|window)\b/i, "furniture"],
  [/\b(towels?|linen|amenit|soap|toilet paper|glasses|coffee|pillow|sheets?)\b/i, "housekeeping"]
];
const FAULT_CUE = /\b(broken|not working|doesn'?t work|won'?t|isn'?t working|stuck|hanging|missing|out\b|warm|cold|leak|drip|flicker|loose|cracked|stain|torn|dead|no |slow|clog|jam|noise|noisy|smell|damaged|ripped|keeps|running|overflow|not draining|burnt|blown|rattl|squeak|sticks|off the|fell)/i;

function roomIn(clause: string, ctx: CaptureContext): { room: string | null; rest: string } {
  let m = clause.match(/\b(?:suite|room|rm)?\s*#?\s*(\d{3,4}[a-z]?)\b/i);
  if (!m) m = clause.match(/\bsuite\s+(\d{2,4})\b/i);
  if (!m) {
    // public areas by name
    const pub = ctx.rooms.find((r) => !/^\d/.test(r) && r.length > 3 && new RegExp("\\b" + r.replace(/[^a-z0-9 ]/gi, " ").trim().replace(/\s+/g, "\\s+") + "\\b", "i").test(clause));
    if (pub) return { room: pub, rest: clause.replace(new RegExp(pub.replace(/[^a-z0-9 ]/gi, " ").trim().replace(/\s+/g, "\\s+"), "i"), "").trim() };
    return { room: null, rest: clause };
  }
  const num = m[1].toUpperCase();
  const suite = ctx.rooms.find((r) => /^suite/i.test(r) && r.replace(/\D/g, "") === num);
  const saidSuite = /^\s*suite/i.test(m[0]);
  const room = (saidSuite && suite) ? suite : (ctx.rooms.find((r) => r.toUpperCase() === num) ?? suite ?? num);
  return { room, rest: (clause.slice(0, m.index) + " " + clause.slice((m.index ?? 0) + m[0].length)).replace(/\s+/g, " ").trim() };
}

function firstName(ctx: CaptureContext, word: string): string | null {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return null;
  const hit = ctx.staff.find((s) => s.name.toLowerCase().split(/\s+/)[0] === w || s.name.toLowerCase() === w);
  return hit ? hit.name : null;
}

function roleTask(ctx: CaptureContext, name: string, clause: string): Intent["task"] {
  if (/turn ?down/i.test(clause)) return "turndown";
  if (/stay ?over/i.test(clause)) return "stayover";
  if (/deep/i.test(clause)) return "deep";
  if (/inspect/i.test(clause)) return "inspect";
  const role = ctx.staff.find((s) => s.name === name)?.role;
  return role === "engineering" ? "repair" : role === "inspector" ? "inspect" : "departure";
}

export function splitClauses(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/\s*(?:[,.;!?]|\bthen\b|\balso\b|\band then\b|\band\b(?! (?:heat|cold|hot|the\b))|\bplus\b)\s*/i)
    .map((c) => c.trim())
    .filter(Boolean);
}

/** parse one utterance into intents (pure) */
export function parseLocal(utterance: string, ctx: CaptureContext): Intent[] {
  const text = numberWordsToDigits(utterance.trim());
  if (!text) return [];
  const intents: Intent[] = [];
  let current: string | null = ctx.currentRoom ?? null;
  const known = (r: string | null) => Boolean(r && ctx.rooms.some((x) => x.toUpperCase() === r.toUpperCase()));

  for (const clauseRaw of splitClauses(text)) {
    const { room: found, rest } = roomIn(clauseRaw, ctx);
    if (found) current = found;
    const clause = rest.trim();
    const room = current ?? undefined;
    const conf = (base: number) => Math.round(base * (room ? (known(room) ? 1 : 0.8) : 0.7) * 100) / 100;
    const lower = clause.toLowerCase();
    if (!clause && found) {
      // a bare room number just moves the focus
      continue;
    }

    // report / handover lines
    let m = lower.match(/^(?:for the handover|handover note|note for (?:the )?handover|for the report|report line|report)[:,]?\s*(.+)$/);
    if (m) { intents.push({ type: "report_line", room, confidence: conf(0.95), text: m[1], readback: `Handover: ${m[1]}` }); continue; }

    // inspection calls
    if (/\b(pass(?:ed|es)?|looks good|approved|good to go|signed off|is ready|ready to walk|ready to go)\b/.test(lower) && !/\bnot\b|fail|n't/.test(lower)) {
      intents.push({ type: "inspect_pass", room, confidence: conf(0.92), readback: `${room ?? "?"} → inspection passed → ready` }); continue;
    }
    if (/\b(fail(?:ed|s)?|reject(?:ed)?|not passing|no good|doesn'?t pass|redo|send (?:it )?back)\b/.test(lower)) {
      const notes = lower.replace(/^(?:it |that |this )?(?:fail(?:ed|s)?|reject(?:ed)?|not passing|no good|doesn'?t pass|redo|send (?:it )?back)(?: inspection)?[:,\s-]*/, "").trim();
      intents.push({ type: "inspect_fail", room, confidence: conf(0.9), notes: notes || undefined, readback: `${room ?? "?"} → inspection FAILED${notes ? " — " + notes : ""} → back to dirty` }); continue;
    }

    // holds and flags
    if (/\b(pull (?:it |that |this )?(?:from|off|out of)|do not walk|don'?t walk|not walkable|hold (?:it|the room|this|that)|block (?:it|the room)|take (?:it )?(?:off|out of) (?:the )?arrivals|off (?:the )?arrivals|out of order|ooo)\b/.test(lower)) {
      const ooo = /out of order|ooo/.test(lower);
      intents.push({ type: "flag", room, flag: "do_not_walk", confidence: conf(0.93), readback: `${room ?? "?"} → pulled from tonight's arrivals — do not walk${ooo ? " (out of order)" : ""}`, text: ooo ? "out of order" : undefined }); continue;
    }
    if (/\b((?:ok|okay|good|clear(?:ed)?|fine|safe) to walk|walk it|release (?:it|the hold)|put (?:it )?back on arrivals|back on (?:the )?arrivals)\b/.test(lower)) {
      intents.push({ type: "flag", room, flag: "walk_ok", confidence: conf(0.9), readback: `${room ?? "?"} → cleared to walk` }); continue;
    }
    if (/\bvip\b/.test(lower) && !/\bnot\b|remove|no longer/.test(lower)) { intents.push({ type: "flag", room, flag: "vip", confidence: conf(0.9), readback: `${room ?? "?"} → VIP` }); continue; }

    // hand-offs
    m = lower.match(/\b(?:give|send|assign|hand|pass|leave) (?:it |that |this |the room |them )?(?:to |over to |off to )?([a-z]+)\b/) ?? lower.match(/\b([a-z]+) (?:can|will|should|to) (?:take|do|handle|get|grab|have)(?: (?:it|that|this|the room))?\b/) ?? lower.match(/\b(?:put|get) ([a-z]+) on (?:it|that|this|the room)\b/) ?? lower.match(/\b([a-z]+)'?s (?:got|taking|on) (?:it|that|this)\b/);
    if (m) {
      const name = firstName(ctx, m[1]);
      if (name) { intents.push({ type: "assign", room, staff: name, task: roleTask(ctx, name, lower), confidence: conf(0.92), readback: `${room ?? "?"} → assign to ${name.split(" ")[0]} (${roleTask(ctx, name, lower)})` }); continue; }
    }

    // conditions
    if (/\b(vacant dirty|is dirty|dirty|vd|checked out|checkout|check out|departed|strip(?:ped)? it|needs a full clean|turn it)\b/.test(lower) && !FAULT_CUE.test(lower.replace(/dirty/g, ""))) {
      intents.push({ type: "set_condition", room, condition: "dirty", confidence: conf(0.9), readback: `${room ?? "?"} → dirty` }); continue;
    }
    if (/\b(in progress|being cleaned|started on|cleaning it now|cleaning now|working on it|on it now|started cleaning)\b/.test(lower)) {
      intents.push({ type: "set_condition", room, condition: "in_progress", confidence: conf(0.9), readback: `${room ?? "?"} → being cleaned` }); continue;
    }
    if (/\b(pickup|pick up|touch ?up|refresh)\b/.test(lower)) {
      intents.push({ type: "set_condition", room, condition: "pickup", confidence: conf(0.85), readback: `${room ?? "?"} → needs a pickup` }); continue;
    }
    if (/\b(is clean|clean now|cleaned|done|finished|vacant clean|vc|all set|wrapped up|complete)\b/.test(lower) && !FAULT_CUE.test(lower)) {
      intents.push({ type: "set_condition", room, condition: "clean", confidence: conf(0.88), readback: `${room ?? "?"} → clean, ready to inspect` }); continue;
    }

    // faults → work orders
    const cat = FAULTS.find(([re]) => re.test(lower))?.[1];
    if (cat && (FAULT_CUE.test(lower) || /\b(ac|a\/c|hvac)\b/.test(lower) || cat === "hvac")) {
      const blocking = /\b(can'?t sell|unsellable|block(?:s|ing)? the room|out of service|major|flood|no power|no water)\b/.test(lower);
      const eng = ctx.staff.find((s) => s.role === "engineering");
      const textOut = clause.replace(/^(?:the |its |it's |there's |there is |has |got )+/i, "").trim();
      intents.push({ type: "create_work_order", room, category: cat, blocking, text: textOut, confidence: conf(0.9), readback: `${room ?? "?"} → ${textOut} → work order → ${eng ? "Engineering (" + eng.name.split(" ")[0] + ")" : "Engineering"}${blocking ? " — blocks the room" : ""}` }); continue;
    }

    // explicit notes; then the honest fallback
    m = lower.match(/^(?:note|fyi|remember|heads up|reminder)[:,]?\s*(.+)$/);
    if (m) { intents.push({ type: "note", room, text: m[1], confidence: conf(0.9), readback: `${room ? room + " — " : ""}note: ${m[1]}` }); continue; }
    if (clause.length > 2) intents.push({ type: "note", room, text: clause, confidence: conf(0.5), readback: `${room ? room + " — " : ""}note: ${clause}` });
  }
  return intents;
}
