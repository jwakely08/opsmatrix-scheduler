# bench/ — the floor-plan detection benchmark

Measures the no-sizes upload flow end to end on a real dense hospital sheet
(Franciscan Lafayette Central, 2nd floor, 11x17, ~200 rooms): render → locate
→ crop → tile → read → merge → ingest/snap, scored against a hand-labelled
answer key for the EW wing (rooms 2101–2156).

**Privacy: nothing derived from the real plan is committed.** The PDF, the
answer key, the per-tile readings and the supplement are all gitignored
(public repo, real hospital). Scripts regenerate everything from a dropped-in
PDF. Committed here are only the tools.

## Running it

```
npm run dev                          # vite on :5173 (serves /bench too)
cp <the pdf> bench/fixtures/central-2nd-floor.pdf
echo '{ "x0": 0.03, "y0": 0.05, "x1": 0.97, "y1": 0.90 }' > bench/readings/locate.json
node bench/tiles.mjs                 # production crop + tile analysis → tile PNGs
node bench/regions.mjs 0 1 2 ...     # local detector → region polygons + overlays
node bench/bubbles.mjs 0.38 0.5 0.88 0.7 2600   # (key building) bubble montage
node bench/make-key.mjs              # index→number map (hand-verified) → answer key
node bench/verify-key.mjs            # eyeball the key points on the sheet
node bench/build-readings.mjs        # regions + key → per-tile "AI readings"
node bench/score.mjs                 # THE SCORE + bench/out/score-overlay.png
node bench/score.mjs --jitter 0.015  # robustness: sloppy-model simulation
```

The Anthropic API is stubbed (per-tile readings + canned locate box): the
sandbox this was built in cannot reach the API, and a deterministic reader
makes runs comparable. The reading stand-in is the LOCAL detector's region
polygons (planSnap.autoDetectRooms at tile resolution, bubbles erased,
door/window gaps sealed) labelled by answer-key containment — geometry from
detection, numbers from the key, misses stay missing. Rooms the region
reader can't separate but a vision model plainly reads (wide lobby
openings) live in `extra-readings.json` with deliberately rough rects; the
ingest snap has to seat them. On staging the same production code path runs
against the real model.

## Scores (2026-09-03, this machine)

| readings                         | rooms in place | misplaced | false/dupes |
|----------------------------------|---------------|-----------|-------------|
| automatic region reader only     | 59/64 (92.2%) | 0         | 0           |
| + supplement (full coverage)     | 64/64 (100%)  | 0         | 0           |
| full coverage, ±1.5% jitter      | 63/64 (98.4%) | 1         | 0           |
| full coverage, ±3% jitter        | 59/64 (92.2%) | 5         | 0           |

Corridors: 4/8 named in place (corridor fragments union across tiles under
one name; the other names are lost to per-tile leaks — known follow-up).
