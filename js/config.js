/* ------------------------------------------------------------------
   config.js — every tunable value and every string in one place.

   BUILD-SPEC.md is authoritative. Values below marked "measured" were
   taken off the supplied 1080x1920 artboard and must not be re-derived.

   Fields set to null are BLOCKED ON THE CLIENT (BUILD-SPEC.md section 18).
   Do not fill them with guesses — the app refuses to run a live event
   while they are null, and says so.
------------------------------------------------------------------ */
(function (NS) {
  "use strict";

  /* ---- copy (BUILD-SPEC section 10) -----------------------------
     DRAFT. The client must rewrite this in their own voice before
     launch. Nothing below may be duplicated into markup. */
  NS.COPY = {
    headline:        "SPIN THE WHEEL, STEAL THE DEAL!",
    attract:         "TAP TO PLAY",
    spinButton:      "SPIN",
    winTitle:        "YOU WON!",
    winDismiss:      "TAP TO CONTINUE",
    refLabel:        "SHOW THIS AT THE COUNTER",
    claimLine:       "Show this screen to our staff to collect your coupon",
    holdLabel:       "STAFF: HOLD TO CONFIRM HANDED OVER",
    termsDiscount:   "Valid on your next online order until {date}",
    termsFood:       "Claim at the counter today",
    termsRedeem:     "Redeem at {where}",
    termsOnePer:     "One per customer",
    loseTitle:       "NICE TRY!",
    loseLine:        "The wheel wasn't feeling it. Come back and try again!",
    stockHeader:     "LEFT TODAY",
    soldOut:         "GONE",          // stock panel
    soldOutStamp:    "SOLD OUT",      // stamped on the wheel wedge, section 6
    endOfDayTitle:   "TODAY'S COUPONS ARE ALL CLAIMED",
    endOfDayLine:    "Come back tomorrow",
    loading:         "LOADING",
    stockNotSet:     "Not set up yet",
    closedTitle:     "THE WHEEL IS CLOSED",
    closedBefore:    "Come back on {date}",
    closedAfter:     "Thanks for playing!",
    setupTitle:      "SETUP REQUIRED",
    setupLine:       "Staff: press and hold the bottom-left corner for 3 seconds."
  };

  /* ---- wheel geometry, measured (BUILD-SPEC section 6) ----------
     Bands, outside in. Each radius is where one band ENDS and the
     next begins, so the ring is drawn as concentric filled circles
     largest first:
       rOuter  433 .. rRimIn  414   red rim
       rRimIn  414 .. rHairIn 406   white hairline
       rHairIn 406 .. rLabelIn 290  red label ring, holds the text
       rLabelIn 290 .. rGapIn 284   white gap
       rGapIn  284 ..   0           character disc                */
  NS.WHEEL = {
    centreX: 539, centreY: 1047,   // on the 1080x1920 artboard
    size: 866,                     // the wheel element is 866x866
    c: 433,                        // its own centre
    rOuter:   433,
    rRimIn:   414,
    rHairIn:  406,
    rLabelIn: 290,
    rGapIn:   284,
    rDisc:    284,                 // character disc covers 0..284
    rHub:      62,                 // static overlay, does not rotate
    // label placement radii, also measured
    rLineA: 384, rLineB: 332, rSingle: 356, rSoldOut: 310
  };

  /* ---- colours needed in JS (the CSS in css/app.css is the source
     of truth for everything else; these are the ones the SVG ring is
     built from, and they must not drift from section 4) ---------- */
  NS.INK = {
    red:       "#E10C48",   // --red
    cream:     "#FDFBF4",   // --cream
    gold:      "#EDA53A",   // --gold
    redSold:   "#7D0A2B",   // --red-dark, the dead-wedge fill
    labelDead: "#FDFBF4"    // --cream, dimmed by opacity rather than a new colour
  };

  /* ---- layout bases ---------------------------------------------
     Portrait is the designer's artboard. Landscape is undesigned and
     was added by client decision on 2026-09-22 (docs/DECISIONS.md);
     it uses its own design space rather than reusing the portrait one,
     because a 866px wheel inside a 1920-tall space would read as tiny
     on a landscape panel. Both need a designer pass. */
  NS.LAYOUT = {
    /* Portrait is the primary and only real target (client, 2026-09-23),
       so the wheel is scaled up into the space freed by moving the stock
       panel to the top: radius 433 x 1.10 = 476, leaving a 64px margin
       each side. The disc bitmap is 1100px at source and is drawn at
       625px here, so nothing is upscaled. */
    portrait:  { w: 1080, h: 1920, wheelScale: 1.10 },
    landscape: { w: 1920, h: 1080, wheelScale: 0.80 }
  };

  /* ---- segments, measured clockwise from top -------------------
     CRITICAL: span is artwork width only. Win probability is the
     `weight` field on PRIZES and is never derived from span. */
  NS.SEGMENTS = [
    { id:"p50", prize:"p50", lines:["50% on your next order","from our website"], short:"50% OFF",            start:332.1, span:63.6, win:true  },
    { id:"hot", prize:"hot", lines:["Free Hotdog","Now"],                        short:"FREE HOTDOG",         start: 35.7, span:37.7, win:true  },
    { id:"p20", prize:"p20", lines:["20% on your next order","from our website"], short:"20% OFF",            start: 73.4, span:61.8, win:true  },
    { id:"l1",  prize:null,  lines:["Hard Luck"],                                short:"HARD LUCK",           start:135.2, span:34.7, win:false },
    { id:"p10", prize:"p10", lines:["10% on your next order","from our website"], short:"10% OFF",            start:169.9, span:61.0, win:true  },
    { id:"l2",  prize:null,  lines:["Hard Luck"],                                short:"HARD LUCK",           start:230.9, span:30.0, win:false },
    { id:"pot", prize:"pot", lines:["Free Jacket","potato Now"],                  short:"FREE JACKET POTATO", start:260.9, span:37.7, win:true  },
    { id:"l3",  prize:null,  lines:["Hard Luck"],                                short:"HARD LUCK",           start:298.6, span:33.5, win:false }
  ];

  /* ---- character disc spoke angles, 12 wedges (section 16) ------
     12 character wedges against 8 label segments; they do not align. */
  NS.DISC_SPOKES = [14.6, 47.2, 73.8, 102.8, 134.2, 166.5, 193.3, 226.4,
                    257.8, 288.2, 317.0, 345.0];

  /* ---- spin feel, tuned defaults (section 7) -------------------- */
  NS.SPIN = {
    dur: 5.5,        // seconds
    turns: 6,
    tail: 3.8,
    settle: 2.25,    // degrees of overshoot
    flapKick: 1.4,
    landMargin: 0.18 // fraction of span kept clear of each divider
  };

  /* ---- timings (sections 9, 11) -------------------------------- */
  NS.TIMING = {
    /* A WIN NEVER AUTO-DISMISSES AND NEVER CLEARS ON A STRAY TAP. It is
       cleared by staff holding the confirm button, which is also what
       records the coupon as handed over. This stays 0.

       A hard luck is the opposite: nobody has to do anything about it,
       so it clears on any tap, and staff can set it to clear itself
       after 7s (BUILD-SPEC §9.4's figure, now a preset). */
    winDismissMs:  0,
    loseDismissMs: 0,
    holdToConfirmMs: 1000,
    /* The backstop, so a panel is never stranded on somebody else's
       result through a quiet spell. Only fires when auto-dismiss is off. */
    strandedMs: 180000,
    attractSpinDegPerSec: 6,
    adminIdleTimeoutMs: 5 * 60 * 1000,
    adminLongPressMs: 3000
  };

  /* ==============================================================
     BLOCKED ON CLIENT — BUILD-SPEC section 18, items 1, 2 and 3.
     ==============================================================
     Quantities, win probabilities, coupon codes and coupon terms
     must come from the client. They are deliberately null. The app
     surfaces a blocking notice rather than running on invented data.

     Shape when supplied (section 8):
       totalStock  number, across all 3 days
       dailyStock  [n1, n2, n3]
       weight      win probability, INDEPENDENT of segment span
       codes       one shared code, or a pool of unique codes
       terms       { validUntil, onePerCustomer, redeemAt }
  ============================================================== */
  NS.PRIZES = {
    /* panelName is the short form used on the stock panel, where the
       portrait layout has 184px per tier. Draft copy like everything
       else in COPY — the client rewrites it. */
    p50: { id:"p50", label:"50% off next online order", panelName:"50% OFF",       dailyStock:null, weight:null, terms:null },
    hot: { id:"hot", label:"Free Hotdog",               panelName:"HOT DOG",       dailyStock:null, weight:null, terms:null },
    p20: { id:"p20", label:"20% off next online order", panelName:"20% OFF",       dailyStock:null, weight:null, terms:null },
    p10: { id:"p10", label:"10% off next online order", panelName:"10% OFF",       dailyStock:null, weight:null, terms:null },
    pot: { id:"pot", label:"Free Jacket Potato",        panelName:"JACKET POTATO", dailyStock:null, weight:null, terms:null }
  };

  /* Event dates and opening hours — section 18 item 6, before launch. */
  NS.EVENT = { dates: null, openingTime: null };

  /* ---- fulfilment -----------------------------------------------
     Client decision, 2026-09-22 (docs/DECISIONS.md): the coupon is
     handed over physically at the counter against the wheel result.
     There is no digital code to issue, so BUILD-SPEC section 18 item 2
     is answered and PRIZES.codes stays unused.

     ASSUMPTION, to confirm before stage 6: this also removes the
     coupon code and the QR from the win popup (section 9.3 items 4
     and 5), leaving prize name, terms and an instruction to show the
     screen at the counter. Stock, weights and terms are unaffected —
     a physical coupon is still a finite, depleting thing. */
  NS.FULFILMENT = {
    mode: "physical",          // "physical" | "code"
    decidedOn: "2026-09-22",
    confirmedForPopup: false   // flip once section 9.3 is re-confirmed
  };

  /* ---- orientation ----------------------------------------------
     Client decision, 2026-09-22: landscape is required, not the
     stretch goal section 5 allowed for. Portrait stays primary. */
  NS.ORIENTATION = { portrait: true, landscape: true };

  /* ---- odds ------------------------------------------------------
     Win probability is configured here and is NEVER derived from
     segment span (BUILD-SPEC section 6, "Critical"). The widths were
     driven by label length: the most expensive prize has the largest
     wedge, and a 17.7% wedge must not mean 17.7% odds.

     pick() consumes one weight PER SEGMENT (8), not per prize (5).
     The three Hard Luck segments share whatever probability the prize
     tiers leave over, split in proportion to their spans, so the wheel
     lands across them naturally. Which Hard Luck wedge it stops in
     makes no difference to the player — the outcome is identical.

     PLACEHOLDER_WEIGHTS exists ONLY so the spin can be felt and
     measured during stages 3 to 5. It is uniform, it is not a
     proposal, and it must never ship. missingConfig() keeps reporting
     the gap and diagnostics shows it in red while it is in use. */
  NS.PLACEHOLDER_WEIGHTS = NS.SEGMENTS.map(function () { return 1; });

  NS.weights = function () {
    // Live stock decides the draw once the app is configured (§7 step 1);
    // until then the uniform placeholder keeps the spin testable.
    if (NS.Inventory && NS.Inventory.isConfigured()) {
      var d = NS.Inventory.drawWeights();
      return { weights: d.weights, placeholder: false,
               lossShare: d.lossShare, reclaimed: d.reclaimed };
    }
    return { weights: NS.PLACEHOLDER_WEIGHTS.slice(), placeholder: true };
  };

  /* Which config is still missing. Used by the diagnostics panel and,
     from stage 4, to refuse to start a live event on invented data. */
  NS.missingConfig = function () {
    // Delegated: the numbers are entered in the admin panel now, so the
    // live config is what counts, not the build-time defaults.
    if (NS.Inventory) return NS.Inventory.missing();
    return ["inventory module not loaded"];
  };

})(window.JPH = window.JPH || {});
