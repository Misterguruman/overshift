/*
 * Headless tests for the tutorial and tips (web/js/tutor.js): `node test/tutor-tests.js`.
 * Plays the first-run tutorial with gamepad buttons, checks skip / replay / resume, that saves
 * with progress skip it, that each tip opens once at the right moment and blocks the controller
 * until closed, and that none of it changes a contract's score.
 */
'use strict';
globalThis.self = globalThis;
const path = require('path');
const js = f => path.join(__dirname, '../web/js', f);
const C = globalThis.OvershiftCore = require(js('core.js'));
globalThis.OvershiftFloor = require(js('floor.js'));
globalThis.OvershiftDispatch = require(js('dispatch.js'));
globalThis.OvershiftLedger = require(js('ledger.js'));
['game.js', 'floorgame.js', 'ledgergame.js', 'dispatchgame.js', 'tutor.js'].forEach(f => require(js(f)));
const Game = globalThis.OvershiftGame;
const LV = Game.LEVELS;

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) pass++;
  else { fail++; console.log('FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
const silent = { play() {} };
let store = {};
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
const fresh = (opts = {}) => new Game(Object.assign({ sfx: silent, tutorial: true, tips: true }, opts));
function press(g, b) { g.act({ type: 'btn', b, phase: 'down' }); g.act({ type: 'btn', b, phase: 'up' }); }
function runToEnd(g) { press(g, 'start'); let k = 0; while (g.mode !== 'done' && k++ < 400) g.tick(0.5); }
const idx = id => LV.findIndex(l => l.id === id);
const ops = g => g.program.map(l => l.op).join(',');

// ---------- data ----------
for (const t of Game.TIPS) {
  ok(t.at === 'ledger' || idx(t.at) >= 0, `tip ${t.id}: "${t.at}" is a contract or the Ledger`);
  for (const p of t.pages) {
    ok(p.title && p.body && p.pad && p.touch, `tip ${t.id}: every page has a title, body, gamepad and touch prompt`);
    ok((p.pad.match(/\[/g) || []).length === (p.pad.match(/\]/g) || []).length, `tip ${t.id}: button chips are closed`);
  }
}
ok(new Set(Game.TIPS.map(t => t.id)).size === Game.TIPS.length, 'tip ids are unique');

// ---------- the first-run tutorial, played with the gamepad ----------
store = {};
let g = fresh();
ok(g.save.tut.state === 'active' && g.save.tut.step === 'intro', 'a fresh save starts the tutorial', JSON.stringify(g.save.tut));
ok(g.level.id === 'clock-in' && g.overlay === null, 'the tutorial opens Clock In, not the contract board', g.overlay);
let vm = g.viewModel();
ok(vm.tip && vm.tip.kind === 'tut' && vm.tip.primary === 'Start' && vm.tip.secondary === 'Skip', 'the welcome card is on screen with Start and Skip');
ok(!vm.coach, 'no coach strip under the welcome card');
press(g, 'Y');
ok(g.save.tut.step === 'intro' && g.undoStack.length === 0, 'other buttons do nothing on the welcome card');
press(g, 'A');
ok(g.save.tut.step === 'grab' && g.program.length === 0, 'A starts the tutorial without adding a line', ops(g));
vm = g.viewModel();
ok(!vm.tip && vm.coach && vm.coach.step === 'grab' && vm.coach.target === 'pal:GRAB' && vm.coach.n === 1, 'step 1 asks for GRAB and points at its tile', JSON.stringify(vm.coach));
g.paletteIdx = 0; press(g, 'A');
ok(ops(g) === 'GRAB' && g.save.tut.step === 'ship', 'adding GRAB moves on to SHIP', g.save.tut.step);
press(g, 'right'); press(g, 'A');
ok(ops(g) === 'GRAB,SHIP' && g.save.tut.step === 'run', 'adding SHIP moves on to Run');
ok(g.viewModel().coach.target === 'run', 'the Run step points at the Run button');
press(g, 'start');
ok(g.mode === 'run' && g.save.tut.step === 'watch', 'Start runs and the coach watches', g.save.tut.step);
let k = 0; while (g.mode !== 'done' && k++ < 200) g.tick(0.5);
ok(g.sim.status === 'fault' && g.save.tut.step === 'more', 'one GRAB, SHIP ends short and the coach asks for more', g.save.tut.step);
ok(!g.tipCard, 'no tip card interrupts the tutorial on its fault');
for (let n = 0; n < 2; n++) { g.paletteIdx = 0; press(g, 'A'); press(g, 'right'); press(g, 'A'); }
ok(ops(g) === 'GRAB,SHIP,GRAB,SHIP,GRAB,SHIP' && g.save.tut.step === 'run' && g.viewModel().coach.text === 'Run it again.', 'three pairs: run it again', g.save.tut.step);
runToEnd(g);
ok(g.overlay === 'cleared' && g.save.tut.step === 'cleared', 'the clear shows the last coach step', g.save.tut.step);
vm = g.viewModel();
ok(vm.coach && vm.coach.step === 'cleared' && !vm.tip, 'the last step is a coach strip over the cleared panel, not a card');
ok(g.save.best['clock-in'].size === 6 && g.save.best['clock-in'].cycles === 11, 'the tutorial scores Clock In like any run', JSON.stringify(g.save.best['clock-in']));
press(g, 'A');
ok(g.level.id === 'defects' && g.save.tut.state === 'done', 'A opens the next contract and ends the tutorial', g.save.tut.state);
ok(g.save.tips['first-clear'] === 1 && !g.tipCard, 'the first-clear tip counts as seen after the tutorial');
ok(!g.viewModel().coach && !g.viewModel().tutorial, 'no coach after the tutorial');

// ---------- a tip on the first fault, and the controller while it is up ----------
g.program = C.parseProgram('SHIP'); g.cursor = 0; g.afterEdit();
runToEnd(g);
ok(g.tipCard && g.tipCard.id === 'fault', 'the first fault opens the fault tip', JSON.stringify(g.tipCard));
vm = g.viewModel();
ok(vm.tip.kind === 'tip' && vm.tip.title === 'A FAULT' && vm.tip.primary === 'Got it' && !vm.tip.secondary, 'one-page tip: Got it');
const before = ops(g);
press(g, 'B'); // closes the tip; its release must not reach the game
ok(!g.tipCard && ops(g) === before && g.mode === 'done', 'B closes the tip and does nothing else', ops(g) + ' ' + g.mode);
press(g, 'select'); g.program = C.parseProgram('SHIP'); g.afterEdit(); runToEnd(g);
ok(!g.tipCard, 'a tip shows once');
store.saved = localStorage.getItem('overshift.save.v1');
ok(JSON.parse(store.saved).tips.fault === 1, 'seen tips are saved');

// A held when a card opens: its release doesn't add a line
g = fresh({ unlockAll: true });
g.tipNext(); g.tipNext(); // past the welcome card... into the tutorial
g.endTutorial('skipped');
g.act({ type: 'level', i: idx('bulk-order') });
ok(g.tipCard && g.tipCard.id === 'loop', 'entering Bulk Order opens the LOOP tip');
ok(/6 lines/.test(g.viewModel().tip.body), 'the LOOP tip names this contract\'s line limit', g.viewModel().tip.body);
g.act({ type: 'btn', b: 'A', phase: 'down' });
ok(!g.tipCard, 'A down closes it');
g.act({ type: 'btn', b: 'A', phase: 'up' });
ok(g.program.length === 0 && !g.held.A, 'and the A release adds nothing', ops(g));
g.act({ type: 'btn', b: 'A', phase: 'down' }); g.act({ type: 'btn', b: 'A', phase: 'up' });
ok(g.program.length === 1, 'the next A adds a line as usual', ops(g));

// taps behind a card do nothing; the card's own buttons work
g.act({ type: 'level', i: idx('open-shift') });
ok(g.tipCard && g.tipCard.id === 'open-shift' && g.viewModel().tip.pages === 2, 'Open Shift has a two-page tip');
g.act({ type: 'palette', i: 0 });
ok(g.program.length === 0, 'a palette tap behind the card does nothing');
g.act({ type: 'tipNext' });
ok(g.tipCard && g.tipCard.page === 1 && /5 intake streams and 2/.test(g.viewModel().tip.body), 'Next shows page 2 about hidden streams', g.viewModel().tip.body);
g.act({ type: 'tipNext' });
ok(!g.tipCard, 'Got it closes it');

// ---------- skip, replay, resume ----------
store = {};
g = fresh();
press(g, 'B');
ok(g.save.tut.state === 'skipped' && g.overlay === 'board', 'B on the welcome card skips to the contract board');
press(g, 'B');
g.act({ type: 'level', i: 0 });
ok(!g.viewModel().coach && !g.tipCard, 'Clock In after skipping has no coach');
g.program = C.parseProgram('GRAB; SHIP; GRAB; SHIP; GRAB; SHIP'); g.cursor = 5; g.afterEdit();
g.overlay = 'board';
press(g, 'Y');
ok(g.save.tut.state === 'active' && g.save.tut.step === 'intro' && g.program.length === 0 && g.overlay === null, 'Y on the board replays the tutorial on an empty Clock In');
ok(g.save.tut.backup && g.save.tut.backup.length === 6, 'the replay keeps the old program to put back');
g.act({ type: 'tipNext' });
g.paletteIdx = 0; press(g, 'A');
ok(g.save.tut.step === 'ship', 'replay steps work');
// the app closes mid-tutorial and opens again
let g2 = fresh();
ok(g2.save.tut.state === 'active' && g2.save.tut.step === 'ship' && g2.level.id === 'clock-in' && ops(g2) === 'GRAB' && g2.overlay === null, 'reopening the app carries on the tutorial where it was', JSON.stringify(g2.save.tut));
g2.act({ type: 'tutSkip' });
ok(g2.save.tut.state === 'skipped' && ops(g2) === 'GRAB,SHIP,GRAB,SHIP,GRAB,SHIP', 'skipping a replay puts the old program back', ops(g2));
// picking another contract mid-tutorial ends it
store = {};
g = fresh(); g.tipNext();
g.overlay = 'board';
ok(!g.viewModel().coach, 'no coach over the contract board');
g.act({ type: 'level', i: 0 }); g.act({ type: 'btn', b: 'L3', phase: 'down' }); g.act({ type: 'btn', b: 'L3', phase: 'up' });
g.save.cleared['clock-in'] = true;
g.act({ type: 'level', i: 1 });
ok(g.save.tut.state === 'left', 'opening another contract leaves the tutorial', g.save.tut.state);

// ---------- saves that already have progress ----------
store = {};
store['overshift.save.v1'] = JSON.stringify({ current: 3, cleared: { 'clock-in': true, defects: true, respray: true, boost: true }, best: {}, programs: { 'clock-in': C.parseProgram(LV[0].reference) }, floors: {}, routes: {} });
g = fresh();
ok(g.save.tut.state === 'old' && !g.tutorActive(), 'a save with progress skips the tutorial');
ok(g.overlay === 'board' || g.overlay === 'report', 'and opens as before', g.overlay);
ok(g.save.tips.values === 1 && g.save.tips.fault === 1 && g.save.tips['first-clear'] === 1, 'tips for what it has reached are marked seen', JSON.stringify(g.save.tips));
ok(!g.save.tips.loop && !g.save.tips.floor && !g.save.tips.truck, 'tips for what is still ahead are not');
g.overlay = null; g.act({ type: 'level', i: idx('bulk-order') });
ok(g.tipCard && g.tipCard.id === 'loop', 'and show when it gets there');

// ---------- tips off ----------
store = {};
g = fresh(); press(g, 'B'); // skip
press(g, 'X');
ok(g.save.tipsOff === true, 'X on the board turns tips off');
g.unlockAll = true;
g.act({ type: 'level', i: idx('respray') });
ok(!g.tipCard && !g.save.tips.values, 'no tips while they are off');
g.act({ type: 'tipsToggle' });
g.act({ type: 'reset' });
ok(g.tipCard && g.tipCard.id === 'values', 'turning them on shows the tip that is due');
g.act({ type: 'tipsToggle' });
ok(!g.tipCard && g.save.tipsOff, '"Tips off" on a card closes it and turns tips off');

// ---------- chapter 2, chapter 3, the Ledger ----------
store = {};
g = fresh({ unlockAll: true }); g.tipClose();
g.act({ type: 'level', i: idx('two-docks') });
ok(g.tipCard && g.tipCard.id === 'floor' && g.viewModel().tip.title === 'JUNCTION FLOOR: BUILD', 'the first floor opens the Build page');
press(g, 'A');
ok(g.viewModel().tip.title === 'JUNCTION FLOOR: PROGRAM', 'A turns to the Program page');
press(g, 'A');
ok(!g.tipCard, 'and A again closes it');
for (const [id, tip] of [['respray-line', 'tool-node'], ['batch-split', 'counter'], ['tight-floor', 'bridge'], ['first-run', 'truck'], ['full-load', 'next'], ['short-stock', 'defer'], ['two-trucks', 'two-trucks']]) {
  g.act({ type: 'level', i: idx(id) });
  ok(g.tipCard && g.tipCard.id === tip, `${id} opens the ${tip} tip`, JSON.stringify(g.tipCard));
  g.act({ type: 'tipNext' }); if (g.tipCard) g.act({ type: 'tipNext' });
}
g.save.cleared['clock-in'] = true;
g.overlay = 'board';
g.act({ type: 'ledger' });
ok(g.overlay === 'ledger' && g.tipCard && g.tipCard.id === 'ledger', 'opening the Ledger opens its tip');
ok(g.viewModel().ledger && g.viewModel().tip, 'the Ledger and the card share the view');
press(g, 'right');
ok(g.ledgerTab === 0, 'the d-pad doesn\'t change Ledger tabs under the card');
press(g, 'A');
press(g, 'R2');
ok(g.tipCard && g.tipCard.id === 'upgrades', 'the Upgrades tab opens its tip', JSON.stringify(g.tipCard));
g.act({ type: 'tipClose' });
const credits = g.save.ledger.credits;
ok(!g.tipCard && g.save.ledger.credits === credits, 'closing it buys nothing');

// ---------- dev and test pages ----------
store = {};
g = new Game({ sfx: silent, unlockAll: true });
ok(g.save.tut.state === 'new' && g.overlay === 'board' && !g.tipsOn(), '?unlock=all opens the board with no tutorial and no tips');
g = new Game({ sfx: silent, skipBoard: true });
ok(!g.tutorActive() && !g.tipsOn(), 'skipBoard (the older tests) gets neither');

delete globalThis.localStorage;
console.log(`\n${pass} passed, ${fail} failed (tutorial and tips)`);
process.exit(fail ? 1 : 0);
