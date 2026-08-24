// Vendors React + ReactDOM (UMD) and Tailwind 2's stylesheet to our origin.
// classic.html keeps the user's Anthropic API key in localStorage, and the
// hard rule is that no third-party script may run on a page that can read it
// — the archive's cdnjs tags are rewritten to these copies by
// make-classic.cjs (same pattern as pdf.js and SheetJS). public/vendor/ is
// gitignored; this runs automatically in every build/dev script.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "public", "vendor");

const FILES = [
  // production React (the archive asks for the development build, but the
  // deployed app has no use for dev-only warnings — smaller and faster)
  ["node_modules/react/umd/react.production.min.js", "react.production.min.js"],
  ["node_modules/react-dom/umd/react-dom.production.min.js", "react-dom.production.min.js"],
  // tailwindcss@2.2.19, pinned under the npm alias "tailwindcss-v2"
  ["node_modules/tailwindcss-v2/dist/tailwind.min.css", "tailwind.min.css"]
];

fs.mkdirSync(OUT, { recursive: true });
for (const [src, dest] of FILES) {
  const from = path.join(ROOT, src);
  if (!fs.existsSync(from)) {
    throw new Error("copy-vendor: missing " + src + " — run npm install");
  }
  fs.copyFileSync(from, path.join(OUT, dest));
  console.log("vendored", dest);
}
