// Demo seed — runs BEFORE the classic app's own script parses, so the app's
// very first load sees the seeded data (no races with its save effects).
// classic.html?demo=1 → preload a lived-in operation (stamped: reseeds only
// when the bundled data version changes). Plain classic.html never touches
// saved data.
(function () {
  "use strict";
  var DEMO_STAMP_KEY = "opsmatrix_v7_demo_stamp";
  var KEY_BACKUP = "opsmatrix_max_api_key";

  // ── the API key heal, BEFORE the classic app parses its state ─────────────
  // The classic app's save effect rewrites all of opsmatrix_v7 from memory,
  // so a key saved by a fusion overlay (or wiped by a reseed) used to vanish
  // on the next save. The dedicated backup slot survives everything; here it
  // is put back into settings.maxApiKey so the app LOADS it into state and
  // its own saves keep it from then on. (classicStore.healApiKey mirrors
  // this for maps.html.)
  function healApiKey() {
    try {
      var backup = String(localStorage.getItem(KEY_BACKUP) || "");
      var v7 = JSON.parse(localStorage.getItem("opsmatrix_v7") || "{}") || {};
      var inV7 = String((v7.settings || {}).maxApiKey || "");
      if (inV7 && inV7 !== backup) {
        localStorage.setItem(KEY_BACKUP, inV7);
      } else if (!inV7 && backup) {
        v7.settings = v7.settings || {};
        v7.settings.maxApiKey = backup;
        localStorage.setItem("opsmatrix_v7", JSON.stringify(v7));
      }
    } catch (e) { /* unreadable storage — nothing to heal */ }
  }

  try {
    if (/[?&]demo=1/.test(window.location.search) &&
        window.OpsMatrixFusion && window.OpsMatrixFusion.buildClassicDemo) {
      var stamp = window.OpsMatrixFusion.demoStamp();
      if (localStorage.getItem(DEMO_STAMP_KEY) !== stamp) {
        var demo = window.OpsMatrixFusion.buildClassicDemo();
        // a reseed refreshes the demo DATA — never the user's API key
        try {
          var oldV7 = JSON.parse(localStorage.getItem("opsmatrix_v7") || "{}") || {};
          var oldKey = String((oldV7.settings || {}).maxApiKey || "") ||
            String(localStorage.getItem(KEY_BACKUP) || "");
          if (oldKey) {
            demo.v7.settings = demo.v7.settings || {};
            demo.v7.settings.maxApiKey = oldKey;
          }
        } catch (eKey) { /* no key to carry over */ }
        localStorage.setItem("opsmatrix_v7", JSON.stringify(demo.v7));
        localStorage.setItem("opsmatrix_v7_plans", JSON.stringify(demo.plans));
        localStorage.setItem(DEMO_STAMP_KEY, stamp);
      }
    }
  } catch (e) {
    console.warn("OpsMatrix demo seed failed", e);
  }
  healApiKey();
})();
