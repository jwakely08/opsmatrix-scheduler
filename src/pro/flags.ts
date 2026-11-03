// Per-device switches kept in localStorage — read the same way on every page of the hub.
//
// PROPRIETARY (Josh, 2026-11-02): "a check box that allows proprietary timing information to be
// exported; if it's not checked, it won't be." Off by default. When off, the printed schedule hides the
// clock times, the priority column and the estimated minutes, and every schedule export writes "—"
// for timing (the client sheet's Est. Minutes; the five-sheet Schedules export's minutes and
// start/end times). On, all of it goes out. Shown as the same checkbox wherever a schedule is printed
// or exported: the Schedules tab, the print bar, Admin Settings → Exporting.
export const PROPRIETARY_KEY = "om_proprietary";

export const readFlag = (key: string): boolean => {
  try { return localStorage.getItem(key) === "1"; } catch { return false; }
};
export const writeFlag = (key: string, on: boolean): void => {
  try { localStorage.setItem(key, on ? "1" : "0"); } catch { /* storage off */ }
};
