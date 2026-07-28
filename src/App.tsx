import { useMemo, useState, useCallback } from "react";
import { useAuth } from "./auth/AuthContext";
import { supabase } from "./auth/supabaseClient";
import { StoreProvider, useStore } from "./state/store";
import { UIContext } from "./state/ui";
import { LocalAdapter } from "./storage/localAdapter";
import { makeRemoteAdapter } from "./storage/remoteAdapter";
import { LoginView } from "./components/LoginView";
import { Kpis } from "./components/Kpis";
import { Tree } from "./components/Tree";
import { ImportView } from "./components/ImportView";
import { ScheduleView } from "./components/ScheduleView";
import { MapView } from "./components/MapView";
import { SettingsView } from "./components/SettingsView";
import { MyDay } from "./components/MyDay";
import { RoomDrawer } from "./components/RoomDrawer";
import { PrintSheets } from "./components/PrintSheets";
import { ToastHost } from "./components/Toast";

const TABS: [string, string][] = [
  ["schedule", "Schedule"], ["map", "Map"], ["import", "Import"], ["settings", "Settings"]
];

function Shell() {
  const { state, update, conflict, dismissConflict, reload, adapterMode } = useStore();
  const auth = useAuth();
  const [drawerRoomId, setDrawerRoomId] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);

  const printSchedules = useCallback(() => {
    setPrinting(true);
    setTimeout(() => { window.print(); setPrinting(false); }, 60);
  }, []);

  const uiCtx = useMemo(() => ({
    openRoom: (id: string) => setDrawerRoomId(id),
    closeRoom: () => setDrawerRoomId(null),
    printSchedules,
    role: auth.role,
    canEditFacility: auth.role === "director",
    canEditSchedule: auth.role !== "staff"
  }), [auth.role, printSchedules]);

  // staff get a read-only "my day" experience
  if (auth.mode === "remote" && auth.role === "staff") {
    return (
      <UIContext.Provider value={uiCtx}>
        <header className="app">
          <div className="brand"><span className="logo">OPS<b>MATRIX</b></span><span className="tag">My Day</span></div>
          <div className="kpis"><button className="btn small" onClick={() => void auth.signOut()}>Sign out</button></div>
        </header>
        <main className="content"><MyDay /></main>
        <ToastHost />
      </UIContext.Provider>
    );
  }

  const view = state.ui.view;
  const setView = (v: string) => update((d) => { d.ui.view = v; });

  return (
    <UIContext.Provider value={uiCtx}>
      <header className="app">
        <button className="treetoggle" title="Toggle facility tree" aria-label="Toggle facility tree"
          onClick={() => setTreeOpen(!treeOpen)}>☰</button>
        <div className="brand">
          <span className="logo">OPS<b>MATRIX</b></span>
          <span className="tag">Scheduler</span>
        </div>
        <nav className="tabs">
          {TABS.map(([id, label]) => (
            <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}>{label}</button>
          ))}
        </nav>
        <Kpis />
      </header>
      {adapterMode === "local" && auth.mode === "remote" && (
        <div className="banner">Working locally — changes stay in this browser.</div>
      )}
      {auth.mode === "local" && (
        <div className="banner">
          Local / demo mode — no login configured. Data lives in this browser only.
          {auth.orgName !== "Local workspace" ? " · " + auth.orgName : ""}
        </div>
      )}
      {conflict && (
        <div className="banner conflict">
          Data changed on the server since you loaded — your last save was not applied.
          <button className="btn small" onClick={() => { void reload(); }}>Refresh now</button>
          <button className="btn small ghost" onClick={dismissConflict}>Dismiss</button>
        </div>
      )}
      <div className="shell">
        <aside className={"treepane" + (treeOpen ? " open" : "")}>
          <Tree />
        </aside>
        <main className="content">
          {view === "import" ? <ImportView />
            : view === "map" ? <MapView />
            : view === "settings" ? <SettingsView />
            : <ScheduleView />}
        </main>
      </div>
      {drawerRoomId && <RoomDrawer roomId={drawerRoomId} onClose={() => setDrawerRoomId(null)} />}
      {printing && <PrintSheets />}
      <ToastHost />
    </UIContext.Provider>
  );
}

export default function App() {
  const auth = useAuth();
  const demoRequested = new URLSearchParams(window.location.search).has("demo");

  if (auth.mode === "remote" && !demoRequested) {
    if (auth.loading) return <div style={{ padding: 60, textAlign: "center", color: "#5b7083" }}>Loading…</div>;
    if (!auth.session || !auth.orgId) return <LoginView />;
    const adapter = makeRemoteAdapter(supabase!, auth.orgId, auth.role);
    return (
      <StoreProvider key={"remote:" + auth.orgId} adapter={adapter}>
        <Shell />
      </StoreProvider>
    );
  }

  return (
    <StoreProvider key="local" adapter={new LocalAdapter()}>
      <Shell />
    </StoreProvider>
  );
}
