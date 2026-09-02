// The baked matrix rendering (neonMap.ts): pure pixel math replaces the CSS
// filter+blend route that iOS Safari silently dropped. These tests pin the
// contract: ink becomes glowing cyan, paper becomes TRANSPARENT (so room
// fills always show through), and both ink polarities are handled.
import { describe, it, expect } from "vitest";
import { neonizePixels, meanLuminance } from "./neonMap";

/** build an RGBA buffer from [r,g,b,a] pixel tuples */
function buf(...pixels: [number, number, number, number][]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b, a], i) => {
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = a;
  });
  return out;
}

describe("meanLuminance", () => {
  it("light paper with dark lines reads light", () => {
    const px = buf([255, 255, 255, 255], [255, 255, 255, 255], [0, 0, 0, 255]);
    expect(meanLuminance(px, 3)).toBeGreaterThan(0.5);
  });

  it("ignores transparent pixels", () => {
    const px = buf([0, 0, 0, 0], [0, 0, 0, 0], [255, 255, 255, 255]);
    expect(meanLuminance(px, 3)).toBeGreaterThan(0.9);
  });
});

describe("neonizePixels — dark ink on light paper", () => {
  it("black wall ink becomes bright and opaque", () => {
    const px = buf([0, 0, 0, 255]);
    neonizePixels(px, 1, true);
    expect(px[3]).toBe(255);              // fully visible
    expect(px[2]).toBeGreaterThan(200);   // blue channel high — cyan/white family
    expect(px[0]).toBeGreaterThan(150);   // strong ink cores toward white
  });

  it("white paper becomes fully transparent", () => {
    const px = buf([255, 255, 255, 255]);
    neonizePixels(px, 1, true);
    expect(px[3]).toBe(0);
  });

  it("faint gray ink still shows, in pure cyan", () => {
    const px = buf([170, 170, 170, 255]); // light-gray line
    neonizePixels(px, 1, true);
    expect(px[3]).toBeGreaterThan(80);    // visible…
    expect(px[3]).toBeLessThan(255);      // …but not solid
    expect(px[0]).toBe(103);              // no white core — stays the neon cyan
    expect(px[1]).toBe(232);
    expect(px[2]).toBe(249);
  });
});

describe("neonizePixels — light ink on dark ground", () => {
  it("white lines on black read as ink when inkIsDark=false", () => {
    const ink = buf([255, 255, 255, 255]);
    const ground = buf([0, 0, 0, 255]);
    neonizePixels(ink, 1, false);
    neonizePixels(ground, 1, false);
    expect(ink[3]).toBe(255);
    expect(ground[3]).toBe(0);
  });
});

describe("neonizePixels — alpha carries through", () => {
  it("a transparent source pixel stays transparent even if dark", () => {
    const px = buf([0, 0, 0, 0]);
    neonizePixels(px, 1, true);
    expect(px[3]).toBe(0);
  });
});
