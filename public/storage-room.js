// OpsMatrix storage (Josh, 2026-10-20: "I can't get all the floors onto the platform").
//
// The workspace's big stores — the rooms (opsmatrix_v7), the floor plans and their pictures
// (opsmatrix_v7_plans) and the Calibration Editor's copies (opsmatrix_fusion_planstudio) — live in
// this browser's IndexedDB, which holds hundreds of MB on an iPad or a computer, instead of
// localStorage, which holds only about 5 MB per site. Every page's code keeps using localStorage
// exactly as before: for those keys, localStorage.getItem / setItem / removeItem work on an
// in-memory copy that this script fills from IndexedDB before the page's own code starts
// (pages wait for window.__opsmatrixStorage.ready), and every write is saved to IndexedDB at once.
// Data still in localStorage from an earlier version moves over on the first start. If IndexedDB
// can't be used, everything simply stays in localStorage, as before.
//
// Also the room-maker for whatever stays in localStorage: when a save doesn't fit, the oldest
// editable floor copies give up room and the save is tried again.
//
// Loaded first on every page that reads the workspace: maps.html, classic.html (inlined by
// scripts/make-classic.cjs) and, in the desktop suite, its home and research pages.
(function () {
  "use strict";
  if (window.__opsmatrixStorage) return;
  var api = { ready: Promise.resolve(), mode: "local", error: "" };
  window.__opsmatrixStorage = api;

  var store;
  try { store = window.localStorage; } catch (e) { return; }
  if (!store) return;
  var proto = Object.getPrototypeOf(store);
  var nativeGet = proto.getItem, nativeSet = proto.setItem, nativeRemove = proto.removeItem;
  var nativeKey = proto.key, nativeClear = proto.clear;
  var lengthOf = Object.getOwnPropertyDescriptor(proto, "length");

  var BIG = ["opsmatrix_v7", "opsmatrix_v7_plans", "opsmatrix_fusion_planstudio"];
  var EDITABLE = "opsmatrix_fusion_planstudio";
  var isBig = function (k) { return BIG.indexOf(String(k)) >= 0; };
  var cache = {};            // key → string, for the big keys once loaded
  var loaded = false;        // true once the big keys are served from IndexedDB

  function isQuota(e) {
    return !!e && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014);
  }

  // ── IndexedDB ────────────────────────────────────────────────────────────
  var DB = "opsmatrix-storage", STORE = "kv";
  var dbPromise = null;
  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        var req;
        try { req = window.indexedDB.open(DB, 1); } catch (e) { reject(e); return; }
        req.onupgradeneeded = function () { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error("IndexedDB would not open")); };
        req.onblocked = function () { reject(new Error("IndexedDB is blocked")); };
      });
    }
    return dbPromise;
  }
  function tx(mode, work) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var out = work(t.objectStore(STORE));
        t.oncomplete = function () { resolve(out && "result" in out ? out.result : undefined); };
        t.onerror = function () { reject(t.error || new Error("IndexedDB write failed")); };
        t.onabort = function () { reject(t.error || new Error("IndexedDB write was stopped")); };
      });
    });
  }
  function readBig() {
    return tx("readonly", function (os) {
      var got = {};
      BIG.forEach(function (k) { var r = os.get(k); r.onsuccess = function () { if (typeof r.result === "string") got[k] = r.result; }; });
      return { get result() { return got; } };
    });
  }

  // Every write goes to IndexedDB AT ONCE — its transaction is created inside setItem itself, so a
  // page that navigates away right after saving has already handed the write over. IndexedDB runs
  // read-write transactions on the same store in the order they're created, so writes land in
  // order. flush() resolves when everything written so far is safely stored.
  var openedDb = null;
  var pending = [];
  var warned = false;
  function failed(e) {
    api.error = String(e && e.message || e);
    if (!warned) {
      warned = true;
      try { window.alert("OpsMatrix couldn't save to this device's storage (" + api.error + "). Your last change may not be kept — make a backup (Scope → Data backup)."); } catch (x) { /* no alerts */ }
    }
  }
  function persist(k, v) {
    var done;
    try {
      var t = openedDb.transaction(STORE, "readwrite");
      if (v === null) t.objectStore(STORE)["delete"](k); else t.objectStore(STORE).put(v, k);
      done = new Promise(function (resolve, reject) {
        t.oncomplete = function () { resolve(); };
        t.onerror = function () { reject(t.error || new Error("IndexedDB write failed")); };
        t.onabort = function () { reject(t.error || new Error("IndexedDB write was stopped")); };
      });
    } catch (e) {
      done = Promise.reject(e);
    }
    done = done["catch"](failed);
    pending.push(done);
    done.then(function () { var i = pending.indexOf(done); if (i >= 0) pending.splice(i, 1); });
    return done;
  }
  api.flush = function () { return Promise.all(pending.slice()).then(function () { return undefined; }); };

  // ── localStorage, as every page's code sees it ───────────────────────────
  function allKeys(self) {
    var out = [], n = lengthOf.get.call(self);
    for (var i = 0; i < n; i++) { var k = nativeKey.call(self, i); if (!(loaded && isBig(k))) out.push(k); }
    if (loaded) for (var key in cache) if (Object.prototype.hasOwnProperty.call(cache, key)) out.push(key);
    return out;
  }
  function nativeSetWithRoom(self, k, v) {
    try {
      return nativeSet.call(self, k, v);
    } catch (e) {
      if (self !== store || String(k) === EDITABLE || !isQuota(e)) throw e;
      // still in localStorage (no IndexedDB here): the oldest editable floor copies give up room
      var sets;
      try { sets = JSON.parse(nativeGet.call(self, EDITABLE) || "[]"); } catch (x) { sets = []; }
      if (!Array.isArray(sets) || !sets.length) throw e;
      while (sets.length) {
        var oldest = 0;
        for (var i = 1; i < sets.length; i++) {
          var a = String((sets[i] && (sets[i].updatedAt || sets[i].createdAt)) || "");
          var b = String((sets[oldest] && (sets[oldest].updatedAt || sets[oldest].createdAt)) || "");
          if (a < b) oldest = i;
        }
        sets.splice(oldest, 1);
        try { nativeSet.call(self, EDITABLE, JSON.stringify(sets)); } catch (x) { continue; }
        try { return nativeSet.call(self, k, v); } catch (e2) { if (!isQuota(e2)) throw e2; }
      }
      throw e;
    }
  }
  proto.getItem = function (k) {
    if (this === store && loaded && isBig(k)) return Object.prototype.hasOwnProperty.call(cache, String(k)) ? cache[String(k)] : null;
    return nativeGet.call(this, k);
  };
  proto.setItem = function (k, v) {
    if (this === store && loaded && isBig(k)) {
      var s = String(v);
      cache[String(k)] = s;
      persist(String(k), s);
      return;
    }
    return nativeSetWithRoom(this, k, v);
  };
  proto.removeItem = function (k) {
    if (this === store && loaded && isBig(k)) {
      delete cache[String(k)];
      persist(String(k), null);
    }
    return nativeRemove.call(this, k);
  };
  proto.key = function (i) {
    if (this !== store || !loaded) return nativeKey.call(this, i);
    var all = allKeys(this);
    return i >= 0 && i < all.length ? all[i] : null;
  };
  proto.clear = function () {
    if (this === store && loaded) {
      for (var k in cache) if (Object.prototype.hasOwnProperty.call(cache, k)) persist(k, null);
      cache = {};
    }
    return nativeClear.call(this);
  };
  if (lengthOf && lengthOf.get) {
    Object.defineProperty(proto, "length", {
      configurable: true,
      enumerable: lengthOf.enumerable,
      get: function () { return this !== store || !loaded ? lengthOf.get.call(this) : allKeys(this).length; }
    });
  }

  // another open OpsMatrix page (a second tab) sees this page's writes
  var channel = null;
  try { channel = new BroadcastChannel("opsmatrix-storage"); } catch (e) { channel = null; }
  if (channel) {
    channel.onmessage = function (ev) {
      var m = ev && ev.data;
      if (!loaded || !m || !isBig(m.k)) return;
      if (m.v === null) delete cache[m.k]; else cache[m.k] = String(m.v);
    };
    var announce = persist;
    persist = function (k, v) { try { channel.postMessage({ k: k, v: v }); } catch (e) { /* alone */ } return announce(k, v); };
  }

  // ── start: fill the in-memory copy, move anything left in localStorage over ─
  if (!window.indexedDB) return;
  api.ready = readBig().then(function (fromDb) {
    var fresh = {}, moving = [];
    BIG.forEach(function (k) {
      var inLocal = nativeGet.call(store, k);
      // the big keys are never written to localStorage once moved, so a copy there is newer
      // (an earlier version of OpsMatrix, or the very first start)
      if (inLocal !== null) { fresh[k] = inLocal; moving.push(k); }
      else if (typeof fromDb[k] === "string") fresh[k] = fromDb[k];
    });
    // all of it moves in ONE transaction, and localStorage lets go only after it's safely in
    var moved = moving.length
      ? tx("readwrite", function (os) { moving.forEach(function (k) { os.put(fresh[k], k); }); })
      : Promise.resolve();
    return Promise.all([moved, openDb()]).then(function (got) {
      moving.forEach(function (k) { try { nativeRemove.call(store, k); } catch (x) { /* freed next start */ } });
      openedDb = got[1];
      cache = fresh;
      loaded = true;
      api.mode = "indexeddb";
    });
  })["catch"](function (e) {
    // IndexedDB can't be used here: everything stays in localStorage, as before
    loaded = false; cache = {}; api.mode = "local"; api.error = String(e && e.message || e);
  });
})();
