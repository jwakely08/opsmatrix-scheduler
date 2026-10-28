// Clone in space validation (Josh, 2026-10-28): "I hit the clone button. There's checkboxes for
// all the different data points… the ones that are checked… it will clone for all the rooms
// that I click, click, click." One room's details copied onto the next ones — never its
// number, name or square feet, which are each room's own.
import { applyFloorType, applyRoomType, syncSpaceMinutes, type ClassicSpace } from "./classicStore";
import { typeIdFromLabelStrict, type Rules } from "./rules";

export type CloneField = "roomType" | "floorType" | "fixtureCount" | "department" | "priority" | "cleanability" | "spaceTasks" | "notes";

export const CLONE_FIELDS: { id: CloneField; label: string }[] = [
  { id: "roomType", label: "Room type" },
  { id: "floorType", label: "Floor type" },
  { id: "fixtureCount", label: "Fixtures" },
  { id: "department", label: "Department" },
  { id: "priority", label: "Priority" },
  { id: "cleanability", label: "Cleanable" },
  { id: "spaceTasks", label: "Tasks" },
  { id: "notes", label: "Notes" }
];

/** what a first clone copies until the user picks otherwise */
export const DEFAULT_CLONE_FIELDS: CloneField[] = ["roomType", "floorType", "fixtureCount"];

/** everything a clone can change on a room, as it was — for undo */
const TOUCHED = ["roomType", "floorType", "fixtureCount", "department", "priority", "cleanability", "spaceTasks", "notes",
  "vacuumDaysPerWeek", "estimatedCleaningMinutes", "updatedAt"] as const;

export type RoomSnapshot = Partial<Record<(typeof TOUCHED)[number], unknown>> & { absent: string[] };

export function snapshotRoom(sp: ClassicSpace): RoomSnapshot {
  const snap: RoomSnapshot = { absent: [] };
  for (const k of TOUCHED) {
    if (k in sp && sp[k] !== undefined) (snap as Record<string, unknown>)[k] = JSON.parse(JSON.stringify(sp[k]));
    else snap.absent.push(k);
  }
  return snap;
}

export function restoreRoom(sp: ClassicSpace, snap: RoomSnapshot): void {
  for (const k of TOUCHED) {
    if (snap.absent.includes(k)) delete sp[k];
    else (sp as Record<string, unknown>)[k] = JSON.parse(JSON.stringify((snap as Record<string, unknown>)[k]));
  }
}

/**
 * Copy the chosen details of `source` onto `target`, the whole way: a floor type brings its
 * floor tasks, a room type its automatic tasks — unless Tasks are copied too, which then win —
 * and the minutes are worked out again. Number, name and square feet are never touched.
 */
export function cloneInto(target: ClassicSpace, source: ClassicSpace, fields: CloneField[], rules: Rules): void {
  const on = (f: CloneField) => fields.includes(f);
  if (on("floorType") && String(source.floorType ?? "").trim()) {
    applyFloorType(target, String(source.floorType), rules);
    if (source.vacuumDaysPerWeek !== undefined) target.vacuumDaysPerWeek = source.vacuumDaysPerWeek;
  }
  if (on("roomType") && String(source.roomType ?? "").trim()) {
    const tid = typeIdFromLabelStrict(rules, String(source.roomType));
    if (tid) applyRoomType(target, tid, rules);
    else target.roomType = source.roomType;
  }
  if (on("spaceTasks")) target.spaceTasks = [...(Array.isArray(source.spaceTasks) ? source.spaceTasks : [])];
  if (on("fixtureCount")) target.fixtureCount = Number(source.fixtureCount) || 0;
  if (on("department")) target.department = String(source.department ?? "");
  if (on("priority")) {
    if (source.priority) target.priority = source.priority; else delete target.priority;
  }
  if (on("cleanability")) {
    if (source.cleanability) target.cleanability = source.cleanability; else delete target.cleanability;
  }
  if (on("notes")) target.notes = String(source.notes ?? "");
  syncSpaceMinutes(target, rules);
}
