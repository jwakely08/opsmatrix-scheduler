import { useStore } from "../state/store";
import { rollup, jobDailyMinutes, facilityFTE } from "../lib/compute";
import { fmt, fmtHrs } from "../lib/format";

export function Kpis() {
  const { state } = useStore();
  const all = rollup(state, state.rooms);
  const jobsMin = state.jobs.reduce((s, j) => s + jobDailyMinutes(j), 0);
  const items: [string, string][] = [
    [fmt(all.rooms), "Rooms"],
    [fmt(all.sqft, 0), "Cleanable ft²"],
    [fmtHrs(all.dailyMin + jobsMin), "Daily workload"],
    [facilityFTE(state).toFixed(2), "Staff needed"]
  ];
  return (
    <div className="kpis">
      {items.map(([v, l]) => (
        <div className="kpi" key={l}><div className="v">{v}</div><div className="l">{l}</div></div>
      ))}
    </div>
  );
}
