// Fusion UI layer, injected into the classic app (plain ES5, no framework).
// Adds "Import magicplan Scan" wherever the Max Plans screen shows its
// "Add Floor Plan" / "Upload First Plan" buttons. On import it writes the
// classic app's own localStorage stores (opsmatrix_v7 + opsmatrix_v7_plans)
// and reloads, so every classic feature just sees more data.
(function () {
  "use strict";
  var OVERLAY_ID = "fusion-overlay";

  /**
   * Uploading happens in exactly ONE place (Josh's rule, 2026-08-24): Max
   * Space's ⬆ Upload button, three options, nothing else. The classic app's
   * own "Add Floor Plan" / "Upload First Plan" buttons were the old manual
   * path — they are hidden, not rewired, so the archive stays untouched.
   */
  function hideClassicPlanUploadButtons() {
    var buttons = document.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) {
      var t = (buttons[i].textContent || "").trim();
      if ((t === "Add Floor Plan" || t === "Upload First Plan") && buttons[i].style.display !== "none") {
        buttons[i].style.display = "none";
      }
    }
  }

  function ensureButton() {
    hideClassicPlanUploadButtons();
    hideCloudManagedSettings();
    ensureNavLink();
    fixArchivePages();
    ensureBackButton();
    wireMaxQuality();
  }

  // Max Schedules IS the consolidated hub now: the classic nav item opens it.
  function ensureNavLink() {
    var navBtns = document.querySelectorAll("button");
    for (var i = 0; i < navBtns.length; i++) {
      var b = navBtns[i];
      var t = (b.textContent || "").trim();
      // Max Space lives in the hub now (Explorer + Room List + Map View,
      // rebuilt 2026-08-28 with every data point Josh asked for). The
      // archive's own Max Space stays reachable ONLY for Floor Plans /
      // calibration, via flags set before this button is clicked.
      if (t === "Max Space" && !b.getAttribute("data-fusion-space-wired")) {
        b.setAttribute("data-fusion-space-wired", "1");
        b.addEventListener("click", function (e) {
          if (/[?&]fp=1/.test(window.location.search)) return;           // deep link to Floor Plans
          e.preventDefault();
          e.stopPropagation();
          window.location.href = "./maps.html#spaces";
        }, true);
      }
      // the archive's Explorer/Table strip buttons (visible on its Floor
      // Plans screen) land on the rebuilt hub views
      if ((t === "Explorer" || t === "Table") && !b.getAttribute("data-fusion-wired")) {
        b.setAttribute("data-fusion-wired", "1");
        (function (label) {
          b.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            window.location.href = "./maps.html#spaces?view=" + (label === "Table" ? "list" : "explorer");
          }, true);
        })(t);
      }
      if (t === "Max Schedules" && !b.getAttribute("data-fusion-wired")) {
        b.setAttribute("data-fusion-wired", "1");
        b.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          window.location.href = "./maps.html";
        }, true); // capture: beat the classic app's own handler
        // Max Floor Care lives right under Max Schedules in the nav.
        // Same anatomy as the classic app's own items (nav-icon + nav-label
        // spans, 16px stroke icon) so it looks native — a floor machine
        // outline, not an emoji.
        if (!document.getElementById("fusion-nav-floorcare") && b.parentNode) {
          var fcBtn = document.createElement("button");
          fcBtn.id = "fusion-nav-floorcare";
          fcBtn.type = "button";
          fcBtn.className = b.className;
          fcBtn.innerHTML =
            '<span class="nav-icon">' +
            '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" ' +
            'stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">' +
            '<path d="M17 3l-6 8"/><circle cx="10" cy="16" r="5"/><path d="M4 22h16"/>' +
            "</svg></span>" +
            '<span class="nav-label">Max Floor Care</span>';
          fcBtn.addEventListener("click", function () { window.location.href = "./maps.html#floorcare"; });
          b.parentNode.insertBefore(fcBtn, b.nextSibling);
        }
      }
      // retire the sections Scope now owns
      if ((t === "Break Times" || t === "Turn Times" || t === "Turn Rules") && b.style.display !== "none") {
        b.style.display = "none";
      }
      // Classic's own "Import"/"Import Spaces" buttons led to its retired
      // import page — every road into OpsMatrix now goes through the ONE
      // ⬆ Upload hub (Josh's rule: one place to upload, three options)
      if ((t === "Import" || t === "Import Spaces") && !b.getAttribute("data-fusion-wired")) {
        b.setAttribute("data-fusion-wired", "1");
        b.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          showUploadHub();
        }, true); // capture: beat the classic app's own handler
      }
      // cloud builds, signed in: a Sign out item at the bottom of the nav —
      // same anatomy as the other items, visible on every classic screen.
      // The session check resolves ONCE into a cached answer; injection then
      // happens on whichever observer pass comes next, with a fresh anchor
      // (React rebuilds the sidebar constantly — never trust a stale node).
      if (t === "Admin Settings" && !document.getElementById("fusion-nav-signout") &&
          b.parentNode && window.OpsMatrixFusion &&
          typeof window.OpsMatrixFusion.hasCloudSession === "function" &&
          window.OpsMatrixFusion.cloudConfigured) {
        if (window.__fusionHasSession === undefined) {
          window.__fusionHasSession = null; // resolving…
          window.OpsMatrixFusion.hasCloudSession()
            .then(function (yes) {
              window.__fusionHasSession = yes;
              // the app may be idle (no DOM mutations → no observer passes) —
              // force one pass now so the button appears immediately
              if (yes) ensureButton();
            })
            .catch(function () { window.__fusionHasSession = false; });
        }
        if (window.__fusionHasSession === true) {
          var so = document.createElement("button");
          so.id = "fusion-nav-signout";
          so.type = "button";
          so.className = b.className;
          so.innerHTML =
            '<span class="nav-icon">' +
            '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" ' +
            'stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">' +
            '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>' +
            "</svg></span>" +
            '<span class="nav-label">Sign out</span>';
          so.addEventListener("click", function () {
            if (!confirm("Sign out? Synced data is removed from this device (it stays safe in your organization's account).")) return;
            window.OpsMatrixFusion.cloudSignOut();
          });
          b.parentNode.insertBefore(so, b.nextSibling);
        }
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
        // …and Exporting (§12g): any slice of the inventory out as Excel —
        // a readable report, or a file ⬆ Import takes back losslessly
        if (!document.getElementById("fusion-admin-export") && b.parentNode) {
          var exBtn = document.createElement("button");
          exBtn.id = "fusion-admin-export";
          exBtn.type = "button";
          exBtn.className = b.className;
          exBtn.textContent = "exporting";
          exBtn.addEventListener("click", function () { window.location.href = "./maps.html#exporting"; });
          b.parentNode.insertBefore(exBtn, b.nextSibling);
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
        mapBtn.addEventListener("click", function () { window.location.href = "./maps.html#spaces?view=map"; });
        anchor.parentNode.insertBefore(mapBtn, anchor.nextSibling);
      }
      // NOTE (2026-08-28): the ⬆ Upload strip button is gone — Josh's call.
      // The two entry points are ⬆ Import and ＋ Add Room, kept side by side.
      // The archive's Floor Plans screen has neither, so it gets an Add Room
      // that opens the hub's editor.
      var hasArchiveAdd = false;
      for (var k2 = 0; k2 < navBtns.length; k2++) {
        if ((navBtns[k2].textContent || "").trim() === "Add Room") { hasArchiveAdd = true; break; }
      }
      var fAdd = document.getElementById("fusion-space-addroom");
      if (!hasArchiveAdd && !fAdd && anchor.parentNode) {
        // ⬆ Import and ＋ Add Room travel as a pair, here like everywhere
        var fImp = document.createElement("button");
        fImp.id = "fusion-space-import";
        fImp.type = "button";
        fImp.className = anchor.className;
        fImp.textContent = "⬆ Import";
        fImp.addEventListener("click", showUploadHub);
        anchor.parentNode.appendChild(fImp);
        fAdd = document.createElement("button");
        fAdd.id = "fusion-space-addroom";
        fAdd.type = "button";
        fAdd.className = anchor.className;
        fAdd.textContent = "＋ Add Room";
        fAdd.addEventListener("click", function () { window.location.href = "./maps.html#spaces?view=list&add=1"; });
        anchor.parentNode.appendChild(fAdd);
      } else if (hasArchiveAdd && fAdd && fAdd.parentNode) {
        fAdd.parentNode.removeChild(fAdd);
        var fImp2 = document.getElementById("fusion-space-import");
        if (fImp2 && fImp2.parentNode) fImp2.parentNode.removeChild(fImp2);
      }
      // undo the old hiding for anyone whose browser cached that build
      if (anchor.style.display === "none") anchor.style.display = "";
      openFloorPlansIfRequested(anchor);
    }
  }

  // NOTE (2026-08-28 night): the archive's Add Floor Plan tracer is fully
  // retired for NEW plans — the hub's Plan Studio owns tracing, snapping and
  // calibration now. Floor Plans in classic remains the viewer of saved plans.

  // ── the ONE back button + the shared navigation trail ─────────────────────
  // classic.html and maps.html keep one back-stack in sessionStorage
  // (om_nav_stack — see src/pro/nav.ts for the hub's twin). Tokens:
  //   "classic:<sidebar label>"  a page inside classic
  //   "hub:<view>"               a maps.html view
  var NAV_KEY = "om_nav_stack";
  function navStack() {
    try {
      var a = JSON.parse(sessionStorage.getItem(NAV_KEY) || "[]");
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  function navSave(s) { try { sessionStorage.setItem(NAV_KEY, JSON.stringify(s.slice(-60))); } catch (e) { /* full */ } }
  function navVisit(tok) {
    if (!tok) return;
    var s = navStack();
    if (s[s.length - 1] === tok) return;
    s.push(tok);
    navSave(s);
  }
  function navBackTarget() {
    var s = navStack();
    s.pop();               // the page we are on
    var t = s.pop() || null; // where back goes (it re-registers on arrival)
    navSave(s);
    return t;
  }
  function hubHash(tok) {
    var v = tok.replace(/^hub:/, "");
    if (v === "map") return "";
    if (v === "schedules" || v === "rooms") return "#tab-" + v;
    if (v.indexOf("spaces") === 0) return "#spaces?view=" + (v.split("/")[1] || "explorer");
    return "#" + v;
  }
  function clickNav(label) {
    var btns = document.querySelectorAll(".sidebar button, #fusion-bottomnav button");
    for (var i = 0; i < btns.length; i++) {
      if ((btns[i].textContent || "").trim() === label) { btns[i].click(); return true; }
    }
    return false;
  }
  function fusionGoBack() {
    var t = navBackTarget();
    if (!t) return;
    if (t.indexOf("hub:") === 0) { window.location.href = "./maps.html" + hubHash(t); return; }
    var label = t.split(":")[1] || "Dashboard";
    if (!clickNav(label)) navVisit(t); // page vanished? put it back, do nothing
  }
  function ensureBackButton() {
    var host = document.querySelector(".sidebar > div");
    var show = navStack().length >= 2;
    var btn = document.getElementById("fusion-back");
    if (!btn) {
      if (!host) return;
      btn = document.createElement("button");
      btn.id = "fusion-back";
      btn.type = "button";
      btn.textContent = "‹ Back";
      btn.setAttribute("style",
        "margin-top:8px;display:block;padding:6px 16px;border:none;border-radius:999px;" +
        "background:#0d9488;color:#fff;font:600 12.5px 'Segoe UI',sans-serif;cursor:pointer;");
      btn.addEventListener("click", fusionGoBack);
      host.appendChild(btn);
    }
    btn.style.display = show ? "" : "none";
  }

  // fresh-session goto: the hub's back button (or a rewire) names the classic
  // page to land on after the reload
  var gotoTries = 0;
  function ensureGotoPage() {
    var label = sessionStorage.getItem("fusion-goto-page");
    if (!label) return;
    if (gotoTries++ > 30) { sessionStorage.removeItem("fusion-goto-page"); return; }
    if (clickNav(label)) sessionStorage.removeItem("fusion-goto-page");
  }

  // ── archive page fixes that must stay DOM-side (the archive is read-only) ──
  function fixArchivePages() {
    var btns = document.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      var t = (btns[i].textContent || "").trim();
      // Dashboard: "Manage Training" led to Admin Settings — confusing, gone
      if (t === "Manage Training" && btns[i].style.display !== "none") {
        btns[i].style.display = "none";
      }
      // Max Calendar project tiles: the "Schedules" button duplicated what
      // already happens automatically, and projects carry NO priority level
      if (t === "Schedules" && btns[i].parentElement) {
        var col = btns[i].parentElement;
        var sibs = col.querySelectorAll("button");
        var hasNote = false;
        for (var j = 0; j < sibs.length; j++) {
          if ((sibs[j].textContent || "").trim() === "Note") hasNote = true;
        }
        if (hasNote && sibs.length === 2) {
          if (btns[i].style.display !== "none") btns[i].style.display = "none";
          hideProjectPriorityBadge(col);
        }
      }
    }
  }
  function hideProjectPriorityBadge(actionsCol) {
    var card = actionsCol;
    for (var up = 0; up < 4 && card; up++) {
      card = card.parentElement;
      if (card && card.textContent && card.textContent.indexOf("Assigned schedule") >= 0) break;
    }
    if (!card || !card.querySelectorAll) return;
    var words = { medium: 1, normal: 1, high: 1, low: 1, critical: 1 };
    var spans = card.querySelectorAll("span,div");
    for (var i = 0; i < spans.length; i++) {
      var tx = (spans[i].textContent || "").trim().toLowerCase();
      if (words[tx] && spans[i].children.length === 0 && spans[i].style.display !== "none") {
        spans[i].style.display = "none";
      }
    }
  }

  // ── Max reply quality: full answers, real dates, prompt caching ───────────
  // The archive clamped every reply to 90 characters + "…" (maxCleanReply)
  // and 320/420 output tokens — that's the truncation Josh saw. It also never
  // told the model today's date, so "tomorrow night" earned a lecture about
  // YYYY-MM-DD. Both fixed here; the archive stays untouched.
  function wireMaxQuality() {
    if (window.__fusionMaxQuality) return;
    if (typeof window.maxFetchMessage !== "function" || typeof window.maxCleanReply !== "function") return;
    window.__fusionMaxQuality = true;

    window.maxCleanReply = function (text, fallback) {
      var s = String(text || "").replace(/```[\s\S]*?```/g, "").trim();
      return s || fallback || "Done.";
    };

    var origFetchMsg = window.maxFetchMessage;
    window.maxFetchMessage = function (key, settings, body) {
      var b = Object.assign({}, body || {});
      // room to finish a sentence — the callers asked for 320/420
      b.max_tokens = Math.max(Number(b.max_tokens) || 0, 1000);
      var now = new Date();
      var pad = function (n) { return (n < 10 ? "0" : "") + n; };
      var iso = function (d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
      var tomorrow = new Date(now.getTime() + 86400000);
      var extra = "\n\nCURRENT DATE & TIME: " +
        now.toLocaleString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }) +
        ". Today is " + iso(now) + "; tomorrow is " + iso(tomorrow) +
        ". Resolve relative dates (today, tonight, tomorrow, next Tuesday) yourself — never ask the user to spell a date out." +
        "\nYour whole reply is shown to the user. Keep answers short but COMPLETE — full sentences, never cut off.";
      if (typeof b.system === "string") {
        // block form + cache_control: the big fixed prompt (system + tools)
        // is cached between the tool-loop's round trips — most of the 45s
        // Josh measured was re-reading it on every hop
        b.system = [{ type: "text", text: b.system + extra, cache_control: { type: "ephemeral" } }];
      }
      if (Array.isArray(b.tools) && b.tools.length) {
        b.tools = b.tools.slice();
        var lastT = Object.assign({}, b.tools[b.tools.length - 1]);
        lastT.cache_control = { type: "ephemeral" };
        b.tools[b.tools.length - 1] = lastT;
      }
      return origFetchMsg(key, settings, b);
    };
  }

  // ── ⬆ Upload: route by what the user has, not by which screen owns it ──────
  var HUB_ID = "fusion-upload-hub";

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
      "<div id='fusion-hub-excel'>" + tile("📊 Room list — Excel, CSV or raw data",
        "A spreadsheet or export of rooms and details, imported straight into Max Space.") + "</div>" +
      "<div id='fusion-hub-magic'>" + tile("⚡ magicplan export — DXF + CSV",
        "A laser-measured scan. Rooms are detected and drawn exactly.") + "</div>" +
      "<div style='text-align:right'><button id='fusion-hub-cancel' type='button' " +
      "style='padding:7px 14px;border:none;background:none;font-size:12.5px;color:#8fa3b0;cursor:pointer'>Cancel</button></div>";
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    function close() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }
    wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
    document.getElementById("fusion-hub-cancel").addEventListener("click", close);
    document.getElementById("fusion-hub-plan").addEventListener("click", function () { close(); openPlanUpload(); });
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
  // clicking forever if a future Classic build stops showing Floor Plans.
  // Two ways in: ?fp=1 (deep link) or the one-shot fusion-goto-space flag
  // (set by e.g. the room-list import's "Open the rooms" button so a reload
  // lands ON the rooms, not the dashboard).
  var spaceTries = 0;
  function ensureSpaceScreen() {
    // the ONE road into the ARCHIVE's Max Space (the Floor Plans viewer):
    // the ?fp=1 deep link. Everything else lives in the hub.
    var wantSpace = /[?&]fp=1/.test(window.location.search);
    if (!wantSpace || deepLinked) return;
    if (spaceTries++ > 20) { deepLinked = true; return; }
    var btns = document.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      if ((btns[i].textContent || "").trim() === "Max Space") {
        navVisit("classic:Max Space");
        btns[i].click();
        return;
      }
    }
  }

  // ── PDF floor plans ────────────────────────────────────────────────────────
  // pdf.js is vendored to our origin (scripts/copy-pdfjs.cjs) because this
  // page's localStorage holds the user's API key — no third-party scripts.
  // Loaded lazily: nobody downloads 1.7MB of pdf.js unless they pick a PDF.

  var PDFJS_URL = "./pdfjs/pdf.min.mjs";
  var PDF_WORKER_URL = "./pdfjs/pdf.worker.min.mjs";
  var pdfLibPromise = null;

  function loadPdfLib() {
    if (!pdfLibPromise) {
      pdfLibPromise = import(PDFJS_URL).then(function (lib) {
        lib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
        return lib;
      });
    }
    return pdfLibPromise;
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

  // ── the Anthropic API key: entered once, kept forever on this device ───────
  // Two slots: opsmatrix_v7.settings.maxApiKey (what the classic app reads)
  // + a dedicated backup the classic app never rewrites. Classic's save
  // effect used to clobber a key saved from here; the backup + the pre-app
  // heal in fusion-seed.js make the key survive saves and demo reseeds.
  var KEY_BACKUP = "opsmatrix_max_api_key";
  function getApiKey() {
    try {
      var v7 = JSON.parse(localStorage.getItem("opsmatrix_v7") || "{}") || {};
      return String((v7.settings || {}).maxApiKey || "") ||
        String(localStorage.getItem(KEY_BACKUP) || "");
    } catch (e) { return ""; }
  }
  function setApiKey(key) {
    try {
      localStorage.setItem(KEY_BACKUP, String(key || "").trim());
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

  // ── 🗺 floor plan upload: Max reads it, always — there is no manual path ───
  // (Josh's rule, 2026-08-24: floor plans come in through the API, period.
  // The old flow — Classic's Building/Floor form, then a "read it with Max
  // or upload as a picture?" choice — is gone.)
  var SMART_ID = "fusion-smart";

  function openPlanUpload() {
    if (document.getElementById(SMART_ID)) return;
    var wrap = document.createElement("div");
    wrap.id = SMART_ID;
    wrap.setAttribute("style",
      "position:fixed;inset:0;z-index:99999;background:rgba(15,23,32,.55);" +
      "display:flex;align-items:center;justify-content:center;padding:20px;");
    var card = document.createElement("div");
    card.setAttribute("style",
      "background:#fff;border-radius:14px;max-width:520px;width:100%;padding:24px;" +
      "font-family:'Segoe UI',sans-serif;color:#1c2b33;box-shadow:0 18px 60px rgba(0,0,0,.35);");
    // STEP 1 is an explicit question (Josh, 2026-08-28: the calibration path
    // must be a real choice, not a footnote): does the plan state its sizes?
    var choiceTile = function (id, title, sub) {
      return "<button id='" + id + "' type='button' style='display:block;width:100%;text-align:left;margin-bottom:10px;" +
        "padding:14px 16px;border:1px solid #d8e0e6;border-radius:10px;background:#fff;cursor:pointer'>" +
        "<b style='font-size:14.5px;color:#1c2b33'>" + title + "</b>" +
        "<span style='display:block;font-size:12.5px;color:#5b7083;margin-top:3px'>" + sub + "</span></button>";
    };
    card.innerHTML =
      "<h3 style='margin:0 0 6px;font-size:17px'>🗺 Upload a floor plan</h3>" +
      "<div id='fusion-smart-choice'>" +
      "<p style='margin:0 0 14px;font-size:13px;color:#5b7083'>One question first: does the plan have readable " +
      "measurements — room sizes or square footage printed on it?</p>" +
      choiceTile("fusion-choice-read", "✨ Yes — the sizes are printed on the plan",
        "Max reads the rooms, numbers and square footage, and the plan arrives already to scale. Nothing to measure.") +
      choiceTile("fusion-choice-cal", "📐 No — it's just the floor plan, no sizes",
        "The Plan Studio opens on your file: trace a room you KNOW (the snap pulls it onto the walls), type its square footage — that's the calibration — then Max draws the rest, measured from YOUR numbers.") +
      "</div>" +
      "<div id='fusion-smart-form' style='display:none'>" +
      "<p style='margin:0 0 14px;font-size:13px;color:#5b7083'>Pick the picture or PDF. Max reads the rooms, " +
      "their numbers and the printed square footage, then OpsMatrix redraws the plan in its own clean style.</p>" +
      "<div style='display:flex;gap:8px;margin-bottom:10px'>" +
      "<label style='flex:1;font-size:11px;letter-spacing:.05em;color:#8fa3b0;text-transform:uppercase'>Building" +
      "<input id='fusion-plan-building' type='text' placeholder='read from the plan if left blank' " +
      "style='display:block;width:100%;margin-top:4px;padding:9px 10px;border:1px solid #d8e0e6;border-radius:7px;font-size:13px'/></label>" +
      "<label style='flex:1;font-size:11px;letter-spacing:.05em;color:#8fa3b0;text-transform:uppercase'>Floor" +
      "<input id='fusion-plan-floor' type='text' placeholder='e.g. 4 East' " +
      "style='display:block;width:100%;margin-top:4px;padding:9px 10px;border:1px solid #d8e0e6;border-radius:7px;font-size:13px'/></label>" +
      "</div>" +
      "<div id='fusion-keyrow'></div>" +
      "<button id='fusion-smart-go' type='button' style='width:100%;padding:11px;border:none;background:#0f6b62;color:#fff;" +
      "border-radius:8px;font-size:14px;font-weight:600;cursor:pointer'>Choose floor plan (image or PDF)</button>" +
      "<input id='fusion-plan-file' type='file' accept='image/*,application/pdf,.pdf' style='display:none'/>" +
      "<div id='fusion-smart-status' style='min-height:18px;font-size:12.5px;color:#0f6b62;margin-top:10px'></div>" +
      "</div>" +
      "<div style='text-align:right;margin-top:4px'>" +
      "<button id='fusion-smart-cancel' type='button' style='padding:7px 14px;border:none;background:none;" +
      "font-size:12.5px;color:#8fa3b0;cursor:pointer'>Cancel</button></div>";
    wrap.appendChild(card);
    document.body.appendChild(wrap);

    document.getElementById("fusion-choice-read").addEventListener("click", function () {
      document.getElementById("fusion-smart-choice").style.display = "none";
      document.getElementById("fusion-smart-form").style.display = "";
    });
    document.getElementById("fusion-choice-cal").addEventListener("click", function () {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      // the Plan Studio (hub) owns the whole calibrate experience now
      window.location.href = "./maps.html#spaces?view=map&plancal=1";
    });

    renderKeyRow(getApiKey());

    // cloud accounts: AI reading is included — the server holds the key
    var proxy = null;
    if (window.OpsMatrixFusion && typeof window.OpsMatrixFusion.aiProxy === "function") {
      window.OpsMatrixFusion.aiProxy().then(function (p) {
        if (!p) return;
        proxy = p;
        var row = document.getElementById("fusion-keyrow");
        if (row) {
          row.innerHTML = "<p style='margin:0 0 10px;font-size:12.5px;color:#0f6b62'>" +
            "✓ AI reading is included with your OpsMatrix account.</p>";
        }
      }).catch(function () { /* direct mode still works */ });
    }

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

    function close() { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }
    wrap.addEventListener("click", function (ev) { if (ev.target === wrap) close(); });
    document.getElementById("fusion-smart-cancel").addEventListener("click", close);

    var fileInput = document.getElementById("fusion-plan-file");
    document.getElementById("fusion-smart-go").addEventListener("click", function () {
      if (!getApiKey() && !proxy) { setSmartStatus("Save the API key above first — one time only.", true); return; }
      fileInput.click();
    });
    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      fileInput.value = "";
      if (!file) return;
      var building = (document.getElementById("fusion-plan-building").value || "").trim();
      var floor = (document.getElementById("fusion-plan-floor").value || "").trim();
      // resolve the proxy FRESH at the moment of use — never trust a stale
      // capture (the staging smoke test caught exactly that race)
      var goWithProxy = function (p) { runSmartImport(file, building, floor, getApiKey(), close, p || proxy); };
      if (window.OpsMatrixFusion && typeof window.OpsMatrixFusion.aiProxy === "function") {
        window.OpsMatrixFusion.aiProxy().then(goWithProxy, function () { goWithProxy(null); });
      } else {
        goWithProxy(null);
      }
    });
  }

  function setSmartStatus(msg, isErr) {
    var el = document.getElementById("fusion-smart-status");
    if (el) { el.textContent = msg; el.style.color = isErr ? "#c34444" : "#0f6b62"; }
  }

  function runSmartImport(file, building, floor, key, closeOverlay, proxy) {
    var go = document.getElementById("fusion-smart-go");
    if (go) { go.disabled = true; go.textContent = "Working…"; }
    setSmartStatus("Opening " + file.name + "…");
    fileToPlanImage(file).then(function (picture) {
      return window.OpsMatrixFusion.importPlanFromImage({
        apiKey: key,
        proxy: proxy || null,
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
      if (go) { go.disabled = false; go.textContent = "Choose floor plan (image or PDF)"; }
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
      "<p style='margin:12px 0 0;font-size:12px;color:#8fa3b0'>Workload analysis for these rooms lives in " +
      "Admin Settings → workload intelligence.</p>" +
      "<div style='display:flex;gap:10px;justify-content:flex-end;margin-top:14px'>" +
      "<button id='fusion-rl-ok' type='button' style='padding:9px 16px;border:none;background:#0d9488;color:#fff;" +
      "border-radius:8px;font-size:13px;font-weight:600;cursor:pointer'>Open the rooms</button></div>";
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    // land ON the rooms — the hub's Room List is where they live now
    document.getElementById("fusion-rl-ok").addEventListener("click", function () {
      window.location.href = "./maps.html#spaces?view=list";
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

  // ── Hey Max × the fusion layer ─────────────────────────────────────────────
  // Everything the fusion layer added (recurring services, the Scope rules
  // engine, cleanability, per-room task lists) becomes editable by voice or
  // chat through Max. The archive keeps MAX_TOOLS and makeExecuteTool as
  // page globals, so we EXTEND them here — the archive itself is untouched.
  // Three of the archive's own space tools are overridden so a Max edit
  // writes fusion floor labels and prices rooms with the Scope engine
  // instead of the retired V5 estimator.
  function wireMaxFusionTools() {
    if (window.__fusionMaxWired) return;
    if (typeof MAX_TOOLS === "undefined" || typeof makeExecuteTool !== "function") return;
    if (!window.OpsMatrixFusion || !window.OpsMatrixFusion.retuneAllSpaces) return;
    window.__fusionMaxWired = true;
    var F = window.OpsMatrixFusion;
    var NONSPACE_KEY = "opsmatrix_fusion_nonspace";
    var CLEANABILITIES = ["Cleanable", "Non-cleanable", "Needs review"];

    function readServices() {
      try { return JSON.parse(localStorage.getItem(NONSPACE_KEY) || "[]") || []; } catch (e) { return []; }
    }
    function writeServices(list) { localStorage.setItem(NONSPACE_KEY, JSON.stringify(list)); }
    function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }
    function uid2(p) { return p + "-" + Math.random().toString(36).slice(2, 9); }
    function norm(s) { return String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, ""); }

    function findSchedule(cx, ref) {
      var q = String(ref || "").trim().toLowerCase();
      if (!q) return null;
      return (cx.schedules || []).find(function (s) { return String(s.num || "").toLowerCase() === q; }) ||
        (cx.schedules || []).find(function (s) { return String(s.name || "").toLowerCase().indexOf(q) >= 0; }) || null;
    }
    function scheduleList(cx) {
      return (cx.schedules || []).map(function (s) {
        return s.num + " — " + (s.name || "") + " (" + (s.shift || "") + ")";
      }).join("; ") || "none yet";
    }
    /**
     * Room lookup a person would recognize: exact number first, then
     * suffix match ("1230" finds "C-1230"), narrowed by building/campus
     * when given ("room 1230 in Crawfordsville" resolves itself).
     */
    function findRoom(cx, roomNumber, buildingHint) {
      var rn = String(roomNumber || "").trim().toLowerCase();
      if (!rn) return null;
      var all = cx.spaces || [];
      var strip = function (s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); };
      var pick = all.filter(function (s) {
        return String(s.roomNumber || "").trim().toLowerCase() === rn;
      });
      if (!pick.length) {
        var rs = strip(rn);
        if (rs) {
          pick = all.filter(function (s) {
            var v = strip(s.roomNumber);
            return v && (v === rs || (v.length > rs.length && v.slice(-rs.length) === rs));
          });
        }
      }
      if (pick.length > 1 && buildingHint) {
        var bh = String(buildingHint).trim().toLowerCase();
        var byB = pick.filter(function (s) {
          return String(s.building || "").toLowerCase().indexOf(bh) >= 0 ||
            String(s.campus || "").toLowerCase().indexOf(bh) >= 0;
        });
        if (byB.length) pick = byB;
      }
      return pick[0] || null;
    }
    /** any floor wording → the fusion trio; "" when it can't be told */
    function fusionFloor(value) {
      var v = String(value || "").trim();
      if (!v) return "";
      var trio = F.FLOOR_TYPES || [];
      for (var i = 0; i < trio.length; i++) if (norm(trio[i]) === norm(v)) return trio[i];
      var byArchive = F.fusionFloorLabel(v);
      if (byArchive !== v) return byArchive;
      return F.normalizeFloorFinish(F.loadAliases(), v);
    }
    function typeLabelFor(rules, input) {
      var id = F.typeIdFromLabelStrict(rules, input);
      if (!id) return null;
      var rt = rules.roomTypes.find(function (x) { return x.id === id; });
      return rt ? { id: id, label: rt.label } : null;
    }
    function taskIdsFor(rules, labels) {
      var out = [], unknown = [];
      (labels || []).forEach(function (l) {
        var t = rules.tasks.find(function (x) { return norm(x.label) === norm(l) || norm(x.id) === norm(l); });
        if (t) { if (out.indexOf(t.id) < 0) out.push(t.id); } else unknown.push(l);
      });
      return { ids: out, unknown: unknown };
    }
    /** finish a space write: engine minutes + fusion floor label, via React */
    function commitSpace(cx, space, rules) {
      space.floorType = fusionFloor(space.floorType) || String(space.floorType || "");
      space.estimatedCleaningMinutes = Math.round(F.computeMinutes(rules, space).total);
      space.updatedAt = new Date().toISOString();
      cx.updateSpace(space);
    }
    /** after a Scope change: re-test, re-task and reprice every room */
    function retune(cx, nextRules, prevRules) {
      var copies = (cx.spaces || []).map(function (s) { return Object.assign({}, s); });
      var changed = F.retuneAllSpaces(copies, nextRules, prevRules);
      changed.forEach(function (s) { cx.updateSpace(s); });
      return changed.length;
    }

    var FUSION_TOOL_DEFS = [
      {
        name: "get_cleaning_rules",
        description: "Read the Scope rulebook that prices every room: general cleaning rates, staffing assumptions, every room type (frequency, extra minutes, cleanability, automatic tasks), every task rate, and the recurring services (discharges, routes, porters, pickups) attached to schedules. Call this before changing rules if unsure of exact names.",
        input_schema: { type: "object", properties: {} }
      },
      {
        name: "update_cleaning_rules",
        description: "Change the account-wide cleaning rates or staffing assumptions. Every room, schedule and the Workload Intelligence FTE recalculate instantly.",
        input_schema: {
          type: "object",
          properties: {
            hard_floor_sqft_per_minute: { type: "number", description: "general clean covers this many sq ft of hard floor per minute (default 33)" },
            carpet_sqft_per_minute: { type: "number", description: "sq ft of carpet per minute (default 40)" },
            minimum_minutes_per_room: { type: "number" },
            productive_minutes_per_shift: { type: "number", description: "productive cleaning minutes in one shift (default 420)" },
            shifts_per_week_per_fte: { type: "number", description: "shifts one full-time employee works weekly (default 5)" }
          }
        }
      },
      {
        name: "set_room_type_rule",
        description: "Create a room type or change how one is priced: cleaning frequency, extra minutes per clean, whether it counts toward EVS workload, and which tasks it gets automatically. Existing rooms of that type update immediately.",
        input_schema: {
          type: "object",
          required: ["room_type"],
          properties: {
            room_type: { type: "string", description: "e.g. Patient Room, Telemetry Room" },
            frequency: { type: "string", description: "one of: 7x / week, 6x / week, 5x / week, 3x / week, 2x / week, 1x / week, Every other week, Monthly" },
            extra_minutes: { type: "number", description: "flat minutes added on top of the general clean" },
            counts_toward_evs_workload: { type: "boolean", description: "false for infrastructure like mechanical rooms" },
            automatic_tasks: { type: "array", items: { type: "string" }, description: "task names this type gets automatically, e.g. [\"Auto Scrub\",\"Dust Mop\"]" }
          }
        }
      },
      {
        name: "set_task_rule",
        description: "Create a cleaning task or change its rate (sq ft per minute, or flat minutes) and which room types get it automatically.",
        input_schema: {
          type: "object",
          required: ["task"],
          properties: {
            task: { type: "string", description: "e.g. Trash Pull, Burnishing" },
            sqft_per_minute: { type: "number", description: "1 minute covers this many sq ft (omit for flat-time tasks)" },
            flat_minutes: { type: "number", description: "flat minutes per room (for tasks not based on size)" },
            automatic_for_room_types: { type: "array", items: { type: "string" } }
          }
        }
      },
      {
        name: "add_recurring_service",
        description: "Attach a recurring non-room service to a schedule — a trash pickup run, discharge cleaning, a sanitation route, a day porter. The hours count toward that schedule's workload. Use create_schedule first if no suitable schedule exists on the wanted shift.",
        input_schema: {
          type: "object",
          required: ["service", "schedule_number"],
          properties: {
            service: { type: "string", description: "e.g. Trash Pickup, Discharges, Day Porter" },
            schedule_number: { type: "string", description: "the schedule's number, e.g. 102 (or its name)" },
            hours: { type: "number", description: "hours per day this service takes (default 2)" }
          }
        }
      },
      {
        name: "update_recurring_service",
        description: "Change a recurring service's hours or move it to another schedule.",
        input_schema: {
          type: "object",
          required: ["service"],
          properties: {
            service: { type: "string" },
            schedule_number: { type: "string", description: "which schedule it is on now (needed only if the same service exists on several)" },
            hours: { type: "number" },
            move_to_schedule_number: { type: "string" }
          }
        }
      },
      {
        name: "remove_recurring_service",
        description: "Remove a recurring service from a schedule.",
        input_schema: {
          type: "object",
          required: ["service"],
          properties: {
            service: { type: "string" },
            schedule_number: { type: "string" }
          }
        }
      },
      {
        name: "set_room_cleanability",
        description: "Mark one room Cleanable, Non-cleanable (real space excluded from EVS workload, like a mechanical room), or Needs review.",
        input_schema: {
          type: "object",
          required: ["room_number", "cleanability"],
          properties: {
            room_number: { type: "string" },
            cleanability: { type: "string", enum: CLEANABILITIES }
          }
        }
      },
      {
        name: "set_room_tasks",
        description: "Set the exact task list one room requires (beyond its implicit general clean), e.g. [\"Trash Pull\",\"High Dusting\"]. Overrides the room type's automatic list for this room only.",
        input_schema: {
          type: "object",
          required: ["room_number", "tasks"],
          properties: {
            room_number: { type: "string" },
            tasks: { type: "array", items: { type: "string" } }
          }
        }
      },
      // ── the universal fallback: EVERYTHING is readable and editable, even
      //    fields added to the app after these tools were written ──
      {
        name: "add_floor_care_project",
        description: "Schedule a floor-care PROJECT on the Max Floor Care calendar: strip & refinish, scrub & recoat, carpet extraction… It records man-hours (hours × team members) and flows into Max Notes, the calendar and manager reminders automatically.",
        input_schema: {
          type: "object",
          required: ["task", "date", "hours", "team_members"],
          properties: {
            task: { type: "string", enum: ["Carpet Extraction", "Scrub", "Scrub & Recoat", "Strip & Refinish", "Miscellaneous"] },
            date: { type: "string", description: "YYYY-MM-DD" },
            hours: { type: "number", description: "estimated duration, 1–8" },
            team_members: { type: "number", description: "how many people, 1–8" },
            room_number: { type: "string", description: "the room it happens in (any room)" },
            building: { type: "string", description: "building or campus the room is in — include it when the user names one" },
            note: { type: "string" }
          }
        }
      },
      {
        name: "read_data",
        description: "Universal reader: see the REAL records and field names in any area of the app — rooms (every field they carry, including new ones), schedules, employees, the cleaning rulebook, recurring services, floor plans, floor-care schedules and projects, and the floor-machine equipment catalog. Use it when no purpose-built tool covers what the user is asking about, then edit with edit_records.",
        input_schema: {
          type: "object",
          required: ["area"],
          properties: {
            area: { type: "string", enum: ["rooms", "schedules", "employees", "cleaning_rules", "recurring_services", "floor_plans", "floor_care_schedules", "floor_care_projects", "equipment_catalog"] },
            query: { type: "string", description: "filter text matched against the records (room number, name, department, building...)" },
            limit: { type: "number", description: "max records to return (default 25)" },
            offset: { type: "number" }
          }
        }
      },
      {
        name: "edit_records",
        description: "Universal editor: set ANY field on rooms, schedules, employees or recurring services — including fields no purpose-built tool mentions. Match records by exact number/name or by query text. Guardrails apply automatically: floor types resolve to the three real ones, room types must exist in Scope, and every touched room is repriced by the cleaning-rules engine. Prefer the purpose-built tools when one fits; this is the safety net so nothing in the app is ever out of reach.",
        input_schema: {
          type: "object",
          required: ["area", "match", "set"],
          properties: {
            area: { type: "string", enum: ["rooms", "schedules", "employees", "recurring_services"] },
            match: {
              type: "object",
              properties: {
                room_number: { type: "string" },
                schedule_number: { type: "string" },
                employee_name: { type: "string" },
                service: { type: "string" },
                query: { type: "string", description: "match by text across the record's fields instead of an exact id" }
              }
            },
            set: { type: "object", description: "field → new value. Use the exact field names read_data shows." },
            allow_many: { type: "boolean", description: "required when the match hits more than 50 records" }
          }
        }
      }
    ];

    FUSION_TOOL_DEFS.forEach(function (t) {
      if (!MAX_TOOLS.some(function (x) { return x.name === t.name; })) MAX_TOOLS.push(t);
    });
    if (typeof MAX_PLATFORM_GUIDE === "string" && MAX_PLATFORM_GUIDE.indexOf("FUSION LAYER") < 0) {
      window.MAX_PLATFORM_GUIDE = MAX_PLATFORM_GUIDE +
        "\n\nFUSION LAYER (newer capabilities — prefer these):\n" +
        "- Floor types are exactly: Carpet, \"Hard floor — finished\" (vinyl, tile, LVT, terrazzo), \"Hard floor — unfinished\" (bare concrete). Words like vinyl or tile mean Hard floor — finished.\n" +
        "- Recurring work that is not one room (trash pickup runs, discharges, sanitation routes, day porters) is a recurring SERVICE on a schedule: use add_recurring_service. \"A second trash pickup on second shift\" = add_recurring_service onto a 2nd Shift schedule (create_schedule first if none exists on that shift).\n" +
        "- Cleaning frequencies read like \"7x / week\", \"5x / week\", \"Every other week\", \"Monthly\".\n" +
        "- The Scope rulebook (rates, room types, tasks, staffing) is edited with get_cleaning_rules / update_cleaning_rules / set_room_type_rule / set_task_rule; every change reprices all rooms and the Workload Intelligence FTE instantly.\n" +
        "- Room cleanability (whether a room counts toward EVS workload) is set with set_room_cleanability.\n" +
        "- MAX FLOOR CARE owns floor-tech work (machine scrubbing, dust mopping, burnishing, machine sweeping, machine carpet cleaning): daily floor-care schedules are built there (with machine choices priced by manufacturer rates) and ship into Max Schedules; edit them in Max Floor Care, not in Max Schedules. Floor-care PROJECTS (strip & refinish, extractions) go on its calendar via add_floor_care_project; read floor_care_schedules / floor_care_projects / equipment_catalog with read_data.\n" +
        "- NOTHING IS OUT OF REACH: if no purpose-built tool covers a request, call read_data to see the real records and field names (rooms carry every field, including newly added ones), then edit_records to change any field — its guardrails resolve floor types to the only three (Carpet, Hard floor — finished, Hard floor — unfinished), require room types that exist in Scope, and reprice every touched room. Prefer purpose-built tools when one fits.";
    }

    var FUSION_IMPL = {
      get_cleaning_rules: function (inp, cx) {
        var r = F.loadRules();
        var services = readServices().map(function (t) {
          var sched = (cx.schedules || []).find(function (s) { return s.id === t.scheduleId; });
          return { service: t.name, hours: t.hours, schedule: sched ? sched.num + " — " + (sched.name || "") : "(unattached)" };
        });
        return {
          general: {
            hard_floor_sqft_per_minute: r.general.hardSqftPerMin,
            carpet_sqft_per_minute: r.general.carpetSqftPerMin,
            minimum_minutes_per_room: r.general.minMinutes,
            productive_minutes_per_shift: r.general.productiveMinutes,
            shifts_per_week_per_fte: r.general.shiftsPerWeekPerFte
          },
          room_types: r.roomTypes.map(function (rt) {
            return {
              room_type: rt.label, frequency: rt.frequency, extra_minutes: rt.qualifierMin,
              counts_toward_evs_workload: rt.cleanability !== "non-cleanable",
              automatic_tasks: r.tasks.filter(function (t) { return (t.autoFor || []).indexOf(rt.id) >= 0; })
                .map(function (t) { return t.label; })
            };
          }),
          tasks: r.tasks.map(function (t) {
            return { task: t.label, sqft_per_minute: t.sqftPerMin, flat_minutes: t.flatMin };
          }),
          recurring_services: services,
          schedules: scheduleList(cx)
        };
      },

      update_cleaning_rules: function (inp, cx) {
        var prev = F.loadRules();
        var next = JSON.parse(JSON.stringify(prev));
        var changed = [];
        function setNum(field, target) {
          var v = parseFloat(inp[field]);
          if (Number.isFinite(v) && v > 0) { next.general[target] = v; changed.push(field.replace(/_/g, " ") + " → " + v); }
        }
        setNum("hard_floor_sqft_per_minute", "hardSqftPerMin");
        setNum("carpet_sqft_per_minute", "carpetSqftPerMin");
        setNum("minimum_minutes_per_room", "minMinutes");
        setNum("productive_minutes_per_shift", "productiveMinutes");
        setNum("shifts_per_week_per_fte", "shiftsPerWeekPerFte");
        if (!changed.length) return { success: false, error: "No valid values given." };
        F.saveRules(next);
        var n = retune(cx, next, prev);
        return { success: true, message: "Updated " + changed.join(", ") + ". Repriced " + n + " rooms." };
      },

      set_room_type_rule: function (inp, cx) {
        var prev = F.loadRules();
        var next = JSON.parse(JSON.stringify(prev));
        var hit = typeLabelFor(next, inp.room_type);
        var rt;
        if (hit) {
          rt = next.roomTypes.find(function (x) { return x.id === hit.id; });
        } else {
          rt = { id: slug(inp.room_type) || uid2("rt"), label: String(inp.room_type).trim(), qualifierMin: 0, frequency: "7x / week" };
          next.roomTypes.push(rt);
        }
        if (inp.frequency !== undefined) rt.frequency = String(inp.frequency);
        if (inp.extra_minutes !== undefined && Number.isFinite(parseFloat(inp.extra_minutes))) rt.qualifierMin = parseFloat(inp.extra_minutes);
        if (inp.counts_toward_evs_workload === false) rt.cleanability = "non-cleanable";
        if (inp.counts_toward_evs_workload === true) delete rt.cleanability;
        if (Array.isArray(inp.automatic_tasks)) {
          var mapped = taskIdsFor(next, inp.automatic_tasks);
          if (mapped.unknown.length) {
            return { success: false, error: "Unknown task(s): " + mapped.unknown.join(", ") + ". Existing tasks: " + next.tasks.map(function (t) { return t.label; }).join(", ") + ". Create new ones with set_task_rule first." };
          }
          next.tasks.forEach(function (t) {
            t.autoFor = (t.autoFor || []).filter(function (id) { return id !== rt.id; });
            if (mapped.ids.indexOf(t.id) >= 0) t.autoFor.push(rt.id);
          });
        }
        F.saveRules(next);
        var n = retune(cx, next, prev);
        return { success: true, message: (hit ? "Updated" : "Created") + " room type " + rt.label + ". " + n + " rooms updated." };
      },

      set_task_rule: function (inp, cx) {
        var prev = F.loadRules();
        var next = JSON.parse(JSON.stringify(prev));
        var t = next.tasks.find(function (x) { return norm(x.label) === norm(inp.task) || norm(x.id) === norm(inp.task); });
        var created = false;
        if (!t) {
          t = { id: slug(inp.task) || uid2("task"), label: String(inp.task).trim(), sqftPerMin: null, flatMin: 0, autoFor: [], addable: true };
          next.tasks.push(t);
          created = true;
        }
        if (inp.sqft_per_minute !== undefined && Number.isFinite(parseFloat(inp.sqft_per_minute))) {
          t.sqftPerMin = parseFloat(inp.sqft_per_minute); t.flatMin = 0;
        }
        if (inp.flat_minutes !== undefined && Number.isFinite(parseFloat(inp.flat_minutes))) {
          t.flatMin = parseFloat(inp.flat_minutes); t.sqftPerMin = null;
        }
        if (Array.isArray(inp.automatic_for_room_types)) {
          var ids = [];
          for (var i = 0; i < inp.automatic_for_room_types.length; i++) {
            var hit = typeLabelFor(next, inp.automatic_for_room_types[i]);
            if (!hit) return { success: false, error: "Unknown room type: " + inp.automatic_for_room_types[i] };
            ids.push(hit.id);
          }
          t.autoFor = ids;
        }
        F.saveRules(next);
        var n = retune(cx, next, prev);
        return { success: true, message: (created ? "Created" : "Updated") + " task " + t.label + ". " + n + " rooms updated." };
      },

      add_recurring_service: function (inp, cx) {
        var sched = findSchedule(cx, inp.schedule_number);
        if (!sched) return { success: false, error: "No schedule matches \"" + inp.schedule_number + "\". Schedules: " + scheduleList(cx) + ". Create one with create_schedule first." };
        var name = String(inp.service || "").trim();
        if (!name) return { success: false, error: "The service needs a name." };
        var rules = F.loadRules();
        var def = rules.nonSpaceDefs.find(function (d) { return norm(d.label) === norm(name); });
        var hours = Number.isFinite(parseFloat(inp.hours)) ? parseFloat(inp.hours) : (def ? def.defaultHours : 2);
        if (!def) {
          var prev = JSON.parse(JSON.stringify(rules));
          rules.nonSpaceDefs.push({ id: slug(name) || uid2("ns"), label: name, defaultHours: hours });
          F.saveRules(rules);
          void prev;
        }
        var services = readServices();
        services.push({ id: uid2("nst"), name: def ? def.label : name, hours: hours, scheduleId: sched.id, roomIds: [] });
        writeServices(services);
        return { success: true, message: "Added " + name + " (" + hours + "h) to schedule " + sched.num + " — " + (sched.name || "") + " (" + (sched.shift || "") + "). It now counts toward that schedule's workload." };
      },

      update_recurring_service: function (inp, cx) {
        var services = readServices();
        var matches = services.filter(function (t) { return norm(t.name) === norm(inp.service); });
        if (inp.schedule_number) {
          var onSched = findSchedule(cx, inp.schedule_number);
          matches = matches.filter(function (t) { return onSched && t.scheduleId === onSched.id; });
        }
        if (!matches.length) return { success: false, error: "No service named \"" + inp.service + "\" found." };
        if (matches.length > 1) return { success: false, error: "\"" + inp.service + "\" exists on several schedules — say which schedule_number." };
        var t = matches[0];
        var msg = [];
        if (Number.isFinite(parseFloat(inp.hours))) { t.hours = parseFloat(inp.hours); msg.push("hours → " + t.hours); }
        if (inp.move_to_schedule_number) {
          var to = findSchedule(cx, inp.move_to_schedule_number);
          if (!to) return { success: false, error: "No schedule matches \"" + inp.move_to_schedule_number + "\". Schedules: " + scheduleList(cx) };
          t.scheduleId = to.id; msg.push("moved to " + to.num);
        }
        if (!msg.length) return { success: false, error: "Nothing to change — give hours or move_to_schedule_number." };
        writeServices(services);
        return { success: true, message: "Updated " + t.name + ": " + msg.join(", ") };
      },

      remove_recurring_service: function (inp, cx) {
        var services = readServices();
        var onSched = inp.schedule_number ? findSchedule(cx, inp.schedule_number) : null;
        var keep = [], removed = 0;
        services.forEach(function (t) {
          var hit = norm(t.name) === norm(inp.service) && (!onSched || t.scheduleId === onSched.id);
          if (hit) removed++; else keep.push(t);
        });
        if (!removed) return { success: false, error: "No service named \"" + inp.service + "\" found." };
        writeServices(keep);
        return { success: true, message: "Removed " + removed + " " + inp.service + " service" + (removed > 1 ? "s" : "") + "." };
      },

      set_room_cleanability: function (inp, cx) {
        var t = findRoom(cx, inp.room_number);
        if (!t) return { success: false, error: "Space " + inp.room_number + " not found" };
        if (CLEANABILITIES.indexOf(inp.cleanability) < 0) {
          return { success: false, error: "Cleanability must be one of: " + CLEANABILITIES.join(", ") };
        }
        var u = Object.assign({}, t, { cleanability: inp.cleanability });
        commitSpace(cx, u, F.loadRules());
        return { success: true, message: "Room " + t.roomNumber + " is now " + inp.cleanability + "." };
      },

      set_room_tasks: function (inp, cx) {
        var t = findRoom(cx, inp.room_number);
        if (!t) return { success: false, error: "Space " + inp.room_number + " not found" };
        var rules = F.loadRules();
        var mapped = taskIdsFor(rules, inp.tasks);
        if (mapped.unknown.length) {
          return { success: false, error: "Unknown task(s): " + mapped.unknown.join(", ") + ". Existing tasks: " + rules.tasks.map(function (x) { return x.label; }).join(", ") };
        }
        var u = Object.assign({}, t, { spaceTasks: mapped.ids });
        commitSpace(cx, u, rules);
        return { success: true, message: "Room " + t.roomNumber + " now requires: " + (inp.tasks.join(", ") || "just the general clean") + " (" + u.estimatedCleaningMinutes + " min per clean)." };
      },

      read_data: function (inp, cx) {
        var limit = Math.max(1, Math.min(100, parseInt(inp.limit) || 25));
        var offset = Math.max(0, parseInt(inp.offset) || 0);
        var q = String(inp.query || "").toLowerCase();
        var hits = function (obj) {
          if (!q) return true;
          return JSON.stringify(obj).toLowerCase().indexOf(q) >= 0;
        };
        var page = function (arr) {
          return { total: arr.length, showing: arr.slice(offset, offset + limit) };
        };
        if (inp.area === "rooms") {
          var rules = F.loadRules();
          var rows = (cx.spaces || []).filter(hits).map(function (s) {
            var out = {};
            // every primitive field the record carries — future fields included
            Object.keys(s).forEach(function (k) {
              var v = s[k];
              if (k === "visualPts" || k === "source" || k === "id") return;
              if (v === null || ["string", "number", "boolean"].indexOf(typeof v) >= 0) out[k] = v;
              if (k === "spaceTasks" && Array.isArray(v)) {
                out.spaceTasks = v.map(function (id) {
                  var t = rules.tasks.find(function (x) { return x.id === id; });
                  return t ? t.label : id;
                });
              }
            });
            out.cleanability = F.spaceCleanability(rules, s);
            if (s.source && s.source.costCenter) {
              out.costCenter = s.source.costCenter + (s.source.costCenterDescription ? " · " + s.source.costCenterDescription : "");
            }
            return out;
          });
          return page(rows);
        }
        if (inp.area === "schedules") {
          var services = readServices();
          return page((cx.schedules || []).filter(hits).map(function (s) {
            return {
              num: s.num, name: s.name, shift: s.shift, employee: s.employee,
              targetHours: s.targetHours, rooms: (s.spaceOrder || []).length,
              recurring_services: services.filter(function (t) { return t.scheduleId === s.id; })
                .map(function (t) { return t.name + " (" + t.hours + "h)"; })
            };
          }));
        }
        if (inp.area === "employees") {
          return page((cx.employees || []).filter(hits).map(function (e) {
            var out = {};
            Object.keys(e).forEach(function (k) {
              if (k === "id") return;
              var v = e[k];
              if (v === null || ["string", "number", "boolean"].indexOf(typeof v) >= 0) out[k] = v;
            });
            return out;
          }));
        }
        if (inp.area === "cleaning_rules") return FUSION_IMPL.get_cleaning_rules({}, cx);
        if (inp.area === "recurring_services") {
          return page(readServices().filter(hits).map(function (t) {
            var sched = (cx.schedules || []).find(function (s) { return s.id === t.scheduleId; });
            return { service: t.name, hours: t.hours, schedule: sched ? sched.num + " — " + (sched.name || "") : "(unattached)" };
          }));
        }
        if (inp.area === "floor_plans") {
          var plans = [];
          try { plans = JSON.parse(localStorage.getItem("opsmatrix_v7_plans") || "[]") || []; } catch (e) { plans = []; }
          return page(plans.map(function (p) {
            return { building: p.building, floor: p.floor, rooms_drawn: (p.rooms || []).length };
          }));
        }
        if (inp.area === "floor_care_schedules") {
          var fcStore = F.loadFloorCare();
          var rulesFc = F.loadRules();
          return page(fcStore.schedules.filter(hits).map(function (fc) {
            var timing = F.fcTiming(rulesFc, cx.spaces || [], fc);
            return {
              name: fc.name, shift: fc.shift,
              technicians: fc.techs.map(function (t) { return t.name || t.key; }),
              equipment: Object.keys(fc.equipment).map(function (k) {
                return k + ": " + fc.equipment[k].label + " (" + fc.equipment[k].sqftPerHour + " sqft/hr)";
              }),
              stops: fc.stops.length,
              total_minutes: timing.total,
              longest_tech_minutes: timing.longestTech
            };
          }));
        }
        if (inp.area === "floor_care_projects") {
          return page(F.loadFloorCare().projects.filter(hits).map(function (p) {
            return { task: p.task, date: p.date, hours: p.hours, team_members: p.teamMembers, man_hours: p.manHours, location: p.location, note: p.note };
          }));
        }
        if (inp.area === "equipment_catalog") {
          var cats = Object.keys(F.EQUIPMENT);
          var rows = [];
          cats.forEach(function (c) {
            F.EQUIPMENT[c].forEach(function (m) {
              rows.push({ category: c, brand: m.brand, model: m.model, path: m.pathIn, sqft_per_hour: m.sqftPerHour, basis: m.basis });
            });
          });
          F.DUST_MOP_SIZES.forEach(function (s) {
            rows.push({ category: "dust-mop", brand: "—", model: s.widthIn + "\" dust mop", sqft_per_hour: s.sqftPerHour, basis: "ISSA-style starting rate" });
          });
          return page(rows.filter(hits));
        }
        return { success: false, error: "Unknown area. Use: rooms, schedules, employees, cleaning_rules, recurring_services, floor_plans, floor_care_schedules, floor_care_projects, equipment_catalog." };
      },

      add_floor_care_project: function (inp, cx) {
        if (["Carpet Extraction", "Scrub", "Scrub & Recoat", "Strip & Refinish", "Miscellaneous"].indexOf(inp.task) < 0) {
          return { success: false, error: "Task must be one of: Carpet Extraction, Scrub, Scrub & Recoat, Strip & Refinish, Miscellaneous." };
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(inp.date || ""))) return { success: false, error: "Give the date as YYYY-MM-DD." };
        var hours = Math.max(1, Math.min(8, parseInt(inp.hours) || 0));
        var team = Math.max(1, Math.min(8, parseInt(inp.team_members) || 0));
        if (!hours || !team) return { success: false, error: "Hours and team members must each be 1–8." };
        var room = inp.room_number ? findRoom(cx, inp.room_number, inp.building) : null;
        if (inp.room_number && !room) return { success: false, error: "Space " + inp.room_number + " not found" };
        var manHours = hours * team;
        var noteId = uid2("fcnote");
        var nowIso = new Date().toISOString();
        var location = room ? String(room.roomNumber || "") + " " + String(room.roomName || "") : "";
        // the project note — Classic turns it into the calendar entry,
        // project schedule and manager reminders on its own
        if (cx.setNotes) {
          cx.setNotes(function (p) {
            return (p || []).concat([{
              id: noteId, date: new Date().toLocaleDateString(),
              title: "Floor care — " + inp.task + (location ? " · " + location.trim() : ""),
              body: inp.task + ". " + team + " team member" + (team > 1 ? "s" : "") + " × " + hours + "h = " + manHours + " man-hours." + (inp.note ? " " + inp.note : ""),
              linkedSpaceId: room ? room.id : "", linkedScheduleId: "", linkedEmployeeId: "",
              tags: ["Project"], kind: "project", isProject: true,
              projectDate: inp.date, projectTime: "", projectDuration: String(hours * 60),
              projectPriority: "medium", projectStatus: "scheduled",
              readAt: "", createdAt: nowIso, updatedAt: nowIso
            }]);
          });
        }
        var fcStore = F.loadFloorCare();
        fcStore.projects.push({
          id: uid2("fcp"), task: inp.task, date: inp.date, hours: hours,
          teamMembers: team, manHours: manHours,
          spaceId: room ? room.id : undefined, location: location.trim(),
          note: String(inp.note || ""), noteId: noteId, createdAt: nowIso
        });
        F.saveFloorCare(fcStore);
        return {
          success: true,
          message: "Scheduled " + inp.task + " on " + inp.date + (location ? " in " + location.trim() : "") +
            " — " + team + " × " + hours + "h = " + manHours + " man-hours. It's on the Floor Care calendar, in Max Notes and the reminders."
        };
      },

      edit_records: function (inp, cx) {
        var match = inp.match || {};
        var set = inp.set || {};
        if (!Object.keys(set).length) return { success: false, error: "Nothing to set." };
        var PROTECTED = ["id", "source", "visualPts", "visualPlanId", "visualW", "visualH", "importSource", "createdAt"];
        var q = String(match.query || "").toLowerCase();
        var textMatch = function (obj) { return q && JSON.stringify(obj).toLowerCase().indexOf(q) >= 0; };

        if (inp.area === "rooms") {
          var targets = match.room_number ? [findRoom(cx, match.room_number)].filter(Boolean)
            : (cx.spaces || []).filter(textMatch);
          if (!targets.length) return { success: false, error: "No rooms matched." };
          if (targets.length > 50 && !inp.allow_many) {
            return { success: false, error: "That matches " + targets.length + " rooms. Repeat with allow_many: true if that is intended." };
          }
          var rules = F.loadRules();
          // one guardrail layer for every field, known or future
          var prepared = {};
          for (var k in set) {
            if (PROTECTED.indexOf(k) >= 0) return { success: false, error: "The field \"" + k + "\" is protected and cannot be edited." };
            var v = set[k];
            if (k === "floorType") {
              var ft = fusionFloor(v);
              if (!ft) return { success: false, error: "\"" + v + "\" is not a floor type. The only three are: " + (F.FLOOR_TYPES || []).join(", ") + "." };
              prepared[k] = ft;
            } else if (k === "roomType") {
              var hit2 = typeLabelFor(rules, v);
              if (!hit2) return { success: false, error: "\"" + v + "\" is not a room type in Scope. Existing: " + rules.roomTypes.map(function (rt) { return rt.label; }).join(", ") + ". Create it first with set_room_type_rule." };
              prepared[k] = hit2.label;
              prepared.spaceTasks = F.autoTasksFor(rules, hit2.id);
            } else if (k === "cleanability") {
              if (CLEANABILITIES.indexOf(v) < 0) return { success: false, error: "Cleanability must be one of: " + CLEANABILITIES.join(", ") };
              prepared[k] = v;
            } else if (k === "spaceTasks" || k === "tasks") {
              var mapped2 = taskIdsFor(rules, Array.isArray(v) ? v : [v]);
              if (mapped2.unknown.length) return { success: false, error: "Unknown task(s): " + mapped2.unknown.join(", ") };
              prepared.spaceTasks = mapped2.ids;
            } else if (k === "squareFeet" || k === "fixtureCount") {
              prepared[k] = Math.round(parseFloat(v) || 0);
            } else if (v === null || ["string", "number", "boolean"].indexOf(typeof v) >= 0) {
              prepared[k] = v; // any other field, present or future, passes through
            } else {
              return { success: false, error: "The field \"" + k + "\" needs a plain value (text, number, or yes/no)." };
            }
          }
          targets.forEach(function (t) {
            commitSpace(cx, Object.assign({}, t, prepared), rules);
          });
          return { success: true, message: "Updated " + targets.length + " room" + (targets.length > 1 ? "s" : "") + " (" + Object.keys(set).join(", ") + "), repriced by the rules engine." };
        }

        if (inp.area === "schedules") {
          var scheds = match.schedule_number ? [findSchedule(cx, match.schedule_number)].filter(Boolean)
            : (cx.schedules || []).filter(textMatch);
          if (!scheds.length) return { success: false, error: "No schedules matched. Schedules: " + scheduleList(cx) };
          scheds.forEach(function (s) {
            var u = Object.assign({}, s, set, { updatedAt: new Date().toISOString() });
            u.id = s.id;
            if (set.targetHours !== undefined) u.targetHours = parseFloat(set.targetHours) || s.targetHours;
            cx.addSchedule(u); // the classic setter upserts by id
          });
          return { success: true, message: "Updated " + scheds.length + " schedule(s)." };
        }

        if (inp.area === "employees") {
          var emps = match.employee_name
            ? (cx.employees || []).filter(function (e) {
              var n = ((e.displayName || "") + " " + (e.firstName || "") + " " + (e.lastName || "")).toLowerCase();
              return n.indexOf(String(match.employee_name).toLowerCase()) >= 0;
            })
            : (cx.employees || []).filter(textMatch);
          if (!emps.length) return { success: false, error: "No employees matched." };
          emps.forEach(function (e) {
            var u = Object.assign({}, e, set, { updatedAt: new Date().toISOString() });
            u.id = e.id;
            cx.updateEmployee(u);
          });
          return { success: true, message: "Updated " + emps.length + " employee(s)." };
        }

        if (inp.area === "recurring_services") {
          var services2 = readServices();
          var picked = services2.filter(function (t) {
            if (match.service && norm(t.name) !== norm(match.service)) return false;
            if (match.schedule_number) {
              var sc = findSchedule(cx, match.schedule_number);
              if (!sc || t.scheduleId !== sc.id) return false;
            }
            return match.service || match.schedule_number || textMatch(t);
          });
          if (!picked.length) return { success: false, error: "No recurring services matched." };
          picked.forEach(function (t) {
            if (set.hours !== undefined) t.hours = parseFloat(set.hours) || t.hours;
            if (set.name !== undefined || set.service !== undefined) t.name = String(set.name || set.service);
            if (set.schedule_number !== undefined) {
              var to = findSchedule(cx, set.schedule_number);
              if (to) t.scheduleId = to.id;
            }
          });
          writeServices(services2);
          return { success: true, message: "Updated " + picked.length + " service(s)." };
        }

        return { success: false, error: "Unknown area. Use: rooms, schedules, employees, recurring_services." };
      },

      // ── overrides of the archive's own space writers: fusion floor labels,
      //    Scope-engine minutes, and auto tasks on a type change ──
      update_space: function (inp, cx) {
        var t = findRoom(cx, inp.room_number);
        if (!t) return { success: false, error: "Space " + inp.room_number + " not found" };
        var rules = F.loadRules();
        var u = Object.assign({}, t, inp);
        delete u.room_number;
        if (inp.roomType !== undefined) {
          var hit = typeLabelFor(rules, inp.roomType);
          u.roomType = hit ? hit.label : String(inp.roomType || "").trim();
          u.spaceTasks = hit ? F.autoTasksFor(rules, hit.id) : [];
        }
        if (inp.floorType !== undefined) {
          var ft = fusionFloor(inp.floorType);
          if (!ft) return { success: false, error: "\"" + inp.floorType + "\" is not a floor type I know. Use Carpet, Hard floor — finished (vinyl/tile/LVT), or Hard floor — unfinished (bare concrete)." };
          u.floorType = ft;
        }
        u.squareFeet = Math.round(parseFloat(u.squareFeet) || 0);
        u.fixtureCount = Math.round(parseFloat(u.fixtureCount) || 0);
        commitSpace(cx, u, rules);
        return { success: true, message: "Updated space " + t.roomNumber + " (" + u.estimatedCleaningMinutes + " min per clean)." };
      },

      add_space: function (inp, cx) {
        if (!String(inp.roomNumber || "").trim()) return { success: false, error: "Room number is required" };
        var rules = F.loadRules();
        var hit = inp.roomType ? typeLabelFor(rules, inp.roomType) : null;
        var ns = Object.assign({
          building: "", floor: "", department: "", roomName: "",
          squareFeet: 0, fixtureCount: 0, priorityLevel: "medium",
          floorType: "", cleaningFrequency: "Daily"
        }, inp, {
          id: uid2("sp-max"),
          roomNumber: String(inp.roomNumber).trim(),
          roomType: hit ? hit.label : String(inp.roomType || "").trim(),
          floorType: inp.floorType !== undefined ? fusionFloor(inp.floorType) : "",
          spaceTasks: hit ? F.autoTasksFor(rules, hit.id) : [],
          updatedAt: new Date().toISOString()
        });
        ns.squareFeet = Math.round(parseFloat(ns.squareFeet) || 0);
        ns.estimatedCleaningMinutes = Math.round(F.computeMinutes(rules, ns).total);
        if (cx.addSpaces) cx.addSpaces([ns]); else cx.updateSpace(ns);
        return { success: true, message: "Added space " + ns.roomNumber + " (" + ns.estimatedCleaningMinutes + " min per clean)." };
      },

      bulk_update_spaces: function (inp, cx) {
        var f = inp.filter || {};
        var q = String(f.query || "").toLowerCase();
        var rules = F.loadRules();
        var matched = (cx.spaces || []).filter(function (s) {
          if (q && ((s.roomNumber || "") + " " + (s.roomName || "") + " " + (s.department || "")).toLowerCase().indexOf(q) < 0) return false;
          if (f.building && s.building !== f.building) return false;
          if (f.floor && s.floor !== f.floor) return false;
          if (f.department && s.department !== f.department) return false;
          if (f.room_type && s.roomType !== f.room_type) return false;
          if (f.unscheduled_only && s.assignedScheduleId) return false;
          return true;
        });
        var updates = inp.updates || {};
        var hit = updates.roomType !== undefined ? typeLabelFor(rules, updates.roomType) : null;
        var ft = updates.floorType !== undefined ? fusionFloor(updates.floorType) : undefined;
        if (updates.floorType !== undefined && !ft) {
          return { success: false, error: "\"" + updates.floorType + "\" is not a floor type I know. Use Carpet, Hard floor — finished, or Hard floor — unfinished." };
        }
        matched.forEach(function (s) {
          var u = Object.assign({}, s, updates);
          if (hit) { u.roomType = hit.label; u.spaceTasks = F.autoTasksFor(rules, hit.id); }
          if (ft !== undefined) u.floorType = ft;
          commitSpace(cx, u, rules);
        });
        return { success: true, message: "Updated " + matched.length + " spaces", count: matched.length };
      }
    };

    var origMakeExecuteTool = makeExecuteTool;
    window.makeExecuteTool = function (cx) {
      var base = origMakeExecuteTool(cx);
      return function (name, inp) {
        var impl = FUSION_IMPL[name];
        if (impl) {
          try { return impl(inp || {}, cx); }
          catch (e) { return { success: false, error: String(e && e.message || e) }; }
        }
        return base(name, inp);
      };
    };

    // The archive also has a LOCAL fast path (runDirectMaxCommand) that
    // catches phrases like "change room 102 floor type…" and drives the old
    // form — bypassing the Scope engine entirely. Only its two SAFE intents
    // keep their instant local handling (opening Rover, plain navigation);
    // every data-touching request falls through to the reasoning + tools
    // path, where the model interprets the words and the guardrails price
    // everything with the rulebook. Whitelisting by what the fast path DID
    // (not by keywords) means no phrase list to maintain — ever.
    if (typeof runDirectMaxCommand === "function" && !window.__fusionDirectWrapped) {
      window.__fusionDirectWrapped = true;
      var origDirect = runDirectMaxCommand;
      window.runDirectMaxCommand = function (cx, text) {
        // disarm only the data-editing shortcuts for the duration of the
        // call; Rover and navigation run exactly as the archive wrote them
        var f1 = window.maxFillSpaceFormFromCommand, f2 = window.maxWantsSpaceForm, f3 = window.maxParseSpaceCommand;
        window.maxFillSpaceFormFromCommand = function () { return null; };
        window.maxWantsSpaceForm = function () { return false; };
        window.maxParseSpaceCommand = function () { return null; };
        try { return origDirect(cx, text); }
        finally {
          window.maxFillSpaceFormFromCommand = f1;
          window.maxWantsSpaceForm = f2;
          window.maxParseSpaceCommand = f3;
        }
      };
    }
  }
  wireMaxFusionTools();
  wireMaxQuality();

  // ── the Claude proxy bridge for the ARCHIVE's own Max assistant ────────────
  // On cloud builds, the archive's chat/voice assistant must not need (or
  // expose) a browser API key: this page's calls to api.anthropic.com are
  // re-routed to the server-side claude-proxy, which holds the organization's
  // key and meters usage. The archive is untouched — only fetches to that
  // ONE exact URL are redirected.
  //
  // The wrapper installs SYNCHRONOUSLY at boot and resolves the proxy FRESH
  // on every call. (The first version installed it asynchronously after a
  // session probe — the staging smoke test proved that leaves a window where
  // the placeholder key can leak to Anthropic as an "invalid API key". This
  // design makes that impossible: with no session and no real key, the call
  // is answered locally with a plain-English sign-in message.)
  var CLOUD_KEY_PLACEHOLDER = "managed-by-opsmatrix-cloud";

  function wireAiProxy() {
    if (window.__fusionAiProxyWired) return;
    var F = window.OpsMatrixFusion;
    if (!F || typeof F.aiProxy !== "function" || !F.cloudConfigured) return;
    window.__fusionAiProxyWired = true;

    var origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      if (url !== "https://api.anthropic.com/v1/messages") return origFetch(input, init);
      return F.aiProxy().catch(function () { return null; }).then(function (p) {
        var headers = new Headers((init && init.headers) || {});
        if (p) {
          headers.delete("x-api-key");
          headers.delete("anthropic-dangerous-direct-browser-access");
          headers.set("authorization", "Bearer " + p.token);
          if (!headers.get("x-opsmatrix-feature")) headers.set("x-opsmatrix-feature", "max-chat");
          return origFetch(p.url, Object.assign({}, init, { headers: headers }));
        }
        var key = headers.get("x-api-key") || "";
        if (key && key !== CLOUD_KEY_PLACEHOLDER) return origFetch(input, init); // a real personal key
        // no proxy session and no real key: answer here, in plain English —
        // the placeholder must NEVER reach Anthropic as an "invalid key"
        return new Response(JSON.stringify({
          error: {
            type: "authentication_error",
            message: "Sign in to OpsMatrix to use Max — open Max Schedules, sign in, then try again."
          }
        }), { status: 401, headers: { "content-type": "application/json" } });
      });
    };

    // The archive enables its Max features only when a key is saved; under
    // the proxy the ACCOUNT is the key. Seed the marker once a session is
    // confirmed (the wrapper above guarantees it can never leak), with one
    // guarded reload so the archive sees it at load time.
    F.aiProxy().then(function (p) {
      if (!p || getApiKey()) return;
      setApiKey(CLOUD_KEY_PLACEHOLDER);
      if (!sessionStorage.getItem("fusion-proxy-reloaded")) {
        sessionStorage.setItem("fusion-proxy-reloaded", "1");
        window.location.reload();
      }
    }).catch(function () { /* stays keyless until sign-in — wrapper still guards */ });
  }

  // In cloud mode the API key and model are managed by OpsMatrix (the server
  // holds the org key; the proxy pins the model) — the archive's "Max AI"
  // settings block (key field + model picker) must not be shown to users.
  // The administrator controls AI centrally, not per-browser.
  function hideCloudManagedSettings() {
    var F = window.OpsMatrixFusion;
    if (!F || !F.cloudConfigured) return;
    var input = document.querySelector("input[placeholder='sk-ant-api...']");
    if (!input) return;
    var el = input;
    for (var i = 0; i < 8 && el; i++) {
      el = el.parentElement;
      if (el && el.textContent.indexOf("Max Operator Model") >= 0 &&
          el.textContent.indexOf("Anthropic API Key") >= 0) {
        if (el.style.display !== "none") el.style.display = "none";
        return;
      }
    }
  }

  // ── phone bottom nav: one strip that slides, EVERY destination on it ───────
  // Classic's own mobile bar shows four items plus a "More" grid; on a phone
  // that hid Max Floor Care (and made everything two taps). This replaces it
  // with a horizontally scrollable bar built FROM the sidebar's buttons — so
  // whatever the sidebar holds (fusion additions included) is always one
  // thumb-slide away. The archive bar is hidden by CSS, never modified.
  function ensureMobileNav() {
    var host = document.getElementById("fusion-bottomnav");
    if (!host) {
      var style = document.createElement("style");
      style.textContent =
        "#fusion-bottomnav{display:none;position:fixed;left:0;right:0;bottom:0;z-index:60;" +
        "overflow-x:auto;-webkit-overflow-scrolling:touch;white-space:nowrap;" +
        "background:rgba(10,18,32,.96);backdrop-filter:blur(10px);" +
        "border-top:1px solid rgba(148,163,184,.2);" +
        "padding:6px 6px calc(6px + env(safe-area-inset-bottom));}" +
        "#fusion-bottomnav::-webkit-scrollbar{display:none}" +
        "#fusion-bottomnav button{display:inline-block;vertical-align:middle;border:none;background:none;" +
        "color:#94a3b8;font:600 12.5px 'Segoe UI',sans-serif;padding:12px 13px;border-radius:10px;cursor:pointer}" +
        "#fusion-bottomnav button:active{background:rgba(20,184,166,.18);color:#2dd4bf}" +
        "@media (max-width: 767px){.bottombar{display:none !important}#fusion-bottomnav{display:block}}";
      document.head.appendChild(style);
      host = document.createElement("div");
      host.id = "fusion-bottomnav";
      document.body.appendChild(host);
    }
    var sidebarBtns = [];
    var all = document.querySelectorAll(".sidebar button");
    for (var i = 0; i < all.length; i++) {
      var label = (all[i].textContent || "").trim();
      if (!label) continue;
      if (label.indexOf("Ask Max") >= 0) label = "🤖 Ask Max";
      sidebarBtns.push({ label: label, el: all[i] });
    }
    if (!sidebarBtns.length) return;
    var sig = sidebarBtns.map(function (b) { return b.label; }).join("|");
    if (host.getAttribute("data-sig") === sig) return;
    host.setAttribute("data-sig", sig);
    host.innerHTML = "";
    // the universal back button rides the phone strip too, always first
    var backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.textContent = "‹ Back";
    backBtn.style.color = "#2dd4bf";
    backBtn.addEventListener("click", fusionGoBack);
    host.appendChild(backBtn);
    sidebarBtns.forEach(function (b) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = b.label;
      btn.addEventListener("click", function () { b.el.click(); });
      host.appendChild(btn);
    });
  }

  // the classic app re-renders constantly; keep our button present cheaply
  // (demo seeding lives in fusion-seed.js, injected BEFORE the app's script)
  var mo = new MutationObserver(function () { ensureSpaceScreen(); ensureGotoPage(); ensureButton(); ensureMobileNav(); });
  function boot() {
    // legacy ?calibrate=1 links: the Plan Studio (hub) owns calibration now
    if (/[?&]calibrate=1/.test(window.location.search)) {
      window.location.replace("./maps.html#spaces?view=map&plancal=1");
      return;
    }
    // the navigation trail: classic always boots on the Dashboard unless a
    // goto flag immediately moves it (those pushes happen on arrival)
    if (!sessionStorage.getItem("fusion-goto-page") &&
        !/[?&]fp=1/.test(window.location.search)) {
      navVisit("classic:Dashboard");
    }
    // record every sidebar navigation (capture — before React re-renders);
    // pages that leave for the hub push their own token on arrival instead
    document.addEventListener("click", function (e) {
      var el = e.target;
      while (el && el.nodeName !== "BUTTON") el = el.parentElement;
      if (!el) return;
      var p = el, inNav = false;
      while (p && p !== document.body) {
        var cn = String(p.className || "");
        if (cn.indexOf("sidebar") >= 0 || p.id === "fusion-bottomnav") { inNav = true; break; }
        p = p.parentElement;
      }
      if (!inNav) return;
      var label = (el.textContent || "").trim();
      if (!label || label === "‹ Back") return;
      if (label.indexOf("Ask Max") >= 0 || label === "Sign out") return;
      if (label === "Max Schedules" || label === "Max Floor Care" || label === "Max Space") return; // hub pages
      navVisit("classic:" + label);
    }, true);
    // Dashboard's "Schedule Reminders" tile belongs to Max Calendar (Josh:
    // "clicking it takes you to Max Team, which doesn't make sense")
    document.addEventListener("click", function (e) {
      var el = e.target;
      while (el && el !== document.body) {
        if (String(el.className || "").indexOf("ops-tile") >= 0) {
          if ((el.textContent || "").indexOf("Schedule Reminders") >= 0) {
            e.preventDefault();
            e.stopPropagation();
            clickNav("Max Calendar");
          }
          return;
        }
        el = el.parentElement;
      }
    }, true);
    ensureSpaceScreen();
    ensureGotoPage();
    ensureButton();
    ensureMobileNav();
    // cloud builds only (all no-ops on local/demo builds):
    // 1. signed-out visitors go to the sign-in screen
    // 2. mirror this page's data to the organization
    // 3. the Claude proxy bridge (installed synchronously — see wireAiProxy)
    if (window.OpsMatrixFusion && typeof window.OpsMatrixFusion.enforceCloudSignIn === "function") {
      try { window.OpsMatrixFusion.enforceCloudSignIn(); } catch (e) { /* stay */ }
    }
    if (window.OpsMatrixFusion && typeof window.OpsMatrixFusion.startCloudSync === "function") {
      try { window.OpsMatrixFusion.startCloudSync(); } catch (e) { /* stays local */ }
    }
    wireAiProxy();
    // characterData too: React swaps some labels (e.g. the plan picker's) by
    // rewriting the text node in place, which is not a childList mutation.
    // Our relabels are guarded by an exact-match test, so this cannot loop.
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
