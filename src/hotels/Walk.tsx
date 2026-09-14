// WALK MODE (phone) — floor-biased room strip, hold-to-talk capture, typed
// fallback, readback cards that slide in like a receipt, one tap applies
// all, two-tap inspect pass/fail with photo, reassign. Nothing writes without
// the readback shown (unless the tenant set auto-apply above a confidence).
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useApp, Shell, Lamp } from "./app";
import { type Space, statusFor, typeOf, floorsOf, assigneeOf, openWorkOrders, CONDITION_LABEL } from "./store";
import { verdictFor } from "./verdict";
import { parseUtterance, type ParseResult } from "./capture/ai";
import type { Intent, CaptureContext } from "./capture/intents";
import { applyIntents } from "./capture/apply";
import * as A from "./actions";
import { loadApiKey } from "./Settings";
import { useMe, shrinkPhoto } from "./RoomDrawer";
import { Icon } from "./Logo";

type Rec = { start(): void; stop(): void; abort(): void; onresult: ((e: unknown) => void) | null; onend: (() => void) | null; onerror: ((e: unknown) => void) | null; continuous: boolean; interimResults: boolean; lang: string };
function makeRecognizer(): Rec | null {
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!C) return null;
  const r = new C();
  r.continuous = true; r.interimResults = true; r.lang = "en-US";
  return r;
}

export function WalkView() {
  const { state, update, now, params, toast } = useApp();
  const me = useMe();
  const floors = floorsOf(state);
  const startRoom = params.room ? state.spaces.find((s) => s.number === params.room) : undefined;
  const [floor, setFloor] = useState(startRoom?.floor ?? (floors.includes("4") ? "4" : floors[0] ?? ""));
  const [room, setRoom] = useState<Space | null>(startRoom ?? null);
  const [text, setText] = useState("");
  const [live, setLive] = useState(false);
  const [interim, setInterim] = useState("");
  const [pending, setPending] = useState<{ transcript: string; result: ParseResult; on: boolean[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const rec = useRef<Rec | null>(null);
  const heard = useRef("");
  const supported = useMemo(() => Boolean((window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition), []);
  const spaces = state.spaces.filter((s) => s.floor === floor && typeOf(state, s)?.kind === "guest");

  const ctx = (): CaptureContext => ({
    rooms: state.spaces.map((s) => s.number).concat(state.clusters.map((c) => c.number)),
    staff: state.staff.map((s) => ({ name: s.name, role: s.role })),
    currentRoom: room?.number, floor, hotelName: state.settings.hotelName,
    openWorkOrders: state.workOrders.filter((w) => w.status === "open").map((w) => ({ room: state.spaces.find((s) => s.id === w.spaceId)?.number ?? "?", text: w.text }))
  });

  async function readback(transcript: string) {
    const t = transcript.trim();
    if (!t) return;
    setBusy(true);
    const result = await parseUtterance(t, ctx(), loadApiKey() || null);
    setBusy(false);
    if (result.error) toast(result.error);
    const auto = state.settings.autoApplyAbove;
    if (auto !== null && result.intents.length && result.intents.every((i) => i.confidence >= auto)) {
      apply(t, result.intents);
      return;
    }
    setPending({ transcript: t, result, on: result.intents.map(() => true) });
  }

  function apply(transcript: string, intents: Intent[]) {
    let summary = "";
    update((d) => { const r = applyIntents(d, intents, me.name, transcript); summary = `${r.applied} applied${r.skipped.length ? `, ${r.skipped.length} skipped (${r.skipped.map((s) => s.why).join("; ")})` : ""}`; });
    toast(summary);
    setPending(null); setText("");
  }

  // hold-to-talk: press = start, release = stop → readback
  function startTalk() {
    if (!supported) return;
    heard.current = ""; setInterim("");
    const r = makeRecognizer(); if (!r) return;
    rec.current = r;
    r.onresult = (e) => {
      const ev = e as { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> };
      let fin = "", tmp = "";
      for (let i = 0; i < ev.results.length; i++) { const res = ev.results[i]; if (res.isFinal) fin += res[0].transcript + " "; else tmp += res[0].transcript; }
      heard.current = fin; setInterim((fin + tmp).trim());
    };
    r.onerror = () => { /* the typed box still works */ };
    r.onend = () => { setLive(false); const t = (heard.current || interim).trim(); if (t) readback(t); };
    try { r.start(); setLive(true); } catch { setLive(false); }
  }
  function stopTalk() { try { rec.current?.stop(); } catch { /* fine */ } }
  useEffect(() => () => { try { rec.current?.abort(); } catch { /* fine */ } }, []);

  const roomSt = room ? statusFor(state, room.id) : null;
  const v = room ? verdictFor(state, room, now) : null;
  const ctxAct = { by: me.name, source: "manual" as const };

  return (
    <Shell title="Walk mode" actions={<div className="seg">{floors.map((f) => <button key={f} className={f === floor ? "on" : ""} onClick={() => { setFloor(f); setRoom(null); }}>Floor {f}</button>)}</div>}>
      {/* the floor strip: tap the room you're standing in */}
      <div className="row" style={{ gap: 6, overflowX: "auto", paddingBottom: 6, flexWrap: "nowrap" }}>
        {spaces.map((s) => {
          const lv = verdictFor(state, s, now).level;
          return (
            <button key={s.id} className="tile" style={{ padding: "8px 10px", minWidth: 66, alignItems: "center", flex: "none", borderColor: room?.id === s.id ? "var(--gold)" : undefined, boxShadow: room?.id === s.id ? "0 0 0 2px var(--gold)" : undefined }} onClick={() => setRoom(s)}>
              <Lamp level={lv} /><span className="num" style={{ fontSize: 22 }}>{s.number}</span>
            </button>
          );
        })}
      </div>

      <div className="grid two" style={{ marginTop: 12 }}>
        <div className="card ivory stack" style={{ alignItems: "center", textAlign: "center" }}>
          <div className="caps">{room ? `Room ${room.number}` : "No room selected — say the number"}</div>
          {room && v && <div className="row"><Lamp level={v.level} lg /><b>{v.reasons[0]}</b></div>}
          <button className={"mic" + (live ? " live" : "")} aria-label="Hold to talk"
            onPointerDown={(e) => { e.preventDefault(); startTalk(); }} onPointerUp={stopTalk} onPointerLeave={() => { if (live) stopTalk(); }} onPointerCancel={stopTalk} disabled={!supported}>
            <Icon name="mic" />
          </button>
          <small>{supported ? (live ? "Listening… release to read back" : "Hold to talk") : "Voice isn't available in this browser — type below"}</small>
          {interim && <p style={{ fontStyle: "italic" }}>“{interim}”</p>}
          <div className="row" style={{ width: "100%" }}>
            <input className="input" placeholder={room ? `e.g. AC blowing warm, give it to Marco` : "e.g. 412 AC blowing warm, pull it from arrivals"} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") readback(text); }} />
            <button className="btn primary" disabled={!text.trim() || busy} onClick={() => readback(text)}>{busy ? "Reading…" : "Read back"}</button>
          </div>
          <small>{loadApiKey() ? "Max reads what you say; the local grammar is the fallback." : "No API key saved — the built-in grammar is reading. Add a key in Settings for anything you can say."}</small>
        </div>

        {room && roomSt && (
          <div className="card stack">
            <div className="row between"><span className="roomno sm">{room.number}</span><span className="chip">{roomSt.condition ? CONDITION_LABEL[roomSt.condition.value] : "not confirmed"}</span></div>
            <div className="caps">Two-tap inspect</div>
            <div className="row">
              <button className="btn ready big" style={{ flex: 1 }} onClick={() => { update((d) => A.inspect(d, d.spaces.find((s) => s.id === room.id)!, "pass", undefined, ctxAct, photo ?? undefined), `${room.number} passed`); setPhoto(null); }}><Icon name="check" />Pass</button>
              <button className="btn danger big" style={{ flex: 1 }} onClick={() => { const n = prompt("What failed?") ?? ""; update((d) => A.inspect(d, d.spaces.find((s) => s.id === room.id)!, "fail", n || undefined, ctxAct, photo ?? undefined), `${room.number} failed`); setPhoto(null); }}><Icon name="x" />Fail</button>
              <label className="btn big icon"><Icon name="camera" /><input type="file" accept="image/*" capture="environment" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setPhoto(await shrinkPhoto(f)); toast("Photo attached to the next inspection"); } }} /></label>
            </div>
            {photo && <img src={photo} alt="attached" style={{ maxWidth: 120, borderRadius: 10 }} />}
            <div className="caps">Reassign</div>
            <div className="chips">
              {state.staff.filter((s) => s.role === "attendant" || s.role === "engineering").map((s) => (
                <button key={s.id} className={"chip" + (assigneeOf(state, room.id)?.id === s.id ? " gold" : "")} onClick={() => update((d) => { A.assign(d, d.spaces.find((x) => x.id === room.id)!, s.name, s.role === "engineering" ? "repair" : "departure", ctxAct); }, `${room.number} → ${s.name.split(" ")[0]}`)}>{s.name.split(" ")[0]}</button>
              ))}
            </div>
            {openWorkOrders(state, room.id).length > 0 && <small>{openWorkOrders(state, room.id).length} open work order(s)</small>}
          </div>
        )}
      </div>

      {pending && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="row between"><h3>Read back</h3><small>{pending.result.engine === "claude" ? "read by Max" : "read locally"} · “{pending.transcript}”</small></div>
          <div className="receipt" style={{ marginTop: 10 }}>
            {pending.result.intents.map((it, i) => (
              <div key={i} className={"rc" + (pending.on[i] ? "" : " off")} onClick={() => setPending({ ...pending, on: pending.on.map((o, j) => (j === i ? !o : o)) })} style={{ cursor: "pointer" }}>
                <b>{it.room ?? "—"}</b>
                <span style={{ flex: 1 }}>{it.readback.replace(/^[^→]*→\s*/, "")}</span>
                <span className="conf">{Math.round(it.confidence * 100)}%{pending.on[i] ? "" : " · skipped"}</span>
              </div>
            ))}
            {pending.result.intents.length === 0 && <small>Nothing actionable heard.</small>}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary big" disabled={!pending.on.some(Boolean)} onClick={() => apply(pending.transcript, pending.result.intents.filter((_, i) => pending.on[i]))}>Apply {pending.on.filter(Boolean).length}</button>
            <button className="btn" onClick={() => { setText(pending.transcript); setPending(null); }}>Edit words</button>
            <button className="btn quiet" onClick={() => setPending(null)}>Discard</button>
          </div>
          <small>Tap a card to leave it out. Nothing writes until you apply.</small>
        </div>
      )}
    </Shell>
  );
}
