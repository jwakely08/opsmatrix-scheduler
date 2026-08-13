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
    ensurePdfSupport();
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
    // Max Space gains a Map View tab, but Floor Plans STAYS: it owns uploading
    // a floor plan image and "✨ AI Detect Rooms (Max)" — the only on-ramp for
    // a plan that did not come from a magicplan export. Hiding it (as an
    // earlier build did) took the whole image + AI detection path with it.
    var anchor = null;
    for (var j = 0; j < navBtns.length; j++) {
      if ((navBtns[j].textContent || "").trim() === "Floor Plans") { anchor = navBtns[j]; }
    }
    if (anchor) {
      if (!document.getElementById("fusion-space-map") && anchor.parentNode) {
        var mapBtn = document.createElement("button");
        mapBtn.id = "fusion-space-map";
        mapBtn.type = "button";
        mapBtn.className = anchor.className;
        mapBtn.textContent = "🗺 Map View";
        mapBtn.addEventListener("click", function () { window.location.href = "./maps.html#spaces"; });
        anchor.parentNode.insertBefore(mapBtn, anchor.nextSibling);
      }
      // undo the old hiding for anyone whose browser cached that build
      if (anchor.style.display === "none") anchor.style.display = "";
      openFloorPlansIfRequested(anchor);
    }
  }

  /**
   * ?fp=1 lands the user straight on Max Space → Floor Plans, so the hub's
   * "AI Detect Rooms from an image" button is one click rather than a
   * two-step hunt through the nav.
   */
  var deepLinked = false;
  function openFloorPlansIfRequested(floorPlansBtn) {
    if (deepLinked || !/[?&]fp=1/.test(window.location.search)) return;
    deepLinked = true;
    floorPlansBtn.click();
  }

  // bounded: the observer fires on every re-render, so give up rather than
  // clicking forever if a future Classic build stops showing Floor Plans
  var spaceTries = 0;
  function ensureSpaceScreen() {
    if (!/[?&]fp=1/.test(window.location.search) || deepLinked) return;
    if (spaceTries++ > 20) { deepLinked = true; return; }
    var btns = document.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      if ((btns[i].textContent || "").trim() === "Max Space") { btns[i].click(); return; }
    }
  }

  // ── PDF floor plans ────────────────────────────────────────────────────────
  // The classic app's plan picker only accepts images and reads the file
  // straight to a data URL. Rather than touch the archive, we widen the picker
  // and convert a chosen PDF's first page to a PNG before the app ever sees
  // it — so naming, calibration and AI detection all run unchanged.

  var PDFJS_URL = "./pdfjs/pdf.min.mjs";
  var PDF_WORKER_URL = "./pdfjs/pdf.worker.min.mjs";
  var pdfLibPromise = null;

  function loadPdfLib() {
    if (!pdfLibPromise) {
      // lazy: nobody downloads 1.7MB of pdf.js unless they pick a PDF
      pdfLibPromise = import(PDFJS_URL).then(function (lib) {
        lib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
        return lib;
      });
    }
    return pdfLibPromise;
  }

  /** first page of a PDF → PNG File, rendered big enough for room detection */
  function pdfToPngFile(file) {
    return loadPdfLib()
      .then(function (lib) { return file.arrayBuffer().then(function (buf) { return lib.getDocument({ data: buf }).promise; }); })
      .then(function (doc) { return doc.getPage(1); })
      .then(function (page) {
        // target ~2000px on the long edge: enough detail for Max to read walls
        var base = page.getViewport({ scale: 1 });
        var scale = Math.min(4, Math.max(1, 2000 / Math.max(base.width, base.height)));
        var viewport = page.getViewport({ scale: scale });
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff"; // PDFs are transparent; walls need a white ground
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return page.render({ canvasContext: ctx, viewport: viewport, canvas: canvas }).promise
          .then(function () {
            return new Promise(function (resolve) {
              canvas.toBlob(function (blob) {
                var name = (file.name || "floor-plan").replace(/\.pdf$/i, "") + ".png";
                resolve(new File([blob], name, { type: "image/png" }));
              }, "image/png");
            });
          });
      });
  }

  function isPdf(file) {
    return file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name || ""));
  }

  /**
   * The archive's own wording predates PDF support and actively tells the user
   * PDFs are not allowed ("Choose Floor Plan Image", "PNG or JPG"). Retext both
   * — replacing only the text node, so the button keeps its icon <span>.
   * Runs on every re-render; the guards stop it re-firing on its own change.
   */
  function relabelPlanPicker() {
    var btns = document.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      var kids = btns[i].childNodes;
      for (var k = 0; k < kids.length; k++) {
        if (kids[k].nodeType === 3 && (kids[k].nodeValue || "").trim() === "Choose Floor Plan Image") {
          kids[k].nodeValue = "Choose Floor Plan (image or PDF)";
        }
      }
    }
    var hints = document.querySelectorAll("p");
    for (var j = 0; j < hints.length; j++) {
      if (hints[j].children.length) continue;
      var txt = hints[j].textContent || "";
      if (txt.indexOf("PNG or JPG") !== -1) {
        hints[j].textContent = txt.replace("PNG or JPG", "PNG, JPG or PDF");
      }
    }
  }

  /** widen the plan picker and transparently convert PDFs */
  function ensurePdfSupport() {
    relabelPlanPicker();
    var inputs = document.querySelectorAll('input[type="file"]');
    for (var i = 0; i < inputs.length; i++) {
      var input = inputs[i];
      if ((input.accept || "").indexOf("image/") !== 0) continue; // plan picker only
      if (input.getAttribute("data-fusion-pdf")) continue;
      input.setAttribute("data-fusion-pdf", "1");
      input.accept = "image/*,application/pdf,.pdf";
      input.addEventListener("change", onPlanFileChosen, true); // capture: beat React
    }
  }

  /**
   * The classic app requires Building and Floor BEFORE a file, and silently
   * throws the file away when they are blank — you pick a plan and nothing
   * happens, with no message. Find those two fields so we can say so.
   * Returns nulls if the form ever changes shape; we then fail open rather
   * than block a working upload.
   */
  function planFormFields() {
    var building = null, floor = null;
    var inputs = document.querySelectorAll("input");
    for (var i = 0; i < inputs.length; i++) {
      var ph = inputs[i].placeholder || "";
      if (/main tower/i.test(ph)) building = inputs[i];
      else if (/^e\.g\.\s*4$/i.test(ph.trim())) floor = inputs[i];
    }
    return { building: building, floor: floor };
  }

  function onPlanFileChosen(e) {
    var input = e.target;
    var file = input.files && input.files[0];
    if (!file || input.getAttribute("data-fusion-converting")) return;

    // say what the app won't: which box still needs filling in
    var f = planFormFields();
    var missing = [];
    if (f.building && !f.building.value.trim()) missing.push("Building");
    if (f.floor && !f.floor.value.trim()) missing.push("Floor");
    if (missing.length) {
      e.stopImmediatePropagation();
      e.preventDefault();
      input.value = "";
      var warn = showNote("Type the " + missing.join(" and ") +
        " above first, then choose your floor plan again.");
      warn.style.background = "#b45309";
      setTimeout(function () { warn.remove(); }, 6000);
      var focusMe = (f.building && !f.building.value.trim()) ? f.building : f.floor;
      if (focusMe) focusMe.focus();
      return;
    }

    if (!isPdf(file)) return; // images already work — let them straight through
    // hold the PDF back; hand the app a PNG instead
    e.stopImmediatePropagation();
    e.preventDefault();
    input.setAttribute("data-fusion-converting", "1");
    var note = showNote("Converting " + file.name + "…");
    pdfToPngFile(file).then(function (png) {
      var dt = new DataTransfer();
      dt.items.add(png);
      input.files = dt.files;
      input.removeAttribute("data-fusion-converting");
      note.remove();
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }).catch(function (err) {
      input.removeAttribute("data-fusion-converting");
      input.value = "";
      note.textContent = "Could not read that PDF (" + err + "). Try exporting it as a PNG.";
      note.style.background = "#b91c1c";
      setTimeout(function () { note.remove(); }, 6000);
    });
  }

  function showNote(text) {
    var n = document.createElement("div");
    n.textContent = text;
    n.style.cssText = "position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:99999;" +
      "background:#0d9488;color:#fff;padding:10px 18px;border-radius:10px;font:600 14px 'Segoe UI',sans-serif;" +
      "box-shadow:0 8px 30px rgba(0,0,0,.45)";
    document.body.appendChild(n);
    return n;
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
  var mo = new MutationObserver(function () { ensureSpaceScreen(); ensureButton(); });
  function boot() {
    ensureSpaceScreen();
    ensureButton();
    // characterData too: React swaps some labels (e.g. the plan picker's) by
    // rewriting the text node in place, which is not a childList mutation.
    // Our relabels are guarded by an exact-match test, so this cannot loop.
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
