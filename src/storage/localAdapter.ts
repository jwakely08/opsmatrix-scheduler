// localStorage adapter — works offline, powers demo mode, zero config.
// Uses the same key as the Phase A single-file app so existing data carries over.
import type { AppState } from "../lib/types";
import type { StorageAdapter, SaveResult } from "./adapter";
import { defaultState } from "../lib/seeds";
import { log } from "../lib/logger";

export const LS_KEY = "opsmatrix_sched_v1";

export class LocalAdapter implements StorageAdapter {
  readonly mode = "local" as const;

  async load(): Promise<AppState | null> {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const def = defaultState();
      // forward-merge so older saves gain new fields safely
      const merged: AppState = { ...def, ...parsed };
      merged.rates = { ...def.rates, ...(parsed.rates ?? {}) };
      merged.ui = { ...def.ui, ...(parsed.ui ?? {}) };
      return merged;
    } catch (e) {
      log.error("localAdapter.load failed", e);
      return null;
    }
  }

  async save(state: AppState): Promise<SaveResult> {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
      return { ok: true };
    } catch (e) {
      log.error("localAdapter.save failed", e);
      return { ok: false, error: String(e) };
    }
  }
}
