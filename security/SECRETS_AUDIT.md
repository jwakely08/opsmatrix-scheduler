# OpsMatrix — Secret & Credential Audit (Phase 3)

*Assessment date: 2026-08-28. Method: full git-history regex scan (`git log --all -p`), current-tree grep, `.gitignore` review, added-file history review. Secrets, if any, are shown masked.*

---

## 1. Git history scan — result: CLEAN

Command run (masked output):
```
git log --all -p | grep -iE 'sk-ant-...|api[_-]?key = "..."|AKIA...|-----BEGIN ... PRIVATE KEY|password = "..."|secret = "..."'
```
**No matches** across all branches and all history. No Anthropic keys (`sk-ant-…`), AWS keys (`AKIA…`), private keys, or hardcoded passwords were ever committed.

Files ever *added* matching `.env|secret|credential|.pem|.key`: **only `.env.example`** (a template with placeholder values, no real secret — `.env.example:3-4` contains `YOUR-PROJECT-ref` / `YOUR-ANON-PUBLIC-KEY`).

**Status: PASS.** No secret has been committed to this repository at any point in its history.

---

## 2. `.gitignore` hygiene — result: adequate

`.gitignore:3-6`:
```
.env
.env.*
!.env.example
*.local
```
- `.env` and all `.env.*` variants are ignored (with `.env.example` allowed through). `*.local` covers Vite's `.env.local` convention.
- Also ignores `node_modules/`, `dist/`, `scripts/out/`, vendored `public/pdfjs/` and `public/vendor/`, and `/Test_project_Statistics.csv`.
- **Gap (low):** there is no ignore rule for editor/OS secret stores beyond `.DS_Store`/`Thumbs.db`, and no automated pre-commit secret-scan hook. A developer could still `git add -f` a `.env`. Recommend a `gitleaks`/`trufflehog` pre-commit hook and a CI secret-scan step.

**Status: PASS (with a defense-in-depth recommendation).**

---

## 3. Runtime secret handling — result: STRUCTURAL WEAKNESS (by design of a client-only app)

The one secret the app handles at runtime is the **user's Anthropic API key**:
- Stored in **two** cleartext `localStorage` slots: `opsmatrix_v7.settings.maxApiKey` and `opsmatrix_max_api_key` (`HANDOFF.md:54-57`).
- Read into the `x-api-key` header on every AI call (`src/bridge/aiPlanImport.ts:196,275`; `roomTypeSuggest.ts:73`).
- The UI asserts to the user: *"It is never sent anywhere except Anthropic."* (`src/pro/AiPlanImport.tsx:131`) — this is **verified true**: the only fetch destinations for the key are `https://api.anthropic.com/v1/messages`.

**Weaknesses (inherent to a keys-in-browser design):**
1. **Readable by any script on the origin.** Any XSS, any compromised/typosquatted dependency, or any malicious browser extension can exfiltrate the key from `localStorage`. There is no HttpOnly cookie, no server-side vault, no scoping. Risk: **High** (a leaked key = attacker can spend the user's Anthropic budget and read anything the user sends).
2. **No key rotation, expiry, or revocation mechanism** in-app — the user must rotate at Anthropic manually.
3. **The project's own hard rule mitigates the worst case:** no key is ever bundled/defaulted, and no third-party scripts are loaded from a CDN into any page that can see the key (React/Tailwind/pdf.js/SheetJS are all vendored to the origin — `HANDOFF.md:57,128,151`). This meaningfully shrinks the "malicious CDN steals the key" attack surface. **Verified:** `make-classic.cjs` "fails the build if any CDN reference survives" (`HANDOFF.md:246`).

**Status: PARTIAL.** No secret is committed or bundled (the committable-secret controls PASS), but at runtime the user's key sits in the browser's most script-accessible store with no isolation. For a demo tool this is a reasonable trade-off; for anything handling sensitive data it is not.

---

## 4. Build-artifact & example/test review

- No credentials in build scripts (`scripts/*.cjs`), test files, or `public/classic.html` (generated) — the key slots are read from localStorage, never seeded.
- `.env.example` holds placeholders only.
- CI (`deploy.yml`) uses **no secrets** — it deploys a static site with GitHub's OIDC Pages token (`id-token: write`), not any app secret.

**Status: PASS.**

---

## 5. Verdict

| Check | Status |
|---|---|
| Secrets in git history | PASS (none) |
| Secrets in current tree | PASS (none) |
| `.gitignore` covers env files | PASS |
| Automated secret-scanning in CI/pre-commit | **FAIL (absent)** — recommend adding |
| Runtime key isolation | PARTIAL — cleartext in localStorage, script-readable |
| Key ever bundled/defaulted/CDN-exposed | PASS (verified not) |

**"Secrets are not hardcoded" is a claim you can responsibly make** (see `VERIFIABLE_SECURITY_CLAIMS.md`). "Secrets are securely managed at runtime" is **not**, because the user's key lives unprotected in browser storage.
