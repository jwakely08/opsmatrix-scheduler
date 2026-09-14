// THE ROOM DRAWER — status, ready path, work orders, history, photo, assign,
// capture. Every button here goes through actions.ts, so a tap lands in the
// status layers, the queue and the ledger at once.
import React, { useMemo, useState } from "react";
import { useApp, Drawer, Lamp } from "./app";
import { type Space, type Condition, type WorkOrder, statusFor, typeOf, assigneeOf, openWorkOrders, fmtTime, fmtAgo, clusterOf, CONDITION_LABEL, OCCUPANCY_LABEL, staffByName } from "./store";
import { verdictFor, spaceVerdict, minutesToPromise } from "./verdict";
import { VERDICT_LABEL } from "./theme";
import * as A from "./actions";
import { Icon } from "./Logo";

const WO_CATS: WorkOrder["category"][] = ["hvac", "plumbing", "electrical", "furniture", "minibar", "tv", "housekeeping", "other"];
const STEPS: { id: "dirty" | "repair" | "clean" | "inspect" | "stage" | "ready"; label: string }[] = [
  { id: "dirty", label: "Dirty" }, { id: "repair", label: "Repair" }, { id: "clean", label: "Clean" }, { id: "inspect", label: "Inspect" }, { id: "stage", label: "Stage" }, { id: "ready", label: "Ready" }
];

export function useMe() {
  const { state } = useApp();
  const me = staffByName(state, state.settings.me) ?? { id: "me", name: state.settings.me, role: "manager" as const };
  return me;
}

export async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, 640 / Math.max(img.width, img.height));
    const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.7);
  } finally { URL.revokeObjectURL(url); }
}

export function RoomDrawer({ space, onClose, onCapture }: { space: Space; onClose: () => void; onCapture?: () => void }) {
  const { state, update, now } = useApp();
  const me = useMe();
  const ctx = { by: me.name, source: "manual" as const };
  const st = statusFor(state, space.id);
  const t = typeOf(state, space);
  const cl = clusterOf(state, space);
  const v = verdictFor(state, space, now);
  const own = spaceVerdict(state, space, now);
  const who = assigneeOf(state, space.id);
  const wos = openWorkOrders(state, space.id);
  const history = useMemo(() => [...state.ledger].filter((l) => l.spaceId === space.id).reverse().slice(0, 12), [state.ledger, space.id]);
  const [woText, setWoText] = useState(""); const [woCat, setWoCat] = useState<WorkOrder["category"]>("other"); const [woBlock, setWoBlock] = useState(false);
  const [notes, setNotes] = useState(""); const [reason, setReason] = useState(""); const [photo, setPhoto] = useState<string | null>(null);
  const [assignTo, setAssignTo] = useState(""); const [task, setTask] = useState<"departure" | "stayover" | "turndown" | "inspect" | "repair" | "deep" | "public">("departure");
  const promise = minutesToPromise(st, now);
  const isGuest = t?.kind === "guest";
  const canOverride = me.role === "gm";
  const readOnly = me.role === "frontdesk";
  const done = new Set(st.readyPath.filter((s) => s.at).map((s) => s.step));
  const nowStep = st.condition?.value === "dirty" ? "clean" : st.condition?.value === "in_progress" ? "clean" : st.condition?.value === "clean" ? "inspect" : st.condition?.value === "inspected" ? "ready" : "dirty";

  const cond = (c: Condition) => update((d) => A.setCondition(d, d.spaces.find((s) => s.id === space.id)!, c, ctx), `${space.number} ${CONDITION_LABEL[c].toLowerCase()}`);

  return (
    <Drawer onClose={onClose}>
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="caps">{cl ? cl.number : t?.label ?? "Space"} · Floor {space.floor}</div>
          <div className="roomno">{/^\d/.test(space.number) ? space.number : space.name}</div>
          <div className="muted">{cl ? space.name : space.name !== `Room ${space.number}` ? space.name : t?.label} · {space.sqft} sq ft</div>
        </div>
        <button className="btn icon quiet" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
      </div>
      <hr className="rule" />

      {isGuest && (
        <div className="card ivory" style={{ padding: "14px 16px" }}>
          <div className="row"><Lamp level={v.level} lg /><b style={{ fontSize: 18 }}>{VERDICT_LABEL[v.level]}</b>
            {promise !== null && <span className={"chip " + (promise < 0 ? "dnw" : promise < 60 ? "hold" : "")} style={{ marginLeft: "auto" }}>promised {fmtTime(st.flags.promisedAt)}{promise < 0 ? ` · ${-promise} min late` : ` · in ${promise} min`}</span>}
          </div>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13.5 }}>{v.reasons.slice(0, 4).map((r, i) => <li key={i}>{r}</li>)}</ul>
          {cl && own.level !== v.level && <small>This room alone is {VERDICT_LABEL[own.level].toLowerCase()}; the suite follows its worst room.</small>}
          <div className="chips" style={{ marginTop: 8 }}>
            {st.flags.vip && <span className="chip gold">VIP</span>}
            {st.flags.doNotWalk && <span className="chip dnw">Do not walk</span>}
            {st.flags.guestCode && <span className="chip">{state.settings.privacyMode ? st.flags.guestCode : st.flags.guestCode}</span>}
            {st.occupancy && <span className="chip">{OCCUPANCY_LABEL[st.occupancy.value]}</span>}
            {who && <span className="chip">{who.name.split(" ")[0]} on it</span>}
          </div>
        </div>
      )}

      {isGuest && (
        <>
          <div className="section-title"><h3>Ready path</h3></div>
          <div className="path">
            {STEPS.map((s) => {
              const rec = st.readyPath.find((x) => x.step === s.id && x.at);
              return (
                <div key={s.id} className={"step" + (done.has(s.id) ? " done" : "") + (nowStep === s.id ? " now" : "")}>
                  <i>{done.has(s.id) ? "✓" : ""}</i><b>{s.label}</b>
                  <small>{rec ? `${fmtTime(rec.at)}${rec.by ? " · " + rec.by.split(" ")[0] : ""}` : "—"}</small>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!readOnly && (
        <>
          <div className="section-title"><h3>Condition</h3><small>{st.condition ? `${CONDITION_LABEL[st.condition.value]} · confirmed ${fmtAgo(st.condition.at, now)}` : "not confirmed"}</small></div>
          <div className="chips">
            {(["dirty", "in_progress", "clean", "inspected", "pickup"] as Condition[]).map((c) => (
              <button key={c} className={"btn" + (st.condition?.value === c ? " primary" : "")} onClick={() => cond(c)}>{CONDITION_LABEL[c]}</button>
            ))}
            <button className="btn quiet" onClick={() => update((d) => A.confirmSignals(d, d.spaces.find((s) => s.id === space.id)!, ctx), "Signals re-confirmed")}>Re-confirm all</button>
          </div>

          {isGuest && (
            <>
              <div className="section-title"><h3>Inspect</h3></div>
              <div className="stack">
                <input className="input" placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
                <div className="row">
                  <label className="btn"><Icon name="camera" />{photo ? "Photo attached" : "Photo"}<input type="file" accept="image/*" capture="environment" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPhoto(await shrinkPhoto(f)); }} /></label>
                  <button className="btn ready" onClick={() => { update((d) => A.inspect(d, d.spaces.find((s) => s.id === space.id)!, "pass", notes || undefined, ctx, photo ?? undefined), `${space.number} passed`); setNotes(""); setPhoto(null); }}><Icon name="check" />Pass</button>
                  <button className="btn danger" onClick={() => { update((d) => A.inspect(d, d.spaces.find((s) => s.id === space.id)!, "fail", notes || undefined, ctx, photo ?? undefined), `${space.number} failed — back to dirty`); setNotes(""); setPhoto(null); }}><Icon name="x" />Fail</button>
                </div>
                {st.inspection?.photo && <img src={st.inspection.photo} alt="inspection" style={{ maxWidth: 160, borderRadius: 10, border: "1px solid var(--tan)" }} />}
              </div>
            </>
          )}

          <div className="section-title"><h3>Engineering</h3></div>
          {wos.length > 0 && (
            <div className="list">
              {wos.map((w) => (
                <div key={w.id} className="item">
                  <span className={"chip " + (w.blocking ? "dnw" : "hold")}>{w.category}</span>
                  <div style={{ flex: 1 }}><b>{w.text}</b><br /><small>{w.assignedTo ? state.staff.find((s) => s.id === w.assignedTo)?.name : "unassigned"} · {fmtAgo(w.createdAt, now)}</small></div>
                  <button className="btn" onClick={() => update((d) => A.closeWorkOrder(d, w.id, ctx), "Work order closed")}>Done</button>
                </div>
              ))}
            </div>
          )}
          <div className="stack" style={{ marginTop: 8 }}>
            <input className="input" placeholder="New work order — what's wrong?" value={woText} onChange={(e) => setWoText(e.target.value)} />
            <div className="row">
              <select className="input" style={{ width: "auto" }} value={woCat} onChange={(e) => setWoCat(e.target.value as WorkOrder["category"])}>{WO_CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              <label className={"toggle" + (woBlock ? " on" : "")} onClick={() => setWoBlock(!woBlock)}><i />blocks the room</label>
              <button className="btn primary" disabled={!woText.trim()} onClick={() => { update((d) => { A.createWorkOrder(d, d.spaces.find((s) => s.id === space.id)!, woText.trim(), woCat, ctx, { blocking: woBlock }); }, "Work order created"); setWoText(""); setWoBlock(false); }}><Icon name="plus" />Work order</button>
            </div>
            <div className="row">
              <button className={"btn" + (st.engineering?.ooo ? " danger" : "")} onClick={() => { if (st.engineering?.ooo) update((d) => A.setOutOfOrder(d, d.spaces.find((s) => s.id === space.id)!, false, undefined, ctx), "Back in order"); else { const r = prompt("Out of order — why?") ?? ""; if (r.trim()) update((d) => A.setOutOfOrder(d, d.spaces.find((s) => s.id === space.id)!, true, r.trim(), ctx), "Out of order"); } }}>{st.engineering?.ooo ? "Out of order — put back" : "Mark out of order"}</button>
              {isGuest && <button className={"btn" + (st.flags.doNotWalk ? " hold" : "")} onClick={() => update((d) => A.flag(d, d.spaces.find((s) => s.id === space.id)!, st.flags.doNotWalk ? "walk_ok" : "do_not_walk", ctx), st.flags.doNotWalk ? "Cleared to walk" : "Pulled from arrivals")}>{st.flags.doNotWalk ? "Allow walking again" : "Pull from arrivals"}</button>}
            </div>
          </div>

          <div className="section-title"><h3>Assign</h3><small>{who ? `${who.name} has it` : "nobody yet"}</small></div>
          <div className="row">
            <select className="input" style={{ width: "auto" }} value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
              <option value="">Who?</option>
              {state.staff.filter((s) => ["attendant", "inspector", "engineering"].includes(s.role)).map((s) => <option key={s.id} value={s.name}>{s.name} · {s.role}</option>)}
            </select>
            <select className="input" style={{ width: "auto" }} value={task} onChange={(e) => setTask(e.target.value as typeof task)}>
              {(isGuest ? ["departure", "stayover", "turndown", "deep", "inspect", "repair"] : ["public", "repair"]).map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button className="btn primary" disabled={!assignTo} onClick={() => { update((d) => { A.assign(d, d.spaces.find((s) => s.id === space.id)!, assignTo, task, ctx); }, `Assigned to ${assignTo.split(" ")[0]}`); setAssignTo(""); }}>Assign</button>
          </div>

          {isGuest && (v.level === "yellow" || st.override) && (
            <>
              <div className="section-title"><h3>Hold override</h3><small>GM only · always logged</small></div>
              {st.override ? (
                <div className="row"><span className="chip gold">Overridden by {st.override.by}: {st.override.reason}</span>{canOverride && <button className="btn" onClick={() => update((d) => A.clearOverride(d, d.spaces.find((s) => s.id === space.id)!, ctx), "Override cleared")}>Clear</button>}</div>
              ) : canOverride ? (
                <div className="row"><input className="input" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ flex: 1 }} />
                  <button className="btn hold" disabled={!reason.trim()} onClick={() => { update((d) => A.overrideHold(d, d.spaces.find((s) => s.id === space.id)!, reason.trim(), { ...ctx, by: `${me.name} (GM)` }), "Hold overridden — logged"); setReason(""); }}>Override hold</button></div>
              ) : <small>Only the GM can override a hold. Front desk cannot.</small>}
            </>
          )}

          {onCapture && <div style={{ marginTop: 16 }}><button className="btn primary big block" onClick={onCapture}><Icon name="mic" />Capture — say what you see</button></div>}
        </>
      )}

      <div className="section-title"><h3>History</h3></div>
      <div className="list">
        {history.length === 0 && <small>Nothing yet.</small>}
        {history.map((l) => <div key={l.id} className="item"><small style={{ minWidth: 64 }}>{fmtTime(l.at)}</small><div style={{ flex: 1, fontSize: 13.5 }}>{l.text}<br /><small>{l.by}</small></div></div>)}
      </div>
    </Drawer>
  );
}
