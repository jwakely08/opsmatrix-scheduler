// Max Floor Care — the floor-tech engine, split from Max Schedules on
// purpose: floor crews plan differently (machines, multi-tech runs, project
// nights) and their work shouldn't clutter the cleaning schedules. Two tabs:
//   • Daily Schedules — build machine-priced floor-care schedules on the
//     map or the list, one to four technicians, then SHIP each finished
//     schedule into Max Schedules (where editing redirects back here).
//   • Projects — a live calendar of strip & refinish / extraction work that
//     flows into Max Notes, the Classic calendar and manager reminders.
import React, { useMemo, useRef, useState } from "react";
import {
  type Rules, isCarpet
} from "./rules";
import {
  loadFloorCare, saveFloorCare, floorCareTasks, fcEligible, fcTasksForSpace,
  stopMinutes, fcTiming, shipToSchedules, unship, fcScheduleId, fcScheduledRate,
  FC_SETUP_MINUTES, FC_PRACTICAL_FACTOR, FC_PROJECT_TASKS,
  type FcSchedule, type FcStore, type FcEquip, type FcProject
} from "./floorcare";
import {
  EQUIPMENT, DUST_MOP_SIZES, FLOORCARE_CATEGORY_OF_TASK, brandsFor, modelsFor,
  type FloorCareCategory
} from "./equipment";
import {
  rectifyForDisplay, pathFrom, centroidOf,
  type ClassicData, type ClassicSpace
} from "./classicStore";
import { MapCanvas } from "./MapCanvas";

const fmt = (n: number) => n.toLocaleString();
const uid = (p: string) => p + "-" + Math.random().toString(36).slice(2, 9);
const TECH_COLORS = ["#2dd4bf", "#8b5cf6", "#f59e0b", "#ec4899"];

/**
 * The 8-hour bar (also used by Max Schedules): a visual fill instead of a
 * bare number. Yellow while filling, green in the 7.5–8.1h sweet spot, red
 * past 8.1 hours.
 */
export function HoursBar({ minutes, label }: { minutes: number; label?: string }) {
  const hours = minutes / 60;
  const color = hours > 8.1 ? "#ef4444" : hours >= 7.5 ? "#22c55e" : "#eab308";
  const pct = Math.min(100, (hours / 8) * 100);
  return (
    <div className="fc-hoursbar" aria-label={`${hours.toFixed(1)} hours of 8`}>
      {label && <span className="fc-hourslabel">{label}</span>}
      <span className="fc-hourstrack"><i style={{ width: pct + "%", background: color }} /></span>
      <b style={{ color }}>{hours.toFixed(1)}h</b>
    </div>
  );
}

// ── simple square equipment icons (inline SVG, house style) ────────────────
function EquipIcon({ cat }: { cat: FloorCareCategory }) {
  const stroke = "#2dd4bf";
  const common = { fill: "none", stroke, strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 40 40" className="fc-icon" aria-hidden="true">
      {cat === "machine-scrub" && <>
        <path {...common} d="M8 26h18l3-8h-9l-2-6h-6" />
        <circle {...common} cx="13" cy="30" r="3" /><circle {...common} cx="25" cy="30" r="3" />
        <path {...common} d="M29 18h4v8h-3" /><path {...common} d="M9 33h22" strokeDasharray="2 3" />
      </>}
      {cat === "dust-mop" && <>
        <path {...common} d="M26 6 14 24" />
        <rect {...common} x="6" y="24" width="18" height="5" rx="2" />
        <path {...common} d="M8 33v2M13 33v2M18 33v2M23 33v2" />
      </>}
      {cat === "burnish" && <>
        <path {...common} d="M28 6 18 20" />
        <circle {...common} cx="18" cy="27" r="7" /><circle {...common} cx="18" cy="27" r="2.5" />
        <path {...common} d="M29 27a11 11 0 0 0-3-7" strokeDasharray="2 2.5" />
      </>}
      {cat === "machine-sweep" && <>
        <path {...common} d="M7 25h20l3-7h-8l-2-5h-7" />
        <circle {...common} cx="12" cy="29" r="3.2" /><circle {...common} cx="24" cy="29" r="3.2" />
        <path {...common} d="M28 29h4M6 34c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />
      </>}
      {cat === "machine-carpet" && <>
        <path {...common} d="M9 25h16l3-7h-8l-2-5h-5" />
        <circle {...common} cx="13" cy="29" r="3" /><circle {...common} cx="23" cy="29" r="3" />
        <path {...common} d="M7 34h4M14 34h4M21 34h4M28 34h4" />
        <path {...common} d="M28 15c1-2 3-2 4 0" />
      </>}
    </svg>
  );
}

// ── equipment picker for one task category ─────────────────────────────────
function EquipPicker({ cat, taskLabel, current, onPick, onClear }: {
  cat: FloorCareCategory;
  taskLabel: string;
  current?: FcEquip;
  onPick: (eq: FcEquip) => void;
  onClear: () => void;
}) {
  const [brand, setBrand] = useState("");
  const [customName, setCustomName] = useState("");
  const [customRate, setCustomRate] = useState("");
  const brands = brandsFor(cat);
  const models = brand ? modelsFor(cat, brand) : [];

  return (
    <div className="fc-eqpick">
      <b>{taskLabel} equipment</b>
      {current && (
        <p className="fc-eqcurrent">
          ✓ {current.label} — {fmt(Math.round(current.sqftPerHour))} sq ft/hr
          {current.basis ? ` (${current.basis})` : ""}
          {fcScheduledRate(current) !== current.sqftPerHour
            ? ` · scheduled at ${fmt(Math.round(fcScheduledRate(current)))} — real-world pace`
            : ""}{" "}
          <button className="plink" onClick={onClear}>change</button>
        </p>
      )}
      {!current && cat === "dust-mop" && (
        <div className="fc-eqrow">
          <select defaultValue="" onChange={(e) => {
            const s = DUST_MOP_SIZES.find((x) => x.widthIn === Number(e.target.value));
            if (s) onPick({ label: `${s.widthIn}" dust mop`, sqftPerHour: s.sqftPerHour, basis: "ISSA-style starting rate — editable" });
          }}>
            <option value="" disabled>Dust mop size…</option>
            {DUST_MOP_SIZES.map((s) => (
              <option key={s.widthIn} value={s.widthIn}>{s.widthIn}" — {fmt(s.sqftPerHour)} sq ft/hr</option>
            ))}
          </select>
        </div>
      )}
      {!current && cat !== "dust-mop" && (
        <>
          {brands.length > 0 && (
            <div className="fc-eqrow">
              <select value={brand} onChange={(e) => setBrand(e.target.value)}>
                <option value="">Manufacturer…</option>
                {brands.map((b) => <option key={b}>{b}</option>)}
              </select>
              {brand && (
                <select defaultValue="" onChange={(e) => {
                  const m = models[Number(e.target.value)];
                  if (!m) return;
                  if (m.sqftPerHour) {
                    onPick({ label: `${m.brand} ${m.model}`, sqftPerHour: m.sqftPerHour, basis: m.basis });
                  } else {
                    setCustomName(`${m.brand} ${m.model}`);
                  }
                }}>
                  <option value="" disabled>Model…</option>
                  {models.map((m, i) => (
                    <option key={i} value={i}>
                      {m.model} · {m.pathIn}{m.sqftPerHour ? ` · ${fmt(m.sqftPerHour)} sq ft/hr` : " · rate not published"}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
          {brands.length === 0 && (
            <p className="pnote">No manufacturer sheet loaded for this category yet — enter your machine below and its rate is used.</p>
          )}
          <div className="fc-eqrow">
            <input placeholder="Custom machine name" value={customName} onChange={(e) => setCustomName(e.target.value)} />
            <input placeholder="sq ft per hour" type="number" min={100} value={customRate}
              onChange={(e) => setCustomRate(e.target.value)} />
            <button className="pbtn small" disabled={!customName.trim() || !(Number(customRate) > 0)}
              onClick={() => onPick({ label: customName.trim(), sqftPerHour: Number(customRate), basis: "custom" })}>
              Use it
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── the app ────────────────────────────────────────────────────────────────
type FcTab = "daily" | "projects";

export function FloorCareApp({ data, rules, commit }: {
  data: ClassicData;
  rules: Rules;
  commit: (mut: (d: ClassicData) => void) => void;
}) {
  const [tab, setTab] = useState<FcTab>("daily");
  const [store, setStore] = useState<FcStore>(() => loadFloorCare());
  const [justShipped, setJustShipped] = useState<string | null>(null);
  const [editing, setEditing] = useState<FcSchedule | null>(() => {
    const m = /[?&]fc=([a-z0-9-]+)/i.exec(window.location.search + window.location.hash);
    if (!m) return null;
    const fc = loadFloorCare().schedules.find((s) => s.id === m[1]);
    return fc ? JSON.parse(JSON.stringify(fc)) : null;
  });

  const commitStore = (next: FcStore) => { setStore(next); saveFloorCare(next); };

  return (
    <div className="pro-list wi fc">
      <nav className="ptabs wi-tabs">
        <button className={tab === "daily" ? "on" : ""} onClick={() => setTab("daily")}>Daily Schedules</button>
        <button className={tab === "projects" ? "on" : ""} onClick={() => setTab("projects")}>Projects</button>
      </nav>
      {tab === "daily" && !editing && (
        <DailyList data={data} rules={rules} store={store} commitStore={commitStore} commit={commit}
          justShipped={justShipped}
          onEdit={(fc) => { setJustShipped(null); setEditing(JSON.parse(JSON.stringify(fc))); }}
          onNew={() => {
            setJustShipped(null);
            setEditing({
              id: uid("fc"), name: "", shift: "3rd Shift",
              techs: [{ key: "T1" }], equipment: {}, stops: [],
              createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
            });
          }} />
      )}
      {tab === "daily" && editing && (
        <Builder data={data} rules={rules} fc={editing} setFc={setEditing}
          onCancel={() => setEditing(null)}
          onConfirm={(fc) => {
            // link BEFORE the ship: React runs the commit mutator later than
            // it reads, and the floor-care store must never save unlinked
            const shipped = { ...fc, linkedScheduleId: fcScheduleId(fc) };
            commit((d) => { shipToSchedules(d, rules, { ...shipped }); });
            commitStore({ ...store, schedules: [...store.schedules.filter((s) => s.id !== fc.id), shipped] });
            setEditing(null);
            setJustShipped(shipped.name);
          }} />
      )}
      {tab === "projects" && (
        <Projects data={data} store={store} commitStore={commitStore} commit={commit} />
      )}
    </div>
  );
}

// ── daily schedules list ───────────────────────────────────────────────────
function DailyList({ data, rules, store, commitStore, commit, onEdit, onNew, justShipped }: {
  data: ClassicData; rules: Rules; store: FcStore;
  commitStore: (s: FcStore) => void;
  commit: (mut: (d: ClassicData) => void) => void;
  onEdit: (fc: FcSchedule) => void;
  onNew: () => void;
  justShipped: string | null;
}) {
  const spaces = data.v7.spaces ?? [];
  return (
    <div className="wi-body">
      {justShipped !== null && (
        <p className="pnote shipped">
          ✓ <b>{justShipped || "Your floor-care schedule"}</b> is now in Max Schedules — it prints
          and reports like any other schedule, and editing it brings you back here.{" "}
          <a className="plink" href="./maps.html">Open Max Schedules</a>
        </p>
      )}
      <div className="prow">
        <button className="pbtn primary" onClick={onNew}>＋ Build Floor Care Schedule</button>
      </div>
      {store.schedules.length === 0 && (
        <p className="pnote">
          No floor-care schedules yet. Build one here — pick the machines, the
          technicians, and tap the rooms in running order. When you confirm it,
          it ships into Max Schedules as a finished schedule.
        </p>
      )}
      {store.schedules.map((fc) => {
        const t = fcTiming(rules, spaces, fc);
        return (
          <div key={fc.id} className="schedcard fc-card">
            <div className="schedhead">
              <b>{fc.name || "Unnamed floor-care schedule"}</b>
              <span>{fc.shift} · {fc.techs.length} technician{fc.techs.length > 1 ? "s" : ""} · {fc.stops.length} stops</span>
              <span className="schedacts">
                <button className="pbtn small primary" onClick={() => onEdit(fc)}>✏ Edit</button>
                <button className="pbtn small danger" onClick={() => {
                  if (!confirm(`Delete floor-care schedule "${fc.name}"? Its schedule in Max Schedules is removed too.`)) return;
                  commit((d) => unship(d, fc));
                  commitStore({ ...store, schedules: store.schedules.filter((s) => s.id !== fc.id) });
                }}>✕</button>
              </span>
            </div>
            <div className="fc-cardbody">
              {Object.entries(fc.equipment).map(([taskId, eq]) => (
                <span key={taskId} className="ptask">{taskLabel(rules, taskId)}: {eq.label}</span>
              ))}
              {fc.techs.map((tech, i) => (
                <HoursBar key={tech.key} label={tech.name || `Tech ${i + 1}`} minutes={t.perTech[tech.key] ?? 0} />
              ))}
              {fc.techs.length > 1 && <HoursBar label="All technicians" minutes={t.total} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function taskLabel(rules: Rules, id: string): string {
  return rules.tasks.find((t) => t.id === id)?.label ?? id;
}

// ── the builder ────────────────────────────────────────────────────────────
function Builder({ data, rules, fc, setFc, onCancel, onConfirm }: {
  data: ClassicData; rules: Rules;
  fc: FcSchedule;
  setFc: (fc: FcSchedule) => void;
  onCancel: () => void;
  onConfirm: (fc: FcSchedule) => void;
}) {
  const spaces = data.v7.spaces ?? [];
  const employees = data.v7.employees ?? [];
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [activeTech, setActiveTech] = useState(fc.techs[0]?.key ?? "T1");
  const [taskFilter, setTaskFilter] = useState("");
  const [q, setQ] = useState("");
  const [confirmErr, setConfirmErr] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  const fcTasks = floorCareTasks(rules);
  const eligible = useMemo(() => spaces.filter((sp) => fcEligible(rules, sp)), [spaces, rules]);
  const timing = fcTiming(rules, spaces, fc);

  // ── map picking (Josh, 2026-08-28): the same map as Max Schedules, but only
  // rooms with floor-care work are selectable — everything else is greyed out
  const plans = data.plans ?? [];
  const [planId, setPlanId] = useState<string | null>(plans[0]?.id ?? null);
  const plan = plans.find((p) => p.id === planId) ?? plans[0] ?? null;
  const [pickMode, setPickMode] = useState<"map" | "list">(() =>
    plans.length && spaces.some((sp) => fcEligible(rules, sp) && (sp.visualPts?.length ?? 0) >= 3) ? "map" : "list");
  const [pickRoom, setPickRoom] = useState<ClassicSpace | null>(null);
  const mapSpaces = useMemo(
    () => (plan ? spaces.filter((sp) => sp.visualPlanId === plan.id || !sp.visualPlanId) : []),
    [spaces, plan]);
  const shapes = useMemo(() => {
    const out = new Map<string, { pts: { x: number; y: number }[]; path: string; c: { x: number; y: number } }>();
    for (const sp of mapSpaces) {
      if (!sp.visualPts || sp.visualPts.length < 3) continue;
      const pts = rectifyForDisplay(sp.visualPts);
      out.set(sp.id, { pts, path: pathFrom(pts), c: centroidOf(pts) });
    }
    return out;
  }, [mapSpaces]);
  const eligibleIds = useMemo(() => new Set(eligible.map((sp) => sp.id)), [eligible]);
  const techColorOf = (spaceId: string): string | null => {
    const stop = fc.stops.find((s) => s.spaceId === spaceId);
    if (!stop) return null;
    const i = fc.techs.findIndex((t) => t.key === stop.techKey);
    return TECH_COLORS[i] ?? TECH_COLORS[0];
  };

  const scheduledCount = (spaceId: string) => fc.stops.filter((s) => s.spaceId === spaceId).length;
  const leftForFilter = taskFilter
    ? eligible.filter((sp) => fcTasksForSpace(rules, sp).includes(taskFilter) &&
      !fc.stops.some((s) => s.spaceId === sp.id && s.taskId === taskFilter)).length
    : eligible.filter((sp) => scheduledCount(sp.id) === 0).length;

  const patch = (p: Partial<FcSchedule>) => setFc({ ...fc, ...p, updatedAt: new Date().toISOString() });
  const setTechCount = (n: number) => {
    const techs = Array.from({ length: n }, (_, i) =>
      fc.techs[i] ?? { key: "T" + (i + 1) });
    patch({ techs, stops: fc.stops.filter((s) => techs.some((t) => t.key === s.techKey)) });
    if (!techs.some((t) => t.key === activeTech)) setActiveTech(techs[0].key);
  };
  const addStop = (spaceId: string, taskId: string) =>
    patch({ stops: [...fc.stops, { spaceId, taskId, techKey: activeTech }] });
  const removeStop = (i: number) =>
    patch({ stops: fc.stops.filter((_, j) => j !== i) });

  const rooms = eligible
    .filter((sp) => !taskFilter || fcTasksForSpace(rules, sp).includes(taskFilter))
    .filter((sp) => !q || `${sp.roomNumber} ${sp.roomName} ${sp.floor} ${sp.department}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="fc-builder">
      <div className="fc-main">
        <div className="prow">
          <label className="pfield grow">Schedule name
            <input ref={nameRef} value={fc.name} placeholder="e.g. Night Floor Crew — Main"
              onChange={(e) => { setConfirmErr(""); patch({ name: e.target.value }); }} />
          </label>
          <label className="pfield">Shift
            <select value={fc.shift} onChange={(e) => patch({ shift: e.target.value })}>
              <option>1st Shift</option><option>2nd Shift</option><option>3rd Shift</option>
            </select>
          </label>
          <label className="pfield">Technicians
            <select value={fc.techs.length} onChange={(e) => setTechCount(Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>

        <div className="fc-techs">
          {fc.techs.map((t, i) => (
            <label key={t.key} className="pfield">
              <span style={{ color: TECH_COLORS[i] }}>● Tech {i + 1}</span>
              <select value={t.employeeId ?? ""} onChange={(e) => {
                const emp = employees.find((x) => x.id === e.target.value);
                const techs = fc.techs.map((x) => x.key === t.key
                  ? { ...x, employeeId: emp?.id, name: emp ? String(emp.displayName ?? "") : undefined }
                  : x);
                patch({ techs });
              }}>
                <option value="">— assign employee later —</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{String(e.displayName ?? "")}</option>)}
              </select>
            </label>
          ))}
        </div>

        <h3 className="fc-h">Select equipment <small>the machine's manufacturer rate prices its task on this schedule.
          Every stop includes {FC_SETUP_MINUTES} minutes of setup, and a maker's "maximum" speed is scheduled
          at {Math.round(FC_PRACTICAL_FACTOR * 100)}% — the pace a crew really holds.</small></h3>
        <div className="fc-eqtiles">
          {fcTasks.map((t) => {
            const cat = FLOORCARE_CATEGORY_OF_TASK[t.id];
            const eq = fc.equipment[t.id];
            return (
              <button key={t.id} className={"fc-tile" + (eq ? " has" : "") + (openCat === t.id ? " open" : "")}
                onClick={() => setOpenCat(openCat === t.id ? null : t.id)}>
                <EquipIcon cat={cat} />
                <b>{t.label}</b>
                <small>{eq ? eq.label : "Scope rate — tap to pick a machine"}</small>
              </button>
            );
          })}
        </div>
        {openCat && (
          <EquipPicker
            cat={FLOORCARE_CATEGORY_OF_TASK[openCat]}
            taskLabel={taskLabel(rules, openCat)}
            current={fc.equipment[openCat]}
            onPick={(eq) => { patch({ equipment: { ...fc.equipment, [openCat]: eq } }); setOpenCat(null); }}
            onClear={() => {
              const next = { ...fc.equipment };
              delete next[openCat];
              patch({ equipment: next });
            }} />
        )}

        <h3 className="fc-h">
          Tap rooms in running order
          <small>{leftForFilter} room{leftForFilter === 1 ? "" : "s"} still unscheduled{taskFilter ? ` for ${taskLabel(rules, taskFilter)}` : ""}</small>
        </h3>
        <div className="wi-toolbar">
          <span className="psel">For:
            {fc.techs.map((t, i) => (
              <button key={t.key} className={"pbtn small" + (activeTech === t.key ? " on" : "")}
                style={activeTech === t.key ? { background: TECH_COLORS[i], borderColor: TECH_COLORS[i] } : { color: TECH_COLORS[i] }}
                onClick={() => setActiveTech(t.key)}>
                {t.name || `Tech ${i + 1}`}
              </button>
            ))}
          </span>
          <select value={taskFilter} onChange={(e) => setTaskFilter(e.target.value)}>
            <option value="">All floor-care tasks</option>
            {fcTasks.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          {plans.length > 0 && (
            <nav className="ptabs">
              <button className={pickMode === "map" ? "on" : ""} onClick={() => setPickMode("map")}>🗺 Map</button>
              <button className={pickMode === "list" ? "on" : ""} onClick={() => setPickMode("list")}>☰ List</button>
            </nav>
          )}
          {pickMode === "list" && (
            <input className="wi-search" placeholder="Search rooms…" value={q} onChange={(e) => setQ(e.target.value)} />
          )}
        </div>

        {pickMode === "map" && plan && (
          <div className="fc-mapwrap">
            <MapCanvas
              plan={plan} plans={plans} onPlan={setPlanId}
              spaces={mapSpaces} shapes={shapes}
              mode="floorcare"
              fillFor={(sp) => {
                if (!eligibleIds.has(sp.id)) return "#33404d"; // no floor-care work — not selectable
                return techColorOf(sp.id) ?? "#475569";
              }}
              selectedId={pickRoom?.id ?? null}
              onRoom={(sp) => {
                if (!sp) { setPickRoom(null); return; }
                if (!eligibleIds.has(sp.id)) return; // greyed-out rooms don't react
                const options = fcTasksForSpace(rules, sp).filter((id) => !taskFilter || id === taskFilter);
                if (options.length === 1) { addStop(sp.id, options[0]); return; }
                setPickRoom(sp);
              }}
              legend={
                <div className="pro-legend">
                  {fc.techs.map((t, i) => (
                    <span key={t.key}><i style={{ background: TECH_COLORS[i] }} />{t.name || `Tech ${i + 1}`}</span>
                  ))}
                  <span><i style={{ background: "#475569" }} />Has floor-care work</span>
                  <span><i style={{ background: "#33404d" }} />No floor-care work (not selectable)</span>
                </div>
              }
            />
            {pickRoom && (
              <div className="fc-mappick">
                <b>{String(pickRoom.roomNumber ?? "")} {String(pickRoom.roomName ?? "")}</b>
                {fcTasksForSpace(rules, pickRoom)
                  .filter((id) => !taskFilter || id === taskFilter)
                  .map((id) => (
                    <button key={id} className="pbtn small" onClick={() => { addStop(pickRoom.id, id); setPickRoom(null); }}>
                      + {taskLabel(rules, id)} · {stopMinutes(rules, pickRoom, id, fc.equipment)}m
                    </button>
                  ))}
                <button className="pbtn small ghost" onClick={() => setPickRoom(null)}>✕</button>
              </div>
            )}
          </div>
        )}

        {pickMode === "map" && (
          <p className="pnote">Tap a colored room to add it as the next stop for the selected technician. Rooms are numbered in the order you tap.</p>
        )}

        {pickMode === "list" && <div className="fc-rooms">
          {rooms.map((sp) => {
            const options = fcTasksForSpace(rules, sp).filter((id) => !taskFilter || id === taskFilter);
            const n = scheduledCount(sp.id);
            return (
              <div key={sp.id} className={"fc-room" + (n ? " scheduled" : "")}>
                <b>{String(sp.roomNumber ?? "")}</b>
                <span className="fc-roominfo">
                  {String(sp.roomName ?? "")} · {String(sp.floor ?? "")}{isCarpet(sp.floorType) ? " · carpet" : ""} · {fmt(Number(sp.squareFeet) || 0)} sq ft
                  {n > 0 && <em> · {n} stop{n > 1 ? "s" : ""}</em>}
                </span>
                <span className="fc-roomtasks">
                  {options.map((id) => (
                    <button key={id} className="pbtn small"
                      onClick={() => addStop(sp.id, id)}>
                      + {taskLabel(rules, id)} · {stopMinutes(rules, sp, id, fc.equipment)}m
                    </button>
                  ))}
                </span>
              </div>
            );
          })}
          {!rooms.length && <p className="pnote">
            No rooms with floor-care work match. A room shows up here when its room type comes with a
            floor-care task in Scope (corridors and hallways come with Machine Scrubbing and Dust
            Mopping), or when you add a floor-care task to that room yourself in Max Space.
          </p>}
        </div>}
      </div>

      <aside className="fc-rail">
        <h3 className="fc-h">This schedule</h3>
        {fc.techs.map((t, i) => (
          <HoursBar key={t.key} label={t.name || `Tech ${i + 1}`} minutes={timing.perTech[t.key] ?? 0} />
        ))}
        {fc.techs.length > 1 && <HoursBar label="All technicians" minutes={timing.total} />}
        <div className="fc-stops">
          {fc.stops.map((s, i) => {
            const sp = spaces.find((x) => x.id === s.spaceId);
            const ti = fc.techs.findIndex((t) => t.key === s.techKey);
            return (
              <div key={i} className="fc-stop">
                <span className="ordnum">{i + 1}</span>
                <i style={{ background: TECH_COLORS[ti] ?? "#64748b" }} />
                <b>{String(sp?.roomNumber ?? "?")}</b>
                <span>{taskLabel(rules, s.taskId)}</span>
                <em>{sp ? stopMinutes(rules, sp, s.taskId, fc.equipment) : 0}m</em>
                <button className="pbtn small ghost" onClick={() => removeStop(i)}>✕</button>
              </div>
            );
          })}
          {!fc.stops.length && <p className="pnote">Tap a task on a room to add the first stop.</p>}
        </div>
        <div className="fc-railacts">
          {/* never silently disabled: a manager who taps it always learns
              what is missing (the old greyed-out button read as "broken") */}
          <button className="pbtn primary wide"
            onClick={() => {
              if (!fc.name.trim()) {
                setConfirmErr("Give this schedule a name first — the box at the top left.");
                nameRef.current?.focus();
                return;
              }
              if (!fc.stops.length) {
                setConfirmErr("Tap at least one room task first — the schedule is still empty.");
                return;
              }
              onConfirm(fc);
            }}>
            ✓ Confirm — ship to Max Schedules
          </button>
          {confirmErr && <p className="warntext">⚠ {confirmErr}</p>}
          <button className="pbtn ghost wide" onClick={onCancel}>Cancel</button>
        </div>
      </aside>
    </div>
  );
}

// ── projects calendar ──────────────────────────────────────────────────────
function Projects({ data, store, commitStore, commit }: {
  data: ClassicData; store: FcStore;
  commitStore: (s: FcStore) => void;
  commit: (mut: (d: ClassicData) => void) => void;
}) {
  const spaces = data.v7.spaces ?? [];
  const [month, setMonth] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [draft, setDraft] = useState<null | {
    task: string; hours: number; team: number; note: string;
    building: string; floor: string; department: string; spaceId: string;
  }>(null);
  const [placing, setPlacing] = useState<null | typeof draft>(null);

  const first = new Date(month.y, month.m, 1);
  const startDow = first.getDay();
  const daysIn = new Date(month.y, month.m + 1, 0).getDate();
  const dateStr = (day: number) =>
    `${month.y}-${String(month.m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const monthName = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const buildings = [...new Set(spaces.map((s) => String(s.building ?? "").trim()).filter(Boolean))];
  const opts = (f: (sp: ClassicSpace) => string, pred: (sp: ClassicSpace) => boolean) =>
    [...new Set(spaces.filter(pred).map((sp) => f(sp).trim()).filter(Boolean))];

  const placeOn = (day: number) => {
    if (!placing) return;
    const sp = spaces.find((s) => s.id === placing.spaceId);
    const date = dateStr(day);
    const manHours = placing.hours * placing.team;
    const noteId = uid("fcnote");
    const project: FcProject = {
      id: uid("fcp"), task: placing.task, date, hours: placing.hours,
      teamMembers: placing.team, manHours,
      spaceId: sp?.id, location: sp ? `${sp.roomNumber ?? ""} ${sp.roomName ?? ""}`.trim() : "",
      note: placing.note, noteId, createdAt: new Date().toISOString()
    };
    // route it into Max Notes as a real project note — Classic then creates
    // the project schedule, the calendar entry and the manager reminders
    commit((d) => {
      const notes = (d.v7.notes as unknown[] | undefined) ?? (d.v7.notes = [] as unknown[]);
      (notes as Record<string, unknown>[]).push({
        id: noteId, date: new Date().toLocaleDateString(),
        title: `Floor care — ${placing.task}${project.location ? " · " + project.location : ""}`,
        body: `${placing.task}. ${placing.team} team member${placing.team > 1 ? "s" : ""} × ${placing.hours}h = ${manHours} man-hours.` +
          (placing.note ? ` ${placing.note}` : ""),
        linkedSpaceId: sp?.id ?? "", linkedScheduleId: "", linkedEmployeeId: "",
        tags: ["Project"], kind: "project", isProject: true,
        projectDate: date, projectTime: "", projectDuration: String(placing.hours * 60),
        projectPriority: "medium", projectStatus: "scheduled",
        readAt: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      });
    });
    commitStore({ ...store, projects: [...store.projects, project] });
    setPlacing(null);
  };

  return (
    <div className="wi-body">
      <div className="wi-toolbar">
        <button className="pbtn small" onClick={() => setMonth(({ y, m }) => m ? { y, m: m - 1 } : { y: y - 1, m: 11 })}>‹</button>
        <b className="fc-month">{monthName}</b>
        <button className="pbtn small" onClick={() => setMonth(({ y, m }) => m < 11 ? { y, m: m + 1 } : { y: y + 1, m: 0 })}>›</button>
        <span className="grow" />
        {placing
          ? <span className="linkhint">📌 Now click the date for this {placing.task.toLowerCase()} project
            <button className="pbtn small" onClick={() => setPlacing(null)}>Cancel</button></span>
          : <button className="pbtn primary" onClick={() => setDraft({
            task: FC_PROJECT_TASKS[0], hours: 4, team: 2, note: "",
            building: "", floor: "", department: "", spaceId: ""
          })}>＋ Add Project</button>}
      </div>

      <div className="fc-cal">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="fc-caldow">{d}</div>)}
        {Array.from({ length: startDow }, (_, i) => <div key={"e" + i} className="fc-calday empty" />)}
        {Array.from({ length: daysIn }, (_, i) => {
          const day = i + 1;
          const todays = store.projects.filter((p) => p.date === dateStr(day));
          return (
            <div key={day} className={"fc-calday" + (placing ? " placeable" : "")}
              onClick={() => placeOn(day)}>
              <span className="fc-caldate">{day}</span>
              {todays.map((p) => (
                <div key={p.id} className="fc-proj" onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Remove project "${p.task}${p.location ? " · " + p.location : ""}"?`)) {
                    commit((d) => {
                      d.v7.notes = ((d.v7.notes as { id: string }[] | undefined) ?? []).filter((n) => n.id !== p.noteId);
                    });
                    commitStore({ ...store, projects: store.projects.filter((x) => x.id !== p.id) });
                  }
                }}>
                  <b>{p.task}</b>
                  <span>{p.location || "no room"} · {p.teamMembers}×{p.hours}h = {p.manHours} man-hrs</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {draft && (
        <div className="pro-modalback" onClick={(e) => { if (e.target === e.currentTarget) setDraft(null); }}>
          <div className="pro-modal">
            <div className="pshead"><h2>New floor-care project</h2>
              <button className="pbtn ghost" onClick={() => setDraft(null)}>✕</button></div>
            <label className="pfield">Task
              <select value={draft.task} onChange={(e) => setDraft({ ...draft, task: e.target.value })}>
                {FC_PROJECT_TASKS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <div className="prow">
              <label className="pfield">Estimated hours
                <select value={draft.hours} onChange={(e) => setDraft({ ...draft, hours: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="pfield">Team members
                <select value={draft.team} onChange={(e) => setDraft({ ...draft, team: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
            <p className="pnote big">= {draft.hours * draft.team} man-hours of production recorded</p>
            <label className="pfield">Notes <small>optional</small>
              <input value={draft.note} placeholder="chemicals, prep, access…"
                onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
            </label>
            <h3 className="fc-h">Location <small>any room — projects aren't limited to floor-care rooms</small></h3>
            <div className="prow">
              <select value={draft.building} onChange={(e) => setDraft({ ...draft, building: e.target.value, floor: "", department: "", spaceId: "" })}>
                <option value="">Building…</option>
                {buildings.map((b) => <option key={b}>{b}</option>)}
              </select>
              <select value={draft.floor} onChange={(e) => setDraft({ ...draft, floor: e.target.value, department: "", spaceId: "" })}>
                <option value="">Floor…</option>
                {opts((sp) => String(sp.floor ?? ""), (sp) => !draft.building || String(sp.building ?? "").trim() === draft.building)
                  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                  .map((f) => <option key={f}>{f}</option>)}
              </select>
              <select value={draft.spaceId} onChange={(e) => setDraft({ ...draft, spaceId: e.target.value })}>
                <option value="">Room…</option>
                {spaces
                  .filter((sp) => (!draft.building || String(sp.building ?? "").trim() === draft.building) &&
                    (!draft.floor || String(sp.floor ?? "").trim() === draft.floor))
                  .slice(0, 400)
                  .map((sp) => <option key={sp.id} value={sp.id}>{String(sp.roomNumber ?? "")} {String(sp.roomName ?? "")}</option>)}
              </select>
            </div>
            <button className="pbtn primary wide" onClick={() => { setPlacing(draft); setDraft(null); }}>
              Save — then pick the date on the calendar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
