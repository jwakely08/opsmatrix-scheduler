// ✎ Rename rooms (Josh, 2026-11-02): in Max Space's Map View — a side panel in three steps: which
// rooms (this floor or the whole building, one room type or all, only unfinished names or every
// name), what the new name should be (the room type; type + number; new letters + number + the name
// it has now, through a letters table; or a pattern), then check the count and the before → after
// list and tap Rename. A tap on the map leaves a room out or puts one back; Undo takes the whole
// rename back. renameRooms.ts does the work. (The first version was a one-line bar in the filter
// row; on the iPad its dropdown read as plain text and "rough names" meant nothing — Josh.)
import React, { useMemo, useState } from "react";
import type { ClassicData, ClassicSpace } from "./classicStore";
import { typeIdFromLabelStrict, type Rules } from "./rules";
import {
  LETTER_ENDINGS, NAME_PRESETS, PLACEHOLDERS, applyRename, looksRough, planRename, renameGroups, typeKey, typeWord,
  undoRename, type LetterRule, type RenameChange, type TypeAbbr
} from "./renameRooms";

/** the letters table is remembered per device — the same abbreviations come up building after building */
const LETTERS_KEY = "om_rename_letters";
function loadLetters(): LetterRule[] {
  try {
    const v = JSON.parse(localStorage.getItem(LETTERS_KEY) ?? "null");
    if (Array.isArray(v) && v.length) return v.map((r) => ({ from: String(r?.from ?? ""), to: String(r?.to ?? "") }));
  } catch { /* storage off */ }
  return [{ from: "", to: "" }];
}
/** so are the room types' short forms (Patient Room → PT RM), keyed by the type's name */
const ABBR_KEY = "om_rename_type_abbr";
function loadAbbr(): TypeAbbr {
  try {
    const v = JSON.parse(localStorage.getItem(ABBR_KEY) ?? "null");
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v).map(([k, s]) => [typeKey(k), String(s ?? "")]));
    }
  } catch { /* storage off */ }
  return {};
}
type Ending = (typeof LETTER_ENDINGS)[number]["id"];

export function useRenameMode(opts: {
  /** the rooms on the floor being shown */
  floorSpaces: ClassicSpace[];
  /** every room in the building */
  buildingSpaces: ClassicSpace[];
  rules: Rules;
  commit: (mut: (d: ClassicData) => void) => void;
}) {
  const { floorSpaces, buildingSpaces, rules, commit } = opts;
  const [on, setOn] = useState(false);
  const [scope, setScope] = useState<"floor" | "building">("floor");
  const [typeId, setTypeId] = useState("");
  const [roughOnly, setRoughOnly] = useState(true);
  const [preset, setPresetRaw] = useState("type");
  const [custom, setCustom] = useState("{type} {number}");
  const [letters, setLettersRaw] = useState<LetterRule[]>(loadLetters);
  const setLetters = (next: LetterRule[]) => {
    setLettersRaw(next);
    try { localStorage.setItem(LETTERS_KEY, JSON.stringify(next)); } catch { /* storage off */ }
  };
  // what follows the letters and number, and the room types' short forms for the "shortened" ending
  const [ending, setEnding] = useState<Ending>("name");
  const [typeAbbr, setTypeAbbrRaw] = useState<TypeAbbr>(loadAbbr);
  const setAbbr = (label: string, short: string) => {
    const next = { ...typeAbbr, [typeKey(label)]: short };
    setTypeAbbrRaw(next);
    try { localStorage.setItem(ABBR_KEY, JSON.stringify(next)); } catch { /* storage off */ }
  };
  // the letters preset renames every room picked, unfinished name or not — so that filter comes off with it
  const setPreset = (id: string) => { setPresetRaw(id); if (id === "letters") setRoughOnly(false); };
  /** rooms tapped on the map: true = in, false = out, whatever the rule says */
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [last, setLast] = useState<RenameChange[] | null>(null);
  const [note, setNote] = useState("");
  const [showAll, setShowAll] = useState(false);

  const pattern = preset === "custom" ? custom
    : preset === "letters" ? (LETTER_ENDINGS.find((e) => e.id === ending) ?? LETTER_ENDINGS[0]).pattern
      : (NAME_PRESETS.find((p) => p.id === preset)?.pattern ?? "{type}");
  const pool = scope === "floor" ? floorSpaces : buildingSpaces;
  const byRule = (sp: ClassicSpace) =>
    (!typeId || typeIdFromLabelStrict(rules, sp.roomType) === typeId) &&
    (!roughOnly || looksRough(sp.roomName, sp.roomNumber));
  const picked = useMemo(
    () => pool.filter((sp) => overrides.get(sp.id) ?? byRule(sp)),
    [pool, typeId, roughOnly, overrides, rules] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const pickedIds = useMemo(() => new Set(picked.map((s) => s.id)), [picked]);
  /** the room types among the picked rooms, most rooms first — the rows of the short-forms table */
  const pickedTypes = useMemo(() => {
    const m = new Map<string, { label: string; count: number }>();
    for (const sp of picked) {
      const t = typeWord(sp);
      if (!t) continue;
      const e = m.get(typeKey(t));
      if (e) e.count++; else m.set(typeKey(t), { label: t, count: 1 });
    }
    return [...m.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [picked]);
  const plan = useMemo(() => planRename(picked, pattern, letters, typeAbbr), [picked, pattern, letters, typeAbbr]);
  const groups = useMemo(() => renameGroups(plan.changes), [plan]);

  const reset = (next: boolean) => {
    setOn(next); setOverrides(new Map()); setLast(null); setNote(""); setShowAll(false);
  };
  const roomLabel = (sp: ClassicSpace) =>
    String(sp.roomNumber ?? "").trim() || String(sp.roomName ?? "").trim() || "that room";

  return {
    on, scope, setScope, typeId, setTypeId, roughOnly, setRoughOnly, preset, setPreset, custom, setCustom,
    letters, setLetters, ending, setEnding, typeAbbr, setAbbr, pickedTypes,
    pattern, picked: pickedIds, plan, groups, note, showAll, setShowAll,
    canUndo: Boolean(last?.length),
    start: () => reset(true),
    stop: () => reset(false),
    /** a tap on a room flips it: out of the rename if the rule had it, in if it didn't */
    tap: (sp: ClassicSpace) => {
      const cur = overrides.get(sp.id) ?? byRule(sp);
      setOverrides((m) => new Map(m).set(sp.id, !cur));
      setNote(cur ? `${roomLabel(sp)} left out` : `${roomLabel(sp)} added`);
    },
    apply: () => {
      const changes = plan.changes;
      if (!changes.length) return;
      commit((d) => { applyRename(d, changes); });
      setLast(changes);
      setOverrides(new Map());
      setShowAll(false);
      setNote(`✓ Renamed ${changes.length} room${changes.length === 1 ? "" : "s"}`);
    },
    undo: () => {
      if (!last) return;
      const back = last;
      let n = 0;
      commit((d) => { n = undoRename(d, back); });
      setLast(null);
      setNote(`↶ ${n} room${n === 1 ? "" : "s"} back as ${n === 1 ? "it was" : "they were"}`);
    }
  };
}

export type RenameMode = ReturnType<typeof useRenameMode>;

/** what each choice gives, in one line, so the choice explains itself */
const CHOICE_HELP: Record<string, string> = {
  type: "“Patient Room”, “Restroom” — whatever type the room has",
  "type-number": "“Patient Room FPKb-101”",
  letters: "FPKb-101 becomes PKT101, then an ending you pick: its current name (TLT), the room type shortened (PT RM), the full type, or nothing",
  custom: "Your own pattern"
};

/** the panel: three steps, then the way out */
export function RenamePanel({ rename: r, rules, floorName }: { rename: RenameMode; rules: Rules; floorName: string }) {
  const n = r.plan.changes.length;
  const alone = [
    r.plan.noType ? `${r.plan.noType} with no room type to name ${r.plan.noType === 1 ? "it" : "them"} after` : "",
    r.plan.soiled ? `${r.plan.soiled} soiled utility (the name has to keep that word)` : "",
    r.plan.noRule ? `${r.plan.noRule} whose letters aren't in the table` : ""
  ].filter(Boolean);
  const wantsLetters = /\{prefix\}/i.test(r.pattern);
  const wantsAbbr = /\{typeabbr\}/i.test(r.pattern);
  const editLetters = (i: number, patch: Partial<LetterRule>) =>
    r.setLetters(r.letters.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const shown = r.showAll ? r.groups : r.groups.slice(0, 4);

  return (
    <aside className="pro-side renamepanel">
      <div className="pshead">
        <h2>✎ Rename rooms</h2>
        <button className="pbtn ghost" onClick={r.stop}>✕</button>
      </div>
      <p className="pnote">Give many rooms a new name in one go. Nothing changes until you tap Rename, and Undo puts it all back.</p>

      <div className="rstep"><b>1</b><span>Which rooms?</span></div>
      <div className="seg" role="group" aria-label="Which rooms">
        <button className={r.scope === "floor" ? "on" : ""} onClick={() => r.setScope("floor")}>This floor{floorName ? ` — ${floorName}` : ""}</button>
        <button className={r.scope === "building" ? "on" : ""} onClick={() => r.setScope("building")}>Whole building</button>
      </div>
      <label className="pfield">Room type
        <select value={r.typeId} onChange={(e) => r.setTypeId(e.target.value)} aria-label="Room type">
          <option value="">Every room type</option>
          {rules.roomTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.label}</option>)}
        </select>
      </label>
      <label className="pfield checkline">
        <input type="checkbox" checked={r.roughOnly} onChange={(e) => r.setRoughOnly(e.target.checked)} aria-label="Only rooms whose name looks unfinished" />
        <span>Only rooms whose name looks unfinished — blank, the room number again, codes like PK102PK103, abbreviations like PAT. RM.</span>
      </label>

      <div className="rstep"><b>2</b><span>What should the name be?</span></div>
      <div className="choices" role="radiogroup" aria-label="New name">
        {NAME_PRESETS.map((p) => (
          <button key={p.id} role="radio" aria-checked={r.preset === p.id} className={"choice" + (r.preset === p.id ? " on" : "")}
            onClick={() => r.setPreset(p.id)}>
            <i>{r.preset === p.id ? "●" : "○"}</i>
            <span><b>{p.label}</b><small>{CHOICE_HELP[p.id]}</small></span>
          </button>
        ))}
      </div>
      {r.preset === "custom" && (
        <label className="pfield">Pattern
          <input value={r.custom} onChange={(e) => r.setCustom(e.target.value)} placeholder="{type} {number}" aria-label="Custom name pattern" />
          <small>Words plus any of {PLACEHOLDERS}. {"{prefix}"} and {"{num}"} are the room number's letters and number, {"{name}"} the name as it is now, {"{n}"} counts 1, 2, 3…</small>
        </label>
      )}
      {wantsLetters && (
        <div className="pfield letters">
          <span>Letters at the start of the room number → letters for the name</span>
          {r.letters.map((row, i) => (
            <div key={i} className="letterrule">
              <input value={row.from} placeholder="FPKb" aria-label="Letters in the room number"
                onChange={(e) => editLetters(i, { from: e.target.value })} />
              <i>→</i>
              <input value={row.to} placeholder="PKT" aria-label="Letters for the name"
                onChange={(e) => editLetters(i, { to: e.target.value })} />
              {r.letters.length > 1 && (
                <button className="chipx" aria-label="Remove this row"
                  onClick={() => r.setLetters(r.letters.filter((_, j) => j !== i))}>✕</button>
              )}
            </div>
          ))}
          <button className="pbtn small" onClick={() => r.setLetters([...r.letters, { from: "", to: "" }])}>+ another</button>
          <small>A room whose letters aren't listed is left alone. Capitals don't matter.</small>
        </div>
      )}
      {r.preset === "letters" && (
        <div className="pfield">
          <span>Then, after the number</span>
          <div className="seg wrap" role="group" aria-label="Ending">
            {LETTER_ENDINGS.map((e) => (
              <button key={e.id} className={r.ending === e.id ? "on" : ""} onClick={() => r.setEnding(e.id)}>{e.label}</button>
            ))}
          </div>
        </div>
      )}
      {wantsAbbr && (
        <div className="pfield abbrs">
          <span>Short form for each room type here</span>
          {r.pickedTypes.map((t) => (
            <div key={t.label} className="letterrule">
              <span className="tlabel">{t.label}<em>×{t.count}</em></span>
              <i>→</i>
              <input value={r.typeAbbr[typeKey(t.label)] ?? ""} placeholder={t.label} aria-label={"Short form for " + t.label}
                onChange={(e) => r.setAbbr(t.label, e.target.value)} />
            </div>
          ))}
          {!r.pickedTypes.length && <small>No rooms picked yet — pick the floor and room type above.</small>}
          <small>Leave one blank to use the full name. Remembered for next time.</small>
        </div>
      )}

      <div className="rstep"><b>3</b><span>Check, then rename</span></div>
      <p className="renamecount"><b>{n}</b> room{n === 1 ? "" : "s"} will change</p>
      {alone.length > 0 && <p className="pnote">Left alone: {alone.join("; ")}.</p>}
      {shown.length > 0 && (
        <div className="rgroups">
          {shown.map((g) => (
            <div className="rgroup" key={g.from + "→" + g.to}>
              <s>{g.from || "(blank)"}</s> → <b>{g.to}</b>{g.count > 1 && <em>×{g.count}</em>}
            </div>
          ))}
          {r.groups.length > 4 && (
            <button className="plink" onClick={() => r.setShowAll(!r.showAll)}>
              {r.showAll ? "Show fewer" : `Show all ${r.groups.length}`}
            </button>
          )}
        </div>
      )}
      <small className="pnote">The rooms that will change are outlined on the map. Tap one to leave it out; tap any other room to add it.</small>
      {r.note && <p className={"pnote" + (r.note.startsWith("✓") || r.note.startsWith("↶") ? " keysaved" : "")}>{r.note}</p>}
      <button className="pbtn primary wide" disabled={!n} onClick={r.apply}>
        ✓ Rename{n ? ` ${n} room${n === 1 ? "" : "s"}` : ""}
      </button>
      {r.canUndo && <button className="pbtn wide" onClick={r.undo}>↶ Undo the last rename</button>}
      <button className="pbtn wide" onClick={r.stop}>Done</button>
    </aside>
  );
}
