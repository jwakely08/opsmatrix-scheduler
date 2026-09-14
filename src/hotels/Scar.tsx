// SCAR MAP — space × failure type over 30 / 90 days. The rooms that keep
// coming back, and what for. Click a cell for the receipts.
import React, { useMemo, useState } from "react";
import { useApp, Shell } from "./app";
import { scarMap } from "./reports";
import { fmtTime } from "./store";

export function ScarView() {
  const { state, now, go } = useApp();
  const [days, setDays] = useState(30);
  const [sel, setSel] = useState<{ room: string; cat: string } | null>(null);
  const m = useMemo(() => scarMap(state, now, days), [state, now, days]);
  const max = Math.max(1, ...m.rooms.flatMap((r) => m.categories.map((c) => m.count(r, c))));
  const tint = (n: number) => n === 0 ? "transparent" : `rgba(158,59,54,${0.15 + 0.6 * (n / max)})`;
  return (
    <Shell title="Scar map" actions={<><div className="seg">{[30, 90].map((d) => <button key={d} className={days === d ? "on" : ""} onClick={() => setDays(d)}>{d} days</button>)}</div><button className="btn" onClick={() => go("handover", { tpl: "scar" })}>Report</button></>}>
      <div className="grid three" style={{ marginBottom: 16 }}>
        <div className="tile"><span className="big">{m.total}</span><span className="label">Failures in {days} days</span></div>
        <div className="tile"><span className="big">{m.rooms[0] ?? "—"}</span><span className="label">Worst room · {m.rooms[0] ? m.totalsByRoom[m.rooms[0]] : 0} failures</span></div>
        <div className="tile"><span className="big" style={{ fontSize: 28 }}>{Object.entries(m.totalsByCat).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—"}</span><span className="label">Most common failure</span></div>
      </div>
      {m.rooms.length === 0 ? <div className="empty"><h2>No scars</h2><p>No work orders or failed inspections in this window.</p></div> : (
        <div className="card scroll-x" style={{ padding: 12 }}>
          <div className="scar" style={{ gridTemplateColumns: `90px repeat(${m.categories.length}, minmax(64px, 1fr)) 60px` }}>
            <div />{m.categories.map((c) => <div key={c} className="caps" style={{ textAlign: "center", fontSize: 10 }}>{c}</div>)}<div className="caps" style={{ textAlign: "center", fontSize: 10 }}>total</div>
            {m.rooms.map((r) => (
              <React.Fragment key={r}>
                <div className="num" style={{ fontSize: 20, alignSelf: "center" }}>{r}</div>
                {m.categories.map((c) => { const n = m.count(r, c); return <button key={c} className="cell" style={{ background: tint(n), border: sel?.room === r && sel.cat === c ? "2px solid var(--gold)" : "1px solid rgba(217,205,184,.6)", color: n ? "#fff" : "var(--taupe)" }} onClick={() => setSel(n ? { room: r, cat: c } : null)}>{n || ""}</button>; })}
                <div className="cell" style={{ fontWeight: 700 }}>{m.totalsByRoom[r]}</div>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
      {sel && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="row between"><h3>{sel.room} · {sel.cat}</h3><button className="btn quiet" onClick={() => go("map", { room: sel.room.replace(/\D/g, ""), floor: sel.room.replace(/\D/g, "").slice(0, -2) })}>Open on the map</button></div>
          <div className="list">{m.entries(sel.room, sel.cat).map((e, i) => <div key={i} className="item"><small style={{ minWidth: 120 }}>{new Date(e.at).toLocaleDateString()} {fmtTime(e.at)}</small><span>{e.text}</span></div>)}</div>
        </div>
      )}
    </Shell>
  );
}
