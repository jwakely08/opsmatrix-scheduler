import React, { useState } from "react";
import { useStore } from "../state/store";
import { useUI } from "../state/ui";
import {
  roomDailyMinutes, jobDailyMinutes, roomStatus, employeeAssignedMinutes,
  scopedRooms, rollup, deptKey, byId
} from "../lib/compute";
import type { AppState, Employee, NonSpaceJob, Room } from "../lib/types";
import { uid } from "../lib/types";
import { fmt, fmtHrs } from "../lib/format";
import { toast } from "./Toast";
import { Modal } from "./Modal";

const JOB_TYPE_LABELS: Record<string, string> = {
  discharge: "Discharge / bed cleans", porter: "Porter / transport", trashlinen: "Trash & linen run",
  laundry: "Laundry", floortech: "Floor tech", custom: "Custom"
};

interface DragData { kind: "room" | "job" | "branch"; roomId?: string; jobId?: string; roomIds?: string[]; label?: string; }

function readDragData(e: React.DragEvent): DragData | null {
  try { return JSON.parse(e.dataTransfer.getData("text/plain")); } catch { return null; }
}

export function ScheduleView() {
  const { state, update } = useStore();
  const ui = useUI();
  const [empModal, setEmpModal] = useState<{ emp: Employee | null } | null>(null);
  const [jobModal, setJobModal] = useState<{ job: NonSpaceJob | null } | null>(null);

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
    if (n) toast(`${n} item${n > 1 ? "s" : ""}${employeeId ? " assigned" : " staged on shift"}`);
  }

  function RoomChip({ r }: { r: Room }) {
    const fl = byId(state.floors, r.floorId);
    return (
      <div className="chip room" draggable={ui.canEditSchedule} tabIndex={0}
        onDragStart={(e) => e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "room", roomId: r.id }))}
        onClick={() => ui.openRoom(r.id)}
        onKeyDown={(e) => { if (e.key === "Enter") ui.openRoom(r.id); }}>
        <span>
          <div>{r.name}</div>
          <div className="rt">{r.roomType}{fl ? " · " + fl.name : ""}{roomStatus(r) === "partial" ? " · shift set, no employee" : ""}</div>
        </span>
        <span className="mins">{fmt(roomDailyMinutes(state, r), 0)} m/d</span>
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
          <div className="rt">{JOB_TYPE_LABELS[j.type] ?? j.type}{j.mode === "unit" ? ` · ${j.unitsPerDay} × ${j.minutesPerUnit} min` : " · time block"}</div>
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
        <div className="big">No spaces to schedule yet</div>
        <p>Import your magicplan scans to load rooms, or add non-space jobs (discharge cleans, porters, trash runs) once employees exist.</p>
        <button className="btn primary" onClick={() => update((d) => { d.ui.view = "import"; })}>Go to Import</button>
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
        <h1 className="pagetitle" style={{ margin: 0 }}>Scheduling board</h1>
        <div className="row" style={{ gap: 4 }}>
          {(["employee", "area"] as const).map((m) => (
            <button key={m} className={"btn small" + (state.ui.boardMode === m ? " primary" : "")}
              onClick={() => update((d) => { d.ui.boardMode = m; })}>
              {m === "employee" ? "By employee" : "By area"}
            </button>
          ))}
        </div>
        <span className="spacer" />
        {ui.canEditSchedule && <>
          <button className="btn small" onClick={() => setEmpModal({ emp: null })}>+ Employee</button>
          <button className="btn small" onClick={() => setJobModal({ job: null })}>+ Non-space job</button>
        </>}
        <button className="btn small" onClick={ui.printSchedules}>🖨 Print daily schedules</button>
      </div>

      {!state.employees.length ? (
        <div className="card"><div className="emptystate">
          <div className="big">No employees yet</div>
          <p>Add your EVS staff to start assigning rooms and jobs. Each employee belongs to a shift and gets a capacity bar (assigned minutes vs productive minutes).</p>
          {ui.canEditSchedule && <button className="btn primary" onClick={() => setEmpModal({ emp: null })}>+ Add first employee</button>}
        </div></div>
      ) : (
        <div className="boardgrid">
          <div className="card tray">
            <div className="chead">
              <h2>Unscheduled</h2>
              <span className="sub">{trayRooms.length} rooms · {trayJobs.length} jobs</span>
            </div>
            <div className="cbody">
              {!trayRooms.length && !trayJobs.length && <div className="note">Everything in scope is assigned. 🎉</div>}
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
                      <h3>{sh.name}</h3>
                      <span className="time">{sh.start} – {sh.end}</span>
                      <span className="tot">{emps.length} staff · {fmtHrs(shMin)} assigned</span>
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
                              <div className="nm"><span>{emp.name}</span><span className="role">{emp.role || "EVS Tech"}</span></div>
                            </div>
                            <div className={"capbar" + capCls}><i style={{ width: pct + "%" }} /></div>
                            <div className="capnote">{fmt(assigned, 0)} / {cap} min · {Math.round((assigned / cap) * 100)}%</div>
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
                          Drop here to stage on {sh.name} without an employee (partial)
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
      <div className="chead"><h2>Coverage by area</h2><span className="sub">Who covers each branch of the facility</span></div>
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
                      <b>{d}</b> — {ru.rooms} rooms, {fmtHrs(ru.dailyMin)}/day ·{" "}
                      {who ? `covered by ${who}` : <span style={{ color: "var(--danger)" }}>no one assigned</span>}
                      {ru.unscheduled ? ` · ${ru.unscheduled} unscheduled` : ""}
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
      label: emp ? "Save" : "Add employee", primary: true, onClick: () => {
        if (!name.trim()) { toast("Name is required", true); return; }
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
        toast("Employee removed — their rooms moved to unscheduled");
      }
    }] : []),
    { label: "Cancel", onClick: onClose }
  ];

  return (
    <Modal title={emp ? "Edit employee" : "New employee"} onClose={onClose} buttons={buttons}>
      <div className="field" style={{ marginBottom: 10 }}><label>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. D. Alvarez" /></div>
      <div className="field" style={{ marginBottom: 10 }}><label>Role</label>
        <input type="text" value={role} onChange={(e) => setRole(e.target.value)} /></div>
      <div className="field" style={{ marginBottom: 10 }}><label>Shift</label>
        <select value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
          {state.shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.start}–{s.end})</option>)}
        </select></div>
      <div className="field"><label>Weekly pattern</label>
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
      label: job ? "Save" : "Add job", primary: true, onClick: () => {
        if (!name.trim()) { toast("Job name is required", true); return; }
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
    <Modal title={job ? "Edit non-space job" : "New non-space job"} onClose={onClose} buttons={buttons}>
      <div className="field" style={{ marginBottom: 10 }}><label>Job name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Discharge cleans — 4 West" /></div>
      <div className="field" style={{ marginBottom: 10 }}><label>Type</label>
        <select value={type} onChange={(e) => onTypeChange(e.target.value)}>
          {Object.entries(JOB_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select></div>
      <div className="field" style={{ marginBottom: 10 }}><label>Workload model</label>
        <select value={mode} onChange={(e) => setMode(e.target.value as "block" | "unit")}>
          <option value="unit">Unit-based (count / day × minutes each)</option>
          <option value="block">Time block (fixed minutes / day)</option>
        </select></div>
      {mode === "unit" ? (
        <div className="row" style={{ marginBottom: 10 }}>
          <div className="field"><label>Units / day</label>
            <input type="number" min={0} step={1} value={units} onChange={(e) => setUnits(Number(e.target.value) || 0)} /></div>
          <div className="field"><label>Minutes / unit</label>
            <input type="number" min={0} step={1} value={minsPer} onChange={(e) => setMinsPer(Number(e.target.value) || 0)} /></div>
        </div>
      ) : (
        <div className="field" style={{ marginBottom: 10 }}><label>Minutes / day</label>
          <input type="number" min={0} step={5} value={block} onChange={(e) => setBlock(Number(e.target.value) || 0)} /></div>
      )}
      <div className="field"><label>Shift</label>
        <select value={shiftId} onChange={(e) => setShiftId(e.target.value)}>
          <option value="">(no shift yet)</option>
          {state.shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></div>
      <p className="note" style={{ marginTop: 10 }}>
        Non-space jobs count against employee capacity exactly like room work. Drag the job chip onto an employee on the board.
      </p>
    </Modal>
  );
}
