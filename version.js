/* Single source of truth for the build version.
   Loaded as a classic script by index.html and via importScripts() by sw.js,
   so it must not use modules, const-exports or top-level await. */
(function (scope) {
  "use strict";
  scope.JPH_VERSION = "0.20.0";          // bump on every deploy
  scope.JPH_BUILD   = "2026-09-22";     // informational, shown in diagnostics
  scope.JPH_CACHE   = "jph-wheel-v0.20.0";
})(typeof self !== "undefined" ? self : this);
