// Vendors the two pdf.js runtime files into public/pdfjs/ so they are served
// from OUR origin.
//
// Why not a CDN: the Max AI screens keep the user's Anthropic API key in this
// page's localStorage, so a third-party script tag here would be able to read
// it. Same-origin keeps the key inside our own supply chain.
//
// These are loaded lazily — only when someone actually picks a PDF — so they
// cost nothing on a normal page load.
const fs = require("fs");
const path = require("path");

const FILES = ["pdf.min.mjs", "pdf.worker.min.mjs"];
const from = path.join(__dirname, "..", "node_modules", "pdfjs-dist", "build");
const to = path.join(__dirname, "..", "public", "pdfjs");

fs.mkdirSync(to, { recursive: true });
for (const f of FILES) {
  const src = path.join(from, f);
  if (!fs.existsSync(src)) {
    console.error(`copy-pdfjs: missing ${src} — run npm install`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(to, f));
}
const version = require("../node_modules/pdfjs-dist/package.json").version;
fs.writeFileSync(path.join(to, "VERSION"), version + "\n");
console.log(`copy-pdfjs: vendored pdfjs-dist ${version} → public/pdfjs/`);
