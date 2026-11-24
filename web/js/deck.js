/*
 * Overshift deck view: the factory floor, drawn on a canvas in a 1920x1080 logical space.
 * Reads the host Game directly. Taps hit-test against regions recorded while drawing.
 */
(function (root) {
  'use strict';
  var C = root.OvershiftCore;
  var W = 1920, H = 1080;
  var COL = { cyan: '#22e8ff', magenta: '#ff3df0', amber: '#ffb31f', lime: '#a6ff3a' };
  var INK = '#d7f6ff', DIM = '#5b7590', FAINT = '#1b2a3d', RED = '#ff3b5c', GREEN = '#5dffa8', VIOLET = '#9b7bff';
  var FONT = '"IBM Plex Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
  var ICON = { intake: 'IN', painter: 'PNT', press: 'PRS', recycler: 'RCY', outbound: 'OUT' };

  function Deck(canvas, game) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.game = game;
    this.hits = [];
    this.servoX = null;
    this.lastSim = null;
    this.pulse = 0;
    this.faultFlash = 0;
    this.t = 0;
    this.cellPos = {};
    this.buildSkyline();
    var self = this;
    canvas.addEventListener('pointerup', function (e) { self.onTap(e); });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  Deck.prototype.buildSkyline = function () {
    var r = 12345, rand = function () { r = (r * 1103515245 + 12345) & 0x7fffffff; return r / 0x7fffffff; };
    this.towers = [];
    var x = 0;
    while (x < W) {
      var w = 50 + rand() * 110, h = 50 + rand() * 170;
      var wins = [];
      for (var wy = 300 - h + 14; wy < 290; wy += 18) for (var wx = x + 8; wx < x + w - 10; wx += 16) if (rand() < 0.22) wins.push([wx, wy, rand() * 6.28, 0.3 + rand() * 1.5]);
      this.towers.push({ x: x, w: w, h: h, wins: wins });
      x += w + 6 + rand() * 20;
    }
  };

  Deck.prototype.resize = function () {
    var c = this.canvas, dpr = Math.min(root.devicePixelRatio || 1, 2.5);
    var w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    }
    this.scale = Math.min(c.width / W, c.height / H);
    this.ox = (c.width - W * this.scale) / 2;
    this.oy = (c.height - H * this.scale) / 2;
    this.dpr = dpr;
  };

  Deck.prototype.onTap = function (e) {
    var rect = this.canvas.getBoundingClientRect();
    var px = (e.clientX - rect.left) * this.dpr, py = (e.clientY - rect.top) * this.dpr;
    var x = (px - this.ox) / this.scale, y = (py - this.oy) / this.scale;
    for (var i = this.hits.length - 1; i >= 0; i--) {
      var h = this.hits[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) { this.game.act(h.a); return; }
    }
  };

  Deck.prototype.hit = function (x, y, w, h, a) { this.hits.push({ x: x, y: y, w: w, h: h, a: a }); };

  // ---------- primitives ----------
  Deck.prototype.text = function (s, x, y, size, color, align, weight) {
    var g = this.g;
    g.font = (weight || '500') + ' ' + size + 'px ' + FONT;
    g.fillStyle = color || INK;
    g.textAlign = align || 'left';
    g.textBaseline = 'middle';
    g.fillText(s, x, y);
  };

  Deck.prototype.glow = function (color, blur) { this.g.shadowColor = color; this.g.shadowBlur = blur; };
  Deck.prototype.noGlow = function () { this.g.shadowBlur = 0; };

  Deck.prototype.roundRect = function (x, y, w, h, r) {
    var g = this.g;
    g.beginPath();
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  };

  Deck.prototype.cell = function (cell, x, y, r, opts) {
    opts = opts || {};
    var g = this.g, col = COL[cell.c] || INK;
    g.save();
    g.globalAlpha = opts.alpha === undefined ? 1 : opts.alpha;
    g.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = Math.PI / 6 + i * Math.PI / 3;
      g.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
    }
    g.closePath();
    g.fillStyle = '#05080e';
    g.fill();
    this.glow(col, opts.noGlow ? 0 : r * 0.6);
    g.strokeStyle = col;
    g.lineWidth = Math.max(2, r * 0.11);
    g.stroke();
    this.noGlow();
    // color glyph (dot, bar, cross, ring) so color is never the only cue
    var gy = y - r * 0.5, gs = r * 0.16;
    g.fillStyle = col; g.strokeStyle = col; g.lineWidth = Math.max(1.5, r * 0.07);
    if (cell.c === 'cyan') { g.beginPath(); g.arc(x, gy, gs * 0.8, 0, 6.29); g.fill(); }
    else if (cell.c === 'magenta') { g.fillRect(x - gs * 1.3, gy - gs * 0.45, gs * 2.6, gs * 0.9); }
    else if (cell.c === 'amber') { g.beginPath(); g.moveTo(x - gs, gy - gs); g.lineTo(x + gs, gy + gs); g.moveTo(x + gs, gy - gs); g.lineTo(x - gs, gy + gs); g.stroke(); }
    else { g.beginPath(); g.arc(x, gy, gs, 0, 6.29); g.stroke(); }
    this.text(String(cell.q), x, y + r * 0.14, Math.round(r * 0.78), col, 'center', '700');
    g.restore();
  };

  Deck.prototype.stationX = function (i, n) {
    var x0 = 560, x1 = 1360;
    return n <= 1 ? (x0 + x1) / 2 : x0 + i * (x1 - x0) / (n - 1);
  };

  // ---------- frame ----------
  Deck.prototype.draw = function (dt) {
    this.resize();
    if (!this.scale) return;
    var g = this.g, game = this.game, sim = game.sim, lv = game.level;
    this.t += dt;
    this.hits = [];
    this.cellPos = {};

    if (sim !== this.lastSim) {
      if (this.lastSim && sim.event) {
        this.pulse = 1;
        if (sim.status === 'fault') this.faultFlash = 1;
      }
      this.lastSim = sim;
    }
    this.pulse = Math.max(0, this.pulse - dt * 3);
    this.faultFlash = Math.max(0, this.faultFlash - dt * 1.2);

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#000';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // shakeX / shakeY: a brief jolt from fx.js on a fault (logical pixels; hit tests ignore it)
    g.setTransform(this.scale, 0, 0, this.scale, this.ox + (this.shakeX || 0) * this.scale, this.oy + (this.shakeY || 0) * this.scale);
    g.save();
    g.beginPath(); g.rect(0, 0, W, H); g.clip();

    this.drawBackdrop();
    if ((game.overlay === 'ledger' || game.overlay === 'report') && this.drawLedgerScene) {
      this.drawLedgerScene(game, dt);
      g.restore();
      return;
    }
    this.drawHeader(lv, game);
    if (game.isFloor && game.isFloor() && this.drawFloorScene) this.drawFloorScene(dt);
    else if (game.isTruck && game.isTruck() && this.drawTruckScene) this.drawTruckScene(dt);
    else {
      this.drawRail(lv, sim, dt);
      this.drawBelts(lv, sim, game);
      this.drawStatus(game);
      this.drawTicket(lv, game);
    }

    if (this.faultFlash > 0) {
      g.fillStyle = 'rgba(255,40,70,' + (0.18 * this.faultFlash) + ')';
      g.fillRect(0, 0, W, H);
    }
    if (game.overlay === 'cleared') this.drawCleared(game);
    else if (game.overlay === 'board') this.drawBoard(game);
    g.restore();
  };

  Deck.prototype.drawBackdrop = function () {
    var g = this.g, t = this.t;
    // faint blueprint grid
    g.strokeStyle = '#0b1420'; g.lineWidth = 1;
    g.beginPath();
    for (var x = 0; x <= W; x += 60) { g.moveTo(x, 120); g.lineTo(x, H); }
    for (var y = 120; y <= H; y += 60) { g.moveTo(0, y); g.lineTo(W, y); }
    g.stroke();
    // megatower skyline
    for (var i = 0; i < this.towers.length; i++) {
      var tw = this.towers[i];
      g.fillStyle = '#050a14';
      g.fillRect(tw.x, 300 - tw.h, tw.w, tw.h);
      g.strokeStyle = '#122238'; g.lineWidth = 1.5;
      g.strokeRect(tw.x + 0.5, 300 - tw.h + 0.5, tw.w - 1, tw.h);
      for (var k = 0; k < tw.wins.length; k++) {
        var wn = tw.wins[k];
        var on = Math.sin(t * wn[3] + wn[2]) > -0.2;
        if (!on) continue;
        g.fillStyle = k % 7 === 0 ? 'rgba(255,61,240,0.35)' : k % 5 === 0 ? 'rgba(255,179,31,0.3)' : 'rgba(34,232,255,0.28)';
        g.fillRect(wn[0], wn[1], 7, 4);
      }
    }
    g.fillStyle = '#000';
    g.fillRect(0, 300, W, 2);
  };

  Deck.prototype.drawHeader = function (lv, game) {
    var g = this.g;
    g.fillStyle = 'rgba(0,0,0,0.85)';
    g.fillRect(0, 0, W, 118);
    g.strokeStyle = FAINT; g.beginPath(); g.moveTo(0, 118); g.lineTo(W, 118); g.stroke();
    var label = lv.city ? 'LEDGER ROUTE' : 'CONTRACT ' + (lv.code || (lv.chapter === 2 ? '2-' + ('0' + lv.num).slice(-2) : ('0' + (lv.index + 1)).slice(-2)));
    this.glow(COL.cyan, 14);
    this.text(label, 40, 40, 26, COL.cyan, 'left', '600');
    this.noGlow();
    this.text(lv.name.toUpperCase(), lv.city ? 270 : lv.chapter >= 2 ? 290 : 250, 40, 40, INK, 'left', '700');
    this.text('“' + lv.client + '”', 40, 88, 25, DIM, 'left', '400');
    this.hit(30, 15, 600, 50, { type: 'board' });
    if (lv.city) {
      this.text('SAMPLE HOUR', W - 40, 40, 24, COL.amber, 'right', '600');
      this.text('TICK', W - 40, 92, 20, DIM, 'right', '500');
      this.text(game.sim.now + ' / ' + (lv.ticks || 0), W - 100, 92, 30, INK, 'right', '700');
      return;
    }

    // stream tabs
    var n = game.revealed, tw = 150, gap = 10, x = W - 40 - n * tw - (n - 1) * gap;
    for (var i = 0; i < n; i++) {
      var sel = i === game.streamIdx;
      var hidden = i >= lv.visibleStreams;
      var col = hidden ? COL.amber : COL.cyan;
      this.roundRect(x, 20, tw, 50, 8);
      g.fillStyle = sel ? 'rgba(34,232,255,0.14)' : 'rgba(255,255,255,0.02)';
      if (sel && hidden) g.fillStyle = 'rgba(255,179,31,0.16)';
      g.fill();
      g.strokeStyle = sel ? col : FAINT; g.lineWidth = 2;
      if (sel) this.glow(col, 10);
      g.stroke();
      this.noGlow();
      this.text((hidden ? 'HIDDEN ' : 'STREAM ') + (i + 1), x + tw / 2, 45, 22, sel ? col : DIM, 'center', '600');
      this.hit(x, 20, tw, 50, { type: 'stream', i: i });
      x += tw + gap;
    }
    this.text('CYCLES', W - 40, 92, 20, DIM, 'right', '500');
    this.text(String(game.sim.cycles), W - 140, 92, 30, INK, 'right', '700');
  };

  Deck.prototype.drawRail = function (lv, sim, dt) {
    var g = this.g, n = lv.stations.length;
    var railY = 330, x0 = this.stationX(0, n) - 90, x1 = this.stationX(n - 1, n) + 90;
    // rail
    this.glow(VIOLET, 12);
    g.strokeStyle = VIOLET; g.lineWidth = 4;
    g.beginPath(); g.moveTo(x0, railY); g.lineTo(x1, railY); g.stroke();
    this.noGlow();
    g.strokeStyle = '#2b2350'; g.lineWidth = 2;
    for (var rx = x0; rx <= x1; rx += 24) { g.beginPath(); g.moveTo(rx, railY + 6); g.lineTo(rx + 10, railY + 14); g.stroke(); }

    // stations
    for (var i = 0; i < n; i++) {
      var st = lv.stations[i], x = this.stationX(i, n), y = 560;
      var active = sim.pos === i && this.pulse > 0;
      var col = st === 'painter' ? COL.magenta : st === 'press' ? COL.amber : st === 'recycler' ? RED : st === 'intake' ? COL.cyan : GREEN;
      this.roundRect(x - 78, y - 60, 156, 120, 12);
      g.fillStyle = active ? 'rgba(255,255,255,0.06)' : '#03060b';
      g.fill();
      this.glow(col, active ? 30 : 10);
      g.strokeStyle = col; g.lineWidth = 3;
      g.stroke();
      this.noGlow();
      this.text(ICON[st], x, y - 14, 34, col, 'center', '700');
      this.text(C.STATION_NAMES[st].toUpperCase(), x, y + 30, 18, DIM, 'center', '500');
      // drop line from rail
      g.strokeStyle = FAINT; g.setLineDash([4, 6]); g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, railY + 8); g.lineTo(x, y - 62); g.stroke();
      g.setLineDash([]);
    }

    // recycler bin
    var ri = lv.stations.indexOf('recycler');
    if (ri >= 0 && sim.scrapped.length) {
      var rx2 = this.stationX(ri, n);
      var shown = sim.scrapped.slice(-4);
      for (var s = 0; s < shown.length; s++) {
        var cx = rx2 - (shown.length - 1) * 22 + s * 44;
        this.cell(shown[s], cx, 660, 20, { alpha: 0.55, noGlow: true });
        this.cellPos[shown[s].id] = [cx, 660, 20];
        this.hit(cx - 22, 638, 44, 44, { type: 'trace', id: shown[s].id });
      }
      this.text('SCRAPPED ' + sim.scrapped.length, rx2, 702, 16, RED, 'center', '500');
    }

    // servo
    var tx = this.stationX(sim.pos, n);
    if (this.servoX === null) this.servoX = tx;
    var k = this.game.mode === 'fast' ? 30 : 11;
    this.servoX += (tx - this.servoX) * Math.min(1, dt * k);
    var sx = this.servoX;
    var light = sim.status === 'fault' ? RED : this.pulse > 0 ? '#ffffff' : COL.cyan;
    // carriage
    this.roundRect(sx - 48, railY - 22, 96, 44, 8);
    g.fillStyle = '#0a0c18'; g.fill();
    this.glow(VIOLET, 14); g.strokeStyle = VIOLET; g.lineWidth = 3; g.stroke(); this.noGlow();
    // status light
    g.beginPath(); g.arc(sx, railY, 8 + this.pulse * 4, 0, 6.29);
    this.glow(light, 20 + this.pulse * 20); g.fillStyle = light; g.fill(); this.noGlow();
    // arm
    g.strokeStyle = INK; g.lineWidth = 6;
    g.beginPath(); g.moveTo(sx, railY + 22); g.lineTo(sx, railY + 70); g.stroke();
    g.beginPath(); g.moveTo(sx - 34, railY + 70); g.lineTo(sx + 34, railY + 70); g.stroke();
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(sx - 34, railY + 70); g.lineTo(sx - 34, railY + 86); g.moveTo(sx + 34, railY + 70); g.lineTo(sx + 34, railY + 86); g.stroke();
    if (sim.held) this.cell(sim.held, sx, railY + 116, 32);
  };

  Deck.prototype.drawBelt = function (xa, xb, y, dir) {
    var g = this.g;
    g.strokeStyle = '#18324a'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(xa, y - 40); g.lineTo(xb, y - 40); g.moveTo(xa, y + 40); g.lineTo(xb, y + 40); g.stroke();
    // scrolling dashes, always alive
    var off = (this.t * 60 * dir) % 40;
    g.strokeStyle = '#1f6b86'; g.lineWidth = 3;
    g.setLineDash([14, 26]); g.lineDashOffset = -off;
    g.beginPath(); g.moveTo(xa, y + 32); g.lineTo(xb, y + 32); g.stroke();
    g.setLineDash([]); g.lineDashOffset = 0;
  };

  Deck.prototype.drawBelts = function (lv, sim, game) {
    var n = lv.stations.length;
    var inX = this.stationX(0, n) - 80, outX = this.stationX(n - 1, n) + 80;
    var y = 560;
    this.drawBelt(30, inX, y, 1);
    this.drawBelt(outX, W - 30, y, 1);
    // intake queue: next cell nearest the intake
    var q = sim.intake, avail = inX - 70;
    var sp = q.length > 1 ? Math.min(74, (avail - 30) / (q.length - 1)) : 74;
    for (var i = q.length - 1; i >= 0; i--) this.cell(q[i], inX - 44 - i * sp, y - 4, 30, { alpha: i === 0 ? 1 : 0.85 });
    this.text('INTAKE ' + q.length, 40, y - 62, 18, DIM, 'left', '500');
    // outbound: newest nearest the dock, older ones carried right
    var s = sim.shipped, avail2 = W - 30 - outX - 70;
    var sp2 = s.length > 1 ? Math.min(74, avail2 / (s.length - 1)) : 74;
    for (var j = 0; j < s.length; j++) {
      var age = s.length - 1 - j;
      var cx = outX + 44 + age * sp2;
      var bad = sim.status === 'fault' && j === s.length - 1 && game.sim.event && game.sim.event.type === 'fault';
      this.cell(s[j], cx, y - 4, 30, { alpha: bad ? 0.9 : 1 });
      if (bad) { this.g.strokeStyle = RED; this.g.lineWidth = 4; this.g.beginPath(); this.g.arc(cx, y - 4, 40, 0, 6.29); this.g.stroke(); }
      this.cellPos[s[j].id] = [cx, y - 4, 30];
      this.hit(cx - 34, y - 38, 68, 68, { type: 'trace', id: s[j].id });
    }
    this.text('OUTBOUND ' + s.length, W - 40, y - 62, 18, DIM, 'right', '500');

    // inspect cursor
    var cells = game.outputCells();
    if (game.inspectIdx >= 0 && cells[game.inspectIdx]) {
      var p = this.cellPos[cells[game.inspectIdx].id];
      if (p) {
        var g = this.g;
        this.glow(VIOLET, 16); g.strokeStyle = VIOLET; g.lineWidth = 3;
        g.setLineDash([8, 6]);
        g.beginPath(); g.arc(p[0], p[1], p[2] + 14, 0, 6.29); g.stroke();
        g.setLineDash([]); this.noGlow();
      }
    }
  };

  Deck.prototype.drawStatus = function (game) {
    var sim = game.sim, mode = game.mode, msg, col = DIM;
    if (game.flashMsg && (game.flashMsg.kind === 'fault' || mode === 'edit' || mode === 'done')) {
      msg = game.flashMsg.msg; col = game.flashMsg.kind === 'fault' ? RED : game.flashMsg.kind === 'warn' ? COL.amber : INK;
    } else if (mode === 'edit') msg = 'EDITING  ·  Start to run, R2 to step';
    else if (mode === 'run') { msg = 'RUNNING  ▶'; col = COL.cyan; }
    else if (mode === 'fast') { msg = 'FAST  ▶▶'; col = COL.cyan; }
    else if (mode === 'pause') { msg = 'PAUSED  ·  step ' + sim.steps; col = INK; }
    else if (sim.status === 'win') { msg = sim.msg; col = GREEN; }
    else { msg = sim.msg; col = RED; }
    if (msg.length > 96) msg = msg.slice(0, 95) + '…';
    this.text(msg, W / 2, 742, 26, col, 'center', '600');
  };

  Deck.prototype.drawTicket = function (lv, game) {
    var g = this.g, sim = game.sim;
    var order = game.ctx.order;
    this.roundRect(30, 790, W - 60, 260, 16);
    g.fillStyle = '#03070d'; g.fill();
    g.strokeStyle = FAINT; g.lineWidth = 2; g.stroke();
    this.text('ORDER TICKET', 60, 826, 22, COL.cyan, 'left', '700');
    this.text(lv.brief, 290, 826, 22, INK, 'left', '400');
    var shipped = sim.shipped.length;
    var faulted = sim.status === 'fault';
    var n = order.length;
    var sp = n > 1 ? Math.min(118, (W - 220) / (n - 1)) : 118;
    var r = Math.min(40, sp * 0.36);
    var startX = W / 2 - (n - 1) * sp / 2;
    for (var i = 0; i < n; i++) {
      var x = startX + i * sp, y = 920;
      var done = i < shipped && !(faulted && i === shipped - 1 && sim.event && sim.event.type === 'fault');
      var next = i === shipped && sim.status === 'run';
      this.cell(order[i], x, y, r, { alpha: done ? 1 : 0.45, noGlow: !done });
      if (done) this.text('✓', x, y + r + 26, 26, GREEN, 'center', '700');
      if (next) {
        var a = 0.5 + 0.5 * Math.sin(this.t * 5);
        g.strokeStyle = 'rgba(215,246,255,' + a + ')'; g.lineWidth = 3;
        g.beginPath(); g.arc(x, y, r + 10, 0, 6.29); g.stroke();
      }
    }
    if (!n) this.text('Nothing to ship on this stream.', W / 2, 920, 24, DIM, 'center');
    var best = game.save.best[lv.id];
    var line = 'SIZE ' + game.viewModelSize() + '  par ' + lv.parSize + (lv.limit ? '  limit ' + lv.limit : '') +
      '      CYCLES par ' + lv.parCycles + (best ? '      BEST  size ' + best.size + '  cycles ' + best.cycles : '');
    this.text(line, W / 2, 1018, 20, DIM, 'center', '500');
  };

  Deck.prototype.panel = function (x, y, w, h, col, noDim) {
    var g = this.g;
    if (!noDim) { g.fillStyle = 'rgba(0,0,0,0.78)'; g.fillRect(0, 0, W, H); }
    this.roundRect(x, y, w, h, 20);
    g.fillStyle = '#04080f'; g.fill();
    this.glow(col, 30); g.strokeStyle = col; g.lineWidth = 3; g.stroke(); this.noGlow();
    this.hit(0, 0, W, H, { type: 'noop' });
  };

  Deck.prototype.button = function (label, x, y, w, h, col, action, primary) {
    var g = this.g;
    this.roundRect(x, y, w, h, 10);
    g.fillStyle = primary ? 'rgba(34,232,255,0.16)' : 'rgba(255,255,255,0.03)'; g.fill();
    g.strokeStyle = col; g.lineWidth = 2; g.stroke();
    this.text(label, x + w / 2, y + h / 2, 26, col, 'center', '600');
    this.hit(x, y, w, h, action);
  };

  Deck.prototype.drawCleared = function (game) {
    var r = game.result, lv = game.level, g = this.g;
    // staged reveal from fx.js: the panel pops in, chips land one by one, scores count up
    var s = this.clearStage ? this.clearStage(game) : null, t = s ? s.t : 99;
    function at(t0, d) { var k = (t - t0) / (d || 0.3); return k < 0 ? 0 : k > 1 ? 1 : k; }
    function pop(k) { if (!s || !s.pop) return k > 0 ? 1 : 0; k -= 1; return k * k * (2.9 * k + 1.9) + 1; }
    this.hits = [];
    g.fillStyle = 'rgba(0,0,0,' + (0.78 * Math.min(1, t / 0.2)) + ')'; g.fillRect(0, 0, W, H);
    var ps = s && s.pop ? 0.82 + 0.18 * pop(at(0, 0.32)) : 1;
    g.save();
    g.globalAlpha = Math.min(1, t / 0.15);
    g.translate(W / 2, 520); g.scale(ps, ps); g.translate(-W / 2, -520);
    this.panel(460, 230, 1000, 580, GREEN, true);
    this.glow(GREEN, 24 + 40 * Math.max(0, 1 - t / 0.9));
    this.text('CONTRACT CLEARED', W / 2, 310, 54, GREEN, 'center', '700');
    this.noGlow();
    this.text(lv.name + ' · all ' + lv.streams.length + ' stream' + (lv.streams.length > 1 ? 's' : '') + ' filled', W / 2, 370, 26, DIM, 'center');
    var lean = r.size <= lv.parSize, fast = r.cycles <= lv.parCycles;
    var chips = [['CLEARED', true], ['LEAN', lean], ['FAST', fast]];
    for (var i = 0; i < 3; i++) {
      var x = W / 2 - 330 + i * 230, on = chips[i][1];
      var k = s ? at(s.chipAt[i], 0.28) : 1;
      if (k <= 0) continue;
      var col = on ? (i === 0 ? GREEN : i === 1 ? COL.cyan : COL.magenta) : FAINT;
      var cs = on ? pop(k) : 1;
      g.save();
      g.globalAlpha = on ? Math.min(1, k * 3) : k;
      g.translate(x + 100, 455); g.scale(cs, cs); g.translate(-x - 100, -455);
      this.roundRect(x, 420, 200, 70, 35);
      g.fillStyle = on ? 'rgba(255,255,255,' + (0.05 + 0.2 * (1 - k)) + ')' : 'transparent'; g.fill();
      if (on) this.glow(col, 16 + 30 * (1 - k));
      g.strokeStyle = col; g.lineWidth = 3; g.stroke(); this.noGlow();
      this.text(chips[i][0], x + 100, 455, 26, on ? col : DIM, 'center', '700');
      g.restore();
    }
    var cnt = s ? at(0.35, 0.7) : 1;
    cnt = 1 - Math.pow(1 - cnt, 3);
    this.text('Size ' + Math.round(r.size * cnt) + '  (par ' + lv.parSize + ')', W / 2 - 200, 550, 30, lean ? COL.cyan : INK, 'center', '600');
    this.text('Cycles ' + Math.round(r.cycles * cnt) + '  (par ' + lv.parCycles + ')', W / 2 + 200, 550, 30, fast ? COL.magenta : INK, 'center', '600');
    if (s && (s.bestSize || s.bestCycles)) {
      var bk = at(1.25, 0.3), bs = pop(bk);
      if (bk > 0) {
        g.save(); g.globalAlpha = Math.min(1, bk * 3);
        if (s.bestSize) this.text('NEW BEST', W / 2 - 200, 512 - 6 * (bs - 1), 20 * bs, COL.amber, 'center', '700');
        if (s.bestCycles) this.text('NEW BEST', W / 2 + 200, 512 - 6 * (bs - 1), 20 * bs, COL.amber, 'center', '700');
        g.restore();
      }
    }
    var tip = lean && fast ? 'Both chips. Clean shift.' : 'Beat par on Size or Cycles for a bonus chip.';
    if (r.parts !== undefined) tip = 'Parts ' + r.parts + ' (par ' + lv.parParts + ')   ·   ' + tip;
    g.save(); g.globalAlpha = s ? at(1.0, 0.4) : 1;
    this.text(tip, W / 2, 600, 24, DIM, 'center');
    g.globalAlpha = s ? at(1.2, 0.4) : 1;
    if (r.ledger && this.clearedPayLine) this.clearedPayLine(r.ledger, W / 2, 646);
    g.restore();
    var all = game.constructor.LEVELS || C.LEVELS;
    var last = lv.index === all.length - 1;
    this.button(last ? 'A  Contracts' : 'A  Next contract', W / 2 - 330, 700, 320, 76, GREEN, { type: 'next' }, true);
    this.button('B  Keep editing', W / 2 + 10, 700, 320, 76, INK, { type: 'close' });
    g.restore();
    if (s && this.drawUnlockBanner) this.drawUnlockBanner(s);
  };

  Deck.prototype.drawBoard = function (game) {
    this.hits = [];
    this.panel(80, 70, W - 160, H - 140, COL.cyan);
    var all = game.constructor.LEVELS || C.LEVELS, per = 10;
    var page = Math.floor(game.boardSel / per), pages = Math.ceil(all.length / per);
    var titles = ['NIGHT SHIFT', 'JUNCTION FLOOR', 'FIRST ROUTES'];
    this.text((titles[page] || 'CHAPTER ' + (page + 1)) + '  ·  CONTRACT BOARD', 140, 140, 40, COL.cyan, 'left', '700');
    this.text('D-pad pick · A open · L1/R1 page · B close', W - 210, 140, 22, DIM, 'right');
    var tab0 = 140;
    if (this.drawLedgerTab) tab0 = this.drawLedgerTab(game, 140, 930);
    for (var pg = 0; pg < pages; pg++) {
      var tx = tab0 + pg * 270, on = pg === page;
      this.roundRect(tx, 930, 250, 56, 10);
      this.g.fillStyle = on ? 'rgba(34,232,255,0.14)' : 'rgba(255,255,255,0.02)'; this.g.fill();
      this.g.strokeStyle = on ? COL.cyan : FAINT; this.g.lineWidth = 2; this.g.stroke();
      this.text('CHAPTER ' + (pg + 1), tx + 125, 958, 22, on ? COL.cyan : DIM, 'center', '600');
      this.hit(tx, 930, 250, 56, { type: 'boardPage', i: pg * per });
    }
    var cols = 5, cw = 300, ch = 300, gap = 30;
    var x0 = W / 2 - (cols * cw + (cols - 1) * gap) / 2;
    for (var i = page * per; i < Math.min(all.length, page * per + per); i++) {
      var lv = all[i], j = i - page * per, cx = x0 + (j % cols) * (cw + gap), cy = 200 + Math.floor(j / cols) * (ch + gap);
      var unlocked = game.isUnlocked(i), sel = i === game.boardSel, cleared = !!game.save.cleared[lv.id];
      var best = game.save.best[lv.id];
      var col = !unlocked ? FAINT : cleared ? GREEN : COL.cyan;
      this.roundRect(cx, cy, cw, ch, 14);
      this.g.fillStyle = sel ? 'rgba(34,232,255,0.1)' : '#03070d'; this.g.fill();
      if (sel) this.glow(col === FAINT ? DIM : col, 22);
      this.g.strokeStyle = sel ? (col === FAINT ? DIM : col) : col; this.g.lineWidth = sel ? 4 : 2; this.g.stroke(); this.noGlow();
      this.text(lv.code || (lv.chapter === 2 ? '2-' + ('0' + lv.num).slice(-2) : ('0' + (i + 1)).slice(-2)), cx + 24, cy + 40, 30, col === FAINT ? DIM : col, 'left', '700');
      this.text(unlocked ? lv.name : 'LOCKED', cx + 24, cy + 90, 30, unlocked ? INK : DIM, 'left', '700');
      if (unlocked) {
        var words = lv.teaches.split(' '), lines = [''], k;
        for (k = 0; k < words.length; k++) {
          if ((lines[lines.length - 1] + ' ' + words[k]).length > 18) lines.push(words[k]);
          else lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + words[k]).trim();
        }
        for (k = 0; k < Math.min(3, lines.length); k++) this.text(lines[k], cx + 24, cy + 140 + k * 30, 20, DIM, 'left');
      }
      if (cleared) {
        var lean = best && best.size <= lv.parSize, fast = best && best.cycles <= lv.parCycles;
        this.text('✓ CLEAR', cx + 24, cy + 262, 20, GREEN, 'left', '700');
        this.text('LEAN', cx + 150, cy + 262, 20, lean ? COL.cyan : FAINT, 'left', '700');
        this.text('FAST', cx + 220, cy + 262, 20, fast ? COL.magenta : FAINT, 'left', '700');
      }
      if (unlocked && this.drawFreshCard) this.drawFreshCard(lv, cx, cy, cw, ch);
      this.hit(cx, cy, cw, ch, { type: 'level', i: i });
    }
    this.button('×', W - 170, 100, 60, 60, INK, { type: 'close' });
  };

  root.OvershiftDeck = Deck;
})(typeof self !== 'undefined' ? self : this);
