// Build the EW-wing answer key from the verified bubble detections.
// The index → label mapping below was read BY EYE from bench/out/
// bubbles-montage.png + bubbles-overlay.png (hand-verified); four bubbles the
// detector missed are placed by hand from the overlay. Coordinates are
// normalised to the FULL SHEET (x right, y down).
import fs from "node:fs";

const dets = JSON.parse(fs.readFileSync("bench/out/bubbles.json", "utf8"));

// index in bubbles.json → printed label ("" = junk detection, skip)
const LABELS = {
  1: "2134", 3: "2140", 4: "2148", 5: "2146", 6: "2144", 7: "2138", 8: "2136",
  9: "2150A", 10: "2134A", 11: "2150", 12: "2130A", 13: "2130",
  15: "2144A", 16: "2142A", 17: "2140A", 18: "2136A", 19: "2148A",
  21: "2146A", 22: "2138A",
  26: "2152A", 27: "EW2D", 28: "2152", 29: "EW2C", 30: "EW2B",
  31: "2133", 32: "2147", 33: "2137", 35: "2135", 37: "2145", 38: "2154A",
  39: "2143", 40: "2149", 41: "2154", 42: "2126", 43: "2109", 44: "2151",
  47: "2105", 48: "2107A", 49: "2119", 50: "2156A", 51: "2101", 52: "2113",
  53: "2101A", 55: "2111", 56: "2156", 57: "2124", 58: "2107", 59: "2101B",
  60: "EW2H", 61: "2117", 63: "EW2F", 64: "EW2G", 65: "S7", 66: "2122",
  69: "2102A", 70: "2106A", 71: "2110B", 72: "2104A", 73: "2120", 74: "2102",
  75: "2110A", 76: "2110", 77: "2106", 78: "2114", 79: "2116", 80: "2112",
  81: "EW2E", 82: "2118"
};

// bubbles the detector missed — centres read off bubbles-overlay.png by hand
// (crop 0.38..0.88 x, 0.50..0.70 y rendered at 2600x1607)
const crop = { x0: 0.38, y0: 0.50, w: 0.5, h: 0.2, W: 2600, H: 1607 };
const manual = [
  { label: "2142", px: 1231, py: 234 },
  { label: "2128", px: 2387, py: 537 },
  { label: "2104", px: 832, py: 1317 },
  { label: "2143A", px: 1197, py: 663 }
];

const rooms = [];
for (const d of dets) {
  const label = LABELS[d.i];
  if (!label) continue;
  rooms.push({
    number: label,
    x: Math.round(d.cx * 10000) / 10000,
    y: Math.round(d.cy * 10000) / 10000,
    corridor: /^(EW2|S7)/.test(label)
  });
}
for (const m of manual) {
  rooms.push({
    number: m.label,
    x: Math.round((crop.x0 + (m.px / crop.W) * crop.w) * 10000) / 10000,
    y: Math.round((crop.y0 + (m.py / crop.H) * crop.h) * 10000) / 10000,
    corridor: false
  });
}
rooms.sort((a, b) => a.number.localeCompare(b.number));

const key = {
  sheet: "Franciscan Lafayette Central — Second Floor Plan (11x17)",
  file: "bench/fixtures/central-2nd-floor.pdf",
  wing: "EW (rooms 2101-2156 + annexes + corridors)",
  note: "x/y are normalised full-sheet coordinates of a point inside each room " +
    "(the printed label bubble's centre, hand-verified; a few nudged into the room).",
  rooms
};
fs.writeFileSync("bench/answer-key-ew.json", JSON.stringify(key, null, 1));
console.log(`answer key: ${rooms.length} labelled spaces ` +
  `(${rooms.filter((r) => !r.corridor).length} rooms, ${rooms.filter((r) => r.corridor).length} corridors)`);
