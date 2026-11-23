/*
 * Overshift sound: everything synthesized with the Web Audio API, no samples.
 * Ships play notes on a minor pentatonic scale pitched by charge.
 */
(function (root) {
  'use strict';
  var SCALE = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99];

  function Sfx() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    try { this.muted = root.localStorage && root.localStorage.getItem('overshift.muted') === '1'; } catch (e) { /* ignore */ }
  }

  Sfx.prototype.unlock = function () {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    } catch (e) { this.ctx = null; }
  };

  Sfx.prototype.toggle = function () {
    this.muted = !this.muted;
    try { root.localStorage && root.localStorage.setItem('overshift.muted', this.muted ? '1' : '0'); } catch (e) { /* ignore */ }
  };

  Sfx.prototype.tone = function (freq, dur, type, gain, when, glideTo) {
    var c = this.ctx, t = c.currentTime + (when || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.3, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  };

  Sfx.prototype.noise = function (dur, freq, q, gain, when) {
    var c = this.ctx, t = c.currentTime + (when || 0);
    var len = Math.max(1, Math.floor(c.sampleRate * dur));
    var buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    var src = c.createBufferSource(); src.buffer = buf;
    var f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1;
    var g = c.createGain();
    g.gain.setValueAtTime(gain || 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  };

  Sfx.prototype.whir = function (travel) {
    if (!travel) return;
    var d = Math.min(0.35, 0.06 + travel * 0.06);
    this.tone(90, d, 'sawtooth', 0.05, 0, 140 + travel * 20);
  };

  Sfx.prototype.play = function (name, ev) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    ev = ev || {};
    try {
      switch (name) {
        case 'grab': this.whir(ev.travel); this.tone(330, 0.06, 'square', 0.06, 0.04); break;
        case 'ship': this.whir(ev.travel); this.tone(SCALE[ev.q || 0], 0.28, 'triangle', 0.32, 0.03); this.tone(SCALE[ev.q || 0] * 2, 0.18, 'sine', 0.08, 0.03); break;
        case 'scrap': this.whir(ev.travel); this.noise(0.18, 300, 0.8, 0.4, 0.03); this.tone(70, 0.15, 'square', 0.12, 0.03, 40); break;
        case 'paint': this.whir(ev.travel); this.noise(0.22, 4000, 0.7, 0.25, 0.03); break;
        case 'charge': this.whir(ev.travel); this.noise(0.12, 1200, 2, 0.2, 0.03); this.tone(500, 0.1, 'sine', 0.08, 0.05, 900); break;
        case 'drain': this.whir(ev.travel); this.noise(0.12, 1200, 2, 0.2, 0.03); this.tone(700, 0.1, 'sine', 0.08, 0.05, 300); break;
        case 'loop': this.tone(1200, 0.03, 'sine', 0.05); break;
        case 'if': this.tone(ev.pass ? 1400 : 900, 0.04, 'sine', 0.06); break;
        case 'empty': this.whir(ev.travel); break;
        case 'fault': this.tone(880, 0.16, 'square', 0.12); this.tone(440, 0.24, 'square', 0.12, 0.17); break;
        case 'clear': [0, 2, 4, 5, 7].forEach(function (k, i) { this.tone(SCALE[k] * 2, 0.3, 'triangle', 0.2, i * 0.09); }, this); break;
        case 'place': this.tone(660, 0.05, 'triangle', 0.12); break;
        case 'delete': this.tone(300, 0.07, 'triangle', 0.12, 0, 200); break;
        case 'move': this.tone(520, 0.04, 'triangle', 0.08); break;
        case 'tick': this.tone(1000, 0.025, 'sine', 0.06); break;
        case 'back': this.tone(500, 0.06, 'sine', 0.08, 0, 350); break;
        case 'deny': this.tone(160, 0.12, 'square', 0.08); break;
        case 'select': this.tone(784, 0.08, 'triangle', 0.12); this.tone(1046, 0.1, 'triangle', 0.1, 0.07); break;
      }
    } catch (e) { /* audio is optional */ }
  };

  root.OvershiftSfx = Sfx;
})(typeof self !== 'undefined' ? self : this);
