# OpsMatrix — OWASP Top 10:2025 + ASVS 5.0 Control Matrix (Phases 5, 6, 7, 9, 11, 12, 13)

*Assessment date: 2026-08-28. PASS / PARTIAL / FAIL / N/A with evidence. Remember the architecture: static client-side app, no server, no auth, per-browser localStorage. Many server-side controls are N/A because the component is absent — that is not a pass.*

---

## OWASP Top 10:2025

| # | Category | Status | Evidence / reasoning |
|---|---|---|---|
| A01 | Broken Access Control | **FAIL (for stated goal)** | There is **no access control at all** on the deployed app: the demo URL is public and unauthenticated (`deploy.yml:2-3`, `HANDOFF.md:14`). The only authZ code is a client-side `can()` in the dormant old app (`AuthContext.tsx`) — trivially bypassable and not deployed. For a single-user local tool this is "by design"; for the hospital goal it is a hard fail. |
| A02 | Cryptographic Failures | **PARTIAL** | TLS in transit is provided by GitHub Pages / Anthropic (PASS). At rest: localStorage is **cleartext**, incl. the API key (FAIL). No field encryption. |
| A03 | Injection | **PASS (client-side, mitigated)** | No SQL (no DB). DOM sinks in `fusion-ui.js` use a real HTML escaper `esc()` on all interpolated untrusted values (`fusion-ui.js:573-578, 533, 550, 379`). React auto-escapes. AI output is not eval'd/injected. Residual: CSV/Excel **formula injection** on export is unverified (see A03 note below). |
| A04 | Insecure Design | **PARTIAL/FAIL (for healthcare)** | The keys-in-browser + no-server + retention-enabled-AI design is fine for a demo but structurally cannot meet healthcare requirements. Documented honestly in `HANDOFF.md` (privacy notes) — design *awareness* is good; design *fit* for hospitals is not. |
| A05 | Security Misconfiguration | **FAIL** | No CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, or Permissions-Policy anywhere (grep returned none). GitHub Pages cannot set custom headers, so the page is clickjackable and has no CSP backstop. |
| A06 | Vulnerable & Outdated Components | **FAIL** | `xlsx@0.18.5` (prototype pollution + ReDoS) ships to the browser and processes untrusted files, with no npm fix available. See `SOFTWARE_SUPPLY_CHAIN_REPORT.md`. |
| A07 | Identification & Auth Failures | **N/A / FAIL** | No authentication exists on the deployed app. Nothing to bypass because there is nothing to authenticate. For the goal: FAIL (auth required, absent). |
| A08 | Software & Data Integrity Failures | **PARTIAL** | Vendored scripts + build-time CDN-rejection is a strong integrity control (`HANDOFF.md:246`, PASS for that). But GitHub Actions are pinned to tags not SHAs (PARTIAL), no SRI/SBOM/provenance, and localStorage data has no integrity protection. |
| A09 | Security Logging & Alerting Failures | **FAIL** | No security logging exists. `logger.ts` is a console wrapper. No audit trail of any action, no alerting. Impossible without a server. |
| A10 | Mishandling of Exceptional Conditions | **PASS (mostly)** | AI errors are caught and mapped to plain-English messages without leaking status codes/stacks (`aiPlanImport.ts:385-393`). Parsers fail closed. No stack traces surfaced to users. |

---

## Phase 6 — Authentication attack testing

**Not applicable — there is no authentication system deployed.** No login, no password reset, no MFA, no sessions, no JWT, no cookies (the app sets none; it uses localStorage). Every sub-item (enumeration, brute force, session fixation, JWT confusion, cookie flags, OAuth state) has **no target**. Cookie flags (Secure/HttpOnly/SameSite): N/A — the app issues no cookies. **For the hospital goal this whole category is a FAIL by absence** (a healthcare product needs authentication). The dormant Supabase path (`AuthContext.tsx`) would delegate auth to Supabase if ever enabled — untested.

---

## Phase 7 — Authorization / tenant isolation

- **Roles discovered:** `director`, `supervisor`, `staff` — but only in the dormant old app (`AuthContext.tsx` `Role`; `0001_init.sql:10` check constraints). The deployed Classic/hub have **no roles**.
- **Vertical escalation:** N/A on the deployed app (no privileges to escalate). The client-side `can()` gate (`AuthContext.tsx`) is advisory only and would be bypassable if it governed anything (it doesn't, in prod).
- **Horizontal escalation / IDOR / BOLA:** **N/A — no server-side objects and no other users.** All IDs (`spaceId`, `scheduleId`, etc.) are keys into the *current browser's own* localStorage; there is no cross-user object to reach. Manipulating an ID only touches your own data.
- **Tenant escape:** **N/A — no tenants.** Isolation between users is provided incidentally by browser origin/localStorage separation, not by an application control.
- **If Supabase is ever enabled:** RLS on `organization_id` becomes the entire boundary — reviewed in `API_ATTACK_SURFACE.md §3`; **UNVERIFIED**, must be pen-tested live before trust.

**Was tenant isolation defeated?** There was nothing to defeat — the app has no multi-tenant datastore. This must not be reported as "isolation verified"; it is "isolation not applicable / not implemented."

---

## Phase 9 — Injection / input attacks (client-side)

| Vector | Status | Evidence |
|---|---|---|
| SQL / NoSQL / LDAP / XPath | N/A | no server, no query engine |
| Command / shell | N/A | no server |
| XSS (stored/reflected/DOM) | PASS (mitigated) | React auto-escapes; `fusion-ui.js` uses `esc()` entity-encoder on all untrusted interpolation (`fusion-ui.js:573-578`); AI output not injected. **No `eval`/`new Function`/`document.write` on untrusted input** found. |
| HTML/CSS injection | Low/PASS | same escaping |
| **CSV/Excel formula injection** | **PARTIAL/UNKNOWN** | The app *imports* spreadsheets (SheetJS) and can produce printed schedules; whether any user-controlled cell is ever written back into a downloadable CSV/XLSX without `'`-prefixing was **not** confirmed. If an export feature exists, formula injection (`=cmd|…`) is possible. Verify before claiming safe. |
| Prototype pollution | **PARTIAL** | `xlsx@0.18.5` carries a known prototype-pollution CVE and runs on untrusted files (A06). Application code does not obviously merge untrusted objects into prototypes, but the dependency does. |
| Path traversal / LFI / RFI | N/A | no server file access |
| ReDoS | PARTIAL | `xlsx` ReDoS CVE; app regexes reviewed are bounded. |
| Unsafe deserialization | Low | `JSON.parse` of localStorage/AI output, wrapped in try/catch and sanitized. |
| XXE | N/A | no XML parsing of untrusted input (DXF is a custom text parser, `parsers.ts`). |

---

## Phase 11 — Browser / web security

| Control | Status | Evidence |
|---|---|---|
| Content-Security-Policy | **FAIL (absent)** | no CSP meta or header anywhere; GitHub Pages can't set headers |
| HSTS | PARTIAL | GitHub Pages serves HSTS on `*.github.io` at the platform level; app sets none |
| X-Frame-Options / frame-ancestors | **FAIL** | none → **clickjacking possible** |
| X-Content-Type-Options | FAIL (absent) | none set |
| Referrer-Policy / Permissions-Policy | FAIL (absent) | none set |
| TLS | PASS | GitHub Pages + Anthropic enforce HTTPS |
| CORS | N/A/PASS | app exposes no API; it only calls Anthropic (CORS handled by Anthropic) |
| Cookie security | N/A | app sets no cookies |
| Browser storage of sensitive data | **FAIL** | API key + all data in cleartext localStorage, JS-readable (`HANDOFF.md:54-57`) |
| Token exposed to JS | **FAIL (by design)** | the API key is deliberately JS-accessible |

---

## Phase 12 — Database security

**N/A — no database is deployed.** Data is browser localStorage (no RLS, no encryption at rest, no backups, no db users/roles). The dormant `0001_init.sql` has RLS + `organization_id` scoping designed but never activated/tested (see `API_ATTACK_SURFACE.md §3`). Deletion behavior: clearing browser data wipes everything with no recovery (a *resilience* failure, not a *security* control).

---

## Phase 13 — Cryptography review

| Operation | Status | Evidence |
|---|---|---|
| TLS in transit | PASS | platform-provided |
| Encryption at rest | **FAIL** | none — localStorage cleartext |
| Password hashing | N/A | no passwords (no auth) |
| Token/ID generation | PASS-ish | IDs use timestamp/base36 (`aiPlanImport.ts:527,565`) — fine for local uniqueness, **not** security tokens (there are none) |
| Key storage | **FAIL** | API key cleartext in localStorage |
| Weak algos (MD5/SHA1/ECB) | PASS (none found) | no homemade crypto, no MD5/SHA1 for security |
| Randomness for security | N/A | no security-critical randomness needed (no tokens/sessions) |

No hand-rolled cryptography and no weak algorithms were found — the crypto failures are all **absence** (no at-rest encryption, key in cleartext), not misuse.

---

## ASVS 5.0 — condensed verdict by chapter

| ASVS chapter | Verdict | Note |
|---|---|---|
| V1 Encoding/Injection | PASS (client) | escaping in place; formula-injection unverified |
| V2 Validation/Business Logic | PARTIAL | client-side calc trusted; see business-logic findings |
| V3 Web Frontend / headers | FAIL | no CSP/frame/CT headers |
| V6 Authentication | N/A→FAIL | none deployed |
| V8 Authorization | N/A→FAIL | none deployed |
| V7 Session Management | N/A | no sessions |
| V9 Self-contained tokens (JWT) | N/A | none |
| V10 OAuth/OIDC | N/A | none |
| V11 Cryptography | FAIL | no at-rest encryption; key cleartext |
| V12 Secure Comms | PASS | TLS |
| V13 Config | FAIL | headers, component CVE |
| V14 Data Protection | FAIL | localStorage cleartext, third-party AI egress |
| V15 Secure Coding/Deps | FAIL | `xlsx` CVE |
| V16 Logging | FAIL | no security logging |
| V17 WebRTC/other | N/A | — |
