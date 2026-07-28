import { useState } from "react";
import { useStore } from "../state/store";
import { roomBreakdown, byId } from "../lib/compute";
import { fmt } from "../lib/format";
import { Modal } from "./Modal";
import type { Room } from "../lib/types";

/**
 * A minutes number you can click to see exactly where it came from —
 * plain-English line items, no black boxes. (Click, never hover.)
 */
export function MinutesButton({ room, mode, className }: {
  room: Room; mode: "daily" | "visit"; className?: string;
}) {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const b = roomBreakdown(state, room);
  const value = mode === "daily" ? b.daily : b.perVisit;
  const suffix = mode === "daily" ? " min/day" : " min";
  return (
    <>
      <button
        type="button"
        className={"minbtn " + (className ?? "")}
        title=""
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      >
        {fmt(value, value < 10 ? 1 : 0)}{suffix}
      </button>
      {open && <BreakdownModal room={room} onClose={() => setOpen(false)} />}
    </>
  );
}

export function BreakdownModal({ room, onClose }: { room: Room; onClose: () => void }) {
  const { state } = useStore();
  const b = roomBreakdown(state, room);
  const fl = byId(state.floors, room.floorId);
  return (
    <Modal title={`How we got ${room.name}'s time`} onClose={onClose}
      buttons={[{ label: "Got it", primary: true, onClick: onClose }]}>
      <p className="note" style={{ marginBottom: 10 }}>
        {fmt(room.cleanableSqFt, 0)} sq ft of cleanable floor{fl ? ` on ${fl.name}` : ""}.
      </p>
      <div className="breakdown">
        {b.lines.map((line, i) => (
          <div className="bline" key={i}>
            <span>{line.label}</span>
            <span className="bnum">
              {line.minutes !== undefined
                ? (line.minutes >= 0 ? "+" : "") + fmt(line.minutes, 1) + " min"
                : "× " + line.factor}
            </span>
          </div>
        ))}
        <div className="bline btotal">
          <span>Each visit</span>
          <span className="bnum">{fmt(b.perVisit, 1)} min</span>
        </div>
        <div className="bline">
          <span>{b.freqLabel} ({b.perWeek} × a week ÷ 7 days)</span>
          <span className="bnum">= {fmt(b.daily, 1)} min/day</span>
        </div>
      </div>
      <p className="note" style={{ marginTop: 10 }}>
        These are your editable numbers — change them under Settings → Cleaning times.
      </p>
    </Modal>
  );
}
