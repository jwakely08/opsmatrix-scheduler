import { useRef, useState } from "react";
import { useStore } from "../state/store";
import { useUI } from "../state/ui";
import { useAuth } from "../auth/AuthContext";
import { supabase } from "../auth/supabaseClient";
import { defaultState } from "../lib/seeds";
import { uid, type AppState } from "../lib/types";
import { download } from "../lib/format";
import { toast } from "./Toast";
import { Modal } from "./Modal";
import { log } from "../lib/logger";

export function SettingsView() {
  const { state, update, replaceState, reload } = useStore();
  const ui = useUI();
  const auth = useAuth();
  const restoreRef = useRef<HTMLInputElement>(null);
  const [pendingRestore, setPendingRestore] = useState<AppState | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);
  const [inviteRole, setInviteRole] = useState<"supervisor" | "staff">("staff");
  const [inviteCode, setInviteCode] = useState("");

  const canEdit = ui.canEditFacility;

  function handleRestoreFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const incoming = JSON.parse(String(reader.result));
        if (!incoming || typeof incoming !== "object" || !incoming.version) {
          throw new Error("not an OpsMatrix backup");
        }
        const def = defaultState();
        const merged: AppState = { ...def, ...incoming };
        merged.rates = { ...def.rates, ...(incoming.rates ?? {}) };
        merged.ui = { ...def.ui, ...(incoming.ui ?? {}) };
        setPendingRestore(merged);
      } catch (err: any) {
        toast("Could not read backup: " + (err?.message ?? err), true);
      }
    };
    reader.readAsText(file);
  }

  async function makeInvite() {
    if (!supabase) return;
    const r = await supabase.rpc("create_invite", { invite_role: inviteRole });
    if (r.error) { log.warn("invite failed", r.error); toast(r.error.message, true); return; }
    setInviteCode(r.data as string);
  }

  return (
    <div>
      <h1 className="pagetitle">Settings</h1>
      <p className="pagesub">Rates, shifts and data management. All rates are editable estimates — tune them to your building.</p>

      {/* ---- workload rates ---- */}
      <div className="card">
        <div className="chead"><h2>Workload rates</h2>
          <span className="sub">minutes per 1,000 cleanable ft², by room type × floor type</span></div>
        <div className="cbody">
          <div className="note estimate" style={{ marginBottom: 12 }}>
            These are editable estimates seeded from industry-typical (ISSA-style) production rates — not measured
            values. Workload math uses cleanable (interior) square footage only; gross is reference.
          </div>
          <div className="tablewrap">
            <table className="grid">
              <thead><tr><th>Room type</th><th>Floor type</th><th className="num">Min / 1,000 ft²</th><th /></tr></thead>
              <tbody>
                {state.rates.baseRates.map((br) => (
                  <tr key={br.id}>
                    <td><input type="text" value={br.roomType} disabled={!canEdit}
                      onChange={(e) => update((d) => {
                        const row = d.rates.baseRates.find((x) => x.id === br.id);
                        if (row) row.roomType = e.target.value;
                      })} /></td>
                    <td><input type="text" value={br.floorType} disabled={!canEdit}
                      onChange={(e) => update((d) => {
                        const row = d.rates.baseRates.find((x) => x.id === br.id);
                        if (row) row.floorType = e.target.value;
                      })} /></td>
                    <td className="num"><input type="number" min={0} step={1} value={br.minutesPer1000} disabled={!canEdit}
                      onChange={(e) => update((d) => {
                        const row = d.rates.baseRates.find((x) => x.id === br.id);
                        if (row) row.minutesPer1000 = Number(e.target.value) || 0;
                      })} /></td>
                    <td>{canEdit && (
                      <button className="btn small danger" onClick={() => update((d) => {
                        d.rates.baseRates = d.rates.baseRates.filter((x) => x.id !== br.id);
                      })}>✕</button>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canEdit && (
            <button className="btn small" style={{ marginTop: 10 }} onClick={() => update((d) => {
              d.rates.baseRates.push({ id: uid("br"), roomType: "(any)", floorType: "(any)", minutesPer1000: 25 });
            })}>+ Add rate row</button>
          )}
          <div className="row" style={{ marginTop: 14 }}>
            <div className="field"><label>Minutes per restroom fixture</label>
              <input type="number" min={0} step={0.5} value={state.rates.fixtureMinutes} disabled={!canEdit}
                onChange={(e) => update((d) => { d.rates.fixtureMinutes = Number(e.target.value) || 0; })} /></div>
            <div className="field"><label>Productive minutes per shift (FTE base)</label>
              <input type="number" min={60} step={5} value={state.rates.productiveMinutes} disabled={!canEdit}
                onChange={(e) => update((d) => { d.rates.productiveMinutes = Number(e.target.value) || 420; })} /></div>
          </div>
        </div>
      </div>

      {/* ---- modifiers ---- */}
      <div className="card">
        <div className="chead"><h2>Task modifiers & project rates</h2>
          <span className="sub">multipliers apply to a room's per-visit minutes; project rates are min / 1,000 ft²</span></div>
        <div className="cbody tablewrap">
          <table className="grid">
            <thead><tr><th>Modifier</th><th>Kind</th><th className="num">Value</th></tr></thead>
            <tbody>
              {state.rates.modifiers.map((mod) => (
                <tr key={mod.id}>
                  <td>{mod.name}</td>
                  <td>{mod.kind === "multiplier" ? "× multiplier" : "min / 1,000 ft²"}</td>
                  <td className="num"><input type="number" min={0} step={mod.kind === "multiplier" ? 0.05 : 5}
                    value={mod.value} disabled={!canEdit}
                    onChange={(e) => update((d) => {
                      const m = d.rates.modifiers.find((x) => x.id === mod.id);
                      if (m) m.value = Number(e.target.value) || 0;
                    })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- shifts ---- */}
      <div className="card">
        <div className="chead"><h2>Shifts</h2></div>
        <div className="cbody">
          <div className="tablewrap">
            <table className="grid">
              <thead><tr><th>Name</th><th>Start</th><th>End</th><th /></tr></thead>
              <tbody>
                {state.shifts.map((sh) => (
                  <tr key={sh.id}>
                    <td><input type="text" value={sh.name} disabled={!canEdit}
                      onChange={(e) => update((d) => {
                        const s = d.shifts.find((x) => x.id === sh.id);
                        if (s) s.name = e.target.value;
                      })} /></td>
                    <td><input type="time" value={sh.start} disabled={!canEdit}
                      onChange={(e) => update((d) => {
                        const s = d.shifts.find((x) => x.id === sh.id);
                        if (s) s.start = e.target.value;
                      })} /></td>
                    <td><input type="time" value={sh.end} disabled={!canEdit}
                      onChange={(e) => update((d) => {
                        const s = d.shifts.find((x) => x.id === sh.id);
                        if (s) s.end = e.target.value;
                      })} /></td>
                    <td>{canEdit && (
                      <button className="btn small danger" onClick={() => {
                        const used = state.employees.some((e) => e.shiftId === sh.id)
                          || state.rooms.some((r) => r.shiftId === sh.id);
                        if (used) { toast("Shift is in use — move employees/rooms off it first", true); return; }
                        update((d) => { d.shifts = d.shifts.filter((x) => x.id !== sh.id); });
                      }}>✕</button>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canEdit && (
            <button className="btn small" style={{ marginTop: 10 }} onClick={() => update((d) => {
              d.shifts.push({ id: uid("sh"), name: "Nights", start: "23:00", end: "07:30" });
            })}>+ Add shift</button>
          )}
        </div>
      </div>

      {/* ---- room type templates ---- */}
      <div className="card">
        <div className="chead"><h2>Room type templates</h2>
          <span className="sub">used by intake to auto-fill floor type, fixtures, tasks, frequency</span></div>
        <div className="cbody tablewrap">
          <table className="grid">
            <thead><tr><th>Type</th><th>Floor type</th><th className="num">Fixtures</th><th>Frequency</th><th>Default tasks</th></tr></thead>
            <tbody>
              {state.roomTypes.map((rt) => (
                <tr key={rt.id}>
                  <td>{rt.name}</td>
                  <td><select value={rt.floorType} disabled={!canEdit}
                    onChange={(e) => update((d) => {
                      const t = d.roomTypes.find((x) => x.id === rt.id);
                      if (t) t.floorType = e.target.value;
                    })}>
                    {state.floorTypes.map((ft) => <option key={ft} value={ft}>{ft}</option>)}
                  </select></td>
                  <td className="num"><input type="number" min={0} step={1} value={rt.fixtures} disabled={!canEdit}
                    onChange={(e) => update((d) => {
                      const t = d.roomTypes.find((x) => x.id === rt.id);
                      if (t) t.fixtures = Number(e.target.value) || 0;
                    })} /></td>
                  <td><select value={rt.frequency} disabled={!canEdit}
                    onChange={(e) => update((d) => {
                      const t = d.roomTypes.find((x) => x.id === rt.id);
                      if (t) t.frequency = e.target.value;
                    })}>
                    {state.frequencies.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </select></td>
                  <td><input type="text" value={rt.tasks.join(", ")} disabled={!canEdit}
                    onChange={(e) => update((d) => {
                      const t = d.roomTypes.find((x) => x.id === rt.id);
                      if (t) t.tasks = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                    })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- team & invites (remote directors only) ---- */}
      {auth.mode === "remote" && canEdit && (
        <div className="card">
          <div className="chead"><h2>Team & invites</h2>
            <span className="sub">generate a code, send it to a supervisor or staff member — they join with “Have an invite code?” on the login screen</span></div>
          <div className="cbody row">
            <div className="field"><label>Role for new member</label>
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "supervisor" | "staff")}>
                <option value="supervisor">Supervisor (edits schedules)</option>
                <option value="staff">Staff (read-only my-day)</option>
              </select></div>
            <button className="btn primary" onClick={() => void makeInvite()}>Generate invite code</button>
            {inviteCode && <span className="invitecode">{inviteCode}</span>}
          </div>
        </div>
      )}

      {/* ---- backup / restore ---- */}
      <div className="card">
        <div className="chead"><h2>Backup & restore</h2>
          <span className="sub">full app state as JSON — accepts backups from the original single-file scheduler too</span></div>
        <div className="cbody row">
          <button className="btn primary" onClick={() => {
            download(`opsmatrix-scheduler-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 2));
            toast("Backup downloaded");
          }}>Download backup JSON</button>
          <input ref={restoreRef} type="file" accept=".json" style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleRestoreFile(f);
              e.target.value = "";
            }} />
          <button className="btn" onClick={() => restoreRef.current?.click()}>Upload backup…</button>
        </div>
      </div>

      {/* ---- data & security ---- */}
      <div className="card">
        <div className="chead"><h2>Data & security</h2></div>
        <div className="cbody">
          <p style={{ marginBottom: 8 }}>
            <b>What this app stores:</b> your facility's physical spaces (buildings, floors, rooms and their square
            footage), cleaning rates, shifts, employee names and work assignments. That's it.
          </p>
          <p style={{ marginBottom: 8 }}>
            <b>No PHI by design:</b> OpsMatrix never collects patient names, room-occupant information, census data,
            or any medical information. There is nowhere to enter it and no database column to hold it.
          </p>
          <p style={{ marginBottom: 8 }}>
            <b>Data isolation:</b> {auth.mode === "remote"
              ? "every record is keyed to your organization, and database row-level security makes it impossible for another organization to read or change your data."
              : "in local mode, everything lives in this browser's storage on this computer — nothing is sent anywhere."}
          </p>
          <p style={{ marginBottom: 12 }}>
            <b>Export or delete everything:</b> use “Download backup JSON” above to export all data.
            {canEdit ? " Deleting removes every room, schedule and setting for this workspace." : ""}
          </p>
          {canEdit && (
            <button className="btn danger" onClick={() => setConfirmErase(true)}>Erase all data</button>
          )}
        </div>
      </div>

      {pendingRestore && (
        <Modal title="Restore backup?" onClose={() => setPendingRestore(null)} buttons={[
          {
            label: "Restore", primary: true, onClick: () => {
              replaceState(pendingRestore);
              setPendingRestore(null);
              toast("Backup restored");
            }
          },
          { label: "Cancel", onClick: () => setPendingRestore(null) }
        ]}>
          <p>
            This replaces ALL current scheduler data with the backup
            ({pendingRestore.rooms.length} rooms, {pendingRestore.employees.length} employees). Your current data
            will be overwritten{auth.mode === "remote" ? " for the whole organization" : ""}.
          </p>
        </Modal>
      )}

      {confirmErase && (
        <Modal title="Erase all data?" onClose={() => setConfirmErase(false)} buttons={[
          {
            label: "Erase", danger: true, onClick: async () => {
              if (auth.mode === "remote" && supabase) {
                const r = await supabase.rpc("delete_org_data");
                if (r.error) { toast(r.error.message, true); setConfirmErase(false); return; }
                await reload();
              } else {
                replaceState(defaultState());
              }
              setConfirmErase(false);
              toast("All data erased");
            }
          },
          { label: "Cancel", onClick: () => setConfirmErase(false) }
        ]}>
          <p>
            Removes every building, room, employee, schedule and setting
            {auth.mode === "remote" ? " for your organization" : " stored in this browser"}.
            Download a backup first if unsure.
          </p>
        </Modal>
      )}
    </div>
  );
}
