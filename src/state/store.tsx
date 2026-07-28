import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import type { AppState } from "../lib/types";
import { defaultState } from "../lib/seeds";
import type { StorageAdapter } from "../storage/adapter";
import { LocalAdapter } from "../storage/localAdapter";
import { log } from "../lib/logger";

interface StoreCtx {
  state: AppState;
  /** mutate a draft copy; persisted + re-rendered */
  update: (mutator: (draft: AppState) => void) => void;
  replaceState: (next: AppState) => void;
  conflict: boolean;
  dismissConflict: () => void;
  reload: () => Promise<void>;
  adapterMode: "local" | "remote";
}

const Ctx = createContext<StoreCtx | null>(null);

export function StoreProvider({ adapter, children }: { adapter?: StorageAdapter; children: React.ReactNode }) {
  const adapterRef = useRef<StorageAdapter>(adapter ?? new LocalAdapter());
  const [state, setState] = useState<AppState>(() => defaultState());
  const [ready, setReady] = useState(false);
  const [conflict, setConflict] = useState(false);

  const reload = useCallback(async () => {
    const loaded = await adapterRef.current.load();
    setState(loaded ?? defaultState());
    setConflict(false);
    setReady(true);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const persist = useCallback((next: AppState) => {
    void adapterRef.current.save(next).then((res) => {
      if (!res.ok) log.warn("save failed", res.error);
      if (res.conflict) setConflict(true);
    });
  }, []);

  const update = useCallback((mutator: (draft: AppState) => void) => {
    setState((prev) => {
      const draft: AppState = JSON.parse(JSON.stringify(prev));
      mutator(draft);
      persist(draft);
      return draft;
    });
  }, [persist]);

  const replaceState = useCallback((next: AppState) => {
    setState(next);
    persist(next);
  }, [persist]);

  if (!ready) return <div style={{ padding: 40, textAlign: "center", color: "#5b7083" }}>Loading…</div>;

  return (
    <Ctx.Provider value={{
      state, update, replaceState, conflict,
      dismissConflict: () => setConflict(false),
      reload, adapterMode: adapterRef.current.mode
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useStore(): StoreCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore outside StoreProvider");
  return v;
}
