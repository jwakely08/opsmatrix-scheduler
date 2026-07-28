import { useState } from "react";
import { useStore } from "../state/store";
import { useUI } from "../state/ui";
import { roomStatus, deptKey, deptColor, byId } from "../lib/compute";
import { ensureDepartment } from "../lib/seeds";
import { FLOOR_FINISH_SHORT, type FloorFinish } from "../lib/types";
import { fmt } from "../lib/format";
import { toast } from "./Toast";
import { Modal } from "./Modal";
import { MinutesButton } from "./Breakdown";

export function RoomDrawer({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const { state, update } = useStore();
  const ui = useUI();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const r = byId(state.rooms, roomId);
  if (!r) return null;

  const fl = byId(state.floors, r.floorId);
  const b = fl ? byId(state.buildings, fl.buildingId) : null;
  const emp = byId(state.employees, r.employeeId);
  const sh = byId(state.shifts, r.shiftId);
  const canFacility = ui.canEditFacility;
  const canSchedule = ui.canEditSchedule;

  const set = (patch: Partial<typeof r>) =>
    update((d) => {
      const room = byId(d.rooms, roomId);
      if (room) {
        Object.assign(room, patch);
        if (patch.department) ensureDepartment(d, patch.department);
      }
    });

  return (
    <div className="drawer open">
      <div className="dhead">
        <h3>{r.name}</h3>
        <button className="closex" aria-label="Close" onClick={onClose}>✕</button>
      </div>
      <div className="dbody">
        <div className="kv">
          <div className="k">Where</div>
          <div className="v">{(b ? b.name + " / " : "") + (fl?.name ?? "?") + " / " + deptKey(r)}</div>
          <div className="k">Cleanable floor</div>
          <div className="v mono">{fmt(r.cleanableSqFt, 2)} ft²</div>
          <div className="k">Ceiling</div>
          <div className="v">{r.ceilingHeight || "–"}</div>
          <div className="k">Time needed</div>
          <div className="v"><MinutesButton room={r} mode="daily" /></div>
          <div className="k">Scheduled?</div>
          <div className="v">
            {roomStatus(r) === "scheduled" ? `Yes — ${emp?.name}${sh ? ` (${sh.name})` : ""}`
              : roomStatus(r) === "partial" ? `Halfway — on ${sh?.name}, nobody assigned`
              : "Not yet"}
          </div>
        </div>

        <div className="field" style={{ marginBottom: 10 }}><label>Room name</label>
          <input type="text" value={r.name} disabled={!canFacility}
            onChange={(e) => set({ name: e.target.value })} /></div>

        <div className="field" style={{ marginBottom: 10 }}>
          <label>Department</label>
          <input type="text" value={r.department} disabled={!canFacility} list="deptlist"
            onChange={(e) => set({ department: e.target.value || "Unassigned" })} />
          <datalist id="deptlist">
            {state.departments.map((d) => <option key={d.name} value={d.name} />)}
          </datalist>
          {canFacility && deptKey(r) !== "Unassigned" && (
            <div className="colorpick" style={{ marginTop: 6 }}>
              {["#0f6b62", "#d98e1f", "#3f6fb5", "#b5533f", "#7a4fb0", "#2e8f63", "#b03f7e", "#3fa3b5"].map((c) => (
                <button key={c} style={{ background: c }}
                  className={deptColor(state, deptKey(r)) === c ? "on" : ""}
                  aria-label={"Use this color"}
                  onClick={() => update((d) => {
                    const dept = ensureDepartment(d, deptKey(r));
                    dept.color = c;
                  })} />
              ))}
            </div>
          )}
        </div>

        <div className="field" style={{ marginBottom: 10 }}><label>Room type</label>
          <select value={r.roomType} disabled={!canFacility}
            onChange={(e) => {
              const tpl = state.roomTypes.find((t) => t.name === e.target.value);
              set(tpl
                ? { roomType: tpl.name, floorFinish: tpl.floorFinish, tasks: [...tpl.tasks], frequency: tpl.frequency }
                : { roomType: "(untyped)" });
            }}>
            <option value="(untyped)">(no type yet)</option>
            {state.roomTypes.map((rt) => <option key={rt.id} value={rt.name}>{rt.name}</option>)}
          </select></div>

        <div className="field" style={{ marginBottom: 10 }}><label>Floor</label>
          <select value={r.floorFinish} disabled={!canFacility}
            onChange={(e) => set({ floorFinish: e.target.value as FloorFinish })}>
            {(Object.keys(FLOOR_FINISH_SHORT) as FloorFinish[]).map((f) => (
              <option key={f} value={f}>{FLOOR_FINISH_SHORT[f]}</option>
            ))}
          </select></div>

        <div className="field" style={{ marginBottom: 10 }}><label>Restroom fixtures (sinks, toilets…)</label>
          <input type="number" min={0} step={1} value={r.fixtures} disabled={!canFacility}
            onChange={(e) => set({ fixtures: Number(e.target.value) || 0 })} /></div>

        <div className="field" style={{ marginBottom: 10 }}><label>How often it's cleaned</label>
          <select value={r.frequency} disabled={!canSchedule} onChange={(e) => set({ frequency: e.target.value })}>
            {state.frequencies.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select></div>

        <div className="field" style={{ marginBottom: 10 }}><label>Shift</label>
          <select value={r.shiftId ?? ""} disabled={!canSchedule}
            onChange={(e) => set({ shiftId: e.target.value || null, ...(e.target.value ? {} : { employeeId: null }) })}>
            <option value="">(no shift)</option>
            {state.shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>

        <div className="field" style={{ marginBottom: 10 }}><label>Who cleans it</label>
          <select value={r.employeeId ?? ""} disabled={!canSchedule}
            onChange={(e) => {
              const empId = e.target.value || null;
              const emp2 = byId(state.employees, empId);
              set({ employeeId: empId, ...(emp2 ? { shiftId: emp2.shiftId } : {}) });
            }}>
            <option value="">(nobody yet)</option>
            {state.employees.map((e2) => (
              <option key={e2.id} value={e2.id}>
                {e2.name} — {byId(state.shifts, e2.shiftId)?.name ?? "?"}
              </option>
            ))}
          </select></div>

        <div className="field" style={{ marginBottom: 14 }}><label>Tasks (one per line)</label>
          <textarea rows={3} defaultValue={r.tasks.join("\n")} disabled={!canFacility}
            onBlur={(e) => set({ tasks: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} /></div>

        {canFacility && (
          <button className="btn danger small" onClick={() => setConfirmDelete(true)}>Delete room</button>
        )}
      </div>

      {confirmDelete && (
        <Modal title="Delete room?" onClose={() => setConfirmDelete(false)} buttons={[
          {
            label: "Delete", primary: true, onClick: () => {
              update((d) => { d.rooms = d.rooms.filter((x) => x.id !== roomId); });
              setConfirmDelete(false);
              onClose();
              toast("Room deleted");
            }
          },
          { label: "Cancel", onClick: () => setConfirmDelete(false) }
        ]}>
          <p>Remove "{r.name}" and its assignment? This only affects OpsMatrix data.</p>
        </Modal>
      )}
    </div>
  );
}
