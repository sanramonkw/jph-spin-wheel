/* ------------------------------------------------------------------
   spin.js — spin physics, landing, flapper (BUILD-SPEC §6 and §7).

   OUTCOME FIRST, ANIMATION SECOND. The caller draws the outcome, this
   module computes the rotation that puts it under the pointer and
   animates to it. The physics never decides the prize — that is what
   makes limited stock possible at all.

   Ported from reference/prototype.html, with three deliberate changes,
   each noted at the code:
     1. the peg-detection scan is fixed (the prototype's never fired)
     2. wheel speed is measured from real elapsed time, not assumed 60fps
     3. the flapper spring runs on fixed 60Hz substeps
   The tuned constants themselves are untouched.
------------------------------------------------------------------ */
(function (NS) {
  "use strict";

  var S = NS.SPIN;
  var SEG = NS.SEGMENTS;

  /* ---- pegs -----------------------------------------------------
     Every segment boundary is a peg the flapper strikes.

     FIXED: the prototype scanned SEGMENTS in wheel order, which starts
     at 332.1 and is therefore not ascending. A "last peg at or below"
     scan needs a sorted array, and its guard `if (at < PEGS[0]) idx =
     last` fired for almost the whole circle because PEGS[0] was the
     maximum. The result was a constant region index: zero transitions
     per revolution, so in the prototype the flapper never moved and no
     tick ever sounded. Sorting fixes it — verified at 8 transitions per
     revolution, one per divider. */
  var PEGS = SEG.map(function (s) { return s.start; }).sort(function (a, b) { return a - b; });

  /* How many dividers passed the pointer between two rotations.
     Counting crossings rather than watching a region index means a slow
     frame cannot swallow a divider: at 30fps and peak speed the wheel
     can move further than a whole segment in one frame. */
  function pegsCrossed(rotPrev, rotNow) {
    var atPrev = -rotPrev, atNow = -rotNow, c = 0, i, v;
    for (i = 0; i < PEGS.length; i++) {
      v = PEGS[i] + 360 * Math.ceil((atNow - PEGS[i]) / 360);
      while (v < atPrev) { c++; v += 360; }
    }
    return c;
  }

  /* ---- landing (§7) ---------------------------------------------
     Shared by the live spin and by the fairness/landing test, so the
     test is evidence about the code that actually runs. */
  function landing(idx, fromRot) {
    var s = SEG[idx];
    var margin = s.span * S.landMargin;             // never stop on a divider
    var within = margin + NS.rand() * (s.span - 2 * margin);
    var land = s.start + within;                    // wheel angle that must sit at top
    var rot = NS.norm360(-land);                    // rotation that puts it there
    var base = Math.ceil(fromRot / 360) * 360;
    return {
      target: base + S.turns * 360 + rot,
      finalRot: rot,
      within: within,
      distToDivider: Math.min(within, s.span - within)
    };
  }

  function ease(u) { return 1 - Math.pow(1 - u, S.tail); }

  /* ---- state ----------------------------------------------------- */
  var angle = 0;              // current rotation, kept normalised to 0..360
  var spinning = false;
  var flapA = 0, flapV = 0;   // flapper spring state
  var flapEl = null;
  var raf = null;

  var stats = {
    spins: 0, lastMs: 0, frames: 0, avgFps: 0, minFps: 0,
    dividersPassed: 0, lastDistToDivider: 0
  };

  function setFlap(deg) {
    if (flapEl) flapEl.style.transform = "rotate(" + (-deg).toFixed(2) + "deg)";
  }

  /* Flapper spring-damper, §6:
       on peg crossing:  flapV += min(34, degPerSec * 0.030) * kick
       every frame:      flapV += (-0.075*flapA - 0.16*flapV)
                         flapA  = clamp(flapA + flapV, 0, 30)
     Run on fixed 60Hz substeps so the tuned constants mean the same
     thing on a panel that cannot hold 60fps. The bounce at rest comes
     from the prototype and is what stops it reading as a dead needle. */
  function stepFlap(dt) {
    var steps = Math.min(8, Math.max(1, Math.round(dt / (1 / 60))));
    for (var i = 0; i < steps; i++) {
      flapV += (-0.075 * flapA - 0.16 * flapV);
      flapA += flapV;
      if (flapA < 0) { flapA = 0; flapV *= -0.25; }
      if (flapA > 30) { flapA = 30; flapV = 0; }
    }
  }

  /* ---- the spin -------------------------------------------------- */
  function spin(idx, done) {
    if (spinning) return false;
    spinning = true;

    NS.Audio.unlock();
    NS.Wheel.disc.spinStart();

    var from = angle;
    var L = landing(idx, from);
    var to = L.target;
    var over = to + S.settle;          // overshoot, then settle back in
    var T = S.dur * 1000;
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    var last = t0, lastRot = from;
    var frames = 0, minFps = Infinity, crossings = 0;

    function frame(now) {
      var t = now - t0;
      var dt = Math.max(0.001, (now - last) / 1000);
      last = now;

      var u = Math.min(1, t / T);
      var a;
      if (u < 1) {
        a = from + (over - from) * ease(u);
      } else {
        // damped settle from the overshoot back into the wedge
        var s = (t - T) / 1000;
        a = to + S.settle * Math.exp(-9 * s) * Math.cos(26 * s);
        if (s > 0.75) { finish(); return; }
      }

      /* Real elapsed time, not an assumed 60fps frame. §6 specifies the
         impulse in degrees per SECOND; the prototype approximated that
         as degrees-per-frame x 60, which halves on a 30fps panel and
         would quietly halve the kick and drop the tick pitch. */
      var degPerSec = Math.abs(a - lastRot) / dt;

      var crossed = pegsCrossed(lastRot, a);
      if (crossed > 0) {
        crossings += crossed;
        // one impulse per frame even if several dividers went by: flapA
        // is clamped at 30 anyway, and the pinned-at-max look during the
        // fast phase is the physically right one
        flapV += Math.min(34, degPerSec * 0.030) * S.flapKick;
        NS.Audio.tick(degPerSec);
      }

      lastRot = a;
      angle = a;
      NS.Wheel.setRotation(a);

      stepFlap(dt);
      setFlap(flapA);

      frames++;
      if (frames > 3) {                         // ignore the first frames
        var fps = 1 / dt;
        if (fps < minFps) minFps = fps;
      }

      raf = requestAnimationFrame(frame);
    }

    function finish() {
      raf = null;
      // normalise, or the stored angle grows without bound over an event
      angle = NS.norm360(L.finalRot);
      NS.Wheel.setRotation(angle);
      flapA = 0; flapV = 0; setFlap(0);
      spinning = false;
      NS.Wheel.disc.spinEnd();

      var elapsed = ((window.performance && performance.now) ? performance.now() : Date.now()) - t0;
      stats.spins++;
      stats.lastMs = Math.round(elapsed);
      stats.frames = frames;
      stats.avgFps = Math.round(frames / (elapsed / 1000));
      stats.minFps = minFps === Infinity ? 0 : Math.round(minFps);
      stats.dividersPassed = crossings;
      stats.lastDistToDivider = L.distToDivider;

      var landed = NS.Wheel.segmentAtTop(angle);
      var result = {
        index: idx,
        segment: SEG[idx],
        landedIndex: landed,
        match: landed === idx,          // must always be true
        distToDivider: L.distToDivider
      };

      if (SEG[idx].win) NS.Audio.win(); else NS.Audio.lose();
      if (done) done(result);
    }

    raf = requestAnimationFrame(frame);
    return true;
  }

  /* ---- landing test (§17.3, §17.11) -----------------------------
     Runs the same landing() the live spin runs. Reports mismatches,
     which must be zero, and the closest any landing came to a divider,
     which must stay above 5 degrees. */
  function testLanding(n) {
    var mismatches = 0, closest = Infinity, i, idx, from, L, at;
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    for (i = 0; i < n; i++) {
      idx = i % SEG.length;
      from = NS.rand() * 360;
      L = landing(idx, from);
      at = NS.Wheel.segmentAtTop(NS.norm360(L.finalRot));
      if (at !== idx) mismatches++;
      if (L.distToDivider < closest) closest = L.distToDivider;
    }
    var ms = ((window.performance && performance.now) ? performance.now() : Date.now()) - t0;
    return {
      n: n, mismatches: mismatches,
      closestToDivider: closest,
      ms: Math.round(ms),
      pass: mismatches === 0 && closest >= 5
    };
  }

  /* ---- fairness test (§7, §12) ----------------------------------
     Chi-square of the draw against the configured weights. Kept in the
     app on purpose: it is the evidence if anyone disputes a result. */
  /* Chi-square critical values, indexed by degrees of freedom. The wheel
     has 8 segments so df is normally 7, but a segment with zero odds is
     not a category at all and drops out — which happens the moment a
     prize tier sells out. */
  var CHI_05  = [0, 3.84, 5.99, 7.81, 9.49, 11.07, 12.59, 14.07];
  var CHI_001 = [0, 10.83, 13.82, 16.27, 18.47, 20.52, 22.46, 24.32];

  function testFairness(n, weights) {
    var counts = [], i, total = 0, chi = 0, exp, rows = [], live = 0;
    for (i = 0; i < weights.length; i++) { counts.push(0); total += weights[i]; }

    if (total <= 0) {
      return { n: 0, chi: 0, df: 0, verdict: "n/a", pass: true, ms: 0, rows: [],
               note: "every segment has zero odds, so there is nothing to draw" };
    }

    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    for (i = 0; i < n; i++) counts[NS.pick(weights)]++;
    var ms = ((window.performance && performance.now) ? performance.now() : Date.now()) - t0;

    for (i = 0; i < weights.length; i++) {
      exp = n * weights[i] / total;
      /* A zero-weight segment is not a category: it cannot be drawn, its
         expected count is zero, and including it divides by zero and makes
         the whole statistic NaN. This is not hypothetical — it is what
         happens as soon as a tier sells out, which is most of day three. */
      if (exp > 0) {
        live++;
        chi += Math.pow(counts[i] - exp, 2) / exp;
      }
      rows.push({
        id: SEG[i].id, short: SEG[i].short,
        observed: counts[i] / n, expected: exp / n,
        live: exp > 0,
        visualShare: SEG[i].span / 360        // shown alongside, so the gap is visible
      });
    }

    var df = Math.max(0, live - 1);
    if (df === 0) {
      return { n: n, chi: 0, df: 0, verdict: "n/a", pass: true, ms: Math.round(ms),
               rows: rows, live: live,
               note: "only one segment can be drawn, so there is nothing to compare" };
    }

    /* BUILD-SPEC quotes the 5% line, and it is the right thing to SHOW.
       It is the wrong thing to fail on: by construction a perfectly fair
       wheel crosses it about one run in twenty, so a staff-facing red
       FAIL at 5% would cry wolf during the event and get ignored — which
       is worse than no test. The verdict uses the 0.1% line instead. */
    var critical = CHI_05[df];
    var criticalHard = CHI_001[df];
    var verdict = chi < critical ? "clean" : (chi < criticalHard ? "high" : "fail");
    return { n: n, chi: chi, critical: critical, criticalHard: criticalHard,
             verdict: verdict, df: df, live: live,
             pass: chi < criticalHard, ms: Math.round(ms), rows: rows };
  }

  NS.Spin = {
    init: function () {
      flapEl = document.getElementById("flapRot");
      setFlap(0);
      NS.Wheel.setRotation(angle);
    },
    spin: spin,
    isSpinning: function () { return spinning; },
    getAngle: function () { return angle; },
    setAngle: function (d) { angle = NS.norm360(d); NS.Wheel.setRotation(angle); },
    stats: stats,
    landing: landing,
    pegsCrossed: pegsCrossed,
    pegs: PEGS,
    testLanding: testLanding,
    testFairness: testFairness,
    cancel: function () {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      spinning = false; flapA = 0; flapV = 0; setFlap(0);
    }
  };
})(window.JPH = window.JPH || {});
