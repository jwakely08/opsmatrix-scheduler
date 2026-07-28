// Demo mode: a sample building generated from the magicplan test-file data,
// run through the real parsers (so the demo exercises the same code path as a
// genuine import). Loaded onto the local adapter — no login, no backend.
import dxfRaw from "../../test-fixtures/Test_project_-_1st_Floor.dxf?raw";
import csvRaw from "../../test-fixtures/Test_project_statistics.csv?raw";
import { parseDXF, parseStatsCSV } from "./parsers";
import { defaultState, guessRoomType } from "./seeds";
import type { AppState } from "./types";
import { uid } from "./types";

export function buildDemoState(): AppState {
  const dxf = parseDXF(dxfRaw);
  const stats = parseStatsCSV(csvRaw);
  const state = defaultState();

  const building = { id: uid("bld"), name: "Demo Hospital" };
  state.buildings.push(building);

  for (const fl of stats.floors) {
    const floor = {
      id: uid("flr"), buildingId: building.id, name: fl.name,
      geometry: dxf, grossSqFt: stats.grossSqFt, cleanableSqFt: stats.cleanableSqFt,
      importedAt: new Date().toISOString()
    };
    state.floors.push(floor);
    for (const rm of fl.rooms) {
      const tplId = guessRoomType(rm.name);
      const tpl = state.roomTypes.find((t) => t.id === tplId) ?? null;
      const label = dxf.labels.find((l) => l.text.toLowerCase().trim() === rm.name.toLowerCase().trim());
      state.rooms.push({
        id: uid("rm"), floorId: floor.id, department: "Med-Surg West", name: rm.name,
        roomType: tpl ? tpl.name : "(untyped)",
        floorType: tpl ? tpl.floorType : "VCT",
        fixtures: tpl ? tpl.fixtures : 0,
        cleanableSqFt: rm.areaSqFt, ceilingHeight: rm.ceilingHeight, perimeter: rm.groundPerimeter,
        doorAreaSqFt: rm.doorAreaSqFt, windowAreaSqFt: rm.windowAreaSqFt,
        tasks: tpl ? [...tpl.tasks] : ["Daily clean"],
        frequency: tpl ? tpl.frequency : "7x",
        shiftId: null, employeeId: null,
        mapX: label ? label.x : null, mapY: label ? label.y : null,
        source: "demo"
      });
    }
  }

  state.employees.push(
    { id: uid("emp"), name: "D. Alvarez", role: "EVS Tech", shiftId: "sh_days", pattern: [false, true, true, true, true, true, false] },
    { id: uid("emp"), name: "K. Osei", role: "EVS Tech", shiftId: "sh_eves", pattern: [false, true, true, true, true, true, false] }
  );
  state.jobs.push({
    id: uid("job"), name: "Discharge cleans — demo", type: "discharge", mode: "unit",
    minutes: 0, unitsPerDay: 6, minutesPerUnit: 45, shiftId: "sh_eves", employeeId: null
  });
  state.ui.view = "schedule";
  return state;
}
