// GENERATED REPORTS — nothing is written; everything is read out of the
// ledger and the status layers. Pure and tested. One button: template,
// range, PDF (print) or share.
import type { HotelState, LedgerEntry, WorkOrder } from "./store";
import { statusFor, typeOf, fmtTime, clusterOf, CONDITION_LABEL } from "./store";
import { verdictFor, arrivalUnits, minutesToPromise } from "./verdict";
import { VERDICT_LABEL } from "./theme";

export interface ReportSection { heading: string; lines: string[]; }
export interface Report { title: string; subtitle: string; generatedAt: string; sections: ReportSection[]; }

const inWindow = (iso: string, from: number, to: number) => { const t = new Date(iso).getTime(); return t >= from && t <= to; };

export function shiftWindow(now: number, hours: number): { from: number; to: number } {
  return { from: now - hours * 3600000, to: now };
}

/** MOD SHIFT HANDOVER — what the next shift needs to know, generated */
export function handoverReport(state: HotelState, now: number, hours = 8): Report {
  const { from, to } = shiftWindow(now, hours);
  const guest = state.spaces.filter((s) => typeOf(state, s)?.kind === "guest");
  const arrivals = arrivalUnits(state);
  const verdicts = arrivals.map((u) => ({ u, v: verdictFor(state, u.spaces[0], now) }));
  const notReady = verdicts.filter((x) => x.v.level !== "green");
  const ooo = guest.filter((s) => statusFor(state, s.id).engineering?.ooo);
  const openWo = state.workOrders.filter((w) => w.status === "open");
  const failed = state.ledger.filter((l) => l.kind === "inspect_fail" && inWindow(l.at, from, to));
  const lines = state.ledger.filter((l) => inWindow(l.at, from, to) && l.kind !== "system");
  const byRoom = new Map<string, LedgerEntry[]>();
  for (const l of lines) { const k = l.spaceId ?? "~general"; byRoom.set(k, [...(byRoom.get(k) ?? []), l]); }
  const roomLabel = (id: string) => { const sp = state.spaces.find((s) => s.id === id); return sp ? (clusterOf(state, sp)?.number ?? sp.number) : "General"; };
  const sections: ReportSection[] = [
    { heading: "Arrivals", lines: [
      `${arrivals.length} arrival${arrivals.length === 1 ? "" : "s"} tonight · ${verdicts.filter((x) => x.v.level === "green").length} ready · ${notReady.length} not ready`,
      ...notReady.map(({ u, v }) => { const m = minutesToPromise(u.status, now); return `${u.label} — ${VERDICT_LABEL[v.level]} · promised ${fmtTime(u.status.flags.promisedAt)}${m !== null && m < 0 ? ` (${-m} min late)` : ""} · ${v.reasons[0]}`; })
    ] },
    { heading: "Out of order", lines: ooo.length ? ooo.map((s) => `${s.number} — ${statusFor(state, s.id).engineering?.reason ?? "no reason recorded"}`) : ["None"] },
    { heading: "Open work orders", lines: openWo.length ? openWo.map((w) => `${state.spaces.find((s) => s.id === w.spaceId)?.number ?? "?"} — ${w.text} (${w.category}${w.blocking ? ", blocks the room" : ""}) · ${w.assignedTo ? state.staff.find((s) => s.id === w.assignedTo)?.name ?? "" : "unassigned"}`) : ["None"] },
    { heading: "Failed inspections this shift", lines: failed.length ? failed.map((l) => `${fmtTime(l.at)} ${l.text}`) : ["None"] },
    { heading: "Notes for the next shift", lines: lines.filter((l) => l.kind === "report_line" || l.kind === "note").map((l) => `${fmtTime(l.at)} ${l.text} — ${l.by}`).concat([]) },
    ...[...byRoom.entries()].filter(([k]) => k !== "~general").sort((a, b) => roomLabel(a[0]).localeCompare(roomLabel(b[0]), undefined, { numeric: true }))
      .map(([id, ls]) => ({ heading: roomLabel(id), lines: ls.map((l) => `${fmtTime(l.at)} ${l.text.replace(/^[^ ]+ /, "")} — ${l.by}`) }))
  ];
  if (!sections[4].lines.length) sections[4].lines = ["None"];
  return { title: "Shift handover", subtitle: `${state.settings.hotelName} · last ${hours} hours · ${lines.length} ledger lines`, generatedAt: new Date(now).toISOString(), sections };
}

/** DAILY ROOMS REPORT — the house at a glance */
export function dailyRoomsReport(state: HotelState, now: number): Report {
  const guest = state.spaces.filter((s) => typeOf(state, s)?.kind === "guest");
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const from = dayStart.getTime();
  const cond: Record<string, number> = {};
  const occ: Record<string, number> = {};
  const verdict: Record<string, number> = { green: 0, yellow: 0, red: 0, unknown: 0 };
  for (const s of guest) {
    const st = statusFor(state, s.id);
    const c = st.condition ? CONDITION_LABEL[st.condition.value] : "Not confirmed";
    cond[c] = (cond[c] ?? 0) + 1;
    const o = st.occupancy?.value ?? "unknown";
    occ[o] = (occ[o] ?? 0) + 1;
    verdict[verdictFor(state, s, now).level] += 1;
  }
  const woOpened = state.workOrders.filter((w) => inWindow(w.createdAt, from, now)).length;
  const woClosed = state.workOrders.filter((w) => w.closedAt && inWindow(w.closedAt, from, now)).length;
  const passes = state.ledger.filter((l) => l.kind === "inspect_pass" && inWindow(l.at, from, now)).length;
  const fails = state.ledger.filter((l) => l.kind === "inspect_fail" && inWindow(l.at, from, now)).length;
  const working = new Set(state.assignments.filter((a) => !a.done).map((a) => a.staffId)).size;
  return {
    title: "Daily rooms report", subtitle: `${state.settings.hotelName} · ${new Date(now).toDateString()} · ${guest.length} guest rooms`, generatedAt: new Date(now).toISOString(),
    sections: [
      { heading: "Ready confidence", lines: Object.entries(verdict).map(([k, v]) => `${VERDICT_LABEL[k as keyof typeof VERDICT_LABEL]}: ${v}`) },
      { heading: "Condition", lines: Object.entries(cond).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`) },
      { heading: "Occupancy", lines: Object.entries(occ).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`) },
      { heading: "Out of order", lines: guest.filter((s) => statusFor(state, s.id).engineering?.ooo).map((s) => `${s.number} — ${statusFor(state, s.id).engineering?.reason ?? ""}`).concat([]).length ? guest.filter((s) => statusFor(state, s.id).engineering?.ooo).map((s) => `${s.number} — ${statusFor(state, s.id).engineering?.reason ?? ""}`) : ["None"] },
      { heading: "Today", lines: [`Work orders opened: ${woOpened} · closed: ${woClosed}`, `Inspections passed: ${passes} · failed: ${fails}`, `People with open assignments: ${working}`] }
    ]
  };
}

/** SCAR MAP — space × failure type over a window; feeds the grid and the report */
export interface ScarMap { days: number; rooms: string[]; categories: string[]; count: (room: string, cat: string) => number; entries: (room: string, cat: string) => { at: string; text: string }[]; totalsByRoom: Record<string, number>; totalsByCat: Record<string, number>; total: number; }

export function scarMap(state: HotelState, now: number, days: number): ScarMap {
  const from = now - days * 86400000;
  const cells = new Map<string, { at: string; text: string }[]>();
  const push = (room: string, cat: string, at: string, text: string) => { const k = room + "|" + cat; cells.set(k, [...(cells.get(k) ?? []), { at, text }]); };
  const roomOf = (id: string) => { const sp = state.spaces.find((s) => s.id === id); return sp ? (clusterOf(state, sp)?.number ?? sp.number) : "?"; };
  for (const w of state.workOrders) if (inWindow(w.createdAt, from, now)) push(roomOf(w.spaceId), w.category, w.createdAt, w.text);
  for (const l of state.ledger) if (l.kind === "inspect_fail" && l.spaceId && inWindow(l.at, from, now)) push(roomOf(l.spaceId), "inspection", l.at, l.text);
  const categories: string[] = ["hvac", "plumbing", "electrical", "furniture", "minibar", "tv", "housekeeping", "other", "inspection"];
  const totalsByRoom: Record<string, number> = {}; const totalsByCat: Record<string, number> = {};
  let total = 0;
  for (const [k, list] of cells) { const [r, c] = k.split("|"); totalsByRoom[r] = (totalsByRoom[r] ?? 0) + list.length; totalsByCat[c] = (totalsByCat[c] ?? 0) + list.length; total += list.length; }
  const rooms = Object.keys(totalsByRoom).sort((a, b) => totalsByRoom[b] - totalsByRoom[a] || a.localeCompare(b, undefined, { numeric: true }));
  return {
    days, rooms, categories: categories.filter((c) => totalsByCat[c]),
    count: (r, c) => cells.get(r + "|" + c)?.length ?? 0,
    entries: (r, c) => cells.get(r + "|" + c) ?? [],
    totalsByRoom, totalsByCat, total
  };
}

export function scarReport(state: HotelState, now: number, days: number): Report {
  const m = scarMap(state, now, days);
  return {
    title: "Scar map", subtitle: `${state.settings.hotelName} · last ${days} days · ${m.total} failures`, generatedAt: new Date(now).toISOString(),
    sections: [
      { heading: "Repeat offenders", lines: m.rooms.slice(0, 10).map((r) => `${r}: ${m.totalsByRoom[r]} — ${m.categories.filter((c) => m.count(r, c)).map((c) => `${c} ×${m.count(r, c)}`).join(", ")}`) },
      { heading: "By failure type", lines: m.categories.map((c) => `${c}: ${m.totalsByCat[c]}`) }
    ]
  };
}

export function reportToText(r: Report): string {
  return [`${r.title.toUpperCase()} — ${r.subtitle}`, `Generated ${new Date(r.generatedAt).toLocaleString()}`, "",
    ...r.sections.flatMap((s) => [s.heading.toUpperCase(), ...s.lines.map((l) => "  • " + l), ""])].join("\n");
}

export type { WorkOrder };
