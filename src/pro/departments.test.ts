// Departments on the map: stable colors, bulk assignment, stored overrides.
import { describe, it, expect } from "vitest";
import {
  deptColorMap, setDeptColor, colorForDept, departmentsOf, assignDepartment,
  DEPT_PALETTE
} from "./departments";
import type { ClassicData } from "./classicStore";

const fixture = (): ClassicData => ({
  v7: {
    spaces: [
      { id: "a", roomNumber: "101", department: "" },
      { id: "b", roomNumber: "102", department: "Imaging" },
      { id: "c", roomNumber: "103", department: "" }
    ]
  },
  nonSpace: [],
  plans: []
} as unknown as ClassicData);

describe("colorForDept", () => {
  it("no department → no color; same name → same stable color", () => {
    expect(colorForDept("", {})).toBeNull();
    expect(colorForDept(undefined, {})).toBeNull();
    const a = colorForDept("Med Surg", {});
    expect(a).toBe(colorForDept("Med Surg", {}));
    expect(DEPT_PALETTE).toContain(a);
  });

  it("a stored pick wins over the automatic one", () => {
    expect(colorForDept("Imaging", { Imaging: "#123abc" })).toBe("#123abc");
  });
});

describe("stored colors", () => {
  it("round-trips through v7.settings and rejects junk", () => {
    const d = fixture();
    setDeptColor(d, " Imaging ", "#f43f5e");
    expect(deptColorMap(d)).toEqual({ Imaging: "#f43f5e" });
    (d.v7.settings as Record<string, unknown>).departmentColors = { Bad: "red", Ok: "#10b981" };
    expect(deptColorMap(d)).toEqual({ Ok: "#10b981" });
  });
});

describe("assignDepartment", () => {
  it("sets the department on exactly the selected rooms and stores the color", () => {
    const d = fixture();
    const n = assignDepartment(d, ["a", "c"], "4 East", "#a855f7");
    expect(n).toBe(2);
    const sp = d.v7.spaces!;
    expect(sp.find((s) => s.id === "a")!.department).toBe("4 East");
    expect(sp.find((s) => s.id === "c")!.department).toBe("4 East");
    expect(sp.find((s) => s.id === "b")!.department).toBe("Imaging"); // untouched
    expect(deptColorMap(d)["4 East"]).toBe("#a855f7");
  });

  it("assigning an empty department clears rooms out of their department", () => {
    const d = fixture();
    assignDepartment(d, ["b"], "");
    expect(d.v7.spaces!.find((s) => s.id === "b")!.department).toBe("");
  });
});

describe("departmentsOf", () => {
  it("distinct, trimmed, sorted, blanks dropped", () => {
    expect(departmentsOf([
      { department: "Imaging" }, { department: " ER " }, { department: "" },
      { department: "Imaging" }
    ])).toEqual(["ER", "Imaging"]);
  });
});
