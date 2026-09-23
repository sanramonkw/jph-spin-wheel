/* ------------------------------------------------------------------
   auth.js — the gate on the staff panel (BUILD-SPEC §12).

   THIS IS NOT SECURITY, AND IT CANNOT BE.

   The credentials below are in the page source, which anyone can read.
   Nothing client-side can be. What this does is keep attendees out of
   the stock and odds screens during a busy event, which is the actual
   threat model — a curious teenager with thirty seconds, not an
   attacker with a laptop.

   Consequences that follow from that, and must not be forgotten:
     - never reuse these credentials anywhere else
     - nothing behind this gate is confidential
     - do not add anything here that would matter if it leaked

   The session ends after 5 minutes idle and on every app reload (§12),
   so a panel left unattended with the panel open locks itself.
------------------------------------------------------------------ */
(function (NS) {
  "use strict";

  /* Configured at build time. Change them before the event and tell the
     staff who need them; see docs/TESTING.md. */
  var USER = "jph";
  var PASS = "wheel2026";

  var authed = false;
  var idleTimer = null;
  var lastActivity = 0;

  function armIdle() {
    lastActivity = new Date().getTime();
    if (idleTimer) clearInterval(idleTimer);
    idleTimer = setInterval(function () {
      if (!authed) return;
      if (new Date().getTime() - lastActivity > NS.TIMING.adminIdleTimeoutMs) {
        Auth.logout();
        if (Auth.onTimeout) Auth.onTimeout();
      }
    }, 5000);
  }

  var Auth = {
    /* Deliberately not a getter on a public field: everything that
       gates on this calls the function, so there is one place to look. */
    isAuthed: function () { return authed; },

    attempt: function (user, pass) {
      // Session-only, never written to storage: §12 says the session ends
      // on reload, and storing it would defeat that.
      if (String(user) === USER && String(pass) === PASS) {
        authed = true;
        armIdle();
        return true;
      }
      return false;
    },

    touch: function () { lastActivity = new Date().getTime(); },

    logout: function () {
      authed = false;
      if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
    },

    idleRemainingMs: function () {
      if (!authed) return 0;
      var left = NS.TIMING.adminIdleTimeoutMs - (new Date().getTime() - lastActivity);
      return left > 0 ? left : 0;
    },

    onTimeout: null
  };

  NS.Auth = Auth;
})(window.JPH = window.JPH || {});
