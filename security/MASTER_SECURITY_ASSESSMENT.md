# OpsMatrix Security Assessment

*Combined Application Security, Penetration Test, Healthcare/HIPAA, and AI Red-Team review. Assessment date: 2026-08-28. Method: repository inspection, dependency & git-history scanning, source tracing, and code-level analysis of every security-relevant path. Evidence is cited by file/line throughout the per-phase reports in `security/`. Nothing here is asserted without repository evidence; where a control could not be determined from the repo, it is marked UNKNOWN, and where a control is simply absent, it is marked absent — not "pass."*

---

## Overall Security Rating: **D (High risk) for the stated goal**

**Can I responsibly pilot this with a hospital today?** → **NO.**

OpsMatrix, as built and deployed, is a **100% client-side static web application** (GitHub Pages) with **no backend, no database, no authentication, no authorization enforcement, no audit logging, and no encryption at rest.** All data lives in the visitor's own browser localStorage; the only data that leaves the device is floor-plan imagery sent directly to Anthropic's AI. A hospital security review requires — at minimum — authenticated identities, role-based access control, tamper-resistant audit logs, encryption at rest, a tested backup/DR capability, and a BAA-covered data path for any AI processing. **OpsMatrix has none of these.** This is not the result of exploitable bugs; it is the direct consequence of the architecture. It is an excellent-looking, well-engineered *demo*, and it should be described and used as exactly that until a real backend is introduced.

**Can the current application safely process ePHI?** → **NO.**

Evidence: (1) there is no access control — the app is public and unauthenticated (`deploy.yml:2-3`); (2) there is no audit trail of any kind; (3) data at rest is cleartext localStorage; (4) the AI feature transmits uploaded images (potential PHI) to Anthropic and the app itself instructs the operator to **enable 30-day data retention** (`src/bridge/aiPlanImport.ts:387-388`), with no BAA or zero-retention path evident; (5) users can trivially type PHI into free-text notes/inspection fields with nothing to prevent it. Until the BLOCKER items in the roadmap are complete, **no real patient data may enter this system.**

---

## Critical vulnerabilities (for the healthcare goal)
1. **No authentication / access control** on a healthcare-intended app (FINDING-001).
2. **Potential ePHI egress to a third-party AI** under retention-enabled, no-BAA terms (FINDING-002).

## High vulnerabilities
3. **No audit logging** of any security-relevant event (FINDING-003).
4. **Shipped `xlsx@0.18.5`** with prototype-pollution + ReDoS, no npm fix, running on untrusted uploads (FINDING-004).

## Medium
5. **No security headers / CSP; clickjacking possible** (FINDING-005).
6. **API key in cleartext, script-readable localStorage** (FINDING-006).
7. **No AI rate/cost limiting** (FINDING-007).
8. **Indirect prompt injection → AI can corrupt local operational data** (FINDING-008).
9. **Critical calculations run client-side, user/AI-mutable, no audit** (FINDING-009).

## Low
10. Public repo/demo exposes a real floor scan (FINDING-010).
11. GitHub Actions tag-pinned; no SBOM/provenance (FINDING-011).

*(Full detail, CVSS, CWE, PoC, and remediation for each in `security/FINDINGS_REGISTER.md`.)*

---

## Major strengths (verified controls that genuinely hold)
- **No secrets ever committed** — clean git history and working tree (`SECRETS_AUDIT.md`).
- **No CDN scripts on key-bearing pages** — React/Tailwind/pdf.js/SheetJS vendored; the build **fails if any CDN reference survives**, and the generated `classic.html` was verified CDN-free (`SOFTWARE_SUPPLY_CHAIN_REPORT.md`, regression-tested in `src/security.test.ts`).
- **Careful AI output handling** — schema-constrained responses, rigorously sanitized, never `eval`'d or DOM-injected; no AI-driven XSS/RCE (`AI_SECURITY_RED_TEAM_REPORT.md`).
- **Consistent output encoding** — DOM sinks use a correct HTML entity escaper; React auto-escapes.
- **Honest engineering culture** — 172 (now 179) green tests, documented limitations, and disciplined exclusion of real hospital data from the public repo.

---

## HIPAA technical readiness
Essentially **zero** of the Security Rule technical safeguards are implemented (access control, audit controls, integrity, person authentication, at-rest encryption, contingency/DR). TLS-in-transit is the only present control. The AI path actively works against a healthcare posture (retention enabled, no BAA). Full mapping in `HIPAA_TECHNICAL_READINESS.md`, including a forward-looking (non-binding) section on the proposed HIPAA Security Rule changes.

## AI security readiness
**Split verdict.** Output handling and tool-agency bounds are **good** (schema-constrained, sanitized, tools act only on local data, guardrails on `edit_records`). Data governance is **poor** (PHI can leave to a retention-enabled, non-BAA endpoint; no rate limiting; indirect-injection write path; no confirm-before-write). The good parts cannot compensate for the egress problem, which requires a first-party proxy under a BAA to fix.

## Enterprise readiness
Not ready for a security-reviewed procurement: no SOC 2, no audit, no logging/monitoring, no DR, no IAM. Good SDLC foundations (CI tests, vendored deps) exist to build on. See `SOC2_ENTERPRISE_READINESS.md`.

---

## What is technically verified vs. what remains unverified

**Technically verified (from the repo):**
- Architecture is fully client-side; no server/DB/auth deployed.
- No secrets in history/tree; no key bundled; no CDN on key-bearing pages (build-enforced).
- TLS on all network hops; AI endpoint is HTTPS.
- AI output is schema-constrained and sanitized; not injected/eval'd.
- `xlsx` CVE ships to the browser; 6 other CVEs are dev-toolchain-only.
- No CSP/security headers; no audit logging; no at-rest encryption.
- AI path instructs retention-on via direct browser calls.

**Unverified / requires evidence outside the repo:**
- Whether any BAA/DPA exists with Anthropic or GitHub; Anthropic account retention/training configuration (**do not assume favorable**).
- The dormant Supabase RLS design is reasonable on paper but **never activated or pen-tested** — must be validated live before any reliance.
- Organizational controls (IR, BC/DR, risk analysis, workforce training).

---

## Top 10 actions before a hospital security review
1. **Do not load real/PHI data into the current architecture** (free, immediate).
2. Stand up an **authenticated backend** with per-organization isolation.
3. Route **all AI through a first-party proxy** under a **BAA with zero data retention**; stop shipping the key to the browser.
4. Implement **tamper-resistant server-side audit logging**.
5. **Encrypt sensitive data at rest.**
6. **Replace/patch `xlsx`** and add import size/complexity limits.
7. **Add security headers + a strict CSP** (host where headers are settable).
8. **Confirm-before-write** for AI edits; add AI **rate/cost limits**.
9. **Server-side validation** of workload/FTE calculations with audit.
10. Add **CI security gates** (secret scan, dependency audit, SAST) and **pin Actions to SHAs**.

## Top 10 questions a hospital CISO will ask (and today's honest answer)
1. HIPAA compliant? — **No.** 2. Sign a BAA? — **Unknown/organizational.** 3. Encrypted at rest? — **No.** 4. MFA/SSO? — **No.** 5. RBAC? — **No (deployed).** 6. Audit logs? — **No.** 7. Pen-tested? — **Internally (this report); not third-party.** 8. Backups/DR? — **No.** 9. Does AI retain our data? — **Yes, by the app's own instruction.** 10. Tenant isolation? — **Not implemented (per-browser only).** *(Full set: `HOSPITAL_SECURITY_QUESTIONNAIRE.md`.)*

## Recommended penetration-test follow-up
Once a backend exists: authenticated + unauthenticated API testing, RLS/tenant-isolation testing against the live Supabase (or replacement), IDOR/BOLA on every object ID, the AI proxy's authZ and rate limits, upload malware/parse-bomb handling, and a full security-header/CSP validation. Re-run this assessment against the new architecture — the current "N/A because no server" answers will become real, testable controls.

---

## Where all reports were saved

All under `security/` in the repository:
- `MASTER_SECURITY_ASSESSMENT.md` (this file)
- `ARCHITECTURE_SECURITY_MAP.md` (Phase 1, incl. Mermaid data-flow diagram)
- `DATA_FLOW_AND_PHI_ANALYSIS.md` (Phase 2)
- `SECRETS_AUDIT.md` (Phase 3)
- `SOFTWARE_SUPPLY_CHAIN_REPORT.md` (Phase 4)
- `OWASP_ASVS_MATRIX.md` (Phases 5, 6, 7, 9, 11, 12, 13)
- `API_ATTACK_SURFACE.md` (Phase 8)
- `AI_SECURITY_RED_TEAM_REPORT.md` (Phase 14)
- `HIPAA_TECHNICAL_READINESS.md` (Phase 15)
- `SOC2_ENTERPRISE_READINESS.md` (Phase 16)
- `FINDINGS_REGISTER.md` (Phase 27, all findings with CVSS/CWE/PoC/remediation)
- `EXECUTIVE_SECURITY_SCORECARD.md` (Phase 28)
- `VERIFIABLE_SECURITY_CLAIMS.md` (Phase 29)
- `HOSPITAL_SECURITY_QUESTIONNAIRE.md` (Phase 30)
- `SECURITY_REMEDIATION_ROADMAP.md` (Phase 31)
- Regression tests: `src/security.test.ts` (Phase 32) — 7 tests, part of the green suite (179 total).

---

### One-paragraph bottom line
OpsMatrix is a carefully built, honestly documented **client-side demo** with good hygiene in the few areas it controls (no committed secrets, no CDN on sensitive pages, disciplined AI output handling). But it is **architecturally incapable, today, of meeting the security bar for a hospital pilot or for handling ePHI**, because it has no backend and therefore no authentication, authorization, audit logging, encryption at rest, or compliant AI data path — and it will transmit whatever a user uploads to a third-party AI with retention enabled. Treat it as a demo on synthetic data only; the path to a real product runs through introducing an authenticated, audited, encrypted backend and a BAA-covered AI proxy, as laid out in the remediation roadmap.
