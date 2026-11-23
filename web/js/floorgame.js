/*
 * Overshift chapter 2 (Junction Floor) host logic. Extends OvershiftGame with the floor:
 * Build mode places belts, bridges and nodes on a tile grid; Program mode edits the
 * program of one placed node with the same editor as chapter 1.
 */
(function (root) {
  'use strict';
  var C = root.OvershiftCore, F = root.OvershiftFloor, G = root.OvershiftGame;
  if (!F || !G) return;
  var P = G.prototype;
  var DX = F.DX, DY = F.DY;
  var DIR_KEYS = { right: 0, down: 1, left: 2, up: 3 };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ---------- setup ----------
  P.setupFloor = function () {
    var lv = this.level, saved = this.save.floors[lv.id];
    var f = saved ? clone(saved) : F.emptyFloor(lv);
    if (!f.tiles) f.tiles = {};
    if (!f.progs) f.progs = [];
    for (var i = 0; i < lv.slots.length; i++) if (!f.progs[i]) f.progs[i] = [];
    this.floor = f;
    this.tc = { x: Math.min(lv.W - 1, lv.intake.x + 1), y: lv.intake.y };
    this.facing = lv.intake.d;
    this.partIdx = 0;
    this.drawing = false;
    this.xUsed = false;
    var placed = F.placedSlots(f);
    this.active = placed.length ? placed[0] : -1;
    this.fmode = 'build';
    this.bindActive();
  };

  P.bindActive = function (cursor) {
    if (this.active >= 0) this.program = this.floor.progs[this.active];
    else this.program = [];
    this.cursor = cursor === undefined ? this.program.length - 1 : Math.max(-1, Math.min(cursor, this.program.length - 1));
    this.paletteIdx = Math.min(this.paletteIdx || 0, Math.max(0, this.nodePalette().length - 1));
  };

  P.activeType = function () { return this.active >= 0 ? this.level.slots[this.active].t : 'splitter'; };
  P.nodePalette = function () { return this.active >= 0 ? F.NODE_TYPES[this.activeType()].ops : []; };
  P.nodeCap = function () { return this.active >= 0 ? this.level.slots[this.active].cap : 0; };

  P.recompileFloor = function () {
    this.compiled = F.compileNode(this.program, this.activeType());
    this.fctx = F.makeCtx(this.level, this.floor, this.streamIdx);
  };

  P.snapFloor = function () {
    return JSON.stringify({ f: this.floor, a: this.active, c: this.cursor, t: this.tc });
  };
  P.restoreFloor = function (s) {
    this.floor = s.f;
    this.active = s.a;
    if (this.active >= 0 && !F.nodePos(this.floor, this.active)) this.active = this.firstPlaced();
    if (s.t) this.tc = s.t;
    this.bindActive(s.c);
  };
  P.firstPlaced = function () { var p = F.placedSlots(this.floor); return p.length ? p[0] : -1; };

  // ---------- build palette ----------
  P.buildParts = function () {
    var lv = this.level, parts = [{ k: 'belt', label: 'Belt' }], seen = {};
    if (lv.bridges) parts.push({ k: 'bridge', label: 'Bridge', total: lv.bridges });
    lv.slots.forEach(function (s) {
      if (seen[s.t]) return;
      seen[s.t] = true;
      parts.push({ k: 'node', t: s.t, label: F.NODE_TYPES[s.t].name });
    });
    parts.push({ k: 'remove', label: 'Remove' });
    var placed = F.placedSlots(this.floor), counts = F.countParts(this.floor);
    parts.forEach(function (p) {
      if (p.k === 'bridge') p.left = lv.bridges - counts.bridge;
      if (p.k === 'node') {
        p.total = lv.slots.filter(function (s) { return s.t === p.t; }).length;
        p.left = lv.slots.filter(function (s, i) { return s.t === p.t && placed.indexOf(i) < 0; }).length;
      }
    });
    return parts;
  };
  P.pickPart = function (d) {
    var n = this.buildParts().length;
    this.partIdx = (this.partIdx + d + n) % n;
    this.sfx.play('tick');
  };

  // ---------- build actions ----------
  P.tileKey = function (x, y) { return F.key(x, y); };

  /** Put the selected part on tile (x, y), facing `d`. Returns true if the floor changed. */
  P.placeAt = function (x, y, d, part, quiet) {
    var lv = this.level, k = F.key(x, y), cur = this.floor.tiles[k];
    var ok = F.buildable(lv, x, y);
    part = part || this.buildParts()[this.partIdx];
    if (part.k === 'remove') return this.removeAt(x, y, quiet);
    var deny = function (self, msg) { if (!quiet) { self.flash(msg, 'warn'); self.sfx.play('deny'); } return false; };
    if (!ok) {
      var f = F.fixedTile(lv, x, y);
      var what = f.k === 'wall' ? 'a wall' : f.k === 'intake' ? 'the intake' : f.k === 'recycler' ? 'the Recycler' : f.k === 'dock' ? 'Dock ' + f.dock : 'that tile';
      return deny(this, 'You can’t build on ' + what + '.');
    }
    if (ok === 'bridge' && part.k !== 'bridge') return deny(this, 'An old scrap line runs here. Only a Bridge can go over it.');
    var next;
    if (part.k === 'belt') {
      if (cur && cur.k === 'belt' && cur.d === d) return false;
      next = { k: 'belt', d: d };
    } else if (part.k === 'bridge') {
      if (cur && cur.k === 'bridge') return false;
      if (part.left <= 0 && !(cur && cur.k === 'bridge')) return deny(this, 'This contract has ' + lv.bridges + ' Bridge' + (lv.bridges > 1 ? 's' : '') + ', and ' + (lv.bridges > 1 ? 'they are' : 'it is') + ' on the floor.');
      next = { k: 'bridge' };
    } else if (part.k === 'node') {
      if (cur && cur.k === 'node' && lv.slots[cur.s].t === part.t) {
        if (cur.d === d) return false;
        next = { k: 'node', s: cur.s, d: d };
      } else {
        var placed = F.placedSlots(this.floor), s = -1;
        for (var i = 0; i < lv.slots.length; i++) if (lv.slots[i].t === part.t && placed.indexOf(i) < 0) { s = i; break; }
        if (s < 0) return deny(this, 'All ' + part.total + ' ' + part.label + (part.total > 1 ? 's are' : ' is') + ' on the floor. Remove one to move it.');
        next = { k: 'node', s: s, d: d };
      }
    } else return false;
    if (!quiet) this.pushUndo();
    this.floor.tiles[k] = next;
    if (next.k === 'node') { this.active = next.s; this.bindActive(); }
    else if (cur && cur.k === 'node' && cur.s === this.active) { this.active = this.firstPlaced(); this.bindActive(); }
    if (!quiet) { this.sfx.play('place'); this.afterEdit(); }
    return true;
  };

  P.removeAt = function (x, y, quiet) {
    var k = F.key(x, y), cur = this.floor.tiles[k];
    if (!cur) {
      if (!quiet && F.fixedTile(this.level, x, y).k !== 'empty') { this.flash('That part is fixed to the floor.', 'warn'); this.sfx.play('deny'); }
      return false;
    }
    if (!quiet) this.pushUndo();
    delete this.floor.tiles[k];
    if (cur.k === 'node' && cur.s === this.active) { this.active = this.firstPlaced(); this.bindActive(); }
    if (!quiet) { this.sfx.play('delete'); this.afterEdit(); }
    return true;
  };

  /** Turn the facing; a player belt or node under the cursor turns with it. */
  P.rotate = function (dir) {
    this.ensureEditing();
    this.facing = (this.facing + (dir || 1) + 4) % 4;
    var t = this.floor.tiles[F.key(this.tc.x, this.tc.y)];
    if (t && (t.k === 'belt' || t.k === 'node')) {
      this.pushUndo();
      t.d = this.facing;
      this.afterEdit();
    }
    this.sfx.play('tick');
  };

  P.moveTile = function (dir) {
    var lv = this.level, nx = this.tc.x + DX[dir], ny = this.tc.y + DY[dir];
    if (nx < 0 || ny < 0 || nx >= lv.W || ny >= lv.H) return;
    if (this.drawing && this.mode === 'edit') {
      if (this.drawUndo) { this.pushUndo(); this.drawUndo = false; }
      // drawing a belt: point the tile we leave toward the move, then lay the next one
      var prev = this.floor.tiles[F.key(this.tc.x, this.tc.y)];
      if (prev && prev.k === 'belt') prev.d = dir;
      this.tc = { x: nx, y: ny };
      this.facing = dir;
      var here = this.floor.tiles[F.key(nx, ny)];
      if (F.buildable(lv, nx, ny) === 'any' && (!here || here.k === 'belt')) this.floor.tiles[F.key(nx, ny)] = { k: 'belt', d: dir };
      this.sfx.play('place');
      this.afterEdit();
      return;
    }
    this.tc = { x: nx, y: ny };
  };

  P.setFmode = function (m) {
    if (m === this.fmode) return;
    if (m === 'program' && this.active < 0) {
      var p = this.firstPlaced();
      if (p < 0) { this.flash('Place a node first, then program it.', 'warn'); this.sfx.play('deny'); return; }
      this.active = p; this.bindActive();
      this.recompile();
    }
    this.fmode = m;
    this.drawing = false;
    this.sfx.play('select');
  };

  P.openNode = function (s) {
    if (!F.nodePos(this.floor, s)) return;
    this.active = s;
    this.fmode = 'program';
    this.bindActive();
    this.recompile();
    this.traceLine = -1;
    this.sfx.play('tick');
  };

  P.switchNode = function (d) {
    var placed = F.placedSlots(this.floor);
    if (!placed.length) return;
    var i = placed.indexOf(this.active);
    i = i < 0 ? 0 : (i + d + placed.length) % placed.length;
    this.openNode(placed[i]);
  };

  // ---------- running ----------
  P.checkFloor = function () {
    var errs = F.check(this.level, this.floor);
    if (errs.length) {
      var e = errs[0];
      this.openNode(e.slot);
      this.cursor = e.line;
      this.flash(e.msg, 'fault');
      this.sfx.play('deny');
      return false;
    }
    if (!F.countParts(this.floor).total) { this.flash('Lay belts from the intake first (Build mode).', 'warn'); return false; }
    return true;
  };

  P.showFloorFault = function (st) {
    if (st.lineSlot >= 0 && F.nodePos(this.floor, st.lineSlot)) {
      if (st.lineSlot !== this.active) { this.active = st.lineSlot; this.bindActive(); this.recompile(); }
      if (st.line >= 0) this.cursor = st.line;
    }
    if (st.faultAt) this.tc = { x: Math.max(0, Math.min(this.level.W - 1, st.faultAt.x)), y: Math.max(0, Math.min(this.level.H - 1, st.faultAt.y)) };
  };

  P.floorOutputs = function () {
    var st = this.sim, out = [];
    this.level.docks.forEach(function (d) { out = out.concat(st.docks[d]); });
    return out.concat(st.scrapped);
  };

  P.traceFloorCell = function (cell) {
    this.sfx.play('tick');
    if (cell.slot === undefined || !F.nodePos(this.floor, cell.slot)) {
      this.traceLine = -1;
      this.flash('That cell rode belts the whole way; no node sent it.', 'info');
      return;
    }
    if (cell.slot !== this.active || this.fmode !== 'program') { this.active = cell.slot; this.fmode = 'program'; this.bindActive(); this.recompile(); }
    this.traceLine = cell.line === undefined ? -1 : cell.line;
    if (this.traceLine >= 0) this.cursor = this.traceLine;
  };

  // ---------- input ----------
  /** Chapter 2 buttons. Returns true when the button was handled here. */
  P.floorButton = function (b, phase, press, live) {
    var editing = this.mode === 'edit';
    if (b === 'L1') {
      // L1 is a modifier in both modes (L1 + d-pad switches nodes, L1 + L3 opens the board, L1 + Y redo)
      if (phase === 'down') this.l1Used = false;
      if (this.fmode === 'build' && phase === 'up' && !this.l1Used) {
        if (this.mode !== 'edit') this.setStream(this.streamIdx - 1);
        else this.pickPart(-1);
      }
      return this.fmode === 'build';
    }
    if (b === 'L3') {
      if (phase !== 'down') return true;
      if (this.held.L1) { this.l1Used = true; this.overlay = 'board'; this.boardSel = this.level.index; return true; }
      this.setFmode(this.fmode === 'build' ? 'program' : 'build');
      return true;
    }
    if (this.fmode === 'program') {
      if ((b === 'left' || b === 'right') && this.held.L1) {
        if (press) { this.l1Used = true; this.switchNode(b === 'left' ? -1 : 1); }
        return true;
      }
      return false;
    }

    // ----- Build mode -----
    switch (b) {
      case 'up': case 'down': case 'left': case 'right':
        if (!press) return true;
        if (this.held.X && (b === 'left' || b === 'right')) { this.xUsed = true; this.pickPart(b === 'left' ? -1 : 1); return true; }
        if (this.held.L1 && (b === 'left' || b === 'right')) { this.l1Used = true; this.switchNode(b === 'left' ? -1 : 1); this.fmode = 'build'; return true; }
        this.moveTile(DIR_KEYS[b]);
        return true;
      case 'A':
        if (phase === 'down') {
          if (live) return true;
          this.ensureEditing();
          var part = this.buildParts()[this.partIdx];
          var changed = this.placeAt(this.tc.x, this.tc.y, this.facing, part);
          var under = this.floor.tiles[F.key(this.tc.x, this.tc.y)];
          // hold A and move to draw a belt line; the first move saves an undo step if A changed nothing
          this.drawing = part.k === 'belt' && !!under && under.k === 'belt';
          this.drawUndo = this.drawing && !changed;
        } else if (phase === 'up') this.drawing = false;
        return true;
      case 'B':
        if (phase !== 'down') return true;
        if (!editing) { this.reset(); this.result = null; this.sfx.play('back'); return true; }
        this.removeAt(this.tc.x, this.tc.y);
        return true;
      case 'X':
        if (phase === 'down') this.xUsed = false;
        else if (phase === 'up' && !this.xUsed && !live) this.rotate(1);
        return true;
      case 'R1':
        if (phase !== 'down') return true;
        if (!editing) this.setStream(this.streamIdx + 1);
        else this.pickPart(1);
        return true;
      case 'Y':
        if (live) return true;
        return false;
    }
    return false;
  };

  P.floorAct = function (a) {
    switch (a.type) {
      case 'tile':
        if (a.x < 0 || a.y < 0 || a.x >= this.level.W || a.y >= this.level.H) return;
        var t = this.floor.tiles[F.key(a.x, a.y)];
        if (this.fmode === 'program') {
          if (t && t.k === 'node') this.openNode(t.s);
          else this.tc = { x: a.x, y: a.y };
          return;
        }
        if (this.mode === 'run' || this.mode === 'fast') { this.tc = { x: a.x, y: a.y }; return; }
        this.ensureEditing();
        var part = this.buildParts()[this.partIdx];
        var same = this.tc.x === a.x && this.tc.y === a.y;
        this.tc = { x: a.x, y: a.y };
        // tapping a belt or node you just placed with the same part turns it
        if (same && t && ((part.k === 'belt' && t.k === 'belt') || (part.k === 'node' && t.k === 'node' && this.level.slots[t.s].t === part.t))) { this.rotate(1); return; }
        this.placeAt(a.x, a.y, this.facing, part);
        return;
      case 'part': this.partIdx = Math.max(0, Math.min(this.buildParts().length - 1, a.i)); this.fmode = 'build'; this.sfx.play('tick'); return;
      case 'rotate': if (this.mode !== 'run' && this.mode !== 'fast') this.rotate(a.dir || 1); return;
      case 'fmode': this.setFmode(a.m); return;
      case 'tab': this.openNode(a.s); return;
      case 'clearFloor':
        if (!F.countParts(this.floor).total) return;
        this.ensureEditing();
        this.pushUndo();
        this.floor.tiles = {};
        this.active = -1; this.bindActive();
        this.sfx.play('delete');
        this.afterEdit();
        return;
    }
  };

  // ---------- view model ----------
  P.floorViewModel = function (vm) {
    var lv = this.level, sim = this.sim, fl = this.floor;
    var running = this.mode !== 'edit';
    var placed = F.placedSlots(fl);
    var inActive = sim.lineSlot === this.active && this.active >= 0;
    vm.line = running && inActive ? sim.line : -1;
    vm.next = running && sim.node && sim.node.s === this.active ? sim.node.pc : -1;
    vm.held = sim.cell ? { c: sim.cell.c, q: sim.cell.q } : null;
    var cells = this.outputCells();
    vm.floor = {
      W: lv.W, H: lv.H,
      map: lv.map,
      tiles: fl.tiles,
      fmode: this.fmode,
      tc: this.tc,
      facing: this.facing,
      parts: this.buildParts().map(function (p) { return { k: p.k, t: p.t, label: p.label, left: p.left, total: p.total }; }),
      partIdx: this.partIdx,
      active: this.active,
      slots: lv.slots.map(function (s, i) {
        var pos = F.nodePos(fl, i);
        return { label: s.label, t: s.t, name: F.NODE_TYPES[s.t].name, cap: s.cap, salvaged: s.salvaged, placed: placed.indexOf(i) >= 0, size: C.programSize(fl.progs[i] || []), mem: sim.mem[i], d: pos ? pos.d : -1 };
      }),
      cell: sim.cell ? { c: sim.cell.c, q: sim.cell.q, x: sim.x, y: sim.y } : null,
      lineSlot: running ? sim.lineSlot : -1,
      faultAt: sim.status === 'fault' ? sim.faultAt : null,
      size: F.floorSize(lv, fl),
      parts_n: F.countParts(fl).total,
      parSize: lv.parSize, parParts: lv.parParts,
      inspect: this.inspectIdx >= 0 && cells[this.inspectIdx] ? cells[this.inspectIdx].id : null
    };
  };
})(typeof self !== 'undefined' ? self : this);
