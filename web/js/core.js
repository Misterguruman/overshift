/*
 * Overshift core: levels, program model and the Servo interpreter.
 * Pure logic, no DOM. Runs in the browser (window.OvershiftCore) and in node (require).
 *
 * The interpreter is a pure step function: step(ctx, state) -> new state.
 * One step runs one instruction that costs cycles (an action, a LOOP pass or an IF test).
 * END of an IF and ELSE jumps are free and are folded into the step that follows them.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OvershiftCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COLORS = ['cyan', 'magenta', 'amber', 'lime'];
  var STATION_NAMES = {
    intake: 'Intake', painter: 'Painter', press: 'Press', recycler: 'Recycler', outbound: 'Outbound'
  };
  var OP_STATION = {
    GRAB: 'intake', SHIP: 'outbound', SCRAP: 'recycler', PAINT: 'painter', CHARGE: 'press', DRAIN: 'press'
  };
  var ACTION_OPS = ['GRAB', 'SHIP', 'SCRAP', 'PAINT', 'CHARGE', 'DRAIN'];
  var MAX_STEPS = 10000;

  // ---------- value options for instructions that take one ----------
  var LOOP_ARGS = [];
  for (var n = 1; n <= 12; n++) LOOP_ARGS.push(n);
  LOOP_ARGS.push('charge', 'forever');
  var IF_ARGS = COLORS.slice();
  for (var e = 0; e <= 9; e++) IF_ARGS.push('=' + e);
  for (var g = 0; g <= 8; g++) IF_ARGS.push('>' + g);

  function argOptions(op) {
    if (op === 'PAINT') return COLORS;
    if (op === 'LOOP') return LOOP_ARGS;
    if (op === 'IF') return IF_ARGS;
    return null;
  }
  function defaultArg(op) {
    if (op === 'PAINT') return 'cyan';
    if (op === 'LOOP') return 2;
    if (op === 'IF') return 'cyan';
    return undefined;
  }
  function cycleArg(op, arg, dir) {
    var opts = argOptions(op);
    if (!opts) return arg;
    var i = opts.indexOf(arg);
    if (i < 0) i = 0;
    else i = (i + (dir || 1) + opts.length) % opts.length;
    return opts[i];
  }
  function argLabel(op, arg) {
    if (op === 'LOOP') return arg === 'charge' ? 'charge' : arg === 'forever' ? 'forever' : String(arg) + 'x';
    if (op === 'IF') {
      if (COLORS.indexOf(arg) >= 0) return arg;
      return 'charge ' + arg[0] + ' ' + arg.slice(1);
    }
    if (op === 'PAINT') return arg;
    return '';
  }
  function lineText(line) {
    var a = argLabel(line.op, line.arg);
    return a ? line.op + ' ' + a : line.op;
  }

  // ---------- program structure ----------
  /** Match LOOP/IF with their ELSE and END. Returns {ok, errors, end, els, open}. */
  function compile(program, level) {
    var stack = [];
    var end = {}, els = {}, open = {};
    var errors = [];
    for (var i = 0; i < program.length; i++) {
      var op = program[i].op;
      if (op === 'LOOP' || op === 'IF') stack.push(i);
      else if (op === 'ELSE') {
        var top = stack[stack.length - 1];
        if (top === undefined || program[top].op !== 'IF') errors.push({ line: i, msg: 'ELSE must sit inside an IF block' });
        else if (els[top] !== undefined) errors.push({ line: i, msg: 'This IF already has an ELSE' });
        else { els[top] = i; open[i] = top; }
      } else if (op === 'END') {
        if (!stack.length) errors.push({ line: i, msg: 'END has no LOOP or IF to close' });
        else { var o = stack.pop(); end[o] = i; open[i] = o; }
      } else if (level && OP_STATION[op] && level.stations.indexOf(OP_STATION[op]) < 0) {
        errors.push({ line: i, msg: 'No ' + STATION_NAMES[OP_STATION[op]] + ' on this deck' });
      }
    }
    while (stack.length) {
      var u = stack.pop();
      errors.push({ line: u, msg: program[u].op + ' needs an END' });
    }
    return { ok: errors.length === 0, errors: errors, end: end, els: els, open: open };
  }

  /** Size: lines that do something. END and ELSE are free. */
  function programSize(program) {
    var s = 0;
    for (var i = 0; i < program.length; i++) if (program[i].op !== 'END' && program[i].op !== 'ELSE') s++;
    return s;
  }

  /** The span [start, end] of a block opened at i (or just [i, i]). */
  function blockSpan(program, i) {
    var op = program[i] && program[i].op;
    if (op !== 'LOOP' && op !== 'IF') return [i, i];
    var depth = 0;
    for (var j = i; j < program.length; j++) {
      var o = program[j].op;
      if (o === 'LOOP' || o === 'IF') depth++;
      else if (o === 'END') { depth--; if (depth === 0) return [i, j]; }
    }
    return [i, program.length - 1];
  }

  /** Indent depth of each line, for drawing. */
  function indents(program) {
    var d = 0, out = [];
    for (var i = 0; i < program.length; i++) {
      var op = program[i].op;
      if (op === 'END' || op === 'ELSE') d = Math.max(0, d - 1);
      out.push(d);
      if (op === 'LOOP' || op === 'IF' || op === 'ELSE') d++;
    }
    return out;
  }

  // ---------- random streams ----------
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function C(c, q) { return { c: c, q: q }; }
  function randCells(r, count, opts) {
    opts = opts || {};
    var out = [];
    for (var i = 0; i < count; i++) {
      var colors = opts.colors || COLORS;
      var c = colors[Math.floor(r() * colors.length)];
      var maxQ = opts.maxQ === undefined ? 9 : opts.maxQ;
      if (opts.maxQFor && opts.maxQFor[c] !== undefined) maxQ = opts.maxQFor[c];
      out.push(C(c, Math.floor(r() * (maxQ + 1))));
    }
    return out;
  }
  function genStreams(seed, n, make) {
    var r = rng(seed), out = [];
    for (var i = 0; i < n; i++) out.push(make(r, i));
    return out;
  }

  // ---------- program shorthand for reference solutions ----------
  function P(src) {
    return src.split(';').map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) {
      var parts = s.split(/\s+/);
      var op = parts[0].toUpperCase();
      var line = { op: op };
      if (parts.length > 1) {
        var a = parts[1];
        if (op === 'LOOP' && /^\d+$/.test(a)) line.arg = parseInt(a, 10);
        else line.arg = a;
      }
      return line;
    });
  }

  // ---------- the contracts (chapter 1: Night Shift) ----------
  var LEVELS = [
    {
      id: 'clock-in', name: 'Clock In', teaches: 'GRAB and SHIP',
      brief: 'Move 3 cells from intake to outbound, unchanged.',
      client: 'First night? Three cells, straight through. Touch nothing else.',
      stations: ['intake', 'outbound'],
      learned: ['GRAB', 'SHIP'],
      streams: [[C('cyan', 2), C('amber', 5), C('lime', 1)]],
      order: function (s) { return s.slice(); },
      parSize: 6,
      reference: 'GRAB; SHIP; GRAB; SHIP; GRAB; SHIP'
    },
    {
      id: 'defects', name: 'Defects', teaches: 'SCRAP',
      brief: 'Ship the 2nd and 4th cells. Scrap the other two.',
      client: 'Batch QA flagged two duds. The good ones are 2 and 4.',
      stations: ['intake', 'recycler', 'outbound'],
      learned: ['GRAB', 'SHIP', 'SCRAP'],
      streams: [[C('amber', 0), C('cyan', 7), C('magenta', 1), C('lime', 6)]],
      order: function (s) { return [s[1], s[3]]; },
      parSize: 8,
      reference: 'GRAB; SCRAP; GRAB; SHIP; GRAB; SCRAP; GRAB; SHIP'
    },
    {
      id: 'respray', name: 'Respray', teaches: 'PAINT',
      brief: 'Ship all 3 cells painted magenta.',
      client: 'Brand refresh. Everything leaves in magenta now.',
      stations: ['intake', 'painter', 'outbound'],
      learned: ['GRAB', 'SHIP', 'SCRAP', 'PAINT'],
      streams: [[C('cyan', 3), C('lime', 8), C('amber', 4)]],
      order: function (s) { return s.map(function (x) { return C('magenta', x.q); }); },
      parSize: 9,
      reference: 'GRAB; PAINT magenta; SHIP; GRAB; PAINT magenta; SHIP; GRAB; PAINT magenta; SHIP'
    },
    {
      id: 'boost', name: 'Boost', teaches: 'CHARGE, and travel order',
      brief: 'Cells arrive at charge 2. Ship them at charge 4.',
      client: 'Our drones need more juice. Two notches up on each.',
      stations: ['intake', 'recycler', 'press', 'outbound'],
      learned: ['GRAB', 'SHIP', 'SCRAP', 'PAINT', 'CHARGE'],
      streams: [[C('lime', 2), C('cyan', 2), C('magenta', 2)]],
      order: function (s) { return s.map(function (x) { return C(x.c, Math.min(9, x.q + 2)); }); },
      parSize: 12,
      reference: 'GRAB; CHARGE; CHARGE; SHIP; GRAB; CHARGE; CHARGE; SHIP; GRAB; CHARGE; CHARGE; SHIP'
    },
    {
      id: 'bulk-order', name: 'Bulk Order', teaches: 'LOOP n',
      brief: 'Ship all 12 cells painted cyan. Program limit: 6 lines.',
      client: 'Twelve cyan, tonight. Your program buffer is tiny, sorry.',
      stations: ['intake', 'painter', 'outbound'],
      learned: ['GRAB', 'SHIP', 'SCRAP', 'PAINT', 'CHARGE', 'LOOP'],
      limit: 6,
      streams: genStreams(5005, 1, function (r) { return randCells(r, 12); }),
      order: function (s) { return s.map(function (x) { return C('cyan', x.q); }); },
      parSize: 4,
      reference: 'LOOP 12; GRAB; PAINT cyan; SHIP; END'
    },
    {
      id: 'alternating', name: 'Alternating', teaches: 'Loop bodies with more than one step',
      brief: 'Ship all 8 cells, alternating cyan and amber, cyan first.',
      client: 'Display rig wants a striped pattern. Cyan, amber, cyan, amber.',
      stations: ['intake', 'painter', 'outbound'],
      learned: ['GRAB', 'SHIP', 'SCRAP', 'PAINT', 'CHARGE', 'LOOP'],
      streams: genStreams(6006, 1, function (r) { return randCells(r, 8); }),
      order: function (s) { return s.map(function (x, i) { return C(i % 2 ? 'amber' : 'cyan', x.q); }); },
      parSize: 7,
      reference: 'LOOP 4; GRAB; PAINT cyan; SHIP; GRAB; PAINT amber; SHIP; END'
    },
    {
      id: 'open-shift', name: 'Open Shift', teaches: 'LOOP forever, and ending on an empty intake',
      brief: 'Ship every cell painted lime. Streams hold 3 to 9 cells.',
      client: 'Volume varies by the hour. Whatever comes in goes out lime.',
      stations: ['intake', 'press', 'painter', 'outbound'],
      learned: ['GRAB', 'SHIP', 'SCRAP', 'PAINT', 'CHARGE', 'LOOP'],
      streams: genStreams(7007, 5, function (r) { return randCells(r, 3 + Math.floor(r() * 7)); }),
      order: function (s) { return s.map(function (x) { return C('lime', x.q); }); },
      parSize: 4,
      reference: 'LOOP forever; GRAB; PAINT lime; SHIP; END'
    },
    {
      id: 'flatline', name: 'Flatline', teaches: 'DRAIN and LOOP charge',
      brief: 'Cells arrive with any charge. Ship each one at charge 0.',
      client: 'Shipping to a cold-storage vault. Every cell fully drained.',
      stations: ['intake', 'press', 'recycler', 'outbound'],
      learned: ['GRAB', 'SHIP', 'SCRAP', 'PAINT', 'CHARGE', 'DRAIN', 'LOOP'],
      streams: genStreams(8008, 5, function (r) { return randCells(r, 3 + Math.floor(r() * 4)); }),
      order: function (s) { return s.map(function (x) { return C(x.c, 0); }); },
      parSize: 5,
      reference: 'LOOP forever; GRAB; LOOP charge; DRAIN; END; SHIP; END'
    },
    {
      id: 'sorting-gate', name: 'Sorting Gate', teaches: 'IF ... ELSE',
      brief: 'Ship the magenta cells. Scrap all the others.',
      client: 'We only buy magenta. Do not send us anything else.',
      stations: ['intake', 'recycler', 'painter', 'outbound'],
      learned: ['GRAB', 'SHIP', 'SCRAP', 'PAINT', 'CHARGE', 'DRAIN', 'LOOP', 'IF', 'ELSE'],
      streams: genStreams(9009, 5, function (r) {
        var cells = randCells(r, 4 + Math.floor(r() * 4));
        cells[Math.floor(r() * cells.length)].c = 'magenta';
        return cells;
      }),
      order: function (s) { return s.filter(function (x) { return x.c === 'magenta'; }).map(function (x) { return C(x.c, x.q); }); },
      parSize: 5,
      reference: 'LOOP forever; GRAB; IF magenta; SHIP; ELSE; SCRAP; END; END'
    },
    {
      id: 'double-time', name: 'Double Time', teaches: 'Everything, and that a LOOP reads its count once',
      brief: 'Ship cyan cells at double their charge. Scrap all others.',
      client: 'Cyan only, and twice the charge you found them at.',
      stations: ['intake', 'press', 'recycler', 'outbound'],
      learned: ['GRAB', 'SHIP', 'SCRAP', 'PAINT', 'CHARGE', 'DRAIN', 'LOOP', 'IF', 'ELSE'],
      streams: genStreams(1010, 5, function (r) {
        var cells = randCells(r, 4 + Math.floor(r() * 4), { maxQFor: { cyan: 4 } });
        var k = Math.floor(r() * cells.length);
        cells[k].c = 'cyan'; cells[k].q = Math.min(cells[k].q, 4);
        return cells;
      }),
      order: function (s) { return s.filter(function (x) { return x.c === 'cyan'; }).map(function (x) { return C('cyan', x.q * 2); }); },
      parSize: 7,
      reference: 'LOOP forever; GRAB; IF cyan; LOOP charge; CHARGE; END; SHIP; ELSE; SCRAP; END; END'
    }
  ];

  LEVELS.forEach(function (lv, idx) {
    lv.index = idx;
    lv.referenceProgram = P(lv.reference);
    lv.visibleStreams = Math.min(3, lv.streams.length);
    lv.streams.forEach(function (s, si) {
      s.forEach(function (cell, ci) { cell.id = lv.id + ':' + si + ':' + ci; });
    });
    lv.palette = lv.learned.filter(function (op) {
      return !OP_STATION[op] || lv.stations.indexOf(OP_STATION[op]) >= 0;
    });
    if (lv.palette.indexOf('LOOP') >= 0 || lv.palette.indexOf('IF') >= 0) lv.palette = lv.palette.concat(['END']);
  });

  // ---------- simulation ----------
  function cloneCell(c) {
    var o = { c: c.c, q: c.q, id: c.id };
    if (c.line !== undefined) o.line = c.line;
    return o;
  }
  function cloneState(s) {
    return {
      stream: s.stream,
      intake: s.intake.map(cloneCell),
      shipped: s.shipped.map(cloneCell),
      scrapped: s.scrapped.map(cloneCell),
      held: s.held ? cloneCell(s.held) : null,
      pos: s.pos,
      pc: s.pc,
      stack: s.stack.map(function (f) { return { start: f.start, remaining: f.remaining }; }),
      cycles: s.cycles,
      steps: s.steps,
      status: s.status,
      msg: s.msg,
      line: s.line,
      event: null
    };
  }

  function initState(level, streamIdx) {
    return {
      stream: streamIdx,
      intake: level.streams[streamIdx].map(cloneCell),
      shipped: [], scrapped: [],
      held: null,
      pos: 0,
      pc: 0,
      stack: [],
      cycles: 0,
      steps: 0,
      status: 'run', // run | win | fault
      msg: '',
      line: -1, // line that ran in the last step
      event: null
    };
  }

  function orderFor(level, streamIdx) {
    return level.order(level.streams[streamIdx]);
  }

  function describeCell(c) { return c.c + ' ' + c.q; }

  function fault(st, line, msg) {
    st.status = 'fault';
    st.msg = msg;
    st.line = line;
    st.event = { type: 'fault', line: line };
    return st;
  }

  function endShift(st, order, line) {
    if (st.shipped.length === order.length) {
      st.status = 'win';
      st.msg = 'Order filled: ' + order.length + ' of ' + order.length + ' shipped.';
    } else {
      st.status = 'fault';
      st.msg = 'Shift ended with ' + st.shipped.length + ' of ' + order.length + ' cells shipped.';
    }
    st.line = line;
    st.event = st.event || { type: 'end', line: line };
    return st;
  }

  function testCell(cell, arg) {
    if (COLORS.indexOf(arg) >= 0) return cell.c === arg;
    var v = parseInt(arg.slice(1), 10);
    if (arg[0] === '=') return cell.q === v;
    return cell.q > v;
  }

  /**
   * Run one step. ctx = {level, program, compiled, order}. Returns a new state.
   */
  function step(ctx, prev) {
    if (prev.status !== 'run') return prev;
    var st = cloneState(prev);
    var prog = ctx.program, cm = ctx.compiled, level = ctx.level;
    st.steps++;
    if (st.steps > MAX_STEPS) return fault(st, st.pc, 'Shift overran ' + MAX_STEPS + ' steps. Is there a loop that never ends?');

    // fold free control flow
    for (;;) {
      if (st.pc >= prog.length) return endShift(st, ctx.order, -1);
      var ln = prog[st.pc];
      if (ln.op === 'ELSE') { st.pc = cm.end[cm.open[st.pc]] + 1; continue; }
      if (ln.op === 'END') {
        var o = cm.open[st.pc];
        if (prog[o].op === 'LOOP') {
          var f = st.stack[st.stack.length - 1];
          if (f.remaining === -1 || f.remaining > 0) {
            if (f.remaining > 0) f.remaining--;
            st.line = st.pc;
            st.pc = o + 1;
            st.cycles += 1;
            st.event = { type: 'loop', line: st.line };
            return st;
          }
          st.stack.pop();
        }
        st.pc++;
        continue;
      }
      break;
    }

    var i = st.pc;
    var line = prog[i];
    st.line = i;
    var op = line.op;

    if (op === 'LOOP') {
      var count;
      if (line.arg === 'forever') count = -1;
      else if (line.arg === 'charge') {
        if (!st.held) return fault(st, i, 'LOOP charge needs a held cell to read');
        count = st.held.q;
      } else count = line.arg;
      st.cycles += 1;
      if (count === 0) {
        st.pc = cm.end[i] + 1;
        st.event = { type: 'loop', line: i, skipped: true };
      } else {
        st.stack.push({ start: i, remaining: count === -1 ? -1 : count - 1 });
        st.pc = i + 1;
        st.event = { type: 'loop', line: i };
      }
      return st;
    }

    if (op === 'IF') {
      if (!st.held) return fault(st, i, 'IF needs a held cell to test');
      st.cycles += 1;
      var pass = testCell(st.held, line.arg);
      if (pass) st.pc = i + 1;
      else st.pc = cm.els[i] !== undefined ? cm.els[i] + 1 : cm.end[i] + 1;
      st.event = { type: 'if', line: i, pass: pass };
      return st;
    }

    // action instructions: travel then act
    var target = level.stations.indexOf(OP_STATION[op]);
    var from = st.pos;
    var travel = Math.abs(target - from);
    st.cycles += 1 + travel;
    st.pos = target;
    st.pc = i + 1;
    var ev = { type: op.toLowerCase(), line: i, from: from, to: target, travel: travel };
    st.event = ev;

    switch (op) {
      case 'GRAB':
        if (st.held) return fault(st, i, 'GRAB with full hands: Servo is already holding a cell');
        if (!st.intake.length) {
          ev.type = 'empty';
          return endShift(st, ctx.order, i);
        }
        st.held = st.intake.shift();
        ev.cell = st.held.id;
        return st;
      case 'SHIP':
        if (!st.held) return fault(st, i, 'SHIP with empty hands');
        var want = ctx.order[st.shipped.length];
        var got = st.held;
        got.line = i;
        if (!want) {
          st.shipped.push(got); st.held = null;
          return fault(st, i, 'Order already filled, but Servo shipped another cell (' + describeCell(got) + ')');
        }
        if (want.c !== got.c || want.q !== got.q) {
          st.shipped.push(got); st.held = null;
          return fault(st, i, 'Wrong cell: shipped ' + describeCell(got) + ', the order wants ' + describeCell(want));
        }
        st.shipped.push(got);
        st.held = null;
        ev.cell = got.id; ev.q = got.q;
        return st;
      case 'SCRAP':
        if (!st.held) return fault(st, i, 'SCRAP with empty hands');
        st.held.line = i;
        ev.cell = st.held.id;
        st.scrapped.push(st.held);
        st.held = null;
        return st;
      case 'PAINT':
        if (!st.held) return fault(st, i, 'PAINT with empty hands');
        st.held.c = line.arg;
        return st;
      case 'CHARGE':
        if (!st.held) return fault(st, i, 'CHARGE with empty hands');
        st.held.q = Math.min(9, st.held.q + 1);
        return st;
      case 'DRAIN':
        if (!st.held) return fault(st, i, 'DRAIN with empty hands');
        st.held.q = Math.max(0, st.held.q - 1);
        return st;
    }
    return fault(st, i, 'Unknown instruction ' + op);
  }

  function makeCtx(level, program, streamIdx) {
    return { level: level, program: program, compiled: compile(program, level), order: orderFor(level, streamIdx) };
  }

  /** Run one stream to the end. */
  function runStream(level, program, streamIdx) {
    var ctx = makeCtx(level, program, streamIdx);
    if (!ctx.compiled.ok) return { status: 'fault', msg: ctx.compiled.errors[0].msg, line: ctx.compiled.errors[0].line, cycles: 0, stream: streamIdx };
    var st = initState(level, streamIdx);
    while (st.status === 'run') st = step(ctx, st);
    return { status: st.status, msg: st.msg, line: st.line, cycles: st.cycles, stream: streamIdx, state: st };
  }

  /** Run every stream; the contract clears only if all of them win. */
  function evaluate(level, program) {
    var results = [], total = 0, ok = true, firstFail = -1;
    for (var s = 0; s < level.streams.length; s++) {
      var r = runStream(level, program, s);
      results.push(r);
      total += r.cycles;
      if (r.status !== 'win') { ok = false; if (firstFail < 0) firstFail = s; }
    }
    var size = programSize(program);
    var limitOk = !level.limit || size <= level.limit;
    return {
      cleared: ok && limitOk,
      limitOk: limitOk,
      results: results,
      firstFail: firstFail,
      size: size,
      cycles: total
    };
  }

  // par cycles come from the reference solution
  LEVELS.forEach(function (lv) {
    var ev = evaluate(lv, lv.referenceProgram);
    lv.parCycles = ev.cycles;
  });

  return {
    COLORS: COLORS,
    STATION_NAMES: STATION_NAMES,
    OP_STATION: OP_STATION,
    ACTION_OPS: ACTION_OPS,
    LEVELS: LEVELS,
    argOptions: argOptions,
    defaultArg: defaultArg,
    cycleArg: cycleArg,
    argLabel: argLabel,
    lineText: lineText,
    compile: compile,
    programSize: programSize,
    blockSpan: blockSpan,
    indents: indents,
    initState: initState,
    orderFor: orderFor,
    makeCtx: makeCtx,
    step: step,
    runStream: runStream,
    evaluate: evaluate,
    parseProgram: P
  };
});
