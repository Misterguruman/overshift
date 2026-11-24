/*
 * Overshift editor view: the program, palette and transport, drawn with DOM for crisp
 * text and touch. It never owns state: render(viewModel) draws a snapshot from the host,
 * and every tap becomes an action passed to dispatch().
 */
(function (root) {
  'use strict';
  var KIND = { GRAB: 'act', SHIP: 'act', SCRAP: 'act', PAINT: 'act', CHARGE: 'act', DRAIN: 'act', SEND: 'act', TICK: 'act', CLEAR: 'act', LOOP: 'flow', IF: 'flow', ELSE: 'flow', END: 'flow' };
  var ARROWS = ['→', '↓', '←', '↑'];
  var NODE_CLS = { splitter: 'n-spl', painter: 'n-pnt', press: 'n-prs', counter: 'n-cnt' };
  var COLORS = ['cyan', 'magenta', 'amber', 'lime'];

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pad2(n) { return ('0' + n).slice(-2); }

  function Editor(rootEl, dispatch) {
    this.el = rootEl;
    this.dispatch = dispatch;
    this.lastKey = '';
    this.vm = null;
    this.el.classList.add('ed');
    this.el.innerHTML =
      '<header class="ed-head">' +
      '  <button class="ed-icon" data-act="board" title="Contracts (L3)">☰</button>' +
      '  <button class="ed-icon ed-cr" data-act="ledger" title="Ledger (L1 on the contract board)">₵</button>' +
      '  <div class="ed-title"></div>' +
      '  <button class="ed-icon" data-act="undo" title="Undo (Y)">↶</button>' +
      '  <button class="ed-icon" data-act="redo" title="Redo (L1+Y)">↷</button>' +
      '  <button class="ed-icon ed-snd" data-act="mute" title="Sound (S)">♪</button>' +
      '</header>' +
      '<div class="ed-modes"></div>' +
      '<div class="ed-build"><div class="ed-mapbox"><div class="ed-map"></div></div><div class="ed-parts"></div></div>' +
      '<div class="ed-main">' +
      '  <div class="ed-prog"></div>' +
      '  <div class="ed-side">' +
      '    <div class="ed-size"></div>' +
      '    <div class="ed-pal"></div>' +
      '    <div class="ed-held"></div>' +
      '  </div>' +
      '</div>' +
      '<div class="ed-ledger"></div>' +
      '<div class="ed-msg"></div>' +
      '<div class="ed-transport">' +
      '  <button data-act="back"><b>⇤</b><i>Back</i></button>' +
      '  <button data-act="step"><b>⇥</b><i>Step</i></button>' +
      '  <button data-act="run" class="ed-run"><b>▶\uFE0E</b><i>Run</i></button>' +
      '  <button data-act="fast"><b>≫</b><i>Fast</i></button>' +
      '  <button data-act="reset"><b>⟲</b><i>Reset</i></button>' +
      '</div>';
    this.q = {
      title: this.el.querySelector('.ed-title'),
      prog: this.el.querySelector('.ed-prog'),
      size: this.el.querySelector('.ed-size'),
      pal: this.el.querySelector('.ed-pal'),
      held: this.el.querySelector('.ed-held'),
      msg: this.el.querySelector('.ed-msg'),
      run: this.el.querySelector('.ed-run'),
      undo: this.el.querySelector('[data-act=undo]'),
      redo: this.el.querySelector('[data-act=redo]'),
      back: this.el.querySelector('[data-act=back]'),
      snd: this.el.querySelector('.ed-snd'),
      modes: this.el.querySelector('.ed-modes'),
      build: this.el.querySelector('.ed-build'),
      mapbox: this.el.querySelector('.ed-mapbox'),
      map: this.el.querySelector('.ed-map'),
      parts: this.el.querySelector('.ed-parts'),
      main: this.el.querySelector('.ed-main'),
      ledger: this.el.querySelector('.ed-ledger')
    };
    this.bind();
    var self = this;
    if (root.ResizeObserver) new ResizeObserver(function () { self.fit(); }).observe(this.el);
    root.addEventListener('resize', function () { self.fit(); });
    this.fit();
  }

  Editor.prototype.fit = function () {
    var w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    var fs = Math.max(11, Math.min(24, Math.min(h / 21, w / 22)));
    this.el.style.fontSize = fs.toFixed(1) + 'px';
    this.el.classList.toggle('ed-wide', w / h > 1.45);
    this.layoutMap();
  };

  /** Size the build map to the largest square tiles that fit its box. */
  Editor.prototype.layoutMap = function () {
    var vm = this.vm;
    if (!vm || !vm.floor || vm.floor.fmode !== 'build') return;
    var bw = this.q.mapbox.clientWidth, bh = this.q.mapbox.clientHeight;
    if (!bw || !bh) return;
    var ts = Math.floor(Math.min(bw / vm.floor.W, bh / vm.floor.H));
    this.q.map.style.width = ts * vm.floor.W + 'px';
    this.q.map.style.height = ts * vm.floor.H + 'px';
    this.q.map.style.fontSize = Math.max(8, ts * 0.32).toFixed(1) + 'px';
  };

  Editor.prototype.bind = function () {
    var self = this, down = null, holding = false;
    function endHold() { if (holding) { holding = false; self.dispatch({ type: 'hold', on: false }); } }
    // never let taps take keyboard focus (gamepad input stays with the game)
    this.el.addEventListener('mousedown', function (e) { e.preventDefault(); });
    this.el.addEventListener('pointerdown', function (e) {
      down = { x: e.clientX, y: e.clientY, t: Date.now(), target: e.target };
      // press and hold an upgrade to buy it
      var h = e.target.closest && e.target.closest('[data-hold]');
      if (h) { holding = true; self.dispatch({ type: 'hold', i: +h.dataset.hold, on: true }); }
    });
    this.el.addEventListener('pointercancel', function () { down = null; endHold(); });
    this.el.addEventListener('pointerleave', endHold);
    this.el.addEventListener('pointerup', function (e) {
      if (holding) { endHold(); down = null; return; }
      if (!down) return;
      var dx = e.clientX - down.x, dy = e.clientY - down.y;
      var start = down.target; down = null;
      var row = start.closest && start.closest('.row');
      // swipe a line left to delete it
      if (row && dx < -60 && Math.abs(dy) < 40 && row.dataset.i >= 0) { self.dispatch({ type: 'delete', i: +row.dataset.i }); return; }
      if (Math.abs(dx) > 12 || Math.abs(dy) > 12) return; // a scroll, not a tap
      var t = start.closest && start.closest('[data-act],[data-pal],[data-cycle],[data-tool],[data-tile],[data-part],[data-fmode],[data-tab],[data-ltab],[data-lrow],.row');
      if (!t) return;
      if (t.dataset.act) { self.dispatch({ type: t.dataset.act }); return; }
      if (t.dataset.ltab !== undefined) { self.dispatch({ type: 'ltab', i: +t.dataset.ltab }); return; }
      if (t.dataset.lrow !== undefined) { self.dispatch({ type: 'lrow', i: +t.dataset.lrow }); return; }
      if (t.dataset.tile) { var xy = t.dataset.tile.split(','); self.dispatch({ type: 'tile', x: +xy[0], y: +xy[1] }); return; }
      if (t.dataset.part !== undefined) { self.dispatch({ type: 'part', i: +t.dataset.part }); return; }
      if (t.dataset.fmode) { self.dispatch({ type: 'fmode', m: t.dataset.fmode }); return; }
      if (t.dataset.tab !== undefined) { self.dispatch({ type: 'tab', s: +t.dataset.tab }); return; }
      if (t.dataset.pal !== undefined) { self.dispatch({ type: 'palette', i: +t.dataset.pal }); return; }
      if (t.dataset.cycle !== undefined) { self.dispatch({ type: 'cycle', i: +t.dataset.cycle, dir: 1 }); return; }
      if (t.dataset.tool) {
        var i = +t.dataset.i;
        if (t.dataset.tool === 'up') self.dispatch({ type: 'move', i: i, dy: -1 });
        else if (t.dataset.tool === 'down') self.dispatch({ type: 'move', i: i, dy: 1 });
        else self.dispatch({ type: 'delete', i: i });
        return;
      }
      if (t.classList.contains('row')) self.dispatch({ type: 'cursorTo', i: +t.dataset.i });
    });
  };

  function heldHtml(h) {
    if (!h) return '<span class="ed-lbl">HELD</span><span class="hex hex-empty"></span><span class="ed-dim">empty</span>';
    return '<span class="ed-lbl">HELD</span><span class="hex c-' + h.c + '"><span>' + h.q + '</span></span><span class="c-' + h.c + '-t">' + h.c + ' ' + h.q + '</span>';
  }

  Editor.prototype.render = function (vm) {
    var key = JSON.stringify(vm, function (k, v) { return k === 'v' ? undefined : v; });
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.vm = vm;
    var q = this.q, lv = vm.level;
    var editing = vm.mode === 'edit' || vm.mode === 'done' || vm.mode === 'pause';
    this.el.dataset.mode = vm.mode;
    this.el.classList.toggle('ed-ledgering', !!vm.ledger);
    if (vm.ledger) { this.renderLedger(vm); return; }

    var fl = vm.floor, building = !!fl && fl.fmode === 'build';
    this.el.classList.toggle('ed-floor', !!fl);
    this.el.classList.toggle('ed-building', building);
    q.title.innerHTML = '<b>' + (lv.chapter === 2 ? '2-' + pad2(lv.num) : pad2(lv.index + 1)) + '</b> ' + esc(lv.name);
    if (fl) {
      var act = fl.active >= 0 ? fl.slots[fl.active] : null;
      q.size.innerHTML = act
        ? esc(act.label) + ' <b>' + vm.size + '</b><span class="' + (vm.size > act.cap ? 'bad' : '') + '">/' + act.cap + '</span>' + (act.t === 'counter' ? ' <span class="ed-dim">count ' + act.mem + '</span>' : '') + ' <span class="ed-dim">floor ' + fl.size + '·par ' + fl.parSize + '</span>'
        : 'No node placed yet';
      this.renderModes(vm);
      if (building) this.renderBuild(vm);
    } else
    q.size.innerHTML = 'SIZE <b>' + vm.size + '</b>' + (lv.limit ? ' <span class="' + (vm.size > lv.limit ? 'bad' : '') + '">/ ' + lv.limit + ' max</span>' : '') + ' <span class="ed-dim">par ' + lv.parSize + '</span>';
    q.undo.disabled = !vm.canUndo; q.redo.disabled = !vm.canRedo; q.back.disabled = !vm.canBack;
    q.snd.classList.toggle('off', !!vm.muted);
    var running = vm.mode === 'run' || vm.mode === 'fast';
    q.run.innerHTML = running ? '<b>❚❚</b><i>Pause</i>' : '<b>▶\uFE0E</b><i>Run</i>';

    // program
    var errs = {};
    vm.errors.forEach(function (e) { if (errs[e.line] === undefined) errs[e.line] = e.msg; });
    var html = '<div class="row row-start' + (vm.cursor === -1 ? ' cursor' : '') + '" data-i="-1"><span class="ln">··</span><span class="code ed-dim">shift start</span></div>';
    for (var i = 0; i < vm.program.length; i++) {
      var ln = vm.program[i];
      var cls = 'row k-' + KIND[ln.op];
      if (i === vm.cursor) cls += ' cursor';
      if (i === vm.line) cls += vm.status === 'fault' ? ' faulted' : ' lit';
      if (i === vm.traceLine) cls += ' trace';
      if (errs[i] !== undefined) cls += ' err';
      var arg = '';
      if (vm.hasArg[i]) {
        var colorCls = COLORS.indexOf(ln.arg) >= 0 ? ' c-' + ln.arg + '-t' : '';
        arg = ' <span class="arg' + colorCls + '" data-cycle="' + i + '">' + esc(vm.labels[i]) + '</span>';
      }
      var tools = '';
      if (i === vm.cursor && editing) {
        tools = '<span class="tools"><span data-tool="up" data-i="' + i + '">▲</span><span data-tool="down" data-i="' + i + '">▼</span><span data-tool="del" data-i="' + i + '">✕</span></span>';
      }
      html += '<div class="' + cls + '" data-i="' + i + '"' + (errs[i] ? ' title="' + esc(errs[i]) + '"' : '') + '>' +
        '<span class="ln">' + pad2(i + 1) + '</span>' +
        '<span class="code" style="padding-left:' + (vm.indents[i] * 0.85) + 'em"><span class="op">' + ln.op + '</span>' + arg + '</span>' +
        tools + '</div>';
    }
    if (!vm.program.length) html += '<div class="ed-empty">' + (fl && fl.active < 0 ? 'Place a node in Build mode, then program it here.' : 'Pick an instruction from the palette. It goes in below the cursor.') + '</div>';
    q.prog.innerHTML = html;

    // palette
    var pal = '';
    for (var p = 0; p < lv.palette.length; p++) {
      var op = lv.palette[p];
      pal += '<button class="tile k-' + KIND[op] + (p === vm.paletteIdx ? ' sel' : '') + '" data-pal="' + p + '">' + op + '</button>';
    }
    q.pal.innerHTML = pal;
    q.held.innerHTML = heldHtml(vm.held).replace('HELD', fl ? 'CELL' : 'HELD');

    // message line
    var msg, kind = '';
    if (vm.flash) { msg = vm.flash.msg; kind = vm.flash.kind; }
    else if (vm.errors.length) { msg = 'Line ' + (vm.errors[0].line + 1) + ': ' + vm.errors[0].msg; kind = 'warn'; }
    else if (vm.mode === 'edit' && building) msg = 'Tap a tile to place the part. Tap it again to turn it.';
    else if (vm.mode === 'edit') msg = 'Tap a tile to add it below the cursor. Tap a value to change it.';
    else if (vm.mode === 'pause') msg = 'Paused. Step, Back or Run.';
    else if (vm.mode === 'done' && vm.status === 'win') { msg = 'Order filled.'; kind = 'ok'; }
    else msg = 'Running stream ' + (vm.stream + 1) + '…';
    q.msg.className = 'ed-msg ' + kind;
    q.msg.textContent = msg;

    this.layoutMap();
    // keep the interesting line in view
    var focus = q.prog.querySelector('.lit, .faulted') || q.prog.querySelector('.cursor');
    if (focus) {
      var top = focus.offsetTop - q.prog.offsetTop, bottom = top + focus.offsetHeight;
      if (top < q.prog.scrollTop) q.prog.scrollTop = top - 4;
      else if (bottom > q.prog.scrollTop + q.prog.clientHeight) q.prog.scrollTop = bottom - q.prog.clientHeight + 4;
    }
  };

  Editor.prototype.renderModes = function (vm) {
    var fl = vm.floor, html = '';
    html += '<button class="md' + (fl.fmode === 'build' ? ' on' : '') + '" data-fmode="build">Build</button>';
    html += '<button class="md' + (fl.fmode === 'program' ? ' on' : '') + '" data-fmode="program">Program</button>';
    html += '<span class="md-tabs">';
    fl.slots.forEach(function (s, i) {
      if (!s.placed) return;
      var on = fl.fmode === 'program' && fl.active === i, lit = fl.lineSlot === i;
      html += '<button class="nt ' + NODE_CLS[s.t] + (on ? ' on' : '') + (lit ? ' lit' : '') + '" data-tab="' + i + '">' + esc(s.label) + '</button>';
    });
    html += '</span>';
    this.q.modes.innerHTML = html;
  };

  Editor.prototype.renderBuild = function (vm) {
    var fl = vm.floor, html = '';
    this.q.map.style.gridTemplateColumns = 'repeat(' + fl.W + ', 1fr)';
    for (var y = 0; y < fl.H; y++) {
      for (var x = 0; x < fl.W; x++) {
        var ch = fl.map[y][x], t = fl.tiles[x + ',' + y], cls = 'mt', txt = '';
        if (ch === '#') cls += ' m-wall';
        else if (ch === 'I') { cls += ' m-in'; txt = 'IN'; }
        else if (ch === 'R') { cls += ' m-rcy'; txt = 'R'; }
        else if (/[A-C]/.test(ch)) { cls += ' m-dock'; txt = ch; }
        else if ('>v<^'.indexOf(ch) >= 0 && !t) { cls += ' m-old'; txt = ARROWS['>v<^'.indexOf(ch)]; }
        if (t) {
          if (t.k === 'belt') { cls += ' m-belt'; txt = ARROWS[t.d]; }
          else if (t.k === 'bridge') { cls += ' m-bridge'; txt = '╋'; }
          else if (t.k === 'node') {
            var sl = fl.slots[t.s];
            cls += ' m-node ' + NODE_CLS[sl.t] + (sl.unset ? ' m-unset' : '');
            txt = '<span>' + esc(sl.label) + '</span><b class="m-back m-back' + t.d + '"></b>';
            // an arrow on each side the program sends out of; a "?" until it has a program
            if (sl.unset) txt += '<i class="m-q">?</i>';
            else sl.outs.forEach(function (od) { txt += '<i class="m-out m-out' + od + '">' + ARROWS[od] + '</i>'; });
          }
        }
        if (fl.tc.x === x && fl.tc.y === y) cls += ' m-cur';
        if (fl.cell && fl.cell.x === x && fl.cell.y === y) cls += ' m-cell c-' + fl.cell.c + '-t';
        if (fl.faultAt && fl.faultAt.x === x && fl.faultAt.y === y) cls += ' m-fault';
        html += '<div class="' + cls + '" data-tile="' + x + ',' + y + '">' + txt + '</div>';
      }
    }
    this.q.map.innerHTML = html;
    var parts = '';
    fl.parts.forEach(function (p, i) {
      var left = p.left !== undefined ? '<i>' + p.left + '/' + p.total + '</i>' : '';
      parts += '<button class="tile pt' + (p.k === 'node' ? ' ' + NODE_CLS[p.t] : '') + (p.k === 'remove' ? ' pt-rm' : '') + (i === fl.partIdx ? ' sel' : '') + '" data-part="' + i + '">' + esc(p.label) + left + '</button>';
    });
    parts += '<button class="tile pt" data-act="rotate">Turn ' + ARROWS[fl.facing] + '</button>';
    var under = fl.tiles[fl.tc.x + ',' + fl.tc.y];
    if (under && under.k === 'node' && fl.slots[under.s].unset) {
      parts += '<button class="tile pt pt-tip" data-tab="' + under.s + '"><span>? ' + esc(fl.slots[under.s].label) + ' isn’t programmed</span><span>Tap to program it</span></button>';
    }
    parts += '<div class="ed-dim pt-n">Parts ' + fl.parts_n + ' · par ' + fl.parParts + '</div>';
    parts += '<button class="tile pt pt-clr" data-act="clearFloor">Clear floor</button>';
    this.q.parts.innerHTML = parts;
  };

  function fmt(n) { return String(Math.floor(n + 1e-9)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function x2(v) { return '×' + v.toFixed(2); }

  /** The Ledger on the bottom screen: Bays and Upgrades lists, or the Shift report. */
  Editor.prototype.renderLedger = function (vm) {
    var lg = vm.ledger, q = this.q, html = '';
    q.title.innerHTML = '<b>₵</b> ' + fmt(lg.credits) + ' <span class="ed-dim">· ' + fmt(lg.rate) + ' cr/h</span>';
    if (lg.report) {
      var rep = lg.report, welcome = rep.kind === 'welcome';
      html += '<div class="lg-sum">' + (welcome ? 'The Ledger is open. Your clears so far paid <b>' + fmt(rep.total) + ' cr</b>.' : 'Shift report: <b>+' + fmt(rep.total) + ' cr</b> while you were away.') + '</div>';
      html += '<div class="lg-list">';
      rep.rows.forEach(function (r) {
        html += '<div class="lg-row"><span class="lg-code' + (r.floor ? ' fl' : '') + '">' + esc(r.code) + '</span><span class="lg-name">' + esc(r.name) + '</span><span class="lg-val">' + (welcome ? fmt(r.rate) + ' cr/h' : '+' + fmt(r.cr)) + '</span></div>';
      });
      if (!rep.rows.length) html += '<div class="ed-empty">No contract is in a bay yet.</div>';
      html += '</div>';
      html += '<div class="lg-foot"><button class="tile lg-go" data-act="reportClose">A  Continue</button></div>';
      q.ledger.innerHTML = html;
      this.renderLedgerMsg(vm);
      return;
    }
    html += '<div class="lg-tabs">';
    ['Bays', 'Upgrades'].forEach(function (t, i) {
      var on = (i === 0 ? 'bays' : 'upgrades') === lg.tab;
      html += '<button class="md' + (on ? ' on' : '') + '" data-ltab="' + i + '">' + t + '</button>';
    });
    html += '<span class="lg-meta">' + lg.bays + '/' + lg.bayCap + ' bays · ' + lg.shift + 'h shift</span></div>';
    html += '<div class="lg-list">';
    if (lg.tab === 'bays') {
      if (!lg.rows.length) html += '<div class="ed-empty">Clear a contract and it can run in a bay here, earning credits even while the handheld sleeps.</div>';
      lg.rows.forEach(function (r, i) {
        var f = 'speed ' + x2(r.speed) + ' · lean ' + x2(r.lean) + (r.tidy !== null ? ' · tidy ' + x2(r.tidy) : '');
        html += '<div class="lg-row' + (i === lg.sel ? ' sel' : '') + (r.bay >= 0 ? ' in' : '') + '" data-lrow="' + i + '">' +
          '<span class="lg-code' + (r.floor ? ' fl' : '') + '">' + esc(r.code) + '</span>' +
          '<span class="lg-name">' + esc(r.name) + '<i>' + f + '</i></span>' +
          '<span class="lg-val">' + fmt(r.rate) + '<i>cr/h</i></span>' +
          '<span class="lg-bay">' + (r.bay >= 0 ? 'BAY ' + (r.bay + 1) : '—') + '</span></div>';
      });
    } else {
      lg.rows.forEach(function (r, i) {
        var p = lg.hold && lg.hold.i === i ? lg.hold.p : 0;
        html += '<div class="lg-row lg-up' + (i === lg.sel ? ' sel' : '') + (r.afford ? ' ok' : '') + '" data-lrow="' + i + '" data-hold="' + i + '">' +
          '<b class="lg-fill" style="width:' + Math.round(p * 100) + '%"></b>' +
          '<span class="lg-name">' + esc(r.name) + ' <span class="ed-dim">' + r.level + '/' + r.max + '</span><i>' + esc(r.now) + (r.next ? ' → ' + esc(r.next) : ' · top level') + '</i></span>' +
          '<span class="lg-val">' + (r.cost === null ? '—' : fmt(r.cost)) + '<i>' + (r.cost === null ? '' : 'cr') + '</i></span></div>';
      });
    }
    html += '</div>';
    html += lg.tab === 'bays'
      ? '<div class="lg-foot"><button class="tile" data-act="lopen">Start  Open contract</button><button class="tile" data-act="board">B  Contracts</button></div>'
      : '<div class="lg-foot"><span class="ed-dim">Press and hold to buy (hold A).</span><button class="tile" data-act="board">B  Contracts</button></div>';
    q.ledger.innerHTML = html;
    this.renderLedgerMsg(vm);
    var sel = q.ledger.querySelector('.lg-row.sel'), list = q.ledger.querySelector('.lg-list');
    if (sel && list) {
      var top = sel.offsetTop - list.offsetTop, bottom = top + sel.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top - 4;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 4;
    }
  };

  Editor.prototype.renderLedgerMsg = function (vm) {
    var q = this.q, f = vm.flash;
    q.msg.className = 'ed-msg ' + (f ? f.kind : '');
    q.msg.textContent = f ? f.msg : vm.ledger.report ? 'A or tap Continue.' : vm.ledger.tab === 'bays' ? 'Tap a contract, tap again to move it in or out of a bay.' : 'Upgrades grow the business. They never change a contract.';
  };

  root.OvershiftEditor = Editor;
})(typeof self !== 'undefined' ? self : this);
