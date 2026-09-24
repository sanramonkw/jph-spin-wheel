/* ------------------------------------------------------------------
   lock.js — the staff pause.

   Press and hold the TOP-LEFT corner for two seconds to pause the wheel.
   The same gesture resumes it.

   Why the top-left: BUILD-SPEC §5 observes that on a tall panel on a
   stand the top of the screen is above many people's reach. That makes a
   top corner naturally staff-only — no password and no menu, but an
   attendee cannot reach it by accident either. The bottom-left corner is
   already the admin panel, so the two do not collide.

   WHY IT SHOWS A SCREEN RATHER THAN JUST GOING DEAD. A kiosk that stops
   responding looks broken, and people hammer the glass. One that says it
   is paused looks staffed. That is most of the value here.

   Deliberately NOT persisted. A reboot comes back unpaused, so a panel
   cannot be left dead overnight because somebody paused it and went home.

   This is an overlay, not a state in the state machine (§11). Pausing can
   happen during any state and has to return to exactly that state, so
   modelling it as a state would mean an exit from every other one. The
   machine stays four-cornered and this sits over the top.
------------------------------------------------------------------ */
(function (NS) {
  "use strict";

  var locked = false;
  var pressTimer = null;

  function apply() {
    if (locked) document.body.setAttribute("data-paused", "1");
    else document.body.removeAttribute("data-paused");

    if (locked) {
      NS.Attract.stop();
      NS.Audio.musicStop(true);
      NS.Audio.reactionStop();
    } else {
      // back to whatever the app should be showing
      NS.settleState();
    }
    if (NS.onLockChange) NS.onLockChange(locked);
  }

  function lock() { if (!locked) { locked = true; apply(); } }
  function unlock() { if (locked) { locked = false; apply(); } }
  function toggle() { locked = !locked; apply(); }

  function bindGesture() {
    var corner = document.getElementById("pauseCorner");
    if (!corner) return;

    function start() {
      if (pressTimer) return;
      pressTimer = setTimeout(function () {
        pressTimer = null;
        toggle();
      }, NS.TIMING.pauseLongPressMs);
    }
    function cancel() {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    }

    corner.addEventListener("touchstart", start, false);
    corner.addEventListener("touchend", cancel, false);
    corner.addEventListener("touchcancel", cancel, false);
    corner.addEventListener("touchmove", cancel, false);
    corner.addEventListener("mousedown", start, false);
    corner.addEventListener("mouseup", cancel, false);
    corner.addEventListener("mouseleave", cancel, false);
    corner.addEventListener("contextmenu", function (e) { e.preventDefault(); }, false);

    /* The overlay swallows every other tap while paused. The two corner
       gestures sit above it so staff are never locked out of their own
       panel, or out of resuming. */
    var overlay = document.getElementById("paused");
    if (overlay) {
      overlay.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
      }, false);
    }
  }

  NS.Lock = {
    init: function () {
      bindGesture();
      apply();
    },
    isLocked: function () { return locked; },
    lock: lock,
    unlock: unlock,
    toggle: toggle
  };
})(window.JPH = window.JPH || {});
