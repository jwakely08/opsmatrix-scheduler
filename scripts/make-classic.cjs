// Builds public/classic.html = the UNTOUCHED classic app (opsmatrix-v5) with
// the fusion bridge injected before </body>. The original archive file is
// read-only input — never modified.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "opsmatrix-v5-maxplans.html");
const CORE = path.join(ROOT, "scripts", "out", "fusion-core.iife.js");
const CORE_ALT = path.join(ROOT, "scripts", "out", "fusion-core.js");
const UI = path.join(ROOT, "scripts", "fusion-ui.js");
const OUT = path.join(ROOT, "public", "classic.html");

const html = fs.readFileSync(SRC, "utf8");
const corePath = fs.existsSync(CORE) ? CORE : CORE_ALT;
const core = fs.readFileSync(corePath, "utf8");
const ui = fs.readFileSync(UI, "utf8");

const marker = "</body>";
const idx = html.lastIndexOf(marker);
if (idx === -1) throw new Error("classic app has no </body> — refusing to guess");

const injection =
  "\n<!-- ══ FUSION BRIDGE: magicplan auto-detection (injected at build; original archive untouched) ══ -->\n" +
  "<script>\n" + core + "\n</script>\n" +
  "<script>\n" + ui + "\n</script>\n";

const out = html.slice(0, idx) + injection + html.slice(idx);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out, "utf8");
console.log("wrote", OUT, "(", Math.round(out.length / 1024), "KB )");
