# OpsMatrix — HIPAA Security Rule Technical Readiness (Phase 15)

*Assessment date: 2026-08-28. This is a **technical** readiness review against the HIPAA Security Rule safeguards. It is **not** a compliance determination — HIPAA compliance is an organizational/legal conclusion involving policies, BAAs, and administrative controls outside this repository. Each item is marked TECHNICALLY VERIFIED, PARTIAL, MISSING, or REQUIRES ORGANIZATIONAL/CONTRACTUAL EVIDENCE.*

> **Headline:** OpsMatrix, as built, has **none** of the technical safeguards the Security Rule expects of a system that could hold ePHI. This is a direct consequence of being a serverless, unauthenticated, single-browser demo. It cannot currently be a HIPAA-covered application, and — critically — its AI feature actively transmits potential ePHI to a third party under retention-enabled, non-BAA terms.

---

## Access Control (§164.312(a))

| Requirement | Status | Evidence |
|---|---|---|
| Unique user identification | **MISSING** | no authentication; the public URL has no login (`deploy.yml:2-3`) |
| Emergency access procedure | MISSING | organizational; no technical support in app |
| Automatic logoff | **MISSING** | no sessions to time out; localStorage persists indefinitely |
| Encryption/decryption (at rest) | **MISSING** | localStorage cleartext (`HANDOFF.md:43`) |
| Role-based authorization | **MISSING (deployed)** | `can()` roles exist only in the dormant old app (`AuthContext.tsx`), not enforced anywhere in production |

## Audit Controls (§164.312(b))

**MISSING.** There is no audit log of any kind. The app records **none** of: login, failed login, logout, password/MFA changes (no auth exists), record create/update/delete, exports, permission changes, admin actions, access to sensitive records, or AI interactions with sensitive data. `logger.ts` writes to the browser console (ephemeral, per-device, not an audit trail). No WHO/WHAT/WHEN/WHERE/TARGET/RESULT record exists, and there is no tamper-resistant store — everything is user-writable localStorage. **This alone disqualifies the current build for ePHI.**

## Integrity (§164.312(c))

**MISSING.** No mechanism detects or prevents unauthorized modification of data. localStorage can be edited by any script or by the user via devtools. No checksums, no signing, no versioned server record. The AI assistant can *silently* modify operational records via `edit_records` (guardrails limit scope but there's no confirm/audit — see `AI_SECURITY_RED_TEAM_REPORT.md` AI-2/AI-4).

## Person/Entity Authentication (§164.312(d))

**MISSING.** No authentication mechanism deployed. (Supabase Auth is wired but inert.)

## Transmission Security (§164.312(e))

| Path | Status | Evidence |
|---|---|---|
| App download (Pages → browser) | TECHNICALLY VERIFIED (TLS) | GitHub Pages HTTPS |
| Browser → Anthropic | TECHNICALLY VERIFIED (TLS) **but** carries potential ePHI to a third party under retention-enabled, no-BAA terms | `aiPlanImport.ts:270-297,387-388` |
| Encryption enforced end-to-end for ePHI | **MISSING at rest**; transmission is encrypted but the *destination* (third-party AI, retained) is the problem | §Data-flow |

## Data Retention / Disposal

**MISSING / UNCONTROLLED.** ePHI-capable data can exist in: (a) browser localStorage — deletable only by the user clearing site data, with no assured wipe across devices; (b) **Anthropic's systems** — retained ≥30 days by the app's own instruction, outside OpsMatrix's control and with no deletion API exposed to the operator. There is no primary DB, no backups, no logs, no caches to purge because those don't exist — but the third-party retention is a real, unmanaged disposal gap.

## Minimum Necessary / Least Privilege

**PARTIAL/N-A.** No user roles → everyone with the URL sees everything in their own browser. The AI receives whole floor-plan images (more than "minimum necessary" if PHI is present). No least-privilege model exists because there is no access model.

## Contingency / Availability (§164.308(a)(7), technical aspects)

**MISSING.** No backups, no restore capability, no redundancy, no corruption detection. Data lives only in one browser; a cleared cache or a lost device = permanent data loss. No ransomware-relevant controls (also nothing for ransomware to encrypt server-side, since there is no server — but the single-copy fragility is its own availability failure).

---

## What is TECHNICALLY VERIFIED vs REQUIRES ORGANIZATIONAL/CONTRACTUAL EVIDENCE

**Technically verified (from repo):**
- TLS in transit for both hops. (PASS)
- No secrets committed; no key bundled; no CDN into key-bearing pages. (PASS — good hygiene)
- No audit logging, no auth, no at-rest encryption, no RBAC enforcement, no backups. (Verified ABSENT)
- AI path instructs retention-on and uses direct browser calls. (Verified)

**Requires organizational/contractual evidence (cannot be determined from repo):**
- Whether a BAA exists with Anthropic and with GitHub (Pages hosting). (Presumed none for a public demo.)
- Whether Anthropic account is configured for zero-data-retention / no-training. (App suggests the opposite.)
- Incident response, workforce training, risk analysis, sanction policy, contingency plan documents.

---

## What PREVENTS OpsMatrix from safely handling ePHI today (the blocking list)

1. **No authentication / no access control** — anyone with the URL, and any co-user of a shared tablet, sees the data.
2. **No audit controls** — you cannot answer "who accessed/changed this record" — a core Security Rule requirement.
3. **No encryption at rest** — ePHI would sit in cleartext localStorage.
4. **AI transmits potential ePHI to a third party** under retention-enabled, no-BAA terms.
5. **No integrity or tamper controls; no backups/DR.**
6. **Public source repo** contains a real floor scan and the live public demo exposes it (`HANDOFF.md:245`).

Until at minimum items 1–4 are resolved (which requires introducing a real backend with auth, audit logging, encrypted storage, and a BAA-covered/zero-retention AI proxy), **OpsMatrix must not process ePHI.**

---

## Future HIPAA Security Rule Hardening (forward-looking ONLY — not current requirements)

The HHS Notice of Proposed Rulemaking (Dec 2024/2025) signals a move to make several *addressable* items *required*. These are **recommendations for the future**, not today's law:
- **Mandatory encryption of ePHI at rest and in transit** (fewer "addressable" escapes) — build encrypted storage now.
- **Mandatory MFA.**
- **Mandatory network segmentation and asset inventory / mapping.**
- **Mandatory annual pen-testing (and more frequent vulnerability scanning), with written verification of controls.**
- **Mandatory 72-hour restoration capability** (real backups + tested restore).
Designing toward these now (encryption-first, MFA-first, tested backups, documented pen-tests) would position OpsMatrix ahead of the proposed rule.
