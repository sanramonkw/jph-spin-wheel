/* ------------------------------------------------------------------
   admin.js — the editable half of the staff panel (BUILD-SPEC §12).

   Quantities, win probabilities, event dates and coupon terms are
   entered here rather than baked into the build, so the client's
   numbers can land on site without a redeploy. Everything saves to
   localStorage and overrides the build-time defaults in config.js;
   "reset to defaults" puts them back.

   Stage 8 wraps this in auth and adds the winners log, export/import
   and undo. The auth is not security and never will be — client-side
   credentials are readable in page source. It keeps attendees out,
   which is the actual threat model.
------------------------------------------------------------------ */
(function (NS) {
  "use strict";

  /* The Save message has to live in module state. say() writes it into the
     DOM, but save() re-renders immediately afterwards and body.innerHTML
     wipes the element — so pressing Save showed nothing at all, success or
     failure. render() reprints it from here instead. */
  var lastMsg = null;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function num(id, value, min, max, step) {
    var v = (value == null ? "" : value);
    // data-orig records what was rendered, so Save can tell an edit from a
    // value that was merely on screen. See the restock loop in save().
    return '<input type="number" id="' + id + '" value="' + esc(v) +
           '" data-orig="' + esc(v) + '"' +
           ' min="' + min + '" max="' + max + '" step="' + (step || 1) + '" inputmode="numeric">';
  }
  function txt(id, value, ph) {
    return '<input type="text" id="' + id + '" value="' + esc(value) +
           '" placeholder="' + esc(ph || "") + '">';
  }

  function prizeIds() {
    var out = [], id;
    for (id in NS.PRIZES) {
      if (Object.prototype.hasOwnProperty.call(NS.PRIZES, id)) out.push(id);
    }
    return out;
  }

  /* ---- render ---------------------------------------------------- */
  function render() {
    var c = NS.Inventory.config();
    var set = NS.Inventory.settings();
    var day = NS.Inventory.dayIndex();
    var ids = prizeIds();
    var html = "";

    /* --- which day is it ---------------------------------------- */
    html += '<h3>DAY AND DATE</h3>';
    if (set.dateOverride) {
      html += '<div class="sub bad">DATE OVERRIDE ACTIVE &mdash; the app believes it is ' +
              esc(set.dateOverride) + '. Clear this before the event runs.</div>';
    }
    html += '<table>';
    html += '<tr><td>Real device date</td><td>' + NS.localDate(new Date()) + '</td></tr>';
    html += '<tr><td>Date the app is using</td><td class="' +
            (set.dateOverride ? "bad" : "ok") + '">' + NS.Inventory.today() + '</td></tr>';
    html += '<tr><td>Active day</td><td class="' +
            (day !== null && day >= 0 && day <= 2 ? "ok" : "warn") + '">' +
            NS.Inventory.dayLabel() + '</td></tr>';
    html += '<tr><td>Pretend today is</td><td>' +
            '<input type="date" id="admDate" value="' + esc(set.dateOverride || "") + '"> ' +
            '<button id="admDateSet">Use</button> ' +
            '<button id="admDateClear">Clear</button></td></tr>';
    html += '</table>';
    html += '<div class="sub">The override exists so the day-2 and day-3 rollover can be ' +
            'tested without waiting three real days. Without it that logic would ship ' +
            'untested and fail on day two.</div>';

    /* --- remaining now ------------------------------------------ */
    html += '<h3>REMAINING NOW</h3>';
    html += '<div class="sub">Live stock. Editing these is the manual restock. ' +
            'Today is highlighted.</div>';
    html += '<table class="grid"><tr><td>tier</td><td>day 1</td><td>day 2</td><td>day 3</td></tr>';
    ids.forEach(function (id) {
      html += '<tr><td>' + esc(c.prizes[id].label) + '</td>';
      for (var d = 0; d < 3; d++) {
        html += '<td class="' + (d === day ? "today" : "") + '">' +
                num("rem-" + id + "-" + d, NS.Inventory.remaining(id, d), 0, 99999) + '</td>';
      }
      html += '</tr>';
    });
    html += '</table>';
    html += '<button id="admPull">Pull tomorrow’s allocation forward</button>';
    html += '<button id="admCarry">Carry yesterday’s leftovers into today</button>';
    html += '<button id="admUndo">Undo last spin</button>';
    var stranded = NS.Inventory.strandedBefore();
    if (stranded > 0) {
      html += '<div class="sub warn">' + stranded + ' coupon(s) are sitting in days ' +
              'that have already passed. Each day draws only from its own bucket, so ' +
              'those cannot be won any more unless they are carried into today.</div>';
    }

    /* --- planned allocation ------------------------------------- */
    html += '<h3>PLANNED ALLOCATION</h3>';
    html += '<div class="sub">How the total splits across the three days. Changing a ' +
            'FUTURE day re-seeds it; today and past days only move through a spin or ' +
            'a manual restock above.</div>';
    html += '<table class="grid"><tr><td>tier</td><td>day 1</td><td>day 2</td><td>day 3</td><td>total</td></tr>';
    ids.forEach(function (id) {
      var ds = c.prizes[id].dailyStock || [null, null, null];
      var tot = (ds[0] || 0) + (ds[1] || 0) + (ds[2] || 0);
      html += '<tr><td>' + esc(c.prizes[id].label) + '</td>';
      for (var d = 0; d < 3; d++) html += '<td>' + num("stk-" + id + "-" + d, ds[d], 0, 99999) + '</td>';
      html += '<td class="muted">' + (c.prizes[id].dailyStock ? tot : "&mdash;") + '</td></tr>';
    });
    html += '</table>';

    /* --- odds ---------------------------------------------------- */
    html += '<h3>WIN PROBABILITY</h3>';
    html += '<div class="sub">Per tier, as a percentage of all spins. This is ' +
            'INDEPENDENT of how wide the wedge is &mdash; the widths were driven by ' +
            'label length, so the most expensive prize has the largest wedge. Both ' +
            'numbers are shown so the gap is always visible.</div>';
    html += '<table class="grid"><tr><td>tier</td><td>odds %</td><td>wedge is</td></tr>';
    var wsum = 0;
    ids.forEach(function (id) {
      var seg = null;
      NS.SEGMENTS.forEach(function (s) { if (s.prize === id) seg = s; });
      var wpc = c.prizes[id].weight == null ? null : c.prizes[id].weight * 100;
      if (wpc != null) wsum += wpc;
      html += '<tr><td>' + esc(c.prizes[id].label) + '</td>' +
              '<td>' + num("w-" + id, wpc == null ? "" : Math.round(wpc * 100) / 100, 0, 100, 0.01) + '</td>' +
              '<td class="muted">' + (seg ? (seg.span / 360 * 100).toFixed(1) : "?") + '% of the wheel</td></tr>';
    });
    html += '<tr><td>Hard Luck (the remainder)</td><td class="' +
            (wsum > 100 ? "bad" : "warn") + '" id="admLoss">' +
            (100 - wsum).toFixed(2) + '%</td>' +
            '<td class="muted">27.2% of the wheel</td></tr>';
    html += '</table>';
    if (wsum > 100) {
      html += '<div class="sub bad">The tier percentages add up to more than 100. ' +
              'Fix before saving.</div>';
    }

    /* --- event --------------------------------------------------- */
    html += '<h3>EVENT</h3>';
    html += '<div class="sub">Daily buckets roll over by these dates, not by elapsed ' +
            'time. If they are wrong or the device clock is wrong, day 2 stock never ' +
            'releases.</div>';
    html += '<table>';
    for (var d = 0; d < 3; d++) {
      var dv = (c.event.dates && c.event.dates[d]) || "";
      html += '<tr><td>Day ' + (d + 1) + '</td><td>' +
              '<input type="date" id="ev-' + d + '" value="' + esc(dv) + '"></td></tr>';
    }
    html += '<tr><td>Opening time</td><td>' +
            txt("ev-open", c.event.openingTime || "", "e.g. 10am") + '</td></tr>';
    html += '</table>';

    /* --- fulfilment ---------------------------------------------- */
    var physical = NS.FULFILMENT.mode !== "code";
    html += '<h3>HOW THE COUPON IS GIVEN OUT</h3>';
    html += '<div class="sub">Client decision 2026-09-22: handed over physically ' +
            'at the counter, so there is nothing to encode. Switch to codes only ' +
            'if that changes &mdash; the QR generator is built in and works ' +
            'offline either way.</div>';
    html += '<table><tr><td>Mode</td><td>' +
            '<label><input type="radio" name="ful" id="fulPhysical"' +
            (physical ? " checked" : "") +
            '> physical &mdash; show a reference number to read out at the counter</label>' +
            '<label><input type="radio" name="ful" id="fulCode"' +
            (!physical ? " checked" : "") +
            '> code &mdash; show a coupon code and a scannable QR</label>' +
            '</td></tr></table>';
    if (physical) {
      html += '<div class="sub">The reference is the count of wins so far that ' +
              'day (D1-0042), so it can be checked against the winners log. ' +
              'Without something on screen there is nothing to tell a fresh win ' +
              'from a screenshot shown twice.</div>';
    }

    /* --- terms --------------------------------------------------- */
    html += '<h3>COUPON TERMS</h3>';
    html += '<div class="sub">Shown on the win popup. A physical coupon still ' +
            'carries terms. The code column is only used in code mode; leave it ' +
            'empty and the reference number is used instead.</div>';
    html += '<table class="grid"><tr><td>tier</td><td>valid until</td><td>redeem at</td><td>one per<br>customer</td><td>code</td></tr>';
    ids.forEach(function (id) {
      var t = c.prizes[id].terms || {};
      html += '<tr><td>' + esc(c.prizes[id].label) + '</td>' +
              '<td><input type="date" id="tv-' + id + '" value="' + esc(t.validUntil || "") + '"></td>' +
              '<td>' + txt("tr-" + id, t.redeemAt || "", "e.g. the counter") + '</td>' +
              '<td><input type="checkbox" id="to-' + id + '"' + (t.onePerCustomer ? " checked" : "") + '></td>' +
              '<td>' + txt("cc-" + id, c.prizes[id].code || "", "optional") + '</td></tr>';
    });
    html += '</table>';

    /* --- behaviour ----------------------------------------------- */
    html += '<h3>BEHAVIOUR</h3><table>';
    html += '<tr><td>When today’s stock runs out</td><td>' +
            '<label><input type="radio" name="eod" id="eodContinue"' +
            (set.endOfDayMode === "continue" ? " checked" : "") +
            '> keep spinning, every outcome is Hard Luck</label>' +
            '<label><input type="radio" name="eod" id="eodStop"' +
            (set.endOfDayMode === "stop" ? " checked" : "") +
            '> show the end-of-day screen instead</label></td></tr>';
    html += '<tr><td>Hard-luck screen</td><td>' +
            '<label><input type="radio" name="dis" id="disHold"' +
            (NS.TIMING.loseDismissMs === 0 ? " checked" : "") +
            '> stays until somebody touches it</label>' +
            '<label><input type="radio" name="dis" id="disAuto"' +
            (NS.TIMING.loseDismissMs > 0 ? " checked" : "") +
            '> clears itself after 7 seconds</label>' +
            '<div class="sub">A WIN is not affected either way. It never times ' +
            'out and a stray tap will not clear it &mdash; staff hold the ' +
            'confirm button, and that is what marks the coupon handed over.' +
            '</div></td></tr>';
    html += '<tr><td>Character disc</td><td>' +
            '<label><input type="checkbox" id="discOn"' +
            (set.discAnim ? " checked" : "") + '> animated</label>' +
            '<label><input type="checkbox" id="discPause"' +
            (set.discPauseOnSpin ? " checked" : "") +
            '> pause it while the wheel is spinning</label>' +
            '<div class="sub">Currently: ' + NS.Wheel.disc.status() + '. Turn the ' +
            'animation off, or just pause it during a spin, if the frame rate ' +
            'in the SPIN section above drops below 50.</div></td></tr>';
    html += '<tr><td>Test mode</td><td><label><input type="checkbox" id="admTest"' +
            (set.testMode ? " checked" : "") + '> spin without consuming stock</label></td></tr>';
    html += '<tr><td>Sound</td><td><label><input type="checkbox" id="admSound"' +
            (set.sound ? " checked" : "") + '> tick and result sounds</label>' +
            '<button id="sndWin">Hear the win sound</button>' +
            '<button id="sndLose">Hear the hard-luck sound</button>' +
            '<button id="sndTick">Hear a tick</button></td></tr>';
    html += '</table>';
    if (set.testMode) {
      html += '<div class="sub bad">TEST MODE IS ON &mdash; spins are not consuming ' +
              'stock and are flagged in the log. Turn this off before the event runs.</div>';
    }

    /* --- save ---------------------------------------------------- */
    html += '<h3>SAVE</h3>';
    html += '<button id="admSave">Save all of the above</button>';
    html += '<button id="admReset">Reset to build defaults</button>';
    html += '<div id="admMsg" class="note ' + (lastMsg ? lastMsg.cls : "") + '">' +
            (lastMsg ? esc(lastMsg.text) : "") + '</div>';

    return html;
  }

  /* ---- read the form back ---------------------------------------- */
  function v(id) {
    var el = document.getElementById(id);
    return el ? el.value : "";
  }
  function n(id) {
    var s = v(id);
    if (s === "") return null;
    var x = parseFloat(s);
    return isNaN(x) ? null : x;
  }
  function checked(id) {
    var el = document.getElementById(id);
    return !!(el && el.checked);
  }

  function say(text, cls) {
    lastMsg = text ? { text: text, cls: cls || "" } : null;
    var el = document.getElementById("admMsg");
    if (el) { el.textContent = text || ""; el.className = "note " + (cls || ""); }
  }

  function save(rerender) {
    var ids = prizeIds();
    var next = { prizes: {}, event: {} };
    var i, d, wsum = 0, problems = [];

    for (i = 0; i < ids.length; i++) {
      var id = ids[i];
      /* A blank day box means "none that day", not "throw this tier away".
         Requiring all three to be filled silently discarded a tier when
         somebody filled only day 1, which reads exactly like the settings
         not saving. Only a tier with all three blank stays unset. */
      var ds = [], anyStock = false;
      for (d = 0; d < 3; d++) {
        var q = n("stk-" + id + "-" + d);
        if (q !== null) anyStock = true;
        ds.push(q === null ? 0 : Math.max(0, Math.round(q)));
      }
      var w = n("w-" + id);
      if (w !== null) wsum += w;

      var terms = null;
      var tv = v("tv-" + id), tr = v("tr-" + id);
      if (tv || tr || checked("to-" + id)) {
        terms = { validUntil: tv || null, redeemAt: tr || null,
                  onePerCustomer: checked("to-" + id) };
      }

      next.prizes[id] = {
        dailyStock: anyStock ? ds : null,
        weight: w === null ? null : w / 100,
        terms: terms,
        code: v("cc-" + id) || null
      };
    }

    var dates = [];
    for (d = 0; d < 3; d++) dates.push(v("ev-" + d) || null);
    next.event = {
      dates: dates.indexOf(null) === -1 ? dates : null,
      openingTime: v("ev-open") || null
    };

    if (wsum > 100.0001) {
      problems.push("The tier percentages add up to " + wsum.toFixed(2) + "%, which leaves " +
                    "Hard Luck a negative share.");
    }
    if (next.event.dates) {
      if (!(next.event.dates[0] < next.event.dates[1] &&
            next.event.dates[1] < next.event.dates[2])) {
        problems.push("The three event dates must be in ascending order.");
      }
    }
    if (problems.length) { say(problems.join("  "), "bad"); return false; }

    NS.Inventory.saveConfig(next);

    /* Live remaining, edited directly, is the manual restock.

       Only fields the user actually CHANGED are applied. Re-applying
       every displayed value would stomp the stock that saveConfig just
       seeded: these inputs were rendered before the allocation existed,
       so they all read 0, and saving would zero the whole event. */
    for (i = 0; i < ids.length; i++) {
      for (d = 0; d < 3; d++) {
        var fid = "rem-" + ids[i] + "-" + d;
        var el = document.getElementById(fid);
        if (!el) continue;
        if (el.value === el.getAttribute("data-orig")) continue;   // untouched
        var r = n(fid);
        if (r !== null) NS.Inventory.restock(ids[i], d, Math.round(r));
      }
    }

    NS.Inventory.saveSettings({
      autoDismiss: checked("disAuto"),
      discAnim: checked("discOn"),
      discPauseOnSpin: checked("discPause"),
      endOfDayMode: checked("eodStop") ? "stop" : "continue",
      testMode: checked("admTest"),
      sound: checked("admSound"),
      fulfilment: checked("fulCode") ? "code" : "physical"
    });
    NS.FULFILMENT.mode = checked("fulCode") ? "code" : "physical";
    NS.Audio.enabled = checked("admSound");
    NS.applyDismissSetting(checked("disAuto"));
    NS.Wheel.disc.set(checked("discOn"), checked("discPause"));

    if (!NS.Inventory.isConfigured()) {
      say("Saved, but still incomplete: " + NS.Inventory.missing().join("; "), "warn");
    } else {
      var day = NS.Inventory.dayIndex();
      if (day === null || day < 0 || day > 2) {
        say("Saved. But the app thinks it is " + NS.Inventory.today() + ", which is " +
            NS.Inventory.dayLabel() + " — so nothing will be given away. Set " +
            "“Pretend today is” to one of the event dates to try it now.", "warn");
      } else {
        say("Saved. Configured and live on " + NS.Inventory.dayLabel() + ".", "ok");
      }
    }
    if (rerender) rerender();
    return true;
  }

  /* ---- wire ------------------------------------------------------ */
  function wire(rerender) {
    var el;

    el = document.getElementById("admSave");
    if (el) el.onclick = function () { save(rerender); };

    el = document.getElementById("admReset");
    if (el) el.onclick = function () {
      if (!window.confirm("Reset all stock, odds, dates and terms to the build defaults? " +
                          "This clears everything entered here.")) return;
      NS.Inventory.resetConfig();
      rerender();
    };

    el = document.getElementById("admDateSet");
    if (el) el.onclick = function () {
      var d = v("admDate");
      if (!d) { say("Pick a date first.", "warn"); return; }
      NS.Inventory.saveSettings({ dateOverride: d });
      rerender();
    };

    el = document.getElementById("admDateClear");
    if (el) el.onclick = function () {
      NS.Inventory.saveSettings({ dateOverride: null });
      rerender();
    };

    el = document.getElementById("admPull");
    if (el) el.onclick = function () {
      var moved = NS.Inventory.pullForward();
      if (moved === false) say("Nothing to pull forward from here.", "warn");
      else say("Moved " + moved + " coupons forward into today.", "ok");
      rerender();
    };

    el = document.getElementById("admCarry");
    if (el) el.onclick = function () {
      var moved = NS.Inventory.carryForward();
      if (moved === false) say("There is no earlier day to carry from.", "warn");
      else if (moved === 0) say("Nothing left over from earlier days.", "warn");
      else say("Carried " + moved + " coupon(s) from earlier days into today. " +
               "Undo by editing the numbers above.", "ok");
      rerender();
    };

    el = document.getElementById("admUndo");
    if (el) el.onclick = function () {
      var e = NS.Inventory.undoLast();
      if (!e) say("Nothing in the log to undo.", "warn");
      else say("Undid: " + e.seg + (e.win ? " (coupon returned to stock)" : ""), "ok");
      rerender();
    };

    el = document.getElementById("sndWin");
    if (el) el.onclick = function () { NS.Audio.preview("win"); };
    el = document.getElementById("sndLose");
    if (el) el.onclick = function () { NS.Audio.preview("lose"); };
    el = document.getElementById("sndTick");
    if (el) el.onclick = function () { NS.Audio.preview("tick"); };

    // live Hard Luck remainder as the odds are typed
    prizeIds().forEach(function (id) {
      var inp = document.getElementById("w-" + id);
      if (!inp) return;
      inp.addEventListener("input", function () {
        var sum = 0;
        prizeIds().forEach(function (k) {
          var x = parseFloat(v("w-" + k));
          if (!isNaN(x)) sum += x;
        });
        var out = document.getElementById("admLoss");
        if (out) {
          out.textContent = (100 - sum).toFixed(2) + "%";
          out.className = sum > 100 ? "bad" : "warn";
        }
      }, false);
    });
  }

  NS.Admin = { render: render, wire: wire, save: save };
})(window.JPH = window.JPH || {});
