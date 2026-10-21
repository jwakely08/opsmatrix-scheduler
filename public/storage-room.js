// Storage room-maker (Josh, 2026-10-20). OpsMatrix keeps its data in this browser's localStorage,
// which holds only about 5 MB per site (iPads can allow less), and every floor picture is large.
// When a save doesn't fit, the Calibration Editor's editable copies of floors
// (opsmatrix_fusion_planstudio — the largest store, and the only optional one) give up room,
// oldest first, and the save is tried again. Floors, rooms, plans and schedules never depend on
// those copies; a CAD floor can always be brought in again from its file. Loaded first on every
// page (maps.html, and inlined into classic.html by scripts/make-classic.cjs).
(function () {
  "use strict";
  var EDITABLE = "opsmatrix_fusion_planstudio";
  var store;
  try { store = window.localStorage; } catch (e) { return; }
  if (!store || window.__opsmatrixStorageRoom) return;
  window.__opsmatrixStorageRoom = true;
  var proto = Object.getPrototypeOf(store);
  var setItem = proto.setItem;
  function isQuota(e) {
    return !!e && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014);
  }
  proto.setItem = function (key, value) {
    try {
      return setItem.call(this, key, value);
    } catch (e) {
      if (this !== store || String(key) === EDITABLE || !isQuota(e)) throw e;
      var sets;
      try { sets = JSON.parse(store.getItem(EDITABLE) || "[]"); } catch (x) { sets = []; }
      if (!Array.isArray(sets) || !sets.length) throw e;
      while (sets.length) {
        var oldest = 0;
        for (var i = 1; i < sets.length; i++) {
          var a = String((sets[i] && (sets[i].updatedAt || sets[i].createdAt)) || "");
          var b = String((sets[oldest] && (sets[oldest].updatedAt || sets[oldest].createdAt)) || "");
          if (a < b) oldest = i;
        }
        sets.splice(oldest, 1);
        try { setItem.call(this, EDITABLE, JSON.stringify(sets)); } catch (x) { continue; }
        try {
          var done = setItem.call(this, key, value);
          try { console.warn("OpsMatrix: this device's storage was full — removed an editable floor copy to make room."); } catch (x) { /* no console */ }
          return done;
        } catch (e2) {
          if (!isQuota(e2)) throw e2;
        }
      }
      throw e;
    }
  };
})();
