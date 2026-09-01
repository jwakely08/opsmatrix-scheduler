// Error tracking. Console always; when a build carries VITE_SENTRY_DSN
// (staging/production), initMonitoring() lazily loads Sentry and errors are
// reported there too — environment-tagged, no PII, never any key material
// (nothing in this codebase logs secrets; keep it that way). Local/demo
// builds never download the Sentry chunk.
type Level = "info" | "warn" | "error";

type Reporter = (msg: string, extra?: unknown) => void;
let reportError: Reporter | null = null;

function emit(level: Level, msg: string, extra?: unknown) {
  const line = `[opsmatrix:${level}] ${msg}`;
  if (level === "error") {
    console.error(line, extra ?? "");
    reportError?.(msg, extra);
  }
  else if (level === "warn") console.warn(line, extra ?? "");
  else console.info(line, extra ?? "");
}

export const log = {
  info: (msg: string, extra?: unknown) => emit("info", msg, extra),
  warn: (msg: string, extra?: unknown) => emit("warn", msg, extra),
  error: (msg: string, extra?: unknown) => emit("error", msg, extra)
};

/** call once per page; a no-op unless the build has a Sentry DSN */
export function initMonitoring(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  void import("@sentry/browser").then((Sentry) => {
    Sentry.init({
      dsn,
      environment: (import.meta.env.MODE as string) || "production",
      // errors only — no session replay, no tracing, no user PII
      sendDefaultPii: false
    });
    reportError = (msg, extra) => {
      if (extra instanceof Error) Sentry.captureException(extra);
      else Sentry.captureMessage(msg + (extra !== undefined ? " · " + String(extra) : ""), "error");
    };
  }).catch(() => { /* monitoring is best-effort — the app never depends on it */ });
}
