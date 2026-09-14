// HANDOVER & REPORTS — one button: pick the template, pick the range, PDF
// (print) or share. Reports are generated from the ledger, never written.
import React, { useMemo, useState } from "react";
import { useApp, Shell } from "./app";
import { handoverReport, dailyRoomsReport, scarReport, reportToText, type Report } from "./reports";
import { forecastPlan, variance } from "./labor";
import { Icon } from "./Logo";

type Tpl = "handover" | "daily" | "scar" | "labor";

export function laborReport(state: ReturnType<typeof useApp>["state"], now: number, actualHours: number): Report {
  const p = forecastPlan(state);
  const week = p.days.slice(0, 7);
  const std = week.reduce((a, d) => a + d.totalMin, 0);
  const v = variance(state, std, actualHours);
  return {
    title: "Weekly labor vs. standard", subtitle: `${state.settings.hotelName} · next 7 days`, generatedAt: new Date(now).toISOString(),
    sections: [
      { heading: "Standard", lines: [`${v.standardHours} attendant-hours for the week · ${p.fte} FTE at ${state.settings.productiveMinutes} productive min × ${state.settings.shiftsPerWeekPerFte} shifts`] },
      { heading: "Scheduled", lines: [`${v.actualHours} hours · ${v.deltaHours >= 0 ? "+" : ""}${v.deltaHours} h (${v.pct >= 0 ? "+" : ""}${v.pct}%) · ${v.deltaDollars >= 0 ? "+" : "−"}$${Math.abs(v.deltaDollars)}`] },
      { heading: "By day", lines: week.map((d) => `${d.date}: ${d.departures} departures · ${d.stayovers} stayovers → ${d.totalMin} min → ${d.attendants} attendants`) }
    ]
  };
}

export function HandoverView() {
  const { state, now, params } = useApp();
  const [tpl, setTpl] = useState<Tpl>((params.tpl as Tpl) ?? "handover");
  const [hours, setHours] = useState(8);
  const [days, setDays] = useState(30);
  const [actual, setActual] = useState(() => Math.round(forecastPlan(state).days.slice(0, 7).reduce((a, d) => a + d.attendants * 8, 0)));
  const [q, setQ] = useState("");
  const report = useMemo<Report>(() => tpl === "handover" ? handoverReport(state, now, hours) : tpl === "daily" ? dailyRoomsReport(state, now) : tpl === "scar" ? scarReport(state, now, days) : laborReport(state, now, actual), [tpl, state, now, hours, days, actual]);
  const shown = useMemo(() => q ? { ...report, sections: report.sections.map((s) => ({ ...s, lines: s.lines.filter((l) => l.toLowerCase().includes(q.toLowerCase())) })).filter((s) => s.lines.length) } : report, [report, q]);
  const share = async () => {
    const text = reportToText(report);
    const nav = navigator as Navigator & { share?: (d: { title: string; text: string }) => Promise<void> };
    if (nav.share) { try { await nav.share({ title: report.title, text }); return; } catch { /* cancelled */ } }
    await navigator.clipboard?.writeText(text);
    alert("Copied to the clipboard.");
  };
  return (
    <Shell title="Handover & reports" actions={<>
      <button className="btn" onClick={() => window.print()}><Icon name="print" />PDF</button>
      <button className="btn primary" onClick={share}><Icon name="share" />Share</button>
    </>}>
      <div className="row noprint" style={{ marginBottom: 14 }}>
        <div className="seg">
          {([["handover", "Shift handover"], ["daily", "Daily rooms"], ["scar", "Scar map"], ["labor", "Weekly labor"]] as [Tpl, string][]).map(([k, l]) => <button key={k} className={tpl === k ? "on" : ""} onClick={() => setTpl(k)}>{l}</button>)}
        </div>
        {tpl === "handover" && <div className="seg">{[4, 8, 12, 24].map((h) => <button key={h} className={hours === h ? "on" : ""} onClick={() => setHours(h)}>{h} h</button>)}</div>}
        {tpl === "scar" && <div className="seg">{[30, 90].map((d) => <button key={d} className={days === d ? "on" : ""} onClick={() => setDays(d)}>{d} days</button>)}</div>}
        {tpl === "labor" && <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>Hours scheduled this week<input type="number" value={actual} onChange={(e) => setActual(Number(e.target.value) || 0)} style={{ width: 100 }} /></label>}
        <input className="input" placeholder="Search the report" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 240, marginLeft: "auto" }} />
      </div>
      <div className="card ivory">
        <div className="print-head"><b>OpsMatrix Hotels</b> · {state.settings.hotelName}</div>
        <h2>{shown.title}</h2>
        <small>{shown.subtitle} · generated {new Date(shown.generatedAt).toLocaleString()} · nobody typed this</small>
        {shown.sections.map((s, i) => (
          <div key={i} style={{ marginTop: 14 }}>
            <div className="caps">{s.heading}</div>
            <hr className="rule" style={{ margin: "6px 0 8px" }} />
            <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>{s.lines.map((l, j) => <li key={j}>{l}</li>)}</ul>
          </div>
        ))}
        {!shown.sections.length && <p className="muted">Nothing matches.</p>}
      </div>
    </Shell>
  );
}
