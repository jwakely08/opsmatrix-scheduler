import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { LS_KEY } from "./storage/localAdapter";
import { buildDemoState, demoStamp } from "./lib/demo";
import "./styles.css";
import "./motion.css"; // the motion system — must load after styles.css to win the cascade

// Visiting ?demo=1 seeds the sample building (built from the bundled scan).
// A STALE demo — data that was itself demo-seeded, by any earlier build —
// refreshes automatically so the link always shows the current floor plan.
// Real imported work (rooms not sourced from the demo) is never touched.
if (new URLSearchParams(window.location.search).has("demo")) {
  const raw = localStorage.getItem(LS_KEY);
  let shouldSeed = !raw;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const isDemoData = parsed.demoStamp !== undefined ||
        (Array.isArray(parsed.rooms) && parsed.rooms.length > 0 &&
          parsed.rooms.every((r: { source?: string }) => r.source === "demo"));
      shouldSeed = isDemoData && parsed.demoStamp !== demoStamp();
    } catch {
      shouldSeed = true; // unreadable data — reseed
    }
  }
  if (shouldSeed) localStorage.setItem(LS_KEY, JSON.stringify(buildDemoState()));
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
