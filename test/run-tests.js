/*
 * Headless tests for Overshift: run with `node test/run-tests.js` from the overshift folder.
 * Checks every contract's reference solution against all its streams, the win checks and
 * faults, compile errors, and drives the game host with simulated gamepad buttons.
 */
'use strict';
globalThis.self = globalThis;
const path = require('path');
const C = require(path.join(__dirname, '../web/js/core.js'));
globalThis.OvershiftCore = C;
const F = require(path.join(__dirname, '../web/js/floor.js'));
globalThis.OvershiftFloor = F;
const LG = require(path.join(__dirname, '../web/js/ledger.js'));
globalThis.OvershiftLedger = LG;
require(path.join(__dirname, '../web/js/game.js'));
require(path.join(__dirname, '../web/js/floorgame.js'));
require(path.join(__dirname, '../web/js/ledgergame.js'));
const Game = globalThis.OvershiftGame;

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}
const L = id => C.LEVELS.find(l => l.id === id);
const P = C.parseProgram;

// 1. every reference solution clears every stream, at par size
for (const lv of C.LEVELS) {
  const ev = C.evaluate(lv, lv.referenceProgram);
  ok(ev.cleared, `${lv.name}: reference clears all ${lv.streams.length} streams`, JSON.stringify(ev.results.map(r => r.msg)));
  ok(ev.size === lv.parSize, `${lv.name}: reference size ${ev.size} equals par ${lv.parSize}`);
  ok(lv.streams.length === 1 || lv.streams.length === 5, `${lv.name}: 1 fixed stream or 3 visible + 2 hidden`);
  for (let s = 0; s < lv.streams.length; s++) ok(C.orderFor(lv, s).length > 0, `${lv.name}: stream ${s + 1} has something to ship`);
  console.log(`  ${String(lv.index + 1).padStart(2)} ${lv.name.padEnd(13)} streams ${lv.streams.length}  size ${ev.size}  cycles ${ev.cycles}`);
}

// 2. win checks and faults
function run(id, src, stream = 0) { return C.runStream(L(id), P(src), stream); }
let r;
r = run('clock-in', 'GRAB; SHIP');
ok(r.status === 'fault' && /1 of 3/.test(r.msg), 'incomplete order fails at end of shift', r.msg);
r = run('defects', 'GRAB; SHIP');
ok(r.status === 'fault' && /Wrong cell/.test(r.msg) && r.line === 1, 'shipping a wrong cell faults on that line', r.msg);
r = run('clock-in', 'GRAB; GRAB');
ok(r.status === 'fault' && /full hands/.test(r.msg) && r.line === 1, 'GRAB with full hands faults');
r = run('clock-in', 'SHIP');
ok(r.status === 'fault' && /empty hands/.test(r.msg), 'SHIP with empty hands faults');
r = run('clock-in', 'GRAB; SHIP; GRAB; SHIP; GRAB; SHIP; GRAB; SHIP');
ok(r.status === 'win', 'GRAB on an empty intake ends the shift cleanly', r.msg);
r = run('respray', 'GRAB; PAINT cyan; SHIP');
ok(r.status === 'fault' && /order wants magenta/.test(r.msg), 'wrong color faults', r.msg);
r = run('flatline', 'LOOP forever; CHARGE; END');
ok(r.status === 'fault' && /empty hands/.test(r.msg), 'CHARGE with empty hands faults');
r = run('flatline', 'GRAB; LOOP forever; CHARGE; END');
ok(r.status === 'fault' && /overran/.test(r.msg), 'endless loop hits the step guard', r.msg);
r = run('flatline', 'LOOP charge; END');
ok(r.status === 'fault' && /held cell/.test(r.msg), 'LOOP charge needs a held cell');
r = run('sorting-gate', 'IF magenta; END');
ok(r.status === 'fault' && /held cell/.test(r.msg), 'IF needs a held cell');

// hard-coding one stream fails a hidden one
const ev7 = C.evaluate(L('open-shift'), P('LOOP ' + L('open-shift').streams[0].length + '; GRAB; PAINT lime; SHIP; END'));
ok(ev7.results[0].status === 'win' && !ev7.cleared, 'a program fit to stream 1 clears it but not every stream');
ok(ev7.firstFail > 0, 'evaluate reports the first failing stream', ev7.firstFail);

// line limit on Bulk Order
const unrolled = Array(12).fill('GRAB; PAINT cyan; SHIP').join('; ');
const ev5 = C.evaluate(L('bulk-order'), P(unrolled));
ok(ev5.results.every(x => x.status === 'win') && !ev5.cleared && !ev5.limitOk, 'Bulk Order: unrolled program fills the order but breaks the 6-line limit');

// loop count is read once (Double Time's trick), and LOOP 0 skips
const lvDT = L('double-time');
const ctx = C.makeCtx(lvDT, P('GRAB; LOOP charge; CHARGE; END'), 0);
let st = C.initState(lvDT, 0);
const firstCyan = lvDT.streams[0][0];
while (st.status === 'run' && st.pc < 4 && st.steps < 50) st = C.step(ctx, st);
ok(st.held && st.held.q === Math.min(9, firstCyan.q * 2), 'LOOP charge reads its count once', JSON.stringify(st.held));

// cycle costs: travel 1 per station passed + 1 per action
r = run('clock-in', 'GRAB; SHIP; GRAB; SHIP; GRAB; SHIP');
ok(r.cycles === 11, 'Clock In reference costs 11 cycles (1 + 2 + 2 + 2 + 2 + 2)', r.cycles);

// 3. compile errors
const cm = (src) => C.compile(P(src), L('double-time'));
ok(!cm('LOOP 2; GRAB').ok, 'missing END is an error');
ok(!cm('GRAB; END').ok, 'stray END is an error');
ok(!cm('LOOP 2; ELSE; END').ok, 'ELSE outside IF is an error');
ok(!cm('IF cyan; ELSE; ELSE; END').ok, 'double ELSE is an error');
ok(!C.compile(P('GRAB; PAINT cyan'), L('double-time')).ok, 'an instruction whose station is missing is an error');
ok(cm('LOOP forever; GRAB; IF cyan; LOOP charge; CHARGE; END; SHIP; ELSE; SCRAP; END; END').ok, 'nested blocks compile');

// 4. game host driven by buttons
const silent = { play() {} };
function press(g, b) { g.act({ type: 'btn', b, phase: 'down' }); g.act({ type: 'btn', b, phase: 'up' }); }
let g = new Game({ sfx: silent, skipBoard: true });
g.selectLevel(0, true);
ok(g.program.length === 0 && g.cursor === -1, 'level starts with an empty program');
for (let k = 0; k < 3; k++) {
  g.paletteIdx = 0; press(g, 'A');      // GRAB
  press(g, 'right'); press(g, 'A');      // SHIP (d-pad right picks the next operation)
}
ok(C.lineText(g.program[5]) === 'SHIP' && g.program.length === 6, 'buttons build the Clock In program', g.program.map(C.lineText).join(','));
press(g, 'start');
let guard = 0;
while (g.mode !== 'done' && guard++ < 200) g.tick(0.5);
ok(g.overlay === 'cleared' && g.result.cleared && g.save.cleared['clock-in'], 'running it clears the contract');
ok(g.result.size === 6 && g.result.cycles === 11, 'score panel numbers', JSON.stringify([g.result.size, g.result.cycles]));
ok(g.isUnlocked(1), 'clearing contract 1 opens contract 2');
press(g, 'A');
ok(g.level.id === 'defects', 'A on the cleared panel opens the next contract');

// editing: LOOP inserts its END, delete unwraps, undo restores, hold-A moves blocks
g = new Game({ sfx: silent, skipBoard: true, unlockAll: true });
g.unlockAll = true;
g.selectLevel(9, true);
g.program = []; g.cursor = -1; g.afterEdit();
g.insert('GRAB'); g.insert('LOOP');
ok(g.program.map(l => l.op).join() === 'GRAB,LOOP,END' && g.cursor === 1, 'inserting LOOP adds its END');
g.insert('CHARGE');
ok(g.program.map(l => l.op).join() === 'GRAB,LOOP,CHARGE,END', 'insert goes below the cursor, inside the block');
g.cursor = 1; g.deleteLine();
ok(g.program.map(l => l.op).join() === 'GRAB,CHARGE', 'deleting LOOP keeps its body', g.program.map(l => l.op).join());
press(g, 'Y');
ok(g.program.map(l => l.op).join() === 'GRAB,LOOP,CHARGE,END', 'undo restores the block');
g.act({ type: 'btn', b: 'L1', phase: 'down' }); press(g, 'Y'); g.act({ type: 'btn', b: 'L1', phase: 'up' });
ok(g.program.map(l => l.op).join() === 'GRAB,CHARGE', 'L1+Y redoes');
press(g, 'Y');
g.cursor = 1;
g.act({ type: 'btn', b: 'A', phase: 'down' }); g.act({ type: 'btn', b: 'up', phase: 'down' }); g.act({ type: 'btn', b: 'up', phase: 'up' }); g.act({ type: 'btn', b: 'A', phase: 'up' });
ok(g.program.map(l => l.op).join() === 'LOOP,CHARGE,END,GRAB' && g.cursor === 0, 'hold A + up moves the whole block (no insert)', g.program.map(l => l.op).join());
const before = g.program[0].arg;
press(g, 'R1');
ok(g.program[0].arg !== before, 'R1 cycles the value on the cursor line');
press(g, 'L1');
ok(g.program[0].arg === before, 'L1 cycles the value back');
const pal0 = g.paletteIdx, progBefore = JSON.stringify(g.program);
press(g, 'right');
ok(g.paletteIdx === (pal0 + 1) % g.level.palette.length && JSON.stringify(g.program) === progBefore, 'd-pad right picks the next operation and leaves the program alone');
press(g, 'left'); press(g, 'left');
ok(g.paletteIdx === (pal0 - 1 + g.level.palette.length) % g.level.palette.length, 'd-pad left picks the previous operation (wraps)');
g.paletteIdx = pal0;
// up / down jump a row in the two-column palette (Flatline: GRAB SHIP / SCRAP CHARGE / DRAIN LOOP / END)
{
  const h = new Game({ sfx: silent, skipBoard: true, unlockAll: true });
  h.unlockAll = true;
  h.selectLevel(7, true);
  h.program = []; h.cursor = -1; h.afterEdit(); h.paletteIdx = 0;
  const pal = () => h.curPalette()[h.paletteIdx];
  press(h, 'down'); const a1 = pal(); press(h, 'down'); const a2 = pal();
  ok(a1 === 'SCRAP' && a2 === 'DRAIN', 'd-pad down jumps a row: GRAB to SCRAP to DRAIN', a1 + ',' + a2);
  press(h, 'down'); const a3 = pal(); press(h, 'down'); const a4 = pal();
  ok(a3 === 'END' && a4 === 'GRAB', 'down wraps from the bottom row to the top', a3 + ',' + a4);
  h.paletteIdx = 1; press(h, 'up'); const a5 = pal();
  ok(a5 === 'LOOP', 'up from the top row wraps to the same column below, or the last tile', a5);
  ok(h.program.length === 0, 'picking with up / down never edits the program');
  h.insert('GRAB'); h.insert('SHIP'); h.insert('SCRAP');
  press(h, 'rsUp');
  ok(h.cursor === 1, 'right stick up moves the cursor a line');
  press(h, 'rsDown'); press(h, 'rsDown');
  ok(h.cursor === 2, 'right stick down moves the cursor and stops at the end');
  h.act({ type: 'btn', b: 'A', phase: 'down' }); press(h, 'rsUp'); h.act({ type: 'btn', b: 'A', phase: 'up' });
  ok(h.program.map(l => l.op).join() === 'GRAB,SCRAP,SHIP' && h.program.length === 3, 'hold A + right stick up moves the line without inserting');
}
g.cursor = 2; g.deleteLine();
ok(g.program.length === 4 && /END/.test(g.flashMsg.msg + 'END'), 'deleting a matched END is refused');

// step / step back
g.selectLevel(0, true);
g.program = P('GRAB; SHIP; GRAB; SHIP; GRAB; SHIP'); g.afterEdit();
press(g, 'R2'); press(g, 'R2');
ok(g.sim.shipped.length === 1 && g.mode === 'pause', 'R2 steps');
press(g, 'L2');
ok(g.sim.shipped.length === 0 && g.sim.held, 'L2 steps back');
press(g, 'B');
ok(g.mode === 'edit' && g.history.length === 1, 'B stops and returns to the editor');

// hidden stream reveal on Open Shift
g.selectLevel(6, true);
g.program = P('LOOP ' + L('open-shift').streams[0].length + '; GRAB; PAINT lime; SHIP; END'); g.afterEdit();
g.run(true); guard = 0;
while (g.mode !== 'done' && guard++ < 500) g.tick(0.1);
ok(g.sim.status === 'win' && !g.result.cleared && g.flashMsg.kind === 'fault', 'visible win but failing stream is reported', g.flashMsg && g.flashMsg.msg);
console.log('  hidden-stream message: ' + g.flashMsg.msg);

// limit enforcement while editing
g.selectLevel(4, true);
g.program = []; g.cursor = -1; g.afterEdit();
for (let k = 0; k < 8; k++) g.insert('GRAB');
ok(C.programSize(g.program) === 6, 'Bulk Order refuses lines past the 6-line limit');

// view model is plain JSON (it crosses screens on Android)
const vm = g.viewModel();
ok(JSON.parse(JSON.stringify(vm)).program.length === 6, 'view model survives JSON');

// ===================== Chapter 2: Junction Floor =====================
console.log('\nChapter 2: Junction Floor');
const FL = id => F.LEVELS.find(l => l.id === id);
const DOC_PAR = { 'two-docks': 3, 'respray-line': 4, 'three-way': 6, 'gauge': 6, 'batch-split': 4, 'every-third': 5, 'crossover': 8, 'recirculate': 4, 'tight-floor': 6, 'night-audit': 10 };
ok(F.LEVELS.length === 10, 'chapter 2 has 10 contracts');
ok(Game.LEVELS.length === C.LEVELS.length + 10, 'the game lists both chapters');

// every reference floor clears every stream, within the kit, at the design's par size
for (const lv of F.LEVELS) {
  const ev = F.evaluate(lv, lv.refFloor);
  ok(ev.cleared, `${lv.name}: reference floor clears all ${lv.streams.length} streams`, JSON.stringify(ev.results.map(r => r.msg)));
  for (const r of ev.results) ok(r.status === 'win', `${lv.name}: reference clears stream ${r.stream + 1}${r.stream >= 3 ? ' (hidden)' : ''}`, r.msg);
  ok(ev.size === DOC_PAR[lv.id], `${lv.name}: reference size ${ev.size} equals the design par ${DOC_PAR[lv.id]}`);
  ok(lv.streams.length === 5 && lv.visibleStreams === 3, `${lv.name}: 3 visible + 2 hidden streams`);
  const placed = F.placedSlots(lv.refFloor);
  ok(new Set(placed).size === placed.length && placed.every(s => s < lv.slots.length), `${lv.name}: reference uses only its kit`);
  ok(F.countParts(lv.refFloor).bridge <= (lv.bridges || 0), `${lv.name}: reference uses at most its bridges`);
  ok(placed.every(s => C.programSize(lv.refFloor.progs[s]) <= lv.slots[s].cap), `${lv.name}: every node program fits its cap`);
  for (const d of lv.docks) ok(lv.streams.some((_, si) => F.orderFor(lv, si)[d].length > 0), `${lv.name}: Dock ${d} gets cells in some stream`);
  for (const k in lv.refFloor.tiles) {
    const [x, y] = k.split(',').map(Number), t = lv.refFloor.tiles[k], b = F.buildable(lv, x, y);
    ok(b === 'any' || (b === 'bridge' && t.k === 'bridge'), `${lv.name}: reference part at ${k} is on a buildable tile`);
  }
  console.log(`  2-${String(lv.num).padStart(2, '0')} ${lv.name.padEnd(13)} size ${ev.size}  cycles ${ev.cycles}  parts ${ev.parts}`);
}

// floor faults
function floorOf(lv, rows, dirs, progs) { return F.parseFloor(lv, { rows, dirs: dirs || {}, progs: progs || {} }); }
const td = FL('two-docks');
function run2(lv, fl, s = 0) { return F.runStream(lv, fl, s); }
let fr;
fr = run2(td, floorOf(td, ['.......', '......A', 'I>.....', '......B', '......R']));
ok(fr.status === 'fault' && /empty tile/.test(fr.msg), 'a cell rolling onto an empty tile faults', fr.msg);
fr = run2(td, floorOf(td, ['.......', '......A', 'I<.....', '......B', '......R']));
ok(fr.status === 'fault' && /front of a belt/.test(fr.msg), 'a cell entering a belt from its front faults', fr.msg);
fr = run2(td, floorOf(td, ['.......', '......A', 'I>1....', '......B', '......R'], { 1: 'v' }, { 1: 'SEND left' }));
ok(fr.status === 'fault' && /side of SPL1/.test(fr.msg), 'a cell entering a node from its side faults', fr.msg);
fr = run2(td, floorOf(td, ['.......', '...>>>A', 'I>>1...', '...>>>B', '......R'], { 1: '>' }, { 1: 'IF cyan; ELSE; SEND right; END' }));
ok(fr.status === 'fault' && /without a SEND/.test(fr.msg) && fr.state.lineSlot === 0, 'a router that ends without SEND faults on its node', fr.msg);
fr = run2(td, floorOf(td, ['.......', '...>>>A', 'I>>1...', '...>>>B', '......R'], { 1: '>' }, { 1: 'SEND left' }));
ok(fr.status === 'fault' && /Wrong cell at Dock A/.test(fr.msg) && fr.state.lineSlot === 0 && fr.state.line === 0, 'a wrong cell at a dock faults and points at the SEND line', fr.msg);
fr = run2(td, floorOf(td, ['.......', '...>>>A', 'I>>1...', '...>>>B', '......R'], { 1: '>' }, { 1: 'SEND ahead' }));
ok(fr.status === 'fault' && /empty tile/.test(fr.msg), 'SEND ahead into nothing faults', fr.msg);
fr = run2(FL('batch-split'), floorOf(FL('batch-split'), ['.......', '...>>>A', 'I>>1#..', '...>>>B', '......R'], { 1: '>' }, { 1: 'SEND ahead' }));
ok(fr.status === 'fault' && /wall/.test(fr.msg), 'a cell sent into a wall faults', fr.msg);
fr = run2(td, floorOf(td, ['.......', '...>>>A', 'I>>1...', '...>>>B', '......R'], { 1: '>' }, { 1: 'SEND right' }));
ok(fr.status === 'fault' && /Dock B/.test(fr.msg), 'cells sent only one way fail the other dock', fr.msg);
const oneWay = F.evaluate(td, floorOf(td, ['.......', '...>>>A', 'I>>1...', '...>>>B', '......R'], { 1: '>' }, { 1: 'IF cyan; SEND left; ELSE; IF amber; SEND left; ELSE; SEND right; END; END' }));
ok(!oneWay.cleared, 'a floor that sends amber to Dock A does not clear');
fr = run2(FL('gauge'), floorOf(FL('gauge'), ['........', '..>>>>>A', 'I>1.....', '..>>>>>B', '.......R'], { 1: '>' }, { 1: 'SEND right' }));
ok(fr.status === 'fault' && /Dock B/.test(fr.msg), 'uncharged cells at a dock that wants charged ones fault', fr.msg);
// counter memory resets per stream and ticks
const bs = FL('batch-split');
const bsRun = F.runStream(bs, bs.refFloor, 1);
ok(bsRun.status === 'win' && bsRun.state.mem[0] === 4, 'Counter memory counts up to 4 and holds', JSON.stringify(bsRun.state.mem));
ok(F.initState(bs, 2).mem[0] === 0, 'Counter memory starts at 0 on every stream');
// compile rules
ok(F.compileNode(P('LOOP forever; SEND left; END'), 'splitter').errors.length > 0, 'LOOP forever is not allowed in a node');
ok(F.compileNode(P('IF c=1; SEND left; END'), 'splitter').errors.length > 0, 'only a Counter can test its count');
ok(F.compileNode(P('PAINT cyan'), 'splitter').errors.length > 0, 'a Splitter cannot PAINT');
ok(F.compileNode(P('IF c=1; SEND left; ELSE; TICK; SEND right; END'), 'counter').errors.length === 0, 'a Counter accepts count tests, TICK and SEND');

// output arrows come from the program
ok(F.outputSides([], 'splitter').length === 0, 'an empty Splitter has no outputs (shown as not programmed)');
ok(F.outputSides(P('IF cyan; SEND right; ELSE; SEND left; END; SEND right'), 'splitter').join() === 'left,right', 'a Splitter shows an output for each side it SENDs to');
ok(F.outputSides(P('IF c>3; SEND ahead; ELSE; TICK; END'), 'counter').join() === 'ahead', 'a Counter shows only its SEND sides');
ok(F.outputSides(P('IF cyan; END'), 'splitter').length === 0, 'a Splitter with no SEND shows no outputs');
ok(F.outputSides(P('PAINT cyan'), 'painter').join() === 'ahead' && !F.outputSides([], 'painter').length, 'a tool shows ahead once programmed');

// ---------- the game host on chapter 2 ----------
const N1 = C.LEVELS.length;
g = new Game({ sfx: silent, skipBoard: true });
ok(!g.isUnlocked(N1), 'chapter 2 is locked until chapter 1 is cleared');
g.save.cleared[C.LEVELS[N1 - 1].id] = true;
ok(g.isUnlocked(N1) && !g.isUnlocked(N1 + 1), 'clearing the last chapter 1 contract opens Two Docks only');

g = new Game({ sfx: silent, skipBoard: true, unlockAll: true });
g.selectLevel(N1, true);
ok(g.isFloor() && g.level.id === 'two-docks' && g.fmode === 'build', 'Two Docks opens in Build mode');
ok(g.tc.x === 1 && g.tc.y === 2 && g.facing === 0, 'the build cursor starts next to the intake, facing east');
// gamepad: A lays a belt, hold A and move draws more
g.act({ type: 'btn', b: 'A', phase: 'down' });
g.act({ type: 'btn', b: 'right', phase: 'down' }); g.act({ type: 'btn', b: 'right', phase: 'up' });
g.act({ type: 'btn', b: 'A', phase: 'up' });
ok(g.floor.tiles['1,2'] && g.floor.tiles['2,2'] && g.floor.tiles['2,2'].d === 0, 'hold A and move draws a belt', JSON.stringify(g.floor.tiles));
press(g, 'right');
ok(g.tc.x === 3 && !g.floor.tiles['3,2'], 'the d-pad alone moves the cursor without building');
// hold X + right picks the Splitter; releasing X after picking does not rotate
g.act({ type: 'btn', b: 'X', phase: 'down' });
g.act({ type: 'btn', b: 'right', phase: 'down' }); g.act({ type: 'btn', b: 'right', phase: 'up' });
g.act({ type: 'btn', b: 'X', phase: 'up' });
ok(g.buildParts()[g.partIdx].t === 'splitter' && g.facing === 0, 'hold X + right picks the next part');
press(g, 'A');
ok(g.floor.tiles['3,2'] && g.floor.tiles['3,2'].k === 'node' && g.active === 0, 'A places the Splitter and selects it');
let vmU = g.viewModel().floor;
ok(vmU.slots[0].unset && vmU.slots[0].outs.length === 0, 'a new Splitter is marked not programmed, with no output arrows');
press(g, 'L3');
ok(g.fmode === 'program' && g.active === 0, 'L3 with the cursor on a node opens its program');
g.insert('SEND');
vmU = g.viewModel().floor;
ok(!vmU.slots[0].unset && vmU.slots[0].outs.join() === '3', 'SEND left on an east-facing Splitter shows a north arrow', vmU.slots[0].outs.join());
press(g, 'Y'); press(g, 'L3');
ok(g.fmode === 'build', 'L3 again goes back to Build');
press(g, 'A');
ok(Object.values(g.floor.tiles).filter(t => t.k === 'node').length === 1, 'a second A on the same tile does not add a node');
press(g, 'down'); press(g, 'A');
ok(!g.floor.tiles['3,3'] && g.flashMsg && /on the floor/.test(g.flashMsg.msg), 'the kit stops a second Splitter', g.flashMsg && g.flashMsg.msg);
press(g, 'X');
ok(g.facing === 1, 'tap X turns the facing');
press(g, 'up'); press(g, 'X'); press(g, 'X'); press(g, 'X');
ok(g.floor.tiles['3,2'].d === 0, 'tap X turns the node under the cursor');
// touch: pick Belt and tap tiles
g.act({ type: 'part', i: 0 });
for (const [x, y] of [[3, 1], [4, 1], [5, 1], [3, 3], [4, 3], [5, 3]]) g.act({ type: 'tile', x, y });
ok(['3,1', '4,1', '5,1', '3,3', '4,3', '5,3'].every(k => g.floor.tiles[k] && g.floor.tiles[k].k === 'belt' && g.floor.tiles[k].d === 0), 'tapping tiles lays belts');
g.act({ type: 'tile', x: 5, y: 3 });
ok(g.floor.tiles['5,3'].d === 1, 'tapping the same belt again turns it');
g.act({ type: 'rotate' }); g.act({ type: 'rotate' }); g.act({ type: 'rotate' });
ok(g.floor.tiles['5,3'].d === 0, 'the Rotate button turns it back');
g.act({ type: 'tile', x: 6, y: 1 });
ok(g.flashMsg && /Dock A/.test(g.flashMsg.msg) && !g.floor.tiles['6,1'], 'docks cannot be built on');
// B removes, Y undoes
g.act({ type: 'tile', x: 4, y: 0 });
ok(g.floor.tiles['4,0'], 'extra belt placed');
press(g, 'B');
ok(!g.floor.tiles['4,0'], 'B removes the part under the cursor');
press(g, 'Y');
ok(g.floor.tiles['4,0'], 'Y undoes the removal');
press(g, 'Y');
ok(!g.floor.tiles['4,0'], 'Y again undoes the placement');
g.act({ type: 'btn', b: 'L1', phase: 'down' }); press(g, 'Y'); g.act({ type: 'btn', b: 'L1', phase: 'up' });
ok(g.floor.tiles['4,0'], 'L1 + Y redoes');
press(g, 'B');
// program the Splitter with buttons
press(g, 'L3');
ok(g.fmode === 'program' && g.active === 0 && g.program === g.floor.progs[0], 'L3 switches to Program mode on the Splitter');
press(g, 'right'); press(g, 'right'); press(g, 'A');                // IF cyan (+ END)
press(g, 'left'); press(g, 'left'); press(g, 'A');                  // SEND left
press(g, 'right'); press(g, 'right'); press(g, 'right'); press(g, 'A'); // ELSE
press(g, 'left'); press(g, 'left'); press(g, 'left'); press(g, 'A'); // SEND left
press(g, 'R1'); press(g, 'R1');                                     // SEND right
ok(g.program.map(F.lineText).join('; ') === 'IF cyan; SEND left; ELSE; SEND right; END', 'buttons write the Splitter program', g.program.map(F.lineText).join('; '));
for (let k = 0; k < 4; k++) g.insert('SEND');
ok(C.programSize(g.program) === 4, 'a Splitter holds 4 lines', C.programSize(g.program));
press(g, 'Y');
ok(C.programSize(g.program) === 3 && g.program.map(F.lineText).join('; ') === 'IF cyan; SEND left; ELSE; SEND right; END', 'undo takes the extra line back', g.program.map(F.lineText).join('; '));
press(g, 'start');
guard = 0;
while (g.mode !== 'done' && guard++ < 2000) g.tick(0.5);
ok(g.overlay === 'cleared' && g.result.cleared && g.save.cleared['two-docks'], 'running the built floor clears Two Docks', g.flashMsg && g.flashMsg.msg);
ok(g.result.size === 3 && g.result.parts === 9, 'the cleared panel has size 3 and 9 parts', JSON.stringify([g.result.size, g.result.parts]));
ok(g.save.best['two-docks'].parts === 9, 'best parts are saved');
ok(g.save.floors['two-docks'] && g.save.floors['two-docks'].tiles['3,2'], 'the floor is saved');
// trace a shipped cell back to its SEND line
press(g, 'B');
g.run(true); guard = 0;
while (g.mode !== 'done' && guard++ < 2000) g.tick(0.5);
g.overlay = null;
const shippedB = g.sim.docks.B[0];
g.act({ type: 'trace', id: shippedB.id });
ok(g.fmode === 'program' && g.active === 0 && g.traceLine === 3, 'tracing a Dock B cell opens the Splitter at SEND right', g.traceLine);
const vm2 = JSON.parse(JSON.stringify(g.viewModel()));
ok(vm2.floor && vm2.floor.W === 7 && vm2.floor.slots[0].placed && vm2.level.kind === 'floor', 'the floor view model survives JSON');
// a fault points at the right node line
g.reset();
g.program.splice(0, g.program.length, ...P('SEND left')); g.afterEdit();
g.run(true); guard = 0;
while (g.mode !== 'done' && guard++ < 2000) g.tick(0.5);
ok(g.sim.status === 'fault' && g.cursor === 0 && g.flashMsg.kind === 'fault', 'a wrong dock puts the cursor on the SEND line', g.flashMsg && g.flashMsg.msg);
// build errors stop a run
g.reset();
g.program.splice(0, g.program.length, ...P('IF cyan; SEND left')); g.afterEdit();
press(g, 'start');
ok(g.mode === 'edit' && g.flashMsg.kind === 'fault' && /SPL1/.test(g.flashMsg.msg), 'a program error in a node stops the run', g.flashMsg.msg);

// load every reference floor through the host and run it
for (let i = 0; i < F.LEVELS.length; i++) {
  g.selectLevel(N1 + i, true);
  g.floor = JSON.parse(JSON.stringify(g.level.refFloor));
  g.active = F.placedSlots(g.floor)[0]; g.bindActive(); g.afterEdit();
  g.run(true); guard = 0;
  while (g.mode !== 'done' && guard++ < 5000) g.tick(0.5);
  ok(g.overlay === 'cleared' && g.result.cleared, `${g.level.name}: reference floor clears through the game host`, g.flashMsg && g.flashMsg.msg);
}

// Tight Floor: only a Bridge goes over the old scrap line
g.selectLevel(N1 + 8, true);
g.act({ type: 'clearFloor' });
ok(!Object.keys(g.floor.tiles).length, 'Clear floor empties the saved floor');
g.act({ type: 'part', i: 0 });
g.act({ type: 'tile', x: 5, y: 2 });
ok(!g.floor.tiles['5,2'] && /Bridge/.test(g.flashMsg.msg), 'a belt cannot go on the old scrap line');
g.act({ type: 'part', i: 1 });
g.act({ type: 'tile', x: 5, y: 2 });
ok(g.floor.tiles['5,2'] && g.floor.tiles['5,2'].k === 'bridge', 'a Bridge can');
g.act({ type: 'tile', x: 5, y: 1 });
ok(!g.floor.tiles['5,1'], 'only one Bridge in the kit');
// switching nodes with L1 + d-pad in Program mode
g.selectLevel(N1 + 6, true);
g.floor = JSON.parse(JSON.stringify(g.level.refFloor)); g.active = 0; g.bindActive(); g.afterEdit();
press(g, 'L3');
g.act({ type: 'btn', b: 'L1', phase: 'down' }); press(g, 'right'); press(g, 'right'); g.act({ type: 'btn', b: 'L1', phase: 'up' });
ok(g.fmode === 'program' && g.active === 2 && g.program === g.floor.progs[2], 'L1 + right switches to the next placed node', g.active);
ok(g.program.length === 1 && g.program[0].op === 'PAINT' && g.paletteIdx === 0, 'the Painter program and palette show');
g.act({ type: 'btn', b: 'L1', phase: 'down' }); press(g, 'L3'); g.act({ type: 'btn', b: 'L1', phase: 'up' });
ok(g.overlay === 'board' && g.fmode === 'program', 'L1 + L3 opens the contract board');
press(g, 'R1');
ok(g.overlay === 'ledger', 'R1 on the last chapter page flips to the Ledger page', g.overlay);
press(g, 'R1');
ok(g.overlay === 'board' && g.boardSel === (N1 + 6 + 10) % Game.LEVELS.length, 'R1 on the Ledger flips to chapter 1, same slot', g.boardSel);
press(g, 'L1'); press(g, 'L1');
ok(g.overlay === 'board' && g.boardSel === N1 + 6, 'L1 twice goes back through the Ledger to chapter 2', g.boardSel);
press(g, 'B');
ok(g.overlay === null, 'B closes the board');


// ---------------- the Ledger (idle earnings, business layer slice 1) ----------------
console.log('\nThe Ledger');
{
  const ALL = Game.LEVELS;
  const byId = LG.index(ALL);
  const H = LG.HOUR;
  // base rates: Night Shift 20 to 70, Junction Floor 90 to 180, rising with the contract
  ok(LG.baseRate(ALL[0]) === 20 && LG.baseRate(ALL[9]) === 70, 'Night Shift base runs 20 to 70 cr/h');
  ok(LG.baseRate(ALL[10]) === 90 && LG.baseRate(ALL[19]) === 180, 'Junction Floor base runs 90 to 180 cr/h');
  let rising = true;
  for (let i = 1; i < ALL.length; i++) if (LG.baseRate(ALL[i]) <= LG.baseRate(ALL[i - 1])) rising = false;
  ok(rising, 'base rates rise with every contract');
  // a solution at par earns exactly the base rate, for all 20 contracts
  for (const lv of ALL) ok(Math.abs(LG.rate(lv, LG.parRun(lv)) - LG.baseRate(lv)) < 1e-9, `${lv.name}: par earns exactly base`);
  // the doc's worked example: Double Time, 6 lines, 80% of par cycles
  const dt = L('double-time');
  const ex = LG.rate(dt, { size: 6, cycles: dt.parCycles * 0.8 });
  ok(Math.abs(ex - 70 * 1.25 * 7 / 6) < 1e-6 && Math.round(ex) === 102, 'Double Time worked example earns about 102 cr/h', ex);
  // clamps
  let f = LG.factors(dt, { size: 1, cycles: 1 });
  ok(f.speed === 2 && f.lean === 1.5, 'Speed caps at 2.0 and Lean at 1.5', JSON.stringify(f));
  f = LG.factors(dt, { size: 999, cycles: 1e6 });
  ok(f.speed === 0.5 && f.lean === 0.5, 'a sloppy clear earns at least half on each factor, never nothing', JSON.stringify(f));
  const fl = F.LEVELS[0];
  ok(LG.factors(fl, { size: fl.parSize, cycles: fl.parCycles, parts: 1 }).tidy === 1.2, 'Tidy caps at 1.2');
  ok(LG.factors(fl, { size: fl.parSize, cycles: fl.parCycles, parts: 999 }).tidy === 0.8, 'Tidy floors at 0.8');
  ok(LG.factors(dt, { size: 7, cycles: dt.parCycles, parts: 1 }).tidy === 1, 'Tidy only counts on floors');
  ok(Math.abs(LG.rate(dt, LG.parRun(dt), 3) - 70 * 1.3) < 1e-9, 'each Overclock level adds 10%');

  // settle: pays by the hour, caps at one shift, a clock moved back pays nothing
  let sv = { runs: { 'double-time': LG.parRun(dt) } };
  LG.migrate(sv, ALL, null, 1000);
  sv.ledger.bays = ['double-time'];
  let r1 = LG.settle(sv, ALL, 1000 + H);
  ok(Math.abs(r1.total - 70) < 1e-9 && Math.abs(sv.ledger.credits - 70) < 1e-9 && r1.away, 'one hour away pays one hour of the bay', r1.total);
  r1 = LG.settle(sv, ALL, 1000 + H + 30 * H);
  ok(Math.abs(r1.total - 70 * 8) < 1e-9 && r1.capped, 'thirty hours away pays one 8-hour shift', r1.total);
  const before = sv.ledger.credits;
  r1 = LG.settle(sv, ALL, 5000);
  ok(r1.backwards && r1.total === 0 && sv.ledger.credits === before && sv.ledger.lastSeen === 5000, 'a clock moved backwards pays nothing and resets the stored time');
  r1 = LG.settle(sv, ALL, 5000 + 2 * 60 * 1000);
  ok(!r1.away && Math.abs(r1.total - 70 / 30) < 1e-9, 'two minutes away pays quietly, with no report');
  sv.ledger.up.shift = 1;
  r1 = LG.settle(sv, ALL, 5000 + 2 * 60 * 1000 + 30 * H);
  ok(Math.abs(r1.total - 70 * 10) < 1e-9, 'Shift length level 1 pays up to 10 hours');

  // upgrades: costs, effects, and never a change to a contract
  sv = { runs: {} };
  LG.migrate(sv, ALL, null, 0);
  let b = LG.buy(sv, ALL, 'bays');
  ok(!b.ok && /300/.test(b.msg), 'an upgrade you can\'t afford is refused', b.msg);
  const snap = () => JSON.stringify(ALL.map(lv => [lv.id, lv.palette, lv.limit, lv.parSize, lv.parCycles, lv.parParts, lv.streams, lv.slots, lv.kit, lv.W, lv.H]));
  const levelsBefore = snap();
  sv.ledger.credits = 1e9;
  for (const u of LG.UPGRADES) { let k = 0; while (LG.buy(sv, ALL, u.id).ok) k++; ok(k === u.costs.length, `${u.name} buys ${u.costs.length} levels`, k); }
  ok(LG.bayCount(sv.ledger) === 12 && LG.shiftHours(sv.ledger) === 24 && Math.abs(LG.overclock(sv.ledger) - 1.5) < 1e-9, 'top levels: 12 bays, 24h shift, +50%');
  ok(LG.upgradeCost(sv.ledger, 'bays') === null && !LG.buy(sv, ALL, 'bays').ok, 'a maxed upgrade can\'t be bought again');
  ok(snap() === levelsBefore, 'buying every upgrade leaves every contract\'s parts, caps, streams and pars unchanged');

  // a clear pays once, keeps the best-earning run, and fills a free bay
  sv = { runs: {} };
  LG.migrate(sv, ALL, null, 0);
  let rc = LG.recordClear(sv, ALL, dt, { size: 9, cycles: dt.parCycles * 2 });
  ok(rc.pay.total === 70 * 4 && rc.bay === 0 && rc.slotted, 'a first clear pays 4 hours of base and takes a free bay', JSON.stringify(rc.pay));
  rc = LG.recordClear(sv, ALL, dt, { size: 7, cycles: dt.parCycles });
  ok(rc.pay.total === 70 * 4 && rc.better, 'beating par on Size and Cycles pays the Lean and Fast chips (2 hours each)', rc.pay.total);
  rc = LG.recordClear(sv, ALL, dt, { size: 6, cycles: dt.parCycles * 3 });
  ok(rc.pay.total === 0 && !rc.better && rc.worse && sv.runs['double-time'].size === 7, 'a clear that earns less pays nothing and keeps the better run');
  ok(LG.toggleBay(sv, ALL, 'double-time').inBay === false && sv.ledger.bays.length === 0, 'a contract can leave its bay');
  ok(!LG.toggleBay(sv, ALL, 'clock-in').ok, 'an uncleared contract can\'t take a bay');

  // migration of a save from before the Ledger
  const store = {};
  globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  const old = { current: 3, cleared: {}, best: {}, programs: {}, floors: {} };
  for (const id of ['clock-in', 'defects', 'respray', 'boost']) {
    const lv = L(id);
    old.cleared[id] = true;
    old.programs[id] = lv.referenceProgram;
    old.best[id] = { size: lv.parSize, cycles: lv.parCycles + 5 }; // Lean chip only
  }
  old.programs['boost'] = P('GRAB; SHIP'); // edited since its clear: no longer clears
  const fl0 = F.LEVELS[0];
  old.cleared[fl0.id] = true; old.floors[fl0.id] = fl0.refFloor; old.best[fl0.id] = { size: fl0.parSize, cycles: fl0.parCycles, parts: fl0.parParts };
  const oldJson = JSON.stringify(old);
  store['overshift.save.v1'] = oldJson;
  let clock = 1.7e12;
  const now = () => clock;
  let lg = new Game({ sfx: silent, now });
  const S = lg.save, Lg = S.ledger;
  ok(Lg && Lg.v === 1, 'an old save gets a Ledger on first load');
  ok(JSON.stringify(S.programs) === JSON.stringify(old.programs) && JSON.stringify(S.best) === JSON.stringify(old.best) && JSON.stringify(S.cleared) === JSON.stringify(old.cleared) && S.current === 3, 'migration keeps programs, bests, clears and the current contract');
  ok(S.runs['clock-in'].size === L('clock-in').parSize && S.runs['clock-in'].cycles === L('clock-in').parCycles, 'a cleared program is re-scored for its bay');
  ok(JSON.stringify(S.runs['boost']) === JSON.stringify(LG.parRun(L('boost'))), 'a program that no longer clears runs at par');
  ok(S.runs[fl0.id] && S.runs[fl0.id].parts === fl0.parParts, 'a cleared floor is re-scored with its parts');
  const expectPaid = ['clock-in', 'defects', 'respray', 'boost'].reduce((t, id) => t + LG.baseRate(L(id)) * 6, 0) + LG.baseRate(fl0) * 8;
  ok(Math.abs(Lg.credits - expectPaid) < 1e-9, 'first clears and earned chips are back-paid once', Lg.credits + ' vs ' + expectPaid);
  ok(Lg.bays.length === 3 && Lg.bays[0] === fl0.id, 'the 3 bays fill with the best earners', Lg.bays.join(','));
  ok(Lg.lastSeen === clock, 'time before the update earns nothing');
  ok(lg.overlay === 'report' && lg.report.kind === 'welcome', 'an old save sees what the Ledger paid', lg.overlay);
  press(lg, 'A');
  ok(lg.overlay === 'board', 'A continues to the contract board');
  const saved = JSON.parse(store['overshift.save.v1']);
  ok(saved.ledger && saved.runs && saved.programs['clock-in'], 'the migrated save is written back');

  // reload: nothing paid twice, then time away
  clock += 3 * H;
  lg = new Game({ sfx: silent, now });
  ok(Math.abs(lg.save.ledger.credits - expectPaid - 3 * lg.ledgerRate()) < 1e-6, 'reopening pays the bays for 3 hours, and no clear is paid twice', lg.save.ledger.credits);
  ok(lg.overlay === 'report' && lg.report.kind === 'away' && lg.report.rows.length === 3, 'more than 5 minutes away shows the Shift report');
  press(lg, 'B');
  ok(lg.overlay === 'board', 'the report closes back to where you were');

  // while playing: bays earn as the clock runs, with no report
  const c0 = lg.save.ledger.credits, rate = lg.ledgerRate();
  clock += 60 * 1000; lg.tick(1.1);
  ok(Math.abs(lg.save.ledger.credits - c0 - rate / 60) < 1e-6 && lg.overlay === 'board', 'a minute of play earns a minute of income');
  // pause and resume (the shell's onPause / onResume): paid, capped at the shift
  lg.ledgerPause();
  const c1 = lg.save.ledger.credits;
  clock += 40 * H; lg.tick(1.1);
  ok(lg.save.ledger.credits === c1, 'nothing settles while paused');
  lg.ledgerResume();
  ok(Math.abs(lg.save.ledger.credits - c1 - 8 * rate) < 1e-6 && lg.report.capped, 'resuming after 40 hours pays one 8-hour shift', lg.save.ledger.credits - c1);
  press(lg, 'A');

  // the Ledger page with the gamepad
  lg.overlay = 'board'; lg.boardSel = 0;
  press(lg, 'L1');
  ok(lg.overlay === 'ledger', 'L1 on chapter 1 opens the Ledger page');
  let vm = lg.viewModel();
  ok(vm.ledger && vm.ledger.tab === 'bays' && vm.ledger.rows.length === 5 && vm.ledger.bayCap === 3, 'the Bays tab lists every cleared contract', vm.ledger && vm.ledger.rows.length);
  const outRow = vm.ledger.rows.findIndex(r => r.bay < 0);
  lg.ledgerSel = outRow; press(lg, 'A');
  ok(/bays are busy/.test(lg.flashMsg.msg), 'A on a contract with every bay busy says so');
  lg.ledgerSel = vm.ledger.rows.findIndex(r => r.bay === 0); press(lg, 'A');
  ok(lg.save.ledger.bays.length === 2, 'A takes a contract out of its bay');
  lg.ledgerSel = outRow; press(lg, 'A');
  ok(lg.save.ledger.bays.length === 3 && lg.save.ledger.bays.includes(vm.ledger.rows[outRow].id), 'A puts another in the free bay');
  press(lg, 'R2');
  vm = lg.viewModel();
  ok(vm.ledger.tab === 'upgrades' && vm.ledger.rows.length === 3, 'R2 switches to Upgrades');
  const cr0 = lg.save.ledger.credits;
  lg.ledgerSel = 0;
  lg.act({ type: 'btn', b: 'A', phase: 'down' });
  lg.tick(0.2);
  ok(lg.save.ledger.up.bays === 0 && lg.viewModel().ledger.hold.p > 0, 'holding A fills the buy ring before anything is bought');
  lg.act({ type: 'btn', b: 'A', phase: 'up' });
  lg.tick(0.5);
  ok(lg.save.ledger.up.bays === 0, 'letting go early buys nothing');
  lg.act({ type: 'btn', b: 'A', phase: 'down' }); lg.tick(0.3); lg.tick(0.3);
  ok(lg.save.ledger.up.bays === 1 && Math.abs(lg.save.ledger.credits - (cr0 - 300)) < 1e-6 && lg.save.ledger.bays.length === 4, 'a half-second hold buys a 4th bay, which fills itself', lg.save.ledger.credits);
  lg.tick(0.6);
  ok(lg.save.ledger.up.bays === 1, 'one hold buys one level');
  lg.act({ type: 'btn', b: 'A', phase: 'up' });
  lg.act({ type: 'hold', i: 1, on: true }); lg.tick(0.6); lg.act({ type: 'hold', i: 1, on: false });
  ok(lg.save.ledger.up.overclock === 1, 'press and hold on the bottom screen buys too');
  press(lg, 'L2');
  lg.ledgerSel = 0;
  press(lg, 'start');
  ok(lg.overlay === null && lg.level.id === lg.ledgerRows()[0].id, 'Start opens the selected contract to improve it');
  lg.act({ type: 'ledger' });
  ok(lg.overlay === 'ledger', 'the ₵ button opens the Ledger');
  press(lg, 'B');
  ok(lg.overlay === 'board', 'B goes back to the contract board');

  // a clear through the game host pays and fills the new bay
  lg.selectLevel(4, true);
  lg.program = L('bulk-order').referenceProgram.slice(); lg.afterEdit();
  lg.run(true); let gd = 0;
  while (lg.mode !== 'done' && gd++ < 5000) lg.tick(0.5);
  ok(lg.overlay === 'cleared' && lg.result.ledger && lg.result.ledger.pay.total === LG.baseRate(L('bulk-order')) * 8, 'clearing Bulk Order at par pays first clear and both chips', lg.result.ledger && lg.result.ledger.pay.total);
  ok(lg.result.ledger.bay >= 0 || lg.save.ledger.bays.length === LG.bayCount(lg.save.ledger), 'the new clear takes a bay if one is free');
  delete globalThis.localStorage;

  // a fresh install starts with an empty Ledger and no report
  const g0 = new Game({ sfx: silent, now });
  ok(g0.save.ledger.credits === 0 && g0.overlay === 'board', 'a new player starts at 0 cr on the board');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
