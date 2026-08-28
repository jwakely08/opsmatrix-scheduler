// Admin Settings → Exporting (§12g). Pick a slice of the inventory — the
// whole account, a building, a floor, a department, or one room — then take
// it out of OpsMatrix in one of two shapes:
//   📄 a clean Excel report (Summary + every room with all of its data), or
//   🔁 a re-import file that ⬆ Import accepts back losslessly.
// Rows are built by exportData.ts (pure, round-trip proven by test); this
// component only drives the pickers and hands rows to the vendored SheetJS.
import React, { useMemo, useState } from "react";
import {
  scopeSpaces, scopeLabel, exportFilename,
  reimportRows, dataExportRows,
  type ExportScope, type Cell
} from "./exportData";
import { loadSheetJs } from "./sheetFile";
import type { ClassicData, ClassicSpace } from "./classicStore";
import type { Rules } from "./rules";

const txt = (v: unknown) => String(v ?? "").trim();

/** column widths that fit the content — the "neat" part of a neat export */
function fitColumns(rows: Cell[][]): { wch: number }[] {
  const w: number[] = [];
  for (const row of rows) {
    row.forEach((c, i) => { w[i] = Math.max(w[i] ?? 8, Math.min(46, String(c ?? "").length + 2)); });
  }
  return w.map((wch) => ({ wch }));
}

export function ExportApp({ data, rules }: { data: ClassicData; rules: Rules }) {
  const spaces = data.v7.spaces ?? [];
  const [building, setBuilding] = useState("");
  const [floor, setFloor] = useState("");
  const [department, setDepartment] = useState("");
  const [roomId, setRoomId] = useState("");
  const [msg, setMsg] = useState("");

  const scope: ExportScope = roomId
    ? { roomId }
    : {
      building: building || undefined,
      floor: floor || undefined,
      department: department || undefined
    };
  const selected = useMemo(() => scopeSpaces(data, scope), [data, scope]);

  const opts = (get: (sp: ClassicSpace) => unknown, pred: (sp: ClassicSpace) => boolean) =>
    [...new Set(spaces.filter(pred).map((sp) => txt(get(sp))).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const inB = (sp: ClassicSpace) => !building || txt(sp.building) === building;
  const inF = (sp: ClassicSpace) => inB(sp) && (!floor || txt(sp.floor) === floor);
  const inD = (sp: ClassicSpace) => inF(sp) && (!department || txt(sp.department) === department);

  async function download(kind: "data" | "reimport") {
    if (!selected.length) { setMsg("⚠ Nothing to export — this selection has no rooms."); return; }
    setMsg("Building the file…");
    try {
      const XLSX = await loadSheetJs();
      const wb = XLSX.utils.book_new();
      const rows = kind === "data" ? dataExportRows(data, scope) : reimportRows(data, scope);
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = fitColumns(rows);
      XLSX.utils.book_append_sheet(wb, ws, "Rooms");
      const name = exportFilename(data, scope, kind);
      XLSX.writeFile(wb, name);
      setMsg(`✓ ${name} downloaded — ${selected.length} room${selected.length === 1 ? "" : "s"}.`);
    } catch (e) {
      setMsg("⚠ " + String((e as Error)?.message ?? e));
    }
  }

  return (
    <div className="pro-list spaces">
      <h3>What do you want to export?</h3>
      <p className="pnote">
        Pick as much or as little as you need — everything, one building, one floor,
        one department, or a single room.
      </p>
      <div className="pro-filters wrap">
        <label className="psel"><span>Building</span>
          <select value={building} onChange={(e) => { setBuilding(e.target.value); setFloor(""); setDepartment(""); setRoomId(""); }}>
            <option value="">All buildings</option>
            {opts((s) => s.building, () => true).map((b) => <option key={b}>{b}</option>)}
          </select>
        </label>
        <label className="psel"><span>Floor</span>
          <select value={floor} onChange={(e) => { setFloor(e.target.value); setDepartment(""); setRoomId(""); }}>
            <option value="">All floors</option>
            {opts((s) => s.floor, inB).map((f) => <option key={f}>{f}</option>)}
          </select>
        </label>
        <label className="psel"><span>Department</span>
          <select value={department} onChange={(e) => { setDepartment(e.target.value); setRoomId(""); }}>
            <option value="">All departments</option>
            {opts((s) => s.department, inF).map((d) => <option key={d}>{d}</option>)}
          </select>
        </label>
        <label className="psel"><span>Room</span>
          <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">All rooms in the selection</option>
            {spaces.filter(inD).slice(0, 800).map((sp) => (
              <option key={sp.id} value={sp.id}>
                {txt(sp.roomNumber) || "(no number)"} {txt(sp.roomName)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="pnote counts">
        Exporting: <b>{scopeLabel(data, scope)}</b> — {selected.length} room{selected.length === 1 ? "" : "s"},{" "}
        {Math.round(selected.reduce((a, s) => a + (Number(s.squareFeet) || 0), 0)).toLocaleString()} sq ft
      </p>

      <h3>Pick the format</h3>
      <button className="upltile" onClick={() => download("data")}>
        <b>📄 Data export — Excel</b>
        <span>
          The whole dataset, one row per room: Building, Floor, Department, Room Number,
          Room Name, Room Type, Floor Type, Fixtures, Square Feet, Priority. Everything
          Max Space knows about the selection — no totals, no summary pages.
        </span>
      </button>
      <button className="upltile" onClick={() => download("reimport")}>
        <b>🔁 Re-import file — Excel</b>
        <span>
          Columns in OpsMatrix's own import format. Upload it back through ⬆ Import (here or in
          another OpsMatrix) and every row lands on the right room — updated, never duplicated,
          and never overwriting a manager's newer edits.
        </span>
      </button>
      {msg && <p className={msg.startsWith("⚠") ? "warntext" : "pnote keysaved"}>{msg}</p>}
      <p className="pnote">
        Task lists aren't columns in the re-import file — they follow the room type's rules in
        Scope wherever the file is imported. For a full same-device backup (plans, schedules,
        floor care and all), use Scope → Data backup.
      </p>
    </div>
  );
}
