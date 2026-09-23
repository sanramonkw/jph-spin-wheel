/* ------------------------------------------------------------------
   inventory.js — prize stock, daily buckets, persistence (BUILD-SPEC §8).

   Quantities, win probabilities and terms are NOT baked in. They are
   entered by staff in the admin panel and stored in localStorage, with
   js/config.js supplying build-time defaults where any exist. Admin
   values always win; "reset to defaults" puts them back.

   Daily buckets roll over BY DATE, never by elapsed time. There is no
   migration step: each day simply has its own bucket and the active one
   is chosen by today's date. Unclaimed stock does not carry over — if
   staff want it early they pull it forward explicitly.

   THE DEVICE CLOCK IS LOAD-BEARING. If the panel's date is wrong, day 2
   stock never releases. The admin panel shows the date the app believes
   it is, and carries a date override so rollover can be tested without
   waiting three real days.
------------------------------------------------------------------ */
(function (NS) {
  "use strict";

  var K_CONFIG = "config", K_INV = "inventory", K_LOG = "log", K_SET = "settings";

  var Inv = {
    changed: null           // callback, fired whenever stock or config moves
  };

  /* ---- settings -------------------------------------------------- */
  var DEFAULT_SETTINGS = {
    dateOverride: null,     // "YYYY-MM-DD" — obviously flagged while active
    endOfDayMode: "continue", // "continue" | "stop"  (§8, default off)
    testMode: false,        // spin without consuming stock (§12)
    sound: true,
    fulfilment: null,       // null = use the build default in config.js
    autoDismiss: false,     // false = the result stays until touched
    discAnim: true,         // animated character disc
    discPauseOnSpin: false  // pause it during a spin if frame rate needs it
  };

  function settings() {
    var s = NS.Store.read(K_SET, null);
    var out = {}, k;
    for (k in DEFAULT_SETTINGS) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, k)) {
        out[k] = (s && s[k] !== undefined) ? s[k] : DEFAULT_SETTINGS[k];
      }
    }
    return out;
  }
  Inv.settings = settings;
  Inv.saveSettings = function (patch) {
    var s = settings(), k;
    for (k in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) s[k] = patch[k];
    }
    NS.Store.write(K_SET, s);
    if (Inv.changed) Inv.changed();
    return s;
  };

  /* ---- config ----------------------------------------------------
     Shape:
       { prizes: { id: { dailyStock:[n,n,n], weight, terms:{...} } },
         event:  { dates:[d,d,d], openingTime } }
     Anything absent falls back to the build-time default in config.js,
     which for this project is null for every client-supplied field. */
  function stored() { return NS.Store.read(K_CONFIG, null) || {}; }

  function config() {
    var st = stored();
    var out = { prizes: {}, event: {} }, id, d, sp;

    for (id in NS.PRIZES) {
      if (!Object.prototype.hasOwnProperty.call(NS.PRIZES, id)) continue;
      d = NS.PRIZES[id];
      sp = (st.prizes && st.prizes[id]) || {};
      out.prizes[id] = {
        id: id,
        label: d.label,
        panelName: d.panelName,
        dailyStock: sp.dailyStock || d.dailyStock,
        weight: (sp.weight !== undefined && sp.weight !== null) ? sp.weight : d.weight,
        terms: sp.terms || d.terms,
        code: sp.code || d.code || null
      };
    }
    out.event = {
      dates: (st.event && st.event.dates) || NS.EVENT.dates,
      openingTime: (st.event && st.event.openingTime) || NS.EVENT.openingTime
    };
    return out;
  }
  Inv.config = config;

  Inv.saveConfig = function (next) {
    NS.Store.write(K_CONFIG, next);
    reconcile();
    if (Inv.changed) Inv.changed();
  };

  Inv.resetConfig = function () {
    NS.Store.remove(K_CONFIG);
    NS.Store.remove(K_INV);
    reconcile();
    if (Inv.changed) Inv.changed();
  };

  /* What is still missing before this can run a real event. */
  Inv.missing = function () {
    var c = config(), gaps = [], id, p;
    if (!c.event.dates || c.event.dates.length !== 3 ||
        !c.event.dates[0] || !c.event.dates[1] || !c.event.dates[2]) {
      gaps.push("event dates (all three days)");
    }
    for (id in c.prizes) {
      if (!Object.prototype.hasOwnProperty.call(c.prizes, id)) continue;
      p = c.prizes[id];
      if (!p.dailyStock || p.dailyStock.length !== 3) gaps.push(p.label + ": daily stock");
      if (p.weight === null || p.weight === undefined) gaps.push(p.label + ": win probability");
      if (!p.terms) gaps.push(p.label + ": coupon terms");
    }
    return gaps;
  };

  Inv.isConfigured = function () {
    var c = config(), id, p;
    if (!c.event.dates || c.event.dates.length !== 3) return false;
    if (!c.event.dates[0] || !c.event.dates[1] || !c.event.dates[2]) return false;
    for (id in c.prizes) {
      if (!Object.prototype.hasOwnProperty.call(c.prizes, id)) continue;
      p = c.prizes[id];
      if (!p.dailyStock || p.dailyStock.length !== 3) return false;
      if (p.weight === null || p.weight === undefined) return false;
    }
    return true;
  };

  /* ---- the date the app believes it is ---------------------------
     Never toISOString: that is UTC and would flip the bucket at the
     wrong hour of the evening. */
  Inv.today = function () {
    var s = settings();
    return s.dateOverride || NS.localDate(new Date());
  };

  /* -1 before the event, 0/1/2 during, 3 after, null if unconfigured */
  Inv.dayIndex = function () {
    var c = config();
    if (!c.event.dates || c.event.dates.length !== 3) return null;
    var t = Inv.today(), i;
    for (i = 0; i < 3; i++) if (c.event.dates[i] === t) return i;
    if (t < c.event.dates[0]) return -1;
    if (t > c.event.dates[2]) return 3;
    // a gap day between configured dates: treat as outside the event
    return 3;
  };

  Inv.dayLabel = function () {
    var d = Inv.dayIndex();
    if (d === null) return "not configured";
    if (d === -1) return "before the event";
    if (d === 3) return "after the event";
    return "day " + (d + 1) + " of 3";
  };

  /* ---- remaining stock -------------------------------------------
     { id: [r1, r2, r3] }. Seeded from dailyStock; today's and past
     days' figures are live and only change through a spin or an
     explicit restock, while future days keep tracking config so an
     admin edit to day 3 takes effect. */
  function inventory() { return NS.Store.read(K_INV, null) || { remaining: {} }; }

  function reconcile() {
    var c = config(), inv = inventory(), day = Inv.dayIndex(), id, p, i, cur;
    if (!inv.remaining) inv.remaining = {};
    for (id in c.prizes) {
      if (!Object.prototype.hasOwnProperty.call(c.prizes, id)) continue;
      p = c.prizes[id];
      if (!p.dailyStock) continue;
      cur = inv.remaining[id];
      if (!cur || cur.length !== 3) cur = [null, null, null];
      for (i = 0; i < 3; i++) {
        if (cur[i] === null || cur[i] === undefined) cur[i] = p.dailyStock[i];
        else if (day !== null && day >= -1 && i > day) cur[i] = p.dailyStock[i];
      }
      inv.remaining[id] = cur;
    }
    NS.Store.write(K_INV, inv);
    return inv;
  }
  Inv.reconcile = reconcile;

  Inv.remaining = function (id, dayIdx) {
    var inv = inventory();
    var d = (dayIdx === undefined) ? Inv.dayIndex() : dayIdx;
    if (d === null || d < 0 || d > 2) return 0;
    var r = inv.remaining[id];
    return (r && r[d] != null) ? r[d] : 0;
  };

  /* Rows for the stock panel (§9.5). Hard Luck is never listed. */
  Inv.rows = function () {
    var c = config(), out = [], id, p, rem, dayIdx = Inv.dayIndex();
    for (id in c.prizes) {
      if (!Object.prototype.hasOwnProperty.call(c.prizes, id)) continue;
      p = c.prizes[id];
      rem = Inv.remaining(id);
      out.push({
        id: id,
        name: p.panelName || p.label,
        label: p.label,
        remaining: rem,
        daily: (p.dailyStock && dayIdx >= 0 && dayIdx <= 2) ? p.dailyStock[dayIdx] : null,
        soldOut: rem <= 0
      });
    }
    return out;
  };

  Inv.soldOutIds = function () {
    return Inv.rows().filter(function (r) { return r.soldOut; })
                     .map(function (r) { return r.id; });
  };

  Inv.todayExhausted = function () {
    var rows = Inv.rows();
    if (!rows.length) return false;
    for (var i = 0; i < rows.length; i++) if (!rows[i].soldOut) return false;
    return true;
  };

  /* ---- the draw (§7 step 1: from REMAINING stock, weighted) -------
     A prize tier with nothing left this day drops to zero weight, and
     its share moves to Hard Luck, split across the three loss wedges in
     proportion to their spans. Which loss wedge it lands in makes no
     difference to the player — the outcome is identical.

     There is no unlimited floor tier: the client declined one (§8), so
     once every tier is gone every spin is a loss. The end-of-day toggle
     is the only mitigation and it is staff-controlled. */
  Inv.drawWeights = function () {
    var c = config();
    var lossSpan = 0, reclaimed = 0, i, s, w = [];

    NS.SEGMENTS.forEach(function (seg) { if (!seg.win) lossSpan += seg.span; });

    for (i = 0; i < NS.SEGMENTS.length; i++) {
      s = NS.SEGMENTS[i];
      if (!s.win) { w.push(0); continue; }          // filled in below
      var p = c.prizes[s.prize];
      var weight = (p && p.weight != null) ? p.weight : 0;
      if (Inv.remaining(s.prize) <= 0) { reclaimed += weight; weight = 0; }
      w.push(weight);
    }

    var prizeTotal = 0;
    for (i = 0; i < w.length; i++) prizeTotal += w[i];
    var lossShare = Math.max(0, 1 - prizeTotal);

    for (i = 0; i < NS.SEGMENTS.length; i++) {
      s = NS.SEGMENTS[i];
      if (!s.win) w[i] = lossShare * (s.span / lossSpan);
    }
    return { weights: w, reclaimed: reclaimed, lossShare: lossShare };
  };

  /* ---- consuming -------------------------------------------------
     Called at DRAW time, before the animation starts, and written
     synchronously (§3). If the panel is killed mid-spin the stock is
     already correct; "undo last spin" in the admin panel is the remedy
     for a spin nobody wanted. */
  Inv.consume = function (segIndex) {
    var seg = NS.SEGMENTS[segIndex];
    var set = settings();
    var entry = {
      t: new Date().getTime(),
      date: Inv.today(),
      day: Inv.dayIndex(),
      seg: seg.id,
      prize: seg.prize || null,
      win: !!seg.win,
      test: !!set.testMode
    };

    /* Every win gets a short reference. With physical coupons there is
       no code to issue, and without SOMETHING on screen there is nothing
       to tell a fresh win from a screenshot shown twice. It is the count
       of wins so far on this day, so it is verifiable against the log
       and reads out loud easily across a counter. */
    if (seg.win) {
      var log0 = NS.Store.read(K_LOG, []);
      var n = 1;
      for (var q = 0; q < log0.length; q++) {
        if (log0[q].win && log0[q].date === entry.date) n++;
      }
      var dn = (entry.day !== null && entry.day >= 0) ? (entry.day + 1) : 0;
      entry.ref = "D" + dn + "-" + ("0000" + n).slice(-4);

      // A per-tier coupon code, if one was ever configured. In physical
      // fulfilment there is none, and the reference stands in.
      var cp = config().prizes[seg.prize];
      entry.code = (cp && cp.code) ? cp.code : entry.ref;
    }

    if (seg.win && seg.prize && !set.testMode) {
      var inv = inventory();
      var d = Inv.dayIndex();
      var r = inv.remaining[seg.prize];
      if (r && d !== null && d >= 0 && d <= 2 && r[d] > 0) {
        r[d] -= 1;
        entry.remainingAfter = r[d];
        NS.Store.write(K_INV, inv);          // synchronous, before any animation
      } else {
        entry.note = "no stock to decrement";
      }
    }

    var log = NS.Store.read(K_LOG, []);
    if (!log.push) log = [];
    /* A stable id so the handover confirmation can find this entry again
       after the popup has been through a render. Timestamp plus position
       cannot collide: two entries in the same millisecond would still be
       at different positions. */
    entry.id = "e" + entry.t + "-" + log.length;
    log.push(entry);
    NS.Store.write(K_LOG, log);

    if (Inv.changed) Inv.changed();
    return entry;
  };

  Inv.log = function () { return NS.Store.read(K_LOG, []); };

  /* ---- handover (client decision 2026-09-23) ---------------------
     Staff hold the confirm button on the win screen, which lands here.
     The point is not the popup: it is that at close of day the coupons
     the wheel ISSUED can be reconciled against the coupons staff
     CONFIRMED handing over, and any gap is visible rather than silent. */
  Inv.acknowledge = function (id) {
    var log = NS.Store.read(K_LOG, []), i;
    for (i = log.length - 1; i >= 0; i--) {
      if (log[i].id === id) {
        if (log[i].ack) return true;            // already done, not an error
        log[i].ack = new Date().getTime();
        NS.Store.write(K_LOG, log);
        if (Inv.changed) Inv.changed();
        return true;
      }
    }
    return false;
  };

  /* Wins that were never confirmed as handed over. Test spins do not
     count: nothing was given away. Pass a date for one day only. */
  Inv.unacknowledged = function (date) {
    var log = NS.Store.read(K_LOG, []), n = 0, i, e;
    for (i = 0; i < log.length; i++) {
      e = log[i];
      if (!e.win || e.test || e.ack) continue;
      if (date && e.date !== date) continue;
      n++;
    }
    return n;
  };

  /* Undo the last spin: put the coupon back, drop the log entry (§12).
     A child bumps the screen and burns a prize on nobody; this happens. */
  Inv.undoLast = function () {
    var log = NS.Store.read(K_LOG, []);
    if (!log.length) return null;
    var e = log.pop();
    if (e.win && e.prize && !e.test && e.day !== null && e.day >= 0 && e.day <= 2) {
      var inv = inventory();
      var r = inv.remaining[e.prize];
      if (r) { r[e.day] += 1; NS.Store.write(K_INV, inv); }
    }
    NS.Store.write(K_LOG, log);
    if (Inv.changed) Inv.changed();
    return e;
  };

  /* ---- staff actions (§12) --------------------------------------- */
  Inv.restock = function (id, dayIdx, n) {
    var inv = inventory();
    if (!inv.remaining[id]) inv.remaining[id] = [0, 0, 0];
    inv.remaining[id][dayIdx] = Math.max(0, n | 0);
    NS.Store.write(K_INV, inv);
    if (Inv.changed) Inv.changed();
  };

  // pull tomorrow's allocation forward into today
  Inv.pullForward = function () {
    var d = Inv.dayIndex();
    if (d === null || d < 0 || d >= 2) return false;
    var inv = inventory(), id, r, moved = 0;
    for (id in inv.remaining) {
      if (!Object.prototype.hasOwnProperty.call(inv.remaining, id)) continue;
      r = inv.remaining[id];
      if (!r || r[d + 1] <= 0) continue;
      moved += r[d + 1];
      r[d] += r[d + 1];
      r[d + 1] = 0;
    }
    NS.Store.write(K_INV, inv);
    if (Inv.changed) Inv.changed();
    return moved;
  };

  /* ---- rollover while the app stays open (§8) --------------------
     Not only on load: the panel is left running overnight. */
  var watchedDate = null;
  function watchDate() {
    var now = Inv.today();
    if (watchedDate === null) { watchedDate = now; return; }
    if (now !== watchedDate) {
      watchedDate = now;
      reconcile();
      if (Inv.changed) Inv.changed();
    }
  }

  Inv.init = function () {
    // the staff toggle wins over the build default (docs/DECISIONS.md)
    var st = settings();
    var f = st.fulfilment;
    if (f === "physical" || f === "code") NS.FULFILMENT.mode = f;
    NS.applyDismissSetting(st.autoDismiss);
    NS.Wheel.disc.set(st.discAnim, st.discPauseOnSpin);
    reconcile();
    watchedDate = Inv.today();
    setInterval(watchDate, 30000);
    document.addEventListener("visibilitychange", watchDate, false);
  };

  NS.Inventory = Inv;
})(window.JPH = window.JPH || {});
