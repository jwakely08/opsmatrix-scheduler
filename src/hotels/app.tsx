// The OpsMatrix Hotels shell: one context holding the state, a hash router,
// the side nav (desktop) / bottom strip (phone), and the header. Every screen
// in the brief lives here; nothing else invents a home.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type HotelState, saveState } from "./store";
import { Wordmark, Icon, LogoMark } from "./Logo";

export type View = "map" | "next" | "walk" | "labor" | "handover" | "scar" | "desk" | "rooms" | "scope" | "settings" | "design";

interface AppCtx {
  state: HotelState;
  /** mutate a DRAFT in place; it is saved and re-rendered afterwards */
  update: (fn: (draft: HotelState) => void, toast?: string) => void;
  replace: (next: HotelState) => void;
  toast: (msg: string) => void;
  view: View;
  go: (v: View, params?: Record<string, string>) => void;
  params: Record<string, string>;
  now: number;
}

const Ctx = createContext<AppCtx | null>(null);
export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp outside provider");
  return c;
}

export function parseHash(h: string): { view: View; params: Record<string, string> } {
  const m = h.replace(/^#/, "");
  const [v, q] = m.split("?");
  const params: Record<string, string> = {};
  if (q) for (const kv of q.split("&")) { const [k, val] = kv.split("="); if (k) params[decodeURIComponent(k)] = decodeURIComponent(val ?? ""); }
  const views: View[] = ["map", "next", "walk", "labor", "handover", "scar", "desk", "rooms", "scope", "settings", "design"];
  return { view: (views as string[]).includes(v) ? (v as View) : "map", params };
}

export const NAV: { view: View; label: string; ico: string; group?: string }[] = [
  { view: "map", label: "House map", ico: "map", group: "Today" },
  { view: "next", label: "Next four hours", ico: "clock" },
  { view: "walk", label: "Walk mode", ico: "walk" },
  { view: "desk", label: "Front desk", ico: "desk" },
  { view: "labor", label: "Labor", ico: "labor", group: "Plan" },
  { view: "handover", label: "Handover & reports", ico: "handover" },
  { view: "scar", label: "Scar map", ico: "scar" },
  { view: "rooms", label: "Rooms & spaces", ico: "rooms", group: "Set up" },
  { view: "scope", label: "Scope", ico: "scope" },
  { view: "settings", label: "Settings", ico: "settings" },
  { view: "design", label: "Design", ico: "design" }
];

export function AppProvider({ initial, children }: { initial: HotelState; children: React.ReactNode }) {
  const [state, setState] = useState<HotelState>(initial);
  const [hash, setHash] = useState(() => window.location.hash);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  // the clock ticks so freshness verdicts move on screen without a reload
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg((m) => (m === msg ? null : m)), 2600);
  }, []);

  const update = useCallback((fn: (d: HotelState) => void, t?: string) => {
    setState((prev) => {
      const draft: HotelState = JSON.parse(JSON.stringify(prev));
      fn(draft);
      draft.settings.updatedAt = new Date().toISOString();
      saveState(draft);
      return draft;
    });
    setNow(Date.now());
    if (t) toast(t);
  }, [toast]);

  const replace = useCallback((next: HotelState) => { saveState(next); setState(next); setNow(Date.now()); }, []);

  const { view, params } = useMemo(() => parseHash(hash), [hash]);
  const go = useCallback((v: View, p?: Record<string, string>) => {
    const q = p && Object.keys(p).length ? "?" + Object.entries(p).map(([k, val]) => `${encodeURIComponent(k)}=${encodeURIComponent(val)}`).join("&") : "";
    window.location.hash = v + q;
  }, []);

  const value = useMemo(() => ({ state, update, replace, toast, view, go, params, now }), [state, update, replace, toast, view, go, params, now]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </Ctx.Provider>
  );
}

export function Shell({ title, actions, flush, children }: { title: string; actions?: React.ReactNode; flush?: boolean; children: React.ReactNode }) {
  const { view, go, state } = useApp();
  const items = NAV;
  return (
    <div className="hx-app">
      <aside className="hx-side">
        <Wordmark />
        <nav className="hx-nav">
          {items.map((it) => (
            <React.Fragment key={it.view}>
              {it.group && <div className="group">{it.group}</div>}
              <button className={view === it.view ? "on" : ""} onClick={() => go(it.view)}>
                <Icon name={it.ico} />{it.label}
              </button>
            </React.Fragment>
          ))}
        </nav>
        <div className="foot">{state.settings.hotelName} · local concept build</div>
      </aside>
      <div className="hx-main">
        <header className="hx-head">
          <span className="phone-only" style={{ display: "contents" }}><LogoMark size={30} /></span>
          <h1>{title}</h1>
          <span className="spacer" />
          {actions && <div className="hx-actions">{actions}</div>}
        </header>
        <main className={"hx-body" + (flush ? " flush" : "")}>{children}</main>
      </div>
      <nav className="hx-bottom">
        {items.map((it) => (
          <button key={it.view} className={view === it.view ? "on" : ""} onClick={() => go(it.view)}>
            <Icon name={it.ico} /><span>{it.label.split(" ")[0] === "Next" ? "Next 4h" : it.label.split(" &")[0].split(" ")[0] === "House" ? "Map" : it.label.split(" &")[0]}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export function Lamp({ level, lg }: { level: "green" | "yellow" | "red" | "unknown"; lg?: boolean }) {
  return <i className={"lamp " + level + (lg ? " lg" : "")} aria-label={level} />;
}

export function Drawer({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <>
      <div className="drawer-back" onClick={onClose} />
      <div className="drawer" role="dialog">{children}</div>
    </>
  );
}
