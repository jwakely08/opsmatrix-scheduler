// MAX POLICING — the day-porter engine (Josh's spec, 2026-08-31: "build out
// the shell of that with those primers until I can grind down exactly what I
// want"). Same vein as Max Floor Care and Max Sanitation: pick the building,
// then only the public spaces a porter actually polices are selectable —
// lobbies, restrooms, waiting rooms and corridors — and only their NON
// floor-care tasks are offered. Passes accumulate; ship sends the finished
// round into Max Schedules.
//
// PRIMERS IN PLACE, spec pending: which rooms qualify (routes.ts →
// POLICE_TYPES), what a pass costs (policeStopMinutes), and how many times a
// day each space is policed (the ×N control below). Josh will pin down the
// frequency model, cart stocking and coverage windows.
import React, { useMemo, useRef, useState } from "react";
import type { Rules } from "./rules";
import {
  rectifyForDisplay, pathFrom, centroidOf,
  type ClassicData, type ClassicSpace
} from "./classicStore";
import {
  MapCanvas, BuildingPicker, BuildingBadge, planBuilding, planBuildings,
  loadMapBuilding, saveMapBuilding
} from "./MapCanvas";
import { HoursBar } from "./FloorCareApp";
import {
  loadRoutes, saveRoutes, isPoliceable, policeTasks, policeStopMinutes,
  shipPolicing, unshipRoute,
  type PoliceRoute, type RouteStore
} from "./routes";

const uid = (p: string) => p + "-" + Math.random().toString(36).slice(2, 9);

function freshRoute(building: string, planId: string): PoliceRoute {
  return {
    id: uid("pol"), name: "", shift: "1st Shift",
    building, planId, stops: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
}

export function PolicingApp({ data, rules, commit }: {
  data: ClassicData;
  rules: Rules;
  commit: (mut: (d: ClassicData) => void) => void;
}) {
  const spaces = data.v7.spaces ?? [];
  const plans = data.plans ?? [];
  const buildings = planBuildings(plans);
  const [building, setBuilding] = useState<string | null>(() => loadMapBuilding());
  const activeBuilding = buildings.length <= 1
    ? (buildings[0] ?? "")
    : (building !== null && buildings.includes(building) ? building : null);
  const needsBuilding = buildings.length > 1 && activeBuilding === null;
  const bPlans = activeBuilding === null ? [] : plans.filter((p) => planBuilding(p) === activeBuilding);
  const [planId, setPlanId] = useState<string | null>(null);
  const plan = bPlans.find((p) => p.id === planId) ?? bPlans[0] ?? null;

  const [store, setStore] = useState<RouteStore>(() => loadRoutes());
  const [route, setRoute] = useState<PoliceRoute | null>(null);
  const [pickRoom, setPickRoom] = useState<ClassicSpace | null>(null);
  const [justShipped, setJustShipped] = useState("");
  const [err, setErr] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const commitStore = (next: RouteStore) => { setStore(next); saveRoutes(next); };

  const chooseBuilding = (b: string | null) => {
    setBuilding(b);
    saveMapBuilding(b);
    setPlanId(null);
    setPickRoom(null);
  };

  const active: PoliceRoute | null = route ?? (plan ? freshRoute(activeBuilding ?? "", plan.id) : null);
  if (active && !route && plan) setRoute(active);

  const patch = (p: Partial<PoliceRoute>) =>
    setRoute((r) => (r ? { ...r, ...p, updatedAt: new Date().toISOString() } : r));

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

  const eligibleIds = useMemo(
    () => new Set(mapSpaces.filter((sp) => isPoliceable(rules, sp)).map((sp) => sp.id)),
    [mapSpaces, rules]);
  const taskIds = useMemo(() => policeTasks(rules), [rules]);
  const labelOf = (id: string) => rules.tasks.find((t) => t.id === id)?.label ?? id;

  const total = (active?.stops ?? []).reduce((s, st) => {
    const sp = spaces.find((x) => x.id === st.spaceId);
    return sp ? s + policeStopMinutes(rules, sp, st.taskId) : s;
  }, 0);

  const ship = () => {
    if (!active) return;
    if (!active.name.trim()) {
      setErr("Give the round a name first — the box at the top left.");
      nameRef.current?.focus();
      return;
    }
    if (!active.stops.length) { setErr("Tap a space and pick at least one task."); return; }
    const shipped: PoliceRoute = { ...active, planId: plan?.id ?? active.planId, building: activeBuilding ?? "" };
    commit((d) => { shipPolicing(d, rules, shipped); });
    commitStore({ ...store, policing: [...store.policing.filter((r) => r.id !== shipped.id), shipped] });
    setRoute(null);
    setErr("");
    setJustShipped(shipped.name);
  };

  if (needsBuilding) {
    return (
      <div className="pro-list wi">
        <BuildingPicker plans={plans} spaces={spaces} onPick={(b) => chooseBuilding(b)}
          note="Pick the building whose public spaces this porter rounds." />
      </div>
    );
  }

  return (
    <div className="pro-list wi fc">
      <p className="pnote">
        The porter round: lobbies, restrooms, waiting rooms and corridors, checked and touched up
        through the day. Floor-care work never appears here — that's Max Floor Care's.
      </p>
      {justShipped && (
        <p className="pnote shipped">
          ✓ <b>{justShipped}</b> is in Max Schedules as a finished porter round.{" "}
          <a className="plink" href="./maps.html">Open Max Schedules</a>
        </p>
      )}
      {!plan && (
        <p className="pnote">
          No floor plan {activeBuilding ? `for ${activeBuilding}` : "yet"} — add one in Max Space
          (⬆ Import) and the policing map appears here.
        </p>
      )}
      {plan && active && (
        <div className="fc-builder">
          <div className="fc-main">
            <div className="prow">
              <label className="pfield grow">Round name
                <input ref={nameRef} value={active.name} placeholder="e.g. Main Lobby Porter — Days"
                  onChange={(e) => { setErr(""); patch({ name: e.target.value }); }} />
              </label>
              <label className="pfield">Shift
                <select value={active.shift} onChange={(e) => patch({ shift: e.target.value })}>
                  <option>1st Shift</option><option>2nd Shift</option><option>3rd Shift</option>
                </select>
              </label>
            </div>

            <h3 className="fc-h">
              Tap the spaces on this round
              <small>lobbies, restrooms, waiting rooms and corridors only</small>
            </h3>

            <div className="fc-mapwrap">
              <MapCanvas
                plan={plan} plans={bPlans} onPlan={setPlanId}
                badge={<BuildingBadge building={activeBuilding ?? ""}
                  onChange={buildings.length > 1 ? () => chooseBuilding(null) : undefined} />}
                spaces={mapSpaces} shapes={shapes}
                mode="policing"
                fillFor={(sp) => {
                  if (!eligibleIds.has(sp.id)) return "#33404d";
                  return active.stops.some((s) => s.spaceId === sp.id) ? "#7c3aed" : "#475569";
                }}
                selectedId={pickRoom?.id ?? null}
                onRoom={(sp) => {
                  if (!sp) { setPickRoom(null); return; }
                  if (!eligibleIds.has(sp.id)) return;
                  setPickRoom(sp);
                }}
                legend={
                  <div className="pro-legend">
                    <span><i style={{ background: "#7c3aed" }} />On this round</span>
                    <span><i style={{ background: "#475569" }} />Policeable space</span>
                    <span><i style={{ background: "#33404d" }} />Not a porter space</span>
                  </div>
                }
              />
              {pickRoom && (
                <div className="fc-mappick tall">
                  <b>{String(pickRoom.roomNumber ?? "")} {String(pickRoom.roomName ?? "")}</b>
                  <div className="fc-pickgroup">
                    <span className="fc-picklabel">Add a pass</span>
                    {taskIds.map((id) => (
                      <button key={id} className="pbtn small" onClick={() => {
                        patch({ stops: [...active.stops, { spaceId: pickRoom.id, taskId: id }] });
                        setPickRoom(null);
                      }}>
                        + {labelOf(id)} · {policeStopMinutes(rules, pickRoom, id)}m
                      </button>
                    ))}
                  </div>
                  <button className="pbtn small ghost" onClick={() => setPickRoom(null)}>✕</button>
                </div>
              )}
            </div>
            <p className="pnote">
              Tap the same space again to add another pass — a lobby policed three times a day is
              three stops. The full frequency model comes with the finished spec.
            </p>
          </div>

          <aside className="fc-rail">
            <h3 className="fc-h">This round</h3>
            <HoursBar minutes={total} />
            <div className="fc-stops">
              {active.stops.map((st, i) => {
                const sp = spaces.find((x) => x.id === st.spaceId);
                return (
                  <div key={i} className="fc-stop">
                    <span className="ordnum">{i + 1}</span>
                    <b>{String(sp?.roomNumber ?? sp?.roomName ?? "?")}</b>
                    <span>{labelOf(st.taskId)}</span>
                    <em>{sp ? policeStopMinutes(rules, sp, st.taskId) : 0}m</em>
                    <button className="pbtn small ghost"
                      onClick={() => patch({ stops: active.stops.filter((_, j) => j !== i) })}>✕</button>
                  </div>
                );
              })}
              {!active.stops.length && <p className="pnote">Tap a space on the map to add the first pass.</p>}
            </div>
            <div className="fc-railacts">
              <button className="pbtn primary wide" onClick={ship}>✓ Ship to Max Schedules</button>
              {err && <p className="warntext">⚠ {err}</p>}
              <button className="pbtn ghost wide"
                onClick={() => { setRoute(plan ? freshRoute(activeBuilding ?? "", plan.id) : null); setErr(""); }}>
                Start over
              </button>
            </div>

            {store.policing.length > 0 && (<>
              <h3 className="fc-h">Saved rounds</h3>
              {store.policing.map((r) => (
                <div key={r.id} className="fc-stop">
                  <b>{r.name || "Unnamed round"}</b>
                  <span>{r.stops.length} passes</span>
                  <button className="pbtn small" onClick={() => { setRoute(JSON.parse(JSON.stringify(r))); setJustShipped(""); }}>✏</button>
                  <button className="pbtn small danger" onClick={() => {
                    if (!confirm(`Delete round "${r.name}"? Its schedule in Max Schedules is removed too.`)) return;
                    commit((d) => unshipRoute(d, r));
                    commitStore({ ...store, policing: store.policing.filter((x) => x.id !== r.id) });
                  }}>✕</button>
                </div>
              ))}
            </>)}
          </aside>
        </div>
      )}
    </div>
  );
}
