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
require(path.join(__dirname, '../web/js/game.js'));
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
  press(g, 'R1'); press(g, 'A');         // SHIP
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
press(g, 'right');
ok(g.program[0].arg !== before, 'right cycles the value on the cursor line');
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
