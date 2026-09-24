/* ------------------------------------------------------------------
   result.js — the result popup (BUILD-SPEC §9.3 and §9.4).

   Full-screen overlay above the wheel, dimming it to about 35%.

   Win hierarchy, top to bottom:
     1. character reaction        (CharacterView, §9.6)
     2. YOU WON!                  display size, gold
     3. prize name                title size, cream
     4. coupon code               monospace 64, on a cream card    } only in
     5. QR encoding the code      320px minimum, generated here    } code mode
     6. terms line                caption, 75% opacity
     7. TAP TO CONTINUE

   Hard luck is the same structure with no code and no QR, and it leaves
   after 7 seconds rather than 12. Do not linger on a loss. Never
   "YOU LOSE" — the tone is good-natured, never mocking.

   FULFILMENT MODE. The client hands over a printed coupon card that
   already carries its own code, so the screen shows NOTHING to scan or
   read out — client decision 2026-09-23. Steps 4 and 5 simply do not
   appear, and the popup announces the prize and nothing else.

   A reference is still written to the winners log for reconciliation;
   it is just not put on screen. Switching the mode to "code" in the
   staff panel brings the coupon code and the QR back if that ever
   changes.
------------------------------------------------------------------ */
(function (NS) {
  "use strict";

  var el = {}, timer = null, open = false, onDone = null, openedAt = 0;
  var currentEntry = null, isWin = false;
  var holdTimer = null;

  function clearTimer() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  /* Auto-dismiss is OFF by default — client decision 2026-09-23: the
     result stays until somebody touches it. BUILD-SPEC §9.3 and §9.4
     specify 12s and 7s; those are now the value staff can set rather
     than the behaviour.

     Zero means never, and then only the boot watchdog can close it — it
     waits several minutes and exists so a panel cannot be left stranded
     on somebody else's result during a quiet spell. */
  function arm(ms) {
    if (!ms || ms <= 0) return;
    timer = setTimeout(hide, ms);
  }

  /* ---- confetti (§9.3: confetti or sparkle burst on entry) -------
     Two dozen absolutely positioned pieces, transform-only so a weak
     GPU is not asked to repaint anything. Built once, replayed. */
  var CONFETTI = 24;
  function buildConfetti() {
    var host = el.confetti, i, p, html = "";
    if (!host) return;
    for (i = 0; i < CONFETTI; i++) {
      var left = Math.round(NS.rand() * 100);
      var delay = (NS.rand() * 0.45).toFixed(2);
      var dur = (1.5 + NS.rand() * 1.2).toFixed(2);
      var drift = Math.round((NS.rand() - 0.5) * 220);
      var spin = Math.round((NS.rand() - 0.5) * 900);
      var w = 10 + Math.round(NS.rand() * 12);
      var h = 14 + Math.round(NS.rand() * 16);
      var col = ["var(--gold)", "var(--cream)", "var(--red)", "#ffd884"][i % 4];
      html += '<i style="left:' + left + "%;width:" + w + "px;height:" + h +
              "px;background:" + col + ";animation-delay:" + delay +
              "s;animation-duration:" + dur + "s;--drift:" + drift +
              "px;--spin:" + spin + 'deg"></i>';
    }
    host.innerHTML = html;
  }

  function playConfetti() {
    if (!el.confetti) return;
    el.confetti.classList.remove("go");
    void el.confetti.offsetWidth;
    buildConfetti();
    el.confetti.classList.add("go");
  }

  /* ---- show -------------------------------------------------------
     `res` is the object Spin hands back; `entry` is the log record
     Inventory wrote at draw time, which carries the reference and the
     issued code if there is one. */
  function show(res, entry, done) {
    onDone = done || null;
    open = true;
    openedAt = (window.performance && performance.now) ? performance.now() : Date.now();
    clearTimer();

    var win = !!res.segment.win;
    isWin = win;
    currentEntry = entry || null;
    var C = NS.COPY;
    var mode = NS.FULFILMENT.mode;
    cancelHold();

    el.root.setAttribute("data-kind", win ? "win" : "lose");

    NS.CharacterView.setPose(win ? "win" : "lose");
    NS.CharacterView.enter();
    // the sound that came with the clip, restored as its own track
    NS.Audio.reaction(win ? "win" : "lose");

    if (win) {
      var prize = NS.Inventory.config().prizes[res.segment.prize] || {};
      el.title.textContent = C.winTitle;
      el.prize.textContent = prize.label || res.segment.short;

      var code = entry && entry.code;
      var showCode = (mode === "code") && !!code;

      el.codeWrap.hidden = !showCode;
      el.qrWrap.hidden = !showCode;
      el.refWrap.hidden = true;     // the printed card carries the code

      if (showCode) {
        el.code.textContent = code;
        renderQR(code);
      }

      el.terms.textContent = termsLine(prize);
      el.terms.hidden = !el.terms.textContent;

      /* A win is handed over, not dismissed. The attendee is told what to
         do; staff clear it by holding, which is also what records the
         coupon as given out. */
      el.claim.textContent = C.claimLine;
      el.claim.hidden = false;
      el.holdLabel.textContent = C.holdLabel;
      el.hold.hidden = false;
      el.dismiss.hidden = true;

      playConfetti();
      arm(NS.TIMING.winDismissMs);          // 0 — a win never times out
    } else {
      el.title.textContent = C.loseTitle;
      el.prize.textContent = C.loseLine;
      el.codeWrap.hidden = true;
      el.qrWrap.hidden = true;
      el.refWrap.hidden = true;
      el.terms.hidden = true;
      el.claim.hidden = true;
      el.hold.hidden = true;
      el.dismiss.hidden = false;
      el.dismiss.textContent = C.winDismiss;
      arm(NS.TIMING.loseDismissMs);
    }

    el.root.classList.add("show");
  }

  function termsLine(prize) {
    var t = prize.terms;
    if (!t) return "";
    var bits = [];
    if (t.validUntil) bits.push(NS.fill(NS.COPY.termsDiscount, { date: t.validUntil }));
    else if (t.redeemAt) bits.push(NS.COPY.termsFood);
    if (t.redeemAt && t.validUntil) bits.push(NS.fill(NS.COPY.termsRedeem, { where: t.redeemAt }));
    else if (t.redeemAt && !t.validUntil) bits.push(NS.fill(NS.COPY.termsRedeem, { where: t.redeemAt }));
    if (t.onePerCustomer) bits.push(NS.COPY.termsOnePer);
    return bits.join("  ·  ");
  }

  function renderQR(text) {
    try {
      var qr = NS.QR.encode(text);
      // built as markup on a plain div: innerHTML on an SVG element is
      // unsupported on older Android WebViews (§2)
      el.qr.innerHTML = NS.QR.toSVG(qr, 340, 4);
      el.qrWrap.hidden = false;
    } catch (e) {
      // a code too long for version 7 must not take the popup down
      el.qr.innerHTML = "";
      el.qrWrap.hidden = true;
      if (NS.Store) NS.Store.lastError = "QR: " + e.message;
    }
  }

  /* ---- hold to confirm (win only) --------------------------------
     Press and hold for holdToConfirmMs. Releasing early cancels and the
     fill snaps back, so a reflex tap does nothing at all. */
  function cancelHold() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (el.hold) el.hold.classList.remove("holding");
  }

  function startHold(e) {
    if (!isWin || !open) return;
    if (e && e.preventDefault) e.preventDefault();
    if (holdTimer) return;
    el.hold.classList.add("holding");
    holdTimer = setTimeout(function () {
      holdTimer = null;
      confirmHandover();
    }, NS.TIMING.holdToConfirmMs);
  }

  function confirmHandover() {
    cancelHold();
    // record it BEFORE closing, so a panel killed here still has the fact
    if (currentEntry && currentEntry.id) NS.Inventory.acknowledge(currentEntry.id);
    hide();
  }

  function hide() {
    if (!open) return;
    cancelHold();
    clearTimer();
    open = false;
    currentEntry = null;
    el.root.classList.remove("show");
    NS.Audio.reactionStop();
    NS.CharacterView.setPose("idle");
    if (el.confetti) el.confetti.classList.remove("go");
    var cb = onDone; onDone = null;
    if (cb) cb();
  }

  NS.Result = {
    init: function () {
      el.root = document.getElementById("resultPopup");
      el.title = document.getElementById("rpTitle");
      el.prize = document.getElementById("rpPrize");
      el.codeWrap = document.getElementById("rpCodeWrap");
      el.code = document.getElementById("rpCode");
      el.refWrap = document.getElementById("rpRefWrap");
      el.ref = document.getElementById("rpRef");
      el.refLabel = document.getElementById("rpRefLabel");
      el.qrWrap = document.getElementById("rpQrWrap");
      el.qr = document.getElementById("rpQr");
      el.terms = document.getElementById("rpTerms");
      el.dismiss = document.getElementById("rpDismiss");
      el.confetti = document.getElementById("rpConfetti");
      el.claim = document.getElementById("rpClaim");
      el.hold = document.getElementById("rpHold");
      el.holdLabel = document.getElementById("rpHoldLabel");
      el.holdFill = document.getElementById("rpHoldFill");

      if (el.holdFill) {
        el.holdFill.style.transitionDuration =
          (NS.TIMING.holdToConfirmMs / 1000) + "s";
      }

      NS.CharacterView.init();

      /* A hard luck clears on any tap. A win does NOT — it waits for the
         hold, so an impatient or accidental tap cannot lose a coupon. */
      if (el.root) {
        el.root.addEventListener("click", function () {
          if (!isWin) hide();
        }, false);
      }

      if (el.hold) {
        el.hold.addEventListener("touchstart", startHold, { passive: false });
        el.hold.addEventListener("touchend", cancelHold, false);
        el.hold.addEventListener("touchcancel", cancelHold, false);
        el.hold.addEventListener("touchmove", cancelHold, false);
        el.hold.addEventListener("mousedown", startHold, false);
        el.hold.addEventListener("mouseup", cancelHold, false);
        el.hold.addEventListener("mouseleave", cancelHold, false);
        // never let the hold button's own click reach the overlay
        el.hold.addEventListener("click", function (e) {
          e.stopPropagation();
        }, false);
      }
    },
    show: show,
    hide: hide,
    isOpen: function () { return open; },
    // exposed so the checks can exercise the hold without real touches
    _startHold: startHold,
    _cancelHold: cancelHold,
    _confirm: confirmHandover,
    needsHandover: function () { return open && isWin; },
    // how long it has been on screen, for the boot watchdog
    openedFor: function () {
      if (!open) return 0;
      var now = (window.performance && performance.now) ? performance.now() : Date.now();
      return now - openedAt;
    }
  };
})(window.JPH = window.JPH || {});
