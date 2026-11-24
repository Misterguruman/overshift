/*
 * Overshift Ledger host logic. Extends OvershiftGame with the business layer's first slice:
 * bays where cleared contracts earn credits, pay for time away (the Shift report), and the
 * Bays, Overclock and Shift length upgrades. The rules live in ledger.js.
 *
 * Overlays: 'ledger' is the first page of the contract board (L1 / R1 flip pages);
 * 'report' is the Shift report shown after more than 5 minutes away.
 */
(function (root) {
  'use strict';
  var G = root.OvershiftGame, LG = root.OvershiftLedger, C = root.OvershiftCore, F = root.OvershiftFloor;
  if (!G || !LG) return;
  var P = G.prototype, LV = G.LEVELS, PER = G.PER_CHAPTER;
  var HOLD_TO_BUY = 0.5, SETTLE_EVERY = 1, PERSIST_EVERY = 15;
  var TABS = ['bays', 'upgrades'];

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function levelIndex(id) { for (var i = 0; i < LV.length; i++) if (LV[i].id === id) return i; return -1; }
  function code(lv) { return lv.kind === 'floor' ? '2-' + ('0' + lv.num).slice(-2) : ('0' + (lv.index + 1)).slice(-2); }

  /** Re-score a contract's saved program (or floor); null if it doesn't clear any more. */
  function runFor(lv, save) {
    if (lv.kind === 'floor') {
      if (!F || !save.floors || !save.floors[lv.id]) return null;
      var f = clone(save.floors[lv.id]);
      if (!f.tiles) f.tiles = {};
      if (!f.progs) f.progs = [];
      for (var i = 0; i < lv.slots.length; i++) if (!f.progs[i]) f.progs[i] = [];
      var fe = F.evaluate(lv, f);
      return fe.cleared ? { size: fe.size, cycles: fe.cycles, parts: fe.parts } : null;
    }
    var prog = save.programs && save.programs[lv.id];
    if (!prog || !prog.length) return null;
    var ev = C.evaluate(lv, prog);
    return ev.cleared ? { size: ev.size, cycles: ev.cycles } : null;
  }
  G.ledgerRunFor = runFor;

  // ---------- setup and time ----------
  P.initLedger = function () {
    this.ledgerTab = 0;
    this.ledgerSel = 0;
    this.ledgerAcc = 0;
    this.persistAcc = 0;
    this.buyHold = null;
    this.buyLock = false;
    this.report = null;
    this.reportT = 0;
    this.ledgerPaused = false;
    var save = this.save, hadLedger = !!(save.ledger && save.ledger.v);
    LG.migrate(save, LV, function (lv) { return runFor(lv, save); }, this.now());
    if (!hadLedger) {
      this.persist();
      // an existing save: say what the Ledger paid for work already done
      if (save.ledger.lifetime > 0) this.showWelcome();
      return;
    }
    this.ledgerSettle();
  };

  P.ledgerRate = function () { return LG.totalRate(this.save, LG.index(LV)); };

  /** Pay the bays up to now; a long gap shows the Shift report. */
  P.ledgerSettle = function () {
    var r = LG.settle(this.save, LV, this.now());
    if (r.backwards) { this.persist(); return r; }
    if (r.away) {
      this.persist();
      if (r.bays.length) this.showReport(r);
    }
    return r;
  };

  P.ledgerPause = function () {
    if (this.ledgerPaused) return;
    LG.settle(this.save, LV, this.now());
    this.ledgerPaused = true;
    this.buyHold = null;
    this.persist();
  };
  P.ledgerResume = function () {
    if (!this.ledgerPaused) return;
    this.ledgerPaused = false;
    this.ledgerAcc = 0;
    this.ledgerSettle();
    this.changed();
  };

  /** Called every frame from Game.tick. Returns true when the bottom screen needs a redraw. */
  P.ledgerTick = function (dt) {
    if (this.ledgerPaused) return false;
    var dirty = false, L = this.save.ledger;
    this.ledgerAcc += dt;
    this.persistAcc += dt;
    if (this.ledgerAcc >= SETTLE_EVERY) {
      this.ledgerAcc = 0;
      var before = Math.floor(L.credits), overlay = this.overlay;
      this.ledgerSettle();
      if (this.overlay !== overlay || (overlay === 'ledger' && Math.floor(L.credits) !== before)) dirty = true;
    }
    if (this.persistAcc >= PERSIST_EVERY) { this.persistAcc = 0; this.persist(); }
    if (this.buyHold) {
      var q = Math.floor(this.buyHold.t * 10);
      this.buyHold.t += dt;
      if (this.buyHold.t >= HOLD_TO_BUY) {
        var i = this.buyHold.i;
        this.buyHold = null;
        this.buyLock = true; // one purchase per hold
        this.buyUpgrade(i);
        dirty = true;
      } else if (Math.floor(this.buyHold.t * 10) !== q) dirty = true;
    }
    if (this.overlay === 'report') this.reportT += dt;
    return dirty;
  };

  // ---------- clears ----------
  P.ledgerOnClear = function (ev) {
    var out = LG.recordClear(this.save, LV, this.level, { size: ev.size, cycles: ev.cycles, parts: ev.parts });
    if (out.pay.total > 0) this.sfx.play('clear');
    return out;
  };

  // ---------- overlays ----------
  P.showReport = function (r) {
    var rows = r.bays.map(function (b) { var lv = LV[levelIndex(b.id)]; return { code: code(lv), name: lv.name, floor: lv.kind === 'floor', cr: b.cr }; });
    if (this.overlay === 'report' && this.report && this.report.kind === 'away') {
      // still on the report: add to it rather than stack another
      var rep = this.report;
      rep.total += r.total; rep.paidMs += r.paidMs; rep.elapsed += r.elapsed; rep.capped = rep.capped || r.capped;
      rows.forEach(function (x, k) { if (rep.rows[k] && rep.rows[k].code === x.code) rep.rows[k].cr += x.cr; });
      return;
    }
    this.reportReturn = this.overlay;
    this.overlay = 'report';
    this.reportT = 0;
    this.flashMsg = null;
    this.report = { kind: 'away', total: r.total, elapsed: r.elapsed, paidMs: r.paidMs, capped: r.capped, shift: LG.shiftHours(this.save.ledger), rows: rows };
  };

  P.showWelcome = function () {
    var save = this.save, L = save.ledger, byId = LG.index(LV);
    var rows = L.bays.map(function (id) { var lv = byId[id]; return { code: code(lv), name: lv.name, floor: lv.kind === 'floor', rate: LG.lineRate(save, byId, id) }; });
    this.reportReturn = this.overlay;
    this.overlay = 'report';
    this.reportT = 0;
    this.report = { kind: 'welcome', total: L.lifetime, rows: rows, rate: this.ledgerRate() };
  };

  P.closeReport = function () {
    var back = this.reportReturn;
    this.report = null;
    this.overlay = back === 'report' ? null : (back || null);
    this.sfx.play('select');
  };

  P.openLedger = function () {
    this.overlay = 'ledger';
    this.clampLedgerSel();
    this.sfx.play('select');
  };

  /** Board pages: the Ledger, then one page per chapter. L1 / R1 move between them. */
  P.flipBoardPage = function (dir) {
    var n = LV.length, chapters = Math.ceil(n / PER), total = 1 + chapters;
    var cur = this.overlay === 'ledger' ? 0 : 1 + Math.floor(this.boardSel / PER);
    var next = (cur + dir + total) % total;
    if (next === 0) { this.openLedger(); return; }
    this.overlay = 'board';
    this.boardSel = Math.min(n - 1, (next - 1) * PER + (this.boardSel % PER));
    this.sfx.play('tick');
  };

  // ---------- the lists ----------
  P.ledgerRows = function () {
    var save = this.save, L = save.ledger, byId = LG.index(LV);
    if (TABS[this.ledgerTab] === 'upgrades') {
      return LG.UPGRADES.map(function (u) {
        var eff = LG.upgradeEffect(L, u.id), cost = LG.upgradeCost(L, u.id);
        return { id: u.id, name: u.name, what: u.what, level: LG.upgradeLevel(L, u.id), max: u.costs.length, now: eff.now, next: eff.next, cost: cost, afford: cost !== null && L.credits + 1e-9 >= cost };
      });
    }
    var rows = [];
    for (var i = 0; i < LV.length; i++) {
      var lv = LV[i], run = save.runs[lv.id];
      if (!run) continue;
      var f = LG.factors(lv, run);
      rows.push({
        id: lv.id, code: code(lv), name: lv.name, floor: lv.kind === 'floor',
        rate: LG.rate(lv, run, L.up.overclock), base: LG.baseRate(lv),
        speed: f.speed, lean: f.lean, tidy: lv.kind === 'floor' ? f.tidy : null,
        bay: L.bays.indexOf(lv.id)
      });
    }
    return rows;
  };

  P.clampLedgerSel = function () {
    var n = this.ledgerRows().length;
    this.ledgerSel = n ? Math.max(0, Math.min(n - 1, this.ledgerSel)) : 0;
  };

  P.setLedgerTab = function (t) {
    t = (t + TABS.length) % TABS.length;
    if (t === this.ledgerTab) return;
    this.ledgerTab = t;
    this.ledgerSel = 0;
    this.buyHold = null;
    this.sfx.play('tick');
  };

  P.ledgerToggle = function (i) {
    var row = this.ledgerRows()[i === undefined ? this.ledgerSel : i];
    if (!row) return;
    var r = LG.toggleBay(this.save, LV, row.id);
    if (!r.ok) { this.flash(r.msg, 'warn'); this.sfx.play('deny'); return; }
    this.flash(row.name + (r.inBay ? ' is running in a bay.' : ' left its bay.'), 'info');
    this.sfx.play(r.inBay ? 'place' : 'delete');
    this.persist();
  };

  P.ledgerOpen = function (i) {
    var row = this.ledgerRows()[i === undefined ? this.ledgerSel : i];
    if (!row || TABS[this.ledgerTab] !== 'bays') return;
    this.selectLevel(levelIndex(row.id));
  };

  P.startHold = function (i) {
    if (this.buyLock) return;
    var row = this.ledgerRows()[i];
    if (!row) return;
    this.ledgerSel = i;
    if (row.cost === null) { this.flash(row.name + ' is at its top level.', 'info'); this.sfx.play('deny'); return; }
    if (!row.afford) { this.flash(row.name + ' needs ' + LG.fmt(row.cost) + ' cr; you have ' + LG.fmt(this.save.ledger.credits) + '.', 'warn'); this.sfx.play('deny'); return; }
    this.buyHold = { i: i, t: 0 };
  };
  P.endHold = function () { this.buyHold = null; this.buyLock = false; };

  P.buyUpgrade = function (i) {
    var row = LG.UPGRADES[i];
    if (!row) return;
    var r = LG.buy(this.save, LV, row.id);
    if (!r.ok) { this.flash(r.msg, 'warn'); this.sfx.play('deny'); return; }
    var eff = LG.upgradeEffect(this.save.ledger, row.id);
    this.flash('Bought ' + row.name + ': now ' + eff.now + '.' + (r.filled.length ? ' A cleared contract moved into the new bay.' : ''), 'ok');
    this.sfx.play('clear');
    this.persist();
  };

  // ---------- input ----------
  P.ledgerButton = function (b, phase) {
    var press = phase === 'down' || phase === 'repeat';
    if (this.overlay === 'report') {
      if (phase === 'down' && (b === 'A' || b === 'B' || b === 'start' || b === 'L3')) this.closeReport();
      return;
    }
    var tab = TABS[this.ledgerTab], n = this.ledgerRows().length;
    switch (b) {
      case 'up': case 'rsUp': case 'down': case 'rsDown':
        if (!press || !n) return;
        this.buyHold = null;
        this.ledgerSel = (this.ledgerSel + (b === 'up' || b === 'rsUp' ? -1 : 1) + n) % n;
        this.sfx.play('tick');
        return;
      case 'left': case 'L2': if (phase === 'down') this.setLedgerTab(this.ledgerTab - 1); return;
      case 'right': case 'R2': if (phase === 'down') this.setLedgerTab(this.ledgerTab + 1); return;
      case 'L1': case 'R1': if (phase === 'down') this.flipBoardPage(b === 'L1' ? -1 : 1); return;
      case 'A':
        if (tab === 'bays') { if (phase === 'down') this.ledgerToggle(); }
        else if (phase === 'down') this.startHold(this.ledgerSel);
        else if (phase === 'up') this.endHold();
        return;
      case 'start': if (phase === 'down') this.ledgerOpen(); return;
      case 'B': if (phase === 'down') { this.buyHold = null; this.overlay = 'board'; this.sfx.play('back'); } return;
      case 'L3': if (phase === 'down') { this.buyHold = null; this.overlay = null; } return;
    }
  };

  /** Touch and remote-editor actions; returns true when handled. */
  P.ledgerAct = function (a) {
    switch (a.type) {
      case 'ledger': if (this.overlay === 'ledger') this.overlay = null; else this.openLedger(); return true;
      case 'ltab': this.setLedgerTab(a.i); return true;
      case 'lrow': {
        var again = a.i === this.ledgerSel;
        this.ledgerSel = a.i; this.clampLedgerSel();
        if (again && TABS[this.ledgerTab] === 'bays') this.ledgerToggle(a.i);
        else this.sfx.play('tick');
        return true;
      }
      case 'lopen': this.ledgerOpen(); return true;
      case 'hold': if (a.on) this.startHold(a.i); else this.endHold(); return true;
      case 'reportClose': this.closeReport(); return true;
    }
    return false;
  };

  /** Plain data for the bottom screen while the Ledger or the Shift report is open. */
  P.ledgerViewModel = function () {
    var L = this.save.ledger;
    var vm = {
      tab: TABS[this.ledgerTab],
      sel: this.ledgerSel,
      credits: Math.floor(L.credits),
      rate: Math.round(this.ledgerRate()),
      bays: L.bays.length,
      bayCap: LG.bayCount(L),
      shift: LG.shiftHours(L),
      hold: this.buyHold ? { i: this.buyHold.i, p: Math.min(1, Math.round(this.buyHold.t / HOLD_TO_BUY * 10) / 10) } : null,
      rows: this.ledgerRows()
    };
    if (this.overlay === 'report' && this.report) vm.report = this.report;
    return vm;
  };

  G.LEDGER_TABS = TABS;
})(typeof self !== 'undefined' ? self : this);
