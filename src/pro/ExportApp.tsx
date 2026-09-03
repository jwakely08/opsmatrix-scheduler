// Admin Settings → Exporting (§12g). Pick a slice of the inventory — the
// whole account, a building, a floor, a department, or one room — then take
// it out of OpsMatrix in one of two shapes:
//   📄 a clean Excel report (Summary + every room with all of its data), or
//   🔁 a re-import file that ⬆ Import accepts back losslessly.
// Rows are built by exportData.ts (pure, round-trip proven by test); this
// component only drives the pickers and hands rows to the vendored SheetJS.
import React, { useMemo, useRef, useState } from "react";
import {
  scopeSpaces, scopeLabel, exportFilename,
  reimportRows, dataExportRows,
  type ExportScope, type Cell
} from "./exportData";
import { loadSheetJs } from "./sheetFile";
import { loadApiKey, type ClassicData, type ClassicSpace } from "./classicStore";
import type { Rules } from "./rules";
import { aiProxy } from "./aiTransport";
import { planFileToImage, isPdf } from "./planFile";
import { mapXlsxTemplate, recreatePdfTemplate } from "./templateRead";
import {
  loadTemplates, writeTemplates, bytesToB64, TEMPLATE_MAX_BYTES,
  type ClientTemplate, type TemplateMap
} from "./templateStore";

const uid = (p: string) => p + "-" + Math.random().toString(36).slice(2, 9);

/** plain words for what Max found, so the manager can sanity-check the read */
function mapSummary(map: TemplateMap): string {
  const found = [
    map.positionCell && "position", map.orgCell && "facility name", map.daysCell && "days",
    map.hoursCell && "hours", map.breakCell && "break", map.lunchCell && "lunch"
  ].filter(Boolean).join(", ");
  return `${map.assignmentCells.length} assignment rows${found ? " · " + found : ""}`;
}

/**
 * Schedule templates (Josh, 2026-09-03): upload a client's sheet (Excel or
 * PDF), Max reads which cells take OpsMatrix data, name it — and the name
 * becomes an export button on every schedule card in Max Schedules.
 */
function TemplatesSection({ data, commit }: {
  data: ClassicData;
  commit: (mut: (d: ClassicData) => void) => void;
}) {
  const templates = loadTemplates(data);
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  async function readUpload(file: File) {
    setNote("");
    const label = name.trim() || file.name.replace(/\.(xlsx|pdf)$/i, "");
    try {
      const key = loadApiKey();
      const proxy = await aiProxy();
      if (!key && !proxy) {
        setNote("⚠ Max needs to read the template — sign in, or save an API key under Admin Settings → Max AI.");
        return;
      }
      let bytes: Uint8Array;
      let map: TemplateMap;
      let source: ClientTemplate["source"];
      if (isPdf(file)) {
        source = "pdf";
        setBusy("Max is reading the PDF and recreating it as an Excel sheet…");
        const pic = await planFileToImage(file);
        const out = await recreatePdfTemplate(pic.dataUrl, { apiKey: key, proxy });
        bytes = out.bytes; map = out.map;
      } else {
        source = "xlsx";
        if (file.size > TEMPLATE_MAX_BYTES) {
          setNote("⚠ That file is over 500 KB — schedule templates are small; export a lighter copy and try again.");
          return;
        }
        setBusy("Max is reading the template…");
        bytes = new Uint8Array(await file.arrayBuffer());
        map = await mapXlsxTemplate(bytes, { apiKey: key, proxy });
      }
      const tpl: ClientTemplate = {
        id: uid("tpl"), label, source, dataB64: bytesToB64(bytes), map,
        createdAt: new Date().toISOString()
      };
      commit((d) => writeTemplates(d, [...loadTemplates(d), tpl]));
      setName("");
      setNote(`✓ "${label}" saved — Max found ${mapSummary(map)}. It's now an export button on every schedule in Max Schedules.` +
        (source === "pdf" ? " It was recreated from a PDF — export one schedule and open it to check the layout once." : ""));
    } catch (e) {
      setNote("⚠ " + String((e as Error)?.message ?? e));
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <>
      <h3>Schedule templates</h3>
      <p className="pnote">
        Upload a client's schedule sheet — Excel or PDF. Max reads where the position, days,
        hours, break, lunch and assignment rows live; everything else on the sheet stays
        exactly as the client made it. Each template becomes its own export button on the
        schedules in Max Schedules.
      </p>
      {templates.map((t) => (
        <div key={t.id} className="prule">
          <input value={t.label} style={{ minWidth: 200, fontWeight: 700 }}
            onChange={(e) => commit((d) => writeTemplates(d,
              loadTemplates(d).map((x) => x.id === t.id ? { ...x, label: e.target.value } : x)))} />
          <span>{t.source === "pdf" ? "recreated from PDF" : "client's Excel file"} · {mapSummary(t.map)}</span>
          <button className="pbtn small danger" onClick={() => {
            if (!confirm(`Remove the "${t.label}" template? Schedules lose its export button.`)) return;
            commit((d) => writeTemplates(d, loadTemplates(d).filter((x) => x.id !== t.id)));
          }}>✕</button>
        </div>
      ))}
      <div className="prule add">
        <input placeholder="Template name (becomes the export button)" value={name}
          onChange={(e) => setName(e.target.value)} />
        <input ref={fileRef} type="file" accept=".xlsx,.pdf" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void readUpload(f); }} />
        <button className="pbtn small primary" disabled={!!busy}
          onClick={() => fileRef.current?.click()}>⬆ Upload template</button>
        {busy && <em>{busy}</em>}
      </div>
      {note && <p className={note.startsWith("⚠") ? "warntext" : "pnote keysaved"}>{note}</p>}
    </>
  );
}

const txt = (v: unknown) => String(v ?? "").trim();

/** column widths that fit the content — the "neat" part of a neat export */
function fitColumns(rows: Cell[][]): { wch: number }[] {
  const w: number[] = [];
  for (const row of rows) {
    row.forEach((c, i) => { w[i] = Math.max(w[i] ?? 8, Math.min(46, String(c ?? "").length + 2)); });
  }
  return w.map((wch) => ({ wch }));
}

export function ExportApp({ data, rules, commit }: {
  data: ClassicData;
  rules: Rules;
  commit: (mut: (d: ClassicData) => void) => void;
}) {
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

      <TemplatesSection data={data} commit={commit} />
    </div>
  );
}
