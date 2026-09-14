// ROOMS & SPACES — the space inventory: list, add/edit, and the manual
// adapter's CSV import. Rooms that arrive without a polygon still work in
// every list; the map shows them once a plan is drawn for their floor.
import React, { useMemo, useState } from "react";
import { useApp, Shell, Lamp, Drawer } from "./app";
import { type Space, statusFor, typeOf, floorsOf, uid, nowIso, CONDITION_LABEL, clusterOf } from "./store";
import { verdictFor } from "./verdict";
import { parseDelimited, rowsFromTable, applyImport, SAMPLE_CSV } from "./roomsImport";
import { RoomDrawer } from "./RoomDrawer";
import { Icon } from "./Logo";

export function RoomsView() {
  const { state, update, now, toast, go } = useApp();
  const floors = floorsOf(state);
  const [floor, setFloor] = useState("all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Space | null>(null);
  const [edit, setEdit] = useState<Partial<Space> | null>(null);
  const [imp, setImp] = useState(false);
  const [text, setText] = useState("");
  const rows = useMemo(() => state.spaces.filter((s) => (floor === "all" || s.floor === floor) && (!q || (s.number + " " + s.name).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.floor.localeCompare(b.floor, undefined, { numeric: true }) || a.number.localeCompare(b.number, undefined, { numeric: true })), [state.spaces, floor, q]);

  const runImport = () => {
    const rowsIn = rowsFromTable(parseDelimited(text));
    if (!rowsIn.length) { toast("No room-number column found — the first row needs a header like Room"); return; }
    update((d) => {
      const sum = applyImport(d, rowsIn, nowIso(), d.settings.me);
      d.ledger.push({ id: uid("lg"), at: nowIso(), by: d.settings.me, kind: "import", text: `Room list imported: ${sum.created} new, ${sum.updated} updated, ${sum.statusSet} with status${sum.unmatchedTypes.length ? " — unmatched types: " + sum.unmatchedTypes.join(", ") : ""}.` });
    }, "Imported");
    setImp(false); setText("");
  };

  return (
    <Shell title="Rooms & spaces" actions={<>
      <button className="btn" onClick={() => setImp(true)}>Import room list</button>
      <button className="btn primary" onClick={() => setEdit({ number: "", name: "", floor: floors[0] ?? "1", typeId: state.roomTypes[0]?.id ?? "", sqft: 0 })}><Icon name="plus" />Add</button>
    </>}>
      <div className="row" style={{ marginBottom: 14 }}>
        <div className="seg"><button className={floor === "all" ? "on" : ""} onClick={() => setFloor("all")}>All floors</button>{floors.map((f) => <button key={f} className={floor === f ? "on" : ""} onClick={() => setFloor(f)}>{f}</button>)}</div>
        <input className="input" placeholder="Search room or name" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
        <span className="muted">{rows.length} spaces</span>
      </div>
      <div className="card scroll-x" style={{ padding: 0 }}>
        <table className="tbl">
          <thead><tr><th></th><th>Room</th><th>Name</th><th>Floor</th><th>Type</th><th className="num">Sq ft</th><th>Condition</th><th>Suite</th><th></th></tr></thead>
          <tbody>
            {rows.map((s) => {
              const t = typeOf(state, s); const st = statusFor(state, s.id); const cl = clusterOf(state, s);
              return (
                <tr key={s.id} className="click" onClick={() => setSel(s)}>
                  <td>{t?.kind === "guest" ? <Lamp level={verdictFor(state, s, now).level} /> : null}</td>
                  <td className="num" style={{ textAlign: "left", fontSize: 18 }}>{s.number}</td>
                  <td>{s.name}{!s.pts && <> <span className="chip" style={{ fontSize: 10.5 }}>not on plan</span></>}</td>
                  <td>{s.floor}</td>
                  <td>{t?.label ?? <span className="chip hold">type?</span>}</td>
                  <td className="num">{s.sqft || "—"}</td>
                  <td>{st.condition ? CONDITION_LABEL[st.condition.value] : <span className="muted">—</span>}</td>
                  <td>{cl?.number ?? ""}</td>
                  <td><button className="btn quiet" onClick={(e) => { e.stopPropagation(); setEdit({ ...s }); }}>Edit</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sel && <RoomDrawer space={sel} onClose={() => setSel(null)} onCapture={() => go("walk", { room: sel.number })} />}
      {edit && (
        <Drawer onClose={() => setEdit(null)}>
          <h2>{edit.id ? "Edit space" : "Add a space"}</h2>
          <div className="stack" style={{ marginTop: 12 }}>
            <label className="field">Room number or code<input value={edit.number ?? ""} onChange={(e) => setEdit({ ...edit, number: e.target.value })} /></label>
            <label className="field">Name<input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            <label className="field">Floor<input value={edit.floor ?? ""} onChange={(e) => setEdit({ ...edit, floor: e.target.value })} /></label>
            <label className="field">Room type<select value={edit.typeId ?? ""} onChange={(e) => setEdit({ ...edit, typeId: e.target.value })}>{state.roomTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
            <label className="field">Square feet<input type="number" value={edit.sqft ?? 0} onChange={(e) => setEdit({ ...edit, sqft: Number(e.target.value) })} /></label>
            <label className="field">Suite (optional — rooms sharing a suite name become one guest-facing verdict)<input value={edit.clusterId ? state.clusters.find((c) => c.id === edit.clusterId)?.number ?? "" : ""} onChange={(e) => setEdit({ ...edit, clusterId: e.target.value ? "cl-" + e.target.value.replace(/\s+/g, "-").toLowerCase() : undefined, name: edit.name })} placeholder="e.g. Suite 420" /></label>
            <div className="row">
              <button className="btn primary" disabled={!edit.number?.trim()} onClick={() => {
                update((d) => {
                  const cur = edit.id ? d.spaces.find((s) => s.id === edit.id) : undefined;
                  const sp: Space = { ...(cur ?? { id: uid("sp"), updatedAt: nowIso() }), ...edit, number: edit.number!.trim(), name: edit.name?.trim() || `Room ${edit.number!.trim()}`, floor: edit.floor?.trim() || "1", typeId: edit.typeId ?? "", sqft: Number(edit.sqft) || 0, updatedAt: nowIso() } as Space;
                  if (!cur) d.spaces.push(sp); else Object.assign(cur, sp);
                  if (sp.clusterId) {
                    let cl = d.clusters.find((c) => c.id === sp.clusterId);
                    if (!cl) { cl = { id: sp.clusterId, number: sp.clusterId.replace(/^cl-/, "").replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()), name: "", floor: sp.floor, memberIds: [] }; d.clusters.push(cl); }
                    if (!cl.memberIds.includes(sp.id)) cl.memberIds.push(sp.id);
                  }
                }, "Saved");
                setEdit(null);
              }}>Save</button>
              {edit.id && <button className="btn danger" onClick={() => { if (confirm(`Delete ${edit.number}? Its history stays in the ledger.`)) { update((d) => { d.spaces = d.spaces.filter((s) => s.id !== edit.id); delete d.status[edit.id!]; for (const c of d.clusters) c.memberIds = c.memberIds.filter((m) => m !== edit.id); }, "Deleted"); setEdit(null); } }}>Delete</button>}
              <button className="btn quiet" onClick={() => setEdit(null)}>Cancel</button>
            </div>
          </div>
        </Drawer>
      )}
      {imp && (
        <Drawer onClose={() => setImp(false)}>
          <h2>Import a room list</h2>
          <p className="muted" style={{ margin: "6px 0 12px" }}>Paste rows from a spreadsheet or pick a CSV. Columns it understands: Room, Name, Floor, Type, Sq Ft, Suite, Condition, Occupancy, Promised, Guest, VIP, OOO. Re-importing updates rooms by number — it never duplicates.</p>
          <div className="stack">
            <label className="btn"><Icon name="plus" />Choose CSV<input type="file" accept=".csv,.txt,.tsv" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} /></label>
            <textarea className="input" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={SAMPLE_CSV} style={{ fontFamily: "monospace", fontSize: 13 }} />
            <div className="row"><button className="btn primary" disabled={!text.trim()} onClick={runImport}>Import</button><button className="btn quiet" onClick={() => setText(SAMPLE_CSV)}>Use the sample</button></div>
          </div>
        </Drawer>
      )}
    </Shell>
  );
}
