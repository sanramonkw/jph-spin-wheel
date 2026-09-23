/* ------------------------------------------------------------------
   character.js — the character reaction layer (BUILD-SPEC §9.6).

   The interface is the point, and it has not changed:

       CharacterView.setPose('idle' | 'win' | 'lose')

   Nothing outside this file knows how the character is drawn. That is
   what let the still be swapped for animation without touching the
   popup, the result logic or the layout, and it is what will let the
   rigged puppet replace both later (§15).

   WHAT IT DRAWS NOW. Two supplied clips, chroma-keyed off their green
   screen and re-encoded as VP9 WebM with a real alpha channel, so the
   browser composites them natively. Doing the key per frame in JS on a
   panel with an unknown GPU would have been the wrong trade (§19).

   They play once and hold on the last frame rather than looping: they
   are reactions, not idles, and the poses genuinely change through the
   clip, so a loop would jump.

   FALLBACK MATTERS HERE. VP9 alpha needs a Chromium WebView of a
   reasonable vintage, and the panel's version is still unknown (§18
   item 4). If the video will not play for any reason, this falls back
   to the still cut from the character disc. The popup never knows.
------------------------------------------------------------------ */
(function (NS) {
  "use strict";

  var host = null, img = null, vids = {}, pose = "idle";
  var videoOK = true;          // flipped false the first time one fails

  /* Wedge of the character disc used for the still fallback. The
     characters on that disc face INWARD — each head points at the hub —
     so the wedge is rotated to the BOTTOM, where "inward" points up.
     Rotating it to the top renders every face upside down. */
  var POSE_WEDGE = { idle: 1, win: 4, lose: 9 };
  var FACE_R = 0.58;
  var DISC_PX = 1250;

  function wedgeCentre(i) {
    var sp = NS.DISC_SPOKES;
    var a = sp[i];
    var b = (i + 1 < sp.length) ? sp[i + 1] : sp[0] + 360;
    return ((a + b) / 2) % 360;
  }

  function applyStill() {
    if (!img) return;
    var i = POSE_WEDGE[pose];
    if (i === undefined) i = POSE_WEDGE.idle;
    img.style.transform = "rotate(" + (180 - wedgeCentre(i)).toFixed(2) + "deg)";
  }

  function stopAll() {
    var k;
    for (k in vids) {
      if (!Object.prototype.hasOwnProperty.call(vids, k)) continue;
      vids[k].hidden = true;
      try { vids[k].pause(); } catch (e) { /* ignore */ }
    }
  }

  function fallBack(why) {
    videoOK = false;
    if (NS.Store) NS.Store.lastError = "character video unavailable: " + why;
    stopAll();
    if (host) host.setAttribute("data-mode", "still");
    applyStill();
  }

  function playPose(p) {
    var v = vids[p];
    if (!videoOK || !v) { applyStill(); return; }
    stopAll();
    v.hidden = false;
    try {
      v.currentTime = 0;
      var pr = v.play();
      // play() returns a promise in anything modern; older WebViews do not
      if (pr && pr["catch"]) {
        pr["catch"](function (e) {
          var name = String(e && e.name ? e.name : e);
          /* AbortError just means this play was superseded — a second
             result opened before the first had started. That is normal
             and says nothing about whether the clip works. Treating it
             as a failure disabled video permanently for the rest of the
             session the first time two spins came close together. */
          if (name.indexOf("AbortError") !== -1) return;
          fallBack(name);
        });
      }
    } catch (e) {
      fallBack(String(e));
    }
  }

  NS.CharacterView = {
    init: function () {
      host = document.getElementById("charView");
      if (!host) return;
      img = document.getElementById("charImg");
      vids.win = document.getElementById("charWin");
      vids.lose = document.getElementById("charLose");

      if (img) {
        img.style.width = DISC_PX + "px";
        img.style.height = DISC_PX + "px";
        img.style.left = "calc(50% - " + (DISC_PX / 2) + "px)";
        img.style.top = "calc(50% - " + (DISC_PX / 2 * (1 + FACE_R)) + "px)";
      }

      var k;
      for (k in vids) {
        if (!Object.prototype.hasOwnProperty.call(vids, k)) continue;
        if (!vids[k]) { videoOK = false; continue; }
        vids[k].addEventListener("error", function () {
          fallBack("decode or load error");
        }, false);
      }
      host.setAttribute("data-mode", videoOK ? "video" : "still");
      applyStill();
    },

    /* The whole public surface. Keep it. */
    setPose: function (next) {
      if (next !== "idle" && next !== "win" && next !== "lose") next = "idle";
      pose = next;
      if (host) host.setAttribute("data-pose", pose);
      /* Keep the still in step even while video is playing. It costs one
         transform, and it means a clip that fails halfway through the
         event falls back to the RIGHT character rather than whichever
         one was last shown as a still. */
      applyStill();
      if (pose === "idle") { stopAll(); return; }
      playPose(pose);
    },

    getPose: function () { return pose; },

    usingVideo: function () { return videoOK; },

    /* Entry animation, §9.6: scale from 0.8 with overshoot. Restarting a
       CSS animation needs the class off, a reflow, then the class back. */
    enter: function () {
      if (!host) return;
      host.classList.remove("enter");
      void host.offsetWidth;
      host.classList.add("enter");
    }
  };
})(window.JPH = window.JPH || {});
