# OpsMatrix — Penetration Test Findings Register (Phase 27)

*Assessment date: 2026-08-28. Findings ordered by severity. Severity reflects impact **given the stated goal** (piloting with a hospital / tolerating ePHI). For the current use (single-user local demo), several "High/Critical-for-healthcare" items are "by design/acceptable" — that dual framing is stated per finding.*

> **Meta-note on exploitation:** No control was *penetrated* in the classic sense, because the classic targets (server auth, tenant DB, session tokens) **do not exist**. The dominant findings are **absences of required controls** and **architecture-level data-governance gaps**, verified by code inspection — not exploited runtime bugs. Where a runtime issue is real (xlsx CVE, missing headers, no rate limit), it is marked demonstrated vs. theoretical.

---

## FINDING-001 — No authentication or access control on a healthcare-intended app
- **Severity:** Critical (for hospital goal) / By-design (for demo)
- **CVSS (est.):** 9.1 (AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N) *in a world where real facility/staff data is loaded*
- **CWE:** CWE-306 Missing Authentication for Critical Function; CWE-284 Improper Access Control
- **Component:** whole deployed app (`deploy.yml:2-3`, `HANDOFF.md:14`)
- **Preconditions:** know the public URL
- **Evidence:** the site is served publicly with no login; roles exist only in the dormant old app (`src/auth/AuthContext.tsx`).
- **Impact:** anyone (and any co-user of a shared EVS tablet) can view/edit whatever data is in that browser. No accountability. Data isolation between people relies solely on browser/localStorage separation, which is not an application control.
- **PoC (non-destructive):** open the demo URL in a fresh browser — full app loads, no credential prompt.
- **Healthcare impact:** violates HIPAA Access Control & Person Authentication; blocks any pilot with real data.
- **Remediation:** introduce a real backend with authenticated users, server-enforced RBAC, and per-org isolation before any non-demo use.
- **Verification test:** unauthenticated request to any data surface is rejected; automated test asserts no data render without a session.

## FINDING-002 — Potential ePHI transmitted to a third-party AI under retention-enabled, no-BAA terms
- **Severity:** Critical (healthcare)
- **CWE:** CWE-200 Exposure of Sensitive Information; CWE-359 Privacy Violation
- **Component:** `src/bridge/aiPlanImport.ts:270-297,387-388`; `roomTypeSuggest.ts`
- **Preconditions:** a user uploads a floor plan/image (or types into Max) that contains PHI
- **Evidence:** images are base64-POSTed to `api.anthropic.com` with `anthropic-dangerous-direct-browser-access`; the app instructs enabling **30-day retention** (`aiPlanImport.ts:387-388`); no BAA/zero-retention path exists.
- **Impact:** uncontrolled disclosure of PHI to a third party with retention outside OpsMatrix's control.
- **PoC:** the code path is unconditional for the plan-read feature; any image the user selects is transmitted. (Not fired live — would send data to a third party.)
- **Remediation:** route AI through a first-party server proxy under a BAA with zero-data-retention; strip/deny PHI client-side; require explicit consent.
- **Verification test:** confirm no direct browser→provider call remains; proxy enforces ZDR headers; DLP check on payloads.

## FINDING-003 — No audit logging of security-relevant events
- **Severity:** High (healthcare Critical)
- **CWE:** CWE-778 Insufficient Logging
- **Component:** whole app; `src/lib/logger.ts` (console only)
- **Evidence:** no create/update/delete/export/access/admin events recorded; no tamper-resistant store.
- **Impact:** breaches and misuse are undetectable and un-investigable; fails HIPAA Audit Controls.
- **Remediation:** server-side, append-only audit log (WHO/WHAT/WHEN/WHERE/TARGET/RESULT) once a backend exists.
- **Verification test:** each sensitive action produces an immutable audit entry.

## FINDING-004 — `xlsx` (SheetJS) 0.18.5 ships to the browser with Prototype Pollution + ReDoS, no npm fix
- **Severity:** High
- **CVSS (est.):** 7.5 (AV:N/AC:L/PR:N/UI:R/S:U/C:N/I:H/A:L)
- **CWE:** CWE-1321 Prototype Pollution; CWE-1333 ReDoS
- **Component:** `package.json:21` (`xlsx ^0.18.5`), used by `src/pro/sheetFile.ts`, `roomListImport.ts`, `fusion-ui.js`
- **Preconditions:** user is induced to import a crafted `.xlsx`/`.csv`
- **Evidence:** `npm audit` — high; `npm outdated` shows npm's latest is still 0.18.5 (SheetJS moved off npm).
- **Impact:** prototype pollution can corrupt client state / enable further client-side exploitation; ReDoS hangs the tab. Blast radius = the user's own session (no server/other users).
- **Remediation:** replace with the current SheetJS build from its official source (vendored, per no-CDN rule) or an alternative parser; add input size/complexity limits.
- **Verification test:** dependency audit clean for shipped packages; import a known-malicious fixture without pollution/hang.

## FINDING-005 — No security response headers (no CSP, no X-Frame-Options, etc.); clickjacking possible
- **Severity:** Medium
- **CWE:** CWE-1021 (clickjacking); CWE-693 (protection mechanism failure)
- **Component:** hosting (GitHub Pages) — cannot set headers
- **Evidence:** grep for CSP/HSTS/X-Frame/X-Content-Type/Referrer/Permissions returned nothing.
- **Impact:** no CSP backstop against injected scripts (defense-in-depth loss, meaningful because the key lives in localStorage); page can be framed for clickjacking.
- **Remediation:** serve from a host that allows headers (Cloudflare Pages/Netlify/an edge/proxy) and add a strict CSP (`script-src 'self'`), `frame-ancestors 'none'`, HSTS, `X-Content-Type-Options: nosniff`, Referrer-Policy, Permissions-Policy. A `<meta http-equiv="Content-Security-Policy">` can provide a partial CSP even on Pages.
- **Verification test:** `securityheaders.com`-style check passes; framing blocked.

## FINDING-006 — Anthropic API key stored in cleartext, script-readable localStorage
- **Severity:** Medium (High if the origin ever suffers XSS/dependency compromise)
- **CWE:** CWE-522 Insufficiently Protected Credentials; CWE-312 Cleartext Storage
- **Component:** `HANDOFF.md:54-57`; `classicStore.ts` key handling
- **Evidence:** key in `opsmatrix_v7.settings.maxApiKey` + `opsmatrix_max_api_key`, read into `x-api-key`.
- **Impact:** any script on the origin (XSS, malicious/typosquatted dep, extension) can steal the key → cost abuse + read of anything the user submits.
- **Mitigation present:** no CDN scripts on key-bearing pages; build fails if a CDN ref survives (`HANDOFF.md:246`) — shrinks the vector.
- **Remediation:** move AI calls behind a first-party proxy so the browser never holds a provider key (also fixes BAA/retention).
- **Verification test:** browser holds no long-lived provider credential.

## FINDING-007 — No client-side rate/cost limiting on AI calls
- **Severity:** Medium
- **CWE:** CWE-770 Allocation Without Limits / Uncontrolled Resource Consumption
- **Component:** `aiPlanImport.ts`, `roomTypeSuggest.ts`, Max tool loop
- **Evidence:** no throttle/budget in code.
- **Impact:** self-inflicted or manipulation-driven runaway spend on the user's key; potential loop via prompt injection.
- **Remediation:** per-minute cap + confirm on batched reads; enforce quotas at the proxy.

## FINDING-008 — Indirect prompt injection can drive AI writes to corrupt local operational data
- **Severity:** Medium
- **CWE:** CWE-77/CWE-94-adjacent (LLM prompt injection); OWASP LLM01/LLM06
- **Component:** `scripts/fusion-ui.js` (`read_data`/`edit_records`, `MAX_PLATFORM_GUIDE`) — `fusion-ui.js:891-1314`
- **Evidence:** stored strings (room names, notes, imported cells) are surfaced to the model and it can write back; guardrails (`PROTECTED` list, enums, `allow_many`) limit but don't prevent in-schema corruption; no confirm-before-write.
- **Impact:** integrity — wrong workload minutes, floor types, task lists on that device; persists across sessions.
- **Remediation:** confirm-before-write for AI edits; fence retrieved records as data; provenance tagging.

## FINDING-009 — Critical operational calculations run client-side and are user/AI-mutable
- **Severity:** Medium (Low for demo)
- **CWE:** CWE-602 Client-Side Enforcement of Server-Side Security; CWE-807 Reliance on Untrusted Inputs
- **Component:** `src/pro/rules.ts`, `workload.ts` (all math in-browser)
- **Evidence:** workload/FTE/minutes computed and stored client-side; editable via devtools or `edit_records`.
- **Impact:** staffing/workload figures used for operational (and potentially contractual) decisions can be silently altered with no server validation or audit. Business-logic abuse: altering time standards, square footage, inspection results, or bypassing approval states is unconstrained (no server to enforce workflow).
- **Remediation:** when a backend exists, compute/validate authoritative numbers server-side with audit; treat client values as advisory.

## FINDING-010 — Public repository and public demo expose a real floor scan
- **Severity:** Low (Privacy)
- **CWE:** CWE-200
- **Component:** `test-fixtures/Test_project_-_1st_Floor.dxf` + demo seed; repo is public (`HANDOFF.md:22,245`)
- **Evidence:** the project docs acknowledge the repo is public and contains the owner's real home scan, visible in the public demo.
- **Impact:** disclosure of a real building's layout. The team already (correctly) kept the real hospital CAD workbook OUT of the repo (`HANDOFF.md:245`) — good discipline; the home scan remains.
- **Remediation:** if the layout is sensitive, replace with a synthetic fixture; otherwise accept and document.

## FINDING-011 — GitHub Actions pinned to mutable tags; no SBOM/provenance
- **Severity:** Low
- **CWE:** CWE-1357 Reliance on Insufficiently Trustworthy Component
- **Component:** `.github/workflows/deploy.yml:27-40`
- **Evidence:** `@v4`/`@v5`/`@v3` tags, not SHAs.
- **Impact:** a compromised action tag could inject into the published site (which has a Pages write token).
- **Remediation:** pin to commit SHAs + Dependabot; generate SBOM; enable branch protection + required checks.

---

## Positive findings (verified controls that actually hold)
- **P-1:** No secrets in git history or current tree (`SECRETS_AUDIT.md`).
- **P-2:** No CDN scripts on key-bearing pages; build fails on any surviving CDN reference (`HANDOFF.md:246`). Strong supply-chain integrity control.
- **P-3:** AI output is schema-constrained and rigorously sanitized; never `eval`'d or DOM-injected (`aiPlanImport.ts`). No AI-driven XSS/RCE.
- **P-4:** DOM sinks in the fusion layer consistently use a correct HTML entity escaper `esc()` (`fusion-ui.js:573-578`).
- **P-5:** Service worker is network-first, same-origin-GET-only, never caches API/POST (`sw.js`).
- **P-6:** Errors are mapped to plain-English messages without leaking stacks/status codes (`aiPlanImport.ts:385-393`).
- **P-7:** 172 tests green (`HANDOFF.md`), including AI request-shape assertions — a real regression baseline to build security tests on.
