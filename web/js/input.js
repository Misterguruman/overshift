/*
 * Overshift input: turns keyboard, Gamepad API and native (Android shell) buttons into
 * one stream of virtual button events: emit(button, 'down' | 'repeat' | 'up').
 * Buttons: up down left right A B X Y L1 R1 L2 R2 L3 R3 start select rsLeft rsRight
 */
(function (root) {
  'use strict';

  // Standard Gamepad API mapping
  var PAD_BUTTONS = ['A', 'B', 'X', 'Y', 'L1', 'R1', 'L2', 'R2', 'select', 'start', 'L3', 'R3', 'up', 'down', 'left', 'right'];
  var REPEAT = {
    up: [320, 85], down: [320, 85], left: [320, 110], right: [320, 110],
    L2: [260, 100], R2: [260, 100], rsLeft: [320, 140], rsRight: [320, 140]
  };
  var KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    KeyZ: 'A', Enter: 'A', KeyX: 'B', Backspace: 'B', Delete: 'B', KeyC: 'X', KeyV: 'Y',
    KeyQ: 'L1', KeyE: 'R1', BracketLeft: 'L2', BracketRight: 'R2', Space: 'start',
    KeyR: 'select', KeyM: 'L3', Tab: 'L3', KeyI: 'R3', KeyJ: 'rsLeft', KeyL: 'rsRight'
  };

  function Input(emit) {
    this.emit = emit;
    this.state = {};      // button -> {down, next}
    this.padPrev = {};
    this.useGamepadApi = true;
    this.enabled = true;
  }

  Input.prototype.set = function (b, down, now) {
    var s = this.state[b];
    if (down) {
      if (s && s.down) return;
      var rp = REPEAT[b];
      this.state[b] = { down: true, next: rp ? now + rp[0] : Infinity };
      this.emit(b, 'down');
    } else {
      if (!s || !s.down) return;
      s.down = false;
      this.emit(b, 'up');
    }
  };

  Input.prototype.update = function (now) {
    if (this.useGamepadApi) this.pollPads(now);
    for (var b in this.state) {
      var s = this.state[b];
      if (s.down && now >= s.next) {
        s.next = now + REPEAT[b][1];
        this.emit(b, 'repeat');
      }
    }
  };

  Input.prototype.pollPads = function (now) {
    var nav = root.navigator;
    if (!nav || !nav.getGamepads) return;
    var pads = nav.getGamepads(), pad = null;
    for (var i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) { pad = pads[i]; break; }
    var cur = {};
    if (pad) {
      for (var k = 0; k < PAD_BUTTONS.length && k < pad.buttons.length; k++) {
        var btn = pad.buttons[k];
        cur[PAD_BUTTONS[k]] = btn.pressed || btn.value > 0.5;
      }
      var ax = pad.axes;
      if (ax.length >= 2) {
        if (ax[1] < -0.55) cur.up = true;
        if (ax[1] > 0.55) cur.down = true;
        if (ax[0] < -0.55) cur.left = true;
        if (ax[0] > 0.55) cur.right = true;
      }
      if (ax.length >= 3) {
        if (ax[2] < -0.6) cur.rsLeft = true;
        if (ax[2] > 0.6) cur.rsRight = true;
      }
    }
    var names = PAD_BUTTONS.concat(['rsLeft', 'rsRight']);
    for (var n = 0; n < names.length; n++) {
      var name = names[n], was = !!this.padPrev[name], is = !!cur[name];
      if (is !== was) this.set(name, is, now);
    }
    this.padPrev = cur;
  };

  Input.prototype.attachKeyboard = function (target, extra) {
    var self = this;
    target.addEventListener('keydown', function (e) {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); extra(e.shiftKey ? 'redo' : 'undo'); return; }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); extra('redo'); return; }
      if (e.code === 'KeyF') { extra('fast'); return; }
      if (e.code === 'KeyS') { extra('mute'); return; }
      if (e.code === 'KeyB') { extra('board'); return; }
      if (/^Digit[1-5]$/.test(e.code)) { extra('stream', parseInt(e.code.slice(5), 10) - 1); return; }
      var b = KEYS[e.code];
      if (!b) return;
      e.preventDefault();
      if (e.repeat) return; // our own repeat timers handle held keys
      self.set(b, true, performance.now());
    });
    target.addEventListener('keyup', function (e) {
      var b = KEYS[e.code];
      if (!b) return;
      e.preventDefault();
      self.set(b, false, performance.now());
    });
    root.addEventListener('blur', function () {
      for (var b in self.state) if (self.state[b].down) self.set(b, false, performance.now());
    });
  };

  /** Called by the Android shell: Overshift.nativeButton('A', true). */
  Input.prototype.native = function (b, down) {
    this.useGamepadApi = false; // the shell owns the controller; avoid double input
    this.set(b, !!down, performance.now());
  };

  root.OvershiftInput = Input;
})(typeof self !== 'undefined' ? self : this);
