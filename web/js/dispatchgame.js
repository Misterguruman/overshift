/*
 * Overshift Dispatch host logic (chapter 3, First Routes, and the Ledger's city routes).
 * Extends OvershiftGame: each truck has its own program, edited with the same editor and
 * controls as a node; L1 + left / right (or the tabs) switch trucks. The rules live in dispatch.js.
 *
 * Save data: save.routes[contract id] = [program per truck]; save.routes['city-routes'] = [program].
 */
(function (root) {
  'use strict';
  var C = root.OvershiftCore, D = root.OvershiftDispatch, G = root.OvershiftGame, LG = root.OvershiftLedger;
  if (!D || !G) return;
  var P = G.prototype, LV = G.LEVELS;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function code(lv) { return lv.city ? 'R' : lv.code; }

  // ---------- setup ----------
  P.truckCount = function () { return this.level.shared ? 1 : this.level.trucks; };

  P.setupTruck = function () {
    var lv = this.level, saved = this.save.routes && this.save.routes[lv.id];
    var r = Array.isArray(saved) ? clone(saved) : [];
    for (var k = 0; k < this.truckCount(); k++) if (!Array.isArray(r[k])) r[k] = [];
    r.length = this.truckCount();
    this.routes = r;
    this.active = 0;
    this.bindTruck();
  };

  P.bindTruck = function (cursor) {
    this.program = this.routes[this.active];
    this.cursor = cursor === undefined ? this.program.length - 1 : Math.max(-1, Math.min(cursor, this.program.length - 1));
  };

  P.recompileTruck = function () {
    this.compiled = D.compileTruck(this.program, this.level);
    this.dctx = D.makeCtx(this.level, this.routes, this.streamIdx, this.cityOpts);
  };

  P.snapTruck = function () { return JSON.stringify({ r: this.routes, a: this.active, c: this.cursor }); };
  P.restoreTruck = function (s) {
    this.routes = s.r;
    this.active = Math.min(s.a, this.routes.length - 1);
    this.bindTruck(s.c);
  };

  P.saveTruck = function () {
    this.save.routes = this.save.routes || {};
    this.save.routes[this.level.id] = this.routes;
    if (this.level.city && this.dispatchRefresh) this.dispatchRefresh(true);
  };

  P.switchTruck = function (k) {
    var n = this.routes.length;
    if (n < 2) return;
    this.active = ((k % n) + n) % n;
    this.bindTruck();
    this.recompile();
    this.traceLine = -1;
    this.sfx.play('tick');
  };

  // ---------- running ----------
  P.checkTruck = function () {
    var errs = D.check(this.level, this.routes);
    if (errs.length) {
      var e = errs[0];
      if (e.truck !== this.active) { this.active = e.truck; this.bindTruck(); this.recompile(); }
      if (e.line >= 0) this.cursor = e.line;
      this.flash(e.msg, e.line >= 0 ? 'fault' : 'warn');
      this.sfx.play('deny');
      return false;
    }
    return true;
  };

  P.showTruckFault = function (st) {
    var k = this.level.shared ? 0 : st.lineTruck;
    if (k >= 0 && k < this.routes.length && k !== this.active) { this.active = k; this.bindTruck(); this.recompile(); }
    if (st.line >= 0) this.cursor = st.line;
  };

  /** Delivered orders, in delivery order: they are what R3 and the right stick inspect and trace. */
  P.truckOutputs = function () {
    var done = this.sim.orders.filter(function (o) { return o.st === 'done'; });
    done.sort(function (a, b) { return a.at - b.at; });
    return done;
  };

  P.traceTruckOrder = function (o) {
    this.sfx.play('tick');
    var k = this.level.shared ? 0 : o.truck;
    if (k >= 0 && k !== this.active) { this.active = k; this.bindTruck(); this.recompile(); }
    this.traceLine = o.line;
    if (o.line >= 0) this.cursor = o.line;
  };

  // ---------- the Ledger's city ----------
  /** What the Ledger feeds the city right now: supply from the bays, fleet, truck bed, today. */
  P.dispatchInputs = function () {
    var L = this.save.ledger, sup = LG.dispatchSupply(this.save, LG.index(LV));
    return { supply: sup.supply, spot: sup.spot, day: D.dayNumber(this.now()), fleet: LG.fleetSize(L), cap: LG.bedCap(L) };
  };

  P.cityRoute = function () {
    var r = this.save.routes && this.save.routes[D.CITY.id];
    return Array.isArray(r) && Array.isArray(r[0]) ? r[0] : [];
  };

  /**
   * Measure the city's sample hour again when anything it depends on changed (route, fleet,
   * truck bed, the bays' output, the day). The result is what the Ledger pays per hour.
   */
  P.dispatchRefresh = function (force) {
    var L = this.save && this.save.ledger;
    if (!L || !LG) return false;
    if (!LG.dispatchOpen(this.save)) { if (L.dispatch) L.dispatch = null; return false; }
    var inp = this.dispatchInputs(), prog = this.cityRoute();
    var sig = JSON.stringify([prog, inp.supply, inp.fleet, inp.cap, inp.day]);
    if (!force && L.dispatch && L.dispatch.sig === sig) return false;
    if (!prog.length) {
      L.dispatch = { ok: false, rate: 0, empty: true, sig: sig, day: inp.day, msg: 'No route program yet.' };
      return true;
    }
    var r = D.citySample(prog, inp);
    L.dispatch = { ok: r.ok, rate: r.rate, onTime: r.onTime, late: r.late, cells: r.cells, orders: r.orders, msg: r.msg, line: r.line === undefined ? -1 : r.line, sig: sig, day: inp.day };
    return true;
  };

  /** Open the city route in the editor; Run plays today's sample hour. */
  P.openCity = function () {
    if (!LG.dispatchOpen(this.save)) { this.flash('Dispatch opens after you clear ' + LG.DISPATCH_AFTER_NAME + '.', 'warn'); this.sfx.play('deny'); return; }
    this.level = D.CITY;
    this.cityOpts = D.cityOpts(this.dispatchInputs());
    this.paletteIdx = 0;
    this.setupTruck();
    this.undoStack = []; this.redoStack = [];
    this.streamIdx = 0;
    this.revealed = 1;
    this.result = null;
    this.overlay = null;
    this.flashMsg = null;
    this.recompile();
    this.reset();
    this.flash('One program for the whole fleet. Run plays a sample hour of today’s orders.', 'info');
    this.sfx.play('select');
  };

  P.finishCity = function () {
    var st = this.sim;
    this.dispatchRefresh(true);
    var d = this.save.ledger.dispatch, pay = d && d.ok ? d.rate : 0;
    this.persist();
    this.flash(st.msg + ' Route earns ' + LG.fmt(pay) + ' cr/h on top of the bays.', 'ok');
    this.sfx.play('clear');
  };

  P.backToLedger = function () {
    if (this.openLedger) { this.openLedger(); if (this.setLedgerTab) this.setLedgerTab(G.LEDGER_TABS.indexOf('dispatch')); }
    else this.overlay = 'board';
  };

  // ---------- input ----------
  /** Truck buttons. Returns true when the button was handled here. */
  P.truckButton = function (b, phase, press) {
    if ((b === 'left' || b === 'right') && this.held.L1) {
      if (press) { this.l1Used = true; this.switchTruck(this.active + (b === 'left' ? -1 : 1)); }
      return true;
    }
    if (b === 'L3' && this.level.city) {
      if (phase === 'down') this.backToLedger();
      return true;
    }
    return false;
  };

  P.truckAct = function (a) {
    switch (a.type) {
      case 'truck': this.switchTruck(a.i); return;
      case 'city': this.openCity(); return;
      case 'cityBack': this.backToLedger(); return;
    }
  };

  // ---------- view model ----------
  P.truckViewModel = function (vm) {
    var lv = this.level, sim = this.sim, running = this.mode !== 'edit', self = this;
    var simK = lv.shared ? sim.lineTruck : this.active;
    var t = simK >= 0 ? sim.trucks[simK] : null;
    var mine = lv.shared || sim.lineTruck === this.active;
    vm.line = running && mine ? sim.line : -1;
    vm.next = running && sim.status === 'run' && t && t.state === 'run' ? t.pc : -1;
    var hand = t && t.hand >= 0 ? sim.orders[t.hand] : null;
    vm.held = hand ? { c: hand.c, q: hand.n } : null;
    vm.level.code = code(lv);
    vm.truck = {
      city: !!lv.city,
      active: this.active,
      count: sim.trucks.length,
      cap: sim.cap,
      cells: t ? t.cells : 0,
      hand: hand ? { d: D.placeName(hand.d), c: hand.c, n: hand.n, due: hand.due, st: hand.st } : null,
      total: D.size(lv, this.routes),
      board: sim.board.length,
      tabs: this.routes.map(function (p, k) {
        return { label: lv.shared ? 'Route · ' + sim.trucks.length + (sim.trucks.length > 1 ? ' trucks' : ' truck') : 'Truck ' + (k + 1), size: C.programSize(p), lit: running && !lv.shared && sim.lineTruck === k };
      })
    };
    vm.size = C.programSize(this.program);
    if (lv.city) vm.level.parSize = 0;
    return vm;
  };

  // ---------- the Ledger's Dispatch tab ----------
  G.DISPATCH_TAB = true;
  P.dispatchSummary = function () {
    var save = this.save, L = save.ledger, open = LG.dispatchOpen(save);
    var out = { open: open, after: LG.DISPATCH_AFTER_NAME, fleet: LG.fleetSize(L), bed: LG.bedCap(L) };
    if (!open) return out;
    var inp = this.dispatchInputs(), dem = D.cityDemand(inp.day), d = L.dispatch || {};
    var cells = 0;
    Object.keys(inp.supply).forEach(function (c) { cells += inp.supply[c]; });
    out.supply = inp.supply;
    out.cellsPerHour = Math.round(cells);
    out.demand = dem.mix;
    out.rate = LG.dispatchRate(L);
    out.ok = !!d.ok;
    out.empty = !!d.empty || !this.cityRoute().length;
    out.msg = d.msg || '';
    out.line = d.line === undefined ? -1 : d.line;
    out.onTime = d.onTime || 0;
    out.late = d.late || 0;
    out.orders = d.orders || 0;
    out.delivered = d.cells || 0;
    out.size = C.programSize(this.cityRoute());
    out.districts = D.CITY.districts.map(function (x) { return x.name; });
    return out;
  };
})(typeof self !== 'undefined' ? self : this);
