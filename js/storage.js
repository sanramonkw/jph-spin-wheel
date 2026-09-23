/* ------------------------------------------------------------------
   storage.js — localStorage access (BUILD-SPEC section 3).

   One JSON blob per concern, not per-record keys: fewer writes, and
   each write is atomic. Every read and write is wrapped, and callers
   must render correctly when storage returns empty.
------------------------------------------------------------------ */
(function (NS) {
  "use strict";

  var PREFIX = "jph.";
  var Store = {};

  Store.available = (function () {
    try {
      var k = PREFIX + "__probe";
      localStorage.setItem(k, "1");
      localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  })();

  // last write error, surfaced in diagnostics so a silently full or
  // blocked storage cannot go unnoticed for three days
  Store.lastError = null;

  Store.read = function (key, fallback) {
    try {
      var raw = localStorage.getItem(PREFIX + key);
      if (raw === null || raw === "") return fallback;
      return JSON.parse(raw);
    } catch (e) {
      Store.lastError = "read " + key + ": " + e;
      return fallback;
    }
  };

  Store.write = function (key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      Store.lastError = "write " + key + ": " + e;
      return false;
    }
  };

  Store.remove = function (key) {
    try { localStorage.removeItem(PREFIX + key); return true; }
    catch (e) { Store.lastError = "remove " + key + ": " + e; return false; }
  };

  // every key this app owns, for export/import and full reset (stage 9)
  Store.keys = function () {
    var out = [], i, k;
    try {
      for (i = 0; i < localStorage.length; i++) {
        k = localStorage.key(i);
        if (k && k.indexOf(PREFIX) === 0) out.push(k.slice(PREFIX.length));
      }
    } catch (e) { Store.lastError = "keys: " + e; }
    return out;
  };

  /* ---- persistent storage ---------------------------------------
     The coupon inventory lives here for three days. Ask for
     persistence on boot; report the answer rather than assuming it. */
  Store.persisted = null;   // true | false | "unsupported"

  Store.requestPersist = function (done) {
    if (!navigator.storage || !navigator.storage.persist) {
      Store.persisted = "unsupported";
      if (done) done(Store.persisted);
      return;
    }
    try {
      navigator.storage.persisted().then(function (already) {
        if (already) {
          Store.persisted = true;
          if (done) done(true);
          return;
        }
        navigator.storage.persist().then(function (granted) {
          Store.persisted = !!granted;
          if (done) done(Store.persisted);
        })["catch"](function () {
          Store.persisted = false;
          if (done) done(false);
        });
      })["catch"](function () {
        Store.persisted = "unsupported";
        if (done) done(Store.persisted);
      });
    } catch (e) {
      Store.persisted = "unsupported";
      if (done) done(Store.persisted);
    }
  };

  Store.estimate = function (done) {
    if (!navigator.storage || !navigator.storage.estimate) { done(null); return; }
    try {
      navigator.storage.estimate().then(done)["catch"](function () { done(null); });
    } catch (e) { done(null); }
  };

  NS.Store = Store;
})(window.JPH = window.JPH || {});
