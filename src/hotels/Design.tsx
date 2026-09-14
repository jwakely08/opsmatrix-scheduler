// /design — every component in the hotel theme, on real demo data, so the
// look can be reviewed on a phone before anything else is wired.
import React, { useState } from "react";
import { useApp, Shell, Lamp } from "./app";
import { hotelTheme, VERDICT_LABEL } from "./theme";
import { LogoMark, Wordmark, Icon } from "./Logo";
import { MapCanvas } from "./HouseMap";
import { verdictFor } from "./verdict";
import { typeOf } from "./store";

export function DesignView() {
  const { state, now } = useApp();
  const [tab, setTab] = useState("a");
  const plan = state.plans.find((p) => p.floor === "4") ?? state.plans[0];
  const spaces = plan ? state.spaces.filter((s) => s.floor === plan.floor) : [];
  const lampColor = { green: "#4F7A5B", yellow: "#C58F3D", red: "#9E3B36", unknown: "#8C8378" };
  return (
    <Shell title="Design">
      <p className="muted" style={{ marginBottom: 16 }}>The OpsMatrix Hotels theme: ivory, sand, gold; serif numbers, geometric sans. Everything below is a live component on demo data.</p>
      <div className="section-title"><h2>Wordmark &amp; mark</h2></div>
      <div className="card row" style={{ gap: 40 }}><Wordmark /><LogoMark size={72} /><div><div className="serif" style={{ fontSize: 30 }}>OpsMatrix</div><div className="caps">Hotels</div></div></div>

      <div className="section-title"><h2>Palette</h2></div>
      <div className="grid tiles">
        {Object.entries(hotelTheme.color).map(([k, v]) => (
          <div key={k} className="tile" style={{ padding: 10 }}><div style={{ height: 54, borderRadius: 10, background: k === "unknown" ? "repeating-linear-gradient(45deg,#8C8378 0 6px,#F7F3EC 6px 12px)" : v, border: "1px solid var(--tan)" }} /><b style={{ fontSize: 13 }}>{k}</b><small>{v}</small></div>
        ))}
      </div>

      <div className="section-title"><h2>Type</h2></div>
      <div className="card"><h1>Suite 420 · The Meridian</h1><h2>Next four hours</h2><h3>Ready path</h3><p>Body copy in Manrope. A 60-year-old manager reads this without training. <small>Secondary text in taupe.</small></p><div className="caps" style={{ marginTop: 8 }}>Small spaced gold caps</div><div className="row" style={{ marginTop: 12, gap: 24 }}><span className="roomno">412</span><span className="roomno sm">303</span></div></div>

      <div className="section-title"><h2>Verdict lamps</h2></div>
      <div className="card row" style={{ gap: 26 }}>{(["green", "yellow", "red", "unknown"] as const).map((l) => <span key={l} className="row"><Lamp level={l} lg /><b>{VERDICT_LABEL[l]}</b></span>)}</div>

      <div className="section-title"><h2>Buttons, chips, controls</h2></div>
      <div className="card stack">
        <div className="row"><button className="btn primary">Primary</button><button className="btn">Default</button><button className="btn quiet">Quiet</button><button className="btn ready"><Icon name="check" />Pass</button><button className="btn danger"><Icon name="x" />Fail</button><button className="btn hold">Override hold</button><button className="btn big primary"><Icon name="mic" />Capture</button></div>
        <div className="chips"><span className="chip">Default</span><span className="chip gold">VIP</span><span className="chip ready">Ready</span><span className="chip hold">Hold</span><span className="chip dnw">Do not walk</span><span className="chip unknown">Unknown</span></div>
        <div className="row"><div className="seg"><button className={tab === "a" ? "on" : ""} onClick={() => setTab("a")}>Ready verdict</button><button className={tab === "b" ? "on" : ""} onClick={() => setTab("b")}>Cleaning</button><button className={tab === "c" ? "on" : ""} onClick={() => setTab("c")}>Who's on it</button></div><label className="toggle on"><i />Privacy mode</label></div>
        <div className="row"><label className="field" style={{ flex: 1 }}>Input<input placeholder="412 AC blowing warm…" /></label><label className="field">Select<select><option>Marco Bianchi</option></select></label></div>
        <div className="bar"><i style={{ width: "62%" }} /></div>
      </div>

      <div className="section-title"><h2>Tiles</h2></div>
      <div className="grid three"><div className="tile"><span className="big">14</span><span className="label">Arrivals tonight</span></div><div className="tile"><span className="big" style={{ color: "var(--dnw)" }}>3</span><span className="label">Will miss promised time</span></div><div className="tile"><span className="big">6.2</span><span className="label">Attendants needed today</span></div></div>

      <div className="section-title"><h2>Ready path</h2></div>
      <div className="card"><div className="path">{["Dirty", "Repair", "Clean", "Inspect", "Stage", "Ready"].map((s, i) => <div key={s} className={"step" + (i < 3 ? " done" : i === 3 ? " now" : "")}><i>{i < 3 ? "✓" : ""}</i><b>{s}</b><small>{i < 3 ? "2:10 PM · Rosa" : "—"}</small></div>)}</div></div>

      <div className="section-title"><h2>Capture readback (receipt)</h2></div>
      <div className="card"><div className="receipt">
        {[["412", "AC blowing warm → work order → Engineering (Marco)", 0.94], ["412", "Minibar door hanging open → work order → Engineering", 0.9], ["412", "Pull from tonight's arrivals — do not walk", 0.88], ["412", "Assign to Marco", 0.92]].map(([r, t, c], i) => <div key={i} className="rc"><b>{r}</b><span>{t}</span><span className="conf">{Math.round(Number(c) * 100)}%</span></div>)}
      </div><div className="row" style={{ marginTop: 10 }}><button className="btn primary big">Apply all</button><button className="btn">Edit</button></div></div>

      <div className="section-title"><h2>The house map</h2></div>
      {plan && <div style={{ height: 420, display: "flex" }}><MapCanvas plan={plan} spaces={spaces} selectedId={null} onRoom={() => { /* gallery */ }} bigFor={(sp) => typeOf(state, sp)?.kind === "guest"}
        fillFor={(sp) => typeOf(state, sp)?.kind === "guest" ? ({ green: "rgba(79,122,91,.30)", yellow: "rgba(197,143,61,.34)", red: "rgba(158,59,54,.30)", unknown: "url(#hx-hatch)" } as Record<string, string>)[verdictFor(state, sp, now).level] : "rgba(255,255,255,0)"}
        lampFor={(sp) => typeOf(state, sp)?.kind === "guest" ? lampColor[verdictFor(state, sp, now).level] : null} /></div>}
    </Shell>
  );
}
