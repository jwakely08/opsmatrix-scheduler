// The workspace is saved to IndexedDB (public/storage-room.js), and those writes finish a moment
// after localStorage.setItem returns. A page that reloads itself straight after a big save — a
// restored backup, a shipped floor — waits for them first, so nothing is cut off.
export function reloadWhenSaved(delayMs = 0): void {
  const storage = (window as unknown as { __opsmatrixStorage?: { flush?: () => Promise<unknown> } }).__opsmatrixStorage;
  const saved = storage?.flush ? storage.flush().catch(() => undefined) : Promise.resolve();
  void saved.then(() => { window.setTimeout(() => window.location.reload(), delayMs); });
}
