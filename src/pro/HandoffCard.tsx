// "Help from Claude" — the switch on the Scope page, the banner on every hub page, and the engine
// behind them (Josh, 2026-11-02: "I want you to be able to edit the schedules for me… at request
// only… find an on/off switch"). OFF is the app as it has always been. ON: this device keeps its
// workspace in the OpsMatrix mailbox under a code Josh reads to Claude, and takes back what Claude
// sends — only when Josh taps Apply. handoff.ts holds the pure parts; functions/handoff is the mailbox.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { reloadWhenSaved } from "./reloadWhenSaved";
import {
  AUTO_OFF_HOURS, Mailbox, TICK_MS, applyEdits, buildPayload, deviceName, expired, formatCode, loadState,
  mailboxUrl, newCode, payloadFingerprint, saveState, summarizeEdits,
  type EditsSummary, type HandoffEdits, type HandoffState
} from "./handoff";

type Net = { status: "idle" | "sending" | "ok" | "error"; at?: string; error?: string };

export interface HandoffControl {
  on: boolean;
  state: HandoffState | null;
  net: Net;
  pending: HandoffEdits | null;
  summary: EditsSummary | null;
  busy: boolean;
  turnOn: () => void;
  turnOff: () => Promise<void>;
  apply: () => Promise<void>;
  dismiss: () => Promise<void>;
}

const get = (k: string) => localStorage.getItem(k);
const set = (k: string, v: string) => localStorage.setItem(k, v);
const remove = (k: string) => localStorage.removeItem(k);

export function useHandoff(): HandoffControl {
  const [state, setState] = useState<HandoffState | null>(() => loadState(get));
  const [net, setNet] = useState<Net>({ status: "idle" });
  const [pending, setPending] = useState<HandoffEdits | null>(null);
  const [busy, setBusy] = useState(false);
  const stateRef = useRef(state); stateRef.current = state;
  const pendingRef = useRef(pending); pendingRef.current = pending;
  const inflight = useRef(false);

  const persist = useCallback((s: HandoffState | null) => { saveState(set, remove, s); setState(s); }, []);
  const mailbox = (code: string) => new Mailbox(mailboxUrl(get), code);

  const turnOff = useCallback(async () => {
    const s = stateRef.current;
    persist(null); setPending(null); setNet({ status: "idle" });
    if (s) { try { await mailbox(s.code).close(); } catch { /* the mailbox empties itself anyway */ } }
  }, [persist]);

  /** one look at the mailbox: send what changed here, fetch what Claude left */
  const tick = useCallback(async () => {
    const s = stateRef.current;
    if (!s || inflight.current) return;
    if (expired(s.since)) { await turnOff(); return; }
    inflight.current = true;
    try {
      let cur = s;
      const fp = payloadFingerprint(get);
      if (fp !== s.sentFp) {
        setNet({ status: "sending" });
        const rev = s.rev + 1;
        await mailbox(s.code).send(buildPayload(get, rev, deviceName()));
        cur = { ...s, rev, sentFp: fp, sentAt: new Date().toISOString() };
        persist(cur);
      }
      const st = await mailbox(s.code).status();
      if (!st.exists) {
        // the mailbox emptied itself (expired) — send again next time round
        persist({ ...cur, sentFp: "" });
      } else if (st.edits && !cur.seen.includes(st.edits.id) && pendingRef.current?.id !== st.edits.id) {
        const ed = await mailbox(s.code).edits();
        if (ed && !cur.seen.includes(ed.id)) setPending(ed);
      }
      setNet({ status: "ok", at: new Date().toISOString() });
    } catch (e) {
      setNet({ status: "error", error: String((e as Error)?.message ?? e) });
    } finally {
      inflight.current = false;
    }
  }, [persist, turnOff]);

  useEffect(() => {
    if (!state?.code) return;
    void tick();
    const id = window.setInterval(() => { void tick(); }, TICK_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [state?.code, tick]);

  const turnOn = useCallback(() => {
    persist({ code: newCode(), since: new Date().toISOString(), rev: 0, sentFp: "", sentAt: "", seen: [] });
    setNet({ status: "sending" });
  }, [persist]);

  const apply = useCallback(async () => {
    const s = stateRef.current, ed = pendingRef.current;
    if (!s || !ed || busy) return;
    setBusy(true);
    try {
      applyEdits(ed, get, set);
      // remembered as seen, and the next tick after the reload sends the new state up
      persist({ ...s, seen: [...s.seen, ed.id], sentFp: "" });
      try { await mailbox(s.code).clearEdits(); } catch { /* it's marked seen either way */ }
      setPending(null);
      reloadWhenSaved(600);
    } catch (e) {
      setBusy(false);
      setNet({ status: "error", error: "Couldn't apply: " + String((e as Error)?.message ?? e) });
    }
  }, [busy, persist]);

  const dismiss = useCallback(async () => {
    const s = stateRef.current, ed = pendingRef.current;
    if (!s || !ed) return;
    persist({ ...s, seen: [...s.seen, ed.id] });
    setPending(null);
    try { await mailbox(s.code).clearEdits(); } catch { /* marked seen */ }
  }, [persist]);

  return {
    on: Boolean(state), state, net, pending, busy,
    summary: pending && state ? summarizeEdits(pending, state.rev) : null,
    turnOn, turnOff, apply, dismiss
  };
}

const clock = (iso?: string) => iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";

function summaryWords(s: EditsSummary): string {
  const parts = [
    s.rooms !== null ? `${s.rooms.toLocaleString()} rooms` : "",
    s.schedules !== null ? `${s.schedules} schedule${s.schedules === 1 ? "" : "s"}` : "",
    s.nonSpace !== null ? `${s.nonSpace} non-space task${s.nonSpace === 1 ? "" : "s"}` : "",
    ...s.others
  ].filter(Boolean);
  return parts.join(" · ") || "no data";
}

/** the changes Claude sent, and the two ways out — shared by the card and the banner */
function ChangesBox({ h, compact }: { h: HandoffControl; compact?: boolean }) {
  if (!h.pending || !h.summary) return null;
  const s = h.summary;
  return (
    <div className={"handoffchanges" + (compact ? " compact" : "")}>
      <div>
        <b>✉ Claude sent changes</b> at {clock(h.pending.at)} — {summaryWords(s)}.
        {h.pending.note ? <> <i>“{h.pending.note}”</i></> : null}
        {s.stale && <span className="warntext">⚠ You've changed things on this device since Claude's copy — applying replaces those changes.</span>}
      </div>
      <span className="handoffacts">
        <button className="pbtn primary small" disabled={h.busy} onClick={() => { void h.apply(); }}>
          {h.busy ? "Applying…" : "✓ Apply"}
        </button>
        <button className="pbtn small" disabled={h.busy} onClick={() => { void h.dismiss(); }}>Discard</button>
      </span>
    </div>
  );
}

/** on every hub page: what came in, and the way to deal with it right there */
export function HandoffBanner({ h }: { h: HandoffControl }) {
  if (!h.pending) return null;
  return <div className="handoffbanner"><ChangesBox h={h} compact /></div>;
}

/** the switch, on the Scope page under Data backup */
export function HandoffCard({ h }: { h: HandoffControl }) {
  const [copied, setCopied] = useState(false);
  const s = h.state;
  const code = s ? formatCode(s.code) : "";
  const offAt = s ? new Date(Date.parse(s.since) + AUTO_OFF_HOURS * 3600_000) : null;
  return (
    <div className="prule-block handoffcard">
      <h3>Help from Claude</h3>
      <p className="pnote">
        <b>Off</b> — the usual: nothing leaves this device. <b>On</b> — this device shares its OpsMatrix data
        (rooms, floor plans, schedules, rules; not the floor pictures) with Claude through your OpsMatrix mailbox,
        and takes back the changes Claude sends — only when you tap Apply. Anyone with the code can read your
        data while it's on, so it turns itself off after {AUTO_OFF_HOURS} hours.
      </p>
      {!s ? (
        <div className="prow">
          <button className="pbtn primary" onClick={h.turnOn}>Turn on — share with Claude</button>
        </div>
      ) : (
        <>
          <div className="handoffcode">
            <span>Read this code to Claude</span>
            <b>{code}</b>
            <button className="pbtn small" onClick={() => {
              navigator.clipboard?.writeText(code).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }).catch(() => undefined);
            }}>{copied ? "Copied" : "Copy"}</button>
          </div>
          <p className={"pnote" + (h.net.status === "error" ? " warntext" : h.net.status === "ok" ? " keysaved" : "")}>
            {h.net.status === "sending" && "Sending this device's data to the mailbox…"}
            {h.net.status === "ok" && `✓ Shared${s.sentAt ? " at " + clock(s.sentAt) : ""} · ${deviceName()} · Claude's changes are checked every ${Math.round(TICK_MS / 1000)} seconds while OpsMatrix is open`}
            {h.net.status === "error" && `⚠ Couldn't reach the mailbox (${h.net.error}). It keeps trying — check the internet connection.`}
            {h.net.status === "idle" && "Starting…"}
          </p>
          <ChangesBox h={h} />
          <div className="prow">
            <button className="pbtn" onClick={() => { void h.turnOff(); }}>Turn off</button>
            <small className="pnote">On since {clock(s.since)}; off by itself at {offAt ? clock(offAt.toISOString()) : ""}. Keep OpsMatrix open while Claude works.</small>
          </div>
        </>
      )}
    </div>
  );
}
