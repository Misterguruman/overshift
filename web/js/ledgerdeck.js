/*
 * Overshift Ledger, top screen: a cross-section of the tower at night with one lit window per
 * bay, credits and the earning rate along the top, and the Shift report after time away.
 * Extends OvershiftDeck; the lists and choices are on the bottom screen (editor.js).
 */
(function (root) {
  'use strict';
  var D = root.OvershiftDeck, LG = root.OvershiftLedger, G = root.OvershiftGame;
  if (!D || !LG || !G) return;
  var P = D.prototype;
  var W = 1920, H = 1080;
  var CYAN = '#22e8ff', MAGENTA = '#ff3df0', AMBER = '#ffb31f', INK = '#d7f6ff', DIM = '#5b7590', FAINT = '#1b2a3d', GREEN = '#5dffa8', VIOLET = '#9b7bff';
  var CELL_COLORS = ['cyan', 'magenta', 'amber', 'lime'];
  var MAX_BAYS = LG.BAYS_START + LG.UPGRADES[0].costs.length;

  function byId(id) { var all = G.LEVELS; for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i]; return null; }
  function code(lv) { return lv.kind === 'floor' ? '2-' + ('0' + lv.num).slice(-2) : ('0' + (lv.index + 1)).slice(-2); }
  function ease(t) { t = Math.max(0, Math.min(1, t)); return 1 - Math.pow(1 - t, 3); }

  /** The LEDGER tab before the chapter tabs on the contract board, and the credits beside them. */
  P.drawLedgerTab = function (game, x, y) {
    var g = this.g;
    this.roundRect(x, y, 250, 56, 10);
    g.fillStyle = 'rgba(255,179,31,0.06)'; g.fill();
    g.strokeStyle = AMBER; g.lineWidth = 2; g.stroke();
    this.text('LEDGER', x + 125, y + 28, 22, AMBER, 'center', '600');
    this.hit(x, y, 250, 56, { type: 'ledger' });
    var L = game.save.ledger;
    this.text('₵ ' + LG.fmt(L.credits) + '   ·   ' + LG.fmt(game.ledgerRate()) + ' cr/h', W - 140, y + 28, 24, AMBER, 'right', '600');
    return x + 270;
  };

  /** One line on the Contract Cleared panel: what the clear paid and what its bay earns. */
  P.clearedPayLine = function (info, cx, y) {
    var parts = [];
    if (info.pay.total > 0) parts.push('+' + LG.fmt(info.pay.total) + ' cr');
    if (info.bay >= 0) parts.push('bay ' + (info.bay + 1) + ' earns ' + LG.fmt(info.rate) + ' cr/h');
    else parts.push('earns ' + LG.fmt(info.runRate) + ' cr/h in a bay (bays full)');
    if (info.worse) parts.push('your earlier clear earns more');
    this.text(parts.join('   ·   '), cx, y, 24, AMBER, 'center', '600');
  };

  /** Bay windows: 4 across, 3 down. */
  P.bayRect = function (i) {
    var cols = 4, ww = 300, wh = 214, gx = 28, gy = 24;
    var x0 = W / 2 - (cols * ww + (cols - 1) * gx) / 2, y0 = 196;
    return { x: x0 + (i % cols) * (ww + gx), y: y0 + Math.floor(i / cols) * (wh + gy), w: ww, h: wh };
  };

  P.drawTower = function () {
    var g = this.g, a = this.bayRect(0), b = this.bayRect(MAX_BAYS - 1);
    var x = a.x - 40, y = a.y - 50, w = b.x + b.w - a.x + 80, h = b.y + b.h - a.y + 80;
    g.fillStyle = '#04070d';
    g.fillRect(x, y, w, h);
    g.strokeStyle = '#122238'; g.lineWidth = 3;
    g.strokeRect(x, y, w, h);
    // floor slabs
    g.strokeStyle = '#0d1a2b'; g.lineWidth = 6;
    for (var r = 1; r < 3; r++) { var yy = this.bayRect(r * 4).y - 12; g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w, yy); g.stroke(); }
    this.text('DECK 41  ·  NIGHT OPERATIONS', x + 20, y + 24, 18, DIM, 'left', '600');
  };

  P.drawBayWindow = function (i, id, cap, game, sel, extra) {
    var g = this.g, r = this.bayRect(i), t = this.t;
    var lv = id ? byId(id) : null;
    if (i >= cap) {
      // a bay you can still buy
      g.setLineDash([6, 8]); g.strokeStyle = FAINT; g.lineWidth = 2;
      g.strokeRect(r.x, r.y, r.w, r.h); g.setLineDash([]);
      if (i === cap) {
        var cost = LG.upgradeCost(game.save.ledger, 'bays');
        if (cost !== null) this.text('+ BAY  ' + LG.fmt(cost, true) + ' cr', r.x + r.w / 2, r.y + r.h / 2, 20, DIM, 'center', '600');
      }
      return;
    }
    var col = lv ? (lv.kind === 'floor' ? AMBER : CYAN) : DIM;
    var flick = lv ? 0.75 + 0.25 * Math.sin(t * 1.7 + i * 2.1) : 0.4;
    if (extra && extra.flicker) flick = Math.random() < 0.08 ? 0.35 : flick;
    this.roundRect(r.x, r.y, r.w, r.h, 10);
    g.fillStyle = lv ? 'rgba(34,232,255,' + (0.04 + 0.05 * flick) + ')' : '#03060b';
    if (lv && lv.kind === 'floor') g.fillStyle = 'rgba(255,179,31,' + (0.04 + 0.05 * flick) + ')';
    g.fill();
    if (lv) this.glow(col, 14 * flick);
    g.strokeStyle = sel ? INK : lv ? col : FAINT; g.lineWidth = sel ? 5 : 2.5;
    g.stroke();
    this.noGlow();
    this.text('BAY ' + (i + 1), r.x + 16, r.y + 22, 16, DIM, 'left', '600');
    if (!lv) { this.text('EMPTY', r.x + r.w / 2, r.y + r.h / 2, 24, DIM, 'center', '600'); return; }
    this.text(code(lv), r.x + r.w - 16, r.y + 22, 18, col, 'right', '700');
    var name = lv.name.length > 15 ? lv.name.slice(0, 14) + '…' : lv.name;
    this.text(name, r.x + 16, r.y + 60, 26, INK, 'left', '700');
    // a little belt with cells moving along it; faster lines move faster
    var rate = LG.lineRate(game.save, LG.index(G.LEVELS), id);
    var by = r.y + 122, speed = 18 + Math.min(90, rate / 4);
    g.strokeStyle = '#18324a'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(r.x + 14, by + 22); g.lineTo(r.x + r.w - 14, by + 22); g.stroke();
    var span = r.w - 40, step = 62, off = (t * speed) % step;
    g.save(); g.beginPath(); g.rect(r.x + 12, by - 24, r.w - 24, 50); g.clip();
    for (var k = -1; k < span / step + 1; k++) {
      var cx = r.x + 20 + k * step + off;
      var cc = CELL_COLORS[(k + i + 8) % 4];
      this.cell({ c: cc, q: (k * 3 + i + 9) % 10 }, cx, by, 16, { noGlow: true, alpha: 0.9 });
    }
    g.restore();
    var line = extra && extra.cr !== undefined ? '+' + LG.fmt(extra.cr) + ' cr' : LG.fmt(rate) + ' cr/h';
    this.text(line, r.x + 16, r.y + r.h - 28, 26, extra && extra.cr !== undefined ? GREEN : col, 'left', '700');
  };

  P.drawLedgerHeader = function (title, game, sub) {
    var g = this.g, L = game.save.ledger;
    g.fillStyle = 'rgba(0,0,0,0.85)'; g.fillRect(0, 0, W, 118);
    g.strokeStyle = FAINT; g.beginPath(); g.moveTo(0, 118); g.lineTo(W, 118); g.stroke();
    this.glow(AMBER, 14);
    this.text(title, 40, 44, 40, AMBER, 'left', '700');
    this.noGlow();
    this.text(sub, 40, 92, 22, DIM, 'left', '500');
    this.text('₵ ' + LG.fmt(L.credits), W - 40, 46, 44, INK, 'right', '700');
    this.text(LG.fmt(game.ledgerRate()) + ' cr/h   ·   ' + L.bays.length + '/' + LG.bayCount(L) + ' bays   ·   ' + LG.shiftHours(L) + 'h shift', W - 40, 94, 22, AMBER, 'right', '500');
  };

  P.drawLedgerScene = function (game) {
    var L = game.save.ledger, cap = LG.bayCount(L);
    if (game.overlay === 'report' && game.report) { this.drawShiftReport(game); return; }
    this.drawLedgerHeader('THE LEDGER', game, 'Cleared contracts earn in bays. Leaner and faster solutions earn more.');
    this.drawTower();
    var vmRows = game.ledgerRows(), sel = vmRows[game.ledgerSel];
    var selId = game.ledgerTab === 0 && sel ? sel.id : null;
    for (var i = 0; i < MAX_BAYS; i++) this.drawBayWindow(i, L.bays[i], cap, game, selId && L.bays[i] === selId);
    var hint = game.ledgerTab === 0
      ? 'BAYS  ·  ↑↓ pick  ·  A in / out of a bay  ·  Start open contract  ·  L2/R2 tab  ·  L1/R1 page  ·  B board'
      : 'UPGRADES  ·  ↑↓ pick  ·  hold A to buy  ·  L2/R2 tab  ·  L1/R1 page  ·  B board';
    if (!game.save.runs || !Object.keys(game.save.runs).length) hint = 'Clear a contract and it starts earning here.   ·   L1/R1 page  ·  B board';
    this.text(hint, W / 2, 1046, 22, DIM, 'center', '500');
    this.hit(0, 0, W, H, { type: 'noop' });
  };

  P.drawShiftReport = function (game) {
    var rep = game.report, L = game.save.ledger, k = ease(game.reportT / 2.4);
    var welcome = rep.kind === 'welcome';
    var sub = welcome
      ? 'Your cleared contracts were paid for their first clears and chips, and the best of them are now earning.'
      : 'Away ' + LG.fmtDuration(rep.elapsed) + (rep.capped ? '. One shift pays ' + rep.shift + 'h; buy Shift length to cover more.' : '. Every bay ran the whole time.');
    this.drawLedgerHeader(welcome ? 'THE LEDGER IS OPEN' : 'SHIFT REPORT', game, sub);
    this.drawTower();
    var cap = LG.bayCount(L);
    for (var i = 0; i < MAX_BAYS; i++) {
      var row = rep.rows[i];
      var extra = welcome ? { flicker: true } : { flicker: k < 1, cr: row ? row.cr * k : undefined };
      this.drawBayWindow(i, L.bays[i], cap, game, false, extra);
    }
    var g = this.g;
    this.roundRect(W / 2 - 430, 930, 860, 110, 16);
    g.fillStyle = 'rgba(0,0,0,0.88)'; g.fill();
    this.glow(GREEN, 18); g.strokeStyle = GREEN; g.lineWidth = 3; g.stroke(); this.noGlow();
    var total = welcome ? rep.total : rep.total * k;
    this.text((welcome ? 'PAID  +' : 'EARNED  +') + LG.fmt(total) + ' cr', W / 2 - 400, 985, 38, GREEN, 'left', '700');
    this.text('A  Continue', W / 2 + 400, 985, 28, INK, 'right', '600');
    this.hit(0, 0, W, H, { type: 'reportClose' });
  };
})(typeof self !== 'undefined' ? self : this);
