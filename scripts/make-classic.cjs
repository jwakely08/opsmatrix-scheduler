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
const seed = fs.readFileSync(path.join(ROOT, "scripts", "fusion-seed.js"), "utf8");
const ui = fs.readFileSync(UI, "utf8");

// core + demo seed go BEFORE the classic app's own script so seeded data is
// already in localStorage when the app first loads (no save-effect races);
// the UI layer goes at the end so the DOM exists.
const bodyOpen = html.search(/<body[^>]*>/);
if (bodyOpen === -1) throw new Error("classic app has no <body> — refusing to guess");
const bodyOpenEnd = html.indexOf(">", bodyOpen) + 1;
const endIdx = html.lastIndexOf("</body>");
if (endIdx === -1) throw new Error("classic app has no </body> — refusing to guess");

const preInjection =
  "\n<!-- ══ FUSION BRIDGE core + demo seed (injected at build; original archive untouched) ══ -->\n" +
  "<script>\n" + core + "\n</script>\n" +
  "<script>\n" + seed + "\n</script>\n";
const postInjection =
  "\n<!-- ══ FUSION BRIDGE UI ══ -->\n" +
  "<script>\n" + ui + "\n</script>\n";

const out =
  html.slice(0, bodyOpenEnd) + preInjection +
  html.slice(bodyOpenEnd, endIdx) + postInjection +
  html.slice(endIdx);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out, "utf8");
console.log("wrote", OUT, "(", Math.round(out.length / 1024), "KB )");
