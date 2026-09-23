/* ------------------------------------------------------------------
   sw-register.js — service worker lifecycle, controlled by staff.

   Registration happens on boot. Updates do NOT. checkForUpdate() is
   wired to the admin panel's explicit button (BUILD-SPEC section 3);
   applyUpdate() is the only path that swaps the worker, and it
   reloads immediately so nothing runs half-old.
------------------------------------------------------------------ */
(function (NS) {
  "use strict";

  var SW = {
    supported: ("serviceWorker" in navigator),
    secure: (window.isSecureContext === true),
    registration: null,
    state: "unknown",       // unknown | unsupported | insecure | registering
                            // | active | waiting | failed
    error: null,
    updateReady: false
  };

  function setState(s) {
    SW.state = s;
    if (NS.onSWState) NS.onSWState(SW);
  }

  SW.register = function (done) {
    if (!SW.supported) { setState("unsupported"); if (done) done(SW); return; }
    if (!SW.secure) {
      // http:// on a LAN address is not a secure context, so the worker
      // will never register there. See docs/TESTING.md.
      setState("insecure"); if (done) done(SW); return;
    }
    setState("registering");
    navigator.serviceWorker.register("sw.js", { scope: "./" })
      .then(function (reg) {
        SW.registration = reg;
        if (reg.waiting) { SW.updateReady = true; setState("waiting"); }
        else setState(navigator.serviceWorker.controller ? "active" : "registering");

        reg.addEventListener("updatefound", function () {
          var nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", function () {
            if (nw.state === "installed") {
              if (navigator.serviceWorker.controller) {
                SW.updateReady = true; setState("waiting");   // held back on purpose
              } else {
                setState("active");                            // first install complete
              }
            }
          });
        });
        if (done) done(SW);
      })["catch"](function (err) {
        SW.error = String(err);
        setState("failed");
        if (done) done(SW);
      });

    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (SW._applying) window.location.reload();
    });
  };

  // admin: "Check for update" — reports, does not apply
  SW.checkForUpdate = function (done) {
    if (!SW.registration) { done({ ok: false, message: "No service worker registered." }); return; }
    SW.registration.update().then(function () {
      if (SW.registration.waiting) {
        SW.updateReady = true;
        done({ ok: true, updateReady: true, message: "An update is ready to install." });
      } else {
        done({ ok: true, updateReady: false, message: "Already up to date." });
      }
    })["catch"](function (err) {
      done({ ok: false, message: "Could not check: " + err });
    });
  };

  // admin: apply the held update, then reload
  SW.applyUpdate = function () {
    if (!SW.registration || !SW.registration.waiting) return false;
    SW._applying = true;
    SW.registration.waiting.postMessage({ type: "SKIP_WAITING" });
    return true;
  };

  SW.unregisterAll = function (done) {
    if (!SW.supported) { done(false); return; }
    navigator.serviceWorker.getRegistrations().then(function (rs) {
      return Promise.all(rs.map(function (r) { return r.unregister(); }));
    }).then(function () { done(true); })["catch"](function () { done(false); });
  };

  NS.SW = SW;
})(window.JPH = window.JPH || {});
