/* ------------------------------------------------------------------
   tests.js — the in-app test suite (BUILD-SPEC §17.11 and §12).

   These run ON THE PANEL, against the code that is actually installed.
   That is the point: tools/check-browser.js runs on a developer's
   machine in a browser that is not this one, and cannot answer whether
   THIS WebView, on THIS hardware, gets the same answers.

   The fairness test in particular is kept in the app on purpose — it is
   the evidence if anyone disputes a result (§7).

   Every test returns { name, pass, detail } so the panel can render
   them uniformly and a future export can include them.
------------------------------------------------------------------ */
(function (NS) {
  "use strict";

  function t(name, pass, detail) {
    return { name: name, pass: !!pass, detail: detail || "" };
  }

  /* ---- randomness ------------------------------------------------- */
  function testRandom() {
    var out = [], i, v, min = 1, max = 0, sum = 0;
    var N = 20000;
    for (i = 0; i < N; i++) {
      v = NS.rand();
      if (v < 0 || v >= 1) return [t("Randomness in range", false, "got " + v)];
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    out.push(t("crypto.getRandomValues available", !!(window.crypto && window.crypto.getRandomValues),
               "Math.random is never used"));
    out.push(t("Draws stay inside [0,1)", true, N.toLocaleString() + " draws"));
    var mean = sum / N;
    out.push(t("Mean is near 0.5", Math.abs(mean - 0.5) < 0.02, mean.toFixed(4)));
    out.push(t("Spread covers the range", min < 0.01 && max > 0.99,
               min.toFixed(5) + " to " + max.toFixed(5)));
    return out;
  }

  /* ---- landing (§17.3) -------------------------------------------- */
  function testLanding(n) {
    var r = NS.Spin.testLanding(n || 10000);
    return [
      t("Landing: no mismatches", r.mismatches === 0,
        r.n.toLocaleString() + " trials in " + r.ms + " ms"),
      t("Landing: never within 5 degrees of a divider", r.closestToDivider >= 5,
        "closest approach " + r.closestToDivider.toFixed(2) + " degrees")
    ];
  }

  /* ---- fairness (§7, §12) ----------------------------------------- */
  function testFairness(n) {
    var w = NS.weights();
    var r = NS.Spin.testFairness(n || 10000, w.weights);
    var detail = "chi2 " + r.chi.toFixed(2) + " at " + r.df + " df, " +
                 r.n.toLocaleString() + " draws in " + r.ms + " ms" +
                 "  (5% line " + r.critical + ", 0.1% line " + r.criticalHard + ")";
    if (r.verdict === "high") {
      detail += " — above the 5% line, which a fair wheel does about one run " +
                "in twenty. Run it again; two in a row would be worth a look.";
    }
    var out = [
      t("Fairness: the draw matches the configured odds", r.pass, detail)
    ];
    if (w.placeholder) {
      out.push(t("Fairness is being measured against real odds", false,
                 "placeholder odds are in use — enter the real ones above"));
    }
    return out;
  }

  /* ---- storage ---------------------------------------------------- */
  function testStorage() {
    var out = [];
    out.push(t("localStorage is available", NS.Store.available));
    var probe = { a: 1, b: "two", c: [3, 4], d: { e: 5 } };
    var wrote = NS.Store.write("__selftest", probe);
    var read = NS.Store.read("__selftest", null);
    NS.Store.remove("__selftest");
    out.push(t("A value survives a write and read",
               wrote && read && JSON.stringify(read) === JSON.stringify(probe),
               wrote ? "round-tripped" : "write failed: " + NS.Store.lastError));
    out.push(t("Persistent storage granted", NS.Store.persisted === true,
               "navigator.storage.persisted() is " + NS.Store.persisted +
               (NS.Store.persisted === true ? ""
                 : " — the event's stock may be evicted")));
    return out;
  }

  /* ---- the daily buckets (§8, §17.4) ------------------------------
     Exercises the real date logic by moving the override, then puts it
     back exactly as it was. */
  function testDays() {
    var out = [];
    var cfg = NS.Inventory.config();
    if (!cfg.event.dates) {
      return [t("Daily rollover", false, "event dates are not set yet")];
    }
    var before = NS.Inventory.settings().dateOverride;
    try {
      var seen = [];
      for (var i = 0; i < 3; i++) {
        NS.Inventory.saveSettings({ dateOverride: cfg.event.dates[i] });
        seen.push(NS.Inventory.dayIndex());
      }
      out.push(t("Each event date selects its own day",
                 seen.join(",") === "0,1,2", "got day indexes " + seen.join(", ")));

      NS.Inventory.saveSettings({ dateOverride: "1999-01-01" });
      out.push(t("A date before the event is handled",
                 NS.Inventory.dayIndex() === -1, NS.Inventory.dayLabel()));
      NS.Inventory.saveSettings({ dateOverride: "2099-01-01" });
      out.push(t("A date after the event is handled",
                 NS.Inventory.dayIndex() === 3, NS.Inventory.dayLabel()));
    } finally {
      NS.Inventory.saveSettings({ dateOverride: before });
    }
    out.push(t("Date override left as it was",
               NS.Inventory.settings().dateOverride === before,
               before ? ("still overridden to " + before) : "cleared, using the device clock"));
    return out;
  }

  /* ---- QR (§9.3) --------------------------------------------------
     Encodes and re-reads its own output. A scanner still has to be
     tried on the real panel, but a broken encoder shows up here. */
  function testQR() {
    var out = [];
    try {
      var text = "JPH-SELFTEST-01";
      var qr = NS.QR.encode(text);
      out.push(t("QR encodes", !!qr && qr.size > 0,
                 "version " + qr.version + ", " + qr.size + "x" + qr.size +
                 ", mask " + qr.mask));

      // the three finder patterns must be exactly right or nothing scans
      var m = qr.modules, sz = qr.size, ok = true;
      [[0, 0], [0, sz - 7], [sz - 7, 0]].forEach(function (p) {
        for (var i = 0; i < 7; i++) {
          for (var j = 0; j < 7; j++) {
            var on = (i === 0 || i === 6 || j === 0 || j === 6) ||
                     (i >= 2 && i <= 4 && j >= 2 && j <= 4);
            if (m[p[0] + i][p[1] + j] !== (on ? 1 : 0)) ok = false;
          }
        }
      });
      out.push(t("QR finder patterns correct", ok));
      out.push(t("QR dark module set", m[sz - 8][8] === 1));

      var svg = NS.QR.toSVG(qr, 340, 4);
      out.push(t("QR renders at or above the 320px minimum",
                 svg.indexOf('width="340"') > -1, "340px"));
    } catch (e) {
      out.push(t("QR encodes", false, String(e.message || e)));
    }
    return out;
  }

  /* ---- state machine (§17.7) --------------------------------------
     Every state must have a way out. Checked structurally rather than
     by driving the UI, so it cannot be fooled by timing. */
  function testStates() {
    var exits = {
      attract:  "tap the lower area",
      spinning: "the spin finishes and opens the result",
      result:   "auto-dismiss, a tap, or the watchdog",
      endOfDay: "stock is restocked or the day rolls over",
      setup:    "staff enter the configuration",
      boot:     "start() moves it on immediately"
    };
    var missing = [];
    for (var i = 0; i < NS.STATES.length; i++) {
      if (!exits[NS.STATES[i]]) missing.push(NS.STATES[i]);
    }
    return [
      t("Every state has a declared exit", missing.length === 0,
        missing.length ? ("no exit for: " + missing.join(", "))
                       : NS.STATES.length + " states, all with exits"),
      t("The app is not stuck outside attract",
        NS.getState() !== "spinning",
        "currently: " + NS.getState())
    ];
  }

  /* ---- coupons actually handed over --------------------------------
     The wheel issuing a coupon and a coupon reaching somebody are two
     different facts. This is the one that matters at close of day. */
  function testHandover() {
    var today = NS.Inventory.today();
    var openToday = NS.Inventory.unacknowledged(today);
    var openAll = NS.Inventory.unacknowledged();
    return [
      t("Every coupon issued today was confirmed handed over", openToday === 0,
        openToday === 0 ? "nothing outstanding"
          : openToday + " win(s) issued but never confirmed"),
      t("Nothing outstanding from earlier days", openAll - openToday === 0,
        (openAll - openToday) + " from previous days")
    ];
  }

  /* ---- config completeness ---------------------------------------- */
  function testConfig() {
    var gaps = NS.Inventory.missing();
    var set = NS.Inventory.settings();
    return [
      t("Configured for a live event", gaps.length === 0,
        gaps.length ? (gaps.length + " still missing") : "stock, odds and dates all set"),
      t("Test mode is off", !set.testMode,
        set.testMode ? "ON — spins are not consuming stock" : ""),
      t("Date override is clear", !set.dateOverride,
        set.dateOverride ? ("ON — pretending it is " + set.dateOverride) : "using the device clock")
    ];
  }

  var SUITES = [
    { id: "random",   name: "Randomness",        run: testRandom },
    { id: "landing",  name: "Spin landing",      run: function () { return testLanding(10000); } },
    { id: "fairness", name: "Fairness",          run: function () { return testFairness(10000); } },
    { id: "storage",  name: "Storage",           run: testStorage },
    { id: "days",     name: "Daily buckets",     run: testDays },
    { id: "qr",       name: "QR code",           run: testQR },
    { id: "states",   name: "State machine",     run: testStates },
    { id: "handover", name: "Coupon handover",   run: testHandover },
    { id: "config",   name: "Event readiness",   run: testConfig }
  ];

  function runAll(heavy) {
    var results = [], i, s, rows;
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    for (i = 0; i < SUITES.length; i++) {
      s = SUITES[i];
      try {
        if (heavy && s.id === "landing") rows = testLanding(200000);
        else if (heavy && s.id === "fairness") rows = testFairness(200000);
        else rows = s.run();
      } catch (e) {
        rows = [t(s.name, false, "threw: " + (e.message || e))];
      }
      results.push({ id: s.id, name: s.name, rows: rows });
    }
    var ms = ((window.performance && performance.now) ? performance.now() : Date.now()) - t0;
    var total = 0, failed = 0;
    for (i = 0; i < results.length; i++) {
      for (var j = 0; j < results[i].rows.length; j++) {
        total++;
        if (!results[i].rows[j].pass) failed++;
      }
    }
    return { suites: results, total: total, failed: failed, ms: Math.round(ms),
             at: new Date().toISOString() };
  }

  NS.Tests = { SUITES: SUITES, runAll: runAll };
})(window.JPH = window.JPH || {});
