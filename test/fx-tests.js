/*
 * Tests for the visual effects layer (web/js/fx.js): it must never change the game.
 *   node test/fx-tests.js          runs the checks
 *   node test/fx-tests.js --play   (internal) plays every contract and prints a digest of the save
 * The digest is taken once without fx.js and once with it loaded; they must match exactly.
 */
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const js = f => path.join(__dirname, '../web/js', f);

function boot(withFx) {
  globalThis.self = globalThis;
  globalThis.OvershiftCore = require(js('core.js'));
  globalThis.OvershiftFloor = require(js('floor.js'));
  globalThis.OvershiftDispatch = require(js('dispatch.js'));
  globalThis.OvershiftLedger = require(js('ledger.js'));
  require(js('game.js')); require(js('floorgame.js')); require(js('ledgergame.js')); require(js('dispatchgame.js'));
  if (withFx) require(js('fx.js'));
  return globalThis.OvershiftGame;
}
const clone = o => JSON.parse(JSON.stringify(o));

/** Clear every contract in order with its reference solution, through the host. */
function playAll(G, onClear) {
  const store = {};
  globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  let t = 1700000000000;
  const g = new G({ sfx: { play() {} }, skipBoard: true, now: () => t });
  for (let i = 0; i < G.LEVELS.length; i++) {
    const lv = G.LEVELS[i];
    g.selectLevel(i, true);
    if (lv.kind === 'floor') { g.floor = clone(lv.refFloor); g.active = globalThis.OvershiftFloor.placedSlots(g.floor)[0]; g.bindActive(); }
    else if (lv.kind === 'truck') { g.routes = lv.refPrograms.map(clone); g.active = 0; g.bindTruck(); }
    else g.program = clone(lv.referenceProgram);
    g.afterEdit();
    g.run(true);
    let guard = 0;
    while (g.mode !== 'done' && guard++ < 20000) { t += 60; g.tick(0.06); }
    if (onClear) onClear(g, lv);
    g.overlay = null;
  }
  t += 3 * 3600 * 1000; // three hours away
  g.ledgerSettle();
  return g;
}

if (process.argv.includes('--play')) {
  const G = boot(process.argv.includes('--fx'));
  const g = playAll(G);
  const s = clone(g.save);
  console.log(JSON.stringify({ cleared: s.cleared, best: s.best, runs: s.runs, ledger: s.ledger }));
  process.exit(0);
}

let pass = 0, fail = 0;
function ok(cond, name, extra) { if (cond) pass++; else { fail++; console.log('FAIL  ' + name + (extra ? '  -> ' + extra : '')); } }

// 1. the same play-through gives the same save with and without effects
const plain = execFileSync(process.execPath, [__filename, '--play']).toString();
const withFx = execFileSync(process.execPath, [__filename, '--play', '--fx']).toString();
ok(plain.length > 100 && plain === withFx, 'effects change nothing in the save (clears, bests, Ledger)', plain.length + ' vs ' + withFx.length);
ok(Object.keys(JSON.parse(plain).cleared).length === 28, 'the play-through clears all 28 contracts', Object.keys(JSON.parse(plain).cleared).length);

// 2. what a clear opened, for the Cleared panel and the board
const G = boot(true);
ok(typeof G.fxMotion === 'function', 'fx.js loads without a page (node)');
const seen = {};
const fresh = {};
const g = playAll(G, (gg, lv) => { seen[lv.id] = gg.fxClear && clone(gg.fxClear); fresh[lv.id] = Object.keys(gg.fxFresh || {}); });
ok(seen['clock-in'] && seen['clock-in'].first && seen['clock-in'].unlock && seen['clock-in'].unlock.code === '02', 'clearing contract 01 says 02 is unlocked', JSON.stringify(seen['clock-in']));
ok(seen['clock-in'].unlock.chapter === 0, 'opening 02 is not a new chapter');
ok(seen['double-time'].unlock && seen['double-time'].unlock.chapter === 2 && seen['double-time'].unlock.code === '2-01', 'clearing 10 opens chapter 2', JSON.stringify(seen['double-time'].unlock));
ok(seen['night-audit'].unlock && seen['night-audit'].unlock.chapter === 3 && /Fleet/.test(seen['night-audit'].extra || ''), 'clearing Night Audit opens chapter 3 and the truck upgrades', JSON.stringify(seen['night-audit']));
ok(seen['standing-orders'] && seen['standing-orders'].unlock === null, 'the last contract unlocks nothing');
ok(seen['clock-in'].lean && seen['clock-in'].fast, 'a reference clear earns both chips on the panel');
ok(fresh['clock-in'].join() === 'defects', 'the contract a clear opens is marked new on the board', fresh['clock-in'].join());
ok(fresh['defects'].join() === 'respray', 'opening it clears its NEW mark', fresh['defects'].join());
ok(Object.keys(g.fxFresh).length === 0, 'nothing is left marked new once every contract is opened');

// a second, better clear is a new best but not a first clear
g.selectLevel(0, true);
g.save.best['clock-in'] = { size: 99, cycles: 999 };
g.program = clone(G.LEVELS[0].referenceProgram); g.afterEdit(); g.run(true);
let guard = 0; while (g.mode !== 'done' && guard++ < 5000) g.tick(0.06);
ok(g.fxClear && !g.fxClear.first && g.fxClear.bestSize && g.fxClear.bestCycles && !g.fxClear.unlock, 'a better replay shows NEW BEST and no unlock', JSON.stringify(g.fxClear));

// 3. events are queued for the deck, capped
ok(Array.isArray(g.fxEvents) && g.fxEvents.length <= 16 && g.fxEvents.length > 0, 'steps queue events for the deck, at most 16', g.fxEvents && g.fxEvents.length);

// 4. Ledger moments
g.fxEvents = [];
g.save.ledger.credits = 1e12;
const capBefore = G.prototype.ledgerRows ? globalThis.OvershiftLedger.bayCount(g.save.ledger) : 0;
g.buyUpgrade(0);
const up = g.fxEvents.find(e => e.k === 'upgrade');
ok(up && up.id === 'bays' && up.cap1 === capBefore + 1 && up.spent > 0, 'buying Bays queues an upgrade moment with the new bay', JSON.stringify(up));
g.fxEvents = [];
const L = g.save.ledger, lgRows = () => { g.ledgerTab = 0; return g.ledgerRows(); };
const outRow = lgRows().findIndex(r => r.bay < 0);
if (outRow >= 0) {
  if (L.bays.length >= globalThis.OvershiftLedger.bayCount(L)) g.ledgerToggle(lgRows().findIndex(r => r.bay >= 0));
  g.fxEvents = [];
  g.ledgerToggle(lgRows().findIndex(r => r.bay < 0));
  ok(g.fxEvents.some(e => e.k === 'bayIn'), 'putting a contract in a bay queues a bay moment', JSON.stringify(g.fxEvents));
} else ok(true, 'bay moment (skipped: every cleared contract already runs)');

delete globalThis.localStorage;
console.log(`fx tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
