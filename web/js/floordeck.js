/*
 * Overshift deck view for chapter 2 (Junction Floor): the tile floor on the top screen,
 * with the intake queue, dock tickets and the build cursor. Extends OvershiftDeck.
 */
(function (root) {
  'use strict';
  var D = root.OvershiftDeck, F = root.OvershiftFloor;
  if (!D || !F) return;
  var P = D.prototype;
  var COL = { cyan: '#22e8ff', magenta: '#ff3df0', amber: '#ffb31f', lime: '#a6ff3a' };
  var INK = '#d7f6ff', DIM = '#5b7590', FAINT = '#1b2a3d', RED = '#ff3b5c', GREEN = '#5dffa8', VIOLET = '#9b7bff';
  var NODE_COL = { splitter: COL.cyan, painter: COL.magenta, press: COL.amber, counter: COL.lime };
  var DX = F.DX, DY = F.DY;
  var AREA = { x: 40, y: 138, w: 1330, h: 850 };

  P.floorGeom = function (lv) {
    var ts = Math.min(150, Math.floor(Math.min(AREA.w / lv.W, AREA.h / lv.H)));
    return { ts: ts, x0: AREA.x + (AREA.w - ts * lv.W) / 2, y0: AREA.y + (AREA.h - ts * lv.H) / 2 };
  };

  P.drawFloorScene = function (dt) {
    var game = this.game, lv = game.level, sim = game.sim;
    var geo = this.floorGeom(lv);
    this.drawFloorGrid(lv, game, geo);
    this.drawFloorCell(lv, sim, geo, dt);
    this.drawFloorCursor(lv, game, geo);
    this.drawFloorPanel(lv, game);
    this.drawFloorStatus(game);
  };

  // ---------- tiles ----------
  P.arrowHead = function (cx, cy, d, size, col) {
    var g = this.g, ax = DX[d], ay = DY[d], px = -ay, py = ax;
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(cx + ax * size, cy + ay * size);
    g.lineTo(cx - ax * size * 0.6 + px * size * 0.8, cy - ay * size * 0.6 + py * size * 0.8);
    g.lineTo(cx - ax * size * 0.6 - px * size * 0.8, cy - ay * size * 0.6 - py * size * 0.8);
    g.closePath();
    g.fill();
  };

  P.drawBeltTile = function (x, y, ts, d, col, alpha, moving) {
    var g = this.g, m = ts * 0.14;
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = '#071019';
    g.fillRect(x + m, y + m, ts - 2 * m, ts - 2 * m);
    g.strokeStyle = col; g.lineWidth = 2;
    if (d === 0 || d === 2) { g.beginPath(); g.moveTo(x + m, y + m); g.lineTo(x + ts - m, y + m); g.moveTo(x + m, y + ts - m); g.lineTo(x + ts - m, y + ts - m); g.stroke(); }
    else { g.beginPath(); g.moveTo(x + m, y + m); g.lineTo(x + m, y + ts - m); g.moveTo(x + ts - m, y + m); g.lineTo(x + ts - m, y + ts - m); g.stroke(); }
    // chevrons that crawl in the belt's direction while the shift runs
    g.beginPath(); g.rect(x + m, y + m, ts - 2 * m, ts - 2 * m); g.clip();
    var off = moving ? (this.t * ts * 0.6) % (ts / 3) : 0, cx = x + ts / 2, cy = y + ts / 2;
    g.strokeStyle = col; g.lineWidth = Math.max(2, ts * 0.045);
    for (var k = -2; k <= 2; k++) {
      var s = k * ts / 3 + off, ax = DX[d], ay = DY[d], px = -ay, py = ax, h = ts * 0.13;
      var tx = cx + ax * (s + h * 0.6), ty = cy + ay * (s + h * 0.6);
      g.beginPath();
      g.moveTo(tx - ax * h + px * h, ty - ay * h + py * h);
      g.lineTo(tx, ty);
      g.lineTo(tx - ax * h - px * h, ty - ay * h - py * h);
      g.stroke();
    }
    g.restore();
  };

  P.drawNodeTile = function (x, y, ts, slot, info, d, state) {
    var g = this.g, col = NODE_COL[slot.t] || INK, m = ts * 0.08;
    this.roundRect(x + m, y + m, ts - 2 * m, ts - 2 * m, ts * 0.12);
    g.fillStyle = state.active ? 'rgba(255,255,255,0.08)' : '#060b13';
    g.fill();
    if (state.active || state.lit) this.glow(col, state.lit ? 26 : 16);
    g.strokeStyle = col; g.lineWidth = state.active ? 4 : 2.5;
    g.stroke();
    this.noGlow();
    // facing: a notch on the front edge and a dim tab on the back (the only way in)
    var cx = x + ts / 2, cy = y + ts / 2;
    this.arrowHead(cx + DX[d] * ts * 0.36, cy + DY[d] * ts * 0.36, d, ts * 0.09, col);
    g.fillStyle = 'rgba(215,246,255,0.35)';
    var bx = cx - DX[d] * ts * 0.4, by = cy - DY[d] * ts * 0.4;
    var bw = DX[d] ? ts * 0.05 : ts * 0.34, bh = DX[d] ? ts * 0.34 : ts * 0.05;
    g.fillRect(bx - bw / 2, by - bh / 2, bw, bh);
    this.text(slot.label, cx, cy - ts * 0.08, Math.round(ts * 0.2), col, 'center', '700');
    var sub = F.NODE_TYPES[slot.t].name.toUpperCase();
    if (slot.t === 'counter') sub = 'COUNT ' + info.mem;
    this.text(sub, cx, cy + ts * 0.17, Math.round(ts * 0.11), state.active ? INK : DIM, 'center', '600');
  };

  P.drawFloorGrid = function (lv, game, geo) {
    var g = this.g, ts = geo.ts, sim = game.sim, fl = game.floor;
    var running = game.mode !== 'edit', moving = game.mode === 'run' || game.mode === 'fast';
    g.fillStyle = 'rgba(2,5,10,0.92)';
    g.fillRect(geo.x0 - 14, geo.y0 - 14, ts * lv.W + 28, ts * lv.H + 28);
    g.strokeStyle = FAINT; g.lineWidth = 2;
    g.strokeRect(geo.x0 - 14, geo.y0 - 14, ts * lv.W + 28, ts * lv.H + 28);
    for (var y = 0; y < lv.H; y++) {
      for (var x = 0; x < lv.W; x++) {
        var px = geo.x0 + x * ts, py = geo.y0 + y * ts, cx = px + ts / 2, cy = py + ts / 2;
        var base = F.fixedTile(lv, x, y), t = fl.tiles[F.key(x, y)];
        // floor plate
        g.strokeStyle = '#0e1a28'; g.lineWidth = 1;
        g.strokeRect(px + 0.5, py + 0.5, ts - 1, ts - 1);
        if (base.k === 'wall') {
          g.fillStyle = '#0b1220'; g.fillRect(px + 2, py + 2, ts - 4, ts - 4);
          g.strokeStyle = '#1c2a3f'; g.lineWidth = 2;
          g.beginPath();
          for (var hx = -ts; hx < ts; hx += ts / 4) { g.moveTo(px + Math.max(0, hx), py + Math.max(0, -hx)); g.lineTo(px + Math.min(ts, hx + ts), py + Math.min(ts, ts - hx)); }
          g.stroke();
        } else if (base.k === 'intake') {
          this.roundRect(px + 6, py + 6, ts - 12, ts - 12, 10);
          g.fillStyle = 'rgba(34,232,255,0.08)'; g.fill();
          this.glow(COL.cyan, 12); g.strokeStyle = COL.cyan; g.lineWidth = 3; g.stroke(); this.noGlow();
          this.text('IN', cx, cy - ts * 0.12, Math.round(ts * 0.2), COL.cyan, 'center', '700');
          this.arrowHead(cx + DX[lv.intake.d] * ts * 0.3, cy + DY[lv.intake.d] * ts * 0.3 + ts * 0.08, lv.intake.d, ts * 0.08, COL.cyan);
        } else if (base.k === 'dock') {
          var filled = (sim.docks[base.dock] || []).length, want = game.fctx.orders[base.dock].length;
          var done = filled >= want && want > 0 && sim.status !== 'fault';
          this.roundRect(px + 6, py + 6, ts - 12, ts - 12, 10);
          g.fillStyle = done ? 'rgba(93,255,168,0.14)' : 'rgba(93,255,168,0.05)'; g.fill();
          this.glow(GREEN, done ? 18 : 8); g.strokeStyle = GREEN; g.lineWidth = 3; g.stroke(); this.noGlow();
          this.text(base.dock, cx, cy - ts * 0.08, Math.round(ts * 0.34), GREEN, 'center', '700');
          this.text(filled + '/' + want, cx, cy + ts * 0.24, Math.round(ts * 0.14), done ? GREEN : DIM, 'center', '600');
        } else if (base.k === 'recycler') {
          this.roundRect(px + 6, py + 6, ts - 12, ts - 12, 10);
          g.fillStyle = 'rgba(155,123,255,0.07)'; g.fill();
          g.strokeStyle = VIOLET; g.lineWidth = 3; g.stroke();
          this.text('RCY', cx, cy - ts * 0.08, Math.round(ts * 0.2), VIOLET, 'center', '700');
          this.text(String(sim.scrapped.length), cx, cy + ts * 0.22, Math.round(ts * 0.15), DIM, 'center', '600');
        } else if (base.k === 'belt' && !t) {
          this.drawBeltTile(px, py, ts, base.d, '#6b4f86', 0.75, moving);
        }
        if (!t) continue;
        if (t.k === 'belt') this.drawBeltTile(px, py, ts, t.d, COL.cyan, 0.9, moving);
        else if (t.k === 'bridge') {
          if (base.k === 'belt') this.drawBeltTile(px, py, ts, base.d, '#6b4f86', 0.45, moving);
          g.strokeStyle = VIOLET; g.lineWidth = 4;
          this.glow(VIOLET, 10);
          this.roundRect(px + ts * 0.18, py + ts * 0.18, ts * 0.64, ts * 0.64, ts * 0.1); g.stroke();
          this.noGlow();
          g.lineWidth = 3;
          g.beginPath();
          g.moveTo(cx, py + ts * 0.24); g.lineTo(cx, py + ts * 0.76);
          g.moveTo(px + ts * 0.24, cy); g.lineTo(px + ts * 0.76, cy);
          g.stroke();
          this.text('BRG', cx, py + ts * 0.88, Math.round(ts * 0.11), VIOLET, 'center', '700');
        } else if (t.k === 'node') {
          var slot = lv.slots[t.s];
          this.drawNodeTile(px, py, ts, slot, { mem: sim.mem[t.s] }, t.d, {
            active: game.fmode === 'program' && game.active === t.s,
            lit: running && sim.node && sim.node.s === t.s
          });
        }
      }
    }
    for (var yy = 0; yy < lv.H; yy++) for (var xx = 0; xx < lv.W; xx++) this.hit(geo.x0 + xx * ts, geo.y0 + yy * ts, ts, ts, { type: 'tile', x: xx, y: yy });
    if (sim.status === 'fault' && sim.faultAt) {
      var fx = geo.x0 + (sim.faultAt.x + 0.5) * ts, fy = geo.y0 + (sim.faultAt.y + 0.5) * ts;
      var a = 0.5 + 0.5 * Math.sin(this.t * 6);
      this.glow(RED, 20); g.strokeStyle = 'rgba(255,59,92,' + (0.5 + a * 0.5) + ')'; g.lineWidth = 5;
      g.beginPath(); g.arc(fx, fy, ts * 0.46, 0, 6.29); g.stroke(); this.noGlow();
    }
  };

  P.drawFloorCell = function (lv, sim, geo, dt) {
    var ts = geo.ts;
    if (!sim.cell) { this.fcell = null; return; }
    var tx = geo.x0 + (sim.x + 0.5) * ts, ty = geo.y0 + (sim.y + 0.5) * ts;
    if (!this.fcell || this.fcell.id !== sim.cell.id) this.fcell = { id: sim.cell.id, x: tx, y: ty };
    var k = Math.min(1, dt * (this.game.mode === 'fast' ? 40 : 11));
    this.fcell.x += (tx - this.fcell.x) * k;
    this.fcell.y += (ty - this.fcell.y) * k;
    this.cell(sim.cell, this.fcell.x, this.fcell.y, ts * 0.27);
  };

  P.drawFloorCursor = function (lv, game, geo) {
    if (game.fmode !== 'build' || game.overlay) return;
    var g = this.g, ts = geo.ts, x = geo.x0 + game.tc.x * ts, y = geo.y0 + game.tc.y * ts;
    var part = game.buildParts()[game.partIdx];
    var a = 0.55 + 0.45 * Math.sin(this.t * 5);
    var ok = F.buildable(lv, game.tc.x, game.tc.y);
    var col = part.k === 'remove' ? RED : ok ? INK : DIM;
    g.save();
    this.glow(col, 14);
    g.strokeStyle = col; g.globalAlpha = a; g.lineWidth = 4;
    g.setLineDash([ts * 0.12, ts * 0.08]);
    g.strokeRect(x + 3, y + 3, ts - 6, ts - 6);
    g.setLineDash([]);
    g.restore();
    this.noGlow();
    // facing arrow on the cursor for parts that have a direction
    if (part.k === 'belt' || part.k === 'node') {
      var cx = x + ts / 2, cy = y + ts / 2, d = game.facing;
      this.arrowHead(cx + DX[d] * ts * 0.56, cy + DY[d] * ts * 0.56, d, ts * 0.1, part.k === 'node' ? NODE_COL[part.t] : COL.cyan);
    }
  };

  // ---------- side panel ----------
  P.drawFloorPanel = function (lv, game) {
    var g = this.g, sim = game.sim, x0 = 1400, w = 490, y = 150;
    // mode badge
    var build = game.fmode === 'build';
    var label = build ? 'BUILD' : 'PROGRAM' + (game.active >= 0 ? ' · ' + lv.slots[game.active].label : '');
    var mcol = build ? COL.amber : COL.cyan;
    this.roundRect(x0, y, w, 56, 10);
    g.fillStyle = build ? 'rgba(255,179,31,0.1)' : 'rgba(34,232,255,0.1)'; g.fill();
    g.strokeStyle = mcol; g.lineWidth = 2; g.stroke();
    this.text(label, x0 + 20, y + 28, 26, mcol, 'left', '700');
    this.text('L3 ' + (build ? 'program' : 'build'), x0 + w - 18, y + 28, 20, DIM, 'right', '500');
    this.hit(x0, y, w, 56, { type: 'fmode', m: build ? 'program' : 'build' });
    y += 76;
    if (build) {
      var part = game.buildParts()[game.partIdx];
      var pl = part.label + (part.total !== undefined ? '  ' + part.left + ' of ' + part.total + ' left' : '');
      this.text('PART  ' + pl, x0, y + 8, 22, INK, 'left', '600');
      this.text('X+◀▶ part  ·  X turn  ·  A place', x0, y + 40, 18, DIM, 'left', '400');
      y += 72;
    } else y += 8;

    // intake queue
    this.text('INTAKE', x0, y + 10, 20, COL.cyan, 'left', '700');
    this.text(sim.intake.length + ' left', x0 + w, y + 10, 20, DIM, 'right', '500');
    var q = sim.intake.slice(0, 9);
    for (var i = 0; i < q.length; i++) this.cell(q[i], x0 + 26 + i * 52, y + 56, 22, { alpha: i === 0 ? 1 : 0.6, noGlow: i > 0 });
    if (!q.length) this.text('empty', x0, y + 56, 20, DIM, 'left');
    y += 100;

    // dock tickets
    var orders = game.fctx.orders, faulted = sim.status === 'fault';
    for (var di = 0; di < lv.docks.length; di++) {
      var d = lv.docks[di], ord = orders[d], got = sim.docks[d];
      this.text('DOCK ' + d, x0, y + 10, 20, GREEN, 'left', '700');
      this.text(got.length + ' / ' + ord.length, x0 + w, y + 10, 20, got.length >= ord.length && ord.length ? GREEN : DIM, 'right', '600');
      var per = 9, rows = Math.max(1, Math.ceil(ord.length / per));
      for (var k = 0; k < ord.length; k++) {
        var cx = x0 + 26 + (k % per) * 52, cy = y + 52 + Math.floor(k / per) * 50;
        var have = k < got.length, bad = faulted && have && k === got.length - 1 && sim.event && sim.event.type === 'fault';
        this.cell(have ? got[k] : ord[k], cx, cy, 20, { alpha: have ? 1 : 0.4, noGlow: !have });
        if (bad) { g.strokeStyle = RED; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, 26, 0, 6.29); g.stroke(); }
        if (have) {
          if (game.inspectIdx >= 0 && game.outputCells()[game.inspectIdx] && game.outputCells()[game.inspectIdx].id === got[k].id) {
            g.strokeStyle = VIOLET; g.lineWidth = 3; g.setLineDash([6, 4]); g.beginPath(); g.arc(cx, cy, 27, 0, 6.29); g.stroke(); g.setLineDash([]);
          }
          this.hit(cx - 25, cy - 25, 50, 50, { type: 'trace', id: got[k].id });
        }
      }
      if (!ord.length) this.text('nothing this stream', x0, y + 52, 18, DIM, 'left');
      y += 40 + rows * 50 + 14;
    }
    this.text('RECYCLER  ' + sim.scrapped.length, x0, y + 8, 20, VIOLET, 'left', '700');
  };

  P.drawFloorStatus = function (game) {
    var sim = game.sim, mode = game.mode, msg, col = DIM, lv = game.level;
    if (game.flashMsg && (game.flashMsg.kind === 'fault' || mode === 'edit' || mode === 'done')) {
      msg = game.flashMsg.msg; col = game.flashMsg.kind === 'fault' ? RED : game.flashMsg.kind === 'warn' ? COL.amber : INK;
    } else if (mode === 'edit') msg = lv.brief;
    else if (mode === 'run') { msg = 'RUNNING  ▶'; col = COL.cyan; }
    else if (mode === 'fast') { msg = 'FAST  ▶▶'; col = COL.cyan; }
    else if (mode === 'pause') { msg = 'PAUSED  ·  step ' + sim.steps; col = INK; }
    else if (sim.status === 'win') { msg = sim.msg; col = GREEN; }
    else { msg = sim.msg; col = RED; }
    if (msg.length > 110) msg = msg.slice(0, 109) + '…';
    this.text(msg, AREA.x + AREA.w / 2, 1014, 24, col, 'center', '600');
    var best = game.save.best[lv.id], size = F.floorSize(lv, game.floor), parts = F.countParts(game.floor).total;
    var line = 'SIZE ' + size + ' par ' + lv.parSize + '   PARTS ' + parts + ' par ' + lv.parParts + '   CYCLES par ' + lv.parCycles +
      (best ? '   BEST ' + best.size + ' / ' + best.parts + ' / ' + best.cycles : '');
    this.text(line, AREA.x + AREA.w / 2, 1054, 19, DIM, 'center', '500');
  };
})(typeof self !== 'undefined' ? self : this);
