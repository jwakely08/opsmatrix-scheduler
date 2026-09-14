// LABOR — today's demand from the plan, contiguous attendant boards with
// travel, the scattered-vs-contiguous savings in minutes and dollars,
// variance, and a what-if occupancy slider over the 14-day forecast.
import React, { useMemo, useState } from "react";
import { useApp, Shell } from "./app";
import { forecastPlan, compareBoards, dailyDemand, parseForecast, variance } from "./labor";
import { roomMixMinutes } from "./rules";

export function LaborView() {
  const { state, update, toast } = useApp();
  const [scale, setScale] = useState(100);
  const [view, setView] = useState<"contiguous" | "scattered">("contiguous");
  const [sheet, setSheet] = useState("");
  const [actual, setActual] = useState(0);
  const plan = useMemo(() => forecastPlan(state, scale / 100), [state, scale]);
  const today = plan.days[0] ?? dailyDemand(state, { date: "", arrivals: 0, departures: 0, stayovers: 0 });
  const cmp = useMemo(() => compareBoards(state), [state]);
  const boards = view === "contiguous" ? cmp.contiguous : cmp.scattered;
  const mix = roomMixMinutes(state);
  const v = variance(state, today.totalMin, actual || today.attendants * 8);
  const s = state.settings;
  return (
    <Shell title="Labor">
      <div className="grid three">
        <div className="tile"><span className="big">{today.attendants}</span><span className="label">Attendants needed today ({today.attendantsExact} exact)</span></div>
        <div className="tile"><span className="big">{Math.round(today.totalMin / 60)}<small style={{ fontSize: 18 }}> h</small></span><span className="label">{today.departures} departures × {Math.round(mix.departure)} min · {today.stayovers} stayovers × {Math.round(mix.stayover)} min · public {today.publicMin} min · travel {today.travelMin} min</span></div>
        <div className="tile"><span className="big" style={{ color: cmp.savedMin > 0 ? "var(--ready)" : undefined }}>${cmp.savedDollars}</span><span className="label">Saved today by contiguous boards · {cmp.savedMin} min less walking</span></div>
      </div>

      <div className="section-title"><h2>Today's boards</h2><small>{cmp.work.length} rooms · travel {cmp.contiguousTravel} min contiguous vs {cmp.scatteredTravel} min scattered</small></div>
      <div className="row" style={{ marginBottom: 10 }}><div className="seg"><button className={view === "contiguous" ? "on" : ""} onClick={() => setView("contiguous")}>Contiguous (OpsMatrix)</button><button className={view === "scattered" ? "on" : ""} onClick={() => setView("scattered")}>Scattered (call-down list)</button></div></div>
      <div className="grid two">
        {boards.map((b, i) => (
          <div key={i} className="card">
            <div className="row between"><h3>{b.attendant ? b.attendant.name : `Board ${i + 1}`}</h3><span className="chip">{b.floors.length ? "Floor " + b.floors.join(" → ") : "—"}</span></div>
            <div className="kv" style={{ margin: "6px 0 10px" }}><b>Cleaning</b><span>{b.cleanMin} min</span><b>Travel</b><span>{b.travelMin} min · {b.floorChanges} floor change{b.floorChanges === 1 ? "" : "s"}</span><b>Total</b><span style={{ color: b.cleanMin + b.travelMin > s.productiveMinutes ? "var(--dnw)" : undefined }}>{b.cleanMin + b.travelMin} of {s.productiveMinutes} min</span></div>
            <div className="bar"><i className={b.cleanMin + b.travelMin > s.productiveMinutes ? "dnw" : "ready"} style={{ width: `${Math.min(100, ((b.cleanMin + b.travelMin) / s.productiveMinutes) * 100)}%` }} /></div>
            <div className="chips" style={{ marginTop: 10 }}>{b.items.map((w) => <span key={w.space.id} className={"chip" + (w.task === "departure" ? " gold" : "")}>{w.space.number} · {w.minutes}</span>)}</div>
          </div>
        ))}
        {boards.length === 0 && <div className="empty"><h2>Nothing to clean</h2></div>}
      </div>

      <div className="section-title"><h2>Next 14 days</h2><small>what-if occupancy: {scale}%</small></div>
      <div className="card range" style={{ marginBottom: 12 }}>
        <input type="range" min={40} max={140} step={5} value={scale} onChange={(e) => setScale(Number(e.target.value))} />
        <div className="row between"><span>Weekly standard: <b>{Math.round(plan.weeklyMin / 60)} h</b> · <b>{plan.fte} FTE</b> at {s.productiveMinutes} × {s.shiftsPerWeekPerFte}</span>
          <span>Variance today: <b style={{ color: v.deltaHours > 0 ? "var(--dnw)" : "var(--ready)" }}>{v.deltaHours >= 0 ? "+" : ""}{v.deltaHours} h · {v.deltaDollars >= 0 ? "+" : "−"}${Math.abs(v.deltaDollars)}</b> <input className="input" type="number" placeholder={`${today.attendants * 8} h scheduled`} value={actual || ""} onChange={(e) => setActual(Number(e.target.value))} style={{ width: 90, display: "inline-block", marginLeft: 8 }} /></span></div>
      </div>
      <div className="card scroll-x" style={{ padding: 0 }}>
        <table className="tbl"><thead><tr><th>Date</th><th className="num">Departures</th><th className="num">Stayovers</th><th className="num">Clean min</th><th className="num">Public</th><th className="num">Travel</th><th className="num">Total</th><th className="num">Attendants</th></tr></thead>
          <tbody>{plan.days.map((d) => <tr key={d.date}><td>{d.date}</td><td className="num">{d.departures}</td><td className="num">{d.stayovers}</td><td className="num">{d.departureMin + d.stayoverMin + d.turndownMin}</td><td className="num">{d.publicMin}</td><td className="num">{d.travelMin}</td><td className="num">{d.totalMin}</td><td className="num"><b>{d.attendants}</b></td></tr>)}</tbody></table>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <h3>Paste a 14-day occupancy sheet</h3>
        <small>One line per day: date, arrivals, departures, stayovers. From the PMS when connected; pasted until then.</small>
        <textarea className="input" rows={4} value={sheet} onChange={(e) => setSheet(e.target.value)} placeholder={"2026-10-01, 14, 12, 20\n2026-10-02, 11, 14, 22"} style={{ marginTop: 8, fontFamily: "monospace" }} />
        <div className="row" style={{ marginTop: 8 }}><button className="btn primary" disabled={!sheet.trim()} onClick={() => { const rows = parseForecast(sheet); if (!rows.length) { toast("No usable lines — date, arrivals, departures, stayovers"); return; } update((d) => { d.forecast = rows; }, `${rows.length} days loaded`); setSheet(""); }}>Load forecast</button></div>
      </div>
    </Shell>
  );
}
