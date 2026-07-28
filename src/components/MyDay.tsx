import { useStore } from "../state/store";
import { useAuth } from "../auth/AuthContext";
import { roomDailyMinutes, jobDailyMinutes, deptKey, byId } from "../lib/compute";
import { fmt, todayStr } from "../lib/format";

/**
 * Staff view: a read-only "my day". Staff accounts see the schedule for the
 * employee whose name matches their display name (simple pilot-stage link).
 */
export function MyDay() {
  const { state } = useStore();
  const auth = useAuth();

  const me = state.employees.find(
    (e) => e.name.trim().toLowerCase() === auth.displayName.trim().toLowerCase()
  );

  if (!me) {
    return (
      <div className="myday card"><div className="emptystate">
        <div className="big">No schedule linked yet</div>
        <p>
          Ask your supervisor to add you to the board as “{auth.displayName || "your display name"}” —
          your daily schedule will appear here.
        </p>
      </div></div>
    );
  }

  const sh = byId(state.shifts, me.shiftId);
  const rooms = state.rooms.filter((r) => r.employeeId === me.id)
    .sort((a, b) => a.name.localeCompare(b.name));
  const jobs = state.jobs.filter((j) => j.employeeId === me.id);
  const total = rooms.reduce((s, r) => s + roomDailyMinutes(state, r), 0)
    + jobs.reduce((s, j) => s + jobDailyMinutes(j), 0);

  return (
    <div className="myday">
      <h1 className="pagetitle">{me.name} — my day</h1>
      <p className="pagesub">{todayStr()} · {sh ? `${sh.name} ${sh.start}–${sh.end}` : "no shift"} · {fmt(total, 0)} min assigned</p>
      <div className="card"><div className="cbody">
        {rooms.map((r) => {
          const fl = byId(state.floors, r.floorId);
          return (
            <div className="task" key={r.id}>
              <span><b>{r.name}</b> · {(fl?.name ?? "")} / {deptKey(r)}<br />
                <span className="note">{r.tasks.join(", ")}</span></span>
              <span className="mins">{fmt(roomDailyMinutes(state, r), 0)} min</span>
            </div>
          );
        })}
        {jobs.map((j) => (
          <div className="task" key={j.id}>
            <span><b>{j.name}</b><br />
              <span className="note">{j.mode === "unit" ? `${j.unitsPerDay} × ${j.minutesPerUnit} min` : "time block"}</span></span>
            <span className="mins">{fmt(jobDailyMinutes(j), 0)} min</span>
          </div>
        ))}
        {!rooms.length && !jobs.length && <div className="note">Nothing assigned today.</div>}
      </div></div>
    </div>
  );
}
