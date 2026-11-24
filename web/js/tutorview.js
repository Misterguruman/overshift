/*
 * Overshift tutorial and tips, drawn. The deck (top screen) shows each card with its gamepad
 * prompts and the tutorial's coach strip; the editor (bottom screen) shows the same card with its
 * touch prompt and buttons, the coach's touch hint, and a glow on the thing to tap.
 * The state lives in tutor.js; this file only wraps OvershiftDeck.draw / drawBoard and
 * OvershiftEditor.render.
 */
(function (root) {
  'use strict';
  var W = 1920, H = 1080;
  var CYAN = '#22e8ff', AMBER = '#ffb31f', INK = '#d7f6ff', DIM = '#5b7590', FAINT = '#1b2a3d';
  var FONT = '"IBM Plex Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';

  /** Where the editor is, in words, for this layout. */
  function where() {
    var l = root.Overshift && root.Overshift.layout;
    return l === 'deck' ? 'on the bottom screen' : l === 'editor' ? 'on this screen' : 'in the editor';
  }
  function fill(s) { return String(s || '').replace(/\{ed\}/g, where()); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------------- deck (top screen) ----------------
  var Deck = root.OvershiftDeck;
  if (Deck) {
    var DP = Deck.prototype;

    DP.tutFont = function (size, weight) { this.g.font = (weight || '500') + ' ' + size + 'px ' + FONT; };

    /** Split text into lines no wider than w at the given size. */
    DP.tutWrap = function (text, w, size, weight) {
      this.tutFont(size, weight);
      var words = String(text).split(' '), lines = [], cur = '';
      for (var i = 0; i < words.length; i++) {
        var next = cur ? cur + ' ' + words[i] : words[i];
        if (cur && this.g.measureText(next).width > w) { lines.push(cur); cur = words[i]; } else cur = next;
      }
      if (cur) lines.push(cur);
      return lines;
    };

    /** A prompt line: plain text with [A]-style button chips, drawn left-aligned at x. Returns its width. */
    DP.tutPrompt = function (str, x, y, size, draw) {
      var g = this.g, parts = [], re = /\[([^\]]+)\]/g, last = 0, m, k;
      while ((m = re.exec(str))) {
        if (m.index > last) parts.push({ t: str.slice(last, m.index) });
        parts.push({ t: m[1], chip: true });
        last = re.lastIndex;
      }
      if (last < str.length) parts.push({ t: str.slice(last) });
      var pad = size * 0.45, total = 0;
      for (k = 0; k < parts.length; k++) {
        this.tutFont(size, parts[k].chip ? '700' : '500');
        parts[k].w = g.measureText(parts[k].t).width + (parts[k].chip ? pad * 2 + 4 : 0);
        total += parts[k].w;
      }
      if (draw === false) return total;
      var cx = x;
      g.textBaseline = 'middle'; g.textAlign = 'left';
      for (k = 0; k < parts.length; k++) {
        var p = parts[k];
        if (p.chip) {
          this.roundRect(cx + 2, y - size * 0.72, p.w - 4, size * 1.44, size * 0.3);
          g.fillStyle = 'rgba(34,232,255,0.12)'; g.fill();
          g.strokeStyle = CYAN; g.lineWidth = 2; g.stroke();
          this.tutFont(size, '700'); g.fillStyle = CYAN;
          g.fillText(p.t, cx + 2 + pad, y + 1);
        } else {
          this.tutFont(size, '500'); g.fillStyle = INK;
          g.fillText(p.t, cx, y + 1);
        }
        cx += p.w;
      }
      return total;
    };

    /** Break a prompt into lines at its " · " separators so each fits maxW. */
    DP.tutPromptLines = function (str, size, maxW) {
      var segs = String(str || '').split('  ·  '), lines = [], cur = '';
      for (var i = 0; i < segs.length; i++) {
        var next = cur ? cur + '  ·  ' + segs[i] : segs[i];
        if (cur && this.tutPrompt(next, 0, 0, size, false) > maxW) { lines.push(cur); cur = segs[i]; } else cur = next;
      }
      if (cur) lines.push(cur);
      return lines;
    };

    DP.drawTipCard = function (tip) {
      var g = this.g;
      this.hits = [];
      this.hit(0, 0, W, H, { type: 'noop' });
      g.fillStyle = 'rgba(0,0,0,0.74)'; g.fillRect(0, 0, W, H);
      var x = 300, w = W - 600;
      var bodyLines = this.tutWrap(fill(tip.body), w - 120, 34, '400');
      var padLines = this.tutPromptLines(tip.pad, 28, w - 120);
      var h = 200 + bodyLines.length * 48 + padLines.length * 50 + 120;
      var y = Math.max(30, (H - h) / 2);
      var col = tip.kind === 'tut' ? AMBER : CYAN;
      this.roundRect(x, y, w, h, 22);
      g.fillStyle = '#04080f'; g.fill();
      this.glow(col, 30); g.strokeStyle = col; g.lineWidth = 3; g.stroke(); this.noGlow();
      this.text(tip.kind === 'tut' ? 'TUTORIAL' : 'NEW ON THE DECK', x + 60, y + 48, 22, DIM, 'left', '600');
      if (tip.pages > 1) this.text((tip.page + 1) + ' / ' + tip.pages, x + w - 60, y + 48, 24, DIM, 'right', '600');
      this.glow(col, 16);
      this.text(tip.title, x + 60, y + 102, 48, col, 'left', '700');
      this.noGlow();
      var i, ly = y + 176;
      for (i = 0; i < bodyLines.length; i++) this.text(bodyLines[i], x + 60, ly + i * 48, 34, INK, 'left', '400');
      ly += bodyLines.length * 48 + 22;
      for (i = 0; i < padLines.length; i++) this.tutPrompt(padLines[i], x + 60, ly + i * 50, 28);
      var by = y + h - 96;
      this.button('A  ' + tip.primary, x + w - 60 - 320, by, 320, 70, col, { type: 'tipNext' }, true);
      if (tip.secondary) this.button('B  ' + tip.secondary, x + w - 60 - 660, by, 320, 70, INK, { type: 'tipClose' });
      else this.text('B also closes', x + w - 60 - 350, by + 35, 24, DIM, 'right', '500');
    };

    DP.drawCoach = function (coach, game) {
      var g = this.g;
      var x = 30, w = W - 60, inner = w - 330;
      var lines = this.tutWrap(fill(coach.text), inner, 32, '600');
      var padLines = this.tutPromptLines(coach.pad, 26, inner);
      var h = 64 + lines.length * 42 + padLines.length * 42 + 8;
      var y = game.overlay === 'cleared' ? H - 20 - h : 124;
      var pulse = 0.55 + 0.45 * Math.sin(this.t * 4);
      this.roundRect(x, y, w, h, 14);
      g.fillStyle = 'rgba(8,6,0,0.92)'; g.fill();
      this.glow(AMBER, 14 * pulse); g.strokeStyle = AMBER; g.lineWidth = 2.5; g.stroke(); this.noGlow();
      this.text('TUTORIAL ' + coach.n + '/' + coach.of, x + 28, y + 30, 22, AMBER, 'left', '700');
      var i, ly = y + 72;
      for (i = 0; i < lines.length; i++) this.text(lines[i], x + 28, ly + i * 42, 32, INK, 'left', '600');
      ly += lines.length * 42;
      for (i = 0; i < padLines.length; i++) this.tutPrompt(padLines[i], x + 28, ly + i * 42, 26);
      // touch: skip the rest
      this.roundRect(x + w - 250, y + 16, 220, 54, 10);
      g.fillStyle = 'rgba(255,255,255,0.03)'; g.fill();
      g.strokeStyle = FAINT; g.lineWidth = 2; g.stroke();
      this.text('Skip tutorial', x + w - 140, y + 43, 22, DIM, 'center', '600');
      this.hit(x + w - 250, y + 16, 220, 54, { type: 'tutSkip' });
    };

    var baseDraw = DP.draw;
    DP.draw = function (dt) {
      baseDraw.call(this, dt);
      var game = this.game;
      if (!this.scale || !game.tutorView || game.tipCard === undefined) return;
      var tv = game.tutorView();
      if (!tv.tip && !tv.coach) return;
      var g = this.g;
      g.setTransform(this.scale, 0, 0, this.scale, this.ox, this.oy);
      g.save();
      g.beginPath(); g.rect(0, 0, W, H); g.clip();
      if (tv.tip) this.drawTipCard(tv.tip);
      else if (tv.coach) this.drawCoach(tv.coach, game);
      g.restore();
    };

    var baseBoard = DP.drawBoard;
    DP.drawBoard = function (game) {
      baseBoard.call(this, game);
      if (!game.tutorView || game.tipCard === undefined) return;
      var active = game.tutorActive();
      this.button(active ? 'Y  Replay tutorial' : 'Y  Tutorial', 1260, 852, 300, 52, AMBER, { type: 'tutorial' });
      this.button('X  Tips ' + (game.save.tipsOff ? 'off' : 'on'), 1580, 852, 200, 52, game.save.tipsOff ? DIM : INK, { type: 'tipsToggle' });
    };
  }

  // ---------------- editor (bottom screen) ----------------
  var Editor = root.OvershiftEditor;
  if (Editor) {
    var EP = Editor.prototype;

    EP.tutorSetup = function () {
      if (this.q.tipcard) return;
      var head = this.el.querySelector('.ed-head');
      var help = document.createElement('button');
      help.className = 'ed-icon ed-help';
      help.dataset.act = 'tutorial';
      help.title = 'Tutorial (Y on the contract board)';
      help.textContent = '?';
      var cr = head.querySelector('[data-act=ledger]');
      head.insertBefore(help, cr ? cr.nextSibling : head.firstChild);
      var coach = document.createElement('div');
      coach.className = 'ed-coach';
      var card = document.createElement('div');
      card.className = 'ed-tipcard';
      head.parentNode.insertBefore(card, head.nextSibling);
      head.parentNode.insertBefore(coach, head.nextSibling);
      this.q.coach = coach; this.q.tipcard = card; this.q.help = help;
      this.tutorKey = '';
    };

    var TARGETS = { run: '.ed-run', transport: '.ed-transport', pal: '.ed-pal' };
    EP.coachTarget = function (target) {
      if (!target) return null;
      if (target.indexOf('pal:') === 0) {
        var op = target.slice(4), tiles = this.el.querySelectorAll('.ed-pal [data-pal]');
        for (var i = 0; i < tiles.length; i++) if (tiles[i].textContent === op) return tiles[i];
        return null;
      }
      return TARGETS[target] ? this.el.querySelector(TARGETS[target]) : null;
    };

    EP.renderTutor = function (vm) {
      this.tutorSetup();
      var q = this.q, tip = vm.tip || null, coach = vm.coach || null;
      this.el.classList.toggle('ed-tipping', !!tip);
      var key = JSON.stringify([tip, coach, where()]);
      if (key !== this.tutorKey) {
        this.tutorKey = key;
        if (tip) {
          var dots = '';
          if (tip.pages > 1) for (var i = 0; i < tip.pages; i++) dots += '<i class="' + (i === tip.page ? 'on' : '') + '"></i>';
          q.tipcard.innerHTML =
            '<div class="tc-kind">' + (tip.kind === 'tut' ? 'TUTORIAL' : 'NEW ON THE DECK') + (dots ? '<span class="tc-dots">' + dots + '</span>' : '') + '</div>' +
            '<div class="tc-title' + (tip.kind === 'tut' ? ' tut' : '') + '">' + esc(tip.title) + '</div>' +
            '<div class="tc-body">' + esc(fill(tip.body)) + '</div>' +
            '<div class="tc-touch">' + esc(tip.touch) + '</div>' +
            '<div class="tc-foot">' +
            (tip.kind === 'tip' ? '<button class="tile tc-off" data-act="tipsToggle">Tips off</button>' : '') +
            (tip.secondary ? '<button class="tile" data-act="tipClose">' + esc(tip.secondary) + '</button>' : '') +
            '<button class="tile tc-go' + (tip.kind === 'tut' ? ' tut' : '') + '" data-act="tipNext">' + esc(tip.primary) + '</button>' +
            '</div>';
        } else q.tipcard.innerHTML = '';
        q.coach.classList.toggle('on', !!coach);
        q.coach.innerHTML = coach
          ? '<b>' + coach.n + '/' + coach.of + '</b><span class="tc-hint">' + esc(coach.touch) + '</span><button class="tile tc-skip" data-act="tutSkip">Skip</button>'
          : '';
      }
      // the glow goes back on after every redraw of the program, palette and transport
      var old = this.el.querySelectorAll('.coach-hl');
      for (var k = 0; k < old.length; k++) old[k].classList.remove('coach-hl');
      var t = coach && !tip ? this.coachTarget(coach.target) : null;
      if (t) t.classList.add('coach-hl');
    };

    var baseRender = EP.render;
    EP.render = function (vm) {
      baseRender.call(this, vm);
      if (vm && 'tip' in vm) this.renderTutor(vm);
    };
  }
})(typeof self !== 'undefined' ? self : this);
