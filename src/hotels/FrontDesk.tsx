// FRONT DESK VIEW — arrival rooms and the verdict, nothing else. Read-only.
// Cannot fake green: the lamp comes straight from the engine, room codes
// only in privacy mode, and nothing here slows the desk while a line waits.
import React from "react";
import { useApp, Shell, Lamp } from "./app";
import { fmtTime } from "./store";
import { verdictFor, minutesToPromise, arrivalUnits } from "./verdict";
import { VERDICT_LABEL } from "./theme";

export function FrontDeskView() {
  const { state, now } = useApp();
  const units = arrivalUnits(state);
  return (
    <Shell title="Front desk" actions={<span className="chip">{state.settings.privacyMode ? "Privacy mode · room codes only" : "Names visible"}</span>}>
      <p className="muted" style={{ marginBottom: 14 }}>Tonight's arrivals and whether each room can be walked. This screen is read-only — the verdict comes from housekeeping, inspection and engineering, and nobody at the desk can change it.</p>
      <div className="grid tiles">
        {units.map((u) => {
          const v = verdictFor(state, u.spaces[0], now);
          const left = minutesToPromise(u.status, now);
          return (
            <div key={u.key} className="tile" style={{ borderTop: `3px solid var(--${v.level === "green" ? "ready" : v.level === "yellow" ? "hold" : v.level === "red" ? "dnw" : "unknown"})` }}>
              <div className="row between"><span className="roomno sm">{u.label}</span><Lamp level={v.level} lg /></div>
              <b>{VERDICT_LABEL[v.level]}</b>
              <small>{fmtTime(u.status.flags.promisedAt)}{left !== null && left < 0 ? ` · ${-left} min late` : ""}{u.status.flags.vip ? " · VIP" : ""}</small>
              <small>{state.settings.privacyMode ? u.status.flags.guestCode : u.status.flags.guestCode}</small>
            </div>
          );
        })}
        {units.length === 0 && <div className="empty"><h2>No arrivals</h2></div>}
      </div>
    </Shell>
  );
}
