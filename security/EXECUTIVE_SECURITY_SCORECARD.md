# OpsMatrix — Executive Security Scorecard (Phase 28)

*Assessment date: 2026-08-28. Scores are 0–100, judged against what a healthcare-intended SaaS is expected to have. A serverless demo scoring low here is not a bug report against the demo — it is a measure of the distance to "safe for a hospital pilot." Scores are not inflated; absence of a control scores low even where the absence is "by design."*

| Category | Score | Why |
|---|---:|---|
| **Authentication** | 5 | No authentication deployed at all; roles exist only in a dormant, un-shipped module. Nothing to bypass because nothing exists. (`OWASP_ASVS_MATRIX.md` Phase 6) |
| **Authorization** | 5 | No server-side authZ; client-side `can()` is inert and bypassable; deployed app has no roles. |
| **Tenant Isolation** | 10 | No multi-tenant datastore exists. Users are separated only incidentally by browser/localStorage. Not an application control; cannot be relied on for real data. Scored low because the *capability* is absent, though it also cannot be *breached*. |
| **API Security** | 30 | No first-party API to attack (neutral), but the one egress path lacks rate/cost control and puts the key in the browser. Output handling is good. |
| **Web Security** | 25 | No CSP/HSTS/frame/CT headers (clickjackable, no CSP backstop); but escaping and TLS are in place. |
| **Data Protection** | 15 | Cleartext localStorage; potential ePHI egress to a retention-enabled third party; no at-rest encryption. TLS in transit is the only real control. |
| **Cryptography** | 35 | TLS present; no weak/homemade crypto (good), but zero at-rest encryption and cleartext key storage. |
| **Secrets Management** | 55 | No committed/bundled secrets, no CDN exposure, build-enforced (strong); but the runtime key sits unprotected in localStorage. |
| **Dependency Security** | 40 | Lockfile + vendored, build-enforced no-CDN (strong); but a shipped `xlsx` CVE with no npm fix, dev-toolchain CVEs, tag-pinned actions, no SBOM. |
| **Infrastructure** | 45 | Static hosting removes whole classes of infra risk (no servers/buckets/IAM to misconfigure); but no headers, no WAF, no environment separation, public repo. |
| **Logging / Auditability** | 5 | No security logging or audit trail of any kind. |
| **Backup / Recovery** | 5 | No backups; data exists only in one browser; no restore/DR. |
| **AI Security** | 45 | Excellent output handling (schema-constrained, sanitized, not injected) and bounded tool agency; but retention-enabled no-BAA egress, no rate limiting, indirect-injection write path, no confirm-before-write. |
| **HIPAA Technical Readiness** | 8 | Essentially none of the Security Rule technical safeguards are present (access control, audit, integrity, at-rest encryption, DR all missing). |
| **Privacy** | 30 | Good discipline keeping real hospital data out of the repo; but public repo exposes a real scan, and PHI can egress to AI. No privacy controls in-app. |
| **Secure SDLC** | 45 | CI runs tests before deploy, good docs/honesty culture, vendored deps; but no SAST/secret-scan/dependency-scan gates, no branch protection evidence, tag-pinned actions. |

## Overall

**Weighted overall: ~24/100 → Rating: D (High risk) — for the stated goal of a hospital pilot with potential ePHI.**

- As a **public single-user demo tool**, its *actual current* risk to anyone is low (there is no shared data to breach, no server to compromise, and the worst realistic outcome is the demo user's own API key or local data being affected). Judged narrowly as "a demo," it would land around **C**.
- As a **candidate healthcare SaaS handling real facility/staff data or ePHI**, it is a **D / high risk**: it lacks authentication, authorization, audit logging, at-rest encryption, backups, and a compliant AI data path — every foundational control a hospital security review requires.

The single-letter answer people will act on: **D — Needs foundational security architecture (a real backend with auth, authZ, audit, encryption, and a BAA-covered AI proxy) before it can be considered for any environment holding real or protected data.**

*(An "F — Critical security weaknesses" was considered. It is withheld only because the app, in its current deployed form, holds no other party's data and exposes no server to compromise; the failures are of *missing capability for the intended goal*, not of an actively breachable production system leaking real PHI today. If real facility/staff/PHI data were loaded into the current architecture, this would be an F.)*
