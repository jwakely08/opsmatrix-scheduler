# OpsMatrix — session bootstrap

**Read `HANDOFF.md` (repo root) before doing anything else.** It is the complete, current project brief: architecture, data model, task-ownership concept, rules engine, geometry pipeline, demo seed, live links, and open items. This file is only the summary that gets you there.

## What this is

OpsMatrix is Josh Wakely's hospital EVS (Environmental Services) operations platform: floor plans in (magicplan scans, pictures, PDFs), rooms auto-detected, cleaning workloads calculated from healthcare production rates, visual staff schedules built on the floor plan, printable daily schedule sheets out. Josh demos it live to potential clients from GitHub Pages.

**Guiding UX principle: a 60-year-old EVS manager who barely uses computers must be able to run it without training.** Plain language, no jargon, consumer-tile aesthetic.

## Hard rules (never violate; full list in HANDOFF.md §16)

1. `opsmatrix-v5-maxplans.html` is a read-only archive — NEVER modify it. `public/classic.html` is generated from it by `npm run build:classic`.
2. `test-fixtures/*.dxf|csv` are Josh's real magicplan exports — never regenerate or substitute them.
3. **No hover tooltips anywhere** (Josh's explicit rule).
4. Never claim success without running `npm test` and verifying in the browser; report failures honestly.
5. Every push to main auto-deploys to the live demo (~35s) — commit and push only when green.
6. Never commit or bundle an API key; never load third-party scripts from a CDN into pages that hold the user's key (vendor them, like pdf.js).

## Commands

```
npm test               # vitest — 146 tests, must stay green
npm run build:classic  # REQUIRED after touching src/bridge/*, src/pro/rules.ts, or scripts/fusion-*.js — else classic.html ships stale (the #1 gotcha)
npm run build          # MPA build: index.html + maps.html
npm run dev            # vite dev server on 5173 (serves /classic.html and /test-fixtures/* too)
```

## Before ending a session

If you shipped meaningful changes, update `HANDOFF.md` (date in the header, plus whichever sections changed) so the next fresh chat starts fully briefed.
