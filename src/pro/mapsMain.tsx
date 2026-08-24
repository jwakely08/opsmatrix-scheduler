import React from "react";
import ReactDOM from "react-dom/client";
import { MapsApp } from "./MapsApp";
import { buildClassicDemo, demoStamp } from "../bridge/fusionEntry";
import { healApiKey, loadApiKey } from "./classicStore";
import "./pro.css";
import "./print.css";

// Any entrance can restore the demo: ?demo=1 seeds when the saved data is a
// stale/absent demo (stamped — never touches real imported work).
const DEMO_STAMP_KEY = "opsmatrix_v7_demo_stamp";
if (/[?&]demo=1/.test(window.location.search)) {
  try {
    const stamp = demoStamp();
    let isDemo = true;
    try {
      const v7 = JSON.parse(localStorage.getItem("opsmatrix_v7") ?? "null");
      if (v7 && Array.isArray(v7.spaces) && v7.spaces.length > 0) {
        isDemo = v7.spaces.every((s: { importSource?: string }) => s.importSource === "magicplan-scan") &&
          localStorage.getItem(DEMO_STAMP_KEY) !== null;
      }
    } catch { /* unreadable → reseed */ }
    if (isDemo && localStorage.getItem(DEMO_STAMP_KEY) !== stamp) {
      const demo = buildClassicDemo();
      // a reseed refreshes the demo DATA — it never takes the user's API key
      const savedKey = loadApiKey();
      if (savedKey) {
        (demo.v7 as { settings?: Record<string, unknown> }).settings = {
          ...((demo.v7 as { settings?: Record<string, unknown> }).settings ?? {}),
          maxApiKey: savedKey
        };
      }
      localStorage.setItem("opsmatrix_v7", JSON.stringify(demo.v7));
      localStorage.setItem("opsmatrix_v7_plans", JSON.stringify(demo.plans));
      localStorage.setItem(DEMO_STAMP_KEY, stamp);
    }
  } catch (e) {
    console.warn("demo seed failed", e);
  }
}

// every entrance: if the classic app's save effect (or anything else) dropped
// the saved API key out of opsmatrix_v7, put it back from the backup slot
healApiKey();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MapsApp />
  </React.StrictMode>
);
