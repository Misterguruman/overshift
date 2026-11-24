/*
 * Overshift Dispatch, top screen: a night map of the city with the depot, its roads and
 * districts, trucks driving their routes, and a side panel with the order board, depot stock
 * and each truck. Also the Ledger's Dispatch tab. Extends OvershiftDeck.
 */
(function (root) {
  'use strict';
  var Deck = root.OvershiftDeck, D = root.OvershiftDispatch, LG = root.OvershiftLedger;
  if (!Deck || !D) return;
  var P = Deck.prototype;
  var W = 1920;
  var COL = { cyan: '#22e8ff', magenta: '#ff3df0', amber: '#ffb31f', lime: '#a6ff3a' };
  var COLORS = ['cyan', 'magenta', 'amber', 'lime'];
  var INK = '#d7f6ff', DIM = '#5b7590', FAINT = '#1b2a3d', RED = '#ff3b5c', GREEN = '#5dffa8', VIOLET = '#9b7bff';
  var TRUCK_COL = ['#22e8ff', '#ffb31f', '#a6ff3a', '#ff3df0', '#9b7bff', '#5dffa8'];
  var ROAD_ANGLES = [-0.22, 0.6, -0.95, 1.15];
  var AREA = { x: 40, y: 138, w: 1330, h: 850 };

  /** Screen positions of the depot and every district (roads fan out east from the depot). */
  P.cityGeom = function (lv, area) {
    area = area || AREA;
    var depot = { x: area.x + area.w * 0.16, y: area.y + area.h * 0.5 };
    // drawn distance grows slower than the road's length, so near districts don't bunch up at the depot
    function f(d) { return Math.pow(d, 0.7); }
    var scale = 110;
    lv.districts.forEach(function (d) {
      var a = ROAD_ANGLES[d.road % ROAD_ANGLES.length], r = f(d.dist);
      scale = Math.min(scale, area.w * 0.78 / (Math.cos(a) * r), area.h * 0.42 / Math.max(0.05, Math.abs(Math.sin(a)) * r));
    });
    var pos = { depot: depot };
    lv.districts.forEach(function (d) {
      var a = ROAD_ANGLES[d.road % ROAD_ANGLES.length], r = f(d.dist) * scale;
      pos[d.id] = { x: depot.x + Math.cos(a) * r, y: depot.y + Math.sin(a) * r };
    });
    var roads = {};
    lv.districts.forEach(function (d) { if (!roads[d.road] || roads[d.road].dist < d.dist) roads[d.road] = d; });
    return { pos: pos, depot: depot, scale: scale, roads: roads };
  };

  P.drawTruckScene = function (dt) {
    var game = this.game, lv = game.level, sim = game.sim;
    var geo = this.cityGeom(lv);
    this.drawCityMap(lv, sim, geo, game);
    this.drawTrucks(lv, sim, geo, dt, game);
    this.drawTruckPanel(lv, game);
    this.drawTruckStatus(game);
  };

  // ---------- the map ----------
  P.drawCityMap = function (lv, sim, geo, game) {
    var g = this.g, pos = geo.pos, dep = geo.depot;
    // roads
    Object.keys(geo.roads).forEach(function (r) {
      var far = pos[geo.roads[r].id];
      g.strokeStyle = '#0e2236'; g.lineWidth = 34; g.lineCap = 'round';
      g.beginPath(); g.moveTo(dep.x, dep.y); g.lineTo(far.x, far.y); g.stroke();
      g.strokeStyle = '#1f6b86'; g.lineWidth = 2; g.setLineDash([18, 16]);
      g.beginPath(); g.moveTo(dep.x, dep.y); g.lineTo(far.x, far.y); g.stroke();
      g.setLineDash([]); g.lineCap = 'butt';
    });
    // road ticks along each road: one mark per tick of driving
    var self = this;
    lv.districts.forEach(function (d) {
      var p = pos[d.id];
      for (var k = 1; k < d.dist; k++) {
        var u = Math.pow(k / d.dist, 0.7), x = dep.x + (p.x - dep.x) * u, y = dep.y + (p.y - dep.y) * u;
        g.fillStyle = '#163248'; g.fillRect(x - 3, y - 3, 6, 6);
      }
    });
    // depot
    this.roundRect(dep.x - 74, dep.y - 52, 148, 104, 12);
    g.fillStyle = '#071019'; g.fill();
    this.glow(COL.cyan, 14); g.strokeStyle = COL.cyan; g.lineWidth = 3; g.stroke(); this.noGlow();
    this.text('DEPOT', dep.x, dep.y - 20, 22, COL.cyan, 'center', '700');
    this.text(sim.board.length + ' on board', dep.x, dep.y + 16, 18, DIM, 'center', '500');
    // districts with what is still owed there and what was delivered
    lv.districts.forEach(function (d) {
      var p = pos[d.id], owed = 0, done = 0, late = 0;
      sim.orders.forEach(function (o) {
        if (o.d !== d.id) return;
        if (o.st === 'done') { done++; if (o.late) late++; } else owed++;
      });
      var lit = sim.event && sim.event.type === 'drive' && sim.event.to === d.id;
      self.g.beginPath(); self.g.arc(p.x, p.y, 54, 0, 6.29);
      self.g.fillStyle = '#071019'; self.g.fill();
      if (lit) self.glow(GREEN, 22 * (0.4 + self.pulse));
      self.g.strokeStyle = lit ? GREEN : owed ? INK : GREEN; self.g.lineWidth = 3; self.g.stroke(); self.noGlow();
      self.text(d.name.toUpperCase(), p.x, p.y - 8, 21, INK, 'center', '700');
      self.text(d.dist + ' ticks', p.x, p.y + 20, 16, DIM, 'center', '500');
      var badge = owed ? owed + ' owed' : '✓ ' + done;
      self.text(badge, p.x, p.y + 76, 20, owed ? COL.amber : GREEN, 'center', '700');
      if (late) self.text(late + ' late', p.x, p.y + 100, 18, RED, 'center', '600');
    });
  };

  // ---------- trucks ----------
  P.truckTarget = function (lv, geo, name) { return geo.pos[name] || geo.depot; };

  P.drawTrucks = function (lv, sim, geo, dt, game) {
    var self = this, g = this.g;
    if (!this.truckAnim || this.truckAnim.lv !== lv.id || this.truckAnim.n !== sim.trucks.length) this.truckAnim = { lv: lv.id, n: sim.trucks.length, t: [] };
    var A = this.truckAnim;
    var jump = sim === game.history[0] || game.mode === 'fast';
    sim.trucks.forEach(function (t, k) {
      var a = A.t[k];
      var target = self.truckTarget(lv, geo, t.pos);
      if (!a || jump) { a = A.t[k] = { x: target.x, y: target.y, at: t.pos, path: [] }; }
      if (a.at !== t.pos) {
        // across roads a truck goes back through the depot
        var pa = lv.byDistrict[a.at], pb = lv.byDistrict[t.pos];
        a.path = pa && pb && pa.road !== pb.road ? [geo.depot, target] : [target];
        a.at = t.pos;
      }
      var speed = 1400 * dt;
      while (a.path.length && speed > 0) {
        var w = a.path[0], dx = w.x - a.x, dy = w.y - a.y, dd = Math.sqrt(dx * dx + dy * dy);
        if (dd <= speed) { a.x = w.x; a.y = w.y; speed -= dd; a.path.shift(); }
        else { a.x += dx / dd * speed; a.y += dy / dd * speed; speed = 0; }
      }
      // trucks at the same place sit side by side
      var off = (k - (sim.trucks.length - 1) / 2) * 44;
      // a truck sits above the spot it is at, like a map pin, so it never hides a district's name
      var x = a.x + off, y = a.y - 92;
      var col = TRUCK_COL[k % TRUCK_COL.length], active = lv.shared ? sim.lineTruck === k : game.active === k;
      g.strokeStyle = col; g.globalAlpha = 0.6; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, y + 22); g.lineTo(a.x, a.y - 56); g.stroke(); g.globalAlpha = 1;
      self.roundRect(x - 34, y - 22, 68, 44, 8);
      g.fillStyle = '#04080f'; g.fill();
      if (active) self.glow(col, 16);
      g.strokeStyle = col; g.lineWidth = active ? 4 : 2; g.stroke(); self.noGlow();
      self.text(String(k + 1), x - 18, y, 22, col, 'center', '700');
      // the load as a little bar of colour
      var cells = 0;
      t.load.forEach(function (oi) { var o = sim.orders[oi]; g.fillStyle = COL[o.c]; g.fillRect(x - 4 + cells * 3, y - 12, Math.max(2, o.n * 3 - 1), 24); cells += o.n; });
      if (t.state === 'parked') self.text('P', x + 22, y, 18, DIM, 'center', '700');
      self.hit(x - 34, y - 22, 68, 44, { type: 'truck', i: lv.shared ? 0 : k });
    });
  };

  // ---------- side panel ----------
  P.drawTruckPanel = function (lv, game) {
    var g = this.g, sim = game.sim, x0 = 1400, w = 490, y = 150, self = this;
    // which truck is being edited
    var n = game.routes.length;
    var label = lv.shared ? 'ROUTE · ' + sim.trucks.length + (sim.trucks.length > 1 ? ' TRUCKS' : ' TRUCK') + ' · ' + sim.cap + ' CELLS' : 'TRUCK ' + (game.active + 1) + (n > 1 ? ' OF ' + n : '') + ' · ' + sim.cap + ' CELLS';
    this.roundRect(x0, y, w, 56, 10);
    g.fillStyle = 'rgba(34,232,255,0.1)'; g.fill();
    g.strokeStyle = COL.cyan; g.lineWidth = 2; g.stroke();
    this.text(label, x0 + 20, y + 28, 22, COL.cyan, 'left', '700');
    if (n > 1) this.text('L1+◀▶', x0 + w - 18, y + 28, 18, DIM, 'right', '500');
    if (n > 1) this.hit(x0, y, w, 56, { type: 'truck', i: game.active + 1 });
    y += 76;

    // trucks
    sim.trucks.forEach(function (t, k) {
      if (k > 5) return;
      var col = TRUCK_COL[k % TRUCK_COL.length];
      var where = t.state === 'parked' ? 'parked' : (t.pos === 'depot' ? 'depot' : D.placeName(t.pos));
      var hand = t.hand >= 0 ? sim.orders[t.hand] : null;
      self.text((k + 1) + '  ' + where, x0, y + 8, 20, col, 'left', '700');
      self.text(t.cells + '/' + sim.cap + ' · t' + t.t, x0 + w, y + 8, 18, DIM, 'right', '500');
      if (hand && hand.st !== 'loaded') self.text('hand: ' + D.placeName(hand.d) + ' ' + hand.c + ' ×' + hand.n, x0 + 30, y + 34, 17, INK, 'left', '500');
      y += hand && hand.st !== 'loaded' ? 56 : 34;
    });
    if (sim.trucks.length > 6) { this.text('+' + (sim.trucks.length - 6) + ' more trucks', x0, y + 6, 18, DIM, 'left'); y += 30; }
    y += 10;

    // stock
    this.text('STOCK', x0, y + 8, 20, COL.cyan, 'left', '700');
    var sx = x0 + 100;
    COLORS.forEach(function (c) {
      var refill = (sim.refill || []).filter(function (f) { return f.c === c; })[0];
      if (!sim.stock[c] && !refill) return;
      self.cell({ c: c, q: '' }, sx, y + 8, 14, { noGlow: true });
      self.text(String(sim.stock[c]) + (refill ? '+' : ''), sx + 22, y + 8, 20, COL[c], 'left', '700');
      sx += 96;
    });
    y += 46;

    // the order board, head first
    this.text('ORDER BOARD', x0, y + 8, 20, COL.amber, 'left', '700');
    this.text(sim.board.length + ' left · now t' + sim.now, x0 + w, y + 8, 18, DIM, 'right', '500');
    y += 36;
    var maxRows = Math.max(3, Math.floor((960 - y) / 34));
    var rows = sim.board.slice(0, maxRows);
    rows.forEach(function (oi, r) {
      var o = sim.orders[oi], left = o.due - sim.now;
      var col = left < 0 ? RED : left < 10 ? COL.amber : INK;
      self.cell({ c: o.c, q: o.n }, x0 + 16, y + 10, 15, { noGlow: true, alpha: r === 0 ? 1 : 0.8 });
      self.text(D.placeName(o.d), x0 + 44, y + 10, 20, r === 0 ? INK : '#a9c6d8', 'left', '600');
      self.text(lv.city ? 'due t' + o.due : 'due ' + o.due + (left >= 0 ? ' (' + left + ')' : ' late'), x0 + w, y + 10, 18, col, 'right', '500');
      y += 34;
    });
    if (sim.board.length > rows.length) this.text('+' + (sim.board.length - rows.length) + ' more', x0, y + 6, 18, DIM, 'left');
    if (!sim.board.length) this.text(sim.status === 'win' ? 'all delivered' : 'empty', x0, y + 6, 18, DIM, 'left');
  };

  P.drawTruckStatus = function (game) {
    var sim = game.sim, mode = game.mode, msg, col = DIM, lv = game.level;
    if (game.flashMsg && (game.flashMsg.kind === 'fault' || mode === 'edit' || mode === 'done')) {
      msg = game.flashMsg.msg; col = game.flashMsg.kind === 'fault' ? RED : game.flashMsg.kind === 'warn' ? COL.amber : game.flashMsg.kind === 'ok' ? GREEN : INK;
    } else if (mode === 'edit') msg = lv.brief;
    else if (mode === 'run') { msg = 'RUNNING  ▶  tick ' + sim.now; col = COL.cyan; }
    else if (mode === 'fast') { msg = 'FAST  ▶▶  tick ' + sim.now; col = COL.cyan; }
    else if (mode === 'pause') { msg = 'PAUSED  ·  step ' + sim.steps + '  ·  tick ' + sim.now; col = INK; }
    else if (sim.status === 'win') { msg = sim.msg; col = GREEN; }
    else { msg = sim.msg; col = RED; }
    if (msg.length > 110) msg = msg.slice(0, 109) + '…';
    this.text(msg, AREA.x + AREA.w / 2, 1014, 24, col, 'center', '600');
    var line;
    if (lv.city) line = 'SAMPLE HOUR ' + D.CITY_TICKS + ' ticks   ·   ON TIME ' + sim.onTime + '   LATE ' + sim.late + '   ·   CELLS ' + sim.cellsDelivered;
    else {
      var best = game.save.best[lv.id];
      line = 'SIZE ' + D.size(lv, game.routes) + ' par ' + lv.parSize + '   CYCLES par ' + lv.parCycles + '   DELIVERED ' + sim.delivered + ' / ' + sim.orders.length +
        (best ? '   BEST ' + best.size + ' / ' + best.cycles : '');
    }
    this.text(line, AREA.x + AREA.w / 2, 1054, 19, DIM, 'center', '500');
  };

  // ---------- the Ledger's Dispatch tab (top screen) ----------
  P.drawDispatchScene = function (game) {
    var g = this.g, L = game.save.ledger, sum = game.dispatchSummary(), self = this;
    this.drawLedgerHeader('DISPATCH', game, 'Trucks sell your bays’ cells to the city for a premium. One route program runs the whole fleet.');
    var area = { x: 40, y: 150, w: 1000, h: 760 };
    var geo = this.cityGeom(D.CITY, area);
    var fake = { stock: {}, board: [], orders: [], refill: [], event: null };
    COLORS.forEach(function (c) { fake.stock[c] = 0; });
    this.drawCityMap(D.CITY, fake, geo, game);
    // idle trucks circling their roads
    var fleet = sum.fleet, t = this.t;
    for (var k = 0; k < fleet; k++) {
      var d = D.CITY.districts[k % D.CITY.districts.length], p = geo.pos[d.id], dep = geo.depot;
      // moving trucks stay between the depot box and the district circle; parked ones wait above the depot
      var moving = sum.open && sum.ok, u = moving ? 0.45 + 0.3 * (0.5 - 0.5 * Math.cos(t * 0.6 + k * 1.7)) : 0;
      var x = dep.x + (p.x - dep.x) * u + (moving ? 0 : (k - (fleet - 1) / 2) * 60), y = dep.y + (p.y - dep.y) * u - (moving ? 0 : 92);
      var col = TRUCK_COL[k % TRUCK_COL.length];
      this.roundRect(x - 26, y - 16, 52, 32, 6);
      g.fillStyle = '#04080f'; g.fill(); g.strokeStyle = col; g.lineWidth = 2; g.stroke();
    }
    // the numbers
    var x0 = 1090, w = 790, y = 160;
    if (!sum.open) {
      this.text('Opens after you clear ' + sum.after + '.', x0, y + 30, 30, COL.amber, 'left', '700');
      this.text('Junction Floor’s last contract unlocks Dispatch:', x0, y + 80, 22, DIM, 'left');
      this.text('First Routes on the contract board, and city routes here.', x0, y + 112, 22, DIM, 'left');
    } else {
      var rateCol = sum.ok ? GREEN : sum.empty ? DIM : RED;
      this.text(sum.ok ? '+' + LG.fmt(sum.rate) + ' cr/h' : sum.empty ? 'No route yet' : 'Route faults', x0, y + 30, 44, rateCol, 'left', '700');
      var sub = sum.ok ? sum.onTime + ' orders on time, ' + sum.late + ' late, ' + sum.delivered + ' cells in a sample hour' : sum.empty ? 'Start / tap to write the route program.' : sum.msg;
      if (sub.length > 62) sub = sub.slice(0, 61) + '…';
      this.text(sub, x0, y + 82, 21, sum.ok ? INK : sum.empty ? DIM : RED, 'left', '500');
      y += 130;
      this.text('FLEET  ' + sum.fleet + (sum.fleet > 1 ? ' trucks' : ' truck') + '   ·   BED  ' + sum.bed + ' cells   ·   ROUTE  ' + sum.size + ' lines', x0, y, 22, COL.cyan, 'left', '600');
      y += 50;
      this.text('SUPPLY  ' + LG.fmt(sum.cellsPerHour) + ' cells/h from your bays', x0, y, 22, INK, 'left', '700');
      this.text('vs  TODAY’S DEMAND', x0 + w, y, 20, COL.amber, 'right', '600');
      y += 30;
      var tot = 0;
      COLORS.forEach(function (c) { tot += sum.supply[c] || 0; });
      COLORS.forEach(function (c, i) {
        var yy = y + i * 64, s = tot ? (sum.supply[c] || 0) / tot : 0, dm = sum.demand[c] || 0;
        self.cell({ c: c, q: '' }, x0 + 20, yy + 26, 16, { noGlow: true });
        g.fillStyle = '#0b1828'; g.fillRect(x0 + 50, yy + 8, w - 60, 16); g.fillRect(x0 + 50, yy + 30, w - 60, 16);
        g.fillStyle = COL[c]; g.fillRect(x0 + 50, yy + 8, (w - 60) * s, 16);
        g.globalAlpha = 0.45; g.fillRect(x0 + 50, yy + 30, (w - 60) * dm, 16); g.globalAlpha = 1;
        self.text(Math.round(s * 100) + '%', x0 + w - 4, yy + 16, 15, INK, 'right', '600');
        self.text(Math.round(dm * 100) + '%', x0 + w - 4, yy + 38, 15, DIM, 'right', '600');
      });
      y += 4 * 64 + 20;
      this.text('Top bar: what your bays make. Lower bar: what the city wants today.', x0, y, 18, DIM, 'left');
      this.text('Late deliveries pay half. Demand changes every day.', x0, y + 28, 18, DIM, 'left');
    }
    this.text('DISPATCH  ·  A / Start edit route  ·  Fleet and Truck bed in Upgrades  ·  L2/R2 tab  ·  L1/R1 page  ·  B board', W / 2, 1046, 22, DIM, 'center', '500');
    this.hit(0, 0, W, 1080, { type: 'noop' });
  };
})(typeof self !== 'undefined' ? self : this);
