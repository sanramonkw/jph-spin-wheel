/* ------------------------------------------------------------------
   audio.js — everything synthesised in the browser (BUILD-SPEC §13).

   Nothing is downloaded, so nothing can fail offline. Ported from
   reference/prototype.html; the tick is what sells the spin.

   Android blocks audio until a user gesture, so the context is created
   lazily inside the first touch and resumed on every subsequent one —
   a WebView that has been backgrounded comes back suspended.

   Applause cannot be synthesised convincingly. If the client wants a
   real clap it has to be a licensed sample, base64-embedded like the
   other assets. Outstanding — §18 item 11.
------------------------------------------------------------------ */
(function (NS) {
  "use strict";

  var ctx = null;
  var lastTick = 0;
  var Audio = {
    enabled: true,          // admin toggle, §12
    state: "not started"    // reported in diagnostics
  };

  function ac() {
    if (!ctx) {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) { Audio.state = "unsupported"; return null; }
      try { ctx = new Ctor(); } catch (e) { Audio.state = "failed: " + e; return null; }
    }
    return ctx;
  }

  // Called from the first user gesture and from every tap after it.
  Audio.unlock = function () {
    var c = ac();
    if (!c) return;
    if (c.state === "suspended" && c.resume) {
      c.resume().then(function () { Audio.state = c.state; })["catch"](function () {});
    }
    Audio.state = c.state;
  };

  /* ---- tick, one per divider passing the flapper -----------------
     Pitch and volume scale with wheel speed. Capped at ~25/sec (§13):
     past that the ticks blur into a tone anyway and each one costs an
     oscillator. */
  Audio.tick = function (degPerSec) {
    if (!Audio.enabled) return;
    var c = ac(); if (!c) return;
    var now = c.currentTime;
    if (now - lastTick < 0.04) return;      // ~25/sec ceiling
    lastTick = now;

    var k = Math.min(1, degPerSec / 900);
    var o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    o.type = "square";
    o.frequency.setValueAtTime(1500 + 900 * k, now);
    f.type = "bandpass"; f.frequency.value = 2200; f.Q.value = 2.5;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.055 + 0.05 * k, now + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    o.connect(f); f.connect(g); g.connect(c.destination);
    o.start(now); o.stop(now + 0.06);
  };

  /* A single voice: oscillator -> gain -> out, with an exponential
     envelope. exponentialRampToValueAtTime cannot reach zero, hence the
     0.0001 floors. */
  function note(freq, at, dur, type, peak, detune) {
    var c = ctx;
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || "triangle";
    o.frequency.setValueAtTime(freq, at);
    if (detune) { try { o.detune.setValueAtTime(detune, at); } catch (e) {} }
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(c.destination);
    o.start(at); o.stop(at + dur + 0.05);
  }

  /* ---- win and lose, deliberately far apart ----------------------
     Staff need to tell these two apart across a hall without looking
     at the screen, so they differ in every dimension that carries at
     distance, not just in the notes:

       register   win is high and rising, lose is low and falling
       timbre     win is a bright triangle, lose is a soft sine
       length     win runs about a second, lose is gone in a third
       shape      win is five notes stacking up with a sparkle on top,
                  lose is two notes sliding down

     The lose sound stays warm and short. It is a shrug, not a buzzer;
     §13 says friendly, never mocking. */

  Audio.win = function () {
    if (!Audio.enabled) return;
    var c = ac(); if (!c) return;
    var t = c.currentTime + 0.01;

    // C-E-G-C-E climbing, each note a little louder
    var arp = [523.25, 659.25, 783.99, 1046.50, 1318.51];
    arp.forEach(function (f, i) {
      note(f, t + i * 0.075, 0.42, "triangle", 0.13 + i * 0.012);
      // a fifth above at low level, which is what makes it read as bright
      note(f * 1.5, t + i * 0.075, 0.30, "sine", 0.045);
    });

    // sparkle on top once the arpeggio has landed
    var sp = t + arp.length * 0.075;
    [2093, 2637, 3136].forEach(function (f, i) {
      note(f, sp + i * 0.045, 0.28, "sine", 0.05);
    });

    // a low root underneath, for body on a small panel speaker
    note(130.81, t, 0.9, "sine", 0.09);
  };

  Audio.lose = function () {
    if (!Audio.enabled) return;
    var c = ac(); if (!c) return;
    var t = c.currentTime + 0.01;

    // two soft notes falling a minor third, low in the register
    note(392.00, t, 0.26, "sine", 0.13);
    note(311.13, t + 0.13, 0.34, "sine", 0.13);

    // a gentle thump under it so it carries without being loud
    var o = c.createOscillator(), g = c.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(85, t + 0.28);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.10, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + 0.4);
  };

  /* Let staff hear them from the panel without spinning. */
  Audio.preview = function (which) {
    Audio.unlock();
    if (which === "win") Audio.win();
    else if (which === "lose") Audio.lose();
    else Audio.tick(600);
  };

  NS.Audio = Audio;
})(window.JPH = window.JPH || {});
