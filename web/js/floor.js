/*
 * Overshift chapter 2, Junction Floor: floors, nodes and the floor simulation.
 * Pure logic, no DOM, like core.js. Runs in the browser (window.OvershiftFloor) and in node.
 *
 * The player builds a floor on a walled grid: belts, bridges and nodes from the contract's kit,
 * and writes a short program for each node. One cell is on the floor at a time. A step either
 * releases the next cell onto the intake, moves the cell one tile, or runs one line in the node
 * the cell is in. Cycles: 1 per belt or bridge tile a cell rides, 1 per node line run (LOOP passes
 * and IF tests count, ELSE and the END of an IF are free, as in chapter 1).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.OvershiftFloor = factory(root.OvershiftCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  var COLORS = C.COLORS;
  var DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  var ARROW = '>v<^';
  var DIR_NAME = ['east', 'south', 'west', 'north'];
  var MAX_STEPS = 20000;
  var DOCKS = ['A', 'B', 'C'];

  // ---------- node types ----------
  var NODE_TYPES = {
    splitter: { name: 'Splitter', abbr: 'SPL', router: true, cap: 4, ops: ['SEND', 'LOOP', 'IF', 'ELSE', 'END'] },
    painter: { name: 'Painter', abbr: 'PNT', router: false, cap: 4, ops: ['PAINT', 'LOOP', 'IF', 'ELSE', 'END'] },
    press: { name: 'Press', abbr: 'PRS', router: false, cap: 4, ops: ['CHARGE', 'DRAIN', 'LOOP', 'IF', 'ELSE', 'END'] },
    counter: { name: 'Counter', abbr: 'CNT', router: true, cap: 5, ops: ['SEND', 'TICK', 'CLEAR', 'LOOP', 'IF', 'ELSE', 'END'] }
  };

  var SEND_ARGS = ['left', 'ahead', 'right'];
  var LOOP_ARGS = [];
  for (var n = 1; n <= 12; n++) LOOP_ARGS.push(n);
  LOOP_ARGS.push('charge');
  var CELL_IF = COLORS.slice();
  for (var e = 0; e <= 9; e++) CELL_IF.push('=' + e);
  for (var g = 0; g <= 8; g++) CELL_IF.push('>' + g);
  var COUNT_IF = [];
  for (var e2 = 0; e2 <= 9; e2++) COUNT_IF.push('c=' + e2);
  for (var g2 = 0; g2 <= 8; g2++) COUNT_IF.push('c>' + g2);
  COUNT_IF = COUNT_IF.concat(CELL_IF);

  function argOptions(op, type) {
    if (op === 'SEND') return SEND_ARGS;
    if (op === 'LOOP') return LOOP_ARGS;
    if (op === 'PAINT') return COLORS;
    if (op === 'IF') return type === 'counter' ? COUNT_IF : CELL_IF;
    return null;
  }
  function defaultArg(op, type) {
    if (op === 'SEND') return 'left';
    if (op === 'LOOP') return 2;
    if (op === 'PAINT') return 'cyan';
    if (op === 'IF') return type === 'counter' ? 'c=0' : 'cyan';
    return undefined;
  }
  function cycleArg(op, type, arg, dir) {
    var opts = argOptions(op, type);
    if (!opts) return arg;
    var i = opts.indexOf(arg);
    i = i < 0 ? 0 : (i + (dir || 1) + opts.length) % opts.length;
    return opts[i];
  }
  function argLabel(op, arg) {
    if (op === 'SEND') return arg;
    if (op === 'IF' && typeof arg === 'string' && arg[0] === 'c' && (arg[1] === '=' || arg[1] === '>')) return 'count ' + arg[1] + ' ' + arg.slice(2);
    if (op === 'LOOP' && arg === 'forever') return 'forever';
    return C.argLabel(op, arg);
  }
  function lineText(line) {
    var a = argLabel(line.op, line.arg);
    return a ? line.op + ' ' + a : line.op;
  }

  /** Turn a SEND side into a direction, for a node facing `facing`. */
  function sendDir(facing, side) {
    if (side === 'left') return (facing + 3) % 4;
    if (side === 'right') return (facing + 1) % 4;
    return facing;
  }

  /**
   * Which sides a node can send a cell out of, from its program: a router's SEND sides,
   * or 'ahead' for a tool with any program. Empty means the node is not programmed yet.
   */
  function outputSides(program, type) {
    var out = [];
    if (!program || !program.length) return out;
    if (!NODE_TYPES[type].router) return ['ahead'];
    for (var i = 0; i < program.length; i++) {
      if (program[i].op === 'SEND' && out.indexOf(program[i].arg) < 0) out.push(program[i].arg);
    }
    return SEND_ARGS.filter(function (side) { return out.indexOf(side) >= 0; });
  }

  /** Extra checks on top of the chapter 1 block matching: ops the node type can't run. */
  function compileNode(program, type) {
    var cm = C.compile(program);
    var ops = NODE_TYPES[type].ops;
    for (var i = 0; i < program.length; i++) {
      var op = program[i].op;
      if (ops.indexOf(op) < 0) cm.errors.push({ line: i, msg: 'A ' + NODE_TYPES[type].name + ' can’t run ' + op });
      else if (op === 'LOOP' && program[i].arg === 'forever') cm.errors.push({ line: i, msg: 'Nodes have no LOOP forever: the floor does the looping' });
      else if (op === 'IF' && type !== 'counter' && /^c[=>]/.test(program[i].arg)) cm.errors.push({ line: i, msg: 'Only a Counter has a count to test' });
    }
    cm.errors.sort(function (a, b) { return a.line - b.line; });
    cm.ok = cm.errors.length === 0;
    return cm;
  }

  // ---------- random streams (same generator as chapter 1) ----------
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
  function cell(c, q) { return { c: c, q: q }; }
  function randCell(r, colors, maxQ) {
    colors = colors || COLORS;
    return cell(colors[Math.floor(r() * colors.length)], Math.floor(r() * ((maxQ === undefined ? 9 : maxQ) + 1)));
  }
  /** count cells between lo and hi, retried until accept(cells) holds. */
  function streams(seed, lo, hi, accept, make) {
    var r = rng(seed), out = [];
    while (out.length < 5) {
      var len = lo + Math.floor(r() * (hi - lo + 1)), cells = [];
      for (var i = 0; i < len; i++) cells.push(make ? make(r, i) : randCell(r));
      if (!accept || accept(cells)) out.push(cells);
    }
    return out;
  }
  function has(cells, pred, k) { return cells.filter(pred).length >= (k || 1); }
  function isC(col) { return function (x) { return x.c === col; }; }
  function notC(col) { return function (x) { return x.c !== col; }; }
  function same(x) { return cell(x.c, x.q); }

  // ---------- the contracts (chapter 2: Junction Floor) ----------
  // map: '.' open, '#' wall, 'I' intake, 'A' 'B' 'C' docks, 'R' Recycler, '>' 'v' '<' '^' a fixed old belt.
  // ref: the reference floor drawn over the map: belts '>' 'v' '<' '^', bridge '+', node = kit slot number (1-based);
  // dirs gives each node's facing, progs its program.
  var LEVELS = [
    {
      id: 'two-docks', name: 'Two Docks', teaches: 'Lay belts, place a node, write it',
      brief: 'Cyan cells to Dock A, every other cell to Dock B.',
      client: 'New floor, new rules. Cyan goes to A, the rest to B.',
      tickets: { A: 'cyan cells', B: 'all the others' },
      kit: ['splitter'], bridges: 0, intakeDir: '>',
      map: ['.......',
            '......A',
            'I......',
            '......B',
            '......R'],
      streams: streams(2101, 4, 8, function (s) { return has(s, isC('cyan')) && has(s, notC('cyan')); }),
      order: function (s) { return { A: s.filter(isC('cyan')).map(same), B: s.filter(notC('cyan')).map(same) }; },
      ref: {
        rows: ['.......',
               '...>>>A',
               'I>>1...',
               '...>>>B',
               '......R'],
        dirs: { 1: '>' },
        progs: { 1: 'IF cyan; SEND left; ELSE; SEND right; END' }
      }
    },
    {
      id: 'respray-line', name: 'Respray Line', teaches: 'Tool nodes pass cells on by themselves',
      brief: 'Lime cells to Dock A as they are. Every other cell to Dock B, painted magenta.',
      client: 'Lime is fine as it is. Everything else leaves magenta.',
      tickets: { A: 'lime, as they are', B: 'the rest, painted magenta' },
      kit: ['splitter', 'painter'], bridges: 0, intakeDir: '>',
      map: ['........',
            '.......A',
            'I.......',
            '.......B',
            '.......R'],
      streams: streams(2202, 4, 8, function (s) { return has(s, isC('lime')) && has(s, notC('lime')); }),
      order: function (s) { return { A: s.filter(isC('lime')).map(same), B: s.filter(notC('lime')).map(function (x) { return cell('magenta', x.q); }) }; },
      ref: {
        rows: ['........',
               '..>>>>>A',
               'I>12v...',
               '....>>>B',
               '.......R'],
        dirs: { 1: '>', 2: '>' },
        progs: { 1: 'IF lime; SEND left; ELSE; SEND ahead; END', 2: 'PAINT magenta' }
      }
    },
    {
      id: 'three-way', name: 'Three Way', teaches: 'Chain two simple nodes',
      brief: 'Cyan to Dock A, magenta to Dock B, everything else to Dock C.',
      client: 'Three customers, three docks. Keep them straight.',
      tickets: { A: 'cyan', B: 'magenta', C: 'everything else' },
      kit: ['splitter', 'splitter'], bridges: 0, intakeDir: '>',
      map: ['.......A',
            '.......B',
            'I.......',
            '.......C',
            '.......R'],
      streams: streams(2303, 5, 9, function (s) { return has(s, isC('cyan')) && has(s, isC('magenta')) && has(s, function (x) { return x.c === 'amber' || x.c === 'lime'; }); }),
      order: function (s) {
        return { A: s.filter(isC('cyan')).map(same), B: s.filter(isC('magenta')).map(same), C: s.filter(function (x) { return x.c === 'amber' || x.c === 'lime'; }).map(same) };
      },
      ref: {
        rows: ['..>>>>>A',
               '..^.>>>B',
               'I>1>2...',
               '....>>>C',
               '.......R'],
        dirs: { 1: '>', 2: '>' },
        progs: { 1: 'IF cyan; SEND left; ELSE; SEND ahead; END', 2: 'IF magenta; SEND left; ELSE; SEND right; END' }
      }
    },
    {
      id: 'gauge', name: 'Gauge', teaches: 'Bring any charge to an exact value',
      brief: 'Cells at charge 5 or more to Dock A as they are. The rest to Dock B, at exactly charge 5.',
      client: 'Our rigs take a 5 or better. Top up anything weaker to a clean 5.',
      tickets: { A: 'charge 5 or more, as they are', B: 'the rest, at charge 5' },
      kit: ['splitter', 'press'], bridges: 0, intakeDir: '>',
      map: ['........',
            '.......A',
            'I.......',
            '.......B',
            '.......R'],
      streams: streams(2404, 4, 8, function (s) { return has(s, function (x) { return x.q >= 5; }) && has(s, function (x) { return x.q < 5; }); }),
      order: function (s) {
        return { A: s.filter(function (x) { return x.q >= 5; }).map(same), B: s.filter(function (x) { return x.q < 5; }).map(function (x) { return cell(x.c, 5); }) };
      },
      ref: {
        rows: ['........',
               '..>>>>>A',
               'I>1.....',
               '..>2>>>B',
               '.......R'],
        dirs: { 1: '>', 2: '>' },
        progs: { 1: 'IF >4; SEND left; ELSE; SEND right; END', 2: 'LOOP 5; IF >4; ELSE; CHARGE; END; END' }
      }
    },
    {
      id: 'batch-split', name: 'Batch Split', teaches: 'Nodes remember between cells',
      brief: 'The first 4 cells to Dock A. The rest to Dock B.',
      client: 'First four of each batch are samples. Send them to A.',
      tickets: { A: 'the first 4 cells', B: 'the rest' },
      kit: ['counter'], bridges: 0, intakeDir: '>',
      map: ['.......',
            '......A',
            'I...#..',
            '......B',
            '......R'],
      streams: streams(2505, 5, 9),
      order: function (s) { return { A: s.slice(0, 4).map(same), B: s.slice(4).map(same) }; },
      ref: {
        rows: ['.......',
               '...>>>A',
               'I>>1#..',
               '...>>>B',
               '......R'],
        dirs: { 1: '>' },
        progs: { 1: 'IF c>3; SEND right; ELSE; TICK; SEND left; END' }
      }
    },
    {
      id: 'every-third', name: 'Every Third', teaches: 'CLEAR makes a count repeat',
      brief: 'Every third cell to Dock B for QA. The rest to Dock A.',
      client: 'QA pulls every third cell. Do not skip one.',
      tickets: { A: 'the rest', B: 'every third cell' },
      kit: ['counter', 'splitter'], bridges: 0, intakeDir: '>',
      map: ['#......',
            '......A',
            'I......',
            '......B',
            '#.....R'],
      streams: streams(2606, 4, 9),
      order: function (s) {
        return { A: s.filter(function (x, i) { return (i + 1) % 3 !== 0; }).map(same), B: s.filter(function (x, i) { return (i + 1) % 3 === 0; }).map(same) };
      },
      ref: {
        rows: ['#......',
               '...>>>A',
               'I>>1...',
               '...>>>B',
               '#.....R'],
        dirs: { 1: '>' },
        progs: { 1: 'TICK; IF c=3; CLEAR; SEND right; ELSE; SEND left; END' }
      }
    },
    {
      id: 'crossover', name: 'Crossover', teaches: 'Split, treat each side, merge again',
      brief: 'To Dock A, in arrival order: cyan cells painted magenta and magenta cells painted cyan. The rest to the Recycler.',
      client: 'Swap the colors on the cyan and magenta stock. Bin the rest.',
      tickets: { A: 'cyan as magenta, magenta as cyan' },
      kit: ['splitter', 'splitter', 'painter', 'painter'], bridges: 0, intakeDir: '>',
      map: ['.........',
            '.........',
            '.........',
            'I.......#',
            '........A',
            '........#',
            '....R....'],
      streams: streams(2707, 5, 9, function (s) { return has(s, isC('cyan')) && has(s, isC('magenta')) && has(s, function (x) { return x.c === 'amber' || x.c === 'lime'; }); }),
      order: function (s) {
        return {
          A: s.filter(function (x) { return x.c === 'cyan' || x.c === 'magenta'; }).map(function (x) { return cell(x.c === 'cyan' ? 'magenta' : 'cyan', x.q); })
        };
      },
      ref: {
        rows: ['.........',
               '..>3>>>v.',
               '..^.>4vv.',
               'I>1>2.vv#',
               '....v.>>A',
               '....v...#',
               '....R....'],
        dirs: { 1: '>', 2: '>', 3: '>', 4: '>' },
        progs: {
          1: 'IF cyan; SEND left; ELSE; SEND ahead; END',
          2: 'IF magenta; SEND left; ELSE; SEND right; END',
          3: 'PAINT magenta',
          4: 'PAINT cyan'
        }
      }
    },
    {
      id: 'recirculate', name: 'Recirculate', teaches: 'A belt that loops back is a loop',
      brief: 'Every cell to Dock A at charge 0.',
      client: 'Cold storage again, but your Press is salvage. One line, that is all it holds.',
      tickets: { A: 'every cell, at charge 0' },
      kit: ['splitter', { t: 'press', cap: 1 }], bridges: 0, intakeDir: '>',
      map: ['........',
            '........',
            'I......A',
            '........',
            '.......R'],
      streams: streams(2808, 4, 7, function (s) { return has(s, function (x) { return x.q > 0; }); }),
      order: function (s) { return { A: s.map(function (x) { return cell(x.c, 0); }) }; },
      ref: {
        rows: ['........',
               '.v2<....',
               'I>>1>>>A',
               '........',
               '.......R'],
        dirs: { 1: '>', 2: '<' },
        progs: { 1: 'IF =0; SEND ahead; ELSE; SEND left; END', 2: 'DRAIN' }
      }
    },
    {
      id: 'tight-floor', name: 'Tight Floor', teaches: 'Bridges: one path crosses another',
      brief: 'Amber to Dock A, lime to Dock B, everything else to Dock C. An old scrap line splits the floor.',
      client: 'Mind the old scrap line. It still runs, and nothing you build can sit on it but a bridge.',
      tickets: { A: 'amber', B: 'lime', C: 'everything else' },
      kit: ['splitter', 'splitter'], bridges: 1, intakeDir: '>',
      map: ['A...#v#...',
            '....#v#...',
            'I....v...C',
            '...#.v#...',
            '...#.R#..B'],
      streams: streams(2909, 5, 9, function (s) { return has(s, isC('amber')) && has(s, isC('lime')) && has(s, function (x) { return x.c === 'cyan' || x.c === 'magenta'; }); }),
      order: function (s) {
        return { A: s.filter(isC('amber')).map(same), B: s.filter(isC('lime')).map(same), C: s.filter(function (x) { return x.c === 'cyan' || x.c === 'magenta'; }).map(same) };
      },
      ref: {
        rows: ['A<<.#v#...',
               '..^.#v#...',
               'I>1>>+>2>C',
               '...#.v#v..',
               '...#.R#>>B'],
        dirs: { 1: '>', 2: '>' },
        progs: { 1: 'IF amber; SEND left; ELSE; SEND ahead; END', 2: 'IF lime; SEND right; ELSE; SEND ahead; END' }
      }
    },
    {
      id: 'night-audit', name: 'Night Audit', teaches: 'Filter first, then count',
      brief: 'The first 3 magenta cells to Dock A at charge 9. Every later magenta cell to Dock B, painted cyan. The rest to the Recycler.',
      client: 'Audit wants three magenta at full charge. Any magenta after that ships as cyan.',
      tickets: { A: 'first 3 magenta, at charge 9', B: 'later magenta, painted cyan' },
      kit: ['splitter', 'counter', 'press', 'painter'], bridges: 0, intakeDir: '>',
      map: ['..R.######',
            '.........A',
            'I...######',
            '.........B',
            '....######'],
      streams: streams(3010, 6, 9, function (s) { return has(s, isC('magenta'), 4) && has(s, notC('magenta')); }),
      order: function (s) {
        var m = s.filter(isC('magenta'));
        return { A: m.slice(0, 3).map(function (x) { return cell('magenta', 9); }), B: m.slice(3).map(function (x) { return cell('cyan', x.q); }) };
      },
      ref: {
        rows: ['.>R.######',
               '.^.>3>>>>A',
               'I1>2######',
               '...>4>>>>B',
               '....######'],
        dirs: { 1: '>', 2: '>', 3: '>', 4: '>' },
        progs: {
          1: 'IF magenta; SEND ahead; ELSE; SEND left; END',
          2: 'IF c>2; SEND right; ELSE; TICK; SEND left; END',
          3: 'LOOP 9; CHARGE; END',
          4: 'PAINT cyan'
        }
      }
    }
  ];

  function key(x, y) { return x + ',' + y; }

  function prepare(lv, i) {
    lv.chapter = 2;
    lv.kind = 'floor';
    lv.num = i + 1;
    lv.index = C.LEVELS.length + i;
    lv.H = lv.map.length;
    lv.W = lv.map[0].length;
    lv.docks = [];
    lv.fixedBelts = 0;
    for (var y = 0; y < lv.H; y++) {
      if (lv.map[y].length !== lv.W) throw new Error(lv.id + ': ragged map row ' + y);
      for (var x = 0; x < lv.W; x++) {
        var ch = lv.map[y][x];
        if (ch === 'I') lv.intake = { x: x, y: y, d: ARROW.indexOf(lv.intakeDir) };
        if (DOCKS.indexOf(ch) >= 0) lv.docks.push(ch);
      }
    }
    lv.docks.sort();
    lv.slots = lv.kit.map(function (k) {
      var t = typeof k === 'string' ? k : k.t;
      return { t: t, cap: (typeof k === 'object' && k.cap) || NODE_TYPES[t].cap, salvaged: typeof k === 'object' && !!k.cap };
    });
    var seen = {};
    lv.slots.forEach(function (s) { seen[s.t] = (seen[s.t] || 0) + 1; s.label = NODE_TYPES[s.t].abbr + seen[s.t]; });
    lv.visibleStreams = 3;
    lv.streams.forEach(function (s, si) { s.forEach(function (c, ci) { c.id = lv.id + ':' + si + ':' + ci; }); });
    lv.refFloor = parseFloor(lv, lv.ref);
  }

  /** Build a floor object from rows drawn over the map (used for the reference floors and tests). */
  function parseFloor(lv, ref) {
    var floor = { tiles: {}, progs: lv.slots.map(function () { return []; }) };
    for (var y = 0; y < lv.H; y++) {
      for (var x = 0; x < lv.W; x++) {
        var ch = ref.rows[y][x], base = lv.map[y][x];
        if (ch === base) continue;
        if (ARROW.indexOf(ch) >= 0) floor.tiles[key(x, y)] = { k: 'belt', d: ARROW.indexOf(ch) };
        else if (ch === '+') floor.tiles[key(x, y)] = { k: 'bridge' };
        else if (/[1-9]/.test(ch)) {
          var s = parseInt(ch, 10) - 1;
          floor.tiles[key(x, y)] = { k: 'node', s: s, d: ARROW.indexOf(ref.dirs[ch]) };
        } else throw new Error(lv.id + ': ref row ' + y + ' has ' + ch + ' over ' + base);
      }
    }
    Object.keys(ref.progs || {}).forEach(function (k) { floor.progs[parseInt(k, 10) - 1] = C.parseProgram(ref.progs[k]); });
    return floor;
  }

  // ---------- floor queries ----------
  function fixedTile(lv, x, y) {
    if (x < 0 || y < 0 || x >= lv.W || y >= lv.H) return { k: 'out' };
    var ch = lv.map[y][x];
    if (ch === '.') return { k: 'empty' };
    if (ch === '#') return { k: 'wall' };
    if (ch === 'I') return { k: 'intake' };
    if (ch === 'R') return { k: 'recycler' };
    if (DOCKS.indexOf(ch) >= 0) return { k: 'dock', dock: ch };
    if (ARROW.indexOf(ch) >= 0) return { k: 'belt', d: ARROW.indexOf(ch), fixed: true };
    return { k: 'wall' };
  }
  function tileAt(lv, floor, x, y) {
    var p = floor && floor.tiles[key(x, y)];
    if (p) return p;
    return fixedTile(lv, x, y);
  }
  /** What may go on this tile: 'any' (open floor), 'bridge' (an old fixed belt), or null. */
  function buildable(lv, x, y) {
    var f = fixedTile(lv, x, y);
    if (f.k === 'empty') return 'any';
    if (f.k === 'belt') return 'bridge';
    return null;
  }
  function placedSlots(floor) {
    var out = [];
    for (var k in floor.tiles) if (floor.tiles[k].k === 'node') out.push(floor.tiles[k].s);
    return out.sort(function (a, b) { return a - b; });
  }
  function nodePos(floor, s) {
    for (var k in floor.tiles) {
      var t = floor.tiles[k];
      if (t.k === 'node' && t.s === s) { var p = k.split(','); return { x: +p[0], y: +p[1], d: t.d }; }
    }
    return null;
  }
  function countParts(floor) {
    var n = { belt: 0, bridge: 0, node: 0, total: 0 };
    for (var k in floor.tiles) { n[floor.tiles[k].k]++; n.total++; }
    return n;
  }
  function floorSize(lv, floor) {
    var s = 0;
    placedSlots(floor).forEach(function (i) { s += C.programSize(floor.progs[i] || []); });
    return s;
  }
  function emptyFloor(lv) { return { tiles: {}, progs: lv.slots.map(function () { return []; }) }; }

  // ---------- simulation ----------
  function orderFor(lv, streamIdx) {
    var o = lv.order(lv.streams[streamIdx]), out = {};
    lv.docks.forEach(function (d) { out[d] = o[d] || []; });
    return out;
  }

  function makeCtx(lv, floor, streamIdx) {
    return {
      level: lv,
      floor: floor,
      orders: orderFor(lv, streamIdx),
      compiled: lv.slots.map(function (s, i) { return compileNode(floor.progs[i] || [], s.t); })
    };
  }

  function cloneCell(c) {
    var o = { c: c.c, q: c.q, id: c.id };
    if (c.slot !== undefined) { o.slot = c.slot; o.line = c.line; }
    if (c.dock) o.dock = c.dock;
    return o;
  }

  function initState(lv, streamIdx) {
    var docks = {};
    lv.docks.forEach(function (d) { docks[d] = []; });
    return {
      stream: streamIdx,
      intake: lv.streams[streamIdx].map(cloneCell),
      cell: null, x: -1, y: -1, d: 0,
      node: null,
      mem: lv.slots.map(function () { return 0; }),
      docks: docks,
      scrapped: [],
      cycles: 0, steps: 0,
      status: 'run', msg: '',
      line: -1, lineSlot: -1,
      faultAt: null,
      event: null
    };
  }

  function cloneState(s) {
    var docks = {};
    for (var d in s.docks) docks[d] = s.docks[d].map(cloneCell);
    return {
      stream: s.stream,
      intake: s.intake.map(cloneCell),
      cell: s.cell ? cloneCell(s.cell) : null, x: s.x, y: s.y, d: s.d,
      node: s.node ? { s: s.node.s, pc: s.node.pc, last: s.node.last, stack: s.node.stack.map(function (f) { return { start: f.start, remaining: f.remaining }; }) } : null,
      mem: s.mem.slice(),
      docks: docks,
      scrapped: s.scrapped.map(cloneCell),
      cycles: s.cycles, steps: s.steps,
      status: s.status, msg: s.msg,
      line: -1, lineSlot: -1,
      faultAt: null,
      event: null
    };
  }

  function describe(c) { return c.c + ' ' + c.q; }

  function fault(st, msg, at, slot, line) {
    st.status = 'fault';
    st.msg = msg;
    st.faultAt = at || null;
    if (slot !== undefined && slot >= 0) { st.lineSlot = slot; st.line = line; }
    st.event = { type: 'fault', slot: slot, line: line };
    return st;
  }

  function endShift(ctx, st) {
    var lv = ctx.level;
    for (var i = 0; i < lv.docks.length; i++) {
      var d = lv.docks[i], got = st.docks[d].length, want = ctx.orders[d].length;
      if (got < want) return fault(st, 'Intake empty, but Dock ' + d + ' got ' + got + ' of ' + want + ' cells.');
    }
    st.status = 'win';
    st.msg = 'Every order filled.';
    st.event = { type: 'end' };
    return st;
  }

  function testCell(c, mem, arg) {
    if (COLORS.indexOf(arg) >= 0) return c.c === arg;
    if (arg[0] === 'c') {
      var v = parseInt(arg.slice(2), 10);
      return arg[1] === '=' ? mem === v : mem > v;
    }
    var w = parseInt(arg.slice(1), 10);
    return arg[0] === '=' ? c.q === w : c.q > w;
  }

  /** Run one line of the node the cell is in. Returns 'ran', 'exit' (the cell leaves this step) or 'fault'. */
  function nodeStep(ctx, st) {
    var lv = ctx.level, nd = st.node, slot = lv.slots[nd.s];
    var prog = ctx.floor.progs[nd.s] || [], cm = ctx.compiled[nd.s], c = st.cell;
    var pos = nodePos(ctx.floor, nd.s);
    for (;;) {
      if (nd.pc >= prog.length) {
        if (NODE_TYPES[slot.t].router) {
          fault(st, slot.label + ' finished its program without a SEND, so the cell is stuck.', { x: st.x, y: st.y }, nd.s, nd.last);
          return 'fault';
        }
        c.slot = nd.s; c.line = nd.last;
        st.d = pos.d;
        st.node = null;
        return 'exit';
      }
      var ln = prog[nd.pc];
      if (ln.op === 'ELSE') { nd.pc = cm.end[cm.open[nd.pc]] + 1; continue; }
      if (ln.op === 'END') {
        var o = cm.open[nd.pc];
        if (prog[o].op === 'LOOP') {
          var f = nd.stack[nd.stack.length - 1];
          if (f.remaining > 0) {
            f.remaining--;
            st.line = nd.pc; st.lineSlot = nd.s; nd.last = nd.pc;
            nd.pc = o + 1;
            st.cycles += 1;
            st.event = { type: 'loop', slot: nd.s, line: st.line };
            return 'ran';
          }
          nd.stack.pop();
        }
        nd.pc++;
        continue;
      }
      break;
    }
    var i = nd.pc, line = prog[i], op = line.op;
    st.line = i; st.lineSlot = nd.s; nd.last = i;
    st.cycles += 1;
    switch (op) {
      case 'LOOP': {
        var count = line.arg === 'charge' ? c.q : line.arg;
        if (count === 0) { nd.pc = cm.end[i] + 1; st.event = { type: 'loop', slot: nd.s, line: i, skipped: true }; }
        else { nd.stack.push({ start: i, remaining: count - 1 }); nd.pc = i + 1; st.event = { type: 'loop', slot: nd.s, line: i }; }
        return 'ran';
      }
      case 'IF': {
        var pass = testCell(c, st.mem[nd.s], line.arg);
        nd.pc = pass ? i + 1 : (cm.els[i] !== undefined ? cm.els[i] + 1 : cm.end[i] + 1);
        st.event = { type: 'if', slot: nd.s, line: i, pass: pass };
        return 'ran';
      }
      case 'SEND':
        st.d = sendDir(pos.d, line.arg);
        c.slot = nd.s; c.line = i;
        st.node = null;
        st.event = { type: 'send', slot: nd.s, line: i, side: line.arg };
        return 'ran';
      case 'PAINT': c.c = line.arg; break;
      case 'CHARGE': c.q = Math.min(9, c.q + 1); break;
      case 'DRAIN': c.q = Math.max(0, c.q - 1); break;
      case 'TICK': st.mem[nd.s] = Math.min(9, st.mem[nd.s] + 1); break;
      case 'CLEAR': st.mem[nd.s] = 0; break;
      default:
        fault(st, slot.label + ' can’t run ' + op + '.', { x: st.x, y: st.y }, nd.s, i);
        return 'fault';
    }
    nd.pc = i + 1;
    st.event = { type: op.toLowerCase(), slot: nd.s, line: i, q: c.q };
    return 'ran';
  }

  function move(ctx, st) {
    var lv = ctx.level, nx = st.x + DX[st.d], ny = st.y + DY[st.d];
    var t = tileAt(lv, ctx.floor, nx, ny), at = { x: nx, y: ny }, c = st.cell;
    var where = 'The cell went ' + DIR_NAME[st.d];
    switch (t.k) {
      case 'out': return fault(st, where + ', off the edge of the floor.', { x: st.x, y: st.y });
      case 'empty': return fault(st, where + ' onto an empty tile with no belt.', at);
      case 'wall': return fault(st, where + ' into a wall.', at);
      case 'intake': return fault(st, where + ' into the intake.', at);
      case 'belt':
        if ((st.d + 2) % 4 === t.d) return fault(st, where + ' into the front of a belt. A belt takes cells from its back and sides only.', at);
        st.x = nx; st.y = ny; st.d = t.d; st.cycles += 1;
        st.event = { type: 'ride' };
        return st;
      case 'bridge':
        st.x = nx; st.y = ny; st.cycles += 1;
        st.event = { type: 'ride', bridge: true };
        return st;
      case 'node':
        if (t.d !== st.d) return fault(st, where + ' into the side of ' + lv.slots[t.s].label + '. A node takes cells only from its back.', at);
        st.x = nx; st.y = ny;
        st.node = { s: t.s, pc: 0, stack: [], last: -1 };
        st.event = { type: 'enter', slot: t.s };
        return st;
      case 'dock': {
        var d = t.dock, want = ctx.orders[d][st.docks[d].length];
        c.dock = d;
        st.docks[d].push(c);
        st.cell = null; st.x = nx; st.y = ny;
        if (!want) return fault(st, 'Dock ' + d + '’s order was already filled, but another cell arrived (' + describe(c) + ').', at, c.slot, c.line);
        if (want.c !== c.c || want.q !== c.q) return fault(st, 'Wrong cell at Dock ' + d + ': got ' + describe(c) + ', the order wants ' + describe(want) + '.', at, c.slot, c.line);
        st.event = { type: 'ship', dock: d, q: c.q, cell: c.id };
        return st;
      }
      case 'recycler':
        c.dock = 'R';
        st.scrapped.push(c);
        st.cell = null; st.x = nx; st.y = ny;
        st.event = { type: 'scrap', cell: c.id };
        return st;
    }
    return fault(st, 'The cell hit something unknown.', at);
  }

  /** Run one step. ctx from makeCtx(). Returns a new state. */
  function step(ctx, prev) {
    if (prev.status !== 'run') return prev;
    var st = cloneState(prev), lv = ctx.level;
    st.steps++;
    if (st.steps > MAX_STEPS) return fault(st, 'Shift overran ' + MAX_STEPS + ' steps. Is a belt loop sending a cell round forever?', { x: st.x, y: st.y });
    if (!st.cell) {
      if (!st.intake.length) return endShift(ctx, st);
      st.cell = st.intake.shift();
      st.x = lv.intake.x; st.y = lv.intake.y; st.d = lv.intake.d;
      st.event = { type: 'release', cell: st.cell.id };
      return st;
    }
    if (st.node) {
      var r = nodeStep(ctx, st);
      if (r !== 'exit') return st;
    }
    return move(ctx, st);
  }

  /** Problems that stop a floor from running at all: program errors in placed nodes. */
  function check(lv, floor) {
    var errs = [];
    placedSlots(floor).forEach(function (s) {
      var cm = compileNode(floor.progs[s] || [], lv.slots[s].t);
      cm.errors.forEach(function (e) { errs.push({ slot: s, line: e.line, msg: lv.slots[s].label + ' line ' + (e.line + 1) + ': ' + e.msg }); });
    });
    return errs;
  }

  function runStream(lv, floor, streamIdx) {
    var errs = check(lv, floor);
    if (errs.length) return { status: 'fault', msg: errs[0].msg, cycles: 0, stream: streamIdx };
    var ctx = makeCtx(lv, floor, streamIdx), st = initState(lv, streamIdx);
    while (st.status === 'run') st = step(ctx, st);
    return { status: st.status, msg: st.msg, cycles: st.cycles, stream: streamIdx, state: st };
  }

  function evaluate(lv, floor) {
    var results = [], total = 0, ok = true, firstFail = -1;
    for (var s = 0; s < lv.streams.length; s++) {
      var r = runStream(lv, floor, s);
      results.push(r);
      total += r.cycles;
      if (r.status !== 'win') { ok = false; if (firstFail < 0) firstFail = s; }
    }
    var capOk = placedSlots(floor).every(function (i) { return C.programSize(floor.progs[i] || []) <= lv.slots[i].cap; });
    return {
      cleared: ok && capOk,
      limitOk: capOk,
      results: results,
      firstFail: firstFail,
      size: floorSize(lv, floor),
      cycles: total,
      parts: countParts(floor).total
    };
  }

  LEVELS.forEach(prepare);
  LEVELS.forEach(function (lv) {
    var ev = evaluate(lv, lv.refFloor);
    lv.parSize = ev.size;
    lv.parCycles = ev.cycles;
    lv.parParts = ev.parts;
    lv.refCleared = ev.cleared;
  });

  return {
    NODE_TYPES: NODE_TYPES,
    DX: DX, DY: DY, ARROW: ARROW,
    LEVELS: LEVELS,
    ALL: C.LEVELS.concat(LEVELS),
    argOptions: argOptions,
    defaultArg: defaultArg,
    cycleArg: cycleArg,
    argLabel: argLabel,
    lineText: lineText,
    sendDir: sendDir,
    outputSides: outputSides,
    compileNode: compileNode,
    key: key,
    fixedTile: fixedTile,
    tileAt: tileAt,
    buildable: buildable,
    placedSlots: placedSlots,
    nodePos: nodePos,
    countParts: countParts,
    floorSize: floorSize,
    emptyFloor: emptyFloor,
    parseFloor: parseFloor,
    orderFor: orderFor,
    makeCtx: makeCtx,
    initState: initState,
    step: step,
    check: check,
    runStream: runStream,
    evaluate: evaluate
  };
});
