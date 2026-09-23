/* ------------------------------------------------------------------
   sw.js — offline app shell (BUILD-SPEC section 3).

   Cache-first, always. After the first successful install the app
   never depends on the network again.

   DO NOT AUTO-UPDATE. A new worker installs but then waits; it takes
   over only when the admin panel explicitly sends SKIP_WAITING. A
   silent swap mid-afternoon in front of a live crowd is a hazard.
------------------------------------------------------------------ */
"use strict";

importScripts("version.js");           // defines self.JPH_CACHE / JPH_VERSION

var CACHE = self.JPH_CACHE;

/* Every file the app needs to boot with no network.
   tools/verify-precache.js checks this against what is on disk —
   run it before every deploy. A missing entry is an offline failure
   that will only show up at the venue. */
var PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./version.js",
  "./css/app.css",
  "./js/config.js",
  "./js/util.js",
  "./js/storage.js",
  "./js/stage.js",
  "./js/wheel.js",
  "./js/audio.js",
  "./js/spin.js",
  "./js/inventory.js",
  "./js/stockpanel.js",
  "./js/admin.js",
  "./js/qr.js",
  "./js/character.js",
  "./js/result.js",
  "./js/attract.js",
  "./js/auth.js",
  "./js/backup.js",
  "./js/tests.js",
  "./js/install.js",
  "./js/sw-register.js",
  "./js/diagnostics.js",
  "./js/boot.js",
  "./assets/bg.webp",
  "./assets/disc.webp",
  "./assets/disc-anim.mp4",
  "./assets/react-win.webm",
  "./assets/react-lose.webm",
  "./assets/winsoft.woff2",
  "./assets/destruction.woff2",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // addAll is atomic: one 404 fails the whole install, which is
      // what we want — a half-cached shell is worse than none.
      return c.addAll(PRECACHE);
    })
    // deliberately no skipWaiting()
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (n) {
        return n === CACHE ? null : caches["delete"](n);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;   // nothing external exists at runtime

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;

      return fetch(req).then(function (res) {
        // opportunistically cache anything the precache list missed
        if (res && res.status === 200 && res.type === "basic") {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      })["catch"](function () {
        // offline and not cached: a navigation still gets the shell
        if (req.mode === "navigate") return caches.match("./index.html");
        return new Response("", { status: 504, statusText: "Offline, not cached" });
      });
    })
  );
});

self.addEventListener("message", function (e) {
  var d = e.data || {};
  if (d.type === "SKIP_WAITING") self.skipWaiting();
  if (d.type === "VERSION" && e.ports && e.ports[0]) {
    e.ports[0].postMessage({ version: self.JPH_VERSION, cache: CACHE });
  }
  // Diagnostics asks which shell files are actually in the cache. This is
  // the check that proves the app will boot with the network removed.
  if (d.type === "PRECACHE_STATUS" && e.ports && e.ports[0]) {
    var port = e.ports[0];
    caches.open(CACHE).then(function (c) {
      return Promise.all(PRECACHE.map(function (u) {
        return c.match(u, { ignoreSearch: true }).then(function (hit) {
          return { url: u, cached: !!hit };
        });
      }));
    }).then(function (rows) {
      var missing = rows.filter(function (r) { return !r.cached; })
                        .map(function (r) { return r.url; });
      port.postMessage({
        version: self.JPH_VERSION, cache: CACHE,
        total: PRECACHE.length, missing: missing
      });
    })["catch"](function (err) {
      port.postMessage({ error: String(err) });
    });
  }
});
