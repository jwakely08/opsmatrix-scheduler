// Admin → Workload Intelligence: executive view of the SAME canonical rooms
// every other screen uses. Four tabs — Overview (the FTE headline and where
// it comes from), Space Validation (clean-up and bulk mapping), Workload
// Breakdown (System → Building → Floor → Department → Room drill-down), and
// Assumptions (the engine's real, editable numbers — nothing invented).
//
// No hover tooltips anywhere (house rule): every chart value is printed
// directly on the chart.
import React, { useMemo, useState } from "react";
import {
  type Rules, spaceCleanability, typeIdFromLabelStrict
} from "./rules";
import {
  loadAliases, saveAliases, blankDeptLabels, departmentDisplay,
  type ImportSummary, type SourceRecord
} from "./roomListImport";
import {
  facilityTotals, buildTree, byDepartment, byFloor, explainRoom,
  type WorkSpace, type WorkNode, type Totals
} from "./workload";
import { suggestRoomTypes } from "../bridge/roomTypeSuggest";
import { loadApiKey } from "./classicStore";
import type { ClassicData, ClassicSpace } from "./classicStore";
import { syncSpaceMinutes, applyRoomType, FLOOR_TYPES } from "./classicStore";

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

// classification status colors (validated on the dark surface; every segment
// is also directly labeled with its name and number — color never stands alone)
const C_CLEAN = "#2dd4bf";
const C_NONCLEAN = "#64748b";
const C_REVIEW = "#f59e0b";

const fmt = (n: number, d = 0) =>
  n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtSq = (n: number) => fmt(Math.round(n)) + " sq ft";

type WiTab = "overview" | "validation" | "breakdown" | "assumptions";

export function WorkloadApp({ data, rules, commit, commitRules }: {
  data: ClassicData;
  rules: Rules;
  commit: (mut: (d: ClassicData) => void) => void;
  commitRules: (next: Rules) => void;
}) {
  const [tab, setTab] = useState<WiTab>("overview");
  const [sysSel, setSysSel] = useState("");
  const [bldSel, setBldSel] = useState("");

  const all = (data.v7.spaces ?? []) as WorkSpace[];
  const systems = useMemo(() => [...new Set(all.map((s) => String(s.system ?? "").trim()).filter(Boolean))], [all]);
  const buildings = useMemo(() => [...new Set(all
    .filter((s) => !sysSel || String(s.system ?? "").trim() === sysSel)
    .map((s) => String(s.building ?? "").trim()).filter(Boolean))], [all, sysSel]);
  const spaces = useMemo(() => all.filter((s) =>
    (!sysSel || String(s.system ?? "").trim() === sysSel) &&
    (!bldSel || String(s.building ?? "").trim() === bldSel)), [all, sysSel, bldSel]);

  const totals = useMemo(() => facilityTotals(spaces, rules), [spaces, rules]);

  return (
    <div className="pro-list wi">
      <div className="wi-scope">
        {systems.length > 1 && (
          <label className="psel">System
            <select value={sysSel} onChange={(e) => { setSysSel(e.target.value); setBldSel(""); }}>
              <option value="">All systems</option>
              {systems.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
        {buildings.length > 1 && (
          <label className="psel">Building
            <select value={bldSel} onChange={(e) => setBldSel(e.target.value)}>
              <option value="">All buildings</option>
              {buildings.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
        )}
        {(bldSel || sysSel) && <span className="pnote">Showing {bldSel || sysSel}</span>}
      </div>

      <nav className="ptabs wi-tabs">
        {([["overview", "Overview"], ["validation", "Space Validation"],
        ["breakdown", "Workload Breakdown"], ["assumptions", "Assumptions"]] as [WiTab, string][])
          .map(([t, label]) => (
            <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{label}</button>
          ))}
      </nav>

      {spaces.length === 0 ? (
        <div className="pro-empty">
          <h2>No rooms yet</h2>
          <p className="pnote">
            Import a room list — an Excel or CSV export of your facility's rooms — and
            the analysis appears here. A floor plan is NOT required.
          </p>
        </div>
      ) : tab === "overview" ? (
        <OverviewTab spaces={spaces} rules={rules} totals={totals} scope={bldSel || sysSel || "All buildings"} />
      ) : tab === "validation" ? (
        <ValidationTab spaces={spaces} rules={rules} commit={commit} />
      ) : tab === "breakdown" ? (
        <BreakdownTab spaces={spaces} rules={rules} totals={totals} />
      ) : (
        <AssumptionsTab rules={rules} commitRules={commitRules} />
      )}
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────

function OverviewTab({ spaces, rules, totals, scope }: {
  spaces: WorkSpace[]; rules: Rules; totals: Totals; scope: string;
}) {
  const depts = useMemo(() => byDepartment(spaces, rules), [spaces, rules]);
  const floors = useMemo(() => byFloor(spaces, rules), [spaces, rules]);
  const t = totals;
  return (
    <div className="wi-body">
      <div className="wi-hero">
        <div className="wi-heronum">
          <b>{fmt(t.fte, 1)}</b>
          <span>Estimated FTE Requirement</span>
          <small>{scope} · calculated with the OpsMatrix cleaning rules engine</small>
        </div>
        <div className="wi-kpis">
          <Kpi label="Daily Workload Hours" value={fmt(t.dailyHours, 1)} />
          <Kpi label="Weekly Workload Hours" value={fmt(t.weeklyHours, 1)} />
          <Kpi label="Model Coverage" value={fmt(t.coverage * 100, 1) + "%"}
            sub="of square footage classified well enough to calculate" />
        </div>
      </div>

      <div className="wi-cards">
        <Kpi label="Total Facility Area" value={fmtSq(t.totalSqFt)} />
        <Kpi label="EVS Cleanable Area" value={fmtSq(t.cleanableSqFt)} tint={C_CLEAN} />
        <Kpi label="Non-Cleanable Area" value={fmtSq(t.nonCleanableSqFt)} tint={C_NONCLEAN} />
        <Kpi label="Unresolved Area" value={fmtSq(t.unresolvedSqFt)} tint={C_REVIEW} />
        <Kpi label="Total Rooms" value={fmt(t.rooms)} />
        <Kpi label="Cleanable Rooms" value={fmt(t.cleanableRooms)} tint={C_CLEAN} />
        <Kpi label="Needs Review" value={fmt(t.reviewRooms)} tint={C_REVIEW} />
        <Kpi label="Non-Cleanable Rooms" value={fmt(t.nonCleanableRooms)} tint={C_NONCLEAN} />
      </div>

      <ClassificationBar t={t} />

      <div className="wi-charts">
        <BarList
          title="Estimated FTE by Department"
          rows={depts.map((d) => ({ label: d.label, value: d.totals.fte, text: fmt(d.totals.fte, 1) + " FTE" }))}
        />
        <BarList
          title="Weekly Workload Hours by Floor"
          rows={floors.map((f) => ({ label: f.label, value: f.totals.weeklyHours, text: fmt(f.totals.weeklyHours, 1) + " h" }))}
        />
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tint }: {
  label: string; value: string; sub?: string; tint?: string;
}) {
  return (
    <div className="wi-kpi">
      <b style={tint ? { color: tint } : undefined}>{value}</b>
      <span>{label}</span>
      {sub && <small>{sub}</small>}
    </div>
  );
}

/** one bar, three labeled segments — Total vs Cleanable never blur */
function ClassificationBar({ t }: { t: Totals }) {
  const total = Math.max(1, t.totalSqFt);
  const parts = [
    { label: "EVS Cleanable", sq: t.cleanableSqFt, rooms: t.cleanableRooms, color: C_CLEAN },
    { label: "Non-Cleanable", sq: t.nonCleanableSqFt, rooms: t.nonCleanableRooms, color: C_NONCLEAN },
    { label: "Needs Review", sq: t.unresolvedSqFt, rooms: t.reviewRooms + t.incalculableRooms, color: C_REVIEW }
  ].filter((p) => p.sq > 0 || p.rooms > 0);
  return (
    <div className="wi-chart">
      <h3>Space Classification</h3>
      <div className="wi-classbar">
        {parts.map((p) => (
          <i key={p.label} style={{ width: `${(p.sq / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className="wi-classlegend">
        {parts.map((p) => (
          <span key={p.label}>
            <i style={{ background: p.color }} />
            {p.label} — {fmtSq(p.sq)} · {fmt(p.rooms)} room{p.rooms === 1 ? "" : "s"}
          </span>
        ))}
      </div>
    </div>
  );
}

/** horizontal bars, single hue, every value printed (no hover anything) */
function BarList({ title, rows }: {
  title: string;
  rows: { label: string; value: number; text: string }[];
}) {
  const max = Math.max(1e-9, ...rows.map((r) => r.value));
  return (
    <div className="wi-chart">
      <h3>{title}</h3>
      {rows.length === 0 && <p className="pnote">Nothing to show yet.</p>}
      {rows.slice(0, 24).map((r) => (
        <div key={r.label} className="wi-bar">
          <span className="wi-barlabel">{r.label}</span>
          <span className="wi-bartrack">
            <i style={{ width: `${Math.max(1, (r.value / max) * 100)}%` }} />
          </span>
          <span className="wi-barval">{r.text}</span>
        </div>
      ))}
      {rows.length > 24 && <p className="pnote">…and {rows.length - 24} more in Workload Breakdown.</p>}
    </div>
  );
}

// ── Space Validation ────────────────────────────────────────────────────────

type ValFilter = "" | "review" | "noSqft" | "noFloorType" | "blankDeptName" | "noDept" | "nonclean";

function ValidationTab({ spaces, rules, commit }: {
  spaces: WorkSpace[]; rules: Rules;
  commit: (mut: (d: ClassicData) => void) => void;
}) {
  const [q, setQ] = useState("");
  const [floorF, setFloorF] = useState("");
  const [flt, setFlt] = useState<ValFilter>("");
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkType, setBulkType] = useState("");
  const [bulkFloor, setBulkFloor] = useState("");
  const [bulkClean, setBulkClean] = useState("");
  const [bulkDept, setBulkDept] = useState("");
  const [ai, setAi] = useState<{ phase: "idle" | "working" | "done" | "error"; msg?: string; out?: [string, string | null][] }>({ phase: "idle" });
  const PAGE = 100;

  const labels = useMemo(() => blankDeptLabels(spaces), [spaces]);
  const floors = useMemo(() => [...new Set(spaces.map((s) => String(s.floor ?? "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [spaces]);

  const counts = useMemo(() => {
    const c = { clean: 0, nonclean: 0, review: 0, noSqft: 0, noFloorType: 0, blankDeptName: 0, noDept: 0, cleanSq: 0, noncleanSq: 0, unresolvedSq: 0 };
    for (const sp of spaces) {
      const cl = spaceCleanability(rules, sp);
      const sq = Number(sp.squareFeet) || 0;
      if (cl === "Cleanable") { c.clean++; c.cleanSq += sq; }
      else if (cl === "Non-cleanable") { c.nonclean++; c.noncleanSq += sq; }
      else { c.review++; c.unresolvedSq += sq; }
      if (!(Number(sp.squareFeet) > 0)) c.noSqft++;
      if (!sp.floorType) c.noFloorType++;
      const key = String(sp.departmentKey ?? "").trim();
      if (key && !String(sp.department ?? "").trim()) c.blankDeptName++;
      if (!key && !String(sp.department ?? "").trim()) c.noDept++;
    }
    return c;
  }, [spaces, rules]);

  const rows = useMemo(() => spaces.filter((sp) => {
    if (floorF && String(sp.floor ?? "").trim() !== floorF) return false;
    const cl = spaceCleanability(rules, sp);
    if (flt === "review" && cl !== "Needs review") return false;
    if (flt === "nonclean" && cl !== "Non-cleanable") return false;
    if (flt === "noSqft" && Number(sp.squareFeet) > 0) return false;
    if (flt === "noFloorType" && sp.floorType) return false;
    if (flt === "blankDeptName" && !(String(sp.departmentKey ?? "").trim() && !String(sp.department ?? "").trim())) return false;
    if (flt === "noDept" && (String(sp.departmentKey ?? "").trim() || String(sp.department ?? "").trim())) return false;
    if (q) {
      const src = sp.source as SourceRecord | undefined;
      const hay = [sp.roomNumber, sp.roomName, sp.building, sp.floor, sp.department,
      src?.costCenter, src?.costCenterDescription, src?.roomName]
        .map((v) => String(v ?? "").toLowerCase()).join(" ");
      if (!hay.includes(q.toLowerCase())) return false;
    }
    return true;
  }), [spaces, rules, q, floorF, flt]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const pageRows = rows.slice(page * PAGE, page * PAGE + PAGE);
  const allPageSel = pageRows.length > 0 && pageRows.every((r) => sel.has(r.id));

  const applyBulk = () => {
    if (sel.size === 0) return;
    commit((d) => {
      const aliases = loadAliases();
      let aliasesChanged = false;
      for (const sp of (d.v7.spaces ?? []) as ClassicSpace[]) {
        if (!sel.has(sp.id)) continue;
        const src = sp.source as SourceRecord | undefined;
        if (bulkType) {
          // the type arrives complete: label + Scope's automatic tasks + minutes
          applyRoomType(sp, bulkType, rules);
          // remember the approval so the NEXT import maps this name itself
          const srcName = String(src?.roomName ?? sp.roomName ?? "").trim();
          if (srcName) { aliases.roomTypes[norm(srcName)] = bulkType; aliasesChanged = true; }
        }
        if (bulkFloor) {
          sp.floorType = bulkFloor;
          const srcFt = String(src?.floorType ?? "").trim();
          if (srcFt) { aliases.floorTypes[norm(srcFt)] = bulkFloor; aliasesChanged = true; }
        }
        if (bulkClean) (sp as WorkSpace).cleanability = bulkClean;
        if (bulkDept.trim()) sp.department = bulkDept.trim();
        syncSpaceMinutes(sp, rules);
      }
      if (aliasesChanged) saveAliases(aliases);
    });
    setSel(new Set());
    setBulkType(""); setBulkFloor(""); setBulkClean(""); setBulkDept("");
  };

  const askMax = async () => {
    const unnamed = [...new Set(spaces
      .filter((sp) => spaceCleanability(rules, sp) === "Needs review")
      .map((sp) => String((sp.source as SourceRecord | undefined)?.roomName ?? sp.roomName ?? "").trim())
      .filter((n) => n && n !== "-"))];
    if (!unnamed.length) { setAi({ phase: "error", msg: "Every room name is already classified." }); return; }
    setAi({ phase: "working" });
    try {
      const out = await suggestRoomTypes({
        apiKey: loadApiKey(), names: unnamed,
        typeLabels: rules.roomTypes.map((rt) => rt.label)
      });
      setAi({ phase: "done", out: [...out.entries()] });
    } catch (e) {
      setAi({ phase: "error", msg: String((e as Error)?.message ?? e) });
    }
  };

  const approveSuggestions = () => {
    if (ai.phase !== "done" || !ai.out) return;
    const byName = new Map(ai.out);
    commit((d) => {
      const aliases = loadAliases();
      for (const [name, label] of byName) {
        if (!label) continue;
        const id = typeIdFromLabelStrict(rules, label);
        if (id) aliases.roomTypes[norm(name)] = id;
      }
      saveAliases(aliases);
      for (const sp of (d.v7.spaces ?? []) as ClassicSpace[]) {
        if (spaceCleanability(rules, sp as WorkSpace) !== "Needs review") continue;
        const src = sp.source as SourceRecord | undefined;
        const nm = String(src?.roomName ?? sp.roomName ?? "").trim();
        const label = byName.get(nm);
        const id = label ? typeIdFromLabelStrict(rules, label) : null;
        if (id) applyRoomType(sp, id, rules);
      }
    });
    setAi({ phase: "idle" });
  };

  return (
    <div className="wi-body">
      <div className="wi-cards small">
        <Chip n={spaces.length} label="Imported spaces" onClick={() => setFlt("")} on={flt === ""} />
        <Chip n={counts.clean} label="Cleanable" tint={C_CLEAN} />
        <Chip n={counts.nonclean} label="Non-cleanable" tint={C_NONCLEAN} onClick={() => setFlt("nonclean")} on={flt === "nonclean"} />
        <Chip n={counts.review} label="Needs review" tint={C_REVIEW} onClick={() => setFlt("review")} on={flt === "review"} />
        <Chip n={counts.blankDeptName} label="Blank department name — structure exists" onClick={() => setFlt("blankDeptName")} on={flt === "blankDeptName"} />
        <Chip n={counts.noDept} label="No department assigned" onClick={() => setFlt("noDept")} on={flt === "noDept"} />
        <Chip n={counts.noFloorType} label="Missing floor type" onClick={() => setFlt("noFloorType")} on={flt === "noFloorType"} />
        <Chip n={counts.noSqft} label="Missing square feet" onClick={() => setFlt("noSqft")} on={flt === "noSqft"} />
      </div>

      <div className="wi-toolbar">
        <input className="wi-search" placeholder="Search room number, name, cost center…"
          value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        <label className="psel">Floor
          <select value={floorF} onChange={(e) => { setFloorF(e.target.value); setPage(0); }}>
            <option value="">All</option>
            {floors.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <span className="grow" />
        <button className="pbtn small" onClick={askMax} disabled={ai.phase === "working"}>
          {ai.phase === "working" ? "Asking Max…" : "✨ Ask Max about unclassified names"}
        </button>
      </div>

      {ai.phase === "error" && <p className="warntext">⚠ {ai.msg}</p>}
      {ai.phase === "done" && ai.out && (
        <div className="wi-aiout">
          <b>Max suggests:</b>
          <div className="wi-aigrid">
            {ai.out.map(([name, label]) => (
              <span key={name}>{name} → <b>{label ?? "leave unclassified"}</b></span>
            ))}
          </div>
          <div className="prow">
            <button className="pbtn primary small" onClick={approveSuggestions}>Approve and apply</button>
            <button className="pbtn ghost small" onClick={() => setAi({ phase: "idle" })}>Dismiss</button>
          </div>
          <p className="pnote">Approved mappings are remembered — the next import classifies these names itself.</p>
        </div>
      )}

      {sel.size > 0 && (
        <div className="wi-bulk">
          <b>{sel.size} selected —</b>
          <select value={bulkType} onChange={(e) => setBulkType(e.target.value)}>
            <option value="">Room type…</option>
            {rules.roomTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.label}</option>)}
          </select>
          <select value={bulkFloor} onChange={(e) => setBulkFloor(e.target.value)}>
            <option value="">Floor type…</option>
            {FLOOR_TYPES.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <select value={bulkClean} onChange={(e) => setBulkClean(e.target.value)}>
            <option value="">Cleanability…</option>
            <option value="Cleanable">Cleanable</option>
            <option value="Non-cleanable">Non-cleanable</option>
            <option value="Needs review">Needs review</option>
          </select>
          <input placeholder="Department name…" value={bulkDept} onChange={(e) => setBulkDept(e.target.value)} />
          <button className="pbtn primary small" onClick={applyBulk}
            disabled={!bulkType && !bulkFloor && !bulkClean && !bulkDept.trim()}>Apply</button>
          <button className="pbtn ghost small" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}

      <div className="wi-tablewrap">
        <table className="wi-table">
          <thead>
            <tr>
              <th><input type="checkbox" checked={allPageSel} onChange={() => {
                const next = new Set(sel);
                if (allPageSel) pageRows.forEach((r) => next.delete(r.id));
                else pageRows.forEach((r) => next.add(r.id));
                setSel(next);
              }} /></th>
              <th>Floor</th><th>Room #</th><th>Source name</th><th>Room type</th>
              <th>Department</th><th>Sq ft</th><th>Cost center</th>
              <th>Floor type</th><th>Cleanability</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((sp) => {
              const src = sp.source as SourceRecord | undefined;
              const cl = spaceCleanability(rules, sp);
              return (
                <tr key={sp.id} className={cl === "Needs review" ? "warn" : undefined}>
                  <td><input type="checkbox" checked={sel.has(sp.id)} onChange={() => {
                    const next = new Set(sel);
                    if (next.has(sp.id)) next.delete(sp.id); else next.add(sp.id);
                    setSel(next);
                  }} /></td>
                  <td>{String(sp.floor ?? "")}</td>
                  <td>{String(sp.roomNumber ?? "")}</td>
                  <td>{String(src?.roomName ?? sp.roomName ?? "")}</td>
                  <td>{String(sp.roomType ?? "") || <em className="wi-blank">unclassified</em>}</td>
                  <td>{departmentDisplay(sp, labels)}</td>
                  <td className="num">{Number(sp.squareFeet) > 0 ? fmt(Number(sp.squareFeet)) : <em className="wi-blank">—</em>}</td>
                  <td>{[src?.costCenter, src?.costCenterDescription].filter(Boolean).join(" · ")}</td>
                  <td>{String(sp.floorType ?? "") ||
                    (src?.floorType ? <em className="wi-blank">{src.floorType}?</em> : <em className="wi-blank">—</em>)}</td>
                  <td><span className="wi-clchip" style={{
                    color: cl === "Cleanable" ? C_CLEAN : cl === "Non-cleanable" ? C_NONCLEAN : C_REVIEW
                  }}>{cl}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="wi-pager">
        <span className="pnote">{fmt(rows.length)} rooms{flt || q || floorF ? " (filtered)" : ""}</span>
        <span className="grow" />
        {pages > 1 && <>
          <button className="pbtn small" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Prev</button>
          <span className="pnote">page {page + 1} of {pages}</span>
          <button className="pbtn small" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next ›</button>
        </>}
      </div>
    </div>
  );
}

function Chip({ n, label, tint, onClick, on }: {
  n: number; label: string; tint?: string; onClick?: () => void; on?: boolean;
}) {
  return (
    <button className={"wi-chip" + (on ? " on" : "") + (onClick ? "" : " static")}
      onClick={onClick} disabled={!onClick}>
      <b style={tint ? { color: tint } : undefined}>{fmt(n)}</b> {label}
    </button>
  );
}

// ── Workload Breakdown ─────────────────────────────────────────────────────

function BreakdownTab({ spaces, rules, totals }: {
  spaces: WorkSpace[]; rules: Rules; totals: Totals;
}) {
  const tree = useMemo(() => buildTree(spaces, rules), [spaces, rules]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(tree.map((n) => "system:" + n.key)));
  const [roomOpen, setRoomOpen] = useState<string | null>(null);
  const totalWeekly = Math.max(1e-9, totals.weeklyMinutes);

  const toggle = (id: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const renderNode = (n: WorkNode, path: string, depth: number): React.ReactNode => {
    const id = n.level + ":" + path;
    const isOpen = open.has(id);
    const t = n.totals;
    if (n.level === "room") {
      const sp = n.space!;
      const ex = explainRoom(rules, sp);
      const showing = roomOpen === sp.id;
      return (
        <React.Fragment key={id}>
          <tr className="wi-room" onClick={() => setRoomOpen(showing ? null : sp.id)}>
            <td style={{ paddingLeft: 14 + depth * 18 }}>{n.label}</td>
            <td className="num">{t.rooms}</td>
            <td className="num">{fmt(t.totalSqFt)}</td>
            <td className="num">{fmt(t.cleanableSqFt)}</td>
            <td className="num">{ex.weeklyHours === null ? "—" : fmt(ex.weeklyHours, 1)}</td>
            <td className="num">{ex.fte === null ? "—" : fmt(ex.fte, 2)}</td>
            <td className="num">{ex.weeklyMinutes === null ? "—" : fmt((ex.weeklyMinutes / totalWeekly) * 100, 1) + "%"}</td>
          </tr>
          {showing && (
            <tr className="wi-explain">
              <td colSpan={7}>
                <RoomExplanation sp={sp} rules={rules} />
              </td>
            </tr>
          )}
        </React.Fragment>
      );
    }
    return (
      <React.Fragment key={id}>
        <tr className={"wi-" + n.level} onClick={() => toggle(id)}>
          <td style={{ paddingLeft: 14 + depth * 18 }}>
            <span className="wi-caret">{isOpen ? "▾" : "▸"}</span> {n.label}
          </td>
          <td className="num">{fmt(t.rooms)}</td>
          <td className="num">{fmt(t.totalSqFt)}</td>
          <td className="num">{fmt(t.cleanableSqFt)}</td>
          <td className="num">{fmt(t.weeklyHours, 1)}</td>
          <td className="num">{fmt(t.fte, 1)}</td>
          <td className="num">{fmt((t.weeklyMinutes / totalWeekly) * 100, 1)}%</td>
        </tr>
        {isOpen && n.children.map((c) => renderNode(c, path + "/" + c.key, depth + 1))}
      </React.Fragment>
    );
  };

  return (
    <div className="wi-body">
      <p className="pnote">
        System → Building → Floor → Department → Room. Click a row to open it;
        click a room to see exactly where its numbers come from. Unnamed
        departments stay separate — "Blank Department 1" and "Blank Department 2"
        are different departments whose names the source did not provide.
      </p>
      <div className="wi-tablewrap">
        <table className="wi-table breakdown">
          <thead>
            <tr>
              <th>Location</th><th>Rooms</th><th>Sq ft</th><th>Cleanable sq ft</th>
              <th>Weekly hours</th><th>Est. FTE</th><th>% of workload</th>
            </tr>
          </thead>
          <tbody>
            {tree.map((n) => renderNode(n, n.key, 0))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RoomExplanation({ sp, rules }: { sp: WorkSpace; rules: Rules }) {
  const ex = explainRoom(rules, sp);
  const src = sp.source as SourceRecord | undefined;
  return (
    <div className="wi-explaincard">
      <div className="pline"><span>Source room name</span><b>{String(src?.roomName ?? sp.roomName ?? "—")}</b></div>
      <div className="pline"><span>Normalized room type</span><b>{ex.roomTypeLabel ?? "unclassified"}</b></div>
      <div className="pline"><span>Square footage</span><b>{Number(sp.squareFeet) > 0 ? fmtSq(Number(sp.squareFeet)) : "not provided yet"}</b></div>
      <div className="pline"><span>Floor type</span><b>{String(sp.floorType ?? "") || "not set"}</b></div>
      <div className="pline"><span>Cleanability</span><b>{ex.cleanability}</b></div>
      {ex.cleanability === "Cleanable" && <>
        <div className="pline"><span>Minutes per clean (rules engine)</span><b>{fmt(ex.perVisitMinutes)}</b></div>
        <div className="pline"><span>Cleaning frequency</span><b>{ex.frequency ?? "—"}</b></div>
        <div className="pline"><span>Weekly minutes</span><b>{ex.weeklyMinutes === null ? "cannot calculate yet" : fmt(ex.weeklyMinutes)}</b></div>
        <div className="pline"><span>Estimated FTE contribution</span><b>{ex.fte === null ? "—" : fmt(ex.fte, 3)}</b></div>
      </>}
      {ex.cleanability === "Non-cleanable" &&
        <p className="pnote">Real facility space, kept in every total — excluded from normal EVS workload.</p>}
      {ex.cleanability === "Needs review" &&
        <p className="pnote">Classify this room (Space Validation) and its workload joins the model.</p>}
      {src && <p className="pnote">Imported from {src.file}, row {src.row}{src.key ? ` · source id ${src.key}` : ""}.</p>}
    </div>
  );
}

// ── Assumptions ────────────────────────────────────────────────────────────

function AssumptionsTab({ rules, commitRules }: {
  rules: Rules; commitRules: (next: Rules) => void;
}) {
  const setGeneral = (field: "productiveMinutes" | "shiftsPerWeekPerFte", v: string) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return;
    const next: Rules = JSON.parse(JSON.stringify(rules));
    next.general[field] = n;
    commitRules(next);
  };
  return (
    <div className="wi-body wi-assume">
      <p className="pnote">
        These are the numbers the OpsMatrix cleaning-rules engine actually uses —
        the same engine behind Max Schedules and printed schedules. Change them
        here or in Admin Settings → Scope; every screen updates together.
      </p>
      <div className="wi-chart">
        <h3>Staffing</h3>
        <div className="pline"><span>Productive cleaning minutes per shift <small>(breaks and setup excluded)</small></span>
          <input className="wi-num" type="number" min={60} step={5} defaultValue={rules.general.productiveMinutes}
            onBlur={(e) => setGeneral("productiveMinutes", e.target.value)} /></div>
        <div className="pline"><span>Shifts one full-time employee works per week</span>
          <input className="wi-num" type="number" min={1} max={7} step={1} defaultValue={rules.general.shiftsPerWeekPerFte}
            onBlur={(e) => setGeneral("shiftsPerWeekPerFte", e.target.value)} /></div>
        <p className="pnote">Estimated FTE = weekly workload minutes ÷ (productive minutes × shifts per week).</p>
      </div>
      <div className="wi-chart">
        <h3>General cleaning rates <small>(ISSA-style healthcare starting rates — editable)</small></h3>
        <div className="pline"><span>Hard floor</span><b>1 minute per {rules.general.hardSqftPerMin} sq ft (mopping included)</b></div>
        <div className="pline"><span>Carpet</span><b>1 minute per {rules.general.carpetSqftPerMin} sq ft (vacuuming included)</b></div>
        <div className="pline"><span>Minimum per room</span><b>{rules.general.minMinutes} minutes</b></div>
        <p className="pnote">Edit these in Admin Settings → Scope.</p>
      </div>
      <div className="wi-chart">
        <h3>Room types — frequency, qualifier, cleanability</h3>
        <div className="wi-tablewrap">
          <table className="wi-table">
            <thead><tr><th>Room type</th><th>Frequency</th><th>Extra minutes</th><th>Counts toward EVS workload</th></tr></thead>
            <tbody>
              {rules.roomTypes.map((rt) => (
                <tr key={rt.id}>
                  <td>{rt.label}</td>
                  <td>{rt.frequency}</td>
                  <td className="num">{rt.qualifierMin ? "+" + rt.qualifierMin : "—"}</td>
                  <td>
                    <select value={rt.cleanability === "non-cleanable" ? "non-cleanable" : "cleanable"}
                      onChange={(e) => {
                        const next: Rules = JSON.parse(JSON.stringify(rules));
                        const target = next.roomTypes.find((x) => x.id === rt.id)!;
                        if (e.target.value === "non-cleanable") target.cleanability = "non-cleanable";
                        else delete target.cleanability;
                        commitRules(next);
                      }}>
                      <option value="cleanable">Yes — cleanable</option>
                      <option value="non-cleanable">No — non-cleanable</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="pnote">Frequencies and qualifiers are edited in Admin Settings → Scope. Breaks and lunches live there too.</p>
      </div>
    </div>
  );
}

// ── Import result screen (rendered by the ⬆ Upload hub in MapsApp) ─────────
// The upload buttons themselves were consolidated 2026-08-24: uploading
// happens in exactly ONE place — Max Space's ⬆ Upload button (Classic and
// the hub's #spaces header) — so this file only keeps the result screen.

export function ImportResult({ summary: s }: { summary: ImportSummary }) {
  return (
    <>
      <p className="pnote big">✓ Room list imported — {fmt(s.rows)} rooms/spaces processed.</p>
      <div className="wi-result">
        <div className="pline"><span>New rooms created</span><b>{fmt(s.created)}</b></div>
        {s.updated > 0 && <div className="pline"><span>Existing rooms updated</span><b>{fmt(s.updated)}</b></div>}
        {s.unchanged > 0 && <div className="pline"><span>Already up to date</span><b>{fmt(s.unchanged)}</b></div>}
        {s.keptManualEdits > 0 && <div className="pline"><span>Your manual edits kept</span><b>{fmt(s.keptManualEdits)}</b></div>}
        <div className="pline"><span>List View</span><b>Available now</b></div>
        <div className="pline"><span>Max Schedule</span><b>Rooms available</b></div>
        <div className="pline"><span>Workload Intelligence</span><b>Analysis available</b></div>
        <div className="pline"><span>Map View</span><b>No floor plan provided — add one any time</b></div>
        {s.sqftSource && <div className="pline"><span>Square footage source</span><b>{s.sqftSource}</b></div>}
        <div className="pline"><span>Floors detected</span><b>{fmt(s.floors.length)}</b></div>
        {s.deptNamesMissing > 0 &&
          <div className="pline"><span>Department names</span><b>missing where the file did not supply them</b></div>}
        {s.deptUnassigned > 0 && s.deptNamesMissing === 0 &&
          <div className="pline"><span>Departments</span><b>not provided — assign them any time</b></div>}
        <div className="pline"><span>Floor type coverage</span>
          <b>{s.rows > 0 ? fmt((s.floorTypeMapped / s.rows) * 100) + "%" : "—"}</b></div>
        {s.needsReview > 0 &&
          <div className="pline"><span>Rooms needing review</span><b style={{ color: C_REVIEW }}>{fmt(s.needsReview)}</b></div>}
      </div>
      {s.warnings.map((w) => <p key={w} className="warntext">⚠ {w}</p>)}
      <button className="pbtn primary wide" onClick={() => window.location.reload()}>
        Open the rooms
      </button>
    </>
  );
}
