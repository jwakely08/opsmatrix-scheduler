// Error-tracking hook points. Console-based for now; to add Sentry later,
// replace the transport in `emit` (see README "Error tracking" section).
type Level = "info" | "warn" | "error";

function emit(level: Level, msg: string, extra?: unknown) {
  const line = `[opsmatrix:${level}] ${msg}`;
  if (level === "error") console.error(line, extra ?? "");
  else if (level === "warn") console.warn(line, extra ?? "");
  else console.info(line, extra ?? "");
}

export const log = {
  info: (msg: string, extra?: unknown) => emit("info", msg, extra),
  warn: (msg: string, extra?: unknown) => emit("warn", msg, extra),
  error: (msg: string, extra?: unknown) => emit("error", msg, extra)
};
