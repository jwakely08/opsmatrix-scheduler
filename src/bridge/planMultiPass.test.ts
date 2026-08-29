// Pins the high-recall multi-pass reader's pure logic: tiling, coordinate
// remapping, cross-pass de-duplication, and end-to-end resilience. The live
// vision quality (does a real hand-drawn plan read better?) can't be unit
// tested — that's browser verification — but the geometry and merge maths that
// the recall gains rest on are locked here.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  planTiles, remapPolygon, mergeRooms, readPlanMultiPass,
  type AiRoom, type DrawingBox
} from "./aiPlanImport";

const rect = (x0: number, y0: number, x1: number, y1: number): number[][] =>
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

const room = (r: Partial<AiRoom>): AiRoom => ({
  name: "", roomNumber: "", squareFeet: 0, roomType: "", polygon: rect(0, 0, 0.1, 0.1), ...r
});

function mockFetch(reading: unknown, ok = true) {
  const spy = vi.fn().mockResolvedValue({
    ok, status: ok ? 200 : 500,
    json: async () => ({ content: [{ type: "text", text: JSON.stringify(reading) }] }),
    text: async () => JSON.stringify(reading)
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

describe("planTiles", () => {
  it("a 2×2 grid covers the whole sheet with overlapping seams", () => {
    const t = planTiles({ cols: 2, rows: 2, overlap: 0.12 });
    expect(t).toHaveLength(4);
    // top-left tile starts at the corner and overruns the centre seam
    expect(t[0]).toMatchObject({ x0: 0, y0: 0 });
    expect(t[0].x1).toBeCloseTo(0.56, 6); // 0.5 + 0.12*0.5
    expect(t[0].y1).toBeCloseTo(0.56, 6);
    // bottom-right tile ends exactly at the far corner
    expect(t[3]).toMatchObject({ x1: 1, y1: 1 });
    expect(t[3].x0).toBeCloseTo(0.44, 6);
    // the seams overlap, so no room can fall between tiles
    expect(t[0].x1).toBeGreaterThan(t[3].x0);
  });

  it("a 1×1 grid is the whole sheet", () => {
    expect(planTiles({ cols: 1, rows: 1, overlap: 0.2 })).toEqual([{ x0: 0, y0: 0, x1: 1, y1: 1 }]);
  });
});

describe("remapPolygon", () => {
  it("maps tile-local 0..1 back onto the full plan", () => {
    const box: DrawingBox = { x0: 0.5, y0: 0.5, x1: 1, y1: 1 };
    // a room filling the bottom-right tile maps to the bottom-right quarter
    expect(remapPolygon(rect(0, 0, 1, 1), box)).toEqual(rect(0.5, 0.5, 1, 1));
    // the tile's own centre maps to the plan's 0.75,0.75
    expect(remapPolygon([[0.5, 0.5]], box)).toEqual([[0.75, 0.75]]);
  });
});

describe("mergeRooms", () => {
  it("drops a room seen twice across tiles (same centre, similar area)", () => {
    const a = room({ roomNumber: "101", polygon: rect(0.10, 0.10, 0.20, 0.20) });
    const aAgain = room({ polygon: rect(0.101, 0.101, 0.201, 0.201) }); // blank dup from the neighbour tile
    const b = room({ roomNumber: "102", polygon: rect(0.60, 0.60, 0.70, 0.70) });
    const merged = mergeRooms([a, aAgain, b]);
    expect(merged).toHaveLength(2);
    // the labelled copy wins over the blank duplicate
    expect(merged.find((r) => Math.abs(r.polygon[0][0] - 0.10) < 1e-6)?.roomNumber).toBe("101");
  });

  it("keeps genuine neighbours that merely sit near each other", () => {
    const a = room({ roomNumber: "1", polygon: rect(0.10, 0.10, 0.20, 0.20) });
    const b = room({ roomNumber: "2", polygon: rect(0.22, 0.10, 0.32, 0.20) });
    expect(mergeRooms([a, b])).toHaveLength(2);
  });

  it("a big wrapper and a small room at the same centre are NOT merged (area differs)", () => {
    const wrapper = room({ polygon: rect(0.1, 0.1, 0.9, 0.9) });
    const small = room({ roomNumber: "5", polygon: rect(0.48, 0.48, 0.52, 0.52) });
    expect(mergeRooms([wrapper, small])).toHaveLength(2);
  });
});

describe("readPlanMultiPass", () => {
  const opts = {
    apiKey: "sk-ant-test",
    imageDataUrl: "data:image/png;base64,AAAA",
    imageWidth: 2000, imageHeight: 1400
  };
  const pic = { dataUrl: "data:image/png;base64,BBBB", width: 1000, height: 700, aspect: 1000 / 700 };

  it("merges full-sheet + tile reads and remaps tile rooms to the full plan", async () => {
    // every read returns one room filling its frame; 1 full + 4 tiles = 5 reads,
    // but the full-sheet room and each tile map to different places → merged set
    mockFetch({ buildingName: "B", floorName: "1", rooms: [room({ roomNumber: "X", polygon: rect(0.1, 0.1, 0.9, 0.9) })] });
    const out = await readPlanMultiPass({
      ...opts, renderTile: () => Promise.resolve(pic), grid: { cols: 2, rows: 2, overlap: 0.12 }
    });
    // full-sheet room (0.1..0.9) plus four tile rooms remapped into each quadrant
    expect(out.rooms.length).toBeGreaterThanOrEqual(4);
    expect(out.buildingName).toBe("B");
  });

  it("survives a failed full-sheet pass when tiles still read", async () => {
    let call = 0;
    const spy = vi.fn().mockImplementation(async () => {
      call++;
      // first call (full sheet) fails; tile calls succeed
      const ok = call > 1;
      return {
        ok, status: ok ? 200 : 500,
        json: async () => ({ content: [{ type: "text", text: JSON.stringify({ rooms: [room({ roomNumber: String(call) })] }) }] }),
        text: async () => "err"
      };
    });
    vi.stubGlobal("fetch", spy);
    const out = await readPlanMultiPass({
      ...opts, renderTile: () => Promise.resolve(pic), grid: { cols: 2, rows: 2, overlap: 0.12 }
    });
    expect(out.rooms.length).toBeGreaterThan(0); // tiles carried it
  });

  it("folds in extraRooms from the local wall-tracer", async () => {
    mockFetch({ rooms: [] }); // AI finds nothing
    const auto = [room({ roomNumber: "", polygon: rect(0.2, 0.2, 0.4, 0.4) })];
    const out = await readPlanMultiPass({ ...opts, extraRooms: auto });
    expect(out.rooms).toHaveLength(1);
  });
});
