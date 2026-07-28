import React, { useState } from "react";
import { useStore } from "../state/store";
import { useUI } from "../state/ui";
import {
  roomDailyMinutes, jobDailyMinutes, roomStatus, employeeAssignedMinutes,
  scopedRooms, rollup, deptKey, deptColor, byId, loadWord
} from "../lib/compute";
import type { AppState, Employee, NonSpaceJob, Room } from "../lib/types";
import { uid } from "../lib/types";
import { fmt, fmtHrs } from "../lib/format";
import { toast } from "./Toast";
import { Modal } from "./Modal";
import { MinutesButton } from "./Breakdown";

const JOB_TYPE_LABELS: Record<string, string> = {
  discharge: "Discharge / bed cleans", porter: "Porter / transport", trashlinen: "Trash & linen run",
  laundry: "Laundry", floortech: "Floor projects", custom: "Something else"
};

interface DragData { kind: "room" | "job" | "branch"; roomId?: string; jobId?: string; roomIds?: string[]; label?: string; }

function readDragData(e: React.DragEvent): DragData | null {
  try { return JSON.parse(e.dataTransfer.getData("text/plain")); } catch { return null; }
}

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w.charAt(0)).join("").slice(0, 2).toUpperCase();
}

export function ScheduleView() {
  const { state, update } = useStore();
  const ui = useUI();
  const [empModal, setEmpModal] = useState<{ emp: Employee | null } | null>(null);
  const [jobModal, setJobModal] = useState<{ job: NonSpaceJob | null } | null>(null);

  const hintDismissed = state.ui.expanded["hint_board"] === false;

  function assign(data: DragData, shiftId: string | null, employeeId: string | null) {
    if (!ui.canEditSchedule) return;
    let n = 0;
    update((d: AppState) => {
      const assignRoom = (id: string) => {
        const r = byId(d.rooms, id);
        if (r) { r.shiftId = shiftId; r.employeeId = employeeId; n++; }
      };
      if (data.kind === "room" && data.roomId) assignRoom(data.roomId);
      else if (data.kind === "branch" && data.roomIds) data.roomIds.forEach(assignRoom);
      else if (data.kind === "job" && data.jobId) {
        const j = byId(d.jobs, data.jobId);
        if (j) { j.shiftId = shiftId; j.employeeId = employeeId; n++; }
      }
    });
    if (n) toast(n === 1 ? "Assigned ✓" : `${n} rooms assigned ✓`);
  }

  function RoomChip({ r }: { r: Room }) {
    const fl = byId(state.floors, r.floorId);
    return (
      <div className="chip room" draggable={ui.canEditSchedule} tabIndex={0}
        style={{ borderLeftColor: deptColor(state, deptKey(r)) }}
        onDragStart={(e) => e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "room", roomId: r.id }))}
        onClick={() => ui.openRoom(r.id)}
        onKeyDown={(e) => { if (e.key === "Enter") ui.openRoom(r.id); }}>
        <span style={{ minWidth: 0 }}>
          <div>{r.name}</div>
          <div className="rt">{r.roomType}{fl ? " · " + fl.name : ""}{roomStatus(r) === "partial" ? " · needs a person" : ""}</div>
          {r.tasks.length > 0 && (
            <div className="tasklabels">
              {r.tasks.slice(0, 2).map((t) => <span className="tasklabel" key={t}>{t}</span>)}
              {r.tasks.length > 2 && <span className="tasklabel">+{r.tasks.length - 2} more</span>}
            </div>
          )}
        </span>
        <span className="mins"><MinutesButton room={r} mode="daily" /></span>
      </div>
    );
  }
  function JobChip({ j }: { j: NonSpaceJob }) {
    return (
      <div className="chip job" draggable={ui.canEditSchedule} tabIndex={0}
        onDragStart={(e) => e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "job", jobId: j.id }))}
        onClick={() => ui.canEditSchedule && setJobModal({ job: j })}>
        <span>
          <div>{j.name}</div>
          <div className="rt">{JOB_TYPE_LABELS[j.type] ?? j.type}{j.mode === "unit" ? ` · ${j.unitsPerDay} × ${j.minutesPerUnit} min` : " · set time"}</div>
        </span>
        <span className="mins">{fmt(jobDailyMinutes(j), 0)} m/d</span>
      </div>
    );
  }

  function DropTarget({ className, activeClass, onDropData, children }: {
    className: string; activeClass: string; onDropData: (d: DragData) => void; children: React.ReactNode;
  }) {
    const [over, setOver] = useState(false);
    return (
      <div className={className + (over ? " " + activeClass : "")}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setOver(false);
          const d = readDragData(e);
          if (d) onDropData(d);
        }}>
        {children}
      </div>
    );
  }

  if (!state.rooms.length && !state.jobs.length) {
    return (
      <div className="card"><div className="emptystate">
        <div className="big">Nothing to schedule yet</div>
        <p>Start by importing your floor scans — your rooms will show up here, ready to hand out.</p>
        <button className="btn big primary" onClick={() => update((d) => { d.ui.view = "import"; })}>Import floor scans</button>
      </div></div>
    );
  }

  const trayRooms = scopedRooms(state, state.ui.scope)
    .filter((r) => roomStatus(r) !== "scheduled")
    .sort((a, b) => roomDailyMinutes(state, b) - roomDailyMinutes(state, a));
  const trayJobs = state.jobs.filter((j) => !j.employeeId);

  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        <h1 className="pagetitle" style={{ margin: 0 }}>Schedule</h1>
        <div className="segmented">
          {(["employee", "area"] as const).map((m) => (
            <button key={m} className={state.ui.boardMode === m ? "on" : ""}
              onClick={() => update((d) => { d.ui.boardMode = m; })}>
              {m === "employee" ? "By person" : "By area"}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {ui.canEditSchedule && <>
          <button className="btn" onClick={() => setEmpModal({ emp: null })}>+ Add a person</button>
          <button className="btn" onClick={() => setJobModal({ job: null })}>+ Other work</button>
        </>}
        <button className="btn primary" onClick={ui.printSchedules}>🖨 Print daily schedules</button>
      </div>

      {!hintDismissed && state.employees.length > 0 && trayRooms.length > 0 && (
        <div className="hintbar">
          <span>💡 Drag any room from "To be scheduled" onto a person's card. Drag a whole department from the left-hand list to assign it all at once.</span>
          <button aria-label="Dismiss hint" onClick={() => update((d) => { d.ui.expanded["hint_board"] = false; })}>✕</button>
        </div>
      )}

      {!state.employees.length ? (
        <div className="card"><div className="emptystate">
          <div className="big">No employees yet — add your first tech</div>
          <p>Each person gets a card on this board. Drag rooms onto their card and their day fills up.</p>
          {ui.canEditSchedule && <button className="btn big primary" onClick={() => setEmpModal({ emp: null })}>+ Add your first tech</button>}
        </div></div>
      ) : (
        <div className="boardgrid">
          <div className="card tray">
            <div className="chead">
              <h2>To be scheduled</h2>
              <span className="sub">{trayRooms.length} rooms · {trayJobs.length} jobs</span>
            </div>
            <div className="cbody">
              {!trayRooms.length && !trayJobs.length && <div className="note">All caught up — everything is assigned. 🎉</div>}
              {trayRooms.map((r) => <RoomChip key={r.id} r={r} />)}
              {trayJobs.map((j) => <JobChip key={j.id} j={j} />)}
            </div>
          </div>

          <div>
            {state.ui.boardMode === "area" ? (
              <AreaBoard />
            ) : (
              state.shifts.map((sh) => {
                const emps = state.employees.filter((e) => e.shiftId === sh.id);
                const shMin = emps.reduce((s, e) => s + employeeAssignedMinutes(state, e.id), 0);
                const partials = state.rooms.filter((r) => r.shiftId === sh.id && !r.employeeId);
                const pjobs = state.jobs.filter((j) => j.shiftId === sh.id && !j.employeeId);
                return (
                  <div className="shiftblock" key={sh.id}>
                    <div className="shifthead">
                      <span className="shiftdot" style={{ background: sh.color }} />
                      <h3>{sh.name}</h3>
                      <span className="time">{sh.start} – {sh.end}</span>
                      <span className="tot">{emps.length} people · {fmtHrs(shMin)} of work</span>
                    </div>
                    <div className="empgrid">
                      {emps.map((emp) => {
                        const assigned = employeeAssignedMinutes(state, emp.id);
                        const cap = state.rates.productiveMinutes;
                        const pct = Math.min(100, (assigned / cap) * 100);
                        const capCls = assigned > cap ? " over" : assigned > cap * 0.85 ? " warn" : "";
                        return (
                          <DropTarget key={emp.id} className="empcard" activeClass="dropover"
                            onDropData={(d) => assign(d, emp.shiftId, emp.id)}>
                            <div className="ehead" onDoubleClick={() => ui.canEditSchedule && setEmpModal({ emp })}>
                              <span className="avatar" style={{ background: sh.color }}>{initials(emp.name)}</span>
                              <div className="nm" style={{ display: "block" }}>
                                <div>{emp.name}</div>
                                <div className="role">{emp.role || "EVS Tech"}</div>
                              </div>
                            </div>
                            <div className={"capbar" + capCls}><i style={{ width: pct + "%" }} /></div>
                            <div className="capnote">
                              {fmt(assigned, 0)} of {cap} min · <span className="capword">{loadWord(assigned, cap)}</span>
                            </div>
                            <div className="list">
                              {state.rooms.filter((r) => r.employeeId === emp.id)
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map((r) => <RoomChip key={r.id} r={r} />)}
                              {state.jobs.filter((j) => j.employeeId === emp.id).map((j) => <JobChip key={j.id} j={j} />)}
                            </div>
                          </DropTarget>
                        );
                      })}
                      <div style={{ gridColumn: "1 / -1" }}>
                        <DropTarget className="shiftdrop" activeClass="dropover"
                          onDropData={(d) => assign(d, sh.id, null)}>
                          Drop here to park work on {sh.name} without picking a person yet
                        </DropTarget>
                        {(partials.length > 0 || pjobs.length > 0) && (
                          <div style={{ marginTop: 8 }}>
                            {partials.map((r) => <RoomChip key={r.id} r={r} />)}
                            {pjobs.map((j) => <JobChip key={j.id} j={j} />)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {empModal && <EmployeeModal emp={empModal.emp} onClose={() => setEmpModal(null)} />}
      {jobModal && <JobModal job={jobModal.job} onClose={() => setJobModal(null)} />}
    </div>
  );
}

function AreaBoard() {
  const { state } = useStore();
  return (
    <div className="card">
      <div className="chead"><h2>Who covers each area</h2></div>
      <div className="cbody">
        {state.buildings.map((b) =>
          state.floors.filter((f) => f.buildingId === b.id).map((f) => {
            const fRooms = state.rooms.filter((r) => r.floorId === f.id);
            if (!fRooms.length) return null;
            const depts = new Map<string, Room[]>();
            for (const r of fRooms) {
              const d = deptKey(r);
              if (!depts.has(d)) depts.set(d, []);
              depts.get(d)!.push(r);
            }
            return (
              <div className="areagroup" key={f.id}>
                <h4>{b.name} / {f.name}</h4>
                {[...depts.keys()].sort().map((d) => {
                  const rms = depts.get(d)!;
                  const ru = rollup(state, rms);
                  const names = new Map<string, number>();
                  for (const r of rms) {
                    if (!r.employeeId) continue;
                    const emp = byId(state.employees, r.employeeId);
                    if (emp) names.set(emp.name, (names.get(emp.name) ?? 0) + 1);
                  }
                  const who = [...names.entries()].map(([nm, n]) => `${nm} (${n})`).join(", ");
                  return (
                    <div className="cover" key={d}>
                      <span className="cdot" style={{ background: deptColor(state, d), marginRight: 6 }} />
                      <b>{d}</b> — {ru.rooms} rooms, {fmtHrs(ru.dailyMin)} a day ·{" "}
                      {who ? `covered by ${who}` : <span style={{ color: "var(--danger)" }}>nobody assigned yet</span>}
                      {ru.unscheduled ? ` · ${ru.unscheduled} still unscheduled` : ""}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function EmployeeModal({ emp, onClose }: { emp: Employee | null; onClose: () => void }) {
  const { state, update } = useStore();
  const [name, setName] = useState(emp?.name ?? "");
  const [role, setRole] = useState(emp?.role ?? "EVS Tech");
  const [shiftId, setShiftId] = useState(emp?.shiftId ?? state.shifts[0]?.id ?? "");
  const [pattern, setPattern] = useState<boolean[]>(emp?.pattern ?? [false, true, true, true, true, true, false]);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const buttons = [
    {
      label: emp ? "Save" : "Add person", primary: true, onClick: () => {
        if (!name.trim()) { toast("Please enter a name", true); return; }
        update((d) => {
          if (emp) {
            const e = byId(d.employees, emp.id);
            if (e) { e.name = name.trim(); e.role = role.trim(); e.shiftId = shiftId; e.pattern = pattern; }
          } else {
            d.employees.push({ id: uid("emp"), name: name.trim(), role: role.trim() || "EVS Tech", shiftId, pattern });
          }
        });
        onClose();
      }
    },
    ...(emp ? [{
      label: "Remove", danger: true, onClick: () => {
        update((d) => {
          d.rooms.forEach((r) => { if (r.employeeId === emp.id) r.employeeId = null; });
          d.jobs.forEach((j) => { if (j.employeeId === emp.id) j.employeeId = null; });
          d.employees = d.employees.filter((x) => x.id !== emp.id);
        });
        onClose();
        toast("Removed — their rooms went back to the schedule pile");
      }
    }] : []),
    { label: "Cancel", onClick: onClose }
  ];

  return (
    <Modal title={emp ? "Edit person" : "Add a person"} onClose={onClose} buttons={buttons}>
      <div className="field" style={{ marginBottom: 10 }}><label>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. D. Alvarez" /></div>
      <div className="field" style={{ marginBottom: 10 }}><label>Role</label>
        <input type="text" value={role} onChange={(e) => setRole(e.target.value)} /></div>
      <div className="field" style={{ marginBottom: 10 }}><label>Shift</label>
        <select value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
          {state.shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.start}–{s.end})</option>)}
        </select></div>
      <div className="field"><label>Days they work</label>
        <div className="row">
          {days.map((d, i) => (
            <label key={d} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}>
              <input type="checkbox" checked={pattern[i]}
                onChange={(e) => setPattern((p) => p.map((v, j) => j === i ? e.target.checked : v))} />
              {d}
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function JobModal({ job, onClose }: { job: NonSpaceJob | null; onClose: () => void }) {
  const { state, update } = useStore();
  const [name, setName] = useState(job?.name ?? "");
  const [type, setType] = useState(job?.type ?? "discharge");
  const [mode, setMode] = useState<"block" | "unit">(job?.mode ?? "unit");
  const [units, setUnits] = useState(job?.unitsPerDay ?? 6);
  const [minsPer, setMinsPer] = useState(job?.minutesPerUnit ?? 45);
  const [block, setBlock] = useState(job?.minutes ?? 240);
  const [shiftId, setShiftId] = useState(job?.shiftId ?? "");

  function onTypeChange(t: string) {
    setType(t as NonSpaceJob["type"]);
    if (!job && !name.trim()) setName(JOB_TYPE_LABELS[t] ?? t);
    if (t === "discharge") { setMode("unit"); setUnits(6); setMinsPer(45); }
    if (t === "trashlinen" || t === "porter") { setMode("block"); setBlock(240); }
  }

  const buttons = [
    {
      label: job ? "Save" : "Add work", primary: true, onClick: () => {
        if (!name.trim()) { toast("Please give it a name", true); return; }
        update((d) => {
          const data = {
            name: name.trim(), type: type as NonSpaceJob["type"], mode,
            minutes: Number(block) || 0, unitsPerDay: Number(units) || 0, minutesPerUnit: Number(minsPer) || 0,
            shiftId: shiftId || null
          };
          if (job) {
            const j = byId(d.jobs, job.id);
            if (j) Object.assign(j, data);
          } else {
            d.jobs.push({ id: uid("job"), employeeId: null, ...data });
          }
        });
        onClose();
      }
    },
    ...(job ? [{
      label: "Delete", danger: true, onClick: () => {
        update((d) => { d.jobs = d.jobs.filter((x) => x.id !== job.id); });
        onClose();
      }
    }] : []),
    { label: "Cancel", onClick: onClose }
  ];

  return (
    <Modal title={job ? "Edit other work" : "Other work (not a room)"} onClose={onClose} buttons={buttons}>
      <p className="note" style={{ marginBottom: 12 }}>
        For work that isn't a room on the map — discharge cleans, trash runs, laundry, floor projects.
        It counts toward a person's day just like rooms do.
      </p>
      <div className="field" style={{ marginBottom: 10 }}><label>What is it?</label>
        <select value={type} onChange={(e) => onTypeChange(e.target.value)}>
          {Object.entries(JOB_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select></div>
      <div className="field" style={{ marginBottom: 10 }}><label>Name it</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Discharge cleans — 4 West" /></div>
      <div className="field" style={{ marginBottom: 10 }}><label>How do we count the time?</label>
        <select value={mode} onChange={(e) => setMode(e.target.value as "block" | "unit")}>
          <option value="unit">By the job (how many a day × minutes each)</option>
          <option value="block">Set amount of time each day</option>
        </select></div>
      {mode === "unit" ? (
        <div className="row" style={{ marginBottom: 10 }}>
          <div className="field"><label>How many a day</label>
            <input type="number" min={0} step={1} value={units} onChange={(e) => setUnits(Number(e.target.value) || 0)} /></div>
          <div className="field"><label>Minutes each</label>
            <input type="number" min={0} step={1} value={minsPer} onChange={(e) => setMinsPer(Number(e.target.value) || 0)} /></div>
        </div>
      ) : (
        <div className="field" style={{ marginBottom: 10 }}><label>Minutes per day</label>
          <input type="number" min={0} step={5} value={block} onChange={(e) => setBlock(Number(e.target.value) || 0)} /></div>
      )}
      <div className="field"><label>Shift</label>
        <select value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
          <option value="">(pick later)</option>
          {state.shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></div>
    </Modal>
  );
}
