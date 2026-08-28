# OpsMatrix — Security Remediation Roadmap (Phase 31)

*Assessment date: 2026-08-28. Prioritized by real risk toward the goal of a hospital pilot that can tolerate ePHI. Difficulty: Easy / Moderate / Significant. "Code" = code changes required.*

> **The central truth:** most BLOCKER/CRITICAL items cannot be fixed inside the current architecture, because they require a **server that does not exist**. The roadmap's spine is therefore: *introduce a minimal authenticated backend and route AI through it.* Everything else hangs off that decision. If the product is to remain a local demo, do the LOW/MEDIUM hardening and **explicitly scope it as a demo, never fed real PHI.**

---

## BLOCKER — fix before ANY hospital pilot with real/PHI data

| # | Task | Difficulty | Code | Addresses | Depends on |
|---|---|---|---|---|---|
| B1 | **Introduce an authenticated backend** (identity provider + per-organization data store) so there is a place to enforce access, audit, and encryption. The dormant Supabase schema is a reasonable starting point — but activate, migration-test, and pen-test its RLS first. | Significant | Yes | FINDING-001, HIPAA Access Control/Auth | — |
| B2 | **Route all AI calls through a first-party server proxy** under a **BAA with zero-data-retention & no-training**; stop sending the provider key to the browser; add server-side DLP/PHI checks and consent. | Significant | Yes | FINDING-002, FINDING-006, AI retention | B1 (or standalone proxy) |
| B3 | **Implement tamper-resistant, server-side audit logging** (WHO/WHAT/WHEN/WHERE/TARGET/RESULT) for auth, CRUD, exports, permission changes, and AI interactions with sensitive data. | Significant | Yes | FINDING-003, HIPAA Audit Controls | B1 |
| B4 | **Encrypt ePHI at rest** (DB-level encryption; consider field-level for the most sensitive) and stop persisting sensitive data in cleartext localStorage. | Moderate | Yes | Data-at-rest, HIPAA §164.312(a) | B1 |
| B5 | **Do not load real PHI/facility data into the current architecture.** Until B1–B4 land, keep pilots on synthetic data and say so in writing. | Easy | No (policy) | FINDING-001/002, all | — |

## CRITICAL — fix immediately (independent of the backend decision)

| # | Task | Difficulty | Code | Addresses |
|---|---|---|---|---|
| C1 | **Replace/patch `xlsx@0.18.5`** — move to SheetJS's current official build (vendored, per no-CDN rule) or an alternative; add file size/complexity limits on import. | Moderate | Yes | FINDING-004 |
| C2 | **Add client-side rate/cost limiting + confirm on batched AI reads** (and enforce quotas at the proxy once B2 lands). | Easy | Yes | FINDING-007 |
| C3 | **Confirm-before-write for AI-driven data edits** (`edit_records`/`set_*`), and fence retrieved records as data to blunt indirect prompt injection. | Moderate | Yes | FINDING-008, AI-4 |

## HIGH — fix before any production use

| # | Task | Difficulty | Code | Addresses |
|---|---|---|---|---|
| H1 | **Add security headers + a strict CSP.** Best: host where headers are settable (Cloudflare Pages/Netlify/edge) and set CSP `script-src 'self'`, `frame-ancestors 'none'`, HSTS, `X-Content-Type-Options: nosniff`, Referrer-Policy, Permissions-Policy. Interim on Pages: a `<meta http-equiv="Content-Security-Policy">` for a partial CSP. | Moderate | Yes | FINDING-005 |
| H2 | **Server-side validation of critical calculations** (workload/FTE/minutes) with audit, once a backend exists; treat client values as advisory. | Moderate | Yes | FINDING-009 |
| H3 | **Verify & fix CSV/Excel formula injection** on any export path (prefix `= + - @` cells with `'`); confirm imports don't reflect unsanitized cells into exports. | Easy | Yes | OWASP A03 note |
| H4 | **Add malware/AV scanning** for uploaded files (server-side, once B1/B2 exist) and size limits to prevent decompression/parse bombs. | Moderate | Yes | Phase 10 |

## MEDIUM — hardening

| # | Task | Difficulty | Code | Addresses |
|---|---|---|---|---|
| M1 | Pin GitHub Actions to commit SHAs + Dependabot; enable branch protection + required checks. | Easy | Yes (config) | FINDING-011 |
| M2 | Add CI security gates: secret scanning (gitleaks), dependency audit (fail on shipped high/critical), and a SAST pass (Semgrep). | Moderate | Yes (config) | SDLC gaps |
| M3 | Generate a CycloneDX SBOM in CI for enterprise evidence. | Easy | Yes (config) | SBOM absent |
| M4 | Patch dev-toolchain CVEs (vite/vitest/esbuild) for developer safety. | Easy | Yes | Supply chain (dev) |
| M5 | Replace the public real home-scan fixture with a synthetic one if the layout is sensitive. | Easy | Yes | FINDING-010 |

## LOW — defense in depth

| # | Task | Difficulty | Code | Addresses |
|---|---|---|---|---|
| L1 | Add a pre-commit secret-scan hook. | Easy | Yes (config) | Secrets hygiene |
| L2 | Subresource Integrity on any remaining external references (should be none). | Easy | Yes | Integrity |
| L3 | In-app warning when free-text/upload fields may contain PHI (nudge, not enforcement). | Easy | Yes | Accidental PHI |
| L4 | Document a vulnerability-disclosure contact and an incident-response runbook. | Easy | No (docs) | IR/CSF Respond |

---

## Sequencing

1. **Now (days):** B5, C1, C2, H3, M1, M4, L1 — cheap, high-value, no architecture change.
2. **Near (weeks):** H1 (headers/CSP, possibly a host move), C3, M2/M3, L3.
3. **Foundational (the real project):** B1 → B2 → B3 → B4 → H2/H4. This is a multi-month effort that turns OpsMatrix from a client-side demo into a backend-backed application; it is the prerequisite for *any* healthcare claim.

**Risk-based prioritization note:** B5 (don't load real PHI yet) is the single most important action — it is free and it prevents the only currently-realizable serious harm (PHI egress) while the rest is built.
