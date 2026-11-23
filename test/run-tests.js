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
require(path.join(__dirname, '../web/js/game.js'));
require(path.join(__dirname, '../web/js/floorgame.js'));
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
ok(g.boardSel === (N1 + 6 + 10) % Game.LEVELS.length, 'R1 on the board flips to the other chapter', g.boardSel);
press(g, 'B');
ok(g.overlay === null, 'B closes the board');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
