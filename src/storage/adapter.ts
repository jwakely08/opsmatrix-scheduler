import type { AppState } from "../lib/types";

export interface SaveResult {
  ok: boolean;
  /** true when the remote copy changed since we loaded — UI shows "data changed, refresh" */
  conflict?: boolean;
  error?: string;
}

export interface StorageAdapter {
  readonly mode: "local" | "remote";
  load(): Promise<AppState | null>;
  save(state: AppState): Promise<SaveResult>;
}
