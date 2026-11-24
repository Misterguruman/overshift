/*
 * Overshift effects on the bottom screen (the editor): small CSS touches that answer what just
 * happened. A new line pops in, credits bump when they rise, a purchase glows, a clear sweeps
 * light across the screen. Purely visual; styles are injected here so index.html stays as it is.
 * Off with ?fx=off; the system's reduced-motion setting keeps only the colour changes.
 */
(function (root) {
  'use strict';
  var E = root.OvershiftEditor;
  if (!E || !root.document) return;
  var off = false;
  try { off = new URLSearchParams(root.location.search).get('fx') === 'off'; } catch (e) { /* ignore */ }
  if (off) return;

  var css = [
    '@keyframes fxPop{0%{transform:scale(.6);opacity:0;filter:brightness(2.4)}60%{transform:scale(1.04);opacity:1}100%{transform:scale(1);filter:none}}',
    '@keyframes fxBump{0%{transform:scale(1)}30%{transform:scale(1.12);color:#5dffa8;text-shadow:0 0 14px #5dffa8}100%{transform:scale(1)}}',
    '@keyframes fxSpend{0%{color:#ffb31f;text-shadow:0 0 14px #ffb31f}100%{}}',
    '@keyframes fxGlow{0%{box-shadow:0 0 0 2px #5dffa8,0 0 28px #5dffa8;background-color:rgba(93,255,168,.22)}100%{box-shadow:none}}',
    '@keyframes fxMsg{0%{filter:brightness(2.2);letter-spacing:.06em}100%{filter:none}}',
    '@keyframes fxSweep{0%{transform:translateX(-120%)}100%{transform:translateX(120%)}}',
    '@keyframes fxFault{0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}40%{transform:translateX(5px)}60%{transform:translateX(-3px)}80%{transform:translateX(2px)}}',
    '.fx-pop{animation:fxPop .32s cubic-bezier(.2,1.4,.4,1)}',
    '.fx-bump{display:inline-block;animation:fxBump .5s ease-out}',
    '.fx-spend{animation:fxSpend .7s ease-out}',
    '.fx-glow{animation:fxGlow .9s ease-out}',
    '.fx-msg{animation:fxMsg .6s ease-out}',
    '.fx-fault{animation:fxFault .35s ease-out}',
    '.ed{position:relative}',
    '.fx-sweep{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:50}',
    '.fx-sweep::before{content:"";position:absolute;top:0;bottom:0;left:0;width:60%;background:linear-gradient(100deg,rgba(93,255,168,0),rgba(93,255,168,.28),rgba(255,255,255,.35),rgba(93,255,168,.28),rgba(93,255,168,0));animation:fxSweep .9s ease-out forwards}',
    '@media (prefers-reduced-motion: reduce){.fx-pop,.fx-bump,.fx-fault{animation:none}.fx-sweep{display:none}}'
  ].join('\n');
  var style = root.document.createElement('style');
  style.textContent = css;
  root.document.head.appendChild(style);

  function restart(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth; // reflow so the animation plays again
    el.classList.add(cls);
  }

  var render = E.prototype.render;
  E.prototype.render = function (vm) {
    var prev = this.fxPrev || {};
    render.apply(this, arguments);
    if (!vm) return;
    var q = this.q || {}, now = {
      len: vm.program ? vm.program.length : 0, level: vm.level && vm.level.index, cursor: vm.cursor,
      credits: vm.ledger ? vm.ledger.credits : null, flash: vm.flash ? vm.flash.id : null,
      overlay: vm.overlay, status: vm.status, mode: vm.mode
    };
    this.fxPrev = now;
    if (prev.level === undefined) return;

    // a line just went in: it pops into place
    if (!vm.ledger && now.level === prev.level && now.len > prev.len && q.prog) {
      var row = q.prog.querySelector('.row[data-i="' + vm.cursor + '"]');
      restart(row, 'fx-pop');
    }
    // credits rise or are spent
    if (now.credits !== null && prev.credits !== null && prev.credits !== undefined && now.credits !== prev.credits && q.title) {
      var b = q.title.querySelector('b');
      restart(now.credits > prev.credits ? b || q.title : q.title, now.credits > prev.credits ? 'fx-bump' : 'fx-spend');
    }
    // a good message (a purchase, a bay filled) glows, and the row it was about lights up
    if (now.flash && now.flash !== prev.flash && vm.flash.kind === 'ok') {
      restart(q.msg, 'fx-msg');
      if (vm.ledger && q.ledger) restart(q.ledger.querySelector('.lg-row.sel'), 'fx-glow');
    }
    // a fault shakes the message line
    if (now.status === 'fault' && prev.status !== 'fault') restart(q.msg, 'fx-fault');
    // a clear sweeps light across the screen
    if (now.overlay === 'cleared' && prev.overlay !== 'cleared' && this.el) {
      var sw = root.document.createElement('div');
      sw.className = 'fx-sweep';
      this.el.appendChild(sw);
      setTimeout(function () { if (sw.parentNode) sw.parentNode.removeChild(sw); }, 1000);
    }
  };
})(typeof self !== 'undefined' ? self : this);
