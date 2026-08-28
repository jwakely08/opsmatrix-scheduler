// Max Space — Explorer + Room List (hub edition, 2026-08-28).
// Josh's staging punch list moved the archive's Explorer/Table screens here so
// every room surface finally shows the data the calculations run on: floor
// type (the three real ones), fixtures, priority 1/2/3, cleanability — with
// duplicate/edit/delete on every row and NO scheduling controls (scheduling
// lives in Max Schedules, full stop). Writes go through classicStore on this
// separate document, so Classic's save effect can never clobber them.
import React, { useMemo, useState } from "react";
import {
  syncSpaceMinutes, spaceIncomplete, spacePriority, deleteSpace, duplicateSpace,
  FLOOR_TYPES, PRIORITIES, PRIORITY_NUM, PRIORITY_WORD,
  type ClassicData, type ClassicSpace, type Priority
} from "./classicStore";
import {
  autoTasksFor, typeIdFromLabel, isCarpet, spaceCleanability, type Rules
} from "./rules";

const fmt = (n: number) => Math.round(n).toLocaleString();

export type SpacesView = "explorer" | "list" | "map";

// ── shared helpers ──────────────────────────────────────────────────────────

interface ManagerNote { id: string; title?: string; body?: string; linkedSpaceId?: string; }

/** the room's own note + any manager notes linked to it (Max Notes) */
export function notesForSpace(data: ClassicData, sp: ClassicSpace): { own: string; linked: ManagerNote[] } {
  const own = String(sp.notes ?? "").trim();
  const linked = ((data.v7.notes as ManagerNote[] | undefined) ?? [])
    .filter((n) => n.linkedSpaceId && n.linkedSpaceId === sp.id);
  return { own, linked };
}

export function hasNote(data: ClassicData, sp: ClassicSpace): boolean {
  const n = notesForSpace(data, sp);
  return Boolean(n.own) || n.linked.length > 0;
}

/** "Hard floor — finished" is a mouthful in a table cell */
function shortFloor(v: string | undefined): string {
  const s = String(v ?? "");
  if (/finished$/i.test(s) && /—\s*finished/i.test(s)) return "Hard — finished";
  if (/unfinished/i.test(s)) return "Hard — unfinished";
  return s || "—";
}

export function PriorityChip({ p }: { p: Priority }) {
  return <span className={"priochip " + p.toLowerCase()} title={PRIORITY_WORD[p]}>{PRIORITY_NUM[p]}</span>;
}

// ── the room editor (add + edit) ────────────────────────────────────────────
// Basic: room number, room name, room type, priority, fixtures, floor type.
// Metrics: square footage only — minutes are Max Schedules' business.
// Campus/building/floor are NOT editable on an existing room: the import (or
// the tree the room was created in) owns them. A brand-new room needs to be
// told where it lives, so the add flow shows those three — once.

export function RoomEditor({ data, rules, space, onClose, commit }: {
  data: ClassicData;
  rules: Rules;
  /** null = add a new room */
  space: ClassicSpace | null;
  onClose: () => void;
  commit: (mut: (d: ClassicData) => void) => void;
}) {
  const isNew = !space;
  const [draft, setDraft] = useState<ClassicSpace>(() => space
    ? JSON.parse(JSON.stringify(space))
    : {
      id: "sp-" + Math.random().toString(36).slice(2, 9),
      roomNumber: "", roomName: "", building: "", floor: "", department: "",
      roomType: "", floorType: "", squareFeet: 0, fixtureCount: 0,
      spaceTasks: [], updatedAt: new Date().toISOString()
    });
  const [err, setErr] = useState("");

  const spaces = data.v7.spaces ?? [];
  const opts = (f: (sp: ClassicSpace) => unknown) =>
    [...new Set(spaces.map((sp) => String(f(sp) ?? "").trim()).filter(Boolean))].sort();

  const typeId = typeIdFromLabel(rules, draft.roomType ?? "");
  const clean = spaceCleanability(rules, draft);
  const req = Array.isArray(draft.spaceTasks) ? draft.spaceTasks : [];
  const linked = space ? notesForSpace(data, space).linked : [];

  const set = (patch: Partial<ClassicSpace>) => setDraft((d) => ({ ...d, ...patch }));
  const setType = (id: string) => {
    const rt = rules.roomTypes.find((x) => x.id === id);
    set({ roomType: rt?.label ?? "", spaceTasks: autoTasksFor(rules, id) });
  };

  const save = () => {
    if (!String(draft.roomNumber ?? "").trim() && !String(draft.roomName ?? "").trim()) {
      setErr("Give the room a number or a name first.");
      return;
    }
    commit((d) => {
      const list = d.v7.spaces ?? (d.v7.spaces = []);
      const at = list.findIndex((s) => s.id === draft.id);
      const next = { ...draft, squareFeet: Number(draft.squareFeet) || 0, fixtureCount: Number(draft.fixtureCount) || 0 };
      syncSpaceMinutes(next, rules);
      if (at >= 0) list[at] = { ...list[at], ...next };
      else list.push(next);
    });
    onClose();
  };

  return (
    <div className="pro-modalback" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pro-modal roomedit">
        <div className="pshead">
          <h2>{isNew ? "＋ Add a room" : `✏ ${draft.roomNumber || draft.roomName || "Room"}`}</h2>
          <button className="pbtn ghost" onClick={onClose}>✕</button>
        </div>

        {!isNew && (
          <p className="pnote">
            {[draft.building, draft.floor, draft.department].map((v) => String(v ?? "").trim()).filter(Boolean).join(" · ")
              || "No building/floor recorded"} — set by the import, edited there, not here.
          </p>
        )}

        {isNew && (
          <div className="prow">
            <label className="pfield">Building
              <input list="re-bldgs" value={String(draft.building ?? "")}
                onChange={(e) => set({ building: e.target.value })} />
              <datalist id="re-bldgs">{opts((s) => s.building).map((b) => <option key={b} value={b} />)}</datalist>
            </label>
            <label className="pfield">Floor
              <input list="re-floors" value={String(draft.floor ?? "")}
                onChange={(e) => set({ floor: e.target.value })} />
              <datalist id="re-floors">{opts((s) => s.floor).map((b) => <option key={b} value={b} />)}</datalist>
            </label>
            <label className="pfield">Department
              <input list="re-depts" value={String(draft.department ?? "")}
                onChange={(e) => set({ department: e.target.value })} />
              <datalist id="re-depts">{opts((s) => s.department).map((b) => <option key={b} value={b} />)}</datalist>
            </label>
          </div>
        )}

        <div className="prow">
          <label className="pfield">Room number
            <input value={String(draft.roomNumber ?? "")} placeholder="e.g. 4E-102"
              onChange={(e) => { setErr(""); set({ roomNumber: e.target.value }); }} />
          </label>
          <label className="pfield">Room name
            <input value={String(draft.roomName ?? "")} placeholder="e.g. Med Room"
              onChange={(e) => { setErr(""); set({ roomName: e.target.value }); }} />
          </label>
        </div>

        <div className="prow">
          <label className="pfield grow">Room type
            <select value={typeId} onChange={(e) => setType(e.target.value)}>
              <option value="">— pick room type —</option>
              {rules.roomTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.label} · {rt.frequency}</option>)}
            </select>
          </label>
          <label className="pfield">Floor type
            <select value={draft.floorType || ""} onChange={(e) => set({ floorType: e.target.value })}>
              <option value="">— pick floor type —</option>
              {FLOOR_TYPES.map((f) => <option key={f}>{f}</option>)}
            </select>
          </label>
        </div>

        <div className="prow">
          <label className="pfield">Fixtures <small>sinks, toilets…</small>
            <input type="number" min={0} value={Number(draft.fixtureCount) || 0}
              onChange={(e) => set({ fixtureCount: Number(e.target.value) || 0 })} />
          </label>
          <label className="pfield">Square feet
            <input type="number" min={0} value={Number(draft.squareFeet) || 0}
              onChange={(e) => set({ squareFeet: Number(e.target.value) || 0 })} />
          </label>
          {isCarpet(draft.floorType) && (
            <label className="pfield accent">Vacuum days/week
              <input type="number" min={1} max={7} value={Number(draft.vacuumDaysPerWeek) || 5}
                onChange={(e) => set({ vacuumDaysPerWeek: Math.max(1, Math.min(7, Number(e.target.value) || 5)) })} />
            </label>
          )}
        </div>

        <div className="pfield"><span>Priority</span>
          <div className="prio">
            {PRIORITIES.map((p) => (
              <button key={p} className={"priobtn " + p.toLowerCase() + (spacePriority(draft) === p ? " on" : "")}
                onClick={() => set({ priority: p })}>{PRIORITY_WORD[p]}</button>
            ))}
          </div>
          <small>Prints on every schedule this room appears on, so the worker knows what cannot wait.</small>
        </div>

        <label className="pfield checkline">
          <input type="checkbox" checked={clean !== "Non-cleanable"}
            onChange={(e) => set({ cleanability: e.target.checked ? "Cleanable" : "Non-cleanable" })} />
          <span>Cleanable — counts toward EVS workload{clean === "Needs review" ? " (needs review until the room type is set)" : ""}</span>
        </label>

        <div className="pfield"><span>Tasks this room needs (General Clean is always included)</span>
          <div className="ptasks">
            <span className="ptask locked">General Clean</span>
            {rules.tasks.filter((t) => t.addable).map((t) => {
              const on = req.includes(t.id);
              const auto = t.autoFor.includes(typeId);
              return (
                <button key={t.id} className={"ptask" + (on ? " on" : "")}
                  onClick={() => set({ spaceTasks: on ? req.filter((x) => x !== t.id) : [...req, t.id] })}>
                  {t.label}{auto ? " •" : ""}
                </button>
              );
            })}
          </div>
          <small>• = automatic for this room type. Who does each task is decided in Max Schedules.</small>
        </div>

        <label className="pfield">Notes <small>show wherever this room appears — including while scheduling</small>
          <textarea rows={2} value={String(draft.notes ?? "")}
            placeholder="keys, access, isolation notes…"
            onChange={(e) => set({ notes: e.target.value })} />
        </label>
        {linked.length > 0 && (
          <p className="pnote">📝 Manager notes linked to this room: {linked.map((n) => n.title || (n.body ?? "").slice(0, 40)).join(" · ")}</p>
        )}

        {err && <p className="warntext">⚠ {err}</p>}
        <div className="prow endrow">
          <button className="pbtn primary" onClick={save}>{isNew ? "Add room" : "Save"}</button>
          <button className="pbtn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── the room table (shared by Room List and Explorer's room level) ─────────

type SortField = "roomNumber" | "roomName" | "department" | "roomType" | "floorType" | "fixtureCount" | "squareFeet" | "priority";

function RoomTable({ data, rules, rows, showDept, commit, onEdit }: {
  data: ClassicData;
  rules: Rules;
  rows: ClassicSpace[];
  showDept: boolean;
  commit: (mut: (d: ClassicData) => void) => void;
  onEdit: (sp: ClassicSpace) => void;
}) {
  const [sortF, setSortF] = useState<SortField>("roomNumber");
  const [sortD, setSortD] = useState<1 | -1>(1);

  const sorted = useMemo(() => {
    const val = (sp: ClassicSpace): string | number => {
      if (sortF === "priority") return PRIORITIES.indexOf(spacePriority(sp));
      if (sortF === "fixtureCount" || sortF === "squareFeet") return Number(sp[sortF]) || 0;
      return String(sp[sortF] ?? "");
    };
    return [...rows].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * sortD;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * sortD;
    });
  }, [rows, sortF, sortD]);

  const th = (f: SortField, label: string, cls = "") => (
    <th className={cls + " sortable"} onClick={() => {
      if (sortF === f) setSortD((d) => (d === 1 ? -1 : 1));
      else { setSortF(f); setSortD(1); }
    }}>{label}{sortF === f ? (sortD === 1 ? " ↑" : " ↓") : ""}</th>
  );

  const act = (sp: ClassicSpace, mut: (d: ClassicData) => void) => commit(mut);

  return (
    <div className="wi-tablewrap">
      <table className="wi-table rooms">
        <thead>
          <tr>
            {th("roomNumber", "Room")}
            {th("roomName", "Name")}
            {showDept && th("department", "Department")}
            {th("roomType", "Room type")}
            {th("floorType", "Floor type")}
            {th("fixtureCount", "Fixtures", "num")}
            {th("squareFeet", "Sq ft", "num")}
            {th("priority", "Priority")}
            <th>Cleanable</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((sp) => {
            const issues = spaceIncomplete(sp);
            const clean = spaceCleanability(rules, sp);
            return (
              <tr key={sp.id} className={issues.length ? "warn" : ""}>
                <td><b>{String(sp.roomNumber ?? "") || "—"}</b>{hasNote(data, sp) && <span className="noteflag" title="Has a note"> 📝</span>}</td>
                <td>{String(sp.roomName ?? "") || <em className="dim">—</em>}</td>
                {showDept && <td>{String(sp.department ?? "") || <em className="dim">—</em>}</td>}
                <td>{String(sp.roomType ?? "") || <em className="dim">pick…</em>}</td>
                <td className={sp.floorType ? "" : "misscell"}>{shortFloor(sp.floorType)}</td>
                <td className="num">{Number(sp.fixtureCount) || 0}</td>
                <td className="num">{fmt(Number(sp.squareFeet) || 0)}</td>
                <td><PriorityChip p={spacePriority(sp)} /></td>
                <td className="cleancell">
                  <input type="checkbox" checked={clean !== "Non-cleanable"}
                    title={clean === "Needs review" ? "Needs review — set the room type" : clean}
                    onChange={(e) => act(sp, (d) => {
                      const t = (d.v7.spaces ?? []).find((s) => s.id === sp.id);
                      if (!t) return;
                      t.cleanability = e.target.checked ? "Cleanable" : "Non-cleanable";
                      syncSpaceMinutes(t, rules);
                    })} />
                </td>
                <td className="rowacts">
                  <button className="pbtn small" title="Edit" onClick={() => onEdit(sp)}>✏</button>
                  <button className="pbtn small" title="Duplicate" onClick={() => act(sp, (d) => { duplicateSpace(d, sp.id); })}>⧉</button>
                  <button className="pbtn small danger" title="Delete" onClick={() => {
                    if (confirm(`Delete ${sp.roomNumber || sp.roomName || "this room"}? It comes off every schedule too.`)) {
                      act(sp, (d) => deleteSpace(d, sp.id));
                    }
                  }}>✕</button>
                </td>
              </tr>
            );
          })}
          {!sorted.length && <tr><td colSpan={showDept ? 10 : 9}><p className="pnote">No rooms match.</p></td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ── Room List: every room, filterable, sortable ─────────────────────────────

export function RoomListView({ data, rules, commit, onEdit }: {
  data: ClassicData;
  rules: Rules;
  commit: (mut: (d: ClassicData) => void) => void;
  onEdit: (sp: ClassicSpace) => void;
}) {
  const spaces = data.v7.spaces ?? [];
  const [f, setF] = useState({ building: "", floor: "", dept: "", rtype: "", ftype: "", pri: "" });
  const [q, setQ] = useState("");

  const opts = (get: (sp: ClassicSpace) => unknown, pred?: (sp: ClassicSpace) => boolean) =>
    [...new Set(spaces.filter(pred ?? (() => true)).map((sp) => String(get(sp) ?? "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const rows = spaces.filter((sp) => {
    if (f.building && String(sp.building ?? "").trim() !== f.building) return false;
    if (f.floor && String(sp.floor ?? "").trim() !== f.floor) return false;
    if (f.dept && String(sp.department ?? "").trim() !== f.dept) return false;
    if (f.rtype && String(sp.roomType ?? "") !== f.rtype) return false;
    if (f.ftype && String(sp.floorType ?? "") !== f.ftype) return false;
    if (f.pri && spacePriority(sp) !== f.pri) return false;
    if (q) {
      const hay = `${sp.roomNumber} ${sp.roomName} ${sp.department} ${sp.roomType}`.toLowerCase();
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const sel = (label: string, key: keyof typeof f, values: string[]) => (
    <label className="psel">
      <span>{label}</span>
      <select value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })}>
        <option value="">All</option>
        {values.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    </label>
  );

  const anyF = Object.values(f).some(Boolean) || q;

  return (
    <div className="pro-list spaces">
      <div className="pro-filters wrap">
        {sel("Building", "building", opts((s) => s.building))}
        {sel("Floor", "floor", opts((s) => s.floor, (s) => !f.building || String(s.building ?? "").trim() === f.building))}
        {sel("Department", "dept", opts((s) => s.department, (s) => !f.building || String(s.building ?? "").trim() === f.building))}
        {sel("Room type", "rtype", opts((s) => s.roomType))}
        {sel("Floor type", "ftype", [...FLOOR_TYPES])}
        <label className="psel"><span>Priority</span>
          <select value={f.pri} onChange={(e) => setF({ ...f, pri: e.target.value })}>
            <option value="">All</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_WORD[p]}</option>)}
          </select>
        </label>
        {anyF && <button className="pbtn small" onClick={() => { setF({ building: "", floor: "", dept: "", rtype: "", ftype: "", pri: "" }); setQ(""); }}>Clear</button>}
      </div>
      {/* the search gets its own full row — big enough to see what you type */}
      <input className="wi-search wide" placeholder="🔎 Search rooms — number, name, department or type…"
        value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="pnote counts">{rows.length} of {spaces.length} rooms</p>
      <RoomTable data={data} rules={rules} rows={rows} showDept commit={commit} onEdit={onEdit} />
    </div>
  );
}

// ── Explorer: buildings → floors → departments → rooms ─────────────────────

export function SpaceExplorerView({ data, rules, commit, onEdit }: {
  data: ClassicData;
  rules: Rules;
  commit: (mut: (d: ClassicData) => void) => void;
  onEdit: (sp: ClassicSpace) => void;
}) {
  const spaces = data.v7.spaces ?? [];
  const [path, setPath] = useState<{ building: string | null; floor: string | null; dept: string | null }>(
    { building: null, floor: null, dept: null });
  const [q, setQ] = useState("");

  const level = path.dept !== null ? "rooms" : path.floor !== null ? "depts" : path.building !== null ? "floors" : "buildings";

  const scoped = spaces.filter((s) =>
    (path.building === null || String(s.building ?? "").trim() === path.building) &&
    (path.floor === null || String(s.floor ?? "").trim() === path.floor) &&
    (path.dept === null || String(s.department ?? "").trim() === path.dept));

  const goBackLevel = () => {
    if (path.dept !== null) setPath({ ...path, dept: null });
    else if (path.floor !== null) setPath({ ...path, floor: null, dept: null });
    else setPath({ building: null, floor: null, dept: null });
    setQ("");
  };

  const searched = q
    ? spaces.filter((s) =>
      `${s.roomNumber} ${s.roomName} ${s.department} ${s.building} ${s.floor} ${s.roomType}`
        .toLowerCase().includes(q.toLowerCase()))
    : [];

  const tileData = (get: (sp: ClassicSpace) => string) => {
    const names = [...new Set(scoped.map((sp) => String(get(sp) ?? "").trim()))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return names.map((name) => {
      const rs = scoped.filter((sp) => String(get(sp) ?? "").trim() === name);
      return {
        name,
        label: name || "(not set)",
        rooms: rs.length,
        sqft: rs.reduce((a, s) => a + (Number(s.squareFeet) || 0), 0),
        missing: rs.filter((s) => spaceIncomplete(s).length > 0).length
      };
    });
  };

  const tiles = level === "buildings" ? tileData((s) => String(s.building ?? ""))
    : level === "floors" ? tileData((s) => String(s.floor ?? ""))
      : level === "depts" ? tileData((s) => String(s.department ?? ""))
        : [];

  const drill = (name: string) => {
    if (level === "buildings") setPath({ building: name, floor: null, dept: null });
    else if (level === "floors") setPath({ ...path, floor: name, dept: null });
    else if (level === "depts") setPath({ ...path, dept: name });
    setQ("");
  };

  const crumb = [
    { label: "All buildings", at: { building: null, floor: null, dept: null } },
    ...(path.building !== null ? [{ label: path.building || "(no building)", at: { building: path.building, floor: null, dept: null } }] : []),
    ...(path.floor !== null ? [{ label: path.floor || "(no floor)", at: { building: path.building, floor: path.floor, dept: null } }] : []),
    ...(path.dept !== null ? [{ label: path.dept || "(no department)", at: path }] : [])
  ];

  return (
    <div className="pro-list spaces">
      <div className="explbar">
        {level !== "buildings" && (
          <button className="pbtn primary backbtn" onClick={goBackLevel}>‹ Back</button>
        )}
        <nav className="crumbs">
          {crumb.map((c, i) => (
            <span key={i}>
              {i > 0 && <em>›</em>}
              <button className={"plink" + (i === crumb.length - 1 ? " here" : "")}
                onClick={() => { setPath(c.at as typeof path); setQ(""); }}>{c.label}</button>
            </span>
          ))}
        </nav>
      </div>
      <input className="wi-search wide" placeholder="🔎 Search every room — number, name, department…"
        value={q} onChange={(e) => setQ(e.target.value)} />

      {q ? (
        <>
          <p className="pnote counts">{searched.length} room{searched.length === 1 ? "" : "s"} match “{q}”</p>
          <RoomTable data={data} rules={rules} rows={searched} showDept commit={commit} onEdit={onEdit} />
        </>
      ) : level === "rooms" ? (
        <>
          <p className="pnote counts">{scoped.length} room{scoped.length === 1 ? "" : "s"}</p>
          <RoomTable data={data} rules={rules} rows={scoped} showDept={false} commit={commit} onEdit={onEdit} />
        </>
      ) : (
        <div className="expltiles">
          {tiles.map((t) => (
            <button key={t.label} className="expltile" onClick={() => drill(t.name)}>
              <b>{t.label}</b>
              <span>{t.rooms} room{t.rooms === 1 ? "" : "s"} · {fmt(t.sqft)} sq ft</span>
              {t.missing > 0 && <em className="warn">⚠ {t.missing} missing details</em>}
            </button>
          ))}
          {!tiles.length && <p className="pnote">Nothing here yet — use ⬆ Import to bring rooms in.</p>}
        </div>
      )}
    </div>
  );
}
