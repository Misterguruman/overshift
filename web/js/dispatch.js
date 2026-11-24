/*
 * Overshift Dispatch (First Routes): customer orders, depot stock and delivery trucks you program.
 * Pure logic, no DOM, like core.js and floor.js. Runs in the browser (window.OvershiftDispatch)
 * and in node.
 *
 * A truck runs its program once per trip, starting at the depot with the order at the head of the
 * board in hand, the way a node runs once per cell. When the program ends the truck drives back to
 * the depot and the next trip starts with the new head order, so the board does the looping.
 *
 * Time is in ticks. Every instruction costs 1 tick; DRIVE costs 1 plus the road between the two
 * places, WAIT n costs n. With two trucks the one with the earlier clock always acts first, so the
 * shared board and stock change in time order. A contract's Cycles are the tick of its last delivery.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.OvershiftDispatch = factory(root.OvershiftCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  var COLORS = C.COLORS;
  var MAX_STEPS = 20000;
  var TRUCK_OPS = ['LOAD', 'NEXT', 'DRIVE', 'DEFER', 'WAIT', 'LOOP', 'IF', 'ELSE', 'END'];
  var DUE_ARGS = [5, 10, 15, 20, 25, 30, 40, 50, 60, 80];
  var WAIT_ARGS = [1, 2, 3, 4, 5, 6, 8, 10];
  var QTY_MAX = 8;
  var LOOP_ARGS = [];
  for (var n = 1; n <= 12; n++) LOOP_ARGS.push(n);

  // ---------- the city ----------
  var PLACES = {
    canal: { name: 'Canal' }, market: { name: 'Market' }, spire: { name: 'Spire' },
    heights: { name: 'Heights' }, docks: { name: 'Docks' }, vents: { name: 'Vents' }
  };
  function placeName(id) { return id === 'depot' ? 'Depot' : (PLACES[id] ? PLACES[id].name : id); }

  /** Road ticks between two places: along one road the gap, across roads back through the depot. */
  function distance(lv, a, b) {
    if (a === b) return 0;
    var pa = a === 'depot' ? null : lv.byDistrict[a], pb = b === 'depot' ? null : lv.byDistrict[b];
    if (!pa) return pb.dist;
    if (!pb) return pa.dist;
    if (pa.road === pb.road) return Math.abs(pa.dist - pb.dist);
    return pa.dist + pb.dist;
  }

  // ---------- instruction values ----------
  function argOptions(op, lv) {
    if (op === 'DRIVE') return lv ? lv.districts.map(function (d) { return d.id; }) : ['canal'];
    if (op === 'WAIT') return WAIT_ARGS;
    if (op === 'LOOP') return LOOP_ARGS;
    if (op === 'IF') return lv ? lv.ifArgs : ['SHORT'];
    return null;
  }
  function defaultArg(op, lv) {
    var o = argOptions(op, lv);
    if (!o) return undefined;
    if (op === 'WAIT') return 2;
    if (op === 'LOOP') return 2;
    return o[0];
  }
  function cycleArg(op, lv, arg, dir) {
    var opts = argOptions(op, lv);
    if (!opts) return arg;
    var i = opts.indexOf(arg);
    i = i < 0 ? 0 : (i + (dir || 1) + opts.length) % opts.length;
    return opts[i];
  }
  function argLabel(op, arg) {
    if (op === 'DRIVE') return placeName(arg);
    if (op === 'WAIT') return arg + (arg === 1 ? ' tick' : ' ticks');
    if (op === 'LOOP') return arg + 'x';
    if (op === 'IF') {
      if (typeof arg !== 'string') return String(arg);
      if (arg.indexOf('to:') === 0) return 'to ' + placeName(arg.slice(3));
      if (arg.indexOf('qty>') === 0) return 'qty > ' + arg.slice(4);
      if (arg.indexOf('due<') === 0) return 'due < ' + arg.slice(4);
      return arg;
    }
    return '';
  }
  function lineText(line) {
    var a = argLabel(line.op, line.arg);
    return a ? line.op + ' ' + a : line.op;
  }

  function compileTruck(program, lv) {
    var cm = C.compile(program);
    for (var i = 0; i < program.length; i++) {
      var ln = program[i], op = ln.op;
      if (TRUCK_OPS.indexOf(op) < 0) cm.errors.push({ line: i, msg: 'A truck can’t run ' + op });
      else if (op === 'LOOP' && LOOP_ARGS.indexOf(ln.arg) < 0) cm.errors.push({ line: i, msg: 'Trucks have no LOOP ' + ln.arg + ': the board does the looping' });
      else if (lv && (op === 'DRIVE' || op === 'IF') && argOptions(op, lv).indexOf(ln.arg) < 0) cm.errors.push({ line: i, msg: lineText(ln) + ' isn’t on this map' });
    }
    cm.errors.sort(function (a, b) { return a.line - b.line; });
    cm.ok = cm.errors.length === 0;
    return cm;
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
  function ri(r, lo, hi) { return lo + Math.floor(r() * (hi - lo + 1)); }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
  function O(d, c, n, due) { return { d: d, c: c, n: n, due: due }; }
  function streams(seed, make) {
    var r = rng(seed), out = [];
    for (var i = 0; i < 5; i++) out.push(make(r, i));
    return out;
  }

  // ---------- the contracts (Dispatch tier 1: First Routes) ----------
  // districts: { id, road, dist } (roads leave the depot; dist is road ticks from it).
  // Each stream: { orders: [O(district, colour, qty, due)], stock: { colour: cells }, refill: [{ c, every }] }.
  // ref: one program per truck.
  var LEVELS = [
    {
      id: 'first-run', name: 'First Run', teaches: 'LOAD and DRIVE: a truck runs once per order',
      brief: 'Deliver every cyan order to Canal Row before it is due.',
      client: 'Canal Row needs cyan cells. Load an order, drive it over, come back for the next.',
      districts: [{ id: 'canal', road: 0, dist: 3 }],
      trucks: 1, cap: 12,
      learned: ['LOAD', 'DRIVE'],
      streams: streams(3101, function (r) {
        var k = ri(r, 3, 6), orders = [];
        for (var i = 0; i < k; i++) orders.push(O('canal', 'cyan', ri(r, 1, 4), 12 + 10 * i));
        return { orders: orders, stock: { cyan: 40 } };
      }),
      ref: ['LOAD; DRIVE canal']
    },
    {
      id: 'two-stops', name: 'Two Stops', teaches: 'Route by district with IF ... ELSE',
      brief: 'Orders for Canal Row and the Market. Send each truckload to the right district.',
      client: 'Two customers now, on two different roads. Read the ticket before you drive.',
      districts: [{ id: 'canal', road: 0, dist: 3 }, { id: 'market', road: 1, dist: 4 }],
      trucks: 1, cap: 12,
      learned: ['LOAD', 'DRIVE', 'IF', 'ELSE'],
      streams: streams(3202, function (r) {
        var k = ri(r, 4, 7), orders = [], t = 0;
        for (var i = 0; i < k; i++) {
          var d = i < 2 ? (i === 0 ? 'canal' : 'market') : pick(r, ['canal', 'market']);
          if (i < 2 && r() < 0.5) d = d === 'canal' ? 'market' : 'canal';
          t += d === 'canal' ? 9 : 11;
          orders.push(O(d, pick(r, ['cyan', 'amber']), ri(r, 1, 5), t + 4));
        }
        return { orders: orders, stock: { cyan: 40, amber: 40 } };
      }),
      ref: ['LOAD; IF to:canal; DRIVE canal; ELSE; DRIVE market; END']
    },
    {
      id: 'full-load', name: 'Full Load', teaches: 'NEXT batches orders: fewer trips, fewer ticks',
      brief: 'Many small orders for the Spire, all due by the same tick. One truck holds 12 cells.',
      client: 'The Spire is a long drive. Do not make it once per order.',
      districts: [{ id: 'spire', road: 0, dist: 10 }],
      trucks: 1, cap: 12,
      learned: ['LOAD', 'DRIVE', 'IF', 'ELSE', 'NEXT', 'LOOP'],
      streams: streams(3303, function (r) {
        var k = ri(r, 8, 12), orders = [], due = 22 + 33 * Math.ceil(k / 4);
        for (var i = 0; i < k; i++) orders.push(O('spire', pick(r, ['cyan', 'lime']), ri(r, 1, 3), due));
        return { orders: orders, stock: { cyan: 40, lime: 40 } };
      }),
      ref: ['LOOP 3; LOAD; NEXT; END; LOAD; DRIVE spire']
    },
    {
      id: 'short-stock', name: 'Short Stock', teaches: 'SHORT and DEFER: skip what you can’t fill yet',
      brief: 'Magenta trickles in, one cell every 2 ticks. Deliver every order before it is due.',
      client: 'Cyan we have. Magenta comes off the line one cell at a time, so don’t wait on it.',
      districts: [{ id: 'canal', road: 0, dist: 3 }],
      trucks: 1, cap: 12,
      learned: ['LOAD', 'DRIVE', 'IF', 'ELSE', 'NEXT', 'LOOP', 'DEFER', 'WAIT'],
      streams: streams(3404, function (r) {
        var k = ri(r, 5, 8), orders = [];
        for (var i = 0; i < k; i++) {
          var mag = i === 0 || (i > 1 && r() < 0.4);
          orders.push(O('canal', mag ? 'magenta' : 'cyan', mag ? ri(r, 4, 6) : ri(r, 1, 4), 0));
        }
        var cyan = orders.filter(function (o) { return o.c === 'cyan'; }).length;
        return { orders: orders, stock: { cyan: 40, magenta: 1 }, refill: [{ c: 'magenta', every: 2 }] };
      }),
      // due = when the reference delivers it, plus this many ticks
      slack: function (o) { return o.c === 'magenta' ? 12 : 4; },
      ref: ['IF SHORT; DEFER; ELSE; LOAD; DRIVE canal; END']
    },
    {
      id: 'rush-hour', name: 'Rush Hour', teaches: 'Urgent orders go direct, the rest wait for a full truck',
      brief: 'The first orders are due almost at once. The rest are due later, all at the same tick.',
      client: 'The Docks shift starts now and they are already short. After that, the usual load.',
      districts: [{ id: 'docks', road: 0, dist: 8 }],
      trucks: 1, cap: 12,
      learned: ['LOAD', 'DRIVE', 'IF', 'ELSE', 'NEXT', 'LOOP', 'DEFER', 'WAIT'],
      streams: streams(3505, function (r) {
        var u = ri(r, 1, 3), k = ri(r, 8, 11), orders = [];
        for (var i = 0; i < u; i++) orders.push(O('docks', 'amber', ri(r, 2, 6), 18 * i + 13));
        var start = 18 * u, due = start + 28 * Math.ceil(k / 4) + 8;
        for (var j = 0; j < k; j++) orders.push(O('docks', pick(r, ['amber', 'cyan']), ri(r, 1, 3), due));
        return { orders: orders, stock: { amber: 60, cyan: 40 } };
      }),
      ref: ['IF due<15; LOAD; DRIVE docks; ELSE; LOOP 3; LOAD; NEXT; END; LOAD; DRIVE docks; END']
    },
    {
      id: 'one-road', name: 'One Road', teaches: 'Several DRIVEs in one trip: drop as you go',
      brief: 'Canal Row, the Market and the Heights sit along one road. Everything is due by the same tick.',
      client: 'One road out to the Heights, with stops along the way. Fill the truck and drop as you go.',
      districts: [{ id: 'canal', road: 0, dist: 2 }, { id: 'market', road: 0, dist: 5 }, { id: 'heights', road: 0, dist: 9 }],
      trucks: 1, cap: 12,
      learned: ['LOAD', 'DRIVE', 'IF', 'ELSE', 'NEXT', 'LOOP', 'DEFER', 'WAIT'],
      streams: streams(3606, function (r) {
        var k = ri(r, 8, 12), orders = [], due = 33 * Math.ceil(k / 4) + 6;
        for (var i = 0; i < k; i++) orders.push(O(pick(r, ['canal', 'market', 'heights']), pick(r, ['cyan', 'magenta', 'lime']), ri(r, 1, 3), due));
        return { orders: orders, stock: { cyan: 40, magenta: 40, lime: 40 } };
      }),
      ref: ['LOOP 3; LOAD; NEXT; END; LOAD; DRIVE canal; DRIVE market; DRIVE heights']
    },
    {
      id: 'two-trucks', name: 'Two Trucks', teaches: 'Two trucks share one board',
      brief: 'Two trucks, one board, Canal Row and the Market far apart. One truck alone runs late.',
      client: 'We got you a second truck. Each one has its own program; they take orders from the same board.',
      districts: [{ id: 'canal', road: 0, dist: 6 }, { id: 'market', road: 1, dist: 7 }],
      trucks: 2, cap: 12,
      learned: ['LOAD', 'DRIVE', 'IF', 'ELSE', 'NEXT', 'LOOP', 'DEFER', 'WAIT'],
      streams: streams(3707, function (r) {
        var k = ri(r, 6, 10), orders = [];
        for (var i = 0; i < k; i++) {
          var d = pick(r, ['canal', 'market']);
          orders.push(O(d, pick(r, ['cyan', 'amber', 'lime']), ri(r, 1, 6), 0));
        }
        orders.forEach(function (o, i) { o.due = 17 * Math.floor(i / 2) + 16; });
        return { orders: orders, stock: { cyan: 40, amber: 40, lime: 40 } };
      }),
      ref: ['LOAD; IF to:canal; DRIVE canal; ELSE; DRIVE market; END', 'LOAD; IF to:canal; DRIVE canal; ELSE; DRIVE market; END']
    },
    {
      id: 'standing-orders', name: 'Standing Orders', teaches: 'Everything at once',
      brief: 'Two trucks, three districts, magenta on a slow line and a few rush orders. Deliver everything on time.',
      client: 'Our regular customers, all of them, on a normal night. Keep the trucks moving.',
      districts: [{ id: 'canal', road: 0, dist: 3 }, { id: 'heights', road: 0, dist: 7 }, { id: 'market', road: 1, dist: 4 }],
      trucks: 2, cap: 12,
      learned: ['LOAD', 'DRIVE', 'IF', 'ELSE', 'NEXT', 'LOOP', 'DEFER', 'WAIT'],
      streams: streams(3808, function (r) {
        var k = ri(r, 8, 12), orders = [];
        for (var i = 0; i < k; i++) {
          var mag = i === 0 || r() < 0.3;
          orders.push(O(pick(r, ['canal', 'heights', 'market']), mag ? 'magenta' : pick(r, ['cyan', 'lime']), mag ? ri(r, 3, 5) : ri(r, 1, 4), 0));
        }
        return { orders: orders, stock: { cyan: 30, lime: 30, magenta: 2 }, refill: [{ c: 'magenta', every: 3 }] };
      }),
      slack: function (o) { return o.c === 'magenta' ? 14 : 5; },
      ref: ['IF SHORT; DEFER; ELSE; LOAD; IF to:market; DRIVE market; ELSE; DRIVE canal; DRIVE heights; END; END',
            'IF SHORT; DEFER; ELSE; LOAD; IF to:market; DRIVE market; ELSE; DRIVE canal; DRIVE heights; END; END']
    }
  ];

  function prepare(lv, i, base) {
    lv.chapter = 3;
    lv.kind = 'truck';
    lv.num = i + 1;
    lv.index = base + i;
    lv.code = '3-' + ('0' + lv.num).slice(-2);
    lv.byDistrict = {};
    lv.districts.forEach(function (d) { d.name = placeName(d.id); lv.byDistrict[d.id] = d; });
    var colors = {};
    lv.streams.forEach(function (s, si) {
      s.orders.forEach(function (o, oi) { o.id = lv.id + ':' + si + ':' + oi; colors[o.c] = 1; });
      Object.keys(s.stock).forEach(function (c) { colors[c] = 1; });
      s.refill = (s.refill || []).map(function (f) { return { c: f.c, rate: f.rate !== undefined ? f.rate : 1 / f.every, every: f.every }; });
    });
    lv.colors = COLORS.filter(function (c) { return colors[c]; });
    var ifs = lv.districts.length > 1 ? lv.districts.map(function (d) { return 'to:' + d.id; }) : [];
    ifs = ifs.concat(lv.colors.length > 1 ? lv.colors : []);
    ifs.push('SHORT', 'FULL');
    for (var q = 1; q <= QTY_MAX; q++) ifs.push('qty>' + q);
    DUE_ARGS.forEach(function (d) { ifs.push('due<' + d); });
    lv.ifArgs = ifs;
    lv.palette = lv.learned.slice();
    if (lv.palette.indexOf('LOOP') >= 0 || lv.palette.indexOf('IF') >= 0) lv.palette.push('END');
    lv.visibleStreams = 3;
    lv.limit = 0;
    if (lv.ref) lv.refPrograms = lv.ref.map(function (s) { return C.parseProgram(s); });
  }

  // ---------- simulation ----------
  function orderView(o) { return { id: o.id, d: o.d, c: o.c, n: o.n, due: o.due }; }

  function initState(lv, streamIdx, opts) {
    opts = opts || {};
    var s = opts.stream || lv.streams[streamIdx];
    var fleet = opts.fleet || lv.trucks;
    var orders = s.orders.map(function (o, i) {
      return { id: o.id || ('o' + i), d: o.d, c: o.c, n: o.n, due: o.due, st: 'board', truck: -1, line: -1, at: -1, late: false };
    });
    var stock = {};
    COLORS.forEach(function (c) { stock[c] = (s.stock && s.stock[c]) || 0; });
    var trucks = [];
    for (var k = 0; k < fleet; k++) trucks.push({ pos: 'depot', t: 0, pc: 0, stack: [], hand: -1, load: [], cells: 0, state: 'start', trips: 0, last: -1, from: 'depot' });
    return {
      stream: streamIdx,
      orders: orders,
      board: orders.map(function (o, i) { return i; }),
      stock: stock,
      added: {},
      refill: (s.refill || []).map(function (f) { return { c: f.c, rate: f.rate !== undefined ? f.rate : 1 / f.every }; }),
      trucks: trucks,
      cap: opts.cap || lv.cap,
      now: 0,
      cycles: 0,
      steps: 0,
      delivered: 0, onTime: 0, late: 0, cellsDelivered: 0, cellsLate: 0,
      status: 'run', msg: '',
      line: -1, lineTruck: -1,
      faultOrder: -1,
      event: null
    };
  }

  function cloneState(s) {
    var added = {};
    for (var c in s.added) added[c] = s.added[c];
    var stock = {};
    for (var c2 in s.stock) stock[c2] = s.stock[c2];
    return {
      stream: s.stream,
      orders: s.orders.map(function (o) { return { id: o.id, d: o.d, c: o.c, n: o.n, due: o.due, st: o.st, truck: o.truck, line: o.line, at: o.at, late: o.late }; }),
      board: s.board.slice(),
      stock: stock,
      added: added,
      refill: s.refill,
      trucks: s.trucks.map(function (t) {
        return { pos: t.pos, t: t.t, pc: t.pc, stack: t.stack.map(function (f) { return { start: f.start, remaining: f.remaining }; }), hand: t.hand, load: t.load.slice(), cells: t.cells, state: t.state, trips: t.trips, last: t.last, from: t.from };
      }),
      cap: s.cap,
      now: s.now,
      cycles: s.cycles,
      steps: s.steps,
      delivered: s.delivered, onTime: s.onTime, late: s.late, cellsDelivered: s.cellsDelivered, cellsLate: s.cellsLate,
      status: s.status, msg: s.msg,
      line: -1, lineTruck: -1,
      faultOrder: -1,
      event: null
    };
  }

  function describe(o) { return placeName(o.d) + ' ' + o.c + ' ×' + o.n; }
  function truckName(ctx, k) { return ctx.trucks > 1 || ctx.city ? 'Truck ' + (k + 1) : 'The truck'; }

  function fault(st, msg, k, line, order) {
    st.status = 'fault';
    st.msg = msg;
    if (k !== undefined && k >= 0) { st.lineTruck = k; st.line = line === undefined ? -1 : line; }
    if (order !== undefined) st.faultOrder = order;
    st.event = { type: 'fault', truck: k, line: line };
    return st;
  }

  function refillTo(st, t) {
    for (var i = 0; i < st.refill.length; i++) {
      var f = st.refill[i], want = Math.floor(t * f.rate + 1e-9), have = st.added[f.c] || 0;
      if (want > have) { st.stock[f.c] += want - have; st.added[f.c] = want; }
    }
  }

  function endShift(ctx, st) {
    if (ctx.city) {
      st.status = 'win';
      st.msg = 'Sample hour over: ' + st.onTime + ' orders on time, ' + st.late + ' late.';
      st.event = { type: 'end' };
      return st;
    }
    var left = st.orders.filter(function (o) { return o.st !== 'done'; }).length;
    if (left) return fault(st, left + ' order' + (left > 1 ? 's were' : ' was') + ' never delivered.');
    st.status = 'win';
    st.msg = 'Every order delivered on time.';
    st.event = { type: 'end' };
    return st;
  }

  function testOrder(st, tr, o, arg) {
    if (!o) return false;
    if (arg === 'SHORT') return st.stock[o.c] < o.n;
    if (arg === 'FULL') return tr.cells + o.n > st.cap;
    if (arg.indexOf('to:') === 0) return o.d === arg.slice(3);
    if (arg.indexOf('qty>') === 0) return o.n > parseInt(arg.slice(4), 10);
    if (arg.indexOf('due<') === 0) return o.due - tr.t < parseInt(arg.slice(4), 10);
    return o.c === arg;
  }

  /** The truck that acts next: the earliest clock among trucks still working (ties: lower number). */
  function nextTruck(st) {
    var best = -1;
    for (var k = 0; k < st.trucks.length; k++) {
      var t = st.trucks[k];
      if (t.state === 'parked') continue;
      if (best < 0 || t.t < st.trucks[best].t) best = k;
    }
    return best;
  }

  /** Program for truck k: its own, or the one shared route program in the Ledger. */
  function progFor(ctx, k) { return ctx.programs[ctx.shared ? 0 : k] || []; }

  function endTrip(ctx, st, k) {
    var tr = st.trucks[k];
    if (tr.cells > 0) {
      var o = st.orders[tr.load[0]];
      return fault(st, truckName(ctx, k) + ' finished its program with ' + tr.cells + ' cell' + (tr.cells > 1 ? 's' : '') + ' still loaded (' + describe(o) + '). Every loaded order needs a DRIVE to its district.', k, tr.last, tr.load[0]);
    }
    if (tr.hand >= 0) {
      // an order still in hand, never loaded: it goes back to the head of the board
      var h = st.orders[tr.hand];
      if (h.st === 'hand') { h.st = 'board'; h.truck = -1; st.board.unshift(tr.hand); }
      tr.hand = -1;
    }
    var back = distance(ctx.level, tr.pos, 'depot');
    tr.from = tr.pos;
    tr.t += back;
    tr.pos = 'depot';
    tr.state = 'start';
    tr.pc = 0; tr.stack = [];
    st.event = { type: 'return', truck: k, from: tr.from, to: 'depot', ticks: back };
    return st;
  }

  /** Run one step: one instruction (or a trip start, a return to the depot, or a wait for work) of the earliest truck. */
  function step(ctx, prev) {
    if (prev.status !== 'run') return prev;
    var st = cloneState(prev), lv = ctx.level;
    st.steps++;
    if (st.steps > MAX_STEPS) return fault(st, 'Shift overran ' + MAX_STEPS + ' steps. Is a truck waiting on stock that never comes?');
    var k = nextTruck(st);
    if (k < 0) return endShift(ctx, st);
    var tr = st.trucks[k], now = tr.t;
    st.now = now;
    if (ctx.city && now >= ctx.ticks) return endShift(ctx, st);
    refillTo(st, now);
    if (!ctx.city) {
      for (var oi = 0; oi < st.orders.length; oi++) {
        var od = st.orders[oi];
        if (od.st !== 'done' && od.due < now) return fault(st, 'Late: the order ' + describe(od) + ' was due at tick ' + od.due + ' and is still ' + (od.st === 'board' ? 'on the board' : od.st === 'hand' ? 'in a truck’s hand' : 'on a truck') + '.', od.truck, od.truck >= 0 ? st.trucks[od.truck].last : -1, oi);
      }
    }
    var prog = progFor(ctx, k), cm = ctx.compiled[ctx.shared ? 0 : k];

    if (tr.state === 'start') {
      if (!st.board.length) {
        // nothing on the board: wait for another truck to finish or defer, or park when nobody else is out
        var busy = false, soonest = Infinity;
        for (var j = 0; j < st.trucks.length; j++) {
          if (j === k || st.trucks[j].state === 'parked') continue;
          if (st.trucks[j].state !== 'start' || st.trucks[j].hand >= 0) busy = true;
          soonest = Math.min(soonest, st.trucks[j].t);
        }
        if (!busy) { tr.state = 'parked'; st.event = { type: 'park', truck: k }; return st; }
        tr.t = Math.max(now + 1, soonest === Infinity ? now + 1 : soonest);
        st.event = { type: 'idle', truck: k };
        return st;
      }
      tr.hand = st.board.shift();
      st.orders[tr.hand].st = 'hand';
      st.orders[tr.hand].truck = k;
      tr.state = 'run';
      tr.trips++;
      tr.pc = 0; tr.stack = [];
    }

    // fold free control flow
    for (;;) {
      if (tr.pc >= prog.length) return endTrip(ctx, st, k);
      var ln0 = prog[tr.pc];
      if (ln0.op === 'ELSE') { tr.pc = cm.end[cm.open[tr.pc]] + 1; continue; }
      if (ln0.op === 'END') {
        var op0 = cm.open[tr.pc];
        if (prog[op0].op === 'LOOP') {
          var f = tr.stack[tr.stack.length - 1];
          if (f.remaining > 0) {
            f.remaining--;
            st.line = tr.pc; st.lineTruck = k; tr.last = tr.pc;
            tr.pc = op0 + 1;
            tr.t += 1;
            st.event = { type: 'loop', truck: k, line: st.line };
            return st;
          }
          tr.stack.pop();
        }
        tr.pc++;
        continue;
      }
      break;
    }

    var i = tr.pc, line = prog[i], op = line.op;
    var hand = tr.hand >= 0 ? st.orders[tr.hand] : null;
    st.line = i; st.lineTruck = k; tr.last = i;
    tr.pc = i + 1;
    tr.from = tr.pos;
    var name = truckName(ctx, k);
    switch (op) {
      case 'LOOP':
        tr.t += 1;
        tr.stack.push({ start: i, remaining: line.arg - 1 });
        st.event = { type: 'loop', truck: k, line: i };
        return st;
      case 'IF': {
        tr.t += 1;
        var pass = testOrder(st, tr, hand, line.arg);
        if (!pass) tr.pc = cm.els[i] !== undefined ? cm.els[i] + 1 : cm.end[i] + 1;
        st.event = { type: 'if', truck: k, line: i, pass: pass };
        return st;
      }
      case 'LOAD':
        tr.t += 1;
        if (tr.pos !== 'depot') return fault(st, name + ' is at ' + placeName(tr.pos) + '. LOAD only works at the depot.', k, i);
        if (!hand || hand.st === 'loaded') { st.event = { type: 'load', truck: k, line: i, none: true }; return st; }
        if (st.stock[hand.c] < hand.n && ctx.city) {
          // in the city a short order goes back on the board instead of stopping the fleet
          hand.st = 'board'; hand.truck = -1;
          st.board.push(tr.hand);
          tr.hand = -1;
          st.event = { type: 'load', truck: k, line: i, short: true };
          return st;
        }
        if (st.stock[hand.c] < hand.n) return fault(st, 'Short: ' + describe(hand) + ' needs ' + hand.n + ' ' + hand.c + ', the depot has ' + st.stock[hand.c] + '.', k, i, tr.hand);
        if (tr.cells + hand.n > st.cap) return fault(st, 'Full: ' + name + ' has ' + tr.cells + ' of ' + st.cap + ' cells loaded, and ' + describe(hand) + ' won’t fit.', k, i, tr.hand);
        st.stock[hand.c] -= hand.n;
        hand.st = 'loaded';
        tr.load.push(tr.hand);
        tr.cells += hand.n;
        st.event = { type: 'load', truck: k, line: i, order: hand.id, c: hand.c, n: hand.n };
        return st;
      case 'NEXT':
        tr.t += 1;
        if (hand && hand.st !== 'loaded') return fault(st, 'NEXT with an order in hand that isn’t loaded (' + describe(hand) + '). LOAD it or DEFER it first.', k, i, tr.hand);
        if (!st.board.length) { tr.hand = -1; st.event = { type: 'next', truck: k, line: i, none: true }; return st; }
        tr.hand = st.board.shift();
        st.orders[tr.hand].st = 'hand';
        st.orders[tr.hand].truck = k;
        st.event = { type: 'next', truck: k, line: i, order: st.orders[tr.hand].id };
        return st;
      case 'DEFER':
        tr.t += 1;
        if (!hand) { st.event = { type: 'defer', truck: k, line: i, none: true }; return st; }
        if (hand.st === 'loaded') return fault(st, 'DEFER sends back an order you haven’t loaded. ' + describe(hand) + ' is already on the truck.', k, i, tr.hand);
        hand.st = 'board'; hand.truck = -1;
        st.board.push(tr.hand);
        st.event = { type: 'defer', truck: k, line: i, order: hand.id };
        tr.hand = -1;
        return st;
      case 'WAIT':
        tr.t += line.arg;
        st.event = { type: 'wait', truck: k, line: i, ticks: line.arg };
        return st;
      case 'DRIVE': {
        var to = line.arg, d = distance(lv, tr.pos, to);
        tr.t += 1 + d;
        tr.pos = to;
        var got = [];
        for (var q = tr.load.length - 1; q >= 0; q--) {
          var o = st.orders[tr.load[q]];
          if (o.d !== to) continue;
          o.at = tr.t; o.line = i; o.truck = k;
          if (o.at > o.due) {
            if (!ctx.city) return fault(st, 'Late: ' + describe(o) + ' was due at tick ' + o.due + ' and arrived at tick ' + o.at + '.', k, i, tr.load[q]);
            o.late = true; st.late++; st.cellsLate += o.n;
          } else st.onTime++;
          o.st = 'done';
          st.delivered++;
          st.cellsDelivered += o.n;
          tr.cells -= o.n;
          if (tr.hand === tr.load[q]) tr.hand = -1;
          got.push(o.id);
          tr.load.splice(q, 1);
          if (o.at > st.cycles) st.cycles = o.at;
        }
        st.event = { type: 'drive', truck: k, line: i, from: tr.from, to: to, ticks: 1 + d, delivered: got.reverse() };
        return st;
      }
      case 'ELSE': case 'END':
        break;
    }
    return fault(st, 'Unknown instruction ' + op, k, i);
  }

  function makeCtx(lv, programs, streamIdx, opts) {
    opts = opts || {};
    var shared = !!lv.shared;
    var progs = shared ? [programs[0] || []] : programs;
    return {
      level: lv,
      programs: progs,
      shared: shared,
      city: !!lv.city,
      ticks: lv.ticks || 0,
      trucks: opts.fleet || lv.trucks,
      compiled: progs.map(function (p) { return compileTruck(p || [], lv); })
    };
  }

  /** Problems that stop the trucks from running at all. */
  function check(lv, programs) {
    var errs = [], n = lv.shared ? 1 : lv.trucks;
    for (var k = 0; k < n; k++) {
      var p = programs[k] || [];
      var who = lv.shared ? 'Route' : lv.trucks > 1 ? 'Truck ' + (k + 1) : 'Truck';
      if (!p.length) { errs.push({ truck: k, line: -1, msg: who + ' has no program yet.' }); continue; }
      compileTruck(p, lv).errors.forEach(function (e) { errs.push({ truck: k, line: e.line, msg: who + ' line ' + (e.line + 1) + ': ' + e.msg }); });
    }
    return errs;
  }

  function size(lv, programs) {
    var s = 0, n = lv.shared ? 1 : lv.trucks;
    for (var k = 0; k < n; k++) s += C.programSize(programs[k] || []);
    return s;
  }

  function runStream(lv, programs, streamIdx, opts) {
    var errs = check(lv, programs);
    if (errs.length) return { status: 'fault', msg: errs[0].msg, cycles: 0, stream: streamIdx };
    var ctx = makeCtx(lv, programs, streamIdx, opts), st = initState(lv, streamIdx, opts);
    while (st.status === 'run') st = step(ctx, st);
    return { status: st.status, msg: st.msg, cycles: st.cycles, stream: streamIdx, state: st, truck: st.lineTruck, line: st.line };
  }

  function evaluate(lv, programs) {
    var results = [], total = 0, ok = true, firstFail = -1;
    for (var s = 0; s < lv.streams.length; s++) {
      var r = runStream(lv, programs, s);
      results.push(r);
      total += r.cycles;
      if (r.status !== 'win') { ok = false; if (firstFail < 0) firstFail = s; }
    }
    return { cleared: ok, limitOk: true, results: results, firstFail: firstFail, size: size(lv, programs), cycles: total };
  }

  // ---------- the Ledger's city: one shared route program for the whole fleet ----------
  var CITY_TICKS = 240; // one sample hour
  var CITY = {
    id: 'city-routes', name: 'City Routes', teaches: 'Your fleet works the city’s live board',
    brief: 'One route program for every truck. A sample hour of today’s orders; on-time deliveries pay three times spot.',
    client: 'The city never stops ordering. Whatever your bays make, your trucks can sell for more.',
    districts: [{ id: 'canal', road: 0, dist: 3 }, { id: 'spire', road: 0, dist: 8 }, { id: 'market', road: 1, dist: 4 }, { id: 'heights', road: 2, dist: 6 }],
    trucks: 1, cap: 12, shared: true, city: true, ticks: CITY_TICKS,
    learned: ['LOAD', 'DRIVE', 'IF', 'ELSE', 'NEXT', 'LOOP', 'DEFER', 'WAIT'],
    streams: [{ orders: [], stock: { cyan: 1, magenta: 1, amber: 1, lime: 1 } }]
  };

  /** Days since 1970 in local time: the city's demand mix changes once a real day. */
  function dayNumber(ms) {
    var d = new Date(ms);
    return Math.floor((ms - d.getTimezoneOffset() * 60000) / 86400000);
  }

  /** Today's demand: colour weights (they rotate each day) and which colour each district favours. */
  function cityDemand(day) {
    var r = rng(9000 + day * 7919);
    var w = COLORS.map(function () { return 0.4 + r(); });
    var fav = Math.floor(r() * 4);
    w[fav] += 1.2;
    var sum = w.reduce(function (a, b) { return a + b; }, 0);
    var mix = {};
    COLORS.forEach(function (c, i) { mix[c] = w[i] / sum; });
    var favs = {};
    CITY.districts.forEach(function (d) { favs[d.id] = COLORS[Math.floor(r() * 4)]; });
    return { day: day, mix: mix, favs: favs };
  }

  /**
   * The sample hour's board: orders for about `cellsPerHour` cells (bounded), in the day's mix,
   * due through the hour. Seeded by the day, so the same inputs always give the same sample.
   */
  function cityStream(day, cellsPerHour) {
    var dem = cityDemand(day), r = rng(4242 + day * 104729);
    var target = Math.max(24, Math.min(400, Math.round(cellsPerHour * 1.1)));
    var orders = [], cells = 0;
    while (cells < target && orders.length < 90) {
      var dist = pick(r, CITY.districts).id;
      var c;
      if (r() < 0.35) c = dem.favs[dist];
      else { var x = r(), acc = 0; c = COLORS[3]; for (var i = 0; i < 4; i++) { acc += dem.mix[COLORS[i]]; if (x < acc) { c = COLORS[i]; break; } } }
      var n = ri(r, 1, 6);
      var at = Math.floor(orders.length / Math.max(1, (target / 3.5)) * CITY_TICKS * 0.9);
      orders.push({ id: 'city:' + orders.length, d: dist, c: c, n: n, due: Math.min(CITY_TICKS, at + 25 + ri(r, 0, 40)) });
      cells += n;
    }
    return { orders: orders, stock: {}, demand: dem };
  }

  /**
   * The sample hour's run options from the Ledger's numbers:
   *   supply: { colour: cells per hour } from the bays, day, fleet (trucks), cap (cells per truck).
   * Stock starts with a quarter hour of supply (the warehouse) and refills at the supply rate.
   */
  function cityOpts(inp) {
    var supply = inp.supply || {}, perHour = 0;
    COLORS.forEach(function (c) { perHour += supply[c] || 0; });
    var s = cityStream(inp.day || 0, perHour);
    s.stock = {};
    COLORS.forEach(function (c) { s.stock[c] = Math.floor((supply[c] || 0) / 4); });
    s.refill = COLORS.filter(function (c) { return supply[c] > 0; }).map(function (c) { return { c: c, rate: supply[c] / CITY_TICKS }; });
    return { stream: s, fleet: Math.max(1, inp.fleet || 1), cap: inp.cap || 12 };
  }

  /** Credits one finished sample earns: on-time cells pay twice their spot price on top, late ones half. */
  function cityPay(st, spot) {
    var bonus = 0;
    st.orders.forEach(function (o) {
      if (o.st !== 'done') return;
      bonus += o.n * (spot[o.c] || 1) * (o.late ? 0.5 : 2);
    });
    return Math.round(bonus);
  }

  /**
   * One sample hour of the city with this route program (the whole fleet runs it).
   * inp: { supply, spot: { colour: cr per cell }, day, fleet, cap }.
   * Returns { ok, rate (cr/h), onTime, late, cells, orders, msg, line? }.
   */
  function citySample(program, inp) {
    var o = cityOpts(inp), n = o.stream.orders.length;
    var errs = check(CITY, [program]);
    if (errs.length) return { ok: false, rate: 0, onTime: 0, late: 0, cells: 0, orders: n, msg: errs[0].msg, line: errs[0].line };
    var ctx = makeCtx(CITY, [program], 0, o), st = initState(CITY, 0, o);
    while (st.status === 'run') st = step(ctx, st);
    if (st.status !== 'win') return { ok: false, rate: 0, onTime: st.onTime, late: st.late, cells: st.cellsDelivered, orders: n, msg: st.msg, line: st.line };
    return { ok: true, rate: cityPay(st, inp.spot || {}), onTime: st.onTime, late: st.late, cells: st.cellsDelivered, orders: n, msg: st.msg };
  }

  var BASE = 20; // Night Shift and Junction Floor come first
  LEVELS.forEach(function (lv, i) { prepare(lv, i, BASE); });
  prepare(CITY, 0, BASE);
  CITY.code = 'R';
  CITY.num = 0;
  CITY.chapter = 3;
  CITY.visibleStreams = 1;

  /** Contracts with a slack rule take their due ticks from the reference run: on time with it, late without the trick it teaches. */
  function tuneDues(lv) {
    lv.streams.forEach(function (s, si) {
      s.orders.forEach(function (o) { o.due = 1e9; });
      var r = runStream(lv, lv.refPrograms, si);
      r.state.orders.forEach(function (o, oi) { s.orders[oi].due = Math.ceil(o.at + lv.slack(s.orders[oi])); });
    });
  }

  LEVELS.forEach(function (lv) {
    if (lv.slack) tuneDues(lv);
    var ev = evaluate(lv, lv.refPrograms);
    lv.parSize = ev.size;
    lv.parCycles = ev.cycles;
    lv.refCleared = ev.cleared;
  });

  return {
    TRUCK_OPS: TRUCK_OPS,
    LEVELS: LEVELS,
    CITY: CITY,
    CITY_TICKS: CITY_TICKS,
    PLACES: PLACES,
    placeName: placeName,
    distance: distance,
    argOptions: argOptions,
    defaultArg: defaultArg,
    cycleArg: cycleArg,
    argLabel: argLabel,
    lineText: lineText,
    compileTruck: compileTruck,
    orderView: orderView,
    initState: initState,
    makeCtx: makeCtx,
    step: step,
    check: check,
    size: size,
    runStream: runStream,
    evaluate: evaluate,
    dayNumber: dayNumber,
    cityDemand: cityDemand,
    cityStream: cityStream,
    cityOpts: cityOpts,
    cityPay: cityPay,
    citySample: citySample
  };
});
