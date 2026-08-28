// Security regression tests (added by the 2026-08-28 security assessment).
//
// These pin the security invariants the assessment VERIFIED as holding, so a
// later change cannot silently undo them. They assert real controls only —
// they do not change any application behaviour. See security/ for the full
// assessment and the findings that are NOT yet fixed (those are tracked in
// security/SECURITY_REMEDIATION_ROADMAP.md, not here).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  sanitizeRooms,
  sanitizeBox,
  normalizeCoordinateScale,
  type AiRoom
} from "./bridge/aiPlanImport";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "dist") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("secrets are never hardcoded", () => {
  it("no real Anthropic secret key appears in source or scripts", () => {
    // A real key is sk-ant-...<long secret>. UI placeholders ("sk-ant-api…")
    // and the short "sk-ant-test" fixture are intentionally allowed.
    const realKey = /sk-ant-[A-Za-z0-9_-]{20,}/;
    const files = [
      ...walk(join(ROOT, "src")),
      ...walk(join(ROOT, "scripts"))
    ].filter((f) => /\.(ts|tsx|js|cjs|mjs)$/.test(f));
    const offenders = files.filter((f) => realKey.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("no CDN scripts on key-bearing pages (hard rule 7)", () => {
  it("generated classic.html references no third-party CDN", () => {
    const html = readFileSync(join(ROOT, "public", "classic.html"), "utf8");
    for (const cdn of [
      "cdnjs.cloudflare.com",
      "unpkg.com",
      "cdn.jsdelivr.net",
      "cdn.tailwindcss.com"
    ]) {
      expect(html.includes(cdn), `classic.html must not reference ${cdn}`).toBe(false);
    }
  });
});

describe("AI egress is HTTPS-only and browser-scoped", () => {
  it("the Anthropic endpoint in source is https", () => {
    const src = readFileSync(join(ROOT, "src", "bridge", "aiPlanImport.ts"), "utf8");
    const m = src.match(/const API_URL\s*=\s*"([^"]+)"/);
    expect(m?.[1]).toMatch(/^https:\/\//);
    expect(m?.[1]).toContain("api.anthropic.com");
  });
});

describe("AI plan-reader output is treated as untrusted data", () => {
  it("drops degenerate/empty polygons and never fabricates a room from nothing", () => {
    const rooms = [
      { name: "", roomNumber: "", squareFeet: 0, roomType: "Office", polygon: [] },
      { name: "A", roomNumber: "1", squareFeet: 10, roomType: "Office",
        polygon: [[0, 0], [0, 0], [0, 0]] }, // zero-area
      { name: "Good", roomNumber: "2", squareFeet: 12, roomType: "Office",
        polygon: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3]] }
    ] as unknown as AiRoom[];
    const out = sanitizeRooms(rooms);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Good");
  });

  it("an unknown roomType is blanked, never passed through", () => {
    const out = sanitizeRooms([{
      name: "X", roomNumber: "9", squareFeet: 5,
      roomType: "'; DROP TABLE rooms; --",
      polygon: [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3]]
    }] as unknown as AiRoom[]);
    expect(out).toHaveLength(1);
    expect(out[0].roomType).toBe("");
  });

  it("out-of-range coordinates are rescued/clamped into the image, not left wild", () => {
    // pixel-scale answer (0..1000) must be normalised, then clamped to 0..1
    const scaled = normalizeCoordinateScale([{
      name: "R", roomNumber: "1", squareFeet: 0, roomType: "Office",
      polygon: [[0, 0], [1000, 0], [1000, 1000], [0, 1000]]
    }] as unknown as AiRoom[]);
    const out = sanitizeRooms(scaled);
    for (const p of out[0].polygon) {
      expect(p[0]).toBeGreaterThanOrEqual(0);
      expect(p[0]).toBeLessThanOrEqual(1);
      expect(p[1]).toBeGreaterThanOrEqual(0);
      expect(p[1]).toBeLessThanOrEqual(1);
    }
  });

  it("a whole-page or sliver drawing box is rejected", () => {
    expect(sanitizeBox({ x0: 0, y0: 0, x1: 1, y1: 1 })).toBeNull(); // whole page
    expect(sanitizeBox({ x0: 0.5, y0: 0.5, x1: 0.55, y1: 0.55 })).toBeNull(); // sliver
    expect(sanitizeBox({ x0: 0.1, y0: 0.1, x1: 0.8, y1: 0.7 })).not.toBeNull();
  });
});
