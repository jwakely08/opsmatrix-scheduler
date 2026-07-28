import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { LS_KEY } from "./storage/localAdapter";
import { buildDemoState } from "./lib/demo";
import "./styles.css";

// Visiting ?demo=1 on a fresh browser seeds the sample building (generated
// from the test-file data) so a shared demo link shows a working schedule
// immediately. Existing data is never overwritten.
if (new URLSearchParams(window.location.search).has("demo") && !localStorage.getItem(LS_KEY)) {
  localStorage.setItem(LS_KEY, JSON.stringify(buildDemoState()));
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
