/*
 * Overshift editor view: the program, palette and transport, drawn with DOM for crisp
 * text and touch. It never owns state: render(viewModel) draws a snapshot from the host,
 * and every tap becomes an action passed to dispatch().
 */
(function (root) {
  'use strict';
  var KIND = { GRAB: 'act', SHIP: 'act', SCRAP: 'act', PAINT: 'act', CHARGE: 'act', DRAIN: 'act', LOOP: 'flow', IF: 'flow', ELSE: 'flow', END: 'flow' };
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
      '  <div class="ed-title"></div>' +
      '  <button class="ed-icon" data-act="undo" title="Undo (Y)">↶</button>' +
      '  <button class="ed-icon" data-act="redo" title="Redo (L1+Y)">↷</button>' +
      '  <button class="ed-icon ed-snd" data-act="mute" title="Sound (S)">♪</button>' +
      '</header>' +
      '<div class="ed-main">' +
      '  <div class="ed-prog"></div>' +
      '  <div class="ed-side">' +
      '    <div class="ed-size"></div>' +
      '    <div class="ed-pal"></div>' +
      '    <div class="ed-held"></div>' +
      '  </div>' +
      '</div>' +
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
      snd: this.el.querySelector('.ed-snd')
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
  };

  Editor.prototype.bind = function () {
    var self = this, down = null;
    // never let taps take keyboard focus (gamepad input stays with the game)
    this.el.addEventListener('mousedown', function (e) { e.preventDefault(); });
    this.el.addEventListener('pointerdown', function (e) {
      down = { x: e.clientX, y: e.clientY, t: Date.now(), target: e.target };
    });
    this.el.addEventListener('pointercancel', function () { down = null; });
    this.el.addEventListener('pointerup', function (e) {
      if (!down) return;
      var dx = e.clientX - down.x, dy = e.clientY - down.y;
      var start = down.target; down = null;
      var row = start.closest && start.closest('.row');
      // swipe a line left to delete it
      if (row && dx < -60 && Math.abs(dy) < 40 && row.dataset.i >= 0) { self.dispatch({ type: 'delete', i: +row.dataset.i }); return; }
      if (Math.abs(dx) > 12 || Math.abs(dy) > 12) return; // a scroll, not a tap
      var t = start.closest && start.closest('[data-act],[data-pal],[data-cycle],[data-tool],.row');
      if (!t) return;
      if (t.dataset.act) { self.dispatch({ type: t.dataset.act }); return; }
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

    q.title.innerHTML = '<b>' + pad2(lv.index + 1) + '</b> ' + esc(lv.name);
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
    if (!vm.program.length) html += '<div class="ed-empty">Pick an instruction from the palette. It goes in below the cursor.</div>';
    q.prog.innerHTML = html;

    // palette
    var pal = '';
    for (var p = 0; p < lv.palette.length; p++) {
      var op = lv.palette[p];
      pal += '<button class="tile k-' + KIND[op] + (p === vm.paletteIdx ? ' sel' : '') + '" data-pal="' + p + '">' + op + '</button>';
    }
    q.pal.innerHTML = pal;
    q.held.innerHTML = heldHtml(vm.held);

    // message line
    var msg, kind = '';
    if (vm.flash) { msg = vm.flash.msg; kind = vm.flash.kind; }
    else if (vm.errors.length) { msg = 'Line ' + (vm.errors[0].line + 1) + ': ' + vm.errors[0].msg; kind = 'warn'; }
    else if (vm.mode === 'edit') msg = 'Tap a tile to add it below the cursor. Tap a value to change it.';
    else if (vm.mode === 'pause') msg = 'Paused. Step, Back or Run.';
    else if (vm.mode === 'done' && vm.status === 'win') { msg = 'Order filled.'; kind = 'ok'; }
    else msg = 'Running stream ' + (vm.stream + 1) + '…';
    q.msg.className = 'ed-msg ' + kind;
    q.msg.textContent = msg;

    // keep the interesting line in view
    var focus = q.prog.querySelector('.lit, .faulted') || q.prog.querySelector('.cursor');
    if (focus) {
      var top = focus.offsetTop - q.prog.offsetTop, bottom = top + focus.offsetHeight;
      if (top < q.prog.scrollTop) q.prog.scrollTop = top - 4;
      else if (bottom > q.prog.scrollTop + q.prog.clientHeight) q.prog.scrollTop = bottom - q.prog.clientHeight + 4;
    }
  };

  root.OvershiftEditor = Editor;
})(typeof self !== 'undefined' ? self : this);
