/* ------------------------------------------------------------------
   diagnostics.js — staff-facing instrument panel.

   Opened by the hidden gesture that will later open the admin panel
   (BUILD-SPEC section 12): a 3-second press in the bottom-left corner.
   Never reachable by a normal touch, never seen by an attendee.

   It exists because stage 1's acceptance criteria cannot be checked
   any other way on a kiosk panel with no address bar and no devtools:
     - does the app boot with the network removed
     - does navigator.storage.persisted() return true
------------------------------------------------------------------ */
(function (NS) {
  "use strict";

  var panel, body, pressTimer = null, precache = null;
  var testResults = null, hubTaps = 0, hubTimer = null;
  var importText = "", exportKind = null;

  function row(k, v, cls) {
    return '<tr><td>' + k + '</td><td class="' + (cls || '') + '">' + v + '</td></tr>';
  }

  function verdict(ok, warn) {
    return ok ? "ok" : (warn ? "warn" : "bad");
  }

  function askPrecache(done) {
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller ||
        typeof MessageChannel === "undefined") { done(null); return; }
    var ch = new MessageChannel();
    var settled = false;
    ch.port1.onmessage = function (e) { if (!settled) { settled = true; done(e.data); } };
    try {
      navigator.serviceWorker.controller.postMessage({ type: "PRECACHE_STATUS" }, [ch.port2]);
    } catch (err) { done(null); return; }
    setTimeout(function () { if (!settled) { settled = true; done(null); } }, 2500);
  }

  function render() {
    var SW = NS.SW, Store = NS.Store, m = NS.Stage.metrics();
    var now = new Date();
    var standalone = !!(window.matchMedia &&
                        window.matchMedia("(display-mode: standalone)").matches);
    var controlled = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
    var html = "";

    html += '<button class="close" id="diagClose">Close</button>';
    html += '<h2>JPH Wheel &mdash; staff panel</h2>';

    /* --- the gate (BUILD-SPEC section 12) ------------------------
       Not security: the credentials are in the page source and anyone
       can read them. It keeps attendees out during a busy event, which
       is the actual threat model. */
    if (!NS.Auth.isAuthed()) {
      html += '<div class="sub">Staff only.</div>';
      html += '<h3>SIGN IN</h3><table>';
      html += '<tr><td>User</td><td><input type="text" id="authUser" ' +
              'autocomplete="off" autocapitalize="none" spellcheck="false"></td></tr>';
      html += '<tr><td>Password</td><td><input type="password" id="authPass" ' +
              'autocomplete="off"></td></tr>';
      html += '</table>';
      html += '<button id="authGo">Sign in</button>';
      html += '<div id="authMsg" class="note"></div>';
      html += '<div class="note">The session ends after 5 minutes idle and on ' +
              'every app reload. These credentials are not security and must ' +
              'not be reused anywhere else.</div>';
      body.innerHTML = html;
      wireAuth();
      return;
    }

    html += '<div class="sub">Signed in. Locks itself after 5 minutes idle. ' +
            '<span id="idleLeft"></span></div>';
    html += '<button id="authOut">Sign out</button>';

    /* --- the editable half (BUILD-SPEC section 12) --------------
       Stock, odds, dates and terms are entered here, not baked in. */
    html += NS.Admin.render();

    /* --- offline readiness ------------------------------------- */
    html += '<h3>OFFLINE READINESS</h3><table>';
    html += row("App version", NS.version + " (" + NS.build + ")");
    html += row("Network", navigator.onLine ? "online" : "OFFLINE",
                navigator.onLine ? "" : "ok");
    html += row("Secure context",
                SW.secure ? "yes" : "NO &mdash; service worker cannot register",
                verdict(SW.secure));
    html += row("Service worker", SW.state + (SW.error ? " &mdash; " + SW.error : ""),
                verdict(SW.state === "active" || SW.state === "waiting",
                        SW.state === "registering"));
    html += row("Page controlled by worker",
                controlled ? "yes" : "not yet &mdash; reload once after first install",
                verdict(controlled, true));
    if (precache) {
      if (precache.error) {
        html += row("Shell cache", precache.error, "bad");
      } else {
        html += row("Shell cache", precache.cache + " &mdash; " +
                    (precache.total - precache.missing.length) + " / " +
                    precache.total + " files",
                    verdict(precache.missing.length === 0));
        if (precache.missing.length) {
          html += row("Missing from cache", precache.missing.join("<br>"), "bad");
        }
      }
    } else {
      html += row("Shell cache", "not reported", "warn");
    }
    html += row("Update held", SW.updateReady ? "yes &mdash; an update is waiting" : "no",
                SW.updateReady ? "warn" : "");
    html += '</table>';

    /* --- installing (BUILD-SPEC section 3) ---------------------- */
    var ins = NS.Install.state;
    var installed = NS.Install.isInstalled();
    html += '<h3>INSTALLING TO THE HOME SCREEN</h3><table>';
    html += row("Installed", installed ? "yes, running as an installed app"
                                       : "NO &mdash; running in a browser tab",
                verdict(installed));
    html += row("Browser offered an install prompt",
                NS.Install.available() ? "yes"
                  : (ins.supported ? "it did, and it has been used"
                                   : "not offered"),
                verdict(NS.Install.available() || installed, true));
    if (ins.manifest) {
      html += row("Manifest", ins.manifest.type + " &mdash; display " +
                  ins.manifest.display + ", icons " + ins.manifest.icons.join(", "),
                  "");
    } else if (ins.manifestError) {
      html += row("Manifest", ins.manifestError, "bad");
    }
    html += '</table>';
    if (!installed) {
      var why = NS.Install.reasons();
      if (NS.Install.available()) {
        html += '<button id="insGo">Install to the home screen</button>';
        html += '<div class="sub">This is the same thing as the browser’s own ' +
                '"Install app" or "Add to Home Screen". Afterwards, launch it from ' +
                'the home screen icon rather than the browser.</div>';
      } else if (why.length) {
        html += '<div class="sub bad">The browser is not offering to install this. ' +
                'As far as the page can tell:</div><ul>';
        why.forEach(function (w) { html += '<li>' + w + '</li>'; });
        html += '</ul>';
      } else {
        html += '<div class="sub warn">The browser has not offered an install prompt, ' +
                'and nothing obvious is wrong. It may already be installed, or this ' +
                'browser may simply not support it &mdash; on a signage panel, Fully ' +
                'Kiosk Browser is the better route anyway (BUILD-SPEC section 14).</div>';
      }
      html += '<div class="sub">Installing is what gets persistent storage granted. ' +
              'Until then Android may evict the coupon stock.</div>';
    }
    html += '<div id="insMsg" class="note"></div>';

    /* --- storage ------------------------------------------------ */
    html += '<h3>STORAGE</h3><table>';
    html += row("localStorage", Store.available ? "available" : "UNAVAILABLE",
                verdict(Store.available));
    html += row("navigator.storage.persisted()",
                Store.persisted === true ? "true"
                  : Store.persisted === false ? "FALSE &mdash; data may be evicted"
                  : String(Store.persisted),
                verdict(Store.persisted === true, Store.persisted === "unsupported"));
    html += row("Estimated usage", NS.usageText || "measuring...");
    html += row("Last storage error", Store.lastError || "none",
                Store.lastError ? "bad" : "");
    html += row("Keys in use", Store.keys().length ? Store.keys().join(", ") : "none yet");
    html += '</table>';

    /* --- device ------------------------------------------------- */
    html += '<h3>DEVICE</h3><table>';
    html += row("Device date", NS.localDate(now) + "  " + now.toTimeString().slice(0, 8));
    html += row("Timezone offset", (-now.getTimezoneOffset() / 60) + " h");
    html += row("Viewport", window.innerWidth + " x " + window.innerHeight +
                "  (dpr " + (window.devicePixelRatio || 1) + ")");
    html += row("Stage", Math.round(m.w) + " x " + Math.round(m.h) +
                " at scale " + m.scale.toFixed(4),
                verdict(Math.abs(m.scale - 1) < 0.001, true));
    html += row("Display mode", standalone ? "standalone (installed)" : "browser tab",
                verdict(standalone, true));
    html += row("User agent", navigator.userAgent);
    html += '</table>';

    /* --- spin (stage 3) ----------------------------------------- */
    var st = NS.Spin.stats;
    html += '<h3>SPIN</h3><table>';
    if (st.spins === 0) {
      html += row("Spins this session", "none yet &mdash; press SPIN, then reopen this panel", "warn");
    } else {
      html += row("Spins this session", st.spins);
      html += row("Last spin", st.lastMs + " ms over " + st.frames + " frames");
      html += row("Average frame rate", st.avgFps + " fps",
                  verdict(st.avgFps >= 50, st.avgFps >= 40));
      html += row("Worst frame", st.minFps + " fps",
                  verdict(st.minFps >= 50, st.minFps >= 30));
      html += row("Dividers passed", st.dividersPassed +
                  "  (expect about " + (NS.SPIN.turns * NS.SEGMENTS.length) + ")",
                  verdict(st.dividersPassed >= NS.SPIN.turns * NS.SEGMENTS.length));
      html += row("Stopped this far from a divider", st.lastDistToDivider.toFixed(2) + "&deg;",
                  verdict(st.lastDistToDivider >= 5));
    }
    html += row("Audio context", NS.Audio.state + (NS.Audio.enabled ? "" : " (muted)"),
                verdict(NS.Audio.state === "running", NS.Audio.state === "not started"));
    html += '</table>';

    /* --- odds ---------------------------------------------------- */
    var w = NS.weights();
    var wTotal = 0, i2;
    for (i2 = 0; i2 < w.weights.length; i2++) wTotal += w.weights[i2];
    html += '<h3>ODDS IN EFFECT</h3>';
    if (w.placeholder) {
      html += '<div class="sub bad">PLACEHOLDER ODDS &mdash; uniform across all eight ' +
              'segments, because stock and probabilities have not been entered above. ' +
              'Nothing has been invented to stand in for them.</div>';
    } else {
      html += '<div class="sub ok">Live. Weighted by what is actually left today: a ' +
              'tier with nothing left drops to zero and its share moves to Hard Luck.</div>';
    }
    html += '<div class="sub">Segment width was driven by label length, not prize value. ' +
            'Both columns are shown so the gap between them is always visible.</div>';
    html += '<table><tr><td>segment</td><td>share of wheel &nbsp; / &nbsp; odds</td></tr>';
    NS.SEGMENTS.forEach(function (seg, i) {
      html += row(seg.short,
                  (seg.span / 360 * 100).toFixed(1) + "% of wheel &nbsp;&nbsp; " +
                  '<span class="warn">' + (w.weights[i] / wTotal * 100).toFixed(1) + "% odds</span>");
    });
    html += '</table>';

    /* --- winners log (section 12) -------------------------------- */
    var log = NS.Inventory.log();
    var unackToday = NS.Inventory.unacknowledged(NS.Inventory.today());
    var unackAll = NS.Inventory.unacknowledged();
    html += '<h3>WINNERS LOG</h3>';
    html += '<table><tr><td>Coupons not confirmed handed over, today</td>' +
            '<td class="' + (unackToday ? "bad" : "ok") + '">' + unackToday + '</td></tr>' +
            '<tr><td>...across the whole event</td>' +
            '<td class="' + (unackAll ? "warn" : "ok") + '">' + unackAll + '</td></tr></table>';
    if (unackToday) {
      html += '<div class="sub bad">A win is only marked handed over when staff ' +
              'hold the confirm button on the result screen. Anything counted ' +
              'here was issued by the wheel but never confirmed &mdash; either ' +
              'the screen was left to time out, or the coupon did not reach ' +
              'anybody.</div>';
    }
    html += '<div class="sub">' + log.length + ' spins recorded. Newest first, ' +
            'last 25 shown. The full log is in the export.</div>';
    if (log.length) {
      html += '<table class="grid"><tr><td>time</td><td>tier</td><td>result</td>' +
              '<td>reference</td><td>handed over</td></tr>';
      var shown = log.slice(-25).reverse();
      for (var li = 0; li < shown.length; li++) {
        var e = shown[li];
        var when = new Date(e.t);
        html += '<tr><td class="muted">' + NS.localDate(when) + " " +
                when.toTimeString().slice(0, 5) + '</td>' +
                '<td>' + (e.prize || e.seg) + (e.test ? ' <span class="warn">TEST</span>' : '') + '</td>' +
                '<td class="' + (e.win ? "ok" : "muted") + '">' +
                (e.win ? "win" : "hard luck") + '</td>' +
                '<td>' + (e.ref || "&mdash;") + '</td>' +
                '<td class="' + (e.win && !e.test ? (e.ack ? "ok" : "bad") : "muted") + '">' +
                (!e.win || e.test ? "&mdash;" : (e.ack ? "yes" : "NOT CONFIRMED")) +
                '</td></tr>';
      }
      html += '</table>';
    }

    /* --- backup (section 3, section 12, stage 9) ------------------ */
    html += '<h3>BACKUP AND RESTORE</h3>';
    html += '<div class="sub">Everything on one device is a single point of ' +
            'failure. Export at every break. If the download is blocked, the ' +
            'text below it can be selected and pasted somewhere instead.</div>';
    html += '<button id="expJson">Export everything (JSON)</button>';
    html += '<button id="expCsv">Export the log (CSV)</button>';
    if (exportKind) {
      html += '<div class="sub">' + (exportKind === "json"
        ? "Full state. This is what restores a backup panel."
        : "Winners log only, for reconciling coupons afterwards.") + '</div>';
      html += '<textarea id="expText" readonly rows="8"></textarea>';
      html += '<button id="expSelect">Select all</button>';
    }
    html += '<div class="sub" style="margin-top:14px">Restore onto this panel. ' +
            'This REPLACES everything currently stored.</div>';
    html += '<input type="file" id="impFile" accept=".json,application/json">';
    html += '<textarea id="impText" rows="5" placeholder="...or paste an export here"></textarea>';
    html += '<button id="impGo">Import and replace</button>';
    html += '<div id="impMsg" class="note"></div>';

    /* --- tests (section 17.11) ----------------------------------- */
    html += '<h3>TESTS</h3>';
    html += '<div class="sub">These run here, on this panel, against the code ' +
            'that is actually installed. That is the point &mdash; a check on a ' +
            'developer machine cannot answer whether THIS WebView agrees.</div>';
    html += '<button id="tRun">Run all tests</button>';
    html += '<button id="tRunHeavy">Run all, 200,000 draws</button>';
    if (testResults) {
      html += '<div class="sub ' + (testResults.failed === 0 ? "ok" : "bad") + '">' +
              (testResults.failed === 0
                ? "All " + testResults.total + " checks passed"
                : testResults.failed + " of " + testResults.total + " checks FAILED") +
              " in " + testResults.ms + " ms</div>";
      for (var si = 0; si < testResults.suites.length; si++) {
        var suite = testResults.suites[si];
        html += '<table class="grid"><tr><td colspan="2">' + suite.name + '</td></tr>';
        for (var ri = 0; ri < suite.rows.length; ri++) {
          // NOT `row`: that is the name of the helper at the top of this
          // file, and `var` hoists to the whole function, so declaring it
          // here shadows the helper for every earlier call in render().
          var tr = suite.rows[ri];
          html += '<tr><td>' + (tr.pass ? '<span class="ok">PASS</span>'
                                        : '<span class="bad">FAIL</span>') +
                  " " + tr.name + '</td><td class="muted">' + tr.detail + '</td></tr>';
        }
        html += '</table>';
      }
    }

    /* --- what is still unset ------------------------------------ */
    var gaps = NS.missingConfig();
    html += '<h3>STILL NEEDED BEFORE A LIVE EVENT</h3>';
    if (gaps.length) {
      html += '<div class="sub">Enter these in the sections above. Until they are ' +
              'set the app shows SETUP REQUIRED rather than inventing numbers.</div><ul>';
      for (var i = 0; i < gaps.length; i++) html += '<li>' + gaps[i] + '</li>';
      html += '</ul>';
    } else {
      html += '<div class="sub ok">All supplied.</div>';
    }

    /* --- actions ------------------------------------------------ */
    html += '<h3>ACTIONS</h3>';
    html += '<button id="diagRefresh">Refresh readings</button>';
    html += '<button id="diagPersist">Request persistent storage</button>';
    html += '<button id="diagUpdate">Check for update</button>';
    html += '<button id="diagWipe">Full reset &mdash; erase everything</button>';
    if (SW.updateReady) {
      html += '<button id="diagApply">Install held update and reload</button>';
    }
    html += '<div id="diagMsg" class="note"></div>';
    html += '<div class="note">To confirm stage 1: turn on airplane mode, close the app ' +
            'completely, reopen it. It must render, and this panel must still report ' +
            'the shell cache complete and persisted() true.</div>';

    body.innerHTML = html;
    wire();
  }

  function impMsg(text, cls) {
    var n = document.getElementById("impMsg");
    if (n) { n.textContent = text; n.className = "note " + (cls || ""); }
  }

  function msg(text, cls) {
    var n = document.getElementById("diagMsg");
    if (n) { n.textContent = text; n.className = "note " + (cls || ""); }
  }

  function wireAuth() {
    var go = document.getElementById("authGo");
    var msg = document.getElementById("authMsg");
    document.getElementById("diagClose").onclick = close;
    function attempt() {
      var u = document.getElementById("authUser").value;
      var p2 = document.getElementById("authPass").value;
      if (NS.Auth.attempt(u, p2)) { render(); return; }
      msg.textContent = "Not recognised.";
      msg.className = "note bad";
      document.getElementById("authPass").value = "";
    }
    if (go) go.onclick = attempt;
    var pw = document.getElementById("authPass");
    if (pw) {
      pw.onkeydown = function (e) { if (e.keyCode === 13) attempt(); };
    }
  }

  function wire() {
    NS.Admin.wire(render);
    document.getElementById("diagClose").onclick = close;

    var ins = document.getElementById("insGo");
    if (ins) ins.onclick = function () {
      NS.Install.prompt(function (r) {
        var n = document.getElementById("insMsg");
        if (n) { n.textContent = r.message; n.className = "note " + (r.ok ? "ok" : "bad"); }
        setTimeout(render, 1200);
      });
    };

    var out = document.getElementById("authOut");
    if (out) out.onclick = function () { NS.Auth.logout(); render(); };

    // any interaction keeps the session alive
    if (panel && !panel._touchBound) {
      panel.addEventListener("click", function () { NS.Auth.touch(); }, true);
      panel.addEventListener("input", function () { NS.Auth.touch(); }, true);
      panel._touchBound = true;
    }

    document.getElementById("tRun").onclick = function () {
      testResults = NS.Tests.runAll(false); render();
    };
    document.getElementById("tRunHeavy").onclick = function () {
      testResults = NS.Tests.runAll(true); render();
    };

    document.getElementById("expJson").onclick = function () {
      exportKind = "json"; render();
      var text = NS.Backup.toJSON();
      document.getElementById("expText").value = text;
      NS.Backup.download("jph-wheel-" + NS.Backup.stamp() + ".json", text, "application/json");
    };
    document.getElementById("expCsv").onclick = function () {
      exportKind = "csv"; render();
      var text = NS.Backup.toCSV();
      document.getElementById("expText").value = text;
      NS.Backup.download("jph-wheel-log-" + NS.Backup.stamp() + ".csv", text, "text/csv");
    };
    var sel = document.getElementById("expSelect");
    if (sel) sel.onclick = function () {
      var ta = document.getElementById("expText");
      ta.focus(); ta.select();
    };

    var file = document.getElementById("impFile");
    if (file) file.onchange = function () {
      var f = file.files && file.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        document.getElementById("impText").value = String(fr.result);
        impMsg("File read. Press Import and replace to apply it.", "");
      };
      fr.onerror = function () { impMsg("Could not read that file.", "bad"); };
      fr.readAsText(f);
    };
    document.getElementById("impGo").onclick = function () {
      var text = document.getElementById("impText").value;
      if (!text) { impMsg("Nothing to import.", "warn"); return; }
      var peek;
      try { peek = JSON.parse(text); } catch (e) {
        impMsg("That is not valid JSON.", "bad"); return;
      }
      var bad = NS.Backup.validate(peek);
      if (bad) { impMsg(bad, "bad"); return; }
      var sum = NS.Backup.summarise(peek);
      if (!window.confirm(
            "Replace everything on this panel with that export?\n\n" +
            "Exported: " + sum.exportedAt + "\n" +
            "Spins: " + sum.spins + " (" + sum.wins + " wins)\n" +
            "Event dates: " + (sum.dates ? sum.dates.join(", ") : "none") + "\n\n" +
            "This cannot be undone.")) return;
      var r = NS.Backup.apply(peek);
      impMsg(r.message, r.ok ? "ok" : "bad");
      if (r.ok) { testResults = null; render(); }
    };

    document.getElementById("diagWipe").onclick = function () {
      if (!window.confirm("Erase ALL stock, odds, dates, settings and the winners " +
                          "log from this panel?\n\nThis cannot be undone. Export " +
                          "first if you have not.")) return;
      if (!window.confirm("Really erase everything?")) return;
      NS.Backup.wipe();
      NS.Auth.logout();
      render();
    };
    document.getElementById("diagRefresh").onclick = refresh;
    document.getElementById("diagPersist").onclick = function () {
      NS.Store.requestPersist(function (r) {
        msg("persisted() is now: " + r, r === true ? "ok" : "warn");
        refresh();
      });
    };
    document.getElementById("diagUpdate").onclick = function () {
      msg("Checking...");
      NS.SW.checkForUpdate(function (r) { msg(r.message, r.ok ? "" : "bad"); render(); });
    };
    var ap = document.getElementById("diagApply");
    if (ap) {
      ap.onclick = function () {
        msg("Installing. The app will reload.");
        if (!NS.SW.applyUpdate()) msg("No update was waiting.", "bad");
      };
    }
  }

  function refresh() {
    NS.Store.estimate(function (est) {
      NS.usageText = est
        ? NS.bytes(est.usage) + " of " + NS.bytes(est.quota)
        : "not reported";
      askPrecache(function (p) { precache = p; render(); });
    });
  }

  function open() {
    if (!panel) return;
    panel.classList.add("open");
    NS.Auth.touch();
    refresh();
  }

  function close() { if (panel) panel.classList.remove("open"); }

  /* ---- hidden gesture: 3-second press, bottom-left corner ------- */
  function bindGesture() {
    var corner = document.getElementById("adminCorner");
    if (!corner) return;

    function start() {
      if (pressTimer) return;
      pressTimer = setTimeout(function () {
        pressTimer = null;
        open();
      }, NS.TIMING.adminLongPressMs);
    }
    function cancel() {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    }

    corner.addEventListener("touchstart", start, false);
    corner.addEventListener("touchend", cancel, false);
    corner.addEventListener("touchcancel", cancel, false);
    corner.addEventListener("touchmove", cancel, false);
    corner.addEventListener("mousedown", start, false);
    corner.addEventListener("mouseup", cancel, false);
    corner.addEventListener("mouseleave", cancel, false);
    corner.addEventListener("contextmenu", function (e) { e.preventDefault(); }, false);

    /* The second gesture section 12 allows: five taps on the hub. The hub
       is 124px across in the middle of the wheel, so an attendee reaching
       for the wheel cannot land five of them by accident, and the count
       resets after a second and a half of no taps. */
    var hub = document.getElementById("hub");
    if (!hub) return;
    hub.addEventListener("click", function (e) {
      e.stopPropagation();
      hubTaps++;
      if (hubTimer) clearTimeout(hubTimer);
      hubTimer = setTimeout(function () { hubTaps = 0; }, 1500);
      if (hubTaps >= 5) { hubTaps = 0; open(); }
    }, false);
  }

  NS.Diagnostics = {
    init: function () {
      panel = document.getElementById("diag");
      body  = document.getElementById("diagBody");
      bindGesture();
    },
    open: open,
    close: close
  };
})(window.JPH = window.JPH || {});
