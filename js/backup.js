/* ------------------------------------------------------------------
   backup.js — export, import, restore (BUILD-SPEC §3 and §12).

   "Everything on one device is a single point of failure." Three days
   of coupon inventory live in one panel's localStorage, so this exists
   to get it off the device and back onto a replacement in minutes.

   Two export formats, for two different jobs:
     JSON  the whole state — config, stock, log, settings. This is what
           restores a backup panel.
     CSV   the winners log only, for whoever reconciles coupons after
           the event. Opens in a spreadsheet, no tooling needed.

   Downloads on a kiosk browser are not reliable, so every export also
   renders into a selectable text box. If the download is blocked, staff
   can still select all and paste it somewhere. Import accepts a pasted
   blob for the same reason.
------------------------------------------------------------------ */
(function (NS) {
  "use strict";

  var KEYS = ["config", "inventory", "log", "settings"];
  var FORMAT = 1;

  function snapshot() {
    var out = {
      format: FORMAT,
      app: "jph-wheel",
      version: NS.version,
      exportedAt: new Date().toISOString(),
      exportedDate: NS.localDate(new Date()),
      data: {}
    };
    for (var i = 0; i < KEYS.length; i++) {
      out.data[KEYS[i]] = NS.Store.read(KEYS[i], null);
    }
    return out;
  }

  function toJSON() {
    return JSON.stringify(snapshot(), null, 2);
  }

  /* ---- CSV of the winners log --------------------------------------
     Excel and Sheets both guess the delimiter from the first line, and
     both mangle a leading "=" or "+", so every field is quoted. */
  function csvCell(v) {
    if (v === null || v === undefined) return '""';
    return '"' + String(v).replace(/"/g, '""') + '"';
  }

  function toCSV() {
    var log = NS.Store.read("log", []);
    var cfg = NS.Inventory.config();
    var rows = [
      ["timestamp", "date", "day", "segment", "tier", "prize", "outcome",
       "reference", "code issued", "remaining after", "test mode",
       "handed over", "confirmed at"]
        .map(csvCell).join(",")
    ];
    for (var i = 0; i < log.length; i++) {
      var e = log[i];
      var prize = e.prize ? (cfg.prizes[e.prize] || {}) : {};
      rows.push([
        new Date(e.t).toISOString(),
        e.date,
        e.day === null || e.day === undefined ? "" : (e.day + 1),
        e.seg,
        e.prize || "",
        prize.label || "",
        e.win ? "win" : (e.soldOut ? "landed on a sold-out prize" : "hard luck"),
        e.ref || "",
        e.code || "",
        e.remainingAfter === undefined ? "" : e.remainingAfter,
        e.test ? "yes" : "no",
        (!e.win || e.test) ? "" : (e.ack ? "yes" : "NOT CONFIRMED"),
        e.ack ? new Date(e.ack).toISOString() : ""
      ].map(csvCell).join(","));
    }
    return rows.join("\r\n");
  }

  /* ---- download ----------------------------------------------------
     Best effort. A kiosk browser may refuse, which is why the caller
     also shows the text. */
  function download(filename, text, mime) {
    var ok = false;
    try {
      var blob = new Blob([text], { type: (mime || "text/plain") + ";charset=utf-8" });
      var url = (window.URL || window.webkitURL).createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        document.body.removeChild(a);
        (window.URL || window.webkitURL).revokeObjectURL(url);
      }, 2000);
      ok = true;
    } catch (e) {
      NS.Store.lastError = "download: " + e;
    }
    return ok;
  }

  function stamp() {
    var d = new Date();
    return NS.localDate(d) + "-" + ("0" + d.getHours()).slice(-2) +
           ("0" + d.getMinutes()).slice(-2);
  }

  /* ---- import ------------------------------------------------------
     Validated before anything is written. A half-applied import on a
     replacement panel would be worse than no import at all. */
  function validate(obj) {
    if (!obj || typeof obj !== "object") return "Not an object.";
    if (obj.app !== "jph-wheel") return "Not a JPH wheel export (app is " + obj.app + ").";
    if (obj.format !== FORMAT) return "Export format " + obj.format + ", this build reads " + FORMAT + ".";
    if (!obj.data || typeof obj.data !== "object") return "No data block.";
    // the log is the part nobody can reconstruct, so check its shape
    if (obj.data.log !== null && obj.data.log !== undefined) {
      if (!(obj.data.log instanceof Array)) return "The log is not a list.";
    }
    return null;
  }

  function summarise(obj) {
    var d = obj.data || {};
    var log = d.log || [];
    var wins = 0, i;
    for (i = 0; i < log.length; i++) if (log[i].win) wins++;
    var tiers = 0;
    if (d.inventory && d.inventory.remaining) {
      for (var k in d.inventory.remaining) {
        if (Object.prototype.hasOwnProperty.call(d.inventory.remaining, k)) tiers++;
      }
    }
    return {
      exportedAt: obj.exportedAt, version: obj.version,
      spins: log.length, wins: wins, tiers: tiers,
      dates: (d.config && d.config.event && d.config.event.dates) || null
    };
  }

  function apply(obj) {
    var err = validate(obj);
    if (err) return { ok: false, message: err };
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i];
      var v = obj.data[k];
      if (v === null || v === undefined) NS.Store.remove(k);
      else if (!NS.Store.write(k, v)) {
        return { ok: false, message: "Could not write " + k + ": " + NS.Store.lastError };
      }
    }
    NS.Inventory.applySettings();
    NS.Inventory.reconcile();
    if (NS.Inventory.changed) NS.Inventory.changed();
    return { ok: true, message: "Imported.", summary: summarise(obj) };
  }

  function parseAndApply(text) {
    var obj;
    try { obj = JSON.parse(text); }
    catch (e) { return { ok: false, message: "That is not valid JSON: " + e.message }; }
    return apply(obj);
  }

  /* "Erase everything" has to mean everything: storage AND the settings
     the running app is holding in memory. Clearing only storage left the
     panel still using the settings that had just been wiped. */
  function wipe() {
    var keys = NS.Store.keys(), i;
    for (i = 0; i < keys.length; i++) NS.Store.remove(keys[i]);
    NS.Inventory.applySettings();
    NS.Inventory.reconcile();
    // reconcile may write nothing, so sweep once more for anything it did
    keys = NS.Store.keys();
    for (i = 0; i < keys.length; i++) NS.Store.remove(keys[i]);
    if (NS.Inventory.changed) NS.Inventory.changed();
  }

  NS.Backup = {
    snapshot: snapshot,
    toJSON: toJSON,
    toCSV: toCSV,
    download: download,
    stamp: stamp,
    validate: validate,
    summarise: summarise,
    apply: apply,
    parseAndApply: parseAndApply,
    wipe: wipe,
    KEYS: KEYS,
    FORMAT: FORMAT
  };
})(window.JPH = window.JPH || {});
