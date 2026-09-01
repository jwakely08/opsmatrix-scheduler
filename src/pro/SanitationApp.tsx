// MAX SANITATION — the soiled-utility route engine (Josh's spec, 2026-08-31).
// Pick the building → drop a pin on the sanitation dock → click the soiled
// utility rooms in running order (everything else is greyed out). Every
// click prices the leg by real distance on the plan; ⏎ Return to dock
// inserts an unload trip. Ship sends the finished route into Max Schedules.
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
import { buildingArtMap } from "./buildingArt";
import { HoursBar } from "./FloorCareApp";
import {
  loadRoutes, saveRoutes, isSoiledUtility, sanTiming, shipSanitation, unshipRoute,
  DOCK, SAN_FT_PER_MIN, SAN_PICKUP_MINUTES, SAN_UNLOAD_MINUTES,
  type SanRoute, type RouteStore
} from "./routes";

const uid = (p: string) => p + "-" + Math.random().toString(36).slice(2, 9);

function freshRoute(building: string, planId: string): SanRoute {
  return {
    id: uid("san"), name: "", shift: "1st Shift",
    building, planId, dock: null, seq: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
}

export function SanitationApp({ data, rules, commit }: {
  data: ClassicData;
  rules: Rules;
  commit: (mut: (d: ClassicData) => void) => void;
}) {
  void rules;
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
  const [route, setRoute] = useState<SanRoute | null>(() => {
    const m = /[?&]sr=([a-z0-9-]+)/i.exec(window.location.search + window.location.hash);
    if (m) {
      const r = loadRoutes().sanitation.find((x) => x.id === m[1]);
      if (r) return JSON.parse(JSON.stringify(r));
    }
    return null; // set once the building/plan is known
  });
  const [placingDock, setPlacingDock] = useState(false);
  const [justShipped, setJustShipped] = useState("");
  const [err, setErr] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const commitStore = (next: RouteStore) => { setStore(next); saveRoutes(next); };

  const chooseBuilding = (b: string | null) => {
    setBuilding(b);
    saveMapBuilding(b);
    setPlanId(null);
  };

  // straight into building a route, like Max Floor Care — but only once a
  // plan exists to route on
  const active: SanRoute | null = route ?? (plan ? freshRoute(activeBuilding ?? "", plan.id) : null);
  if (active && !route && plan) setRoute(active);

  const patch = (p: Partial<SanRoute>) =>
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

  const soiledIds = useMemo(
    () => new Set(mapSpaces.filter((sp) => isSoiledUtility(sp)).map((sp) => sp.id)),
    [mapSpaces]);

  // timing and shipping always price against the ROUTE'S OWN floor plan —
  // never whichever floor happens to be on screen
  const routePlan = active ? (plans.find((pl) => pl.id === active.planId) ?? plan) : plan;
  const timing = active ? sanTiming(routePlan, spaces, active) : null;

  const ship = () => {
    if (!active) return;
    if (!active.name.trim()) {
      setErr("Give the route a name first — the box at the top left.");
      nameRef.current?.focus();
      return;
    }
    if (!active.dock) { setErr("Drop the sanitation dock pin first — 📍 below the map."); return; }
    if (!active.seq.some((x) => x !== DOCK)) { setErr("Click at least one soiled utility room."); return; }
    const shipped: SanRoute = { ...active, building: activeBuilding ?? "" };
    commit((d) => { shipSanitation(d, routePlan, shipped); });
    commitStore({ ...store, sanitation: [...store.sanitation.filter((r) => r.id !== shipped.id), shipped] });
    setRoute(null);
    setErr("");
    setJustShipped(shipped.name);
  };

  if (needsBuilding) {
    return (
      <div className="pro-list wi">
        <BuildingPicker art={buildingArtMap(data)} plans={plans} spaces={spaces} onPick={(b) => chooseBuilding(b)}
          note="Pick the building — the route runs between ITS sanitation dock and ITS soiled utility rooms." />
      </div>
    );
  }

  return (
    <div className="pro-list wi fc">
      {justShipped && (
        <p className="pnote shipped">
          ✓ <b>{justShipped}</b> is in Max Schedules as a finished sanitation route.{" "}
          <a className="plink" href="./maps.html">Open Max Schedules</a>
        </p>
      )}
      {!plan && (
        <p className="pnote">
          No floor plan {activeBuilding ? `for ${activeBuilding}` : "yet"} — add one in Max Space
          (⬆ Import) and the sanitation map appears here.
        </p>
      )}
      {plan && active && (
        <div className="fc-builder">
          <div className="fc-main">
            <div className="prow">
              <label className="pfield grow">Route name
                <input ref={nameRef} value={active.name} placeholder="e.g. Soiled Utility Run — Days"
                  onChange={(e) => { setErr(""); patch({ name: e.target.value }); }} />
              </label>
              <label className="pfield">Shift
                <select value={active.shift} onChange={(e) => patch({ shift: e.target.value })}>
                  <option>1st Shift</option><option>2nd Shift</option><option>3rd Shift</option>
                </select>
              </label>
            </div>

            <h3 className="fc-h">
              Click soiled utility rooms in running order
              <small>only soiled utility / soiled hold rooms are selectable; the route is priced
                at {SAN_FT_PER_MIN} ft/min walking, {SAN_PICKUP_MINUTES} min per pickup, {SAN_UNLOAD_MINUTES} min per dock unload</small>
            </h3>
            <div className="wi-toolbar">
              <button className={"pbtn small" + (placingDock ? " on primary" : "")}
                onClick={() => setPlacingDock(!placingDock)}>
                📍 {active.dock ? "Move the sanitation dock pin" : "Drop the sanitation dock pin"}
              </button>
              <button className="pbtn small" disabled={!active.dock || !active.seq.length || active.seq[active.seq.length - 1] === DOCK}
                title="Cart full? Insert a return to the dock, unload, and keep going"
                onClick={() => patch({ seq: [...active.seq, DOCK] })}>
                ⏎ Return to dock
              </button>
              {placingDock && <span className="linkhint">Now tap the dock's spot on the map</span>}
            </div>

            <div className="fc-mapwrap">
              <MapCanvas
                plan={plan} plans={bPlans} onPlan={setPlanId}
                badge={<BuildingBadge building={activeBuilding ?? ""}
                  onChange={buildings.length > 1 ? () => chooseBuilding(null) : undefined} />}
                spaces={mapSpaces} shapes={shapes}
                mode="sanitation"
                marker={active.dock && plan && plan.id === active.planId
                  ? { x: active.dock.x, y: active.dock.y, label: "DOCK" } : null}
                onCanvas={placingDock ? (pt) => {
                  const hasStops = active.seq.some((x) => x !== DOCK);
                  if (hasStops && plan && active.planId !== plan.id) {
                    setErr("The dock pin lives on the route's own floor — switch back to it, or Start over.");
                    setPlacingDock(false);
                    return;
                  }
                  patch({ dock: pt, ...(hasStops ? {} : { planId: plan?.id ?? active.planId }) });
                  setPlacingDock(false);
                  setErr("");
                } : undefined}
                fillFor={(sp) => {
                  if (!soiledIds.has(sp.id)) return "#33404d";
                  return active.seq.includes(sp.id) && plan?.id === active.planId ? "#0891b2" : "#475569";
                }}
                selectedId={null}
                onRoom={(sp) => {
                  if (!sp || !soiledIds.has(sp.id)) return;
                  if (placingDock) return; // pin placement wins the tap
                  if (!active.dock) { setErr("Drop the sanitation dock pin first — the route starts and ends there."); return; }
                  // ONE FLOOR PER ROUTE (Josh's hierarchy rule): distances
                  // only mean something on one plan's scale. The first stop
                  // pins the route to the floor on screen; other floors get
                  // a plain refusal, not silent garbage math.
                  const hasStops = active.seq.some((x) => x !== DOCK);
                  if (hasStops && plan && active.planId !== plan.id) {
                    const home = plans.find((pl) => pl.id === active.planId);
                    setErr(`This route runs on ${home?.floor ?? "another floor"} — one floor per route. Finish it there, or Start over to route this floor.`);
                    return;
                  }
                  setErr("");
                  patch({
                    seq: [...active.seq, sp.id],
                    ...(hasStops ? {} : { planId: plan?.id ?? active.planId })
                  });
                }}
                legend={
                  <div className="pro-legend">
                    <span><i style={{ background: "#0891b2" }} />On the route</span>
                    <span><i style={{ background: "#475569" }} />Soiled utility room</span>
                    <span><i style={{ background: "#33404d" }} />Not selectable</span>
                  </div>
                }
              />
            </div>
            <p className="pnote">
              Rooms are visited in the order you click them, then the cart returns to the dock —
              that last trip home is always included. Click a room twice and it's visited twice.
            </p>
            {timing?.unscaled && (
              <p className="warntext">⚠ This floor plan has no scale, so travel time can't be measured — pickup and unload minutes still count. Re-ship the plan through the Calibration Editor to get distances.</p>
            )}
          </div>

          <aside className="fc-rail">
            <h3 className="fc-h">This route</h3>
            {timing && <HoursBar minutes={timing.total} />}
            {timing && (
              <p className="pnote">
                {Math.round(timing.travelMinutes)}m walking · {Math.round(timing.serviceMinutes)}m pickups &amp; unloads
              </p>
            )}
            <div className="fc-stops">
              {timing?.legs.map((leg, i) => (
                <div key={i} className="fc-stop">
                  <span className="ordnum">{i + 1}</span>
                  <b>{leg.from} → {leg.to}</b>
                  <span>{leg.feet !== null ? `${leg.feet} ft` : "no scale"}</span>
                  <em>{Math.round(leg.minutes + leg.serviceMinutes)}m</em>
                </div>
              ))}
              {!active.seq.length && <p className="pnote">Drop the dock pin, then click the first soiled utility room.</p>}
            </div>
            {active.seq.length > 0 && (
              <button className="pbtn small" onClick={() => patch({ seq: active.seq.slice(0, -1) })}>↩ Undo last stop</button>
            )}
            <div className="fc-railacts">
              <button className="pbtn primary wide" onClick={ship}>✓ Ship to Max Schedules</button>
              {err && <p className="warntext">⚠ {err}</p>}
              <button className="pbtn ghost wide" onClick={() => { setRoute(plan ? freshRoute(activeBuilding ?? "", plan.id) : null); setErr(""); }}>
                Start over
              </button>
            </div>

            {store.sanitation.length > 0 && (<>
              <h3 className="fc-h">Saved routes</h3>
              {store.sanitation.map((r) => (
                <div key={r.id} className="fc-stop">
                  <b>{r.name || "Unnamed route"}</b>
                  <span>{r.seq.filter((x) => x !== DOCK).length} stops</span>
                  <button className="pbtn small" onClick={() => { setRoute(JSON.parse(JSON.stringify(r))); setJustShipped(""); }}>✏</button>
                  <button className="pbtn small danger" onClick={() => {
                    if (!confirm(`Delete route "${r.name}"? Its schedule in Max Schedules is removed too.`)) return;
                    commit((d) => unshipRoute(d, r));
                    commitStore({ ...store, sanitation: store.sanitation.filter((x) => x.id !== r.id) });
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
