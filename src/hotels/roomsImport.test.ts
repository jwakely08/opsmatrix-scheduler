import { describe, it, expect } from "vitest";
import { parseDelimited, rowsFromTable, applyImport, SAMPLE_CSV, normalizeCondition, parsePromised } from "./roomsImport";
import { emptyState } from "./store";
import { defaultRoomTypes } from "./rules";
import { verdictFor } from "./verdict";

const AT = "2026-09-14T14:00:00.000Z";

describe("manual adapter — room list import", () => {
  it("parses the sample CSV into rows with normalized status", () => {
    const rows = rowsFromTable(parseDelimited(SAMPLE_CSV));
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ number: "501", type: "King", floor: "5", sqft: 338, condition: "dirty", occupancy: "arriving" });
    expect(rows[1].vip).toBe(true);
  });

  it("creates spaces, suites as clusters, and status signals; re-import updates instead of duplicating", () => {
    const s = emptyState(); s.roomTypes = defaultRoomTypes();
    const rows = rowsFromTable(parseDelimited(SAMPLE_CSV));
    const a = applyImport(s, rows, AT);
    expect(a.created).toBe(6);
    expect(s.clusters).toHaveLength(1);
    expect(s.clusters[0].memberIds).toHaveLength(2);
    expect(s.spaces.find((x) => x.number === "GYM5")?.typeId).toBe("gym");
    expect(s.status[s.spaces.find((x) => x.number === "501")!.id].condition?.value).toBe("dirty");
    const b = applyImport(s, rows, AT);
    expect(b.created).toBe(0); expect(b.updated).toBe(6);
    expect(s.spaces).toHaveLength(6);
  });

  it("an imported room is judged by the engine — the suite follows its dirty parlor", () => {
    const s = emptyState(); s.roomTypes = defaultRoomTypes();
    applyImport(s, rowsFromTable(parseDelimited(SAMPLE_CSV)), AT);
    const now = Date.parse(AT) + 60000;
    const bedroom = s.spaces.find((x) => x.number === "520")!;
    expect(verdictFor(s, bedroom, now).level).toBe("red");
    const q = s.spaces.find((x) => x.number === "503")!;
    // inspected in the file but no inspection record → hold, never green on faith
    expect(verdictFor(s, q, now).level).toBe("yellow");
  });

  it("understands PMS shorthand", () => {
    expect(normalizeCondition("VD")).toBe("dirty");
    expect(normalizeCondition("VC")).toBe("clean");
    expect(normalizeCondition("VI")).toBe("inspected");
    expect(normalizeCondition("OD")).toBe("dirty");
    expect(parsePromised("3:30 PM", AT)).toMatch(/T/);
    expect(new Date(parsePromised("3:30 PM", AT)!).getHours()).toBe(15);
  });

  it("a file with no room number column imports nothing", () => {
    expect(rowsFromTable(parseDelimited("Name,Type\nLobby,Lobby"))).toEqual([]);
  });
});
