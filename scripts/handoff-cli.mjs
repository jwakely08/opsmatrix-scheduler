#!/usr/bin/env node
// Claude's side of "Help from Claude" (see src/pro/handoff.ts and functions/handoff). Josh flips the
// switch on in the app and reads out a code; this talks to the mailbox under that code. Nothing here
// prints room data — only counts and file names — so client data stays out of the chat.
//
//   node scripts/handoff-cli.mjs status <code>
//   node scripts/handoff-cli.mjs get    <code> <out.json>            the device's workspace → a restorable backup file
//   node scripts/handoff-cli.mjs send   <code> <edited.json> [--note "…"] [--stores opsmatrix_v7,opsmatrix_fusion_nonspace]
//   node scripts/handoff-cli.mjs clear  <code>                       take back changes the device hasn't applied
//   node scripts/handoff-cli.mjs close  <code>                       empty the mailbox (what the switch's OFF does)
//
// HANDOFF_URL overrides the mailbox (default: the OpsMatrix Pages project).
import fs from "node:fs";

const BASE = (process.env.HANDOFF_URL || "https://staging.opsmatrix.pages.dev/handoff").replace(/\/+$/, "");
const [cmd, rawCode, file, ...rest] = process.argv.slice(2);
const code = String(rawCode ?? "").toUpperCase().replace(/[^A-Z2-7]/g, "");
if (!cmd || !/^[A-Z2-7]{16}$/.test(code)) {
  console.error("usage: handoff-cli.mjs status|get|send|clear|close <code> [file] [--note …] [--stores a,b]");
  process.exit(2);
}
const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const url = (leaf = "") => `${BASE}/${code}${leaf ? "/" + leaf : ""}`;
const show = (o) => console.log(JSON.stringify(o, null, 2));

const counts = (stores) => {
  const out = {};
  for (const [k, raw] of Object.entries(stores ?? {})) {
    try {
      const v = JSON.parse(raw);
      out[k] = k === "opsmatrix_v7"
        ? { rooms: (v.spaces ?? []).length, schedules: (v.schedules ?? []).length, employees: (v.employees ?? []).length }
        : Array.isArray(v) ? v.length : Object.keys(v ?? {}).length;
    } catch { out[k] = "(unreadable)"; }
  }
  return out;
};

if (cmd === "status") {
  const r = await fetch(url("status"));
  show(await r.json());
} else if (cmd === "get") {
  if (!file) { console.error("get needs an output file"); process.exit(2); }
  const r = await fetch(url());
  if (!r.ok) { console.error("mailbox answered " + r.status + (r.status === 404 ? " — nothing under that code (is the switch on?)" : "")); process.exit(1); }
  const ws = await r.json();
  // save as a plain backup (format + exportedAt + stores) so it restores into any OpsMatrix
  fs.writeFileSync(file, JSON.stringify({ format: ws.format, exportedAt: ws.exportedAt, stores: ws.stores }));
  show({ saved: file, rev: ws.rev, device: ws.device, exportedAt: ws.exportedAt, stores: counts(ws.stores) });
} else if (cmd === "send") {
  if (!file) { console.error("send needs the edited file"); process.exit(2); }
  const edited = JSON.parse(fs.readFileSync(file, "utf8"));
  const all = edited.stores ?? edited;
  const only = opt("--stores")?.split(",").map((s) => s.trim()).filter(Boolean);
  const stores = {};
  for (const [k, v] of Object.entries(all)) {
    if (only && !only.includes(k)) continue;
    if (k === "opsmatrix_fusion_planstudio") continue; // the pictures never travel
    stores[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  const st = await (await fetch(url("status"))).json();
  if (!st.exists) { console.error("the mailbox is empty — Josh's switch is off, or it expired"); process.exit(1); }
  const body = { id: "edit-" + Date.now().toString(36), baseRev: Number(st.rev) || 0, note: opt("--note") ?? "", stores };
  const r = await fetch(url("edits"), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) { console.error("mailbox answered " + r.status); process.exit(1); }
  show({ sent: await r.json(), baseRev: body.baseRev, stores: counts(stores) });
} else if (cmd === "clear") {
  show(await (await fetch(url("edits"), { method: "DELETE" })).json());
} else if (cmd === "close") {
  show(await (await fetch(url(), { method: "DELETE" })).json());
} else {
  console.error("unknown command " + cmd);
  process.exit(2);
}
