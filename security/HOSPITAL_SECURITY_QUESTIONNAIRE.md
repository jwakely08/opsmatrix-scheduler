# OpsMatrix — Hospital Vendor Security Questionnaire (Phase 30)

*Assessment date: 2026-08-28. These are the questions a US health-system security team typically asks during vendor review, answered from repository evidence. Legend: **YES — VERIFIED** / **PARTIALLY** / **NO** / **UNKNOWN** (needs info outside repo) / **N/A**. No favorable answer is fabricated.*

| # | Question | Answer | Basis |
|---|---|---|---|
| 1 | Is the product HIPAA compliant? | **NO** | Compliance is organizational; technical safeguards are absent (`HIPAA_TECHNICAL_READINESS.md`). |
| 2 | Will you sign a BAA? | **UNKNOWN** | Organizational/legal; nothing in repo. A BAA with your subprocessor (Anthropic) and host would also be required. |
| 3 | Is ePHI/PHI encrypted at rest? | **NO** | Data in cleartext browser localStorage. |
| 4 | Is data encrypted in transit? | **YES — VERIFIED** | HTTPS/TLS on all hops. |
| 5 | Do you enforce MFA? | **NO** | No authentication at all. |
| 6 | Do you support SSO / SAML / OIDC? | **NO (deployed)** | Supabase Auth wired but inert; no SSO. |
| 7 | Is there role-based access control? | **NO (deployed)** | RBAC only in dormant module, client-side/advisory (`AuthContext.tsx`). |
| 8 | Is there audit logging of access and changes? | **NO** | No audit trail exists. |
| 9 | Do you perform penetration testing? | **PARTIALLY** | Internal assessment done (this report); no independent third-party attestation. |
| 10 | Do you run vulnerability scanning / manage patches? | **PARTIALLY** | `npm audit` available; a shipped `xlsx` CVE is currently unpatched; no scheduled scanning in CI. |
| 11 | What is your breach notification process? | **UNKNOWN** | Organizational; none in repo. |
| 12 | Do you carry cyber insurance? | **UNKNOWN** | Organizational. |
| 13 | Are backups performed and tested? | **NO** | No backups; data in one browser only. |
| 14 | Business continuity / disaster recovery plan? | **NO / UNKNOWN** | No technical DR; no plan in repo. |
| 15 | Incident response plan? | **UNKNOWN** | Organizational; none in repo. |
| 16 | Data retention policy? | **PARTIALLY / adverse** | App instructs enabling 30-day AI retention (`aiPlanImport.ts:387-388`); no in-app retention controls. |
| 17 | Can data be permanently deleted on request? | **PARTIALLY** | Local data: user clears browser storage (no cross-device assurance). Data sent to Anthropic: retained, no operator deletion path. |
| 18 | Who are your subprocessors? | **Anthropic** (AI) and **GitHub** (hosting) | `aiPlanImport.ts`, `deploy.yml`. No DPA/BAA evidence with either. |
| 19 | Does AI use customer data, and is it retained? | **YES, and retained** | Floor-plan images/prompts sent to Anthropic; retention instructed on. |
| 20 | Do AI providers train on our data? | **UNKNOWN** | Governed by provider terms/account config; not evidenced. Do not assume "no." |
| 21 | Do you follow a secure SDLC? | **PARTIALLY** | CI tests before deploy, vendored deps, honesty culture; but no SAST/secret-scan/dep-scan gates, no branch-protection evidence. |
| 22 | SOC 2 report available? | **NO** | No controls program/audit (`SOC2_ENTERPRISE_READINESS.md`). |
| 23 | Where is the app hosted / where does data reside? | **GitHub Pages (static); data resides in the user's browser** | `deploy.yml`. AI data transits to Anthropic (US-region per provider). |
| 24 | Authentication mechanism? | **NONE** | Public unauthenticated app. |
| 25 | Do you conduct access reviews? | **N/A** | No accounts to review. |
| 26 | Is PHI collected or processed? | **Not by design, but possible** | No patient fields; PHI can enter via free-text/uploads and reach AI (`DATA_FLOW_AND_PHI_ANALYSIS.md`). |
| 27 | Malware protection / scanning of uploads? | **NO** | Uploads parsed client-side; no AV scanning. |
| 28 | Are secrets hardcoded anywhere? | **NO — VERIFIED** | Clean history + tree (`SECRETS_AUDIT.md`). |
| 29 | How is tenant isolation achieved? | **NOT IMPLEMENTED** | No multi-tenant datastore; only per-browser separation. |
| 30 | Network segmentation / firewall posture? | **N/A** | No servers to segment; static hosting. |
| 31 | Do you use a WAF / DDoS protection? | **PARTIALLY** | Inherited from GitHub Pages/CDN edge; no app-level WAF. |
| 32 | Session timeout / automatic logoff? | **NO** | No sessions. |
| 33 | Do you support data export in a portable format? | **PARTIALLY** | Local data is in localStorage; printable schedules exist; no governed export/audit. |
| 34 | Content Security Policy and security headers? | **NO** | None set; host can't set headers. |
| 35 | Third-party components inventory (SBOM)? | **PARTIALLY** | Enumerated in `package-lock.json`/reports; no generated SBOM. |
| 36 | Vulnerability disclosure / bug bounty? | **UNKNOWN** | None in repo. |

## Summary for the reviewer

OpsMatrix today is a **client-side demonstration application**, not a HIPAA-ready SaaS. It has **no authentication, no authorization enforcement, no audit logging, no encryption at rest, no backups, and no BAA-covered AI data path**, and it can transmit uploaded content (potentially PHI) to a third-party AI with retention enabled. It has some genuinely good hygiene (no committed secrets, no CDN scripts on key-bearing pages, careful AI output handling), but those do not offset the foundational gaps. **Recommendation to a health system: do not pilot with live/PHI data until the BLOCKER and CRITICAL items in `SECURITY_REMEDIATION_ROADMAP.md` are complete and independently verified.**
