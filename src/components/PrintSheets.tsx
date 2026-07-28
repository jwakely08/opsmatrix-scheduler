import { useStore } from "../state/store";
import { roomDailyMinutes, jobDailyMinutes, deptKey, byId } from "../lib/compute";
import { fmt, todayStr } from "../lib/format";

const JOB_TYPE_LABELS: Record<string, string> = {
  discharge: "Discharge / bed cleans", porter: "Porter / transport", trashlinen: "Trash & linen run",
  laundry: "Laundry", floortech: "Floor tech", custom: "Custom"
};

/** printable daily schedule, one page per employee (rendered into #printsheet for @media print) */
export function PrintSheets() {
  const { state } = useStore();
  return (
    <div id="printsheet" style={{ display: "block" }}>
      {state.employees.map((emp) => {
        const sh = byId(state.shifts, emp.shiftId);
        const rooms = state.rooms
          .filter((r) => r.employeeId === emp.id)
          .sort((a, b) => {
            const fa = byId(state.floors, a.floorId), fb = byId(state.floors, b.floorId);
            return ((fa?.name ?? "") + deptKey(a) + a.name).localeCompare((fb?.name ?? "") + deptKey(b) + b.name);
          });
        const jobs = state.jobs.filter((j) => j.employeeId === emp.id);
        const total = rooms.reduce((s, r) => s + roomDailyMinutes(state, r), 0)
          + jobs.reduce((s, j) => s + jobDailyMinutes(j), 0);
        return (
          <div className="psheet" key={emp.id}>
            <h2>{emp.name} — Daily Schedule</h2>
            <div className="meta">
              {todayStr()} · {sh ? `${sh.name} ${sh.start}–${sh.end}` : "no shift"} · {emp.role || "EVS Tech"}
            </div>
            <table>
              <thead><tr><th>✓</th><th>Location</th><th>Room / job</th><th>Tasks</th><th>Min</th></tr></thead>
              <tbody>
                {rooms.map((r) => {
                  const fl = byId(state.floors, r.floorId);
                  return (
                    <tr key={r.id}>
                      <td style={{ width: 26, textAlign: "center" }}>☐</td>
                      <td>{(fl?.name ?? "") + " / " + deptKey(r)}</td>
                      <td>{r.name}  ({r.roomType})</td>
                      <td>{r.tasks.join(", ")}</td>
                      <td className="num">{fmt(roomDailyMinutes(state, r), 0)}</td>
                    </tr>
                  );
                })}
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td style={{ width: 26, textAlign: "center" }}>☐</td>
                    <td>—</td>
                    <td>{j.name}</td>
                    <td>{(JOB_TYPE_LABELS[j.type] ?? j.type) + (j.mode === "unit" ? ` — ${j.unitsPerDay} × ${j.minutesPerUnit} min` : "")}</td>
                    <td className="num">{fmt(jobDailyMinutes(j), 0)}</td>
                  </tr>
                ))}
                {!rooms.length && !jobs.length && (
                  <tr><td colSpan={5}>Nothing assigned.</td></tr>
                )}
              </tbody>
              <tfoot><tr>
                <td colSpan={4} style={{ fontWeight: 700 }}>Total assigned</td>
                <td className="num" style={{ fontWeight: 700 }}>{fmt(total, 0)} / {state.rates.productiveMinutes}</td>
              </tr></tfoot>
            </table>
            <div className="sig">
              <span>Employee signature</span>
              <span>Supervisor</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
