// The printable daily schedule. Two pages, exactly the format Josh uses:
//   page 1 — the room-by-room running order, with the tasks OpsMatrix says
//            each room needs on THIS schedule
//   page 2 — the same schedule drawn on the real floor plan, so the worker
//            can see their area, with the running order numbered on the rooms
//
// No employee name appears anywhere: any worker can be handed any schedule.
import React, { useMemo } from "react";
import {
  rectifyForDisplay, pathFrom, centroidOf, boundsOf,
  type ClassicPlan, type ClassicSpace, type Priority
} from "./classicStore";
import type { ScheduleDoc } from "./scheduleDoc";

const PRIORITY_CLASS: Record<Priority, string> = { High: "hi", Medium: "med", Low: "lo" };

export function PrintSchedule({ doc, plan, spaces }: {
  doc: ScheduleDoc;
  plan: ClassicPlan | null;
  spaces: ClassicSpace[];
}) {
  return (
    <div className="printdoc">
      <PageOne doc={doc} />
      {plan && <PageTwo doc={doc} plan={plan} spaces={spaces} />}
    </div>
  );
}

/** durations the way a supervisor says them out loud */
function hours(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (!h) return `${m} min`;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

// ── page 1: the running order ───────────────────────────────────────────────

function PageOne({ doc }: { doc: ScheduleDoc }) {
  // rooms and breaks in the order the day actually happens
  const timeline = useMemo(() => {
    const out: ({ kind: "room"; row: ScheduleDoc["rows"][0] } | { kind: "break"; b: ScheduleDoc["breaks"][0] })[] = [];
    for (let i = 0; i <= doc.rows.length; i++) {
      for (const b of doc.breaks) if (b.afterRow === i) out.push({ kind: "break", b });
      if (i < doc.rows.length) out.push({ kind: "room", row: doc.rows[i] });
    }
    return out;
  }, [doc.rows, doc.breaks]);

  return (
    <section className="printpage">
      <header className="pbar">
        <div>
          <h1>DAILY HOUSEKEEPING SCHEDULE</h1>
          <p>Environmental Services · {doc.name}</p>
        </div>
        <div className="pbrand">
          <b>OpsMatrix</b>
          <span>Schedule #{doc.num}</span>
        </div>
      </header>

      <table className="pinfo">
        <thead>
          <tr><th>SHIFT</th><th>HOURS</th><th>DATE</th><th>UNIT</th><th>BUILDING</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>{doc.shift}</td>
            <td>{doc.shiftStart} – {doc.shiftEnd}</td>
            <td>{doc.date}</td>
            <td>{doc.name}</td>
            <td>{doc.building || "—"}{doc.floor ? ` · ${doc.floor}` : ""}</td>
          </tr>
        </tbody>
      </table>

      <SectionBar
        title="ROOM CLEANING — IN ORDER"
        right={`${doc.shiftStart} – ${doc.roomsEnd}`}
      />

      <table className="prooms">
        <thead>
          <tr>
            <th className="c-ord">#</th>
            <th className="c-time">TIME</th>
            <th className="c-num">ROOM #</th>
            <th className="c-name">ROOM NAME</th>
            <th className="c-type">ROOM TYPE</th>
            <th className="c-task">TASKS FOR THIS CLEAN</th>
            <th className="c-pri">PRIORITY</th>
            <th className="c-min">EST. MIN</th>
            <th className="c-done">DONE</th>
          </tr>
        </thead>
        <tbody>
          {timeline.map((item, i) => item.kind === "room"
            ? <RoomRow key={item.row.spaceId} r={item.row} />
            : (
              <tr className="plunch" key={"b" + item.b.id + i}>
                <td colSpan={9}>
                  {item.b.label.toUpperCase()} · {item.b.startTime} – {item.b.endTime} · {item.b.minutes} MIN
                </td>
              </tr>
            ))}
          {!doc.rows.length && (
            <tr><td colSpan={9} className="pempty">
              No rooms on this schedule yet — add them on the map in OpsMatrix.
            </td></tr>
          )}
        </tbody>
      </table>

      {/* The other kind of work: duties that are not tied to a room list, so
          they carry no running order, no clock time and no room columns.
          Deliberately a different shape on the page. */}
      {doc.nonSpace.length > 0 && doc.nonSpaceWindow && (
        <>
          <SectionBar
            duties
            title="ONGOING DUTIES — WORK THIS AROUND YOUR ROOMS"
            right={`${doc.nonSpaceWindow.start} – ${doc.nonSpaceWindow.end}`}
          />
          <div className="pduties">
            {doc.nonSpace.map((t) => (
              <div className="pduty" key={t.id}>
                <i />
                <div>
                  <b>{t.name}</b>
                  {t.linkedRooms.length > 0 && (
                    <span>Rooms: {t.linkedRooms.join(", ")}</span>
                  )}
                </div>
                <em>{hours(t.minutes)}</em>
              </div>
            ))}
          </div>
        </>
      )}

      <SummaryStrip doc={doc} />

      <footer className="pfoot">
        <span>OpsMatrix EVS Management System · For Internal Use Only</span>
        <span>See reverse for your area on the floor plan</span>
        <span>Page 1 of 2 · Schedule #{doc.num} · {doc.shift}</span>
      </footer>
    </section>
  );
}

function RoomRow({ r }: { r: ScheduleDoc["rows"][0] }) {
  return (
    <tr>
      <td className="c-ord"><b>{r.order}</b></td>
      <td className="c-time">{r.startTime}</td>
      <td className="c-num">{r.roomNumber || "—"}</td>
      <td className="c-name">{r.roomName}</td>
      <td className="c-type">{r.roomType || "—"}</td>
      <td className="c-task">
        {r.tasks.length
          ? r.tasks.map((t, i) => <span key={i} className="tchip">{t}</span>)
          : <span className="tnone">No tasks assigned yet — see supervisor</span>}
      </td>
      <td className="c-pri"><span className={"pri " + PRIORITY_CLASS[r.priority]}>{r.priority.toUpperCase()}</span></td>
      <td className="c-min">{r.minutes} min</td>
      <td className="c-done"><i /></td>
    </tr>
  );
}

function SectionBar({ title, right, duties }: { title: string; right: string; duties?: boolean }) {
  return (
    <div className={"psection" + (duties ? " duties" : "")}>
      <span>{title}</span>
      <em>{right}</em>
    </div>
  );
}

function SummaryStrip({ doc }: { doc: ScheduleDoc }) {
  const t = doc.totals;
  return (
    <div className="pstrip">
      <span><b>{t.rooms}</b> rooms</span>
      {t.priority.High > 0 && <span><b>{t.priority.High}</b> high priority</span>}
      {doc.nonSpace.length > 0 && <span><b>{doc.nonSpace.length}</b> ongoing duties</span>}
      {t.breakMinutes > 0 && <span><b>{t.breakMinutes} min</b> breaks</span>}
      <span><b>{hours(t.roomMinutes)}</b> in rooms</span>
      <span className={t.overShift ? "over" : ""}>
        <b>{hours(t.totalMinutes)}</b> of {hours(t.shiftMinutes)} shift
      </span>
    </div>
  );
}

// ── page 2: this schedule drawn on the real floor plan ──────────────────────

function PageTwo({ doc, plan, spaces }: {
  doc: ScheduleDoc;
  plan: ClassicPlan;
  spaces: ClassicSpace[];
}) {
  // the running order, looked up by room, so the map and the list agree
  const orderOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of doc.rows) m.set(r.spaceId, r.order);
    return m;
  }, [doc.rows]);

  const shapes = useMemo(() => spaces
    .filter((sp) => (sp.visualPts?.length ?? 0) >= 3 &&
      (!sp.visualPlanId || sp.visualPlanId === plan.id))
    .map((sp) => {
      const pts = rectifyForDisplay(sp.visualPts!);
      const b = boundsOf(pts);
      return {
        id: sp.id, path: pathFrom(pts), c: centroidOf(pts),
        w: b.maxX - b.minX, h: b.maxY - b.minY,
        label: String(sp.roomNumber ?? sp.roomName ?? ""),
        order: orderOf.get(sp.id) ?? null
      };
    }), [spaces, plan.id, orderOf]);

  const mine = shapes.filter((s) => s.order !== null);
  const badge = Math.max(plan.w, plan.h) / 34;

  return (
    <section className="printpage">
      <header className="pbar">
        <div>
          <h1>YOUR AREA — {doc.name.toUpperCase()}</h1>
          <p>Clean the rooms in the numbered order · Schedule #{doc.num} · {doc.shift}</p>
        </div>
        <div className="pbrand"><b>OpsMatrix</b><span>{doc.date}</span></div>
      </header>

      <div className="pmapbox">
        <div className="pmaphead">
          FLOOR PLAN{doc.building ? ` · ${doc.building.toUpperCase()}` : ""}
          {doc.floor ? ` · ${doc.floor.toUpperCase()}` : ""}
        </div>
        <svg className="pmap" viewBox={`0 0 ${plan.w} ${plan.h}`} preserveAspectRatio="xMidYMid meet">
          {/* every room on the floor, so the worker can place themselves */}
          {shapes.map((s) => (
            <path key={s.id} d={s.path}
              fill={s.order !== null ? doc.color : "#e9eef3"}
              fillOpacity={s.order !== null ? 0.55 : 1}
              stroke={s.order !== null ? doc.color : "#c2ced9"}
              strokeWidth={s.order !== null ? 9 : 5} strokeLinejoin="round" />
          ))}
          <image href={plan.img} width={plan.w} height={plan.h}
            style={{ mixBlendMode: "multiply" }} />
          {/* the running order, numbered right on the rooms */}
          {mine.map((s) => (
            <g key={"n" + s.id}>
              <circle cx={s.c.x} cy={s.c.y} r={badge} fill={doc.color} stroke="#fff" strokeWidth={badge * 0.16} />
              <text x={s.c.x} y={s.c.y} className="pmapnum"
                style={{ fontSize: badge * 1.25 }}>{s.order}</text>
              {s.w > badge * 3.2 && (
                <text x={s.c.x} y={s.c.y + badge * 2.1} className="pmaplbl"
                  style={{ fontSize: badge * 0.82 }}>{s.label}</text>
              )}
            </g>
          ))}
        </svg>
      </div>

      <div className="pmaplegend">
        <span><i style={{ background: doc.color }} />Your rooms — {mine.length} on this schedule</span>
        <span><i style={{ background: "#e9eef3", border: "1px solid #c2ced9" }} />Not on your schedule</span>
        <span><i className="num" style={{ background: doc.color }}>1</i>Clean in this order</span>
      </div>

      <div className="porder">
        <b>YOUR ORDER:</b>
        {doc.rows.map((r) => (
          <span key={r.spaceId}>
            <i style={{ background: doc.color }}>{r.order}</i>{r.roomNumber || r.roomName}
          </span>
        ))}
      </div>

      <SummaryStrip doc={doc} />

      <footer className="pfoot">
        <span>OpsMatrix EVS Management System · For Internal Use Only</span>
        <span>Page 2 of 2 · Schedule #{doc.num}</span>
      </footer>
    </section>
  );
}
