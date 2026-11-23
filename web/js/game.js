/*
 * Overshift game host: owns all game state (program, editor cursor, simulation history,
 * progress) and turns buttons and UI actions into changes. Exactly one page hosts it
 * (the deck page); the editor view renders snapshots from viewModel().
 */
(function (root) {
  'use strict';
  var C = root.OvershiftCore;
  var SAVE_KEY = 'overshift.save.v1';
  var RUN_INTERVAL = 0.42, FAST_INTERVAL = 0.06, HISTORY_CAP = 4000;

  function loadSave() {
    try {
      var raw = root.localStorage && root.localStorage.getItem(SAVE_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        s.cleared = s.cleared || {}; s.best = s.best || {}; s.programs = s.programs || {};
        return s;
      }
    } catch (e) { /* storage unavailable */ }
    return { current: 0, cleared: {}, best: {}, programs: {} };
  }

  function Game(opts) {
    opts = opts || {};
    this.sfx = opts.sfx || { play: function () {} };
    this.listeners = [];
    this.unlockAll = !!opts.unlockAll;
    this.save = loadSave();
    this.held = {};
    this.aMoved = false;
    this.l1Used = false;
    this.lastStart = 0;
    this.acc = 0;
    this.flashMsg = null;
    this.overlay = null;
    this.boardSel = 0;
    this.version = 0;
    this.selectLevel(Math.min(this.save.current || 0, C.LEVELS.length - 1), true);
    if (!opts.skipBoard) this.overlay = 'board';
    this.boardSel = this.level.index;
  }

  Game.prototype.onChange = function (fn) { this.listeners.push(fn); };
  Game.prototype.changed = function () {
    this.version++;
    for (var i = 0; i < this.listeners.length; i++) this.listeners[i](this);
  };
  Game.prototype.persist = function () {
    try { root.localStorage && root.localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch (e) { /* ignore */ }
  };
  Game.prototype.flash = function (msg, kind) {
    this.flashMsg = { msg: msg, kind: kind || 'info', id: Date.now() };
  };

  // ---------- contracts ----------
  Game.prototype.isUnlocked = function (i) {
    if (this.unlockAll || i === 0) return true;
    return !!this.save.cleared[C.LEVELS[i - 1].id] || !!this.save.cleared[C.LEVELS[i].id];
  };

  Game.prototype.selectLevel = function (i, initial) {
    if (!this.isUnlocked(i)) { this.flash('Clear contract ' + i + ' to open this one.', 'warn'); return; }
    this.level = C.LEVELS[i];
    this.save.current = i;
    var saved = this.save.programs[this.level.id];
    this.program = saved ? JSON.parse(JSON.stringify(saved)) : [];
    this.cursor = this.program.length - 1;
    this.paletteIdx = 0;
    this.undoStack = []; this.redoStack = [];
    this.streamIdx = 0;
    this.revealed = this.level.visibleStreams;
    this.result = null;
    this.overlay = null;
    this.flashMsg = null;
    this.recompile();
    this.reset();
    if (!initial) { this.persist(); this.sfx.play('select'); }
  };

  // ---------- program editing ----------
  Game.prototype.recompile = function () {
    this.compiled = C.compile(this.program, this.level);
    this.ctx = { level: this.level, program: this.program, compiled: this.compiled, order: C.orderFor(this.level, this.streamIdx) };
  };

  Game.prototype.pushUndo = function () {
    this.undoStack.push(JSON.stringify({ p: this.program, c: this.cursor }));
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  };

  Game.prototype.afterEdit = function () {
    this.save.programs[this.level.id] = this.program;
    this.persist();
    this.recompile();
    this.reset();
    this.result = null;
  };

  Game.prototype.ensureEditing = function () {
    if (this.mode !== 'edit') this.reset();
  };

  Game.prototype.insert = function (op) {
    this.ensureEditing();
    if (this.level.palette.indexOf(op) < 0) return;
    var counts = op !== 'END' && op !== 'ELSE';
    if (counts && this.level.limit && C.programSize(this.program) + 1 > this.level.limit) {
      this.flash('This contract allows ' + this.level.limit + ' lines (END and ELSE are free).', 'warn');
      this.sfx.play('deny');
      return;
    }
    this.pushUndo();
    var line = { op: op };
    var d = C.defaultArg(op);
    if (d !== undefined) line.arg = d;
    var pos = this.cursor + 1;
    this.program.splice(pos, 0, line);
    if (op === 'LOOP' || op === 'IF') this.program.splice(pos + 1, 0, { op: 'END' });
    this.cursor = pos;
    this.sfx.play('place');
    this.afterEdit();
  };

  Game.prototype.deleteLine = function (i) {
    this.ensureEditing();
    if (i === undefined) i = this.cursor;
    if (i < 0 || i >= this.program.length) return;
    var p = this.program, op = p[i].op;
    if (op === 'END' && this.compiled.open[i] !== undefined) {
      this.flash('Delete the ' + p[this.compiled.open[i]].op + ' line instead; its END goes with it.', 'warn');
      this.sfx.play('deny');
      return;
    }
    this.pushUndo();
    if (op === 'LOOP' || op === 'IF') {
      var span = C.blockSpan(p, i);
      var a = span[0], b = span[1];
      // unwrap: drop the header, its END and (for IF) its own ELSE; keep the body
      var depth = 0, drop = [a];
      for (var j = a + 1; j <= b; j++) {
        var o = p[j].op;
        if (o === 'LOOP' || o === 'IF') depth++;
        else if (o === 'END') { if (depth === 0) drop.push(j); else depth--; }
        else if (o === 'ELSE' && depth === 0) drop.push(j);
      }
      for (var k = drop.length - 1; k >= 0; k--) p.splice(drop[k], 1);
    } else {
      p.splice(i, 1);
    }
    this.cursor = Math.min(i, p.length - 1);
    if (this.cursor >= 0 && i > 0 && i >= p.length) this.cursor = p.length - 1;
    this.sfx.play('delete');
    this.afterEdit();
  };

  Game.prototype.moveLine = function (i, dy) {
    this.ensureEditing();
    var p = this.program;
    if (i < 0 || i >= p.length) return;
    var op = p[i].op;
    if (op === 'END' || op === 'ELSE') { this.flash('Move the LOOP or IF line; its block moves with it.', 'warn'); return; }
    var span = C.blockSpan(p, i), a = span[0], b = span[1];
    if (dy < 0 && a === 0) return;
    if (dy > 0 && b === p.length - 1) return;
    this.pushUndo();
    var seg = p.splice(a, b - a + 1);
    var at = dy < 0 ? a - 1 : a + 1;
    Array.prototype.splice.apply(p, [at, 0].concat(seg));
    this.cursor = at;
    this.sfx.play('move');
    this.afterEdit();
  };

  Game.prototype.cycleArg = function (i, dir) {
    this.ensureEditing();
    if (i < 0 || i >= this.program.length) return;
    var line = this.program[i];
    if (!C.argOptions(line.op)) return;
    this.pushUndo();
    line.arg = C.cycleArg(line.op, line.arg, dir);
    this.sfx.play('tick');
    this.afterEdit();
  };

  Game.prototype.undo = function () {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify({ p: this.program, c: this.cursor }));
    var s = JSON.parse(this.undoStack.pop());
    this.program = s.p; this.cursor = Math.min(s.c, this.program.length - 1);
    this.sfx.play('tick');
    this.afterEdit();
  };
  Game.prototype.redo = function () {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify({ p: this.program, c: this.cursor }));
    var s = JSON.parse(this.redoStack.pop());
    this.program = s.p; this.cursor = Math.min(s.c, this.program.length - 1);
    this.sfx.play('tick');
    this.afterEdit();
  };

  Game.prototype.viewModelSize = function () { return C.programSize(this.program); };

  Game.prototype.moveCursor = function (dy) {
    var n = this.program.length;
    this.cursor = Math.max(-1, Math.min(n - 1, this.cursor + dy));
  };

  // ---------- running ----------
  Game.prototype.reset = function () {
    this.sim = C.initState(this.level, this.streamIdx);
    this.history = [this.sim];
    this.mode = 'edit';
    this.acc = 0;
    this.traceLine = -1;
    this.inspectIdx = -1;
  };

  Game.prototype.checkProgram = function () {
    if (!this.compiled.ok) {
      var e = this.compiled.errors[0];
      this.cursor = e.line;
      this.flash('Line ' + (e.line + 1) + ': ' + e.msg, 'fault');
      this.sfx.play('deny');
      return false;
    }
    if (!this.program.length) { this.flash('Add some instructions first.', 'warn'); return false; }
    return true;
  };

  Game.prototype.stepOnce = function () {
    var next = C.step(this.ctx, this.sim);
    this.sim = next;
    this.history.push(next);
    if (this.history.length > HISTORY_CAP) this.history.splice(1, 1);
    if (next.event) this.sfx.play(next.event.type, next.event);
    if (next.status !== 'run') this.finish();
  };

  Game.prototype.step = function () {
    if (this.mode === 'done') { this.flash('Shift over. Reset to run it again.', 'info'); return; }
    if (!this.checkProgram()) return;
    this.flashMsg = null;
    this.mode = 'pause';
    this.stepOnce();
  };

  Game.prototype.stepBack = function () {
    if (this.history.length <= 1) return;
    this.history.pop();
    this.sim = this.history[this.history.length - 1];
    this.mode = this.history.length > 1 ? 'pause' : 'pause';
    this.result = null;
    this.overlay = this.overlay === 'cleared' ? null : this.overlay;
    this.sfx.play('back');
  };

  Game.prototype.run = function (fast) {
    if (this.mode === 'done') this.reset();
    if (!this.checkProgram()) return;
    this.flashMsg = null;
    this.mode = fast ? 'fast' : 'run';
  };
  Game.prototype.pause = function () { if (this.mode === 'run' || this.mode === 'fast') this.mode = 'pause'; };

  Game.prototype.tick = function (dt) {
    if (this.mode !== 'run' && this.mode !== 'fast') return false;
    this.acc += dt;
    var interval = this.mode === 'fast' ? FAST_INTERVAL : RUN_INTERVAL;
    var moved = false, guard = 0;
    while (this.acc >= interval && (this.mode === 'run' || this.mode === 'fast') && guard++ < 50) {
      this.acc -= interval;
      this.stepOnce();
      moved = true;
    }
    return moved;
  };

  Game.prototype.finish = function () {
    this.mode = 'done';
    var st = this.sim;
    if (st.status === 'fault') {
      if (st.line >= 0) this.cursor = st.line;
      this.flash(st.msg, 'fault');
      this.sfx.play('fault');
      return;
    }
    var ev = C.evaluate(this.level, this.program);
    this.result = ev;
    if (ev.cleared) {
      var id = this.level.id;
      var firstClear = !this.save.cleared[id];
      this.save.cleared[id] = true;
      var best = this.save.best[id] || {};
      if (best.size === undefined || ev.size < best.size) best.size = ev.size;
      if (best.cycles === undefined || ev.cycles < best.cycles) best.cycles = ev.cycles;
      this.save.best[id] = best;
      this.persist();
      ev.firstClear = firstClear;
      this.overlay = 'cleared';
      this.sfx.play('clear');
      return;
    }
    if (!ev.limitOk) {
      this.flash('Order filled, but the program is ' + ev.size + ' lines and the limit is ' + this.level.limit + '.', 'fault');
      this.sfx.play('fault');
      return;
    }
    var f = ev.results[ev.firstFail];
    if (f.stream >= this.revealed) this.revealed = f.stream + 1;
    var hidden = f.stream >= this.level.visibleStreams ? ' (a hidden test)' : '';
    this.flash('Stream ' + (this.streamIdx + 1) + ' works, but stream ' + (f.stream + 1) + hidden + ' fails: ' + f.msg, 'fault');
    this.sfx.play('fault');
  };

  Game.prototype.setStream = function (i) {
    if (i < 0 || i >= this.revealed || i === this.streamIdx) return;
    this.streamIdx = i;
    this.recompile();
    this.reset();
    this.sfx.play('tick');
  };

  // ---------- trace-back ----------
  Game.prototype.outputCells = function () { return this.sim.shipped.concat(this.sim.scrapped); };
  Game.prototype.traceCell = function (id) {
    var cells = this.outputCells();
    for (var i = 0; i < cells.length; i++) {
      if (cells[i].id === id) {
        this.inspectIdx = i;
        this.traceLine = cells[i].line === undefined ? -1 : cells[i].line;
        if (this.traceLine >= 0) this.cursor = this.traceLine;
        this.sfx.play('tick');
        return;
      }
    }
  };
  Game.prototype.inspect = function (d) {
    var cells = this.outputCells();
    if (!cells.length) return;
    var i = this.inspectIdx < 0 ? (d > 0 ? 0 : cells.length - 1) : (this.inspectIdx + d + cells.length) % cells.length;
    this.inspectIdx = i;
    this.traceLine = -1;
  };

  // ---------- input ----------
  Game.prototype.pickPalette = function (d) {
    var n = this.level.palette.length;
    if (!n) return;
    this.paletteIdx = (this.paletteIdx + d + n) % n;
    this.sfx.play('tick');
  };

  Game.prototype.button = function (b, phase) {
    if (phase === 'down') this.held[b] = true;
    else if (phase === 'up') this.held[b] = false;
    if (this.overlay && b === 'A') this.aArmed = false; // an A that opened or closed a panel never inserts
    var press = phase === 'down' || phase === 'repeat';
    var running = this.mode !== 'edit';

    if (this.overlay === 'board') {
      if (!press) return;
      var n = C.LEVELS.length, cols = 5;
      if (b === 'left') this.boardSel = (this.boardSel + n - 1) % n;
      else if (b === 'right') this.boardSel = (this.boardSel + 1) % n;
      else if (b === 'up' || b === 'down') this.boardSel = (this.boardSel + cols) % n;
      else if (b === 'A' && phase === 'down') this.selectLevel(this.boardSel);
      else if ((b === 'B' || b === 'L3' || b === 'start') && phase === 'down') this.overlay = null;
      return;
    }
    if (this.overlay === 'cleared') {
      if (phase !== 'down') return;
      if (b === 'A') this.nextLevel();
      else if (b === 'B') this.overlay = null;
      else if (b === 'L3') { this.overlay = 'board'; this.boardSel = this.level.index; }
      else if (b === 'select') { this.overlay = null; this.reset(); }
      return;
    }

    // while the deck is actively running, editing buttons do nothing (cursor and palette still move)
    var live = this.mode === 'run' || this.mode === 'fast';
    if (live && (b === 'X' || b === 'A' || b === 'Y')) return;

    switch (b) {
      case 'up': case 'down':
        if (!press) return;
        if (this.held.A && !live) { this.aMoved = true; this.moveLine(this.cursor, b === 'up' ? -1 : 1); }
        else this.moveCursor(b === 'up' ? -1 : 1);
        return;
      case 'left': case 'right':
        // D-pad / left stick left and right pick the operation in the palette
        if (press) this.pickPalette(b === 'left' ? -1 : 1);
        return;
      case 'A':
        if (phase === 'down') { this.aMoved = false; this.aArmed = true; }
        else if (phase === 'up') {
          if (this.aArmed && !this.aMoved) this.insert(this.level.palette[this.paletteIdx]);
          this.aArmed = false;
        }
        return;
      case 'B':
        if (phase !== 'down') return;
        if (running) { this.reset(); this.result = null; this.sfx.play('back'); }
        else this.deleteLine(this.cursor);
        return;
      case 'X':
        if (phase === 'down') this.cycleArg(this.cursor, 1);
        return;
      case 'Y':
        if (phase !== 'down') return;
        if (this.held.L1) { this.l1Used = true; this.redo(); } else this.undo();
        return;
      case 'L1':
        // L1 / R1 change the value on the cursor line (streams while running); L1 is also the redo modifier
        if (phase === 'down') this.l1Used = false;
        else if (phase === 'up' && !this.l1Used) {
          if (running) this.setStream(this.streamIdx - 1);
          else this.cycleArg(this.cursor, -1);
        }
        return;
      case 'R1':
        if (phase !== 'down') return;
        if (running) this.setStream(this.streamIdx + 1);
        else this.cycleArg(this.cursor, 1);
        return;
      case 'L2': if (press) this.stepBack(); return;
      case 'R2': if (press) this.step(); return;
      case 'start': {
        if (phase !== 'down') return;
        var now = Date.now();
        if (now - this.lastStart < 350 && this.mode === 'run') this.mode = 'fast';
        else if (this.mode === 'run' || this.mode === 'fast') this.pause();
        else this.run(false);
        this.lastStart = now;
        return;
      }
      case 'select': if (phase === 'down') { this.reset(); this.result = null; } return;
      case 'L3': if (phase === 'down') { this.overlay = 'board'; this.boardSel = this.level.index; } return;
      case 'R3':
        if (phase === 'down') {
          var cells = this.outputCells();
          if (this.inspectIdx < 0 && cells.length) this.inspectIdx = cells.length - 1;
          if (this.inspectIdx >= 0 && cells[this.inspectIdx]) this.traceCell(cells[this.inspectIdx].id);
        }
        return;
      case 'rsLeft': if (press) this.inspect(-1); return;
      case 'rsRight': if (press) this.inspect(1); return;
    }
  };

  Game.prototype.nextLevel = function () {
    var i = this.level.index + 1;
    if (i < C.LEVELS.length) this.selectLevel(i);
    else { this.overlay = 'board'; this.boardSel = this.level.index; this.flash('That was the last contract in this build.', 'info'); }
  };

  /** UI actions from touch, mouse or a remote editor view. */
  Game.prototype.act = function (a) {
    if (!a || !a.type) return;
    this.sfx.unlock && this.sfx.unlock();
    switch (a.type) {
      case 'btn': this.button(a.b, a.phase); break;
      case 'cursorTo': this.cursor = Math.max(-1, Math.min(this.program.length - 1, a.i)); break;
      case 'palette': this.paletteIdx = a.i; this.insert(this.level.palette[a.i]); break;
      case 'delete': this.deleteLine(a.i); break;
      case 'move': this.moveLine(a.i, a.dy); break;
      case 'cycle': this.cycleArg(a.i, a.dir || 1); break;
      case 'undo': this.undo(); break;
      case 'redo': this.redo(); break;
      case 'step': this.step(); break;
      case 'back': this.stepBack(); break;
      case 'run': if (this.mode === 'run' || this.mode === 'fast') this.pause(); else this.run(false); break;
      case 'fast': this.run(true); if (this.mode === 'pause') this.mode = 'fast'; break;
      case 'reset': this.reset(); this.result = null; break;
      case 'stream': this.setStream(a.i); break;
      case 'board': this.overlay = this.overlay === 'board' ? null : 'board'; this.boardSel = this.level.index; break;
      case 'level': this.selectLevel(a.i); break;
      case 'trace': this.traceCell(a.id); break;
      case 'next': this.nextLevel(); break;
      case 'close': this.overlay = null; break;
      case 'mute': this.sfx.toggle && this.sfx.toggle(); break;
    }
    this.changed();
  };

  /** Plain-data snapshot for the editor view (sent across screens on Android). */
  Game.prototype.viewModel = function () {
    var lv = this.level, sim = this.sim;
    var running = this.mode !== 'edit';
    return {
      v: this.version,
      level: { index: lv.index, name: lv.name, brief: lv.brief, teaches: lv.teaches, limit: lv.limit || 0, parSize: lv.parSize, palette: lv.palette },
      program: this.program,
      indents: C.indents(this.program),
      labels: this.program.map(function (l) { return C.argLabel(l.op, l.arg); }),
      hasArg: this.program.map(function (l) { return !!C.argOptions(l.op); }),
      errors: this.compiled.errors,
      size: C.programSize(this.program),
      cursor: this.cursor,
      paletteIdx: this.paletteIdx,
      mode: this.mode,
      line: running ? sim.line : -1,
      next: running && sim.status === 'run' ? sim.pc : -1,
      status: sim.status,
      held: sim.held ? { c: sim.held.c, q: sim.held.q } : null,
      cycles: sim.cycles,
      stream: this.streamIdx,
      traceLine: this.traceLine,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      canBack: this.history.length > 1,
      flash: this.flashMsg,
      overlay: this.overlay,
      muted: !!(this.sfx.muted)
    };
  };

  root.OvershiftGame = Game;
})(typeof self !== 'undefined' ? self : this);
