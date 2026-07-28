// Supabase adapter — loads/saves the whole org workspace against the schema in
// supabase/migrations/0001_init.sql. Optimistic concurrency via
// organizations.state_rev (bump_state_rev RPC): last write wins, but a stale
// writer gets conflict=true so the UI can show "data changed, refresh".
//
// Directors sync everything; supervisors sync only schedule tables
// (assignments + non_space_jobs) — RLS enforces the same rule server-side.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppState } from "../lib/types";
import { uid } from "../lib/types";
import { defaultState } from "../lib/seeds";
import type { StorageAdapter, SaveResult } from "./adapter";
import type { Role } from "../auth/AuthContext";
import { log } from "../lib/logger";

export class RemoteAdapter implements StorageAdapter {
  readonly mode = "remote" as const;
  private rev = 0;

  constructor(
    private sb: SupabaseClient,
    private orgId: string,
    private role: Role
  ) {}

  async load(): Promise<AppState | null> {
    const sb = this.sb;
    const [org, buildings, floors, rooms, assignments, shifts, employees, jobs, roomTypes, rateTables] =
      await Promise.all([
        sb.from("organizations").select("state_rev").eq("id", this.orgId).single(),
        sb.from("buildings").select("*"),
        sb.from("floors").select("*"),
        sb.from("rooms").select("*"),
        sb.from("assignments").select("*"),
        sb.from("shifts").select("*"),
        sb.from("employees").select("*"),
        sb.from("non_space_jobs").select("*"),
        sb.from("room_types").select("*"),
        sb.from("rate_tables").select("*")
      ]);
    if (org.error) { log.error("remote load failed", org.error); return null; }
    this.rev = org.data.state_rev as number;

    const def = defaultState();
    const state: AppState = { ...def };
    state.buildings = (buildings.data ?? []).map((b) => ({ id: b.id, name: b.name }));
    state.floors = (floors.data ?? []).map((f) => ({
      id: f.id, buildingId: f.building_id, name: f.name, geometry: f.geometry,
      grossSqFt: f.gross_sqft, cleanableSqFt: f.cleanable_sqft, importedAt: f.imported_at ?? ""
    }));
    const asgByRoom = new Map<string, { shift_id: string | null; employee_id: string | null }>();
    for (const a of assignments.data ?? []) asgByRoom.set(a.room_id, a);
    state.rooms = (rooms.data ?? []).map((r) => ({
      id: r.id, floorId: r.floor_id, department: r.department, name: r.name,
      roomType: r.room_type, floorType: r.floor_type, fixtures: r.fixtures,
      cleanableSqFt: r.cleanable_sqft, ceilingHeight: r.ceiling_height,
      perimeter: r.perimeter, doorAreaSqFt: r.door_area_sqft, windowAreaSqFt: r.window_area_sqft,
      tasks: r.tasks ?? [], frequency: r.frequency,
      shiftId: asgByRoom.get(r.id)?.shift_id ?? null,
      employeeId: asgByRoom.get(r.id)?.employee_id ?? null,
      mapX: r.map_x, mapY: r.map_y, source: r.source
    }));
    if ((shifts.data ?? []).length) {
      state.shifts = shifts.data!.map((s) => ({ id: s.id, name: s.name, start: s.start_time, end: s.end_time }));
    }
    state.employees = (employees.data ?? []).map((e) => ({
      id: e.id, name: e.name, role: e.role_title, shiftId: e.shift_id, pattern: e.pattern ?? []
    }));
    state.jobs = (jobs.data ?? []).map((j) => ({
      id: j.id, name: j.name, type: j.type, mode: j.mode, minutes: j.minutes,
      unitsPerDay: j.units_per_day, minutesPerUnit: j.minutes_per_unit,
      shiftId: j.shift_id, employeeId: j.employee_id
    }));
    if ((roomTypes.data ?? []).length) {
      state.roomTypes = roomTypes.data!.map((t) => ({
        id: t.id, name: t.name, floorType: t.floor_type, fixtures: t.fixtures,
        frequency: t.frequency, tasks: t.tasks ?? []
      }));
    }
    for (const row of rateTables.data ?? []) {
      if (row.kind === "base_rates") state.rates.baseRates = row.data;
      else if (row.kind === "modifiers") state.rates.modifiers = row.data;
      else if (row.kind === "scalars") {
        state.rates.fixtureMinutes = row.data.fixtureMinutes ?? state.rates.fixtureMinutes;
        state.rates.productiveMinutes = row.data.productiveMinutes ?? state.rates.productiveMinutes;
      }
      else if (row.kind === "floor_types") state.floorTypes = row.data;
      else if (row.kind === "frequencies") state.frequencies = row.data;
      else if (row.kind === "ui_prefs") state.ui = { ...state.ui, ...row.data };
    }
    return state;
  }

  async save(state: AppState): Promise<SaveResult> {
    const sb = this.sb;
    // optimistic-concurrency gate first
    const bump = await sb.rpc("bump_state_rev", { expected_rev: this.rev });
    if (bump.error) { log.error("bump_state_rev failed", bump.error); return { ok: false, error: bump.error.message }; }
    if (bump.data === -1) return { ok: true, conflict: true }; // stale — tell UI to refresh
    this.rev = bump.data as number;

    const org = this.orgId;
    try {
      if (this.role === "director") {
        // full sync: replace org rows table-by-table (pilot-scale data volumes)
        await this.replace("buildings", state.buildings.map((b) => ({ id: b.id, organization_id: org, name: b.name })));
        await this.replace("floors", state.floors.map((f) => ({
          id: f.id, organization_id: org, building_id: f.buildingId, name: f.name,
          geometry: f.geometry, gross_sqft: f.grossSqFt, cleanable_sqft: f.cleanableSqFt,
          imported_at: f.importedAt || null
        })));
        await this.replace("rooms", state.rooms.map((r) => ({
          id: r.id, organization_id: org, floor_id: r.floorId, department: r.department,
          name: r.name, room_type: r.roomType, floor_type: r.floorType, fixtures: r.fixtures,
          cleanable_sqft: r.cleanableSqFt, ceiling_height: r.ceilingHeight, perimeter: r.perimeter,
          door_area_sqft: r.doorAreaSqFt, window_area_sqft: r.windowAreaSqFt,
          tasks: r.tasks, frequency: r.frequency, map_x: r.mapX, map_y: r.mapY, source: r.source
        })));
        await this.replace("shifts", state.shifts.map((s) => ({
          id: s.id, organization_id: org, name: s.name, start_time: s.start, end_time: s.end
        })));
        await this.replace("employees", state.employees.map((e) => ({
          id: e.id, organization_id: org, name: e.name, role_title: e.role,
          shift_id: e.shiftId, pattern: e.pattern
        })));
        await this.replace("room_types", state.roomTypes.map((t) => ({
          id: t.id, organization_id: org, name: t.name, floor_type: t.floorType,
          fixtures: t.fixtures, frequency: t.frequency, tasks: t.tasks
        })));
        const rateRows = [
          { organization_id: org, kind: "base_rates", data: state.rates.baseRates },
          { organization_id: org, kind: "modifiers", data: state.rates.modifiers },
          { organization_id: org, kind: "scalars", data: { fixtureMinutes: state.rates.fixtureMinutes, productiveMinutes: state.rates.productiveMinutes } },
          { organization_id: org, kind: "floor_types", data: state.floorTypes },
          { organization_id: org, kind: "frequencies", data: state.frequencies },
          { organization_id: org, kind: "ui_prefs", data: state.ui }
        ];
        const rt = await sb.from("rate_tables").upsert(rateRows);
        if (rt.error) throw rt.error;
      }
      // schedule sync (directors and supervisors)
      await this.replace("assignments", state.rooms
        .filter((r) => r.shiftId || r.employeeId)
        .map((r) => ({
          id: "asg_" + r.id, organization_id: org, room_id: r.id,
          shift_id: r.shiftId, employee_id: r.employeeId
        })));
      await this.replace("non_space_jobs", state.jobs.map((j) => ({
        id: j.id, organization_id: org, name: j.name, type: j.type, mode: j.mode,
        minutes: j.minutes, units_per_day: j.unitsPerDay, minutes_per_unit: j.minutesPerUnit,
        shift_id: j.shiftId, employee_id: j.employeeId
      })));
      return { ok: true };
    } catch (e: any) {
      log.error("remote save failed", e);
      return { ok: false, error: e?.message ?? String(e) };
    }
  }

  async recordImport(filenames: string[], roomCount: number, cleanableSqFt: number | null): Promise<void> {
    const res = await this.sb.from("imports").insert({
      id: undefined as unknown as string, // let DB default gen_random_uuid()
      organization_id: this.orgId, filenames, room_count: roomCount, cleanable_sqft: cleanableSqFt
    } as any);
    if (res.error) log.warn("recordImport failed", res.error);
  }

  private async replace(table: string, rows: Record<string, unknown>[]): Promise<void> {
    const del = await this.sb.from(table).delete().eq("organization_id", this.orgId);
    if (del.error) throw del.error;
    if (rows.length) {
      const ins = await this.sb.from(table).insert(rows);
      if (ins.error) throw ins.error;
    }
  }
}

export function makeRemoteAdapter(sb: SupabaseClient, orgId: string, role: Role): RemoteAdapter {
  return new RemoteAdapter(sb, orgId, role);
}

/** id helper re-export so callers don't dig through types */
export { uid };
