// OpsMatrix Hotels — entry. A separate product page: its own store, its own
// theme, its own demo. It never reads the hospital app's data.
import React from "react";
import ReactDOM from "react-dom/client";
import "./theme.css";
import { AppProvider } from "./app";
import { HotelApp } from "./HotelApp";
import { loadState, saveState, type HotelState } from "./store";
import { buildDemo, DEMO_STAMP, DEMO_MAX_AGE_MIN } from "./demo";

function boot(): HotelState {
  const force = /[?&]demo=1/.test(window.location.search);
  const saved = loadState();
  const isDemo = !saved || Boolean(saved.settings.demoStamp);
  if (saved && !isDemo && !force) return saved;
  const age = saved?.settings.updatedAt ? (Date.now() - new Date(saved.settings.updatedAt).getTime()) / 60000 : Infinity;
  const stale = !saved || saved.settings.demoStamp !== DEMO_STAMP || age > DEMO_MAX_AGE_MIN;
  if (force || stale) {
    const demo = buildDemo();
    saveState(demo);
    return demo;
  }
  return saved!;
}

const initial = boot();
document.title = `OpsMatrix Hotels — ${initial.settings.hotelName}`;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProvider initial={initial}>
      <HotelApp />
    </AppProvider>
  </React.StrictMode>
);
