/*
 * Overshift tutorial and tips. Extends OvershiftGame with:
 *  - a guided first-run tutorial on contract 01, Clock In: a welcome card, then coach steps that
 *    wait for the player to do each thing (add GRAB, add SHIP, run, fix, clear). Skippable, and
 *    replayable from the contract board (Y) or the ? button on the editor.
 *  - tips: a card the first time each new mechanic appears (lines with a value, LOOP, IF, hidden
 *    streams, faults, the first clear, floors and nodes, trucks, the Ledger, upgrades, Dispatch).
 *
 * Save data: save.tut = { state: 'new' | 'active' | 'done' | 'skipped' | 'left' | 'old', step,
 * backup }, save.tips = { tipId: 1 } for tips already shown, save.tipsOff = true when the player
 * turned tips off. A save that already has progress gets state 'old' (no tutorial) and every tip
 * for a contract it has already reached marked as seen.
 *
 * Text conventions (the views draw them): [A] is a button chip, {ed} names where the editor is
 * ("on the bottom screen" on a two-screen handheld, "in the editor" on one screen).
 * Nothing here changes a contract, a program's score or the Ledger's pay.
 */
(function (root) {
  'use strict';
  var G = root.OvershiftGame;
  if (!G) return;
  var P = G.prototype, LV = G.LEVELS;
  var TUT_LEVEL = 'clock-in';

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function levelIndex(id) { for (var i = 0; i < LV.length; i++) if (LV[i].id === id) return i; return -1; }
  function count(prog, op) { var n = 0; for (var i = 0; i < prog.length; i++) if (prog[i].op === op) n++; return n; }
  function grabThenShip(prog) {
    var grab = -1;
    for (var i = 0; i < prog.length; i++) {
      if (prog[i].op === 'GRAB' && grab < 0) grab = i;
      if (prog[i].op === 'SHIP' && grab >= 0) return true;
    }
    return false;
  }
  function param(name) {
    try { return root.location ? new URLSearchParams(root.location.search).get(name) : null; } catch (e) { return null; }
  }

  // ---------- the tutorial ----------
  var STEP_ORDER = ['grab', 'ship', 'run', 'more', 'cleared'];
  var STEPS = {
    intro: {
      card: true,
      title: 'WELCOME TO THE NIGHT SHIFT',
      body: 'You run the night shift on a neon fab deck. Servo, the rail arm, does exactly what your program says: it takes power cells off the intake belt and ships what the order ticket asks for. The deck shows Servo at work; you write its program {ed}. You can replay this from the contract board.',
      pad: '[A] start the tutorial  ·  [B] skip it',
      touch: 'Tap Start, or Skip if you know the ropes.',
      primary: 'Start', secondary: 'Skip'
    },
    grab: {
      text: 'Add GRAB {ed}. GRAB picks up the next cell from the intake belt.',
      pad: '[◀ ▶] pick an operation  ·  [A] add it',
      touch: 'Tap GRAB in the palette.',
      target: 'pal:GRAB',
      next: function (g) { return count(g.program, 'GRAB') ? 'ship' : null; }
    },
    ship: {
      text: 'Now add SHIP. It puts the cell Servo holds on the outbound belt, toward the order ticket.',
      pad: '[▶] pick SHIP  ·  [A] add it',
      touch: 'Tap SHIP in the palette.',
      target: 'pal:SHIP',
      next: function (g) { return grabThenShip(g.program) ? 'run' : null; }
    },
    run: {
      text: function (g, t) { return t.faults ? 'Run it again.' : 'Run the shift and watch Servo work through your program.'; },
      pad: '[START] run  ·  [R2] one step at a time',
      touch: 'Tap Run under the program.',
      target: 'run',
      next: function (g) {
        if (g.overlay === 'cleared') return 'cleared';
        return g.mode !== 'edit' ? 'watch' : null;
      }
    },
    watch: {
      text: function (g) { return g.mode === 'pause' ? 'Paused. Step through it a line at a time, or keep running.' : 'Servo runs your program from the top. Each move along the rail costs cycles.'; },
      pad: function (g) { return g.mode === 'pause' ? '[R2] step  ·  [L2] step back  ·  [START] run' : '[START] pause  ·  press it twice for fast'; },
      touch: function (g) { return g.mode === 'pause' ? 'Step, Back and Run are under the program.' : 'Pause and Fast are under the program.'; },
      target: 'transport',
      next: function (g, t) {
        if (g.overlay === 'cleared') return 'cleared';
        if (g.mode === 'done') { t.faults = (t.faults || 0) + 1; return 'more'; }
        return g.mode === 'edit' ? 'run' : null;
      }
    },
    more: {
      text: 'Servo runs your program once, top to bottom, and then the shift ends. The ticket wants 3 cells: add GRAB and SHIP until there are three of each.',
      pad: '[A] add  ·  [R-STICK ↕] move the cursor  ·  [B] delete a line  ·  [Y] undo',
      touch: 'Tap GRAB, then SHIP, until there are three of each.',
      target: 'pal',
      next: function (g) {
        if (g.overlay === 'cleared') return 'cleared';
        if (g.mode === 'run' || g.mode === 'fast' || g.mode === 'pause') return 'watch';
        return g.mode === 'edit' && count(g.program, 'GRAB') >= 3 && count(g.program, 'SHIP') >= 3 ? 'run' : null;
      }
    },
    cleared: {
      text: 'Contract cleared! LEAN and FAST light up when you match par size and par cycles. Every clear also earns credits in the Ledger.',
      pad: '[A] next contract  ·  [B] keep editing',
      touch: 'Tap Next contract on the deck.',
      next: function (g) { return g.overlay !== 'cleared' ? 'end' : null; }
    }
  };

  // ---------- tips: one card (or a few pages) the first time a mechanic shows up ----------
  function onLevel(id) { return function (g) { return g.level.id === id && !g.overlay && g.mode === 'edit'; }; }
  function ledgerVM(g) { return g.overlay === 'ledger' && g.ledgerViewModel ? g.ledgerViewModel() : null; }
  function ledgerTab(g) { var l = ledgerVM(g); return l ? l.tab : null; }
  var TIPS = [
    {
      id: 'values', at: 'respray', when: onLevel('respray'),
      pages: [{ title: 'LINES WITH A VALUE', body: 'PAINT takes a colour. The value sits on the line, after the instruction, and you change it on the cursor line.', pad: '[X] or [R1] next value  ·  [L1] previous', touch: 'Tap the value on a line to change it.' }]
    },
    {
      id: 'loop', at: 'bulk-order', when: onLevel('bulk-order'),
      pages: [{
        title: 'LOOP',
        body: function (g) { return 'LOOP repeats the lines between it and its END, as many times as its value. Adding a LOOP adds its END too, and new lines go in below the cursor, inside the block.' + (g.level.limit ? ' This contract caps the program at ' + g.level.limit + ' lines; END and ELSE are free.' : ''); },
        pad: '[R-STICK ↕] move the cursor  ·  [X] [L1] [R1] change the count  ·  hold [A] + [↕] move a line',
        touch: 'Tap a line to put the cursor on it. ▲ ▼ move it, ✕ deletes it.'
      }]
    },
    {
      id: 'open-shift', at: 'open-shift', when: onLevel('open-shift'),
      pages: [
        { title: 'LOOP FOREVER', body: 'LOOP forever never stops on its own. The shift ends cleanly when GRAB finds the intake empty, so the same program handles 3 cells or 9.', pad: '[X] [L1] [R1] set the LOOP to forever', touch: 'Tap the LOOP’s count to change it.' },
        { title: 'HIDDEN STREAMS', body: function (g) { var n = g.level.streams.length, v = g.level.visibleStreams; return 'This contract is tested on ' + n + ' intake streams and ' + (n - v) + ' of them are hidden. It clears only when your program fills the order for every one. A hidden stream that fails opens as a new tab.'; }, pad: '[L1] [R1] switch streams while running', touch: 'Tap a stream tab at the top of the deck.' }
      ]
    },
    {
      id: 'charge', at: 'flatline', when: onLevel('flatline'),
      pages: [{ title: 'LOOP CHARGE', body: 'DRAIN takes one charge off the cell Servo holds. LOOP charge repeats its block once for each point of charge the held cell has when the LOOP starts.', pad: '[X] [L1] [R1] set a LOOP to charge', touch: 'Tap the LOOP’s count to change it.' }]
    },
    {
      id: 'if', at: 'sorting-gate', when: onLevel('sorting-gate'),
      pages: [{ title: 'IF ... ELSE', body: 'IF tests the cell Servo holds. The lines after it run when the test passes, the lines after ELSE when it doesn’t, and both meet at END. ELSE is optional, and ELSE and END don’t count toward size.', pad: '[X] [L1] [R1] change what IF tests', touch: 'Tap the IF’s value to change the test.' }]
    },
    {
      id: 'fault', at: 'clock-in',
      when: function (g) { return !g.overlay && g.mode === 'done' && g.sim.status === 'fault' && !g.level.city; },
      pages: [{ title: 'A FAULT', body: 'The run stopped on the red line, and the message says why. Step backward through the run to see what led there. Tap a finished cell on the deck to jump to the line that moved it.', pad: '[L2] step back  ·  [R2] step  ·  [R3] trace a cell  ·  [B] back to editing', touch: 'Back and Step walk through the run. Reset goes back to editing.' }]
    },
    {
      id: 'first-clear', at: 'clock-in',
      when: function (g) { return g.overlay === 'cleared'; },
      pages: [{ title: 'CONTRACT CLEARED', body: 'LEAN and FAST light up when you match par size and par cycles; they’re optional. Every clear also earns credits in the Ledger, even while the game is closed.', pad: '[A] next contract  ·  the Ledger is on the board: [L3] then [L1]', touch: 'Tap ₵ at the top of the editor for the Ledger.' }]
    },
    {
      id: 'floor', at: 'two-docks', when: onLevel('two-docks'),
      pages: [
        { title: 'JUNCTION FLOOR: BUILD', body: 'Here you build the line: lay belts from the intake, place nodes from the kit, and get every cell to the right dock. A belt takes cells from its back and sides; a node only from its back.', pad: '[D-PAD] move  ·  hold [X] + [◀ ▶] pick a part  ·  [X] turn  ·  [A] place (hold to draw belts)  ·  [B] remove', touch: 'Tap a part, then tap tiles on the map. Tap a placed part again to turn it.' },
        { title: 'JUNCTION FLOOR: PROGRAM', body: 'Each node runs its own small program on every cell that enters it, and SEND picks the side it leaves by. A node shows ? until it has a program.', pad: '[L3] Build / Program (on a node, opens it)  ·  [L1] + [◀ ▶] next node  ·  [L1] + [L3] contracts', touch: 'Tap Program or a node’s tab, or the “isn’t programmed” tip.' }
      ]
    },
    {
      id: 'tool-node', at: 'respray-line', when: onLevel('respray-line'),
      pages: [{ title: 'TOOL NODES', body: 'A Painter or a Press changes the cell and then passes it on ahead by itself; only Splitters and Counters SEND. Its arrows show where cells come out.', pad: '[L3] on a node opens its program', touch: 'Tap a node’s tab to program it.' }]
    },
    {
      id: 'counter', at: 'batch-split', when: onLevel('batch-split'),
      pages: [{ title: 'COUNTER NODES', body: 'A Counter remembers a number for the whole stream. TICK adds 1, CLEAR sets it back to 0, and IF count tests it. The editor shows the current count.', pad: '[X] [L1] [R1] change what IF count tests', touch: 'Tap a value to change it.' }]
    },
    {
      id: 'bridge', at: 'tight-floor', when: onLevel('tight-floor'),
      pages: [{ title: 'BRIDGES', body: 'A Bridge lets one path cross another: a cell rides straight over it, either way. This floor’s old scrap line can only be crossed with one.', pad: 'hold [X] + [◀ ▶] pick the Bridge  ·  [A] place it', touch: 'Tap Bridge, then tap the crossing tile.' }]
    },
    {
      id: 'truck', at: 'first-run', when: onLevel('first-run'),
      pages: [{ title: 'FIRST ROUTES: TRUCKS', body: 'A truck runs its program once per trip, starting at the depot with the order at the head of the board in hand. LOAD puts that order on the truck, DRIVE goes to a district and drops what is loaded for it, then the truck drives back for the next one. An order that arrives after its due tick is a fault.', pad: '[◀ ▶] [A] add, same as Servo  ·  [X] [L1] [R1] pick the district  ·  [START] run', touch: 'Tap LOAD, then DRIVE. Tap DRIVE’s value to pick the district.' }]
    },
    {
      id: 'next', at: 'full-load', when: onLevel('full-load'),
      pages: [{ title: 'NEXT', body: 'NEXT takes the next order on the board into hand, so one trip can carry several orders. A truck holds 12 cells.', pad: '[A] add  ·  [START] run', touch: 'Tap NEXT to add it.' }]
    },
    {
      id: 'defer', at: 'short-stock', when: onLevel('short-stock'),
      pages: [{ title: 'SHORT AND DEFER', body: 'IF short passes when stock can’t fill the order in hand yet. DEFER sends that order to the back of the board, and WAIT idles for a tick.', pad: '[X] [L1] [R1] change what IF tests', touch: 'Tap the IF’s value to change the test.' }]
    },
    {
      id: 'two-trucks', at: 'two-trucks', when: onLevel('two-trucks'),
      pages: [{ title: 'TWO TRUCKS', body: 'Each truck has its own program, and both take orders from the same board: whichever starts a trip takes the order at its head.', pad: '[L1] + [◀ ▶] switch trucks', touch: 'Tap a truck’s tab above the program.' }]
    },
    {
      id: 'ledger', at: 'ledger',
      when: function (g) { return g.overlay === 'ledger'; },
      pages: [{ title: 'THE LEDGER', body: 'Cleared contracts run in bays and earn credits, even while the game is closed, for up to one shift. A solution at par earns the contract’s base rate; fewer cycles and fewer lines earn more.', pad: '[↑ ↓] pick  ·  [A] in or out of a bay  ·  [START] open it  ·  [L2] [R2] tabs  ·  [B] contracts', touch: 'Tap a contract, then tap it again to move it in or out of a bay.' }]
    },
    {
      id: 'upgrades', at: 'ledger',
      when: function (g) { return g.overlay === 'ledger' && ledgerTab(g) === 'upgrades'; },
      pages: [{ title: 'UPGRADES', body: 'Upgrades grow the business: more bays, faster bays, longer shifts, and later more trucks. They never change a contract or its score.', pad: 'hold [A] to buy', touch: 'Press and hold an upgrade to buy it.' }]
    },
    {
      id: 'dispatch', at: 'first-run',
      when: function (g) { return g.overlay === 'ledger' && ledgerTab(g) === 'dispatch' && !!(ledgerVM(g).dispatch || {}).open; },
      pages: [{ title: 'DISPATCH', body: 'Your trucks can sell what the bays make to the city. Write one route for the whole fleet; on-time deliveries pay more than spot, late ones half. Demand changes every day.', pad: '[A] edit the route', touch: 'Tap the City route row.' }]
    },
    {
      id: 'city', at: 'first-run',
      when: function (g) { return !!g.level.city && !g.overlay && g.mode === 'edit'; },
      pages: [{ title: 'THE CITY ROUTE', body: 'This one program runs on every truck in your fleet, on today’s live orders. Run plays a sample hour; what it earns is what the Ledger pays.', pad: '[START] run the sample hour  ·  [L3] back to the Ledger', touch: 'Tap ₵ Dispatch to go back.' }]
    }
  ];
  var TIP_BY_ID = {};
  TIPS.forEach(function (t) { TIP_BY_ID[t.id] = t; });

  /** Mark tips for mechanics a save has already reached, so updating players aren't lectured. */
  function markReached(save) {
    var maxCleared = -1;
    for (var i = 0; i < LV.length; i++) if (save.cleared[LV[i].id]) maxCleared = i;
    var paid = !!(save.ledger && save.ledger.lifetime > 0);
    TIPS.forEach(function (t) {
      var reached = t.at === 'ledger' ? paid : maxCleared >= 0 && maxCleared >= levelIndex(t.at);
      if (reached) save.tips[t.id] = 1;
    });
  }
  function hasProgress(save) {
    for (var k in save.cleared) if (save.cleared[k]) return true;
    for (var p in save.programs) if (save.programs[p] && save.programs[p].length) return true;
    return !!(save.ledger && save.ledger.lifetime > 0);
  }

  G.TIPS = TIPS;
  G.TUTORIAL_STEPS = STEPS;

  // ---------- setup ----------
  P.initTutor = function (opts) {
    opts = opts || {};
    var s = this.save;
    this.tipCard = null;
    this.tutSwallow = {};
    var forceTut = param('tutorial'), forceTips = param('tips');
    this.tutorAuto = opts.tutorial !== undefined ? !!opts.tutorial : forceTut ? forceTut === 'on' : !this.unlockAll && !opts.skipBoard;
    this.tipsLive = opts.tips !== undefined ? !!opts.tips : forceTips ? forceTips === 'on' : !this.unlockAll && !opts.skipBoard;
    if (!s.tips) s.tips = {};
    if (!s.tut) {
      if (hasProgress(s)) { s.tut = { state: 'old' }; markReached(s); }
      else s.tut = { state: 'new' };
      this.persist();
    }
    if (!this.tutorAuto) return;
    if (s.tut.state === 'new') this.startTutorial(false);
    else if (s.tut.state === 'active') {
      // the app closed mid-tutorial: carry on where it was
      if (this.level.id !== TUT_LEVEL) this.selectLevel(levelIndex(TUT_LEVEL), true);
      this.overlay = null;
      this.tutorCheck();
    }
  };

  P.tutorActive = function () { return !!(this.save.tut && this.save.tut.state === 'active'); };
  P.tipsOn = function () { return this.tipsLive && !this.save.tipsOff; };

  /** Start (or replay) the tutorial on Clock In with an empty program; a replay keeps the old program to put back. */
  P.startTutorial = function (replay) {
    var s = this.save, t = s.tut = s.tut || {};
    if (replay && t.state !== 'active') {
      var saved = s.programs[TUT_LEVEL];
      t.backup = saved && saved.length ? clone(saved) : null;
    }
    t.state = 'active';
    t.step = 'intro';
    t.faults = 0;
    s.programs[TUT_LEVEL] = [];
    this.tipCard = null;
    this.selectLevel(levelIndex(TUT_LEVEL), true);
    this.overlay = null;
    this.persist();
    if (replay) this.sfx.play('select');
  };

  P.endTutorial = function (state) {
    var s = this.save, t = s.tut;
    if (!t || t.state !== 'active') return;
    t.state = state;
    t.step = null;
    if (state === 'done') s.tips['first-clear'] = 1; // the tutorial's last step said it
    else if (t.backup) {
      // skipped or left a replay: put the player's own program back
      s.programs[TUT_LEVEL] = t.backup;
      if (this.level.id === TUT_LEVEL) {
        this.program = clone(t.backup);
        this.cursor = this.program.length - 1;
        this.undoStack = []; this.redoStack = [];
        this.recompile(); this.reset(); this.result = null;
      }
    }
    t.backup = null;
    this.persist();
  };

  /** Move the tutorial along and open any tip that is due. Returns true when something changed. */
  P.tutorCheck = function () {
    var s = this.save;
    if (!s || !s.tut || this.tipCard === undefined) return false;
    var changed = false, t = s.tut;
    if (t.state === 'active') {
      if (this.level.id !== TUT_LEVEL) { this.endTutorial(t.step === 'cleared' ? 'done' : 'left'); return true; }
      for (var guard = 0; guard < 6 && t.step && t.step !== 'intro'; guard++) {
        var step = STEPS[t.step], nx = step && step.next ? step.next(this, t) : null;
        if (!nx) break;
        if (nx === 'end') { this.endTutorial('done'); changed = true; break; }
        t.step = nx; changed = true;
        this.sfx.play('tick');
      }
      if (changed) this.persist();
      return changed;
    }
    if (this.tipCard || !this.tipsOn()) return changed;
    for (var i = 0; i < TIPS.length; i++) {
      var tip = TIPS[i];
      if (s.tips[tip.id] || !tip.when(this)) continue;
      s.tips[tip.id] = 1;
      this.tipCard = { id: tip.id, page: 0 };
      this.persist();
      this.sfx.play('select');
      return true;
    }
    return changed;
  };

  /** The modal card on screen, if any: the tutorial's welcome card or a tip. */
  P.cardShown = function () {
    if (this.tipCard) return 'tip';
    var t = this.save.tut;
    if (t && t.state === 'active' && t.step === 'intro' && this.overlay !== 'board') return 'tut';
    return null;
  };

  /** A, or the card's main button: next page, close, or start the tutorial. */
  P.tipNext = function () {
    var shown = this.cardShown();
    if (shown === 'tut') { this.save.tut.step = 'grab'; this.persist(); this.sfx.play('select'); return; }
    if (shown !== 'tip') return;
    var tip = TIP_BY_ID[this.tipCard.id];
    if (tip && this.tipCard.page < tip.pages.length - 1) { this.tipCard.page++; this.sfx.play('tick'); return; }
    this.tipCard = null;
    this.sfx.play('back');
    this.tutorCheck();
  };
  /** B, or the card's second button: skip the tutorial, or close a tip. */
  P.tipClose = function () {
    var shown = this.cardShown();
    if (shown === 'tut') { this.endTutorial('skipped'); this.overlay = 'board'; this.boardSel = this.level.index; this.sfx.play('back'); return; }
    if (shown !== 'tip') return;
    this.tipCard = null;
    this.sfx.play('back');
    this.tutorCheck();
  };
  P.toggleTips = function () {
    this.save.tipsOff = !this.save.tipsOff;
    if (this.save.tipsOff) this.tipCard = null;
    this.persist();
    this.flash(this.save.tipsOff ? 'Tips are off. Turn them back on from the contract board.' : 'Tips are on. New mechanics get a card the first time.', 'info');
    this.sfx.play('tick');
  };

  // ---------- input ----------
  var baseButton = P.button;
  P.button = function (b, phase) {
    if (phase === 'up' && this.tutSwallow && this.tutSwallow[b]) { this.tutSwallow[b] = false; this.held[b] = false; return; }
    if (this.cardShown()) {
      // a card takes the controller until it closes; its button releases never reach the game
      if (phase === 'up') this.held[b] = false;
      if (phase !== 'down') return;
      this.tutSwallow[b] = true;
      this.aArmed = false;
      if (b === 'A' || b === 'start') this.tipNext();
      else if (b === 'B') this.tipClose();
      return;
    }
    if (this.overlay === 'board' && (b === 'Y' || b === 'X') && this.save.tut) {
      if (phase === 'down') { this.tutSwallow[b] = true; if (b === 'Y') this.startTutorial(true); else this.toggleTips(); }
      return;
    }
    baseButton.call(this, b, phase);
  };

  var CARD_ACTS = { tipNext: 1, tipClose: 1, mute: 1, noop: 1 };
  var baseAct = P.act;
  P.act = function (a) {
    if (!a || !a.type) return;
    if (this.tipCard === undefined) { baseAct.call(this, a); return; }
    switch (a.type) {
      case 'tipNext': this.sfx.unlock && this.sfx.unlock(); this.tipNext(); this.changed(); return;
      case 'tipClose': this.tipClose(); this.changed(); return;
      case 'tutSkip': this.endTutorial('skipped'); this.sfx.play('back'); this.changed(); return;
      case 'tutorial': this.startTutorial(true); this.changed(); return;
      case 'tipsToggle': this.toggleTips(); this.changed(); return;
    }
    if (this.cardShown() && a.type !== 'btn' && !CARD_ACTS[a.type]) return; // taps behind a card do nothing
    baseAct.call(this, a);
    if (this.tutorCheck()) this.changed();
  };

  var baseFinish = P.finish;
  P.finish = function () {
    baseFinish.call(this);
    if (this.tipCard !== undefined) this.tutorCheck();
  };

  var baseSelect = P.selectLevel;
  P.selectLevel = function (i, initial) {
    baseSelect.call(this, i, initial);
    if (this.tipCard !== undefined) this.tutorCheck();
  };

  // ---------- view model ----------
  function txt(v, g, t) { return typeof v === 'function' ? v(g, t) : v; }
  /** What the views draw for the tutorial and tips: { tutorial, tipsOff, tip (a card), coach (a step) }. */
  P.tutorView = function () {
    var t = this.save.tut, shown = this.cardShown(), out = { tutorial: !!(t && t.state === 'active'), tipsOff: !!this.save.tipsOff, tip: null, coach: null };
    if (shown === 'tut') {
      var st = STEPS.intro;
      out.tip = { kind: 'tut', id: 'intro', title: st.title, body: st.body, pad: st.pad, touch: st.touch, page: 0, pages: 1, primary: st.primary, secondary: st.secondary };
    } else if (shown === 'tip') {
      var tip = TIP_BY_ID[this.tipCard.id], pg = tip.pages[this.tipCard.page], last = this.tipCard.page >= tip.pages.length - 1;
      out.tip = { kind: 'tip', id: tip.id, title: pg.title, body: txt(pg.body, this), pad: pg.pad, touch: pg.touch, page: this.tipCard.page, pages: tip.pages.length, primary: last ? 'Got it' : 'Next', secondary: last ? null : 'Close' };
    }
    if (out.tutorial && !shown && t.step && STEPS[t.step] && this.overlay !== 'board') {
      var s = STEPS[t.step], n = STEP_ORDER.indexOf(t.step === 'watch' ? 'run' : t.step);
      out.coach = { step: t.step, n: n + 1, of: STEP_ORDER.length, text: txt(s.text, this, t), pad: txt(s.pad, this, t), touch: txt(s.touch, this, t), target: s.target || null };
    }
    return out;
  };

  var baseVM = P.viewModel;
  P.viewModel = function () {
    var vm = baseVM.call(this);
    if (this.tipCard === undefined) return vm;
    var tv = this.tutorView();
    vm.tip = tv.tip; vm.coach = tv.coach; vm.tutorial = tv.tutorial; vm.tipsOff = tv.tipsOff;
    return vm;
  };
})(typeof self !== 'undefined' ? self : this);
