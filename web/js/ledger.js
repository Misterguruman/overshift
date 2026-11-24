/*
 * Overshift Ledger: the idle business layer (slice 1). Pure data and functions, no DOM, so the
 * node tests can check every rule. Every cleared contract can run in a bay, where it earns
 *
 *   credits per hour = Base x Speed x Lean x Tidy x Overclock
 *
 * Speed = par Cycles / your Cycles (0.5 to 2), Lean = par Size / your Size (0.5 to 1.5),
 * Tidy = par Parts / your Parts (floors only, 0.8 to 1.2), Overclock = 1 + 0.1 per level.
 * A solution at par earns exactly Base. Upgrades only change the idle economy: nothing here
 * ever touches a contract's kit, line caps, streams or pars.
 *
 * Save data (inside the game's one save):
 *   save.runs[id]  = { size, cycles, parts? }   the best-earning clear of that contract
 *   save.ledger    = { v, credits, lifetime, bays: [id], up: { bays, overclock, shift },
 *                     lastSeen: ms, paid: { id: { c, l, f } } }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OvershiftLedger = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HOUR = 3600 * 1000;
  var REPORT_AFTER = 5 * 60 * 1000;  // a gap longer than this shows the Shift report
  var BAYS_START = 3;
  var SHIFT_HOURS = [8, 10, 12, 16, 24];
  var DECK_BASE = [20, 25, 30, 35, 40, 50, 55, 60, 65, 70]; // Night Shift, by contract
  var FIRST_CLEAR_HOURS = 4, CHIP_HOURS = 2;

  var UPGRADES = [
    { id: 'bays', name: 'Bays', what: 'Runs one more cleared contract at once',
      costs: [300, 800, 2000, 5000, 12000, 30000, 75000, 180000, 400000] },
    { id: 'overclock', name: 'Overclock', what: '+10% income on every bay',
      costs: [500, 1500, 4500, 13000, 40000] },
    { id: 'shift', name: 'Shift length', what: 'Pays more of your time away',
      costs: [1000, 4000, 15000, 60000] }
  ];
  var UP_BY_ID = {};
  UPGRADES.forEach(function (u) { UP_BY_ID[u.id] = u; });

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

  /** Base credits per hour for a contract: Night Shift 20 to 70, Junction Floor 90 to 180. */
  function baseRate(lv) {
    if (lv.kind === 'floor') return 80 + 10 * (lv.num || 1);
    return DECK_BASE[lv.index] !== undefined ? DECK_BASE[lv.index] : 20 + 5 * lv.index;
  }

  /** The par numbers of a contract, as a run (what a bay assumes when nothing better is known). */
  function parRun(lv) {
    var r = { size: lv.parSize, cycles: lv.parCycles };
    if (lv.kind === 'floor') r.parts = lv.parParts;
    return r;
  }

  function factors(lv, run) {
    var f = {
      speed: run.cycles > 0 ? clamp(lv.parCycles / run.cycles, 0.5, 2) : 2,
      lean: run.size > 0 ? clamp(lv.parSize / run.size, 0.5, 1.5) : 1.5,
      tidy: 1
    };
    if (lv.kind === 'floor' && lv.parParts) f.tidy = run.parts > 0 ? clamp(lv.parParts / run.parts, 0.8, 1.2) : 1.2;
    f.mult = f.speed * f.lean * f.tidy;
    return f;
  }

  function overclock(L) { return 1 + 0.1 * (L.up.overclock || 0); }

  /** Credits per hour this run earns in a bay (Overclock level oc, default 0). */
  function rate(lv, run, oc) { return baseRate(lv) * factors(lv, run).mult * (1 + 0.1 * (oc || 0)); }

  function fresh(now) {
    return { v: 1, credits: 0, lifetime: 0, bays: [], up: { bays: 0, overclock: 0, shift: 0 }, lastSeen: now, paid: {} };
  }

  function index(levels) {
    var m = {};
    for (var i = 0; i < levels.length; i++) m[levels[i].id] = levels[i];
    return m;
  }

  function bayCount(L) { return BAYS_START + (L.up.bays || 0); }
  function shiftHours(L) { return SHIFT_HOURS[Math.min(L.up.shift || 0, SHIFT_HOURS.length - 1)]; }

  /** Rate of one contract in a bay right now (0 if it has no run). */
  function lineRate(save, byId, id) {
    var lv = byId[id], run = save.runs && save.runs[id];
    if (!lv || !run) return 0;
    return rate(lv, run, save.ledger.up.overclock);
  }

  function totalRate(save, byId) {
    var t = 0, b = save.ledger.bays;
    for (var i = 0; i < b.length; i++) t += lineRate(save, byId, b[i]);
    return t;
  }

  function add(L, cr) { L.credits += cr; L.lifetime += cr; }

  /** Put cleared contracts with no bay into free bays, best earners first. */
  function fillBays(save, byId) {
    var L = save.ledger, free = bayCount(L) - L.bays.length;
    if (free <= 0) return [];
    var cands = Object.keys(save.runs || {}).filter(function (id) { return byId[id] && L.bays.indexOf(id) < 0; });
    cands.sort(function (a, b) { return lineRate(save, byId, b) - lineRate(save, byId, a); });
    var added = cands.slice(0, free);
    L.bays = L.bays.concat(added);
    return added;
  }

  /** One-off pay for a clear: first clear 4 h of base, each Lean or Fast chip 2 h, each paid once. */
  function clearPay(save, lv, run) {
    var L = save.ledger, p = L.paid[lv.id] || (L.paid[lv.id] = {}), base = baseRate(lv), out = { total: 0, items: [] };
    function pay(key, hours, label) {
      if (p[key]) return;
      p[key] = 1;
      var cr = base * hours;
      out.total += cr;
      out.items.push({ label: label, cr: cr });
    }
    pay('c', FIRST_CLEAR_HOURS, 'First clear');
    if (run.size <= lv.parSize) pay('l', CHIP_HOURS, 'Lean chip');
    if (run.cycles <= lv.parCycles) pay('f', CHIP_HOURS, 'Fast chip');
    add(L, out.total);
    return out;
  }

  /**
   * Make sure a save has the Ledger. Older saves get it here without losing anything: each
   * cleared contract gets a run (its saved program re-scored by runFor(lv), or par if that no
   * longer clears), first clears and chips are paid once from the stored bests, and the bays
   * fill with the best earners. Time before the update earns nothing.
   */
  function migrate(save, levels, runFor, now) {
    save.runs = save.runs || {};
    if (save.ledger && save.ledger.v) {
      var L0 = save.ledger;
      L0.credits = num(L0.credits, 0); L0.lifetime = num(L0.lifetime, 0);
      L0.bays = Array.isArray(L0.bays) ? L0.bays : [];
      L0.up = L0.up || {}; L0.up.bays = L0.up.bays || 0; L0.up.overclock = L0.up.overclock || 0; L0.up.shift = L0.up.shift || 0;
      L0.paid = L0.paid || {};
      L0.lastSeen = num(L0.lastSeen, now);
      return false;
    }
    var byId = index(levels);
    save.ledger = fresh(now);
    var cleared = save.cleared || {}, best = save.best || {};
    for (var i = 0; i < levels.length; i++) {
      var lv = levels[i];
      if (!cleared[lv.id]) continue;
      if (!save.runs[lv.id]) {
        var run = null;
        try { run = runFor ? runFor(lv) : null; } catch (e) { run = null; }
        save.runs[lv.id] = run || parRun(lv);
      }
      // chips come from the stored bests, since those were earned even if the program changed since
      var b = best[lv.id] || {};
      clearPay(save, lv, { size: num(b.size, Infinity), cycles: num(b.cycles, Infinity) });
    }
    fillBays(save, byId);
    return true;
  }

  /**
   * A contract was just cleared with this run. Keeps the run if it earns more than the stored one,
   * pays the one-off clear and chip money, and puts the contract in a free bay.
   */
  function recordClear(save, levels, lv, run) {
    var byId = index(levels), L = save.ledger;
    var old = save.runs[lv.id];
    var r = { size: run.size, cycles: run.cycles };
    if (lv.kind === 'floor') r.parts = run.parts;
    var better = !old || factors(lv, r).mult > factors(lv, old).mult + 1e-9;
    if (better) save.runs[lv.id] = r;
    var pay = clearPay(save, lv, r);
    var slotted = L.bays.indexOf(lv.id) < 0 ? fillBays(save, byId).indexOf(lv.id) >= 0 : false;
    return {
      pay: pay,
      better: better,
      worse: !!old && factors(lv, r).mult < factors(lv, old).mult - 1e-9,
      rate: lineRate(save, byId, lv.id),
      runRate: rate(lv, r, L.up.overclock),
      bay: L.bays.indexOf(lv.id),
      slotted: slotted
    };
  }

  /**
   * Pay the bays for the time since lastSeen. A clock that moved backwards pays nothing and
   * resets; time away pays at most one shift. Returns what was paid, per bay.
   */
  function settle(save, levels, now) {
    var L = save.ledger, byId = index(levels);
    var elapsed = now - num(L.lastSeen, now);
    var out = { elapsed: elapsed, paidMs: 0, total: 0, bays: [], capped: false, backwards: false, away: false };
    L.lastSeen = now;
    if (elapsed < 0) { out.backwards = true; out.elapsed = 0; return out; }
    var cap = shiftHours(L) * HOUR;
    out.paidMs = Math.min(elapsed, cap);
    out.capped = elapsed > cap;
    out.away = elapsed > REPORT_AFTER;
    var hours = out.paidMs / HOUR;
    for (var i = 0; i < L.bays.length; i++) {
      var cr = lineRate(save, byId, L.bays[i]) * hours;
      out.bays.push({ id: L.bays[i], cr: cr });
      out.total += cr;
    }
    add(L, out.total);
    return out;
  }

  function upgradeLevel(L, id) { return L.up[id] || 0; }
  function upgradeCost(L, id) {
    var u = UP_BY_ID[id];
    if (!u) return null;
    var lvl = upgradeLevel(L, id);
    return lvl < u.costs.length ? u.costs[lvl] : null;
  }

  /** What an upgrade does now and after the next level, for the list. */
  function upgradeEffect(L, id) {
    var lvl = upgradeLevel(L, id), max = UP_BY_ID[id].costs.length;
    var next = lvl < max ? lvl + 1 : null;
    if (id === 'bays') return { now: BAYS_START + lvl + ' bays', next: next === null ? null : BAYS_START + next + ' bays' };
    if (id === 'overclock') return { now: '+' + lvl * 10 + '%', next: next === null ? null : '+' + next * 10 + '%' };
    return { now: SHIFT_HOURS[lvl] + 'h shift', next: next === null ? null : SHIFT_HOURS[next] + 'h shift' };
  }

  function buy(save, levels, id) {
    var L = save.ledger, cost = upgradeCost(L, id);
    if (cost === null) return { ok: false, msg: UP_BY_ID[id] ? UP_BY_ID[id].name + ' is at its top level.' : 'No such upgrade.' };
    if (L.credits + 1e-9 < cost) return { ok: false, msg: 'Needs ' + fmt(cost) + ' cr; you have ' + fmt(L.credits) + '.' };
    L.credits -= cost;
    L.up[id] = upgradeLevel(L, id) + 1;
    var filled = id === 'bays' ? fillBays(save, index(levels)) : [];
    return { ok: true, cost: cost, filled: filled };
  }

  /** Take a contract out of its bay, or put it in a free one. */
  function toggleBay(save, levels, id) {
    var L = save.ledger, i = L.bays.indexOf(id);
    if (i >= 0) { L.bays.splice(i, 1); return { ok: true, inBay: false }; }
    if (!save.runs[id]) return { ok: false, msg: 'Clear this contract first.' };
    if (L.bays.length >= bayCount(L)) return { ok: false, msg: 'All ' + bayCount(L) + ' bays are busy. Take a contract out first, or buy a bay.' };
    L.bays.push(id);
    return { ok: true, inBay: true };
  }

  /** 1234 -> "1,234"; 15300 -> "15.3k" with short=true. */
  function fmt(n, short) {
    n = Math.floor(n + 1e-9);
    if (short && n >= 10000) {
      if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
      return (n / 1000).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'k';
    }
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmtDuration(ms) {
    var m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d >= 2) return d + ' days';
    if (h >= 1) return h + 'h ' + ('0' + (m % 60)).slice(-2) + 'm';
    return Math.max(1, m) + 'm';
  }

  return {
    HOUR: HOUR,
    REPORT_AFTER: REPORT_AFTER,
    BAYS_START: BAYS_START,
    SHIFT_HOURS: SHIFT_HOURS,
    UPGRADES: UPGRADES,
    FIRST_CLEAR_HOURS: FIRST_CLEAR_HOURS,
    CHIP_HOURS: CHIP_HOURS,
    baseRate: baseRate,
    parRun: parRun,
    factors: factors,
    rate: rate,
    overclock: overclock,
    index: index,
    bayCount: bayCount,
    shiftHours: shiftHours,
    lineRate: lineRate,
    totalRate: totalRate,
    fillBays: fillBays,
    clearPay: clearPay,
    migrate: migrate,
    recordClear: recordClear,
    settle: settle,
    upgradeLevel: upgradeLevel,
    upgradeCost: upgradeCost,
    upgradeEffect: upgradeEffect,
    buy: buy,
    toggleBay: toggleBay,
    fmt: fmt,
    fmtDuration: fmtDuration
  };
});
