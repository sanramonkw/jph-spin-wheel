/* ------------------------------------------------------------------
   stage.js — fit the design space to the real panel.

   BUILD-SPEC section 5: must fill the viewport, never letterbox. So we
   scale to the CONSTRAINING axis and grow the stage on the other one,
   rather than scaling to the smaller ratio (which leaves bars) or the
   larger (which would crop the SPIN button off the bottom).

   Two design spaces, chosen by viewport aspect:

     portrait   1080 x 1920   the designer's artboard, reproduced exactly
     landscape  1920 x 1080   undesigned; client decision 2026-09-22

   Landscape gets its own space rather than reusing the portrait one:
   an 866px wheel inside a 1920-tall design space renders at 45% of a
   landscape panel's height, which reads as tiny across a room.

   On the target panel this gives scale 1 and a 1080x1920 stage, so the
   artboard is reproduced pixel for pixel.
------------------------------------------------------------------ */
(function (NS) {
  "use strict";

  var fitEl, stageEl;
  var current = { scale: 1, w: 1080, h: 1920, orient: "portrait" };

  function fit() {
    if (!fitEl || !stageEl) return;

    var w = fitEl.clientWidth  || window.innerWidth  || 1080;
    var h = fitEl.clientHeight || window.innerHeight || 1920;

    var orient = (w / h) >= 1 ? "landscape" : "portrait";
    var base = NS.LAYOUT[orient];

    var scale, sw, sh;
    if (w / h <= base.w / base.h) {   // viewport narrower than the design space
      scale = w / base.w;
      sw = base.w;
      sh = h / scale;
    } else {                          // viewport wider than the design space
      scale = h / base.h;
      sh = base.h;
      sw = w / scale;
    }

    stageEl.style.width  = sw + "px";
    stageEl.style.height = sh + "px";
    stageEl.style.transform = "translate(-50%,-50%) scale(" + scale + ")";

    var root = document.documentElement;
    root.style.setProperty("--stage-w", sw + "px");
    root.style.setProperty("--stage-h", sh + "px");
    root.style.setProperty("--scale", String(scale));
    root.style.setProperty("--wheel-scale", String(base.wheelScale));

    // Published once here so layouts branch off one measured value
    // instead of each module reading the viewport for itself.
    if (document.body.getAttribute("data-orient") !== orient) {
      document.body.setAttribute("data-orient", orient);
    }

    current = { scale: scale, w: sw, h: sh, orient: orient, base: base };
    if (NS.onStageFit) NS.onStageFit(current);
  }

  NS.Stage = {
    metrics: function () { return current; },
    fit: fit,
    init: function () {
      fitEl   = document.getElementById("fit");
      stageEl = document.getElementById("stage");
      fit();
      window.addEventListener("resize", fit, false);
      window.addEventListener("orientationchange", fit, false);
      if (window.ResizeObserver) { new ResizeObserver(fit).observe(fitEl); }
      if (window.visualViewport) { window.visualViewport.addEventListener("resize", fit, false); }
      // Android WebViews sometimes report a stale viewport for a beat
      // after the address bar or a kiosk chrome collapses.
      setTimeout(fit, 250);
      setTimeout(fit, 1000);
    }
  };
})(window.JPH = window.JPH || {});
