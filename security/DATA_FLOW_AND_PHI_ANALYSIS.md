# OpsMatrix — Data Flow & PHI/PII Analysis

*Assessment date: 2026-08-28. Method: schema tracing from `HANDOFF.md` §4/§5, `src/pro/classicStore.ts`, `roomListImport.ts`, `aiPlanImport.ts`, and the localStorage key inventory. "Verified" means traced in code; "by design" means asserted by project docs and consistent with the code.*

---

## 1. Where data lives

All persistent data is browser `localStorage`, per-origin, unencrypted (`HANDOFF.md:43-57`). There is no server datastore. Keys:

| Key | Contents (sensitivity) |
|---|---|
| `opsmatrix_v7` | spaces, employees, schedules, logs, inspections, notes, settings — **includes `settings.maxApiKey`** |
| `opsmatrix_v7_plans` | floor-plan images (SVG data URLs) + room geometry |
| `opsmatrix_fusion_rules` | cleaning rulebook (non-sensitive) |
| `opsmatrix_fusion_nonspace` / `_aliases` / `_floorcare` | task instances, name mappings, floor-care schedules |
| `opsmatrix_max_api_key` | **dedicated backup copy of the Anthropic API key** |
| `opsmatrix_sched_v1` | old React app state |

---

## 2. Data classification

| Field / data | Classification | Where it is | Notes |
|---|---|---|---|
| Anthropic API key | **Secret / credential** | `localStorage` (2 slots), request header | Highest-value secret; readable by any script on origin. See `SECRETS_AUDIT.md`. |
| Employee names, role titles, shift, birthday | **PII (Confidential)** | `opsmatrix_v7.employees` | Demo seed includes 10 fictional employees inc. a birthday (`HANDOFF.md:104`). Real deployments would hold real staff PII. |
| Building / campus / floor / department / room identifiers, square footage, cost centers | **Internal / Confidential** | `opsmatrix_v7.spaces`, `space.source` (full CAD row preserved) | A hospital CAD export (dept names, cost centers, AHU, space definitions) is retained verbatim under `space.source` (`HANDOFF.md:145`). Operationally sensitive; can reveal facility layout. |
| Inspection results, operational notes, free-text notes | **Confidential; PHI-risk** | `opsmatrix_v7.inspections/notes` | Free-text fields. **A user could type PHI here** (e.g. "room 412 — isolation, C. diff, patient Jane Doe"). Nothing prevents it. |
| Uploaded floor-plan images / PDFs | **Confidential; PHI-risk** | transient in-browser + **sent to Anthropic** | A real hospital plan may embed patient-area labels, and the file itself is sent to a third party. |
| Uploaded spreadsheets (CAD room lists) | **Confidential** | parsed in-browser, retained under `space.source` | Real hospital location reports; not sent to Anthropic (parsed locally), but stored in localStorage. |
| Schedules, assignments | **Internal** | `opsmatrix_v7.schedules` | Printed sheets deliberately omit employee names (`HANDOFF.md:113`). |
| MRN, DOB, diagnoses, patient names (as structured fields) | **Not modeled** | — | The data model has **no** patient/clinical fields. PHI can only enter via free-text or uploaded documents (accidental), never through an intended field. |

---

## 3. End-to-end trace of the most sensitive flows

### 3a. Anthropic API key
`INPUT` (user pastes key in Admin Settings / upload dialog)
→ `localStorage` slots `opsmatrix_v7.settings.maxApiKey` **and** `opsmatrix_max_api_key` (`HANDOFF.md:54-57`; `classicStore.ts` `saveApiKey`)
→ read into request header `x-api-key` on every AI call (`aiPlanImport.ts:196,275`; `roomTypeSuggest.ts:73`)
→ **NETWORK** to `api.anthropic.com` over TLS.
- **Exposure points:** any script on the origin (XSS, malicious dependency, browser extension) can read both slots. Stored in cleartext. Not sent anywhere except Anthropic (verified: only call sites are the Anthropic URL).

### 3b. Floor-plan image (the only user content that leaves the device)
`INPUT` (file picker)
→ `FileReader`/`planFile.ts` → data URL, PDF rasterized in-browser via **vendored** pdf.js (no CDN — `HANDOFF.md:128`)
→ optional "locate drawing" pass, then base64 image + `PLAN_PROMPT` POSTed to Anthropic (`aiPlanImport.ts:200-212,280-297`)
→ Anthropic returns schema-constrained JSON (room polygons)
→ OpsMatrix **redraws** the plan itself; the source image is never shown back or stored (`HANDOFF.md:126`). The image bytes are **not** persisted to localStorage; only the redrawn SVG is.
- **Exposure point:** the image crosses to Anthropic. See §4 (retention) — this is the crux of the ePHI question.

### 3c. Uploaded room-list spreadsheet
`INPUT` → SheetJS parse **in-browser** → normalized rooms into `opsmatrix_v7.spaces`, full row under `space.source` → stays in localStorage. **Not** sent to Anthropic (the room-type *suggestion* helper sends only unclassified *type names*, not the sheet — `roomTypeSuggest.ts`, `HANDOFF.md:148` "user-triggered").

### 3d. Logs / telemetry / backup
- **Logs:** `src/lib/logger.ts` writes to the browser console only. No log SaaS, no server logs.
- **Telemetry/analytics:** none found (no analytics SDK in `package.json` or source).
- **Backups:** none — data is only in the user's browser; clearing site data destroys it irretrievably. (This is a resilience failure for healthcare, covered in `HIPAA_TECHNICAL_READINESS.md`.)

---

## 4. The retention problem (critical for ePHI)

The AI path requires the **opposite** of what a healthcare deployment needs:

- `aiPlanImport.ts:387-388` returns the user-facing error *"Claude Fable 5 needs 30-day data retention enabled on the Anthropic account."* — i.e., the app instructs the operator to **enable 30-day data retention** on their Anthropic account for the feature to work.
- The calls use a **standard developer API key** with `anthropic-dangerous-direct-browser-access: true` (`aiPlanImport.ts:198,278`). There is no indication of a Business Associate Agreement (BAA) with Anthropic, no Zero-Data-Retention configuration, and no server-side proxy that could enforce one.
- **Implication:** if a user uploads a floor plan (or any image) containing PHI, that PHI is transmitted to a third-party AI provider under a consumer/developer agreement with retention **enabled**. Absent a signed BAA and a zero-retention data path, this is an impermissible disclosure of PHI under the HIPAA Privacy/Security Rules.

---

## 5. Can users accidentally enter PHI?

**Yes — trivially, in multiple places, with nothing to stop them:**
- Free-text **notes** and **inspection comments** (`opsmatrix_v7.notes/inspections`).
- **Room names / department names** during validation (a user could rename a room "Jane Doe isolation").
- **Uploaded documents/images** (a real hospital plan or a scanned document).
- The **Max AI chat** free-text box (archive assistant) — anything typed there is sent to Anthropic.

There is no input classification, no PHI detection, no warning, and no field-level controls. The architecture does **not** technically prevent ePHI from entering the system, so per the engagement's own rule the system must be treated as potentially handling ePHI — and it is not equipped to do so.

---

## 6. Summary

| Question | Answer | Evidence |
|---|---|---|
| Where does sensitive data go? | Stays in the user's browser localStorage, **except** floor-plan images which go to Anthropic | §3 |
| Is any data encrypted at rest? | No — localStorage is cleartext | `HANDOFF.md:43` |
| Is data sent to third parties? | Yes — Anthropic (images + prompts + the API key as auth) | §3a/3b |
| Can PHI enter accidentally? | Yes, via free-text and uploads; nothing prevents it | §5 |
| Is there a compliant (BAA/zero-retention) path for PHI to the AI? | **No** — the app tells users to *enable* retention | §4 |
| Backups / recoverability? | None | §3d |
