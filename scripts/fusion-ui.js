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
        // Admin Settings gains Workload Intelligence right next to Scope
        if (!document.getElementById("fusion-admin-wi") && b.parentNode) {
          var wiBtn = document.createElement("button");
          wiBtn.id = "fusion-admin-wi";
          wiBtn.type = "button";
          wiBtn.className = b.className;
          wiBtn.textContent = "workload intelligence";
          wiBtn.addEventListener("click", function () { window.location.href = "./maps.html#workload"; });
          b.parentNode.insertBefore(wiBtn, b.nextSibling);
        }
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
      // ⬆ Upload: ONE front door for bringing space data in, so nobody has to
      // know which tab owns which file type before they can start
      if (!document.getElementById("fusion-upload-any") && anchor.parentNode) {
        var upBtn = document.createElement("button");
        upBtn.id = "fusion-upload-any";
        upBtn.type = "button";
        upBtn.className = anchor.className;
        upBtn.textContent = "⬆ Upload";
        upBtn.addEventListener("click", showUploadHub);
        anchor.parentNode.insertBefore(upBtn, anchor.parentNode.firstChild);
      }
      // undo the old hiding for anyone whose browser cached that build
      if (anchor.style.display === "none") anchor.style.display = "";
      openFloorPlansIfRequested(anchor);
    }
  }

  // ── ⬆ Upload: route by what the user has, not by which screen owns it ──────
  var HUB_ID = "fusion-upload-hub";

  function clickButtonByText(text) {
    var btns = document.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      if ((btns[i].textContent || "").trim() === text && btns[i].offsetParent !== null) {
        btns[i].click();
        return true;
      }
    }
    return false;
  }

  /** click "Add Floor Plan" once the Floor Plans screen has rendered it */
  function goToAddFloorPlan() {
    clickButtonByText("Floor Plans");
    var tries = 0;
    var t = setInterval(function () {
      if (clickButtonByText("Add Floor Plan") || clickButtonByText("Upload First Plan") || ++tries > 25) {
        clearInterval(t);
      }
    }, 120);
  }

  function showUploadHub() {
    if (document.getElementById(HUB_ID)) return;
    var wrap = document.createElement("div");
    wrap.id = HUB_ID;
    wrap.setAttribute("style",
      "position:fixed;inset:0;z-index:99998;background:rgba(15,23,32,.55);" +
      "display:flex;align-items:center;justify-content:center;padding:20px;");
    var tile = function (title, sub) {
      return "<button type='button' style='display:block;width:100%;text-align:left;margin-bottom:10px;" +
        "padding:14px 16px;border:1px solid #d8e0e6;border-radius:10px;background:#fff;cursor:pointer'>" +
        "<b style='font-size:14.5px;color:#1c2b33'>" + title + "</b>" +
        "<span style='display:block;font-size:12.5px;color:#5b7083;margin-top:3px'>" + sub + "</span></button>";
    };
    var card = document.createElement("div");
    card.setAttribute("style",
      "background:#fff;border-radius:14px;max-width:480px;width:100%;padding:24px;" +
      "font-family:'Segoe UI',sans-serif;color:#1c2b33;box-shadow:0 18px 60px rgba(0,0,0,.35);");
    card.innerHTML =
      "<h3 style='margin:0 0 4px;font-size:17px'>Upload space data</h3>" +
      "<p style='margin:0 0 14px;font-size:13px;color:#5b7083'>Pick what you have — OpsMatrix knows what to do with each.</p>" +
      "<div id='fusion-hub-plan'>" + tile("🗺 Floor plan — picture or PDF",
        "Max reads the rooms, numbers and sizes, then redraws the plan in OpsMatrix's own style.") + "</div>" +
      "<div id='fusion-hub-excel'>" + tile("📊 Room list — Excel or CSV",
        "A spreadsheet of rooms and details, imported straight into Max Space.") + "</div>" +
      "<div id='fusion-hub-magic'>" + tile("⚡ magicplan export — DXF + CSV",
        "A laser-measured scan. Rooms are detected and drawn exactly.") + "</div>" +
      "<div style='text-align:right'><button id='fusion-hub-cancel' type='button' " +
      "style='padding:7px 14px;border:none;background:none;font-size:12.5px;color:#8fa3b0;cursor:pointer'>Cancel</button></div>";
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    function close() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }
    wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
    document.getElementById("fusion-hub-cancel").addEventListener("click", close);
    document.getElementById("fusion-hub-plan").addEventListener("click", function () { close(); goToAddFloorPlan(); });
    document.getElementById("fusion-hub-excel").addEventListener("click", function () {
      close();
      openRoomListPicker();
    });
    document.getElementById("fusion-hub-magic").addEventListener("click", function () { close(); openOverlay(); });
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

  /** first page of a PDF → canvas, rendered big enough for room detection */
  function pdfToCanvas(file) {
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
          .then(function () { return canvas; });
      });
  }

  function pdfToPngFile(file) {
    return pdfToCanvas(file).then(function (canvas) {
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) {
          var name = (file.name || "floor-plan").replace(/\.pdf$/i, "") + ".png";
          resolve(new File([blob], name, { type: "image/png" }));
        }, "image/png");
      });
    });
  }

  /** a box within a box → the same box on the original source */
  function composeBoxes(outer, inner) {
    var w = outer.x1 - outer.x0, h = outer.y1 - outer.y0;
    return {
      x0: outer.x0 + inner.x0 * w, y0: outer.y0 + inner.y0 * h,
      x1: outer.x0 + inner.x1 * w, y1: outer.y0 + inner.y1 * h
    };
  }

  /**
   * Any plan file → { dataUrl, width, height, aspect, renderRegion } for the
   * AI reader. renderRegion re-renders a slice of the SOURCE at full quality,
   * which is what lets the reader zoom in on the drawing part of an
   * architect's sheet — PDFs re-rasterise from vectors, images crop from the
   * original pixels.
   */
  function fileToPlanImage(file) {
    if (isPdf(file)) {
      return loadPdfLib()
        .then(function (lib) { return file.arrayBuffer().then(function (buf) { return lib.getDocument({ data: buf }).promise; }); })
        .then(function (doc) { return doc.getPage(1); })
        .then(function (page) {
          var base = page.getViewport({ scale: 1 });
          function renderAt(box, target) {
            var bw = (box.x1 - box.x0) * base.width;
            var bh = (box.y1 - box.y0) * base.height;
            var scale = Math.min(8, Math.max(1, target / Math.max(bw, bh)));
            var viewport = page.getViewport({
              scale: scale,
              offsetX: -box.x0 * base.width * scale,
              offsetY: -box.y0 * base.height * scale
            });
            var canvas = document.createElement("canvas");
            canvas.width = Math.round(bw * scale);
            canvas.height = Math.round(bh * scale);
            var ctx = canvas.getContext("2d");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            return page.render({ canvasContext: ctx, viewport: viewport, canvas: canvas }).promise
              .then(function () {
                return {
                  dataUrl: canvas.toDataURL("image/png"),
                  width: canvas.width, height: canvas.height,
                  aspect: canvas.width / canvas.height,
                  renderRegion: function (b, t) { return renderAt(composeBoxes(box, b), t); }
                };
              });
          }
          return renderAt({ x0: 0, y0: 0, x1: 1, y1: 1 }, 2000);
        });
    }
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        function renderAt(box, target) {
          var sx = box.x0 * img.width, sy = box.y0 * img.height;
          var sw = (box.x1 - box.x0) * img.width, sh = (box.y1 - box.y0) * img.height;
          var scale = Math.min(1, target / Math.max(sw, sh)); // never upscale pixels
          var canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(sw * scale));
          canvas.height = Math.max(1, Math.round(sh * scale));
          var ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
          return Promise.resolve({
            dataUrl: canvas.toDataURL("image/jpeg", 0.92),
            width: canvas.width, height: canvas.height,
            aspect: canvas.width / canvas.height,
            renderRegion: function (b, t) { return renderAt(composeBoxes(box, b), t); }
          });
        }
        renderAt({ x0: 0, y0: 0, x1: 1, y1: 1 }, 2000).then(resolve, reject);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("That image could not be opened.")); };
      img.src = url;
    });
  }

  // ── the Anthropic API key: one setting, saved on this device only ──────────
  function getApiKey() {
    try {
      var v7 = JSON.parse(localStorage.getItem("opsmatrix_v7") || "{}") || {};
      return String((v7.settings || {}).maxApiKey || "");
    } catch (e) { return ""; }
  }
  function setApiKey(key) {
    try {
      var v7 = JSON.parse(localStorage.getItem("opsmatrix_v7") || "{}") || {};
      v7.settings = v7.settings || {};
      v7.settings.maxApiKey = String(key || "").trim();
      localStorage.setItem("opsmatrix_v7", JSON.stringify(v7));
      return true;
    } catch (e) { return false; }
  }
  function keyTail(key) { return key.length > 4 ? "…" + key.slice(-4) : ""; }

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
    // a re-dispatch from "upload as picture only" — let the classic app have it
    if (input.getAttribute("data-fusion-passthrough")) {
      input.removeAttribute("data-fusion-passthrough");
      return;
    }
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

    // Every plan upload gets the choice, right here: read it with Max, or
    // upload the raw picture and trace by hand. Nobody has to know a second
    // screen exists to reach the smart path.
    e.stopImmediatePropagation();
    e.preventDefault();
    // WE hold the file from here. The picker is emptied immediately so the
    // classic app cannot also store the raw picture — one upload, one plan.
    input.value = "";
    showSmartChoice(input, file, f.building ? f.building.value.trim() : "", f.floor ? f.floor.value.trim() : "");
  }

  /** hand the held file to the classic app's own handler, untouched */
  function passThrough(input, file) {
    input.setAttribute("data-fusion-passthrough", "1");
    if (!isPdf(file)) {
      var dt0 = new DataTransfer();
      dt0.items.add(file);
      input.files = dt0.files;
    }
    if (isPdf(file)) {
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
        input.removeAttribute("data-fusion-passthrough");
        input.value = "";
        note.textContent = "Could not read that PDF (" + err + "). Try exporting it as a PNG.";
        note.style.background = "#b91c1c";
        setTimeout(function () { note.remove(); }, 6000);
      });
    } else {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  // ── "How should this plan come in?" — the choice every upload now gets ─────
  var SMART_ID = "fusion-smart";

  function showSmartChoice(input, file, building, floor) {
    if (document.getElementById(SMART_ID)) return;
    var wrap = document.createElement("div");
    wrap.id = SMART_ID;
    wrap.setAttribute("style",
      "position:fixed;inset:0;z-index:99999;background:rgba(15,23,32,.55);" +
      "display:flex;align-items:center;justify-content:center;padding:20px;");
    var savedKey = getApiKey();
    var card = document.createElement("div");
    card.setAttribute("style",
      "background:#fff;border-radius:14px;max-width:520px;width:100%;padding:24px;" +
      "font-family:'Segoe UI',sans-serif;color:#1c2b33;box-shadow:0 18px 60px rgba(0,0,0,.35);");
    card.innerHTML =
      "<h3 style='margin:0 0 6px;font-size:17px'>How should this floor plan come in?</h3>" +
      "<p style='margin:0 0 14px;font-size:13px;color:#5b7083'>" + esc(file.name) + " → " +
      esc(building || "?") + ", floor " + esc(floor || "?") + "</p>" +

      "<div style='border:2px solid #0f6b62;border-radius:10px;padding:14px;margin-bottom:10px'>" +
      "<b style='font-size:14.5px'>✨ Read it with Max <span style='font-weight:400;color:#5b7083'>(recommended)</span></b>" +
      "<p style='margin:6px 0 10px;font-size:12.5px;color:#5b7083'>Max reads the rooms, their numbers and any square footage " +
      "printed on the plan, then OpsMatrix redraws it in its own clean style. If the plan states its sizes, " +
      "there is nothing to calibrate or measure.</p>" +
      "<div id='fusion-keyrow'></div>" +
      "<button id='fusion-smart-go' type='button' style='width:100%;padding:11px;border:none;background:#0f6b62;color:#fff;" +
      "border-radius:8px;font-size:14px;font-weight:600;cursor:pointer'>✨ Read the plan</button>" +
      "</div>" +

      "<button id='fusion-smart-raw' type='button' style='width:100%;padding:10px;border:1px solid #d8e0e6;background:#fff;" +
      "border-radius:8px;font-size:13px;cursor:pointer;color:#39505c'>Upload as a picture only — trace and calibrate by hand</button>" +
      "<div id='fusion-smart-status' style='min-height:18px;font-size:12.5px;color:#0f6b62;margin-top:10px'></div>" +
      "<div style='text-align:right;margin-top:4px'>" +
      "<button id='fusion-smart-cancel' type='button' style='padding:7px 14px;border:none;background:none;" +
      "font-size:12.5px;color:#8fa3b0;cursor:pointer'>Cancel</button></div>";
    wrap.appendChild(card);
    document.body.appendChild(wrap);

    renderKeyRow(savedKey);

    function renderKeyRow(key) {
      var row = document.getElementById("fusion-keyrow");
      if (!row) return;
      if (key) {
        row.innerHTML =
          "<p style='margin:0 0 10px;font-size:12.5px;color:#0f6b62'>✓ API key saved on this device (" +
          esc(keyTail(key)) + ") <button id='fusion-key-change' type='button' style='border:none;background:none;" +
          "color:#5b7083;text-decoration:underline;cursor:pointer;font-size:12px'>change</button></p>";
        var chg = document.getElementById("fusion-key-change");
        if (chg) chg.addEventListener("click", function () { renderKeyRow(""); });
      } else {
        row.innerHTML =
          "<div style='display:flex;gap:8px;margin-bottom:10px'>" +
          "<input id='fusion-key-input' type='password' placeholder='Anthropic API key (sk-ant-api…)' " +
          "style='flex:1;padding:9px 10px;border:1px solid #d8e0e6;border-radius:7px;font-size:13px'/>" +
          "<button id='fusion-key-save' type='button' style='padding:9px 14px;border:none;background:#123c47;color:#fff;" +
          "border-radius:7px;font-size:13px;cursor:pointer'>Save</button></div>";
        var save = document.getElementById("fusion-key-save");
        if (save) save.addEventListener("click", function () {
          var v = (document.getElementById("fusion-key-input").value || "").trim();
          if (!v) { setSmartStatus("Paste the API key first.", true); return; }
          if (setApiKey(v)) { renderKeyRow(v); setSmartStatus("✓ Key saved on this device."); }
          else setSmartStatus("Could not save the key (storage unavailable).", true);
        });
      }
    }

    function close() {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      input.value = "";
    }
    wrap.addEventListener("click", function (ev) { if (ev.target === wrap) close(); });
    document.getElementById("fusion-smart-cancel").addEventListener("click", close);
    document.getElementById("fusion-smart-raw").addEventListener("click", function () {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      passThrough(input, file);
    });
    document.getElementById("fusion-smart-go").addEventListener("click", function () {
      var key = getApiKey();
      if (!key) { setSmartStatus("Save the API key above first — one time only.", true); return; }
      runSmartImport(file, building, floor, key, close);
    });
  }

  function setSmartStatus(msg, isErr) {
    var el = document.getElementById("fusion-smart-status");
    if (el) { el.textContent = msg; el.style.color = isErr ? "#c34444" : "#0f6b62"; }
  }

  function runSmartImport(file, building, floor, key, closeOverlay) {
    var go = document.getElementById("fusion-smart-go");
    if (go) { go.disabled = true; go.textContent = "Working…"; }
    setSmartStatus("Opening " + file.name + "…");
    fileToPlanImage(file).then(function (picture) {
      return window.OpsMatrixFusion.importPlanFromImage({
        apiKey: key,
        imageDataUrl: picture.dataUrl,
        imageWidth: picture.width,
        imageHeight: picture.height,
        aspect: picture.aspect,
        renderRegion: picture.renderRegion,
        building: building,
        floor: floor,
        onProgress: function (m) { setSmartStatus(m); }
      });
    }).then(function (result) {
      persistImport(result);
      var printed = 0;
      for (var i = 0; i < result.spaces.length; i++) {
        if (Number(result.spaces[i].squareFeet) > 0) printed++;
      }
      var scaled = result.plan && result.plan.ratio;
      setSmartStatus("✓ " + result.spaces.length + " rooms read and drawn" +
        (scaled ? " — already to scale, nothing to calibrate" : "") + ". Reloading…");
      setTimeout(function () { window.location.reload(); }, 1400);
    }).catch(function (err) {
      if (go) { go.disabled = false; go.textContent = "✨ Read the plan"; }
      setSmartStatus((err && err.message ? err.message : String(err)), true);
    });
  }

  /** write an ImportResult into the classic stores (shared with magicplan).
   *  Rooms that already exist (a room-list import) get the geometry ATTACHED
   *  to them instead of being duplicated. */
  function persistImport(result) {
    var v7 = {};
    try { v7 = JSON.parse(localStorage.getItem("opsmatrix_v7") || "{}") || {}; } catch (e) { v7 = {}; }
    v7.spaces = v7.spaces || [];
    try {
      window.OpsMatrixFusion.attachPlanToRooms(v7.spaces, result);
    } catch (eAttach) {
      v7.spaces = v7.spaces.concat(result.spaces); // never lose an import over matching
    }
    localStorage.setItem("opsmatrix_v7", JSON.stringify(v7));
    var plans = [];
    try { plans = JSON.parse(localStorage.getItem("opsmatrix_v7_plans") || "[]") || []; } catch (e2) { plans = []; }
    plans.push(result.plan);
    localStorage.setItem("opsmatrix_v7_plans", JSON.stringify(plans));
  }

  // ── 📊 Room list (Excel/CSV) → canonical rooms, right here in Classic ──────
  function openRoomListPicker() {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xlsm,.xls,.csv,.tsv";
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      document.body.removeChild(input);
      if (!file) return;
      var note = showNote("Reading " + file.name + "…");
      readSheets(file).then(function (sheets) {
        var summary = window.OpsMatrixFusion.importRoomListIntoStorage(sheets, { fileName: file.name });
        note.remove();
        showRoomListResult(summary);
      }).catch(function (err) {
        note.remove();
        var n = showNote("⚠ " + (err && err.message ? err.message : String(err)));
        setTimeout(function () { n.remove(); }, 8000);
      });
    });
    input.click();
  }

  /** file → [{name, rows}] via the same-origin SheetJS the page already has */
  function readSheets(file) {
    return new Promise(function (resolve, reject) {
      var isCsv = /\.(csv|tsv)$/i.test(file.name);
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("That file could not be opened.")); };
      reader.onload = function () {
        try {
          var wb = isCsv
            ? XLSX.read(String(reader.result), { type: "string" })
            : XLSX.read(new Uint8Array(reader.result), { type: "array" });
          var sheets = wb.SheetNames.map(function (name) {
            return {
              name: name,
              rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: true })
            };
          });
          resolve(sheets);
        } catch (e) {
          reject(new Error("That spreadsheet could not be read. Save it as .xlsx or .csv and try again."));
        }
      };
      if (isCsv) reader.readAsText(file); else reader.readAsArrayBuffer(file);
    });
  }

  function showRoomListResult(s) {
    var wrap = document.createElement("div");
    wrap.setAttribute("style",
      "position:fixed;inset:0;z-index:99998;background:rgba(15,23,32,.55);" +
      "display:flex;align-items:center;justify-content:center;padding:20px;");
    var line = function (k, v) {
      return "<div style='display:flex;justify-content:space-between;gap:14px;padding:3px 0;font-size:13px'>" +
        "<span style='color:#5b7083'>" + esc(k) + "</span><b style='color:#1c2b33;text-align:right'>" + esc(v) + "</b></div>";
    };
    var lines =
      line("New rooms created", String(s.created)) +
      (s.updated ? line("Existing rooms updated", String(s.updated)) : "") +
      (s.unchanged ? line("Already up to date", String(s.unchanged)) : "") +
      (s.keptManualEdits ? line("Your manual edits kept", String(s.keptManualEdits)) : "") +
      line("List View", "Available now") +
      line("Max Schedule", "Rooms available") +
      line("Workload Intelligence", "Analysis available") +
      line("Map View", "No floor plan provided — add one any time") +
      (s.sqftSource ? line("Square footage source", s.sqftSource) : "") +
      line("Floors detected", String(s.floors.length)) +
      (s.deptNamesMissing ? line("Department names", "missing where not supplied") : "") +
      line("Floor type coverage", s.rows ? Math.round((s.floorTypeMapped / s.rows) * 100) + "%" : "—") +
      (s.needsReview ? line("Rooms needing review", String(s.needsReview)) : "");
    var warns = (s.warnings || []).map(function (w) {
      return "<p style='color:#b45309;font-size:12px;margin:6px 0 0'>⚠ " + esc(w) + "</p>";
    }).join("");
    var card = document.createElement("div");
    card.setAttribute("style",
      "background:#fff;border-radius:14px;max-width:460px;width:100%;padding:24px;" +
      "font-family:'Segoe UI',sans-serif;color:#1c2b33;box-shadow:0 18px 60px rgba(0,0,0,.35);");
    card.innerHTML =
      "<h3 style='margin:0 0 2px;font-size:17px'>✓ Room list imported</h3>" +
      "<p style='margin:0 0 12px;font-size:13px;color:#5b7083'>" + s.rows + " rooms/spaces processed.</p>" +
      lines + warns +
      "<div style='display:flex;gap:10px;justify-content:flex-end;margin-top:16px'>" +
      "<button id='fusion-rl-wi' type='button' style='padding:9px 14px;border:1px solid #d8e0e6;background:#fff;" +
      "border-radius:8px;font-size:13px;cursor:pointer;color:#39505c'>Open Workload Intelligence</button>" +
      "<button id='fusion-rl-ok' type='button' style='padding:9px 16px;border:none;background:#0d9488;color:#fff;" +
      "border-radius:8px;font-size:13px;font-weight:600;cursor:pointer'>Open the rooms</button></div>";
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    document.getElementById("fusion-rl-ok").addEventListener("click", function () { window.location.reload(); });
    document.getElementById("fusion-rl-wi").addEventListener("click", function () {
      window.location.href = "./maps.html#workload";
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
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
