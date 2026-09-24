/* ------------------------------------------------------------------
   boot.js — application bootstrap.

   Stage 1 only brings the shell up: stage fitter, copy, persistent
   storage, service worker, diagnostics gesture. The wheel, spin
   physics, inventory and screens arrive in later stages and hang off
   the state machine stubbed at the bottom of this file.
------------------------------------------------------------------ */
(function (NS) {
  "use strict";

  NS.version = window.JPH_VERSION || "0.0.0";
  NS.build   = window.JPH_BUILD   || "";

  /* ---- copy into the markup (BUILD-SPEC section 10) -------------
     Every string comes from NS.COPY. Nothing is hard-coded in HTML,
     so the client's rewrite touches one file. */
  function applyCopy() {
    var nodes = NS.$$("[data-copy]"), i, key, n;
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i];
      key = n.getAttribute("data-copy");
      if (NS.COPY[key] != null) n.textContent = NS.COPY[key];
    }
  }

  /* ---- kiosk input suppression, first pass (section 14) ---------
     Several hundred people will touch this glass. The full hardening
     pass is stage 10; these are the ones that cost nothing now. */
  function hardenInput() {
    /* Several hundred people will touch this glass over three days, and
       a fair few of them will try to break it. Everything below is a
       thing that has been seen go wrong on a kiosk.

       CSS carries its share too: touch-action, user-select,
       overscroll-behavior and -webkit-touch-callout are set in app.css.
       These are the ones that need script. */

    // long-press menus, image save, text selection callouts
    document.addEventListener("contextmenu", function (e) {
      e.preventDefault();
    }, false);

    // double-tap zoom, which the viewport meta does not reliably stop
    document.addEventListener("dblclick", function (e) {
      e.preventDefault();
    }, false);

    // pinch zoom on WebViews that honour gesture events
    ["gesturestart", "gesturechange", "gestureend"].forEach(function (n) {
      document.addEventListener(n, function (e) { e.preventDefault(); }, false);
    });

    // multi-touch pinch on WebViews that ignore user-scalable=no
    document.addEventListener("touchstart", function (e) {
      if (e.touches && e.touches.length > 1) e.preventDefault();
    }, { passive: false });

    /* Pull-to-refresh and rubber-band scrolling. Reloading mid-event is
       the worst of these: it is survivable, because state is written
       synchronously before the animation starts, but it drops whoever
       was mid-spin back to attract. */
    document.addEventListener("touchmove", function (e) {
      if (e.touches && e.touches.length > 1) { e.preventDefault(); return; }
      var t = e.target;
      while (t && t !== document.body) {
        if (t.id === "diag") return;       // the staff panel may scroll
        t = t.parentNode;
      }
      e.preventDefault();
    }, { passive: false });

    // text selection and the drag handles that follow it
    document.addEventListener("selectstart", function (e) {
      var t = e.target;
      while (t && t !== document.body) {
        if (t.id === "diag") return;       // staff need to select an export
        t = t.parentNode;
      }
      e.preventDefault();
    }, false);

    // dragging an image out of the page
    document.addEventListener("dragstart", function (e) {
      e.preventDefault();
    }, false);

    /* A stray keyboard, or a bluetooth remote somebody leaves paired.
       F5, Ctrl+R and backspace-as-back have all reloaded a kiosk. */
    document.addEventListener("keydown", function (e) {
      var inField = document.activeElement &&
        /^(input|textarea)$/.test(String(document.activeElement.tagName).toLowerCase());
      var k = e.keyCode;
      if (k === 116 || (k === 82 && (e.ctrlKey || e.metaKey))) e.preventDefault();
      if (k === 8 && !inField) e.preventDefault();
      if (k === 122) e.preventDefault();
    }, false);

    // browser or OS back, where the WebView exposes history
    try {
      window.history.pushState(null, "", window.location.href);
      window.addEventListener("popstate", function () {
        window.history.pushState(null, "", window.location.href);
      }, false);
    } catch (e) { /* some WebViews refuse; not fatal */ }

    /* A backgrounded WebView comes back with a suspended audio context
       and a stale viewport. Recover rather than sit dead. */
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) return;
      NS.Audio.unlock();
      NS.Stage.fit();
    }, false);
  }

  /* ---- state machine (section 11) ------------------------------
     Stubbed. Stages 6 and 7 fill in the screens; keeping the shape
     here from the start means no state can be added later without a
     declared way out of it. */
  var STATES = ["boot", "setup", "attract", "spinning", "result", "endOfDay"];
  var state = "boot";
  NS.STATES = STATES;

  NS.setState = function (next) {
    if (STATES.indexOf(next) === -1) throw new Error("unknown state: " + next);
    document.body.setAttribute("data-state", next);
    state = next;
    // the wheel idles only in attract (section 9.1)
    if (NS.Attract) {
      if (next === "attract") NS.Attract.start(); else NS.Attract.stop();
    }
    /* Music plays in attract and nowhere else. It fades rather than cuts
       into a spin: a hard stop reads as a fault. Client decision
       2026-09-24; section 9.1 originally specified no sound in attract. */
    if (NS.Audio && NS.Audio.musicStart) {
      if (next === "attract") NS.Audio.musicStart();
      else NS.Audio.musicStop(next === "spinning");
    }
    if (NS.onState) NS.onState(next);
  };
  NS.getState = function () { return state; };

  /* Auto-dismiss is a staff setting, not a constant. The 12s/7s from
     BUILD-SPEC sections 9.3 and 9.4 become the preset. */
  NS.applyDismissSetting = function (on) {
    /* A win NEVER auto-dismisses: it is cleared by staff holding the
       confirm button, which is what records the coupon as handed over.
       Timing it out would be exactly the failure the hold exists to
       prevent. The preset only affects a hard luck, where there is
       nothing to collect and nothing to confirm. */
    NS.TIMING.winDismissMs = 0;
    NS.TIMING.loseDismissMs = on ? 7000 : 0;
  };

  /* ---- spinning -------------------------------------------------
     Input is locked for the whole spin and the lock lives in one place
     (Spin.isSpinning), not in the button's disabled attribute — stage 7
     makes the entire lower area a tap target and it must obey the same
     lock. Mashing must not queue spins (BUILD-SPEC section 9.2). */
  function doSpin() {
    if (NS.Spin.isSpinning()) return;              // the lock
    if (NS.getState() !== "attract") return;

    // 1. Draw the outcome from REMAINING STOCK, weighted (§7).
    var w = NS.weights();
    var idx = NS.pick(w.weights);

    // 2. Consume and persist BEFORE the animation starts (§3), so a
    //    panel killed mid-spin still has the right stock on restart.
    //    The entry carries the reference and the issued code.
    var entry = NS.Inventory.isConfigured() ? NS.Inventory.consume(idx) : null;

    // 3. Only now animate to it.
    NS.setState("spinning");
    document.getElementById("spinBtn").disabled = true;

    NS.Spin.spin(idx, function (res) {
      // A mismatch means the animation stopped on a different segment
      // than the draw chose. It must never happen; if it ever does it has
      // to be loud rather than silent, so it lands in the storage error
      // line that diagnostics reads.
      if (!res.match) {
        NS.Store.lastError = "LANDING MISMATCH: drew " + res.segment.id +
                             ", stopped on " + NS.SEGMENTS[res.landedIndex].id;
      }
      NS.setState("result");
      // now the wheel has stopped, the count may catch up
      if (visualsPending) applyStockVisuals();
      NS.Result.show(res, entry, function () {
        document.getElementById("spinBtn").disabled = false;
        settleState();
      });
    });
  }
  NS.doSpin = doSpin;

  /* A dropped timer must not strand the app on a result. Every state
     except attract is transient or has its own exit, and this is the
     backstop for the one that is timer-driven (BUILD-SPEC section 17.7:
     no state is reachable that has no exit). */
  function startWatchdog() {
    setInterval(function () {
      if (NS.getState() !== "result") return;
      if (NS.Spin.isSpinning()) return;
      if (!NS.Result.isOpen()) { settleState(); return; }
      if (NS.Result.openedFor() <= NS.TIMING.strandedMs) return;

      /* A WIN IS NEVER CLOSED FROM HERE. It waits for staff to hold the
         confirm button, and closing it on a timer is precisely the failure
         the hold exists to prevent — the coupon would go unhanded and
         unrecorded. A win left up is not a fault, it is the screen doing
         its job, and the staff panel counts it as outstanding.

         A hard luck has nothing to collect, so if one is somehow still up
         after this long the watchdog does clear it. */
      if (NS.Result.needsHandover()) return;
      NS.Store.lastError = "a hard-luck result sat for " +
        Math.round(NS.TIMING.strandedMs / 1000) + "s and the watchdog cleared it";
      NS.Result.hide();
    }, 2000);
  }

  /* ---- which screen should be showing --------------------------- */
  function settleState() {
    if (!NS.Inventory.isConfigured()) { NS.setState("setup"); return; }

    /* Outside the three event dates there is no bucket to draw from, so
       every spin would be a guaranteed Hard Luck with nothing on screen
       to explain why. Say the wheel is closed instead. This is not the
       end-of-day toggle — that is about stock running out ON a day. */
    var day = NS.Inventory.dayIndex();
    if (day === null || day < 0 || day > 2) { NS.setState("endOfDay"); return; }

    var set = NS.Inventory.settings();
    if (set.endOfDayMode === "stop" && NS.Inventory.todayExhausted()) {
      NS.setState("endOfDay");
      return;
    }
    NS.setState("attract");
  }
  NS.settleState = settleState;

  /* Everything that has to repaint when stock or config moves.

     The stock panel and the SOLD OUT stamps are held back while a spin is
     running. Stock is still consumed and written at draw time — section 3
     requires that, and it is what makes a panel killed mid-spin correct on
     restart — but showing it immediately gave the result away: the count
     dropped the instant the screen was tapped, before the wheel had moved.
     The data leads, the display follows. */
  var visualsPending = false;

  function onInventoryChange() {
    NS.Audio.enabled = NS.Inventory.settings().sound;
    if (NS.getState() === "spinning") { visualsPending = true; return; }
    applyStockVisuals();
    /* The closed screen says two different things depending on WHY it is
       showing: stock gone for today, or the event is not running. */
    var eodT = document.getElementById("endOfDayTitle");
    var eodL = document.getElementById("endOfDayLine");
    if (eodT && eodL) {
      var cfg = NS.Inventory.config();
      var d = NS.Inventory.dayIndex();
      if (d === -1) {
        eodT.textContent = NS.COPY.closedTitle;
        eodL.textContent = NS.fill(NS.COPY.closedBefore,
          { date: (cfg.event.dates && cfg.event.dates[0]) || "soon" });
      } else if (d === null || d > 2) {
        eodT.textContent = NS.COPY.closedTitle;
        eodL.textContent = NS.COPY.closedAfter;
      } else {
        eodT.textContent = NS.COPY.endOfDayTitle;
        eodL.textContent = NS.COPY.endOfDayLine;
      }
    }
    if (!NS.Spin.isSpinning()) settleState();
  }
  NS.onInventoryChange = onInventoryChange;

  function applyStockVisuals() {
    visualsPending = false;
    NS.StockPanel.render();
    NS.Wheel.paint(NS.Inventory.isConfigured() ? NS.Inventory.soldOutIds() : []);
  }
  NS.applyStockVisuals = applyStockVisuals;

  /* ---- boot ----------------------------------------------------- */
  function start() {
    applyCopy();
    hardenInput();
    NS.Stage.init();
    NS.Wheel.init();
    NS.Spin.init();
    NS.Result.init();
    NS.Attract.init();
    NS.Inventory.changed = onInventoryChange;
    NS.Inventory.init();
    NS.StockPanel.init();
    NS.Install.init();
    NS.Diagnostics.init();

    // The coupon inventory lives in localStorage for three days.
    // Ask for persistence immediately, and record the answer.
    NS.Store.requestPersist(function () { /* reported in diagnostics */ });

    NS.SW.register(function () { /* reported in diagnostics */ });

    // Android blocks audio until a user gesture, and a WebView that has
    // been backgrounded comes back suspended, so unlock on every touch
    // rather than only the first.
    document.addEventListener("touchstart", NS.Audio.unlock, true);
    document.addEventListener("mousedown", NS.Audio.unlock, true);

    var btn = document.getElementById("spinBtn");
    if (btn) {
      btn.disabled = false;
      btn.addEventListener("click", doSpin, false);
    }

    onInventoryChange();
    startWatchdog();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, false);
  } else {
    start();
  }
})(window.JPH = window.JPH || {});
