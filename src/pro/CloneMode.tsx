// Clone mode, shared by Max Space's Map View and Rover Mode (Josh, 2026-10-28): turn it on, tap the
// room to copy from, tick what to copy, then every room tapped gets those details — saved on the
// spot — until Done. The ticks are remembered for next time, and Undo steps back one room at a time.
import React, { useState } from "react";
import { PRIORITY_NUM, spacePriority, type ClassicData, type ClassicSpace } from "./classicStore";
import { spaceCleanability, type Rules } from "./rules";
import {
  CLONE_FIELDS, DEFAULT_CLONE_FIELDS, cloneInto, restoreRoom, snapshotRoom, type CloneField, type RoomSnapshot
} from "./cloneRoom";

const FIELDS_KEY = "om_clone_fields";

function loadFields(): CloneField[] {
  try {
    const v = JSON.parse(localStorage.getItem(FIELDS_KEY) ?? "null");
    if (Array.isArray(v)) return v.filter((f): f is CloneField => CLONE_FIELDS.some((c) => c.id === f));
  } catch { /* storage off */ }
  return [...DEFAULT_CLONE_FIELDS];
}

const roomLabel = (sp: ClassicSpace) =>
  String(sp.roomNumber ?? "").trim() || String(sp.roomName ?? "").trim() || "that room";

export function useCloneMode(spaces: ClassicSpace[], commit: (mut: (d: ClassicData) => void) => void, rules: Rules) {
  const [on, setOn] = useState(false);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [fields, setFields] = useState<CloneField[]>(loadFields);
  const [note, setNote] = useState("");
  const [history, setHistory] = useState<{ id: string; label: string; before: RoomSnapshot }[]>([]);
  const [pasted, setPasted] = useState<Set<string>>(new Set());
  const source = sourceId ? spaces.find((s) => s.id === sourceId) ?? null : null;

  const reset = (next: boolean) => {
    setOn(next); setSourceId(null); setNote(""); setHistory([]); setPasted(new Set());
  };
  return {
    on,
    source,
    fields,
    note,
    pasted,
    canUndo: history.length > 0,
    start: () => reset(true),
    stop: () => reset(false),
    changeSource: () => { setSourceId(null); setNote(""); },
    toggleField: (f: CloneField) => setFields((cur) => {
      const next = cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f];
      try { localStorage.setItem(FIELDS_KEY, JSON.stringify(next)); } catch { /* storage off */ }
      return next;
    }),
    /** a tap on a room: the first picks the room to copy from, every one after receives it */
    tap: (sp: ClassicSpace) => {
      if (!source) { setSourceId(sp.id); setNote(""); return; }
      if (sp.id === source.id) return;
      if (!fields.length) { setNote("Tick at least one thing to copy."); return; }
      const from: ClassicSpace = JSON.parse(JSON.stringify(source));
      const chosen = [...fields];
      const before = snapshotRoom(sp);
      commit((d) => {
        const t = (d.v7.spaces ?? []).find((s) => s.id === sp.id);
        if (t) cloneInto(t, from, chosen, rules);
      });
      setHistory((h) => [...h, { id: sp.id, label: roomLabel(sp), before }]);
      setPasted((p) => new Set(p).add(sp.id));
      const words = CLONE_FIELDS.filter((c) => chosen.includes(c.id)).map((c) => c.label.toLowerCase()).join(", ");
      setNote(`✓ Copied to ${roomLabel(sp)} — ${words}`);
    },
    undoLast: () => {
      const last = history[history.length - 1];
      if (!last) return;
      commit((d) => {
        const t = (d.v7.spaces ?? []).find((s) => s.id === last.id);
        if (t) restoreRoom(t, last.before);
      });
      setHistory((h) => h.slice(0, -1));
      if (!history.slice(0, -1).some((x) => x.id === last.id)) {
        setPasted((p) => { const n = new Set(p); n.delete(last.id); return n; });
      }
      setNote(`↶ ${last.label} is back as it was`);
    }
  };
}

export type CloneMode = ReturnType<typeof useCloneMode>;

/** the room the clone copies from, what it copies (ticked), and the way out */
export function CloneBar({ clone, rules }: { clone: CloneMode; rules: Rules }) {
  const s = clone.source;
  const value = (f: CloneField): string => {
    if (!s) return "";
    switch (f) {
      case "roomType": return String(s.roomType ?? "").trim() || "none";
      case "floorType": return String(s.floorType ?? "").trim() || "none";
      case "fixtureCount": return String(Number(s.fixtureCount) || 0);
      case "department": return String(s.department ?? "").trim() || "none";
      case "priority": return PRIORITY_NUM[spacePriority(s)];
      case "cleanability": return spaceCleanability(rules, s) === "Non-cleanable" ? "no" : "yes";
      case "spaceTasks": return String((Array.isArray(s.spaceTasks) ? s.spaceTasks : []).length);
      case "notes": return String(s.notes ?? "").trim() ? "yes" : "none";
    }
  };
  return (
    <span className="linkhint schedlive clonebar">
      {s
        ? <span>⎘ Copying from <b>{roomLabel(s)}</b> — tap the rooms to copy it to</span>
        : <span>⎘ Tap the room to copy from</span>}
      {CLONE_FIELDS.map((c) => (
        <label key={c.id} className={"clonechk" + (clone.fields.includes(c.id) ? " on" : "")}>
          <input type="checkbox" checked={clone.fields.includes(c.id)} onChange={() => clone.toggleField(c.id)} />
          {c.label}{s ? <i>{value(c.id)}</i> : null}
        </label>
      ))}
      {clone.note && <em className={clone.note.startsWith("✓") ? "mergeok" : "mergewarn"}>{clone.note}</em>}
      {s && <button className="pbtn small" onClick={clone.changeSource}>Copy from another room</button>}
      {clone.canUndo && <button className="pbtn small" onClick={clone.undoLast}>↶ Undo</button>}
      <button className="pbtn small primary" onClick={clone.stop}>Done</button>
    </span>
  );
}
