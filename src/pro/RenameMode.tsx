// ✎ Rename rooms (Josh, 2026-11-02): in Max Space's Map View — pick the rooms by rule (this floor
// or the whole building, one room type or all, only rough names), choose the new name's pattern,
// see exactly what changes, then one tap renames them all. A tap on the map leaves a room out or
// puts one back; Undo takes the whole rename back. renameRooms.ts does the work.
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
  // the letters preset keeps every room's name, rough or not — so the rough-only filter comes off with it
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

/** the rule, the new name, what will change, and the way out */
export function RenameBar({ rename: r, rules, floorName }: { rename: RenameMode; rules: Rules; floorName: string }) {
  const n = r.plan.changes.length;
  const alone = [
    r.plan.noType ? `${r.plan.noType} with no room type` : "",
    r.plan.soiled ? `${r.plan.soiled} soiled utility` : "",
    r.plan.noRule ? `${r.plan.noRule} with letters not in the table` : ""
  ].filter(Boolean).join(", ");
  const more = r.groups.length - 3;
  const wantsLetters = /\{prefix\}/i.test(r.pattern);
  const editLetters = (i: number, patch: Partial<LetterRule>) =>
    r.setLetters(r.letters.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  return (
    <span className="linkhint schedlive renamebar">
      <span>✎ Rename</span>
      <select value={r.scope} onChange={(e) => r.setScope(e.target.value as "floor" | "building")} aria-label="Which rooms">
        <option value="floor">This floor{floorName ? ` — ${floorName}` : ""}</option>
        <option value="building">Whole building</option>
      </select>
      <select value={r.typeId} onChange={(e) => r.setTypeId(e.target.value)} aria-label="Room type">
        <option value="">Every room type</option>
        {rules.roomTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.label}</option>)}
      </select>
      <label className={"clonechk" + (r.roughOnly ? " on" : "")}
        title="Blank names, the number again, codes like PK102PK103, abbreviations like PAT. RM.">
        <input type="checkbox" checked={r.roughOnly} onChange={(e) => r.setRoughOnly(e.target.checked)} />
        Only rough names
      </label>
      <span>→ new name:</span>
      <select value={r.preset} onChange={(e) => r.setPreset(e.target.value)} aria-label="New name">
        {NAME_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      {r.preset === "custom" && (
        <input value={r.custom} onChange={(e) => r.setCustom(e.target.value)} style={{ minWidth: 170 }}
          placeholder="{type} {number}" aria-label="Custom name pattern"
          title={"Words plus any of " + PLACEHOLDERS + " — {prefix} and {num} are the room number's letters and number, {name} the name as it is now, {n} counts 1, 2, 3…"} />
      )}
      {wantsLetters && (
        <span className="renameletters" title="The letters a room number starts with, and the letters the name should get instead. A room whose letters aren't in the table is left alone.">
          <span>letters:</span>
          {r.letters.map((row, i) => (
            <span key={i} className="letterrule">
              <input value={row.from} placeholder="FPKb" aria-label="Letters in the room number"
                onChange={(e) => editLetters(i, { from: e.target.value })} />
              <i>→</i>
              <input value={row.to} placeholder="PKT" aria-label="Letters for the name"
                onChange={(e) => editLetters(i, { to: e.target.value })} />
              {r.letters.length > 1 && (
                <button className="chipx" aria-label="Remove this letters rule"
                  onClick={() => r.setLetters(r.letters.filter((_, j) => j !== i))}>✕</button>
              )}
            </span>
          ))}
          <button className="pbtn small" onClick={() => r.setLetters([...r.letters, { from: "", to: "" }])}>+ letters</button>
        </span>
      )}
      <em className="renamecount">
        <b>{n}</b> room{n === 1 ? "" : "s"} will change{alone ? ` · left alone: ${alone}` : ""}
      </em>
      {r.groups.slice(0, 3).map((g) => (
        <i key={g.from + "→" + g.to}>
          <s>{g.from || "(blank)"}</s> → <b>{g.to}</b>{g.count > 1 ? ` ×${g.count}` : ""}
        </i>
      ))}
      {more > 0 && (
        <button className="pbtn small" onClick={() => r.setShowAll(!r.showAll)}>
          {r.showAll ? "Hide the list" : `+${more} more…`}
        </button>
      )}
      {r.note && <em className={r.note.startsWith("✓") || r.note.startsWith("↶") ? "mergeok" : ""}>{r.note}</em>}
      <button className="pbtn small primary" disabled={!n} onClick={r.apply}>✓ Rename {n || ""}</button>
      {r.canUndo && <button className="pbtn small" onClick={r.undo}>↶ Undo</button>}
      <button className="pbtn small" onClick={r.stop}>Done</button>
      <small>The rooms that will change are outlined on the map. Tap one to leave it out, or tap any other room to add it.</small>
      {r.showAll && (
        <div className="renamelist">
          {r.groups.map((g) => (
            <span key={g.from + "→" + g.to}>
              <s>{g.from || "(blank)"}</s> → <b>{g.to}</b>{g.count > 1 ? ` ×${g.count}` : ""}
            </span>
          ))}
        </div>
      )}
    </span>
  );
}
