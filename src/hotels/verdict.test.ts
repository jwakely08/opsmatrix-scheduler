import { describe, it, expect } from "vitest";
import { emptyState, type HotelState, type RoomStatus, type Space } from "./store";
import { defaultRoomTypes } from "./rules";
import { spaceVerdict, verdictFor } from "./verdict";

const NOW = Date.parse("2026-09-14T15:00:00Z");
const at = (minAgo: number) => new Date(NOW - minAgo * 60000).toISOString();

function room(id = "sp-412", number = "412", clusterId?: string): Space {
  return { id, number, name: `Room ${number}`, floor: "4", typeId: "king", sqft: 338, clusterId, updatedAt: at(0) };
}

function base(): { state: HotelState; sp: Space; st: RoomStatus } {
  const state = emptyState();
  state.roomTypes = defaultRoomTypes();
  const sp = room();
  state.spaces = [sp];
  const st: RoomStatus = {
    spaceId: sp.id,
    occupancy: { value: "arriving", at: at(5), source: "manual" },
    condition: { value: "inspected", at: at(10), source: "manual", by: "Dana" },
    engineering: { ooo: false, at: at(5) },
    flags: { vip: false, doNotWalk: false, promisedAt: new Date(NOW + 3600000).toISOString(), at: at(5) },
    inspection: { result: "pass", at: at(9), by: "Dana" },
    readyPath: [],
    override: null
  };
  state.status[sp.id] = st;
  return { state, sp, st };
}

describe("Ready Confidence — the freshness rule", () => {
  it("a fully fresh, inspected room is green", () => {
    const { state, sp } = base();
    expect(spaceVerdict(state, sp, NOW).level).toBe("green");
  });

  it("a STALE condition signal never produces green — it is Unknown and names the signal", () => {
    const { state, sp, st } = base();
    st.condition!.at = at(16); // default threshold is 15 minutes
    const v = spaceVerdict(state, sp, NOW);
    expect(v.level).toBe("unknown");
    expect(v.stale.join(" ")).toMatch(/Condition/);
  });

  it("a MISSING required signal is Unknown, not green", () => {
    const { state, sp, st } = base();
    st.occupancy = null;
    expect(spaceVerdict(state, sp, NOW).level).toBe("unknown");
    st.occupancy = { value: "arriving", at: at(1), source: "manual" };
    st.engineering = null;
    expect(spaceVerdict(state, sp, NOW).level).toBe("unknown");
  });

  it("the freshness threshold is configurable per signal", () => {
    const { state, sp, st } = base();
    st.condition!.at = at(40);
    expect(spaceVerdict(state, sp, NOW).level).toBe("unknown");
    state.settings.freshnessMin.condition = 60;
    expect(spaceVerdict(state, sp, NOW).level).toBe("green");
  });

  it("disconnecting the feed paints the room Unknown immediately", () => {
    const { state, sp } = base();
    state.settings.adapter.connected = false;
    const v = spaceVerdict(state, sp, NOW);
    expect(v.level).toBe("unknown");
    expect(v.reasons[0]).toMatch(/disconnected/i);
  });

  it("stale beats everything — even a GM override cannot turn a stale room green", () => {
    const { state, sp, st } = base();
    st.condition = { value: "clean", at: at(30), source: "manual" };
    st.override = { level: "green", by: "Sam (GM)", reason: "Walked it myself", at: at(1) };
    expect(spaceVerdict(state, sp, NOW).level).toBe("unknown");
  });
});

describe("Ready Confidence — the verdict ladder", () => {
  it("clean but not inspected is a hold (yellow)", () => {
    const { state, sp, st } = base();
    st.condition = { value: "clean", at: at(3), source: "manual" };
    st.inspection = null;
    expect(spaceVerdict(state, sp, NOW).level).toBe("yellow");
  });

  it("dirty or being cleaned is do-not-walk (red)", () => {
    const { state, sp, st } = base();
    st.condition = { value: "dirty", at: at(3), source: "manual" };
    expect(spaceVerdict(state, sp, NOW).level).toBe("red");
    st.condition = { value: "in_progress", at: at(3), source: "manual" };
    expect(spaceVerdict(state, sp, NOW).level).toBe("red");
  });

  it("out of order is red regardless of condition", () => {
    const { state, sp, st } = base();
    st.engineering = { ooo: true, reason: "leak", at: at(2) };
    const v = spaceVerdict(state, sp, NOW);
    expect(v.level).toBe("red");
    expect(v.reasons[0]).toMatch(/Out of order/);
  });

  it("a blocking work order is red; a non-blocking one is a hold", () => {
    const { state, sp } = base();
    state.workOrders = [{ id: "w1", spaceId: sp.id, text: "AC blowing warm", category: "hvac", blocking: false, status: "open", createdAt: at(2), createdBy: "Josh" }];
    expect(spaceVerdict(state, sp, NOW).level).toBe("yellow");
    state.workOrders[0].blocking = true;
    expect(spaceVerdict(state, sp, NOW).level).toBe("red");
    state.workOrders[0].status = "done";
    expect(spaceVerdict(state, sp, NOW).level).toBe("green");
  });

  it("a do-not-walk flag is red", () => {
    const { state, sp, st } = base();
    st.flags.doNotWalk = true;
    expect(spaceVerdict(state, sp, NOW).level).toBe("red");
  });

  it("an inspection older than the last condition change does not count", () => {
    const { state, sp, st } = base();
    st.condition = { value: "inspected", at: at(2), source: "manual" };
    st.inspection = { result: "pass", at: at(30), by: "Dana" };
    expect(spaceVerdict(state, sp, NOW).level).toBe("yellow");
  });

  it("a GM can override a HOLD with a reason — never a red", () => {
    const { state, sp, st } = base();
    st.condition = { value: "clean", at: at(3), source: "manual" };
    st.inspection = null;
    st.override = { level: "green", by: "Sam (GM)", reason: "Walked it myself, VIP waiting", at: at(1) };
    const v = spaceVerdict(state, sp, NOW);
    expect(v.level).toBe("green");
    expect(v.overridden).toBe(true);
    st.condition = { value: "dirty", at: at(3), source: "manual" };
    expect(spaceVerdict(state, sp, NOW).level).toBe("red");
  });

  it("an override without a reason does nothing", () => {
    const { state, sp, st } = base();
    st.condition = { value: "clean", at: at(3), source: "manual" };
    st.override = { level: "green", by: "Sam (GM)", reason: "", at: at(1) };
    expect(spaceVerdict(state, sp, NOW).level).toBe("yellow");
  });
});

describe("Ready Confidence — suites are clusters", () => {
  it("a suite reports the WORST of its member spaces", () => {
    const { state, sp } = base();
    const parlor = room("sp-418", "418", "cl-420");
    sp.clusterId = "cl-420";
    state.spaces = [sp, parlor];
    state.clusters = [{ id: "cl-420", number: "Suite 420", name: "Suite 420", floor: "4", memberIds: [sp.id, parlor.id] }];
    state.status[parlor.id] = { ...state.status[sp.id], spaceId: parlor.id, condition: { value: "in_progress", at: at(1), source: "manual" } };
    expect(spaceVerdict(state, sp, NOW).level).toBe("green");
    expect(verdictFor(state, sp, NOW).level).toBe("red");
    expect(verdictFor(state, parlor, NOW).reasons.join(" ")).toMatch(/Room 418/);
  });

  it("one stale member makes the whole suite Unknown", () => {
    const { state, sp } = base();
    const parlor = room("sp-418", "418", "cl-420");
    sp.clusterId = "cl-420";
    state.spaces = [sp, parlor];
    state.clusters = [{ id: "cl-420", number: "Suite 420", name: "Suite 420", floor: "4", memberIds: [sp.id, parlor.id] }];
    state.status[parlor.id] = { ...state.status[sp.id], spaceId: parlor.id, condition: { value: "inspected", at: at(90), source: "manual" } };
    expect(verdictFor(state, sp, NOW).level).toBe("unknown");
  });
});
