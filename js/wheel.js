/* ------------------------------------------------------------------
   wheel.js — the wheel: SVG ring, arc labels, character disc, hub.

   Ported from reference/prototype.html. The label-on-arc approach is
   tested: one arc path PER SEGMENT, never a shared full-circle path.
   A shared path clips any label that straddles 0 degrees — that bug
   was hit and fixed once already, do not reintroduce it.

   Radii are BUILD-SPEC section 6, measured off the artboard:

     outer rim        414 -> 433   red
     white hairline   406 -> 414
     label ring       290 -> 406   red, holds the text
     white gap        284 -> 290
     character disc     0 -> 284
     hub (static)     radius 62

   The ring is rebuilt only when stock changes (section 6). The spin
   itself never touches the DOM beyond one transform on one element,
   so the whole wheel stays a single composited layer.
------------------------------------------------------------------ */
(function (NS) {
  "use strict";

  var W = NS.WHEEL;
  var C = W.c;                 // 433, the wheel element's own centre

  var host, wheelEl, discEl, discVid, rotation = 0;
  var painted = null;          // last sold-out signature, to skip redundant repaints

  /* ---- animated character disc (disc-anim/INTEGRATION.md) --------
     The video is clipped to a circle in CSS and the still lies
     underneath it, so anything that goes wrong just falls back to the
     original disc and nobody notices.

     `on` is a staff toggle, so the animation can be turned off on the
     day if it costs frame rate. `pauseOnSpin` is the lighter remedy:
     the characters are not resolvable at spin speed anyway, so pausing
     for the five seconds of the spin loses nothing. Both default to the
     livelier setting and are only changed if the panel needs it. */
  var DISC = { on: true, pauseOnSpin: false, failed: false };

  /* ---- geometry helpers (ported verbatim) ---------------------- */

  // point on a circle, degrees clockwise from the top
  function pt(r, deg) {
    var t = (deg - 90) * Math.PI / 180;
    return (C + r * Math.cos(t)).toFixed(2) + " " + (C + r * Math.sin(t)).toFixed(2);
  }

  // an arc spanning just one segment, so centred text can never fall
  // off the start of a shared full-circle path
  function arcSeg(r, start, span) {
    return "M " + pt(r, start) +
           " A " + r + " " + r + " 0 " + (span > 180 ? 1 : 0) + " 1 " + pt(r, start + span);
  }

  function wedge(start, span, rIn, rOut) {
    var large = span > 180 ? 1 : 0;
    return "M " + pt(rIn, start) +
           " L " + pt(rOut, start) +
           " A " + rOut + " " + rOut + " 0 " + large + " 1 " + pt(rOut, start + span) +
           " L " + pt(rIn, start + span) +
           " A " + rIn + " " + rIn + " 0 " + large + " 0 " + pt(rIn, start) + " Z";
  }

  /* The size a single label could take if it were the only one
     (BUILD-SPEC section 6's formula, unchanged). */
  function fitSize(txt, r, span) {
    var arc = 2 * Math.PI * r * (span / 360) * 0.90;   // usable arc, with margins
    return Math.round(Math.max(28, Math.min(44, arc / (txt.length * 0.52))));
  }

  /* ONE SIZE FOR EVERY LABEL — client decision 2026-09-23.

     Section 6 sized each label to fill its own wedge, which is efficient
     but reads as ragged: "Now" came out at 44 next to "10% on your next
     order" at 32 on the same ring. The wheel looks more considered when
     the type is uniform, so the size is the smallest that every label
     can live with, and the tight wedges set it for all of them.

     The floor is the section 4 rule: below 24px it is decoration, not
     information. If a label ever pushes the common size under that, the
     label is too long, not the type too big. */
  function uniformSize() {
    var smallest = 44;
    NS.SEGMENTS.forEach(function (s) {
      var r = s.lines.length > 1 ? W.rLineA : W.rSingle;
      s.lines.forEach(function (line, i) {
        var rr = s.lines.length > 1 ? (i === 0 ? W.rLineA : W.rLineB) : W.rSingle;
        var f = fitSize(line, rr, s.span);
        if (f < smallest) smallest = f;
      });
    });
    return Math.max(24, smallest);
  }

  /* Two-line labels sit symmetrically about the single-line radius, with
     the gap set by the type rather than fixed. The measured 384/332 was
     a 52px gap chosen for type that no longer exists at those sizes. */
  function lineRadii(size) {
    var lead = size * 1.34;
    return { a: W.rSingle + lead / 2, b: W.rSingle - lead / 2 };
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ---- ring ----------------------------------------------------- */

  function buildRingSVG(soldOut) {
    var defs = "";
    var SIZE = uniformSize();
    var LR = lineRadii(SIZE);
    // keep the SOLD OUT stamp clear of the lower line whatever the size
    var rStamp = Math.max(298, LR.b - SIZE * 0.95);
    var body =
      '<circle cx="' + C + '" cy="' + C + '" r="' + W.rOuter   + '" fill="' + NS.INK.red   + '"/>' +
      '<circle cx="' + C + '" cy="' + C + '" r="' + W.rRimIn   + '" fill="' + NS.INK.cream + '"/>' +
      '<circle cx="' + C + '" cy="' + C + '" r="' + W.rHairIn  + '" fill="' + NS.INK.red   + '"/>' +
      '<circle cx="' + C + '" cy="' + C + '" r="' + W.rLabelIn + '" fill="' + NS.INK.cream + '"/>';

    NS.SEGMENTS.forEach(function (s, i) {
      var dead = soldOut && soldOut.indexOf(s.id) !== -1;

      if (dead) {
        body += '<path d="' + wedge(s.start, s.span, W.rLabelIn, W.rHairIn) +
                '" fill="' + NS.INK.redSold + '"/>';
      }

      // divider, from the inner gap out to the rim
      body += '<line x1="' + pt(W.rGapIn, s.start).split(" ")[0] +
              '" y1="' + pt(W.rGapIn, s.start).split(" ")[1] +
              '" x2="' + pt(W.rOuter, s.start).split(" ")[0] +
              '" y2="' + pt(W.rOuter, s.start).split(" ")[1] +
              '" stroke="' + NS.INK.cream + '" stroke-width="6"/>';

      // label text on its own arc, centred in the wedge
      var col = dead ? NS.INK.labelDead : NS.INK.cream;
      var op = dead ? ".55" : "1";

      function put(txt, r, tag) {
        var id = "tp" + i + tag;
        defs += '<path id="' + id + '" fill="none" d="' + arcSeg(r, s.start, s.span) + '"/>';
        var fs = SIZE;
        // xlink:href alongside href on every textPath (section 2)
        return '<text data-seg="' + s.id + '" data-line="' + tag + '" ' +
               'font-family="WinSoft Pro, Arial Black, Impact, sans-serif" ' +
               'font-weight="700" font-size="' + fs + '" fill="' + col + '" opacity="' + op + '">' +
               '<textPath href="#' + id + '" xlink:href="#' + id + '" ' +
               'startOffset="50%" text-anchor="middle">' + esc(txt) + '</textPath></text>';
      }

      if (s.lines.length > 1) {
        body += put(s.lines[0], LR.a, "a") + put(s.lines[1], LR.b, "b");
      } else {
        body += put(s.lines[0], W.rSingle, "c");
      }

      if (dead) {
        var sid = "tp" + i + "s";
        defs += '<path id="' + sid + '" fill="none" d="' + arcSeg(rStamp, s.start, s.span) + '"/>';
        body += '<text data-seg="' + s.id + '" data-line="stamp" ' +
                'font-family="WinSoft Pro, Arial Black, Impact, sans-serif" ' +
                'font-weight="700" font-size="24" fill="' + NS.INK.gold + '" letter-spacing="3">' +
                '<textPath href="#' + sid + '" xlink:href="#' + sid + '" ' +
                'startOffset="50%" text-anchor="middle">' + esc(NS.COPY.soldOutStamp) + '</textPath></text>';
      }
    });

    return '<defs>' + defs + '</defs>' + body;
  }

  /* Build the whole <svg> as markup on a plain div. innerHTML on an
     SVG element itself is unsupported on older Android WebViews
     (BUILD-SPEC section 2), so the div is the injection point. */
  function paint(soldOut) {
    var sig = (soldOut || []).slice().sort().join(",");
    if (sig === painted) return false;
    host.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
      'viewBox="0 0 ' + W.size + ' ' + W.size + '">' + buildRingSVG(soldOut) + '</svg>';
    painted = sig;
    return true;
  }

  function discApply() {
    if (!discVid) return;
    var want = DISC.on && !DISC.failed;
    if (want) discVid.className = "";
    else discVid.className = "off";
    if (!want) { try { discVid.pause(); } catch (e) {} return; }
    try {
      var p = discVid.play();
      if (p && p["catch"]) {
        p["catch"](function (e) {
          // AbortError only means a newer play superseded this one
          var n = String(e && e.name ? e.name : e);
          if (n.indexOf("AbortError") !== -1) return;
          discFail(n);
        });
      }
    } catch (e) { discFail(String(e)); }
  }

  function discFail(why) {
    DISC.failed = true;
    if (NS.Store) NS.Store.lastError = "animated disc unavailable: " + why;
    discApply();
  }

  function initDisc() {
    discVid = document.getElementById("discVid");
    if (!discVid) { DISC.failed = true; return; }
    discVid.addEventListener("error", function () {
      discFail("decode or load error");
    }, false);
    // some Android builds block autoplay until the first gesture
    function kick() {
      if (DISC.on && !DISC.failed && discVid.paused) {
        try { discVid.play()["catch"](function () {}); } catch (e) {}
      }
    }
    window.addEventListener("touchstart", kick, false);
    window.addEventListener("click", kick, false);
    discApply();
  }

  /* ---- public --------------------------------------------------- */

  NS.Wheel = {
    init: function () {
      host    = document.getElementById("ringHost");
      wheelEl = document.getElementById("wheel");
      discEl  = document.getElementById("discImg");
      initDisc();
      paint([]);
      this.setRotation(0);
    },

    /* The disc animation, as staff see it. */
    disc: {
      settings: DISC,
      apply: discApply,
      set: function (on, pauseOnSpin) {
        DISC.on = !!on;
        DISC.pauseOnSpin = !!pauseOnSpin;
        discApply();
      },
      // called by the spin, and only acts when staff have asked for it
      spinStart: function () {
        if (DISC.on && !DISC.failed && DISC.pauseOnSpin && discVid) {
          try { discVid.pause(); } catch (e) {}
        }
      },
      spinEnd: function () {
        if (DISC.on && !DISC.failed && DISC.pauseOnSpin) discApply();
      },
      status: function () {
        if (DISC.failed) return "failed, showing the still";
        if (!DISC.on) return "off, showing the still";
        return DISC.pauseOnSpin ? "on, paused during a spin" : "on";
      }
    },

    // called only when stock changes (section 6)
    paint: paint,

    setRotation: function (deg) {
      rotation = deg;
      // one transform, one composited layer. The hub is a sibling
      // overlay and deliberately does not rotate.
      wheelEl.style.transform = "rotate(" + deg + "deg)";
    },

    getRotation: function () { return rotation; },

    // which segment is under the pointer at the top for a given rotation
    segmentAtTop: function (rot) {
      var at = NS.norm360(-rot), i, s, a, b, v;
      for (i = 0; i < NS.SEGMENTS.length; i++) {
        s = NS.SEGMENTS[i];
        a = s.start; b = s.start + s.span;
        v = at; if (b > 360 && v < a) v += 360;
        if (v >= a && v < b) return i;
      }
      return 0;
    },

    // exposed for the stage-2 label check in tools/
    _internals: { arcSeg: arcSeg, wedge: wedge, fitSize: fitSize, pt: pt,
                  uniformSize: uniformSize, lineRadii: lineRadii }
  };
})(window.JPH = window.JPH || {});
