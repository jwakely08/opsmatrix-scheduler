# OpsMatrix — Verifiable Security Claims (Phase 29)

*Assessment date: 2026-08-28. This tells you which security statements you can responsibly make in a sales/security conversation, and for each "no," exactly what must be done first. "Can I say this?" is answered strictly on repository evidence.*

| CLAIM | CAN I SAY THIS? | EVIDENCE / WHAT'S NEEDED |
|---|---|---|
| "Data is encrypted **in transit**." | **YES (qualified)** | All hops are HTTPS: GitHub Pages → browser, and browser → Anthropic over TLS. Say "in transit" only — not "end to end," and not "at rest." Evidence: platform TLS; `aiPlanImport.ts` uses `https://`. |
| "Data is encrypted **at rest**." | **NO** | localStorage is cleartext (`HANDOFF.md:43`). *To claim it:* introduce a backend with encrypted storage (or client-side encryption with managed keys) — non-trivial. |
| "Secrets are **not hardcoded**." | **YES** | Verified: no secret in git history or tree; no key bundled/defaulted; build fails if a CDN ref survives (`SECRETS_AUDIT.md`, `HANDOFF.md:246`). |
| "We do **not load third-party scripts from CDNs** into pages that hold the key." | **YES** | Verified and build-enforced (React/Tailwind/pdf.js/SheetJS vendored; `make-classic.cjs` rejects CDN refs). |
| "**User accounts are isolated** / customers cannot access another customer's data." | **NO (misleading)** | There are no accounts and no shared datastore. Users are separated only by their own browser's localStorage. *To claim it:* build authenticated accounts + server-enforced per-org isolation (and pen-test it). |
| "OpsMatrix supports **role-based access control**." | **NO (deployed)** | RBAC (`director/supervisor/staff`) exists only in a dormant, un-shipped module and is client-side/advisory. *To claim it:* deploy a backend that enforces roles server-side. |
| "**Administrative actions are auditable**." | **NO** | No audit logging exists anywhere. *To claim it:* implement a tamper-resistant server-side audit log (WHO/WHAT/WHEN/TARGET/RESULT). |
| "There is **authentication / login**." | **NO** | The app is public and unauthenticated. *To claim it:* add an identity provider and gate the app. |
| "**AI providers do not train on customer information**." | **NO / UNKNOWN** | Cannot be substantiated from the repo; in fact the app instructs enabling data **retention** (`aiPlanImport.ts:387-388`) and uses direct developer-key calls. *To claim it:* sign a BAA / configure zero-data-retention & no-training with the provider and keep the contractual evidence; then a proxy must enforce it. |
| "Uploaded floor plans are **only sent to Anthropic**, nowhere else." | **YES** | Verified: the only egress for uploaded image bytes / the key is `api.anthropic.com`; UI states this and it matches code (`AiPlanImport.tsx:131`, only call sites are the Anthropic URL). (Note this is a *disclosure* statement, not a safety guarantee.) |
| "The app **has no backend, so there is no server to breach**." | **YES (but frame carefully)** | True and verifiable — but pair it with the corollary that it therefore also has no auth/audit/encryption/backups. Do not let it imply "therefore secure for PHI." |
| "We keep **real hospital data out of the public repo**." | **YES** | Verified discipline: the Akron CAD workbook was deliberately not committed (`HANDOFF.md:245`). (Caveat: the owner's real *home* scan fixture IS in the public repo.) |
| "Dependencies are **free of known vulnerabilities**." | **NO** | `xlsx@0.18.5` ships with prototype-pollution + ReDoS and no npm fix; dev toolchain has more (`SOFTWARE_SUPPLY_CHAIN_REPORT.md`). *To claim it:* replace/patch `xlsx`, clear `npm audit` for shipped packages. |
| "The app enforces **security headers / CSP**." | **NO** | None present; GitHub Pages can't set them. *To claim it:* host where headers are settable and add a strict CSP + frame/HSTS/CT/Referrer/Permissions policies. |
| "OpsMatrix **can safely handle PHI**." | **NO** | Missing auth, audit, at-rest encryption, DR, and a compliant AI path; PHI can egress to a retention-enabled third party (`HIPAA_TECHNICAL_READINESS.md`). *To claim it:* complete the BLOCKER + CRITICAL tiers of `SECURITY_REMEDIATION_ROADMAP.md`. |
| "OpsMatrix **is HIPAA compliant**." | **NO — never say this** | HIPAA compliance is an organizational/legal determination requiring administrative + physical + technical safeguards, a risk analysis, BAAs, and policies — none of which are established here, and the technical safeguards are absent. |
| "OpsMatrix is **SOC 2 certified**." | **NO — never say this** | No audit, no controls program (`SOC2_ENTERPRISE_READINESS.md`). |
| "We perform **penetration testing**." | **YES (this document)** — but state scope | You can say "an internal security assessment / penetration review was performed on [date]" and share this report. Do not imply a third-party attestation. |

---

## The short honest script you can use today

> "OpsMatrix is currently a **client-side demo**: it runs entirely in the browser with no server, so there is no central database to breach and no customer data leaves the device **except** floor-plan images sent to Anthropic's AI for reading. Everything is served over HTTPS, no secrets are stored in our code, and we don't load third-party scripts into sensitive pages. It does **not yet** have logins, role-based access, audit logging, encryption at rest, or a signed AI data agreement — **so it is not ready to handle real patient information or run a hospital pilot with live data yet.** Here is the roadmap to get there."

Everything in that script is backed by evidence in this assessment. Anything beyond it is not yet true.
