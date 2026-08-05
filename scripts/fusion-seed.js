// Demo seed — runs BEFORE the classic app's own script parses, so the app's
// very first load sees the seeded data (no races with its save effects).
// classic.html?demo=1 → preload a lived-in operation (stamped: reseeds only
// when the bundled data version changes). Plain classic.html never touches
// saved data.
(function () {
  "use strict";
  var DEMO_STAMP_KEY = "opsmatrix_v7_demo_stamp";
  try {
    if (!/[?&]demo=1/.test(window.location.search)) return;
    if (!window.OpsMatrixFusion || !window.OpsMatrixFusion.buildClassicDemo) return;
    var stamp = window.OpsMatrixFusion.demoStamp();
    if (localStorage.getItem(DEMO_STAMP_KEY) === stamp) return;
    var demo = window.OpsMatrixFusion.buildClassicDemo();
    localStorage.setItem("opsmatrix_v7", JSON.stringify(demo.v7));
    localStorage.setItem("opsmatrix_v7_plans", JSON.stringify(demo.plans));
    localStorage.setItem(DEMO_STAMP_KEY, stamp);
  } catch (e) {
    console.warn("OpsMatrix demo seed failed", e);
  }
})();
