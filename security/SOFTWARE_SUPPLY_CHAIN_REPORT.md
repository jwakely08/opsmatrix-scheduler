# OpsMatrix — Software Supply Chain Report (Phase 4)

*Assessment date: 2026-08-28. Method: `npm audit`, `npm outdated`, `package.json`/lockfile review, GitHub Actions pinning review, vendored-asset review.*

---

## 1. Dependency inventory

Runtime dependencies (`package.json:15-22`): `@supabase/supabase-js ^2.45.0` (dormant), `clipper-lib ^6.4.2`, `pdfjs-dist ^4.10.38`, `react ^18.3.1`, `react-dom ^18.3.1`, `xlsx ^0.18.5`.
Dev dependencies: `@types/*`, `@vitejs/plugin-react`, `tailwindcss-v2` (alias → tailwind 2.2.19), `typescript ^5.5.3`, `vite ^5.4.0`, `vitest ^2.0.5`.

A lockfile (`package-lock.json`) is committed — good for reproducible builds.

---

## 2. `npm audit` results (verified)

```
7 vulnerabilities: 1 critical, 3 high, 3 moderate
```

| Package | Severity | Issue | Ships to browser? | Verdict |
|---|---|---|---|---|
| **xlsx (SheetJS) 0.18.5** | **HIGH** | Prototype Pollution (CVE-2023-30533) + ReDoS | **YES** — bundled & vendored, runs in-browser on user-uploaded spreadsheets | **REAL, ACT NOW** |
| vitest 2.0.5 | Critical | Vitest UI server arbitrary file read/exec | No — dev/test only | Dev-only, not shipped |
| vite 5.4.0 | High | Path traversal in optimized deps `.map`; `server.fs.deny` bypass (Windows); launch-editor NTLM | No — dev server only | Dev-only |
| esbuild | Moderate | Dev server accepts any-origin requests | No — dev only | Dev-only |
| nanoid | High | Infinite loop when size 0 | Transitive (via vite/vitest tooling) | Dev-only path |
| @vitest/mocker, vite-node | Moderate | via vite | No — dev only | Dev-only |

**Key distinction:** 6 of the 7 findings are in the **dev/test toolchain** (vite, vitest, esbuild, nanoid). Those tools are **not part of the deployed static site** — the browser never runs them — so their real-world exploitability against end users is ~nil (they matter only to a developer running `npm run dev`/`vitest` on a hostile network). They should still be patched for developer safety.

**The one that matters:** `xlsx@0.18.5` is **shipped to the browser** and executes on **attacker-influenceable input** (a user can be sent a malicious `.xlsx`/`.csv` to import). SheetJS 0.18.5 has a known **prototype pollution** flaw and a **ReDoS**. Because OpsMatrix has no server and no other users' data, the blast radius is the user's own session (prototype pollution → possible corruption of app state / a springboard for further client-side exploitation; ReDoS → tab hang). Still: it processes untrusted files and it is unpatched.

- **Fix wrinkle:** npm's registry copy of `xlsx` is stuck at 0.18.5 (SheetJS moved distribution to their own CDN, `https://cdn.sheetjs.com`). `npm outdated` shows `xlsx Latest 0.18.5` — i.e. **npm will not upgrade it**. Remediation therefore requires switching the dependency source to SheetJS's official current build (vendored, per this repo's no-CDN rule) or replacing SheetJS. See remediation roadmap.

---

## 3. Freshness (`npm outdated`)

`pdfjs-dist` 4.10.38 → latest 6.2.108 (major behind); `react`/`react-dom` 18.3.1 → 19.x (major behind, acceptable). No abandoned/deprecated top-level packages detected. `@supabase/supabase-js` is present but dormant (prod builds never instantiate it) — it still ships in the `index.html` bundle's dependency graph if imported; recommend tree-shake verification or removal from the deployed surface.

---

## 4. GitHub Actions pinning (verified)

`.github/workflows/deploy.yml` uses `actions/checkout@v4`, `setup-node@v4`, `configure-pages@v5`, `upload-pages-artifact@v3`, `deploy-pages@v4` — all pinned to **major-version tags**, not commit SHAs. Major-tag pinning is the common convention but allows a compromised tag to inject code into the build. For a repo that publishes a public site (and whose deploy token can write Pages), **pinning to full commit SHAs with Dependabot updates** is the hardening step (NIST SSDF PW.4 / PO.3).

---

## 5. Vendored third-party scripts (verified — a genuine strength)

Per hard rule 7, all third-party browser scripts are **vendored to the origin**, never CDN-loaded into any page that can see the API key:
- pdf.js (`scripts/copy-pdfjs.cjs`), SheetJS (`scripts/copy-xlsx.cjs`), React/ReactDOM/Tailwind (`scripts/copy-vendor.cjs`).
- `make-classic.cjs` **rewrites** any cdnjs `<script>` in the archive and **fails the build if any CDN reference survives** (`HANDOFF.md:246`).

This removes the classic "malicious/compromised CDN steals the localStorage key" vector and is a real, verifiable control. **Status: PASS** for this specific risk.

---

## 6. SBOM

A machine SBOM was not generated in this pass (no `cyclonedx`/`syft` available in-session), but the dependency set is small and fully enumerated above plus in `package-lock.json`. Recommend generating a CycloneDX SBOM in CI (`@cyclonedx/cyclonedx-npm`) for enterprise evidence.

---

## 7. Verdict

| Check | Status |
|---|---|
| Lockfile committed | PASS |
| Shipped-to-browser CVE | **FAIL** — `xlsx` 0.18.5 (prototype pollution + ReDoS), no npm fix |
| Dev-toolchain CVEs | PARTIAL — patch for developer safety; not user-facing |
| Actions pinned | PARTIAL — major tags, not SHAs |
| No-CDN / vendored scripts | PASS (verified, build-enforced) |
| SBOM / provenance | FAIL (absent) — recommend adding |
| Dependency-confusion/typosquat risk | LOW — all deps are well-known; `tailwindcss-v2` is an intentional alias, verified |
