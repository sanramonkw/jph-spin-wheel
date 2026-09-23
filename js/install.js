/* ------------------------------------------------------------------
   install.js — installing to the home screen, from inside the app.

   BUILD-SPEC §3 says to install as a PWA via "Add to Home Screen". On
   a signage panel that menu item can be hard to find, renamed, or
   absent entirely depending on which browser the panel ships with — and
   there is no address bar and no devtools to work it out from.

   So the app captures Chrome's install prompt itself and offers it as a
   button in the staff panel. Chrome only fires `beforeinstallprompt`
   when it considers the app installable, which makes the button's
   presence a diagnosis in itself: if it never appears, the browser has
   decided something is wrong, and the checks below narrow down what.

   Why this matters beyond convenience: navigator.storage.persist() is
   granted on engagement signals, and being installed is the main one.
   Until it is granted, Android may evict the coupon inventory — which
   is three days of event state.
------------------------------------------------------------------ */
(function (NS) {
  "use strict";

  var deferred = null;
  var Install = {
    supported: false,     // did the browser ever offer us the prompt
    installed: false,
    lastOutcome: null,
    manifest: null,       // what the manifest actually fetched as
    manifestError: null
  };

  function standalone() {
    try {
      if (window.matchMedia &&
          window.matchMedia("(display-mode: standalone)").matches) return true;
      if (window.matchMedia &&
          window.matchMedia("(display-mode: fullscreen)").matches) return true;
      if (window.navigator.standalone) return true;    // iOS-style WebViews
    } catch (e) { /* ignore */ }
    return false;
  }

  Install.isInstalled = function () {
    return Install.installed || standalone();
  };

  Install.available = function () {
    return !!deferred;
  };

  Install.prompt = function (done) {
    if (!deferred) { done({ ok: false, message: "The browser has not offered an install prompt." }); return; }
    var d = deferred;
    deferred = null;                    // a prompt can only be used once
    try {
      d.prompt();
      d.userChoice.then(function (choice) {
        Install.lastOutcome = choice && choice.outcome;
        done({ ok: true, outcome: Install.lastOutcome,
               message: Install.lastOutcome === "accepted"
                 ? "Installing. Open it from the home screen icon, not from the browser."
                 : "Dismissed. Reopen this panel to try again." });
      })["catch"](function (e) {
        done({ ok: false, message: String(e) });
      });
    } catch (e) {
      done({ ok: false, message: String(e) });
    }
  };

  /* Fetch and parse the manifest ourselves. On an unknown host this is
     where wrong content types and 404s show up, and those are exactly
     what stop a browser offering to install. */
  Install.checkManifest = function (done) {
    var link = document.querySelector('link[rel="manifest"]');
    if (!link) { Install.manifestError = "no <link rel=manifest> in the page"; done(); return; }
    var url = link.href;
    try {
      fetch(url).then(function (r) {
        if (!r.ok) {
          Install.manifestError = "HTTP " + r.status + " fetching the manifest";
          done(); return;
        }
        var type = r.headers.get("content-type") || "(none)";
        return r.json().then(function (j) {
          Install.manifest = {
            url: url, type: type,
            name: j.name, display: j.display, scope: j.scope, start: j.start_url,
            icons: (j.icons || []).map(function (i) { return i.sizes + " " + i.purpose; })
          };
          done();
        })["catch"](function () {
          Install.manifestError = "manifest did not parse as JSON (served as " + type + ")";
          done();
        });
      })["catch"](function (e) {
        Install.manifestError = "could not fetch the manifest: " + e;
        done();
      });
    } catch (e) {
      Install.manifestError = "fetch unavailable: " + e;
      done();
    }
  };

  /* Everything the browser weighs up, as far as the page can see it.
     Not authoritative — only the browser knows — but it catches the
     things that actually go wrong on an unfamiliar host. */
  Install.reasons = function () {
    var out = [];
    if (!window.isSecureContext) out.push("not a secure context — needs https");
    if (!("serviceWorker" in navigator)) out.push("no service worker support in this browser");
    else if (!navigator.serviceWorker.controller) out.push("no service worker controlling the page yet — reload once");
    if (Install.manifestError) out.push(Install.manifestError);
    else if (Install.manifest) {
      var m = Install.manifest;
      if (!/manifest\+json|application\/json/.test(m.type)) {
        out.push("manifest served as " + m.type + ", which some browsers reject");
      }
      if (["fullscreen", "standalone", "minimal-ui"].indexOf(m.display) === -1) {
        out.push("manifest display is " + m.display + ", which is not installable");
      }
      var has192 = false, has512 = false;
      (m.icons || []).forEach(function (s) {
        if (s.indexOf("192x192") === 0) has192 = true;
        if (s.indexOf("512x512") === 0) has512 = true;
      });
      if (!has192 || !has512) out.push("manifest is missing a 192px or 512px icon");
    }
    if (!("BeforeInstallPromptEvent" in window) && !deferred && !Install.isInstalled()) {
      out.push("this browser does not implement the install prompt at all " +
               "(common on vendor browsers and in a plain WebView) — " +
               "use Fully Kiosk Browser instead, see docs/DEPLOY.md");
    }
    return out;
  };

  NS.Install = {
    init: function () {
      /* Chrome fires this only when it considers the app installable.
         Capturing it stops the browser's own banner and lets the staff
         panel offer the install at a moment of its choosing. */
      window.addEventListener("beforeinstallprompt", function (e) {
        e.preventDefault();
        deferred = e;
        Install.supported = true;
        if (NS.onInstallReady) NS.onInstallReady();
      }, false);

      window.addEventListener("appinstalled", function () {
        Install.installed = true;
        deferred = null;
      }, false);

      Install.checkManifest(function () { /* read by the staff panel */ });
    },
    state: Install,
    available: Install.available,
    isInstalled: Install.isInstalled,
    prompt: Install.prompt,
    reasons: Install.reasons,
    checkManifest: Install.checkManifest
  };
})(window.JPH = window.JPH || {});
