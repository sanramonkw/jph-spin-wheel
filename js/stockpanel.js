/* ------------------------------------------------------------------
   stockpanel.js — the persistent stock panel (BUILD-SPEC §9.5).

   One row per prize tier: name, and the count remaining FOR TODAY.
   Hard Luck is never listed. Depleted tiers grey to 40% with a
   strikethrough and read "GONE".

   This is the urgency engine. Visible scarcity is what makes people
   call their friends over, so it updates the instant a spin resolves
   and is visible in every non-overlay state.

   Two layouts from the same data, because the space is very different:
     portrait   a single strip of compact chips — the artboard leaves
                only 120px between the wheel and the SPIN button
     landscape  full rows in the right-hand column, which has room
------------------------------------------------------------------ */
(function (NS) {
  "use strict";

  var host = null;

  function render() {
    if (!host) return;

    var rows = NS.Inventory.rows();
    var day = NS.Inventory.dayIndex();
    var html = '<div class="sp-head">' + NS.COPY.stockHeader + "</div>";

    if (!NS.Inventory.isConfigured()) {
      host.className = "sp-unset";
      host.innerHTML = '<div class="sp-head">' + NS.COPY.stockHeader + "</div>" +
                       '<div class="sp-note">' + NS.COPY.stockNotSet + "</div>";
      return;
    }
    if (day === null || day < 0 || day > 2) {
      host.className = "sp-unset";
      host.innerHTML = '<div class="sp-head">' + NS.COPY.stockHeader + "</div>" +
                       '<div class="sp-note">' + NS.Inventory.dayLabel() + "</div>";
      return;
    }

    html += '<div class="sp-grid">';
    rows.forEach(function (r) {
      html += '<div class="sp-chip' + (r.soldOut ? " gone" : "") + '">' +
                '<div class="sp-name">' + r.name + "</div>" +
                '<div class="sp-count">' +
                  (r.soldOut ? NS.COPY.soldOut : String(r.remaining)) +
                "</div>" +
              "</div>";
    });
    html += "</div>";

    host.className = "";
    host.innerHTML = html;
  }

  NS.StockPanel = {
    init: function () {
      host = document.getElementById("stockPanel");
      render();
    },
    render: render
  };
})(window.JPH = window.JPH || {});
