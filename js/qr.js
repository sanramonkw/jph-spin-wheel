/* ------------------------------------------------------------------
   qr.js — QR code generation, on the device (BUILD-SPEC §9.3).

   "The QR must be generated locally. No CDN library — it will not load
   offline." So this is a from-scratch encoder rather than a dependency.

   Scope, deliberately narrow: byte mode, error correction level M,
   versions 1 to 7 (up to 122 characters). A coupon code or reference
   is a dozen characters, so that is many times what is needed, and
   versions 1-7 all have uniform block sizes — versions 8 and up mix two
   block lengths, which is the part of the spec that is easy to get
   subtly wrong.

   tools/check-qr.js decodes the rendered matrix back independently and
   checks the error correction recovers from damage. That is as far as
   verification can go off-device: whether it scans on a real phone is
   §17.6's job.
------------------------------------------------------------------ */
(function (NS) {
  "use strict";

  /* ---- tables, error correction level M -------------------------
     [total codewords, EC codewords per block, number of blocks] */
  var VERSIONS = {
    1: [26, 10, 1], 2: [44, 16, 1], 3: [70, 26, 1], 4: [100, 18, 2],
    5: [134, 24, 2], 6: [172, 16, 4], 7: [196, 18, 4]
  };
  // alignment pattern centre coordinates
  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38]
  };
  var ECC_M = 0;   // the 2-bit level indicator for M

  function dataCodewords(v) {
    var t = VERSIONS[v];
    return t[0] - t[1] * t[2];
  }
  function capacity(v) {
    return Math.floor((dataCodewords(v) * 8 - 12) / 8);   // 4-bit mode + 8-bit count
  }

  /* ---- GF(256), primitive polynomial 0x11D ---------------------- */
  var EXP = new Array(512), LOG = new Array(256);
  (function () {
    var x = 1, i;
    for (i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function gmul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  // generator polynomial for n error correction codewords
  function rsGenerator(n) {
    var g = [1], i, j, ng;
    for (i = 0; i < n; i++) {
      ng = new Array(g.length + 1);
      for (j = 0; j < ng.length; j++) ng[j] = 0;
      for (j = 0; j < g.length; j++) {
        ng[j] ^= g[j];
        ng[j + 1] ^= gmul(g[j], EXP[i]);
      }
      g = ng;
    }
    return g;
  }

  function rsEncode(data, ecLen) {
    var gen = rsGenerator(ecLen);
    var res = new Array(ecLen), i, j, factor;
    for (i = 0; i < ecLen; i++) res[i] = 0;
    for (i = 0; i < data.length; i++) {
      factor = data[i] ^ res[0];
      res.shift();
      res.push(0);
      if (factor !== 0) {
        for (j = 0; j < ecLen; j++) res[j] ^= gmul(gen[j + 1], factor);
      }
    }
    return res;
  }

  /* ---- BCH, for the format and version information -------------- */
  function bch(value, poly, bits) {
    var v = value << bits;
    var polyBits = 0, t = poly;
    while (t) { polyBits++; t >>= 1; }
    while (true) {
      var vb = 0, u = v;
      while (u) { vb++; u >>= 1; }
      if (vb < polyBits) break;
      v ^= poly << (vb - polyBits);
    }
    return (value << bits) | v;
  }

  function formatBits(mask) {
    // 5 data bits: 2 of error correction level, 3 of mask
    var data = (ECC_M << 3) | mask;
    return (bch(data, 0x537, 10)) ^ 0x5412;      // generator 10100110111
  }

  function versionBits(v) {
    return bch(v, 0x1F25, 12);                   // generator 1111100100101
  }

  /* ---- bit buffer ------------------------------------------------ */
  function BitBuffer() { this.bits = []; }
  BitBuffer.prototype.put = function (value, length) {
    for (var i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  };
  BitBuffer.prototype.toBytes = function () {
    var out = [], i;
    for (i = 0; i < this.bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | (this.bits[i + j] || 0);
      out.push(b);
    }
    return out;
  };

  /* ---- UTF-8, so a code with an accent or a symbol survives ------ */
  function utf8Bytes(str) {
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) {
        out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
        var lo = str.charCodeAt(i + 1);
        var cp = 0x10000 + ((c - 0xD800) << 10) + (lo - 0xDC00);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F),
                 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
        i++;
      } else {
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
      }
    }
    return out;
  }

  /* ---- matrix ---------------------------------------------------- */
  function makeMatrix(size) {
    var m = [], i, j;
    for (i = 0; i < size; i++) {
      m.push([]);
      for (j = 0; j < size; j++) m[i].push(null);   // null = not yet set
    }
    return m;
  }

  function placeFinder(m, r, c) {
    var i, j, size = m.length;
    for (i = -1; i <= 7; i++) {
      for (j = -1; j <= 7; j++) {
        var rr = r + i, cc = c + j;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        var on = (i >= 0 && i <= 6 && (j === 0 || j === 6)) ||
                 (j >= 0 && j <= 6 && (i === 0 || i === 6)) ||
                 (i >= 2 && i <= 4 && j >= 2 && j <= 4);
        m[rr][cc] = on ? 1 : 0;
      }
    }
  }

  function placeAlignment(m, v) {
    var pts = ALIGN[v], size = m.length, a, b, i, j;
    for (a = 0; a < pts.length; a++) {
      for (b = 0; b < pts.length; b++) {
        var r = pts[a], c = pts[b];
        // skip the three corners occupied by finder patterns
        if ((r === 6 && c === 6) || (r === 6 && c === size - 7) ||
            (r === size - 7 && c === 6)) continue;
        for (i = -2; i <= 2; i++) {
          for (j = -2; j <= 2; j++) {
            m[r + i][c + j] =
              (Math.max(Math.abs(i), Math.abs(j)) !== 1) ? 1 : 0;
          }
        }
      }
    }
  }

  function placeTiming(m) {
    var size = m.length, i;
    for (i = 8; i < size - 8; i++) {
      var on = (i % 2 === 0) ? 1 : 0;
      if (m[6][i] === null) m[6][i] = on;
      if (m[i][6] === null) m[i][6] = on;
    }
  }

  // reserve the format and version areas so data placement skips them
  function reserve(m, v) {
    var size = m.length, i;
    for (i = 0; i < 9; i++) {
      if (m[8][i] === null) m[8][i] = 0;
      if (m[i][8] === null) m[i][8] = 0;
    }
    for (i = 0; i < 8; i++) {
      if (m[8][size - 1 - i] === null) m[8][size - 1 - i] = 0;
      if (m[size - 1 - i][8] === null) m[size - 1 - i][8] = 0;
    }
    m[size - 8][8] = 1;                       // the always-dark module
    if (v >= 7) {
      for (i = 0; i < 18; i++) {
        var r = Math.floor(i / 3), c = i % 3;
        m[size - 11 + c][r] = 0;
        m[r][size - 11 + c] = 0;
      }
    }
  }

  function isFunction(m, v, r, c) {
    // rebuild a blank functional map to know which cells data may use
    return FUNCTION_MAP[r][c];
  }
  var FUNCTION_MAP = null;

  function buildFunctionMap(size, v) {
    var f = [], i, j;
    for (i = 0; i < size; i++) { f.push([]); for (j = 0; j < size; j++) f[i].push(false); }
    function mark(r, c) { if (r >= 0 && r < size && c >= 0 && c < size) f[r][c] = true; }
    // finders plus separators
    [[0, 0], [0, size - 7], [size - 7, 0]].forEach(function (p) {
      for (i = -1; i <= 7; i++) for (j = -1; j <= 7; j++) mark(p[0] + i, p[1] + j);
    });
    // timing
    for (i = 0; i < size; i++) { mark(6, i); mark(i, 6); }
    // alignment
    var pts = ALIGN[v];
    for (var a = 0; a < pts.length; a++) {
      for (var b = 0; b < pts.length; b++) {
        var r = pts[a], c = pts[b];
        if ((r === 6 && c === 6) || (r === 6 && c === size - 7) ||
            (r === size - 7 && c === 6)) continue;
        for (i = -2; i <= 2; i++) for (j = -2; j <= 2; j++) mark(r + i, c + j);
      }
    }
    // format areas
    for (i = 0; i < 9; i++) { mark(8, i); mark(i, 8); }
    for (i = 0; i < 8; i++) { mark(8, size - 1 - i); mark(size - 1 - i, 8); }
    // version areas
    if (v >= 7) {
      for (i = 0; i < 18; i++) {
        var rr = Math.floor(i / 3), cc = i % 3;
        mark(size - 11 + cc, rr); mark(rr, size - 11 + cc);
      }
    }
    return f;
  }

  /* ---- masks ----------------------------------------------------- */
  var MASKS = [
    function (r, c) { return (r + c) % 2 === 0; },
    function (r) { return r % 2 === 0; },
    function (r, c) { return c % 3 === 0; },
    function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
    function (r, c) { return ((r * c) % 2) + ((r * c) % 3) === 0; },
    function (r, c) { return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; },
    function (r, c) { return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; }
  ];

  function penalty(m) {
    var size = m.length, score = 0, r, c, i, run, dark = 0;

    // rule 1: runs of five or more of the same colour
    for (r = 0; r < size; r++) {
      run = 1;
      for (c = 1; c < size; c++) {
        if (m[r][c] === m[r][c - 1]) { run++; }
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (c = 0; c < size; c++) {
      run = 1;
      for (r = 1; r < size; r++) {
        if (m[r][c] === m[r - 1][c]) { run++; }
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }

    // rule 2: 2x2 blocks of one colour
    for (r = 0; r < size - 1; r++) {
      for (c = 0; c < size - 1; c++) {
        var v0 = m[r][c];
        if (v0 === m[r][c + 1] && v0 === m[r + 1][c] && v0 === m[r + 1][c + 1]) score += 3;
      }
    }

    // rule 3: the 1:1:3:1:1 finder-like pattern
    var pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    var pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    function matches(get, at) {
      for (var k = 0; k < 11; k++) {
        if (get(at + k) !== pat1[k]) break;
        if (k === 10) return true;
      }
      for (k = 0; k < 11; k++) {
        if (get(at + k) !== pat2[k]) return false;
      }
      return true;
    }
    for (r = 0; r < size; r++) {
      for (c = 0; c + 11 <= size; c++) {
        if (matches(function (x) { return m[r][x]; }, c)) score += 40;
      }
    }
    for (c = 0; c < size; c++) {
      for (r = 0; r + 11 <= size; r++) {
        if (matches(function (x) { return m[x][c]; }, r)) score += 40;
      }
    }

    // rule 4: overall balance of dark to light
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (m[r][c]) dark++;
    var pct = dark * 100 / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  /* ---- the encoder ----------------------------------------------- */
  function encode(text) {
    var bytes = utf8Bytes(String(text));
    var v = 0, i;
    for (i = 1; i <= 7; i++) {
      if (bytes.length <= capacity(i)) { v = i; break; }
    }
    if (!v) {
      throw new Error("QR: " + bytes.length + " bytes is more than version 7 at " +
                      "level M holds (" + capacity(7) + "). Shorten the code.");
    }

    var t = VERSIONS[v];
    var totalCw = t[0], ecPerBlock = t[1], blocks = t[2];
    var dataCw = dataCodewords(v);
    var perBlock = dataCw / blocks;

    /* --- bit stream --- */
    var buf = new BitBuffer();
    buf.put(4, 4);                       // byte mode
    buf.put(bytes.length, 8);            // character count, 8 bits for v1-9
    for (i = 0; i < bytes.length; i++) buf.put(bytes[i], 8);

    // terminator, up to four zero bits
    var room = dataCw * 8 - buf.bits.length;
    buf.put(0, Math.min(4, room));
    while (buf.bits.length % 8 !== 0) buf.bits.push(0);

    var data = buf.toBytes();
    var pad = [0xEC, 0x11], p = 0;
    while (data.length < dataCw) { data.push(pad[p % 2]); p++; }

    /* --- split into blocks, error-correct each --- */
    var dBlocks = [], eBlocks = [];
    for (i = 0; i < blocks; i++) {
      var blk = data.slice(i * perBlock, (i + 1) * perBlock);
      dBlocks.push(blk);
      eBlocks.push(rsEncode(blk, ecPerBlock));
    }

    /* --- interleave --- */
    var final = [], j;
    for (i = 0; i < perBlock; i++) {
      for (j = 0; j < blocks; j++) final.push(dBlocks[j][i]);
    }
    for (i = 0; i < ecPerBlock; i++) {
      for (j = 0; j < blocks; j++) final.push(eBlocks[j][i]);
    }

    /* --- lay it out --- */
    var size = v * 4 + 17;
    FUNCTION_MAP = buildFunctionMap(size, v);

    var m = makeMatrix(size);
    placeFinder(m, 0, 0);
    placeFinder(m, 0, size - 7);
    placeFinder(m, size - 7, 0);
    placeAlignment(m, v);
    placeTiming(m);
    reserve(m, v);

    // zigzag up and down the pairs of columns, skipping column 6
    var bitIndex = 0, dir = -1, row = size - 1, col = size - 1;
    function nextBit() {
      var byteIdx = bitIndex >> 3;
      if (byteIdx >= final.length) return 0;
      var bit = (final[byteIdx] >>> (7 - (bitIndex & 7))) & 1;
      bitIndex++;
      return bit;
    }
    while (col > 0) {
      if (col === 6) col--;                 // the vertical timing column
      while (true) {
        for (var k = 0; k < 2; k++) {
          var cc = col - k;
          if (!FUNCTION_MAP[row][cc]) m[row][cc] = nextBit();
        }
        row += dir;
        if (row < 0 || row >= size) { row -= dir; dir = -dir; break; }
      }
      col -= 2;
    }

    /* --- choose the mask by penalty score --- */
    var best = null, bestScore = Infinity, bestMask = 0;
    for (var mk = 0; mk < 8; mk++) {
      var cand = [];
      for (i = 0; i < size; i++) cand.push(m[i].slice());
      for (i = 0; i < size; i++) {
        for (j = 0; j < size; j++) {
          if (!FUNCTION_MAP[i][j] && MASKS[mk](i, j)) cand[i][j] ^= 1;
        }
      }
      applyFormat(cand, mk, v);
      var sc = penalty(cand);
      if (sc < bestScore) { bestScore = sc; best = cand; bestMask = mk; }
    }

    return { modules: best, size: size, version: v, mask: bestMask, text: String(text) };
  }

  function applyFormat(m, mask, v) {
    var size = m.length, bitsF = formatBits(mask), i;
    for (i = 0; i < 15; i++) {
      var bit = (bitsF >>> i) & 1;
      // copy one: around the top-left finder
      if (i < 6) m[8][i] = bit;
      else if (i < 8) m[8][i + 1] = bit;
      else if (i === 8) m[7][8] = bit;
      else m[14 - i][8] = bit;
      // copy two: split between the other two finders
      if (i < 8) m[size - 1 - i][8] = bit;
      else m[8][size - 15 + i] = bit;
    }
    m[size - 8][8] = 1;                       // always dark

    if (v >= 7) {
      var bitsV = versionBits(v);
      for (i = 0; i < 18; i++) {
        var b = (bitsV >>> i) & 1;
        var r = Math.floor(i / 3), c = i % 3;
        m[size - 11 + c][r] = b;
        m[r][size - 11 + c] = b;
      }
    }
  }

  /* ---- render ----------------------------------------------------
     Plain SVG markup built as a string and injected into a DIV.
     innerHTML on an SVG element is unsupported on old Android
     WebViews (§2), and a canvas would need a second code path for
     high-DPI panels. */
  function toSVG(qr, px, quiet) {
    quiet = (quiet === undefined) ? 4 : quiet;       // 4 modules, per the spec
    var n = qr.size + quiet * 2;
    var scale = px / n;
    var d = "", r, c;
    for (r = 0; r < qr.size; r++) {
      for (c = 0; c < qr.size; c++) {
        if (qr.modules[r][c]) {
          d += "M" + (c + quiet) + " " + (r + quiet) + "h1v1h-1z";
        }
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px +
           '" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges">' +
           '<rect width="' + n + '" height="' + n + '" fill="#FDFBF4"/>' +
           '<path d="' + d + '" fill="#212243"/></svg>';
  }

  NS.QR = {
    encode: encode,
    toSVG: toSVG,
    capacity: capacity,
    // exposed so tools/check-qr.js can verify against them
    _tables: { VERSIONS: VERSIONS, ALIGN: ALIGN, dataCodewords: dataCodewords },
    _formatBits: formatBits,
    _versionBits: versionBits,
    _gmul: gmul,
    _EXP: EXP,
    _LOG: LOG
  };
})(typeof window !== "undefined" ? (window.JPH = window.JPH || {}) : (module.exports = {}));
