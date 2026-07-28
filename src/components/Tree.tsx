import React from "react";
import { useStore } from "../state/store";
import { useUI } from "../state/ui";
import { rollup, roomStatus, roomDailyMinutes, scopedRooms, deptKey, byId } from "../lib/compute";
import { fmt, fmtHrs } from "../lib/format";
import type { Room, Scope } from "../lib/types";

function scopeEq(a: Scope | null, b: Scope | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function statusDotClass(state: ReturnType<typeof useStore>["state"], rooms: Room[]): string {
  const ru = rollup(state, rooms);
  if (ru.rooms === 0) return "s-none";
  if (ru.unscheduled === 0 && ru.partial === 0) return "s-full";
  if (ru.scheduled > 0 || ru.partial > 0) return "s-partial";
  return "s-none";
}

export function Tree() {
  const { state, update } = useStore();
  const ui = useUI();

  const setScope = (sc: Scope | null) =>
    update((d) => { d.ui.scope = scopeEq(d.ui.scope, sc) ? null : sc; });

  const toggleExpand = (key: string, cur: boolean) =>
    update((d) => { d.ui.expanded[key] = !cur; });

  function Row({ level, label, stat, dotCls, scope, expandKey, hasKids, roomIds, onDouble }: {
    level: string; label: string; stat: string; dotCls: string; scope: Scope;
    expandKey?: string; hasKids?: boolean; roomIds: string[]; onDouble?: () => void;
  }) {
    const expanded = !expandKey || state.ui.expanded[expandKey] !== false;
    return (
      <div
        className={`trow lvl-${level}${scopeEq(state.ui.scope, scope) ? " selected" : ""}`}
        tabIndex={0} role="button"
        draggable={ui.canEditSchedule}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "branch", roomIds, label }));
        }}
        onClick={() => setScope(scope)}
        onDoubleClick={onDouble}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setScope(scope); } }}
      >
        <span className="caret" onClick={(e) => {
          if (!hasKids || !expandKey) return;
          e.stopPropagation();
          toggleExpand(expandKey, expanded);
        }}>{hasKids ? (expanded ? "▾" : "▸") : ""}</span>
        <span className={"dot " + dotCls} />
        <span className="nm">{label}</span>
        <span className="stat">{stat}</span>
      </div>
    );
  }

  const rooms = scopedRooms(state, state.ui.scope);
  const ru = rollup(state, rooms);
  let scopeName = "Whole facility";
  const sc = state.ui.scope;
  if (sc) {
    if (sc.type === "building") scopeName = byId(state.buildings, sc.buildingId)?.name ?? "?";
    else if (sc.type === "floor") scopeName = byId(state.floors, sc.floorId)?.name ?? "?";
    else if (sc.type === "dept") scopeName = sc.dept;
    else if (sc.type === "room") scopeName = byId(state.rooms, sc.roomId)?.name ?? "?";
  }

  return (
    <>
      <div className="scopebar">
        <span className="title">Facility</span>
        {state.ui.scope && (
          <button className="clear" onClick={() => update((d) => { d.ui.scope = null; })}>clear scope</button>
        )}
      </div>
      <div>
        {!state.buildings.length && (
          <div className="tree-empty">No facility data yet.<br />Use <b>Import</b> to load magicplan scans.</div>
        )}
        {state.buildings.map((b) => {
          const bFloors = state.floors.filter((f) => f.buildingId === b.id);
          const bRooms = state.rooms.filter((r) => bFloors.some((f) => f.id === r.floorId));
          const bKey = "b:" + b.id;
          const bExpanded = state.ui.expanded[bKey] !== false;
          return (
            <div key={b.id} className="tnode">
              <Row level="building" label={b.name} stat={fmt(bRooms.length) + " rm"}
                dotCls={statusDotClass(state, bRooms)}
                scope={{ type: "building", buildingId: b.id }}
                expandKey={bKey} hasKids={bFloors.length > 0}
                roomIds={bRooms.map((r) => r.id)} />
              {bExpanded && (
                <div className="tkids">
                  {bFloors.map((f) => {
                    const fRooms = state.rooms.filter((r) => r.floorId === f.id);
                    const fru = rollup(state, fRooms);
                    const fKey = "f:" + f.id;
                    const fExpanded = state.ui.expanded[fKey] !== false;
                    const depts = new Map<string, Room[]>();
                    for (const r of fRooms) {
                      const d = deptKey(r);
                      if (!depts.has(d)) depts.set(d, []);
                      depts.get(d)!.push(r);
                    }
                    return (
                      <React.Fragment key={f.id}>
                        <Row level="floor" label={f.name} stat={fmt(fru.sqft, 0) + " ft²"}
                          dotCls={statusDotClass(state, fRooms)}
                          scope={{ type: "floor", floorId: f.id }}
                          expandKey={fKey} hasKids={fRooms.length > 0}
                          roomIds={fRooms.map((r) => r.id)} />
                        {fExpanded && (
                          <div className="tkids">
                            {[...depts.keys()].sort().map((d) => {
                              const dRooms = depts.get(d)!;
                              const dKeyStr = "d:" + f.id + ":" + d;
                              const dExpanded = state.ui.expanded[dKeyStr] !== false;
                              return (
                                <React.Fragment key={d}>
                                  <Row level="dept" label={d} stat={fmt(dRooms.length) + " rm"}
                                    dotCls={statusDotClass(state, dRooms)}
                                    scope={{ type: "dept", floorId: f.id, dept: d }}
                                    expandKey={dKeyStr} hasKids
                                    roomIds={dRooms.map((r) => r.id)} />
                                  {dExpanded && (
                                    <div className="tkids">
                                      {[...dRooms].sort((a, bb) => a.name.localeCompare(bb.name)).map((r) => {
                                        const st = roomStatus(r);
                                        return (
                                          <Row key={r.id} level="room" label={r.name}
                                            stat={fmt(roomDailyMinutes(state, r), 0) + " m/d"}
                                            dotCls={st === "scheduled" ? "s-full" : st === "partial" ? "s-partial" : "s-none"}
                                            scope={{ type: "room", roomId: r.id }}
                                            roomIds={[r.id]}
                                            onDouble={() => ui.openRoom(r.id)} />
                                        );
                                      })}
                                    </div>
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {state.buildings.length > 0 && (
        <div className="tree-roll">
          <div className="rrow"><span style={{ fontWeight: 600, color: "var(--ink)" }}>{scopeName}</span></div>
          <div className="rrow">Rooms <b>{fmt(ru.rooms)}</b></div>
          <div className="rrow">Cleanable <b>{fmt(ru.sqft, 0)} ft²</b></div>
          <div className="rrow">Daily workload <b>{fmtHrs(ru.dailyMin)}</b></div>
          <div className="rrow">Scheduled <b>{fmt(ru.scheduled)}</b></div>
          <div className="rrow">Partial <b>{fmt(ru.partial)}</b></div>
          <div className="rrow">Unscheduled <b>{fmt(ru.unscheduled)}</b></div>
        </div>
      )}
    </>
  );
}
