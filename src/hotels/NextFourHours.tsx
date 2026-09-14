// NEXT FOUR HOURS — the exception list: arrival rooms that will miss their
// promised check-in unless something changes. Time slider widens the window.
import React, { useState } from "react";
import { useApp, Shell, Lamp } from "./app";
import { statusFor, typeOf, assigneeOf, fmtTime, type Space, type HotelState } from "./store";
import { verdictFor, minutesToPromise, arrivalUnits } from "./verdict";
import { VERDICT_LABEL } from "./theme";
import { RoomDrawer } from "./RoomDrawer";

/** minutes of work still standing between this room and green (Scope-priced) */
export function minutesToGreen(state: HotelState, sp: Space): number {
  const st = statusFor(state, sp.id);
  const t = typeOf(state, sp);
  const dep = t?.departureMin ?? 30;
  const inspect = 8;
  const c = st.condition?.value;
  let m = c === "dirty" ? dep + inspect : c === "in_progress" ? dep / 2 + inspect : c === "clean" || c === "pickup" ? inspect : 0;
  if (st.engineering?.ooo) m += 120;
  for (const w of state.workOrders) if (w.spaceId === sp.id && w.status === "open") m += w.blocking ? 90 : 20;
  return Math.round(m);
}

export function NextFourHoursView() {
  const { state, now, go } = useApp();
  const [hours, setHours] = useState(4);
  const [sel, setSel] = useState<Space | null>(null);
  const units = arrivalUnits(state).filter((u) => {
    const m = minutesToPromise(u.status, now);
    return m !== null && m <= hours * 60;
  });
  const rows = units.map((u) => {
    const v = verdictFor(state, u.spaces[0], now);
    const left = minutesToPromise(u.status, now) ?? 0;
    const need = Math.max(...u.spaces.map((s) => minutesToGreen(state, s)));
    const willMiss = v.level !== "green" && need > left;
    const who = u.spaces.map((s) => assigneeOf(state, s.id)).find(Boolean);
    return { u, v, left, need, willMiss, who };
  });
  const missing = rows.filter((r) => r.willMiss);
  return (
    <Shell title="Next four hours">
      <div className="grid three" style={{ marginBottom: 16 }}>
        <div className="tile"><span className="big">{rows.length}</span><span className="label">Arrivals in the next {hours} h</span></div>
        <div className="tile"><span className="big" style={{ color: missing.length ? "var(--dnw)" : "var(--ready)" }}>{missing.length}</span><span className="label">Will miss the promised time</span></div>
        <div className="tile"><span className="big">{rows.filter((r) => r.v.level === "green").length}</span><span className="label">Already ready to walk</span></div>
      </div>
      <div className="card range" style={{ marginBottom: 16 }}>
        <div className="row between"><b>Window</b><span className="num" style={{ fontSize: 22 }}>{hours} hours</span></div>
        <input type="range" min={1} max={12} step={1} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
      </div>
      {rows.length === 0 && <div className="empty"><h2>Nothing due</h2><p>No arrival rooms are promised inside this window.</p></div>}
      <div className="list">
        {rows.map(({ u, v, left, need, willMiss, who }) => (
          <div key={u.key} className={"item click arrival"} onClick={() => setSel(u.spaces[0])} style={{ borderLeft: `3px solid ${willMiss ? "var(--dnw)" : "var(--tan)"}` }}>
            <Lamp level={v.level} lg />
            <div className="roomno sm" style={{ minWidth: 92 }}>{u.label}</div>
            <div className="txt">
              <b>{VERDICT_LABEL[v.level]}</b> · promised {fmtTime(u.status.flags.promisedAt)} ({left < 0 ? `${-left} min late` : `${left} min`})
              <br /><small>{v.reasons[0]}{who ? ` · ${who.name.split(" ")[0]} on it` : " · nobody assigned"}</small>
            </div>
            {willMiss ? <span className="chip dnw">needs ~{need} min</span> : v.level !== "green" ? <span className="chip hold">~{need} min</span> : <span className="chip ready">ready</span>}
            {u.status.flags.vip && <span className="chip gold">VIP</span>}
          </div>
        ))}
      </div>
      {sel && <RoomDrawer space={sel} onClose={() => setSel(null)} onCapture={() => go("walk", { room: sel.number })} />}
    </Shell>
  );
}
