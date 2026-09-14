// SCOPE — the hotel rulebook. Same idea as the hospital Scope: every number
// visible and editable, plain headers, a Save per section.
import React, { useState } from "react";
import { useApp, Shell } from "./app";
import { type RoomType, uid } from "./store";
import { defaultRoomTypes, publicAreaDailyMinutes, roomMixMinutes } from "./rules";

export function ScopeView() {
  const { state, update } = useApp();
  const [types, setTypes] = useState<RoomType[]>(() => JSON.parse(JSON.stringify(state.roomTypes)));
  const [gen, setGen] = useState(() => ({ ...state.settings }));
  const [nt, setNt] = useState({ label: "", kind: "guest" as RoomType["kind"] });
  const mix = roomMixMinutes(state);
  const set = (id: string, patch: Partial<RoomType>) => setTypes((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const num = (v: string) => Math.max(0, Number(v) || 0);
  return (
    <Shell title="Scope">
      <p className="muted" style={{ marginBottom: 14 }}>Starting numbers are typical for a boutique full-service hotel and are yours to change. Every minute here is what Labor, Next four hours and the boards run on.</p>
      <div className="grid two">
        <div className="card">
          <h3>Staffing assumptions</h3>
          <div className="stack">
            <label className="field">Productive minutes per shift<input type="number" value={gen.productiveMinutes} onChange={(e) => setGen({ ...gen, productiveMinutes: num(e.target.value) })} /></label>
            <label className="field">Shifts per week per full-time attendant<input type="number" value={gen.shiftsPerWeekPerFte} onChange={(e) => setGen({ ...gen, shiftsPerWeekPerFte: num(e.target.value) })} /></label>
            <label className="field">Loaded hourly rate ($)<input type="number" value={gen.hourlyRate} onChange={(e) => setGen({ ...gen, hourlyRate: num(e.target.value) })} /></label>
            <label className="field">Travel: minutes added per floor change<input type="number" value={gen.travelPerFloorChangeMin} onChange={(e) => setGen({ ...gen, travelPerFloorChangeMin: num(e.target.value) })} /></label>
            <label className="field">Travel: minutes between rooms on the same floor<input type="number" value={gen.travelBetweenRoomsMin} onChange={(e) => setGen({ ...gen, travelBetweenRoomsMin: num(e.target.value) })} /></label>
            <label className={"toggle" + (gen.turndown ? " on" : "")} onClick={() => setGen({ ...gen, turndown: !gen.turndown })}><i />Evening turndown service (luxury)</label>
            <button className="btn primary" onClick={() => update((d) => { Object.assign(d.settings, { productiveMinutes: gen.productiveMinutes, shiftsPerWeekPerFte: gen.shiftsPerWeekPerFte, hourlyRate: gen.hourlyRate, travelPerFloorChangeMin: gen.travelPerFloorChangeMin, travelBetweenRoomsMin: gen.travelBetweenRoomsMin, turndown: gen.turndown }); }, "Saved")}>Save assumptions</button>
          </div>
        </div>
        <div className="card">
          <h3>What the house adds up to</h3>
          <div className="kv">
            <b>Guest rooms</b><span>{mix.guestRooms}</span>
            <b>Average departure clean</b><span>{Math.round(mix.departure)} min</span>
            <b>Average stayover</b><span>{Math.round(mix.stayover)} min</span>
            <b>Public areas, per day</b><span>{publicAreaDailyMinutes(state)} min across all passes</span>
          </div>
        </div>
      </div>
      <div className="section-title"><h2>Room types</h2><small>minutes per clean; public areas price by square feet and passes</small></div>
      <div className="card scroll-x" style={{ padding: 0 }}>
        <table className="tbl">
          <thead><tr><th>Type</th><th>Kind</th><th className="num">Departure</th><th className="num">Stayover</th><th className="num">Turndown</th><th className="num">Sq ft / min</th><th className="num">Passes / day</th><th></th></tr></thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.id}>
                <td><input className="input" value={t.label} onChange={(e) => set(t.id, { label: e.target.value })} style={{ minWidth: 150 }} /></td>
                <td><select className="input" value={t.kind} onChange={(e) => set(t.id, { kind: e.target.value as RoomType["kind"] })}><option value="guest">guest</option><option value="public">public</option><option value="boh">back of house</option></select></td>
                {t.kind === "guest" ? (<>
                  <td className="num"><input className="input" type="number" value={t.departureMin} onChange={(e) => set(t.id, { departureMin: num(e.target.value) })} style={{ width: 80 }} /></td>
                  <td className="num"><input className="input" type="number" value={t.stayoverMin} onChange={(e) => set(t.id, { stayoverMin: num(e.target.value) })} style={{ width: 80 }} /></td>
                  <td className="num"><input className="input" type="number" value={t.turndownMin} onChange={(e) => set(t.id, { turndownMin: num(e.target.value) })} style={{ width: 80 }} /></td>
                  <td className="num muted">—</td><td className="num muted">—</td>
                </>) : (<>
                  <td className="num muted">—</td><td className="num muted">—</td><td className="num muted">—</td>
                  <td className="num"><input className="input" type="number" value={t.sqftPerMin ?? 0} onChange={(e) => set(t.id, { sqftPerMin: num(e.target.value) || null })} style={{ width: 80 }} /></td>
                  <td className="num"><input className="input" type="number" value={t.passesPerDay} onChange={(e) => set(t.id, { passesPerDay: num(e.target.value) })} style={{ width: 80 }} /></td>
                </>)}
                <td><button className="btn quiet" onClick={() => { if (confirm(`Delete "${t.label}"? Rooms of this type will need a new type.`)) setTypes((ts) => ts.filter((x) => x.id !== t.id)); }}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <input className="input" placeholder="New type, e.g. Penthouse" value={nt.label} onChange={(e) => setNt({ ...nt, label: e.target.value })} style={{ maxWidth: 240 }} />
        <select className="input" style={{ width: "auto" }} value={nt.kind} onChange={(e) => setNt({ ...nt, kind: e.target.value as RoomType["kind"] })}><option value="guest">guest room</option><option value="public">public area</option><option value="boh">back of house</option></select>
        <button className="btn" disabled={!nt.label.trim()} onClick={() => { setTypes((ts) => [...ts, { id: uid("rt"), label: nt.label.trim(), kind: nt.kind, departureMin: 30, stayoverMin: 18, turndownMin: 8, sqftPerMin: nt.kind === "guest" ? null : 200, passesPerDay: nt.kind === "guest" ? 0 : 1 }]); setNt({ label: "", kind: "guest" }); }}>Add type</button>
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn quiet" onClick={() => { if (confirm("Reset every room type to the packaged hotel standards?")) setTypes(defaultRoomTypes()); }}>Reset to hotel standards</button>
        <button className="btn primary" onClick={() => update((d) => { d.roomTypes = types; }, "Room types saved")}>Save room types</button>
      </div>
    </Shell>
  );
}
