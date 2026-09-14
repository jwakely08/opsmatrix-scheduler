// ADMIN / SETTINGS — property, who you are, privacy mode, signal freshness,
// the status feed (manual today; a PMS later), capture auto-apply, the API
// key (device only), and demo / backup controls.
import React, { useState } from "react";
import { useApp, Shell } from "./app";
import { HOTEL_API_KEY, HOTEL_KEY, type HotelState, uid, nowIso } from "./store";
import { buildDemo } from "./demo";

export function loadApiKey(): string { try { return localStorage.getItem(HOTEL_API_KEY) ?? ""; } catch { return ""; } }
export function saveApiKey(k: string) { try { if (k) localStorage.setItem(HOTEL_API_KEY, k); else localStorage.removeItem(HOTEL_API_KEY); } catch { /* off */ } }

export function SettingsView() {
  const { state, update, replace, toast } = useApp();
  const s = state.settings;
  const [key, setKey] = useState(loadApiKey());
  const [name, setName] = useState(s.hotelName);
  const fresh = (k: "condition" | "occupancy" | "engineering", v: number) => update((d) => { d.settings.freshnessMin[k] = Math.max(1, v || 1); });
  return (
    <Shell title="Settings">
      <div className="grid two">
        <div className="card">
          <h3>Property</h3>
          <div className="stack">
            <label className="field">Hotel name<input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => update((d) => { d.settings.hotelName = name.trim() || d.settings.hotelName; })} /></label>
            <label className="field">I am<select value={s.me} onChange={(e) => update((d) => { d.settings.me = e.target.value; }, `Acting as ${e.target.value}`)}>{state.staff.map((st) => <option key={st.id} value={st.name}>{st.name} · {st.role}</option>)}{!state.staff.some((st) => st.name === s.me) && <option value={s.me}>{s.me}</option>}</select></label>
            <small>Roles decide what you can do: the GM can override a hold; the front desk sees verdicts only.</small>
            <label className={"toggle" + (s.privacyMode ? " on" : "")} onClick={() => update((d) => { d.settings.privacyMode = !d.settings.privacyMode; })}><i />Privacy mode — room codes on wall screens, never guest names</label>
          </div>
        </div>
        <div className="card">
          <h3>Status feed</h3>
          <div className="stack">
            <div className="row"><span className="chip">{s.adapter.kind === "manual" ? "Manual — in-app status + room list import" : s.adapter.kind}</span>
              <span className={"chip " + (s.adapter.connected ? "ready" : "dnw")}>{s.adapter.connected ? "connected" : "disconnected"}</span></div>
            <small>Cloud PMS adapters (Mews first, then Cloudbeds) plug in here later. Write-back stays off by default and is enabled field by field, every write logged.</small>
            <button className={"btn" + (s.adapter.connected ? " danger" : " ready")} onClick={() => update((d) => { d.settings.adapter.connected = !d.settings.adapter.connected; d.ledger.push({ id: uid("lg"), at: nowIso(), by: d.settings.me, kind: "system", text: d.settings.adapter.connected ? "Status feed reconnected." : "Status feed DISCONNECTED — every room reads Unknown until it is back." }); }, s.adapter.connected ? "Disconnected — every room is now Unknown" : "Reconnected")}>{s.adapter.connected ? "Simulate a disconnect" : "Reconnect"}</button>
          </div>
        </div>
        <div className="card">
          <h3>Signal freshness</h3>
          <p className="muted" style={{ marginBottom: 10 }}>A required signal older than this makes the room Unknown. Unknown is never green.</p>
          <div className="stack">
            <label className="field">Condition — minutes<input type="number" value={s.freshnessMin.condition} onChange={(e) => fresh("condition", Number(e.target.value))} /></label>
            <label className="field">Occupancy — minutes<input type="number" value={s.freshnessMin.occupancy} onChange={(e) => fresh("occupancy", Number(e.target.value))} /></label>
            <label className="field">Engineering — minutes<input type="number" value={s.freshnessMin.engineering} onChange={(e) => fresh("engineering", Number(e.target.value))} /></label>
          </div>
        </div>
        <div className="card">
          <h3>Capture</h3>
          <div className="stack">
            <label className="field">Auto-apply readback above this confidence (blank = always confirm)<input type="number" step="0.05" min="0" max="1" value={s.autoApplyAbove ?? ""} onChange={(e) => update((d) => { d.settings.autoApplyAbove = e.target.value === "" ? null : Math.min(1, Math.max(0, Number(e.target.value))); })} placeholder="e.g. 0.9" /></label>
            <label className="field">Anthropic API key — saved on this device only, never sent anywhere but Anthropic<input type="password" value={key} onChange={(e) => setKey(e.target.value)} onBlur={() => { saveApiKey(key.trim()); toast(key.trim() ? "Key saved on this device" : "Key removed"); }} placeholder="sk-ant-…" /></label>
            <small>Without a key, capture still works: a built-in local grammar reads room numbers, conditions, faults, assignments and flags. With a key, Max reads anything you say.</small>
          </div>
        </div>
        <div className="card">
          <h3>Demo &amp; data</h3>
          <div className="stack">
            <small>{s.demoStamp ? "This is the demo hotel. Import a room list or start fresh to make it yours." : "Live data — the demo will not touch it."}</small>
            <div className="row">
              <button className="btn" onClick={() => { replace(buildDemo()); toast("Demo hotel refreshed"); }}>Refresh the demo hotel</button>
              <button className="btn" onClick={() => { if (confirm("Start fresh? This clears every room, status and report line on this device.")) { const st: HotelState = { ...buildDemo(), spaces: [], clusters: [], plans: [], status: {}, workOrders: [], assignments: [], reservations: [], ledger: [], forecast: [] }; st.settings = { ...st.settings, hotelName: "My hotel", demoStamp: undefined, me: "Manager" }; st.staff = []; replace(st); toast("Fresh start"); } }}>Start fresh</button>
            </div>
            <div className="row">
              <button className="btn" onClick={() => { const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `opsmatrix-hotels-${new Date().toISOString().slice(0, 10)}.json`; a.click(); }}>Download backup</button>
              <label className="btn">Restore backup<input type="file" accept="application/json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const j = JSON.parse(await f.text()); if (j?.version !== 1) throw new Error("not a hotels backup"); replace(j); toast("Restored"); } catch { toast("That file is not an OpsMatrix Hotels backup"); } }} /></label>
            </div>
            <small>Stored under <code>{HOTEL_KEY}</code> in this browser. The hospital OpsMatrix data is a separate store and is never touched.</small>
          </div>
        </div>
      </div>
    </Shell>
  );
}
