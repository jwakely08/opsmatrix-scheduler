# OpsMatrix — SOC 2 / Enterprise & Framework Readiness (Phase 16)

*Assessment date: 2026-08-28. This is a **readiness** view, not a claim of certification. It separates software/technical controls (evidenced from the repo) from business-process controls (which require organizational evidence not in the repo).*

> **No SOC 2 claim is made or supported.** SOC 2 requires an independent auditor's report over a defined period against the Trust Services Criteria. OpsMatrix has neither a controls program nor the technical prerequisites.

## Trust Services Criteria — readiness

| Criterion | Readiness | Notes |
|---|---|---|
| **Security (Common Criteria)** | **Low** | No access control, no logging/monitoring, no change-management gates beyond CI tests, no incident process. |
| **Availability** | **Low** | Static hosting is inherently available, but there are no backups, no DR, no monitoring/SLA, and data lives in a single browser. |
| **Confidentiality** | **Low** | No at-rest encryption; potential PHI egress to a third party; public repo exposes a real scan. |
| **Processing Integrity** | **Low–Med** | Strong test suite (172 tests) supports functional integrity of calculations, but those calculations run client-side and are user/AI-mutable with no audit (`FINDINGS_REGISTER.md` FINDING-009). |
| **Privacy** | **Low** | No privacy controls in-app; retention-enabled AI; no consent/notice framework evidenced. |

## Evidence an enterprise buyer will request (and current status)

| Evidence item | Status |
|---|---|
| SOC 2 Type II report | Absent |
| Penetration test report (independent) | Absent (this internal assessment exists) |
| Data flow / architecture diagram | **Now available** (`ARCHITECTURE_SECURITY_MAP.md`) |
| Subprocessor list + DPAs/BAAs | Subprocessors identified (Anthropic, GitHub); DPAs/BAAs absent |
| Encryption standards (at rest/in transit) | In transit only; at rest absent |
| Access control & RBAC documentation | Not applicable (none deployed) |
| Audit log samples | Absent |
| Vulnerability management policy + scan results | Partial (`npm audit`); no policy |
| SDLC / secure-coding policy | Partial (CI + tests; no security gates) |
| Business continuity / DR / IR plans | Absent |
| SBOM | Absent (recommended in CI) |

## NIST CSF 2.0 — high-level

| Function | Readiness | Gap |
|---|---|---|
| **Govern** | Low | No documented risk governance, roles, or policies evidenced. |
| **Identify** | Low–Med | Assets/data flows now mapped (this assessment); no formal asset/risk register or SBOM. |
| **Protect** | Low | No IAM, no at-rest encryption, no headers, no data-security controls. |
| **Detect** | Very Low | No logging/monitoring/alerting. |
| **Respond** | Very Low | No IR capability or plan. |
| **Recover** | Very Low | No backups/DR. |

## NIST SSDF (secure software development) — mapped

| SSDF practice | Status |
|---|---|
| PO (Prepare Org) — security requirements, roles | Absent/informal |
| PS (Protect Software) — protect code/integrity, provenance | Partial: vendored deps + build-time CDN rejection (good); no SBOM/artifact signing; actions tag-pinned |
| PW (Produce Well-Secured Software) — secure design/review, SAST | Partial: strong tests + honest review culture; no SAST/secret-scan/dep-scan gates |
| RV (Respond to Vulnerabilities) — scanning, disclosure, remediation | Partial: `npm audit` available; no scheduled scanning, no disclosure policy, an open `xlsx` CVE |

## ISO 27001-style expectations — headline

An ISMS requires documented policies, risk assessment/treatment, access control, cryptography, operations security, supplier management, incident management, and continuity — **most of which are organizational and currently absent**. Technically, the controls an ISO auditor maps to Annex A (A.5 access control, A.8 crypto, A.12 logging, A.17 continuity) are not implemented.

## Bottom line

OpsMatrix is **not enterprise-ready** for a security-reviewed procurement. The path to readiness is the same backend-introduction work required for HIPAA (auth, authZ, audit, encryption, DR, AI proxy under BAA) plus a documented controls program. The existing engineering discipline (tests, vendored deps, honesty about limitations) is a good cultural foundation to build that program on.
