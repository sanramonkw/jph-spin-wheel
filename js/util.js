/* ------------------------------------------------------------------
   util.js — small shared helpers. No dependencies.
------------------------------------------------------------------ */
(function (NS) {
  "use strict";

  /* ---- unbiased randomness (BUILD-SPEC section 7) ---------------
     crypto.getRandomValues drained from a buffered pool. Never
     Math.random. Ported verbatim from reference/prototype.html. */
  var _pool = new Uint32Array(2048);
  var _pi = _pool.length;

  NS.rand = function () {
    if (_pi >= _pool.length) { crypto.getRandomValues(_pool); _pi = 0; }
    return _pool[_pi++] / 4294967296;      // [0,1)
  };

  NS.pick = function (w) {
    var total = 0, i, r;
    for (i = 0; i < w.length; i++) total += w[i];
    r = NS.rand() * total;
    for (i = 0; i < w.length; i++) { r -= w[i]; if (r < 0) return i; }
    return w.length - 1;
  };

  /* ---- dom ------------------------------------------------------ */
  NS.$ = function (sel, root) { return (root || document).querySelector(sel); };
  NS.$$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };
  NS.el = function (tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  /* ---- misc ----------------------------------------------------- */
  NS.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };

  // normalise degrees to [0, 360)
  NS.norm360 = function (d) { return ((d % 360) + 360) % 360; };

  // {tokens} replaced from a plain object; unknown tokens are left alone
  NS.fill = function (str, vars) {
    return String(str).replace(/\{(\w+)\}/g, function (m, k) {
      return (vars && vars[k] != null) ? vars[k] : m;
    });
  };

  NS.bytes = function (n) {
    if (n == null) return "unknown";
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  };

  // local YYYY-MM-DD. Never toISOString — that is UTC and would flip
  // the daily bucket at the wrong hour. The device clock is load-bearing.
  NS.localDate = function (d) {
    d = d || new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  };

})(window.JPH = window.JPH || {});
