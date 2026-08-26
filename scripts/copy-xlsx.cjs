// Vendors SheetJS into public/vendor/ so spreadsheets are parsed by a script
// served from OUR origin. Same reason as pdf.js: these pages keep the user's
// Anthropic API key in localStorage, so no third-party script may run on
// them. The generated classic.html gets its CDN xlsx tag rewritten to this
// copy at build time (see make-classic.cjs); the hub loads it lazily, only
// when someone actually picks an Excel file.
const fs = require("fs");
const path = require("path");

const from = path.join(__dirname, "..", "node_modules", "xlsx", "dist", "xlsx.full.min.js");
const to = path.join(__dirname, "..", "public", "vendor");

if (!fs.existsSync(from)) {
  console.error(`copy-xlsx: missing ${from} — run npm install`);
  process.exit(1);
}
fs.mkdirSync(to, { recursive: true });
const version = require("../node_modules/xlsx/package.json").version;
// Security floor: 0.19.3 fixed prototype pollution (GHSA-4r6h-8v6p-xvw6),
// 0.20.2 fixed ReDoS (GHSA-5pgg-2g8v-p4x9). The npm registry stops at the
// vulnerable 0.18.5, so package.json aliases the official 0.20.x release
// republished as @e965/xlsx — and CI verifies that republish byte-for-byte
// against cdn.sheetjs.com (.github/workflows/verify-xlsx.yml). Refuse to
// ship anything older.
const [maj, min, pat] = version.split(".").map(Number);
if (maj === 0 && (min < 20 || (min === 20 && pat < 2))) {
  console.error(`copy-xlsx: xlsx ${version} has known vulnerabilities — need >= 0.20.2`);
  process.exit(1);
}
fs.copyFileSync(from, path.join(to, "xlsx.full.min.js"));
fs.writeFileSync(path.join(to, "XLSX_VERSION"), version + "\n");
console.log(`copy-xlsx: vendored xlsx ${version} → public/vendor/`);
