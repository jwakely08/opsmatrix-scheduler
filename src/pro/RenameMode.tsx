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
  NAME_PRESETS, PLACEHOLDERS, applyRename, looksRough, planRename, renameGroups, undoRename,
  type LetterRule, type RenameChange
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
  // the letters preset keeps every room's name, unfinished or not — so that filter comes off with it
  const setPreset = (id: string) => { setPresetRaw(id); if (id === "letters") setRoughOnly(false); };
  /** rooms tapped on the map: true = in, false = out, whatever the rule says */
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [last, setLast] = useState<RenameChange[] | null>(null);
  const [note, setNote] = useState("");
  const [showAll, setShowAll] = useState(false);

  const pattern = preset === "custom" ? custom : (NAME_PRESETS.find((p) => p.id === preset)?.pattern ?? "{type}");
  const pool = scope === "floor" ? floorSpaces : buildingSpaces;
  const byRule = (sp: ClassicSpace) =>
    (!typeId || typeIdFromLabelStrict(rules, sp.roomType) === typeId) &&
    (!roughOnly || looksRough(sp.roomName, sp.roomNumber));
  const picked = useMemo(
    () => pool.filter((sp) => overrides.get(sp.id) ?? byRule(sp)),
    [pool, typeId, roughOnly, overrides, rules] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const pickedIds = useMemo(() => new Set(picked.map((s) => s.id)), [picked]);
  const plan = useMemo(() => planRename(picked, pattern, letters), [picked, pattern, letters]);
  const groups = useMemo(() => renameGroups(plan.changes), [plan]);

  const reset = (next: boolean) => {
    setOn(next); setOverrides(new Map()); setLast(null); setNote(""); setShowAll(false);
  };
  const roomLabel = (sp: ClassicSpace) =>
    String(sp.roomNumber ?? "").trim() || String(sp.roomName ?? "").trim() || "that room";

  return {
    on, scope, setScope, typeId, setTypeId, roughOnly, setRoughOnly, preset, setPreset, custom, setCustom,
    letters, setLetters, pattern, picked: pickedIds, plan, groups, note, showAll, setShowAll,
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
  letters: "FPKb-101 named “TLT” becomes “PKT101 TLT” — you choose the letters",
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
