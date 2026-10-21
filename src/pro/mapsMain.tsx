// maps.html's entry. The workspace lives in this device's IndexedDB (public/storage-room.js, loaded
// first in maps.html); nothing in the app may read it before that copy is in memory, so the app
// itself — every module, every first read — loads only once storage is ready.
const storage = (window as unknown as { __opsmatrixStorage?: { ready?: Promise<unknown> } }).__opsmatrixStorage;
void Promise.resolve(storage?.ready)
  .catch(() => undefined)
  .then(() => import("./mapsBoot"));
