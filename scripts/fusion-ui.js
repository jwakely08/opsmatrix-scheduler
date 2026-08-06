// Fusion UI layer, injected into the classic app (plain ES5, no framework).
// Adds "Import magicplan Scan" wherever the Max Plans screen shows its
// "Add Floor Plan" / "Upload First Plan" buttons. On import it writes the
// classic app's own localStorage stores (opsmatrix_v7 + opsmatrix_v7_plans)
// and reloads, so every classic feature just sees more data.
(function () {
  "use strict";
  var BTN_ID = "fusion-import-btn";
  var OVERLAY_ID = "fusion-overlay";

  function findAnchorButtons() {
    var out = [];
    var buttons = document.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) {
      var t = (buttons[i].textContent || "").trim();
      if (t === "Add Floor Plan" || t === "Upload First Plan") out.push(buttons[i]);
    }
    return out;
  }

  function ensureButton() {
    if (!document.getElementById(BTN_ID)) {
      var anchors = findAnchorButtons();
      if (anchors.length) {
        var anchor = anchors[0];
        var btn = document.createElement("button");
        btn.id = BTN_ID;
        btn.type = "button";
        btn.textContent = "⚡ Import magicplan Scan";
        btn.className = anchor.className; // borrow the classic app's own styling
        btn.style.marginLeft = "8px";
        btn.addEventListener("click", openOverlay);
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
      }
    }
    ensureNavLink();
  }

  // Max Schedules IS the consolidated hub now: the classic nav item opens it.
  function ensureNavLink() {
    var navBtns = document.querySelectorAll("button");
    for (var i = 0; i < navBtns.length; i++) {
      var b = navBtns[i];
      var t = (b.textContent || "").trim();
      if (t === "Max Schedules" && !b.getAttribute("data-fusion-wired")) {
        b.setAttribute("data-fusion-wired", "1");
        b.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          window.location.href = "./maps.html";
        }, true); // capture: beat the classic app's own handler
      }
      // retire the sections Scope now owns
      if ((t === "Break Times" || t === "Turn Times" || t === "Turn Rules") && b.style.display !== "none") {
        b.style.display = "none";
      }
      // Admin Settings → scope opens the Scope manager (the one source of truth)
      if (t === "scope" && !b.getAttribute("data-fusion-wired")) {
        b.setAttribute("data-fusion-wired", "1");
        b.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          window.location.href = "./maps.html#scope";
        }, true);
      }
    }
    // Max Space gets its map entrance next to the Floor Plans tab
    if (!document.getElementById("fusion-space-map")) {
      var anchor = null;
      for (var j = 0; j < navBtns.length; j++) {
        if ((navBtns[j].textContent || "").trim() === "Floor Plans") { anchor = navBtns[j]; }
      }
      if (anchor && anchor.parentNode) {
        var mapBtn = document.createElement("button");
        mapBtn.id = "fusion-space-map";
        mapBtn.type = "button";
        mapBtn.className = anchor.className;
        mapBtn.textContent = "🗺 Map View";
        mapBtn.addEventListener("click", function () { window.location.href = "./maps.html#spaces"; });
        anchor.parentNode.insertBefore(mapBtn, anchor.nextSibling);
      }
    }
  }

  function openOverlay() {
    if (document.getElementById(OVERLAY_ID)) return;
    var wrap = document.createElement("div");
    wrap.id = OVERLAY_ID;
    wrap.setAttribute("style",
      "position:fixed;inset:0;z-index:99999;background:rgba(15,23,32,.55);" +
      "display:flex;align-items:center;justify-content:center;padding:20px;");
    var card = document.createElement("div");
    card.setAttribute("style",
      "background:#fff;border-radius:14px;max-width:460px;width:100%;padding:24px;" +
      "font-family:'Segoe UI',sans-serif;color:#1c2b33;box-shadow:0 18px 60px rgba(0,0,0,.35);");
    card.innerHTML =
      "<h3 style='margin:0 0 6px;font-size:17px'>Import a magicplan scan</h3>" +
      "<p style='margin:0 0 14px;font-size:13px;color:#5b7083'>Pick the floor plan (.dxf) and the " +
      "Statistics (.csv) from the same magicplan export. Rooms are detected automatically — " +
      "measured, typed, and drawn on the plan, ready for visual scheduling.</p>" +
      "<label style='font-size:11px;letter-spacing:.05em;color:#8fa3b0;text-transform:uppercase'>Building name</label>" +
      "<input id='fusion-building' type='text' value='Main Building' style='display:block;width:100%;margin:4px 0 12px;" +
      "padding:9px 10px;border:1px solid #d8e0e6;border-radius:7px;font-size:14px'/>" +
      "<label style='font-size:11px;letter-spacing:.05em;color:#8fa3b0;text-transform:uppercase'>Scan files (.dxf + .csv)</label>" +
      "<input id='fusion-files' type='file' multiple accept='.dxf,.csv' style='display:block;width:100%;margin:4px 0 4px;font-size:13px'/>" +
      "<div id='fusion-status' style='min-height:20px;font-size:12.5px;color:#0f6b62;margin:6px 0 10px'></div>" +
      "<div style='display:flex;gap:10px;justify-content:flex-end'>" +
      "<button id='fusion-cancel' type='button' style='padding:9px 16px;border:1px solid #d8e0e6;background:#fff;" +
      "border-radius:7px;font-size:13px;cursor:pointer'>Cancel</button>" +
      "<button id='fusion-go' type='button' style='padding:9px 18px;border:none;background:#0f6b62;color:#fff;" +
      "border-radius:7px;font-size:13px;font-weight:600;cursor:pointer'>Import</button></div>";
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
    document.getElementById("fusion-cancel").addEventListener("click", close);
    document.getElementById("fusion-go").addEventListener("click", runImport);
    function close() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }
  }

  function setStatus(msg, isErr) {
    var el = document.getElementById("fusion-status");
    if (el) { el.textContent = msg; el.style.color = isErr ? "#c34444" : "#0f6b62"; }
  }

  function readFile(f) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result)); };
      r.onerror = reject;
      r.readAsText(f);
    });
  }

  function runImport() {
    var files = document.getElementById("fusion-files").files;
    var building = document.getElementById("fusion-building").value || "Main Building";
    var dxfFile = null, csvFile = null;
    for (var i = 0; i < files.length; i++) {
      var n = files[i].name.toLowerCase();
      if (n.indexOf(".dxf") !== -1) dxfFile = files[i];
      if (n.indexOf(".csv") !== -1) csvFile = files[i];
    }
    if (!dxfFile || !csvFile) { setStatus("Please pick both files: one .dxf and one .csv", true); return; }
    setStatus("Detecting rooms…");
    Promise.all([readFile(dxfFile), readFile(csvFile)]).then(function (texts) {
      var result;
      try {
        result = window.OpsMatrixFusion.importScan(texts[0], texts[1], { building: building });
      } catch (e) {
        setStatus("Could not read that scan: " + (e && e.message ? e.message : e), true);
        return;
      }
      try {
        var v7 = {};
        try { v7 = JSON.parse(localStorage.getItem("opsmatrix_v7") || "{}") || {}; } catch (e2) { v7 = {}; }
        v7.spaces = (v7.spaces || []).concat(result.spaces);
        localStorage.setItem("opsmatrix_v7", JSON.stringify(v7));
        var plans = [];
        try { plans = JSON.parse(localStorage.getItem("opsmatrix_v7_plans") || "[]") || []; } catch (e3) { plans = []; }
        plans.push(result.plan);
        localStorage.setItem("opsmatrix_v7_plans", JSON.stringify(plans));
      } catch (e4) {
        setStatus("Import worked but saving failed (storage full?): " + e4, true);
        return;
      }
      var s = result.summary;
      setStatus("✓ " + s.rooms + " rooms imported, " + s.autoDetected + " drawn on the plan automatically" +
        (s.needsTracing ? " (" + s.needsTracing + " to trace by hand)" : "") + ". Reloading…");
      setTimeout(function () { window.location.reload(); }, 1200);
    }, function () {
      setStatus("Could not read those files", true);
    });
  }

  // the classic app re-renders constantly; keep our button present cheaply
  // (demo seeding lives in fusion-seed.js, injected BEFORE the app's script)
  var mo = new MutationObserver(function () { ensureButton(); });
  function boot() {
    ensureButton();
    mo.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
