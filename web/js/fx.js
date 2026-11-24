/*
 * Overshift effects: particles, rings, floating numbers and banners on the top screen, plus the
 * staged reveal of the Contract Cleared panel, fresh-unlock cards and the Ledger's money moments.
 *
 * Purely visual. It watches the game (wrapping a few Game methods to note what just happened)
 * and draws over the deck after each frame. Nothing here changes the simulation, scores or saves:
 * all its state lives on the Game and Deck objects and is never persisted.
 *
 * Motion: ?fx=off turns effects off, ?fx=low (or the system's reduced-motion setting) keeps a
 * few soft ones and drops shake, pops and most particles. Particle counts are capped for the Thor.
 */
(function (root) {
  'use strict';
  var G = root.OvershiftGame, Deck = root.OvershiftDeck, LG = root.OvershiftLedger;
  if (!G) return;

  var W = 1920, H = 1080;
  var COL = { cyan: '#22e8ff', magenta: '#ff3df0', amber: '#ffb31f', lime: '#a6ff3a' };
  var INK = '#d7f6ff', DIM = '#5b7590', RED = '#ff3b5c', GREEN = '#5dffa8', VIOLET = '#9b7bff', WHITE = '#ffffff';
  var CELL_COLS = [COL.cyan, COL.magenta, COL.amber, COL.lime];
  var CHAPTERS = ['NIGHT SHIFT', 'JUNCTION FLOOR', 'FIRST ROUTES'];
  var MAX_PARTS = 260, MAX_RINGS = 24, MAX_TEXT = 14, MAX_QUEUE = 16;
  var FONT = '"IBM Plex Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';

  // ---------- motion level: 0 off, 1 reduced, 2 full ----------
  var MOTION = 2;
  try {
    var q = new URLSearchParams(root.location && root.location.search || '').get('fx');
    if (q === 'off') MOTION = 0;
    else if (q === 'low') MOTION = 1;
    else if (root.matchMedia) {
      var mq = root.matchMedia('(prefers-reduced-motion: reduce)');
      if (mq.matches) MOTION = 1;
      if (mq.addEventListener) mq.addEventListener('change', function (e) { if (q !== 'full') MOTION = e.matches ? 1 : 2; });
    }
  } catch (e) { /* no window: node tests */ }
  G.fxMotion = function (m) { if (m !== undefined) MOTION = m; return MOTION; };

  function LV() { return G.LEVELS; }
  function chapterOf(lv) { return Math.floor(lv.index / G.PER_CHAPTER) + 1; }
  function codeOf(lv) { return lv.code || (lv.kind === 'floor' ? '2-' + ('0' + lv.num).slice(-2) : ('0' + (lv.index + 1)).slice(-2)); }
  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
  function easeOut(t) { t = clamp01(t); return 1 - Math.pow(1 - t, 3); }
  function backOut(t) { t = clamp01(t); var s = 1.9; t -= 1; return t * t * ((s + 1) * t + s) + 1; }

  // =====================================================================
  // Game side: note what happened, for the deck to show next frame
  // =====================================================================
  var GP = G.prototype;
  function queue(game, item) {
    var qq = game.fxEvents || (game.fxEvents = []);
    if (qq.length < MAX_QUEUE) qq.push(item);
  }

  var stepOnce = GP.stepOnce;
  GP.stepOnce = function () {
    stepOnce.apply(this, arguments);
    var ev = this.sim && this.sim.event;
    if (ev) queue(this, { k: 'sim', ev: ev, sim: this.sim });
  };

  var finish = GP.finish;
  GP.finish = function () {
    var lv = this.level, all = LV(), id = lv.id;
    var hadClear = !!this.save.cleared[id];
    var best = this.save.best[id] ? { size: this.save.best[id].size, cycles: this.save.best[id].cycles } : {};
    var ni = lv.index + 1, wasOpen = ni >= all.length || this.isUnlocked(ni);
    finish.apply(this, arguments);
    var r = this.result;
    if (this.overlay !== 'cleared' || !r || !r.cleared) return;
    var info = {
      t: 0, last: -1,
      first: !hadClear,
      bestSize: best.size !== undefined && r.size < best.size,
      bestCycles: best.cycles !== undefined && r.cycles < best.cycles,
      lean: r.size <= lv.parSize, fast: r.cycles <= lv.parCycles,
      unlock: null, extra: null
    };
    if (!wasOpen && this.isUnlocked(ni)) {
      var nl = all[ni], ch = chapterOf(nl);
      info.unlock = { i: ni, id: nl.id, name: nl.name, code: codeOf(nl), chapter: ch !== chapterOf(lv) ? ch : 0 };
      (this.fxFresh || (this.fxFresh = {}))[nl.id] = true;
    }
    if (LG && id === LG.DISPATCH_AFTER && !hadClear) info.extra = 'Fleet and Truck bed upgrades are open in the Ledger';
    this.fxClear = info;
  };

  var selectLevel = GP.selectLevel;
  GP.selectLevel = function (i) {
    var before = this.level;
    selectLevel.apply(this, arguments);
    if (this.level !== before || this.level.index === i) {
      if (this.fxFresh && this.level) delete this.fxFresh[this.level.id];
      this.fxClear = null;
    }
  };

  if (GP.buyUpgrade && LG) {
    var buyUpgrade = GP.buyUpgrade;
    GP.buyUpgrade = function (i) {
      var row = LG.UPGRADES[i], L = this.save.ledger;
      var lvl = row ? LG.upgradeLevel(L, row.id) : 0, cap = LG.bayCount(L), credits = L.credits;
      buyUpgrade.apply(this, arguments);
      if (!row || LG.upgradeLevel(this.save.ledger, row.id) <= lvl) return;
      var eff = LG.upgradeEffect(this.save.ledger, row.id);
      queue(this, { k: 'upgrade', id: row.id, name: row.name, level: lvl + 1, now: eff.now, spent: credits - this.save.ledger.credits, cap0: cap, cap1: LG.bayCount(this.save.ledger) });
    };
  }
  if (GP.ledgerToggle) {
    var ledgerToggle = GP.ledgerToggle;
    GP.ledgerToggle = function (i) {
      var before = this.save.ledger.bays.slice();
      ledgerToggle.apply(this, arguments);
      var after = this.save.ledger.bays, k;
      for (k = 0; k < after.length; k++) if (before.indexOf(after[k]) < 0) queue(this, { k: 'bayIn', i: k });
      for (k = 0; k < before.length; k++) if (after.indexOf(before[k]) < 0) queue(this, { k: 'bayOut', i: k });
    };
  }

  if (!Deck) return;

  // =====================================================================
  // Deck side: the effect layer
  // =====================================================================
  var sprites = {};
  function sprite(col) {
    if (sprites[col]) return sprites[col];
    var c = document.createElement('canvas');
    c.width = c.height = 32;
    var g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.22, col);
    gr.addColorStop(0.55, col + '55');
    gr.addColorStop(1, col + '00');
    g.fillStyle = gr;
    g.fillRect(0, 0, 32, 32);
    return (sprites[col] = c);
  }

  function Fx(deck) {
    this.d = deck;
    this.parts = [];
    this.rings = [];
    this.texts = [];
    this.flashes = [];
    this.banner = null;
    this.shake = 0;
    this.credits = null;
    this.pendingCr = 0;
    this.lastCredits = null;
    this.lastOverlay = null;
    this.freshShown = {};
    this.trailAcc = 0;
    this.reportAcc = 0;
    this.reportDone = false;
    this.dt = 0;
  }

  function n(count) { return MOTION >= 2 ? count : Math.ceil(count * 0.25); }

  /** One burst of glowing sparks. o: speed, life, size, gravity, spread (radians), dir */
  Fx.prototype.burst = function (x, y, col, count, o) {
    o = o || {};
    count = n(count);
    for (var i = 0; i < count && this.parts.length < MAX_PARTS; i++) {
      var a = o.dir !== undefined ? o.dir + (Math.random() - 0.5) * (o.spread || 1) : Math.random() * 6.283;
      var sp = (o.speed || 420) * (0.35 + Math.random() * 0.75);
      var c = Array.isArray(col) ? col[(Math.random() * col.length) | 0] : col;
      this.parts.push({
        x: x + (o.jitter ? (Math.random() - 0.5) * o.jitter : 0), y: y + (o.jitterY ? (Math.random() - 0.5) * o.jitterY : 0),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        g: o.gravity === undefined ? 520 : o.gravity, drag: o.drag === undefined ? 2.2 : o.drag,
        life: 0, max: (o.life || 0.7) * (0.6 + Math.random() * 0.6),
        size: (o.size || 22) * (0.6 + Math.random() * 0.7), col: c, kind: o.kind || 'spark',
        rot: Math.random() * 6.283, vr: (Math.random() - 0.5) * 12, w: 8 + Math.random() * 10, h: 4 + Math.random() * 6,
        tx: o.tx, ty: o.ty
      });
    }
  };
  /** Paper-thin shards that tumble down, for the big moments. */
  Fx.prototype.confetti = function (x0, x1, y, count) {
    count = n(count);
    for (var i = 0; i < count && this.parts.length < MAX_PARTS; i++) {
      this.parts.push({
        x: x0 + Math.random() * (x1 - x0), y: y - Math.random() * 120,
        vx: (Math.random() - 0.5) * 260, vy: -200 - Math.random() * 380,
        g: 640, drag: 1.4, life: 0, max: 1.6 + Math.random() * 1.1,
        size: 0, col: CELL_COLS[i % 4], kind: 'shard',
        rot: Math.random() * 6.283, vr: (Math.random() - 0.5) * 14, w: 10 + Math.random() * 12, h: 5 + Math.random() * 6
      });
    }
  };
  /** Sparks that fly to a point (coins to the credits counter). */
  Fx.prototype.seek = function (x, y, tx, ty, col, count, life) {
    count = n(count);
    for (var i = 0; i < count && this.parts.length < MAX_PARTS; i++) {
      this.parts.push({
        x: x + (Math.random() - 0.5) * 40, y: y + (Math.random() - 0.5) * 20,
        vx: (Math.random() - 0.5) * 300, vy: -120 - Math.random() * 220, g: 0, drag: 0,
        life: 0, max: (life || 0.9) * (0.85 + Math.random() * 0.3), size: 26, col: col, kind: 'seek',
        sx: 0, sy: 0, tx: tx, ty: ty
      });
    }
  };
  Fx.prototype.ring = function (x, y, col, r0, r1, life, width) {
    if (this.rings.length >= MAX_RINGS) return;
    this.rings.push({ x: x, y: y, col: col, r0: r0, r1: r1, life: 0, max: life || 0.5, w: width || 6 });
  };
  Fx.prototype.float = function (s, x, y, col, size, life) {
    if (this.texts.length >= MAX_TEXT) this.texts.shift();
    this.texts.push({ s: s, x: x, y: y, col: col, size: size || 30, life: 0, max: life || 1.1 });
  };
  /** A soft light over a rectangle that fades (a bay window powering up, a card opening). */
  Fx.prototype.flashRect = function (x, y, w, h, col, life) {
    if (this.flashes.length < 12) this.flashes.push({ x: x, y: y, w: w, h: h, col: col, life: 0, max: life || 0.6 });
  };
  Fx.prototype.kick = function (amount) { if (MOTION >= 2) this.shake = Math.max(this.shake, amount); };
  Fx.prototype.say = function (title, sub, col) { this.banner = { title: title, sub: sub || '', col: col || GREEN, t: 0, max: 2 }; };
  Fx.prototype.sound = function (name, ev) { var s = this.d.game.sfx; if (s && s.play) s.play(name, ev); };

  Fx.prototype.clearAll = function () { this.parts.length = 0; this.rings.length = 0; this.texts.length = 0; this.flashes.length = 0; this.banner = null; };

  // ---------- reading the game each frame ----------
  Fx.prototype.before = function (dt) {
    this.dt = dt;
    var d = this.d, game = d.game;
    // shake decays; the deck adds this offset to its transform
    this.shake = Math.max(0, this.shake - dt * 40);
    d.shakeX = this.shake ? (Math.random() - 0.5) * 2 * this.shake : 0;
    d.shakeY = this.shake ? (Math.random() - 0.5) * 2 * this.shake : 0;
    if (game.fxClear && game.overlay === 'cleared') game.fxClear.t += dt;
  };

  Fx.prototype.after = function () {
    var d = this.d, game = d.game, dt = this.dt;
    var overlay = game.overlay;
    if (overlay !== this.lastOverlay) {
      if (overlay === 'board') this.freshShown = {};
      this.banner = null;
      if (overlay === 'report') { this.reportAcc = 0; this.reportDone = false; }
      if (this.lastOverlay === 'cleared' || overlay === 'cleared') { this.parts.length = 0; this.rings.length = 0; }
      this.lastOverlay = overlay;
    }
    var qq = game.fxEvents;
    if (qq && qq.length) {
      game.fxEvents = [];
      for (var i = 0; i < qq.length; i++) this.handle(qq[i], game, i === qq.length - 1);
    }
    if (overlay === 'cleared' && game.fxClear) this.clearMoments(game.fxClear, game);
    else if (overlay === 'ledger' || overlay === 'report') this.ledgerMoments(game, dt);
    else if (!overlay && game.mode !== 'edit' && !game.isFloor() && !game.isTruck()) this.servoTrail(game, dt);
  };

  Fx.prototype.handle = function (item, game, newest) {
    if (item.k === 'sim') {
      if (game.isFloor()) this.floorEvent(item.ev, item.sim, game);
      else if (game.isTruck()) this.truckEvent(item.ev, item.sim, game);
      else this.servoEvent(item.ev, item.sim, game, newest);
    } else if (item.k === 'upgrade') this.upgradeMoment(item, game);
    else if (item.k === 'bayIn' || item.k === 'bayOut') this.bayMoment(item, game);
  };

  // ---------- chapter 1: Servo ----------
  Fx.prototype.servoEvent = function (ev, sim, game, newest) {
    var d = this.d, lv = game.level, ns = lv.stations.length;
    var fast = game.mode === 'fast';
    var at = function (name) { var i = lv.stations.indexOf(name); return i < 0 ? null : d.stationX(i, ns); };
    switch (ev.type) {
      case 'grab': {
        var ix = d.stationX(0, ns) - 124;
        if (!fast) this.burst(ix, 556, COL.cyan, 6, { speed: 220, life: 0.35, gravity: 0, size: 18 });
        break;
      }
      case 'ship': {
        var outX = d.stationX(ns - 1, ns) + 124, c = sim.shipped[sim.shipped.length - 1];
        var col = c ? COL[c.c] || INK : GREEN;
        this.burst(outX, 556, [col, WHITE], fast ? 6 : 16, { speed: 520, life: 0.55, gravity: 300, size: 22 });
        if (!fast) this.ring(outX, 556, col, 30, 80, 0.4, 5);
        // the ticket slot that just filled
        if (sim.status !== 'fault' && game.ctx && game.ctx.order) {
          var on = game.ctx.order.length, sp = on > 1 ? Math.min(118, (W - 220) / (on - 1)) : 118, r = Math.min(40, sp * 0.36);
          var k = sim.shipped.length - 1, tx = W / 2 - (on - 1) * sp / 2 + k * sp;
          if (k >= 0 && k < on) {
            this.ring(tx, 920, GREEN, r, r + 34, 0.45, 4);
            if (!fast) this.burst(tx, 920, GREEN, 8, { speed: 260, life: 0.45, gravity: -60, size: 16 });
          }
        }
        break;
      }
      case 'scrap': {
        var rx = at('recycler'), m = Math.min(4, sim.scrapped.length);
        if (rx === null) break;
        this.burst(rx + (m - 1) * 22, 660, [RED, COL.amber, '#ff7a3d'], fast ? 5 : 14, { speed: 300, life: 0.6, gravity: 700, size: 16, dir: -Math.PI / 2, spread: 2.2 });
        break;
      }
      case 'paint': {
        var px = at('painter');
        if (px === null || fast) break;
        var pc = sim.held ? COL[sim.held.c] || COL.magenta : COL.magenta;
        this.burst(px, 520, [pc, pc, WHITE], 12, { speed: 360, life: 0.45, gravity: 200, size: 18, dir: -Math.PI / 2, spread: 2.6 });
        break;
      }
      case 'charge': case 'drain': {
        var sx = at('press');
        if (sx === null || fast) break;
        var up = ev.type === 'charge';
        this.burst(sx, up ? 500 : 600, [COL.amber, WHITE], 10, { speed: 320, life: 0.45, gravity: up ? -200 : 500, size: 16, dir: up ? -Math.PI / 2 : Math.PI / 2, spread: 1.2 });
        break;
      }
      case 'fault': {
        var fx = d.stationX(sim.pos, ns); // where Servo is headed; the drawn carriage may still be gliding there
        this.burst(fx, 340, [RED, '#ff7a3d', WHITE], 22, { speed: 520, life: 0.6, gravity: 500, size: 20 });
        this.ring(fx, 340, RED, 20, 140, 0.45, 6);
        this.kick(14);
        break;
      }
    }
  };

  Fx.prototype.servoTrail = function (game, dt) {
    var d = this.d, lv = game.level;
    if (d.servoX === null || !lv.stations) return;
    var tx = d.stationX(game.sim.pos, lv.stations.length), gap = tx - d.servoX;
    if (Math.abs(gap) < 6) return;
    this.trailAcc += dt;
    if (this.trailAcc < 0.035 || MOTION < 2) return;
    this.trailAcc = 0;
    this.burst(d.servoX - Math.sign(gap) * 44, 330, [VIOLET, COL.cyan], 2, { speed: 90, life: 0.4, gravity: 0, size: 16, dir: gap > 0 ? Math.PI : 0, spread: 0.9 });
  };

  // ---------- chapter 2: floors ----------
  Fx.prototype.traceAt = function (id) {
    var hits = this.d.hits;
    for (var i = hits.length - 1; i >= 0; i--) {
      var h = hits[i];
      if (h.a && h.a.type === 'trace' && h.a.id === id) return { x: h.x + h.w / 2, y: h.y + h.h / 2 };
    }
    return null;
  };
  Fx.prototype.floorEvent = function (ev, sim, game) {
    var fast = game.mode === 'fast';
    if (ev.type === 'ship') {
      var p = this.traceAt(ev.cell);
      if (!p) return;
      var got = sim.docks[ev.dock], c = got && got[got.length - 1], col = c ? COL[c.c] || GREEN : GREEN;
      this.burst(p.x, p.y, [col, WHITE], fast ? 5 : 14, { speed: 380, life: 0.5, gravity: 200, size: 18 });
      this.ring(p.x, p.y, GREEN, 20, 56, 0.4, 4);
    } else if (ev.type === 'fault') {
      this.kick(12);
    }
  };

  // ---------- chapter 3: trucks ----------
  Fx.prototype.truckEvent = function (ev, sim, game) {
    var d = this.d, lv = game.level;
    if (ev.type === 'fault') { this.kick(12); return; }
    if (!d.cityGeom) return;
    var geo = d.cityGeom(lv);
    if (ev.type === 'drive' && ev.delivered && ev.delivered.length) {
      var p = geo.pos[ev.to];
      if (!p) return;
      var cols = [GREEN, WHITE], cells = 0;
      ev.delivered.forEach(function (oid) {
        for (var i = 0; i < sim.orders.length; i++) if (sim.orders[i].id === oid) { cols.push(COL[sim.orders[i].c] || GREEN); cells += sim.orders[i].n; }
      });
      this.burst(p.x, p.y, cols, game.mode === 'fast' ? 8 : 22, { speed: 460, life: 0.6, gravity: 160, size: 20 });
      this.ring(p.x, p.y, GREEN, 54, 120, 0.55, 5);
      this.float((ev.delivered.length > 1 ? ev.delivered.length + ' orders' : 'delivered') + (cells ? ' · ' + cells + ' cells' : ''), p.x, p.y - 140, GREEN, 24, 1.2);
    } else if (ev.type === 'load' && !ev.none && !ev.short && game.mode !== 'fast') {
      this.burst(geo.depot.x, geo.depot.y, [COL[ev.c] || COL.cyan, WHITE], 8, { speed: 240, life: 0.4, gravity: 0, size: 16 });
    }
  };

  // ---------- Contract Cleared ----------
  var CHIP_AT = [0.4, 0.7, 1.0], UNLOCK_AT = 1.5;
  Fx.prototype.clearMoments = function (info, game) {
    var t = info.t, last = info.last;
    function crossed(at) { return last < at && t >= at; }
    if (crossed(0)) {
      // the moment of clearing: a flash, a shockwave, fireworks and falling shards
      if (MOTION >= 2) this.flashRect(0, 0, W, H, GREEN, 0.35);
      this.ring(W / 2, 520, GREEN, 60, 900, 0.8, 10);
      this.burst(W / 2, 300, [GREEN, WHITE, COL.cyan], 30, { speed: 700, life: 0.9, gravity: 380, size: 24 });
      this.confetti(460, 1460, 230, info.first ? 70 : 40);
    }
    if (crossed(0.25) && MOTION >= 2) this.burst(360 + Math.random() * 160, 260 + Math.random() * 120, [COL.magenta, WHITE, COL.amber], 26, { speed: 560, life: 0.9, gravity: 300, size: 22 });
    if (crossed(0.5) && MOTION >= 2) this.burst(1400 + Math.random() * 160, 260 + Math.random() * 120, [COL.cyan, WHITE, COL.lime], 26, { speed: 560, life: 0.9, gravity: 300, size: 22 });
    var on = [true, info.lean, info.fast], cc = [GREEN, COL.cyan, COL.magenta];
    for (var i = 0; i < 3; i++) {
      if (!crossed(CHIP_AT[i])) continue;
      if (!on[i]) continue;
      var x = W / 2 - 330 + i * 230 + 100;
      this.ring(x, 455, cc[i], 40, 150, 0.5, 6);
      this.burst(x, 455, [cc[i], WHITE], 18, { speed: 460, life: 0.6, gravity: 240, size: 20 });
      this.sound('chip', { i: i });
    }
    if (crossed(1.25) && (info.bestSize || info.bestCycles)) this.sound('chip', { i: 3 });
    if (crossed(UNLOCK_AT) && (info.unlock || info.extra)) {
      var big = info.unlock && info.unlock.chapter;
      this.burst(W / 2, 880, big ? [VIOLET, COL.amber, WHITE, COL.cyan] : [COL.amber, WHITE], big ? 40 : 20, { speed: big ? 640 : 420, life: 0.8, gravity: 200, size: 22 });
      this.ring(W / 2, 880, big ? VIOLET : COL.amber, 40, big ? 560 : 360, 0.7, 6);
      if (big) this.confetti(300, 1620, 820, 40);
      this.sound('unlock', { big: !!big });
    }
    info.last = t;
  };

  /** Stage times for drawCleared in deck.js; null when effects are off. */
  Deck.prototype.clearStage = function (game) {
    if (!MOTION || !game.fxClear) return null;
    var s = game.fxClear;
    s.pop = MOTION >= 2;
    s.chipAt = CHIP_AT;
    return s;
  };

  /** Below the cleared panel: what this clear opened. */
  Deck.prototype.drawUnlockBanner = function (s) {
    var u = s.unlock, t = s.t - UNLOCK_AT;
    if ((!u && !s.extra) || t < 0) return;
    var g = this.g, k = easeOut(t / 0.45), big = u && u.chapter;
    var y = 880 + (1 - k) * 40, w = big ? 1180 : 900, h = s.extra && u ? 104 : 74;
    g.save();
    g.globalAlpha = k;
    this.roundRect(W / 2 - w / 2, y - 37, w, h, 14);
    g.fillStyle = 'rgba(4,8,15,0.94)'; g.fill();
    var col = big ? VIOLET : COL.amber;
    this.glow(col, 10 + 24 * (0.5 + 0.5 * Math.sin(this.t * 4)));
    g.strokeStyle = col; g.lineWidth = 3; g.stroke(); this.noGlow();
    // a small padlock springing open
    var lx = W / 2 - w / 2 + 56, open = easeOut((t - 0.15) / 0.35);
    g.strokeStyle = col; g.lineWidth = 5;
    g.beginPath(); g.arc(lx, y - 8 - open * 12, 13, Math.PI, 0); g.stroke();
    g.beginPath(); g.moveTo(lx - 13, y - 8 - open * 12); g.lineTo(lx - 13, y - 2); g.stroke();
    g.fillStyle = col; g.fillRect(lx - 19, y - 4, 38, 26);
    var line = big
      ? 'CHAPTER ' + u.chapter + ' OPEN  ·  ' + (CHAPTERS[u.chapter - 1] || '') + '  ·  ' + u.code + ' ' + u.name
      : u ? 'UNLOCKED  ·  ' + u.code + '  ' + u.name : s.extra;
    this.text(line, W / 2 + 30, y, big ? 32 : 30, col, 'center', '700');
    if (s.extra && u) this.text(s.extra, W / 2 + 30, y + 40, 22, COL.amber, 'center', '600');
    g.restore();
  };

  /** The contract board: a card that just opened shimmers and says NEW until you open it. */
  Deck.prototype.drawFreshCard = function (lv, x, y, w, h) {
    var game = this.game, fx = this.fx;
    if (!MOTION || !game.fxFresh || !game.fxFresh[lv.id]) return;
    var g = this.g;
    if (fx && !fx.freshShown[lv.id]) {
      fx.freshShown[lv.id] = true;
      fx.ring(x + w / 2, y + h / 2, COL.amber, 60, 260, 0.6, 6);
      fx.burst(x + w / 2, y + h / 2, [COL.amber, WHITE, COL.cyan], 20, { speed: 420, life: 0.6, gravity: 120, size: 20 });
    }
    // sweep of light every few seconds
    var p = (this.t % 2.6) / 1.1;
    if (p < 1 && MOTION >= 2) {
      g.save();
      this.roundRect(x, y, w, h, 14); g.clip();
      var sx = x - 120 + p * (w + 240);
      var gr = g.createLinearGradient(sx - 80, 0, sx + 80, 0);
      gr.addColorStop(0, 'rgba(255,179,31,0)'); gr.addColorStop(0.5, 'rgba(255,220,140,0.18)'); gr.addColorStop(1, 'rgba(255,179,31,0)');
      g.fillStyle = gr; g.fillRect(x, y, w, h);
      g.restore();
    }
    var a = 0.65 + 0.35 * Math.sin(this.t * 5);
    this.roundRect(x + w - 92, y + 18, 72, 34, 17);
    g.fillStyle = 'rgba(255,179,31,' + (0.18 * a) + ')'; g.fill();
    this.glow(COL.amber, 14 * a); g.strokeStyle = COL.amber; g.lineWidth = 2; g.stroke(); this.noGlow();
    this.text('NEW', x + w - 56, y + 36, 18, COL.amber, 'center', '700');
  };

  // ---------- the Ledger ----------
  /** Credits shown in the Ledger's header roll toward the real figure instead of jumping. */
  Deck.prototype.shownCredits = function (actual) {
    var fx = this.fx;
    if (!fx || !MOTION) return actual;
    if (fx.credits === null) fx.credits = actual;
    var rate = this.game.overlay === 'report' ? 2.2 : 7;
    fx.credits += (actual - fx.credits) * Math.min(1, fx.dt * rate);
    if (Math.abs(actual - fx.credits) < 0.01) fx.credits = actual;
    return fx.credits;
  };
  /** Where the credits sit in the Ledger header (right aligned at W - 40). */
  var COUNTER = { x: W - 170, y: 46 };
  // gains and spends float up just left of the counter, clear of the line under it
  var FLOAT_AT = { x: W - 470, y: 96 };

  Fx.prototype.ledgerMoments = function (game, dt) {
    var d = this.d, L = game.save.ledger;
    if (!L || !d.bayRect) return;
    var credits = L.credits;
    var bays = G.LEDGER_TABS && G.LEDGER_TABS[game.ledgerTab] === 'bays' && game.overlay === 'ledger';
    if (this.lastCredits !== null && credits > this.lastCredits + 1e-6 && bays) {
      // each second the bays pay: a spark rises from every running window to the counter
      var cap = LG.bayCount(L);
      for (var i = 0; i < L.bays.length && i < cap; i++) {
        var r = d.bayRect(i), lv = null, all = LV();
        for (var j = 0; j < all.length; j++) if (all[j].id === L.bays[i]) lv = all[j];
        var col = lv && lv.kind === 'floor' ? COL.amber : lv && lv.kind === 'truck' ? GREEN : COL.cyan;
        this.seek(r.x + 70, r.y + r.h - 28, COUNTER.x, COUNTER.y, col, 2, 0.95 + i * 0.03);
      }
      this.pendingCr += credits - this.lastCredits;
      if (this.pendingCr >= 1) {
        this.float('+' + LG.fmt(this.pendingCr), FLOAT_AT.x, FLOAT_AT.y, GREEN, 26, 1.1);
        this.pendingCr = 0;
      }
    }
    this.lastCredits = credits;

    if (game.overlay === 'report' && game.report) {
      var rep = game.report;
      if (rep.kind === 'away' && game.reportT < 2.4) {
        this.reportAcc += dt;
        while (this.reportAcc > 0.07) {
          this.reportAcc -= 0.07;
          var bi = Math.floor(Math.random() * Math.max(1, Math.min(L.bays.length, rep.rows.length)));
          var rr = d.bayRect(bi);
          this.seek(rr.x + rr.w / 2, rr.y + rr.h / 2, W / 2 - 160, 985, [GREEN, COL.amber, WHITE][bi % 3], 1, 0.75);
        }
      }
      var doneAt = rep.kind === 'away' ? 2.4 : 0.3;
      if (!this.reportDone && game.reportT >= doneAt) {
        this.reportDone = true;
        this.burst(W / 2 - 160, 985, [GREEN, WHITE, COL.amber], 34, { speed: 620, life: 0.8, gravity: 260, size: 22 });
        this.ring(W / 2, 985, GREEN, 60, 520, 0.6, 6);
        this.sound('cash');
      }
    }
  };

  Fx.prototype.upgradeMoment = function (item, game) {
    var d = this.d, L = game.save.ledger;
    this.say('UPGRADE  ·  ' + item.name.toUpperCase() + '  LV ' + item.level, item.now, COL.amber);
    this.burst(COUNTER.x, COUNTER.y + 10, [COL.amber, WHITE], 18, { speed: 420, life: 0.6, gravity: 400, size: 20, dir: Math.PI / 2, spread: 2.4 });
    this.float('−' + LG.fmt(item.spent), FLOAT_AT.x, FLOAT_AT.y, COL.amber, 26, 1.1);
    if (!d.bayRect) return;
    if (item.id === 'bays' && item.cap1 > item.cap0) {
      var r = d.bayRect(item.cap1 - 1);
      this.flashRect(r.x, r.y, r.w, r.h, COL.cyan, 0.9);
      this.ring(r.x + r.w / 2, r.y + r.h / 2, COL.cyan, 40, 260, 0.6, 6);
      this.burst(r.x + r.w / 2, r.y + r.h / 2, [COL.cyan, WHITE], 22, { speed: 420, life: 0.6, gravity: 200, size: 20 });
    } else if (item.id === 'overclock') {
      for (var i = 0; i < L.bays.length; i++) {
        var b = d.bayRect(i);
        this.flashRect(b.x, b.y, b.w, b.h, COL.magenta, 0.5 + i * 0.06);
        this.burst(b.x + b.w / 2, b.y + b.h - 30, [COL.magenta, WHITE], 6, { speed: 260, life: 0.5, gravity: -120, size: 18, dir: -Math.PI / 2, spread: 1.4 });
      }
    } else {
      var a = d.bayRect(0), z = d.bayRect(LG.BAYS_START + LG.UPGRADES[0].costs.length - 1);
      this.flashRect(a.x - 40, a.y - 50, z.x + z.w - a.x + 80, z.y + z.h - a.y + 80, item.id === 'shift' ? VIOLET : GREEN, 0.7);
    }
  };

  Fx.prototype.bayMoment = function (item, game) {
    var d = this.d;
    if (!d.bayRect || game.overlay !== 'ledger') return;
    var r = d.bayRect(item.i);
    if (item.k === 'bayIn') {
      this.flashRect(r.x, r.y, r.w, r.h, COL.cyan, 0.6);
      this.burst(r.x + r.w / 2, r.y + r.h / 2, [COL.cyan, WHITE, COL.lime], 18, { speed: 380, life: 0.55, gravity: 160, size: 20 });
      this.ring(r.x + r.w / 2, r.y + r.h / 2, COL.cyan, 30, 200, 0.5, 5);
    } else {
      this.burst(r.x + r.w / 2, r.y + r.h / 2, [DIM, '#2b3d55'], 12, { speed: 160, life: 0.6, gravity: 420, size: 16 });
    }
  };

  // ---------- simulate and draw ----------
  Fx.prototype.update = function (dt) {
    var p = this.parts, i, o;
    for (i = p.length - 1; i >= 0; i--) {
      o = p[i];
      o.life += dt;
      if (o.life >= o.max) { p[i] = p[p.length - 1]; p.pop(); continue; }
      if (o.kind === 'seek') {
        // curve in toward the target, faster near the end
        var k = o.life / o.max, pull = 2 + k * 14;
        o.vx += (o.tx - o.x) * pull * dt * 2.2 - o.vx * dt * 3;
        o.vy += (o.ty - o.y) * pull * dt * 2.2 - o.vy * dt * 3;
        o.x += o.vx * dt; o.y += o.vy * dt;
        if (Math.abs(o.tx - o.x) + Math.abs(o.ty - o.y) < 18) { o.life = o.max; if (this.parts.length < MAX_PARTS - 2) this.flashDot(o.tx, o.ty, o.col); }
        continue;
      }
      var drag = Math.max(0, 1 - o.drag * dt);
      o.vx *= drag; o.vy = o.vy * drag + o.g * dt;
      o.x += o.vx * dt; o.y += o.vy * dt;
      if (o.kind === 'shard') o.rot += o.vr * dt;
    }
    for (i = this.rings.length - 1; i >= 0; i--) { this.rings[i].life += dt; if (this.rings[i].life >= this.rings[i].max) this.rings.splice(i, 1); }
    for (i = this.texts.length - 1; i >= 0; i--) { this.texts[i].life += dt; if (this.texts[i].life >= this.texts[i].max) this.texts.splice(i, 1); }
    for (i = this.flashes.length - 1; i >= 0; i--) { this.flashes[i].life += dt; if (this.flashes[i].life >= this.flashes[i].max) this.flashes.splice(i, 1); }
    if (this.banner) { this.banner.t += dt; if (this.banner.t >= this.banner.max) this.banner = null; }
  };
  Fx.prototype.flashDot = function (x, y, col) {
    this.parts.push({ x: x, y: y, vx: 0, vy: 0, g: 0, drag: 0, life: 0, max: 0.25, size: 46, col: col, kind: 'spark' });
  };

  Fx.prototype.render = function () {
    var d = this.d, g = d.g;
    if (!this.parts.length && !this.rings.length && !this.texts.length && !this.flashes.length && !this.banner) return;
    var s = d.scale, ox = d.ox + (d.shakeX || 0) * s, oy = d.oy + (d.shakeY || 0) * s;
    g.save();
    g.setTransform(s, 0, 0, s, ox, oy);
    g.beginPath(); g.rect(0, 0, W, H); g.clip();
    var i, o, a;
    // soft flashes
    for (i = 0; i < this.flashes.length; i++) {
      o = this.flashes[i]; a = 1 - o.life / o.max;
      g.globalAlpha = 0.22 * a * a;
      g.fillStyle = o.col; g.fillRect(o.x, o.y, o.w, o.h);
    }
    g.globalCompositeOperation = 'lighter';
    // rings
    for (i = 0; i < this.rings.length; i++) {
      o = this.rings[i]; var k = easeOut(o.life / o.max);
      g.globalAlpha = (1 - o.life / o.max) * 0.9;
      g.strokeStyle = o.col; g.lineWidth = Math.max(1, o.w * (1 - k * 0.7));
      g.beginPath(); g.arc(o.x, o.y, o.r0 + (o.r1 - o.r0) * k, 0, 6.283); g.stroke();
    }
    // sparks and coins: one cached glow sprite per colour, no per-particle shadowBlur
    for (i = 0; i < this.parts.length; i++) {
      o = this.parts[i];
      a = 1 - o.life / o.max;
      if (o.kind === 'shard') continue;
      g.globalAlpha = Math.min(1, a * 1.4);
      var sz = o.size * (o.kind === 'seek' ? 1 : 0.5 + a * 0.5);
      g.drawImage(sprite(o.col), o.x - sz / 2, o.y - sz / 2, sz, sz);
    }
    g.globalCompositeOperation = 'source-over';
    // shards tumble as flat coloured strips (cos of the spin fakes a flip)
    for (i = 0; i < this.parts.length; i++) {
      o = this.parts[i];
      if (o.kind !== 'shard') continue;
      a = 1 - o.life / o.max;
      var c = Math.cos(o.rot), sn = Math.sin(o.rot), flip = Math.abs(Math.cos(o.rot * 0.7)) * 0.8 + 0.2;
      g.globalAlpha = Math.min(1, a * 2);
      g.setTransform(s * c, s * sn, -s * sn * flip, s * c * flip, ox + o.x * s, oy + o.y * s);
      g.fillStyle = o.col; g.fillRect(-o.w / 2, -o.h / 2, o.w, o.h);
    }
    g.setTransform(s, 0, 0, s, ox, oy);
    // floating numbers
    for (i = 0; i < this.texts.length; i++) {
      o = this.texts[i]; k = o.life / o.max;
      g.globalAlpha = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.55) / 0.45);
      d.text(o.s, o.x, o.y - easeOut(k) * 60, o.size, o.col, 'center', '700');
    }
    g.globalAlpha = 1;
    if (this.banner) this.drawBanner(this.banner);
    g.restore();
  };

  Fx.prototype.drawBanner = function (b) {
    var d = this.d, g = d.g;
    var inK = MOTION >= 2 ? backOut(b.t / 0.35) : easeOut(b.t / 0.2), out = clamp01((b.max - b.t) / 0.4);
    var w = 1100 * Math.max(0.05, inK), h = 150, y = 560;
    g.globalAlpha = out;
    d.roundRect(W / 2 - w / 2, y - h / 2, w, h, 18);
    g.fillStyle = 'rgba(3,6,12,0.94)'; g.fill();
    d.glow(b.col, 30); g.strokeStyle = b.col; g.lineWidth = 3; g.stroke(); d.noGlow();
    if (inK > 0.6) {
      g.globalAlpha = out * clamp01((inK - 0.6) / 0.4);
      d.glow(b.col, 18);
      d.text(b.title, W / 2, y - 22, 44, b.col, 'center', '700');
      d.noGlow();
      if (b.sub) d.text(b.sub, W / 2, y + 36, 28, INK, 'center', '600');
    }
    g.globalAlpha = 1;
  };

  // ---------- wire into the deck's frame ----------
  var draw = Deck.prototype.draw;
  Deck.prototype.draw = function (dt) {
    if (!MOTION) { this.shakeX = this.shakeY = 0; if (this.game) this.game.fxEvents = []; return draw.call(this, dt); }
    var fx = this.fx || (this.fx = new Fx(this));
    fx.before(dt);
    draw.call(this, dt);
    if (!this.scale) return;
    fx.after();
    fx.update(dt);
    fx.render();
  };

  Deck.Fx = Fx;
})(typeof self !== 'undefined' ? self : this);
