// The ONE back button (Josh's rule, 2026-08-28): every screen carries the
// same back button, and it goes to the page the user was ACTUALLY on before —
// not the dashboard, not a guess. classic.html and maps.html are separate
// documents, so the trail lives in sessionStorage where both can see it.
//
// Entries are plain strings:
//   "classic:<sidebar label>"  — a page inside classic.html (e.g. "classic:Max Team")
//   "hub:<view>"               — a maps.html view: map | rooms | schedules |
//                                spaces/explorer | spaces/list | spaces/map |
//                                scope | workload | floorcare
//
// Contract: every page/view calls navVisit(token) when it becomes current.
// The back button calls navBack(), which pops the current entry and returns
// the previous one (the destination re-pushes itself on arrival).

const KEY = "om_nav_stack";
const MAX = 60;

export function navStack(): string[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}

function save(stack: string[]) {
  try { sessionStorage.setItem(KEY, JSON.stringify(stack.slice(-MAX))); } catch { /* storage off */ }
}

/** the page/view `token` is now on screen — record it (dedupes repeats) */
export function navVisit(token: string) {
  if (!token) return;
  const s = navStack();
  if (s[s.length - 1] === token) return;
  s.push(token);
  save(s);
}

/**
 * Where does back go from here? Pops the current entry AND the destination
 * (the destination re-registers itself via navVisit when it loads), and
 * returns the destination token — or null when there's no history yet.
 */
export function navBack(): string | null {
  const s = navStack();
  s.pop(); // the page we are on now
  const target = s.pop() ?? null;
  save(s);
  return target;
}

/** hub token → the maps.html hash that shows that view */
export function hubHashFor(token: string): string {
  const v = token.replace(/^hub:/, "");
  if (v === "map" || v === "schedules" || v === "rooms") return "#" + (v === "map" ? "" : "tab-" + v);
  if (v.startsWith("spaces")) {
    const sub = v.split("/")[1] ?? "explorer";
    return "#spaces?view=" + sub;
  }
  return "#" + v; // scope | workload | floorcare
}

/** a full relative URL for a token, usable from either document */
export function urlFor(token: string): string {
  if (token.startsWith("classic")) return "./classic.html";
  return "./maps.html" + hubHashFor(token);
}
