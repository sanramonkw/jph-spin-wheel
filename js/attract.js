/* ------------------------------------------------------------------
   attract.js — the default state (BUILD-SPEC §9.1 and §11).

   Runs until someone touches the screen:
     - the wheel turns slowly and continuously, about 6 degrees a second
     - the headline and the stock panel stay visible
     - TAP TO PLAY pulses in the lower third
     - no sound

   The entire lower area is the tap target (§5). On a tall panel on a
   stand the top of the screen is above many people's reach, so there is
   one big trigger rather than a button somebody has to aim at. The SPIN
   button still sits inside it as the visual affordance.

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
      var zone = document.getElementById("tapZone");
      if (zone) {
        // One handler for the whole lower area. It defers to the same
        // lock the SPIN button uses, so mashing cannot queue spins.
        zone.addEventListener("click", function (e) {
          e.preventDefault();
          NS.doSpin();
        }, false);
      }

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
