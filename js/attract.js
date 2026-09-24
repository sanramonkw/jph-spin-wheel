/* ------------------------------------------------------------------
   attract.js — the default state (BUILD-SPEC §9.1 and §11).

   Runs until someone touches the screen:
     - the wheel turns slowly and continuously, about 6 degrees a second
     - the headline and the stock panel stay visible
     - TAP TO PLAY pulses in the lower third
     - no sound

   §5 asked for the entire lower area to be the tap target. Client
   decision 2026-09-24: only the SPIN button spins. A whole-screen-half
   trigger fires on sleeve brushes, on somebody steadying themselves
   against the panel, and on a child leaning in — each of which burns a
   coupon on nobody. The button is 700x150 and sits in the lower third,
   so it is still an easy target; it is just a deliberate one.

   The idle rotation drives Spin's stored angle rather than the wheel
   directly, so a spin always starts from where the wheel actually is.
------------------------------------------------------------------ */
(function (NS) {
  "use strict";

  var raf = null, last = 0, running = false;

  function frame(now) {
    if (!running) { raf = null; return; }
    var dt = last ? (now - last) / 1000 : 0;
    last = now;
    // guard against a huge dt after the app has been backgrounded
    if (dt > 0 && dt < 0.5) {
      NS.Spin.setAngle(NS.Spin.getAngle() + NS.TIMING.attractSpinDegPerSec * dt);
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
  }

  NS.Attract = {
    init: function () {
      /* No handler on the zone any more: it is a layout wrapper and lets
         taps through. The SPIN button has its own handler, bound in
         boot.js, and both go through the same lock so mashing still
         cannot queue spins. */

      // A backgrounded WebView stops firing rAF; resume cleanly.
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) stop();
        else if (NS.getState() === "attract") { last = 0; start(); }
      }, false);
    },
    start: start,
    stop: stop,
    isRunning: function () { return running; }
  };
})(window.JPH = window.JPH || {});
