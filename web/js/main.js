/*
 * Overshift boot: picks the screen role and wires the transport between screens.
 *
 *   ?screen=both    (default) one page, deck and editor side by side or stacked; hosts the game
 *   ?screen=deck    deck only; hosts the game and serves a remote editor
 *   ?screen=editor  editor only; a remote view of the host
 *
 * Transport: inside the Android shell, window.OvershiftNative.send(json) carries messages and the
 * shell delivers the other screen's messages with Overshift.receive(json). In a desktop browser,
 * ?screen=deck and ?screen=editor in two windows talk over BroadcastChannel.
 */
(function (root) {
  'use strict';
  var params = new URLSearchParams(root.location.search);
  var nativeBridge = root.OvershiftNative || null;
  // inside the Android shell the bridge names this page's role, so asset URLs need no query string
  var screen = (nativeBridge && nativeBridge.role && nativeBridge.role()) || params.get('screen') || 'both';
  var app = document.getElementById('app');
  var Overshift = root.Overshift = root.Overshift || {};
  var channel = null;

  function send(msg) {
    if (nativeBridge) { try { nativeBridge.send(JSON.stringify(msg)); } catch (e) { /* shell gone */ } }
    else if (channel) channel.postMessage(msg);
  }
  var handler = function () {};
  Overshift.receive = function (raw) {
    try { handler(typeof raw === 'string' ? JSON.parse(raw) : raw); } catch (e) { console.warn('Overshift message dropped', e); }
  };
  if (!nativeBridge && screen !== 'both' && root.BroadcastChannel) {
    channel = new BroadcastChannel('overshift');
    channel.onmessage = function (e) { Overshift.receive(e.data); };
  }

  function setLayout(l) {
    app.className = 'layout-' + l;
    Overshift.layout = l;
    root.dispatchEvent(new Event('resize'));
  }
  Overshift.setLayout = setLayout;

  // ---------------- remote editor view ----------------
  if (screen === 'editor') {
    setLayout('editor');
    var editor = new root.OvershiftEditor(document.getElementById('editor'), function (a) { send({ t: 'act', a: a }); });
    var rin = new root.OvershiftInput(function (b, phase) { send({ t: 'act', a: { type: 'btn', b: b, phase: phase } }); });
    if (nativeBridge) rin.useGamepadApi = false; // on device the top screen owns the controller
    rin.attachKeyboard(root, function (type, i) { send({ t: 'act', a: { type: type, i: i } }); });
    handler = function (m) { if (m.t === 'snap') editor.render(m.s); };
    (function loop() { rin.update(performance.now()); requestAnimationFrame(loop); })();
    send({ t: 'hello' });
    setTimeout(function () { send({ t: 'hello' }); }, 500);
    return;
  }

  // ---------------- host (deck page) ----------------
  setLayout(screen === 'deck' ? 'deck' : 'both');
  var sfx = new root.OvershiftSfx();
  var game = new root.OvershiftGame({ sfx: sfx, unlockAll: params.get('unlock') === 'all' });
  var deck = new root.OvershiftDeck(document.getElementById('deck'), game);
  var localEditor = new root.OvershiftEditor(document.getElementById('editor'), function (a) { game.act(a); });
  var input = new root.OvershiftInput(function (b, phase) { game.act({ type: 'btn', b: b, phase: phase }); });
  input.attachKeyboard(root, function (type, i) { game.act({ type: type, i: i }); });
  if (nativeBridge) input.useGamepadApi = false;

  var dirty = true, remoteSeen = false;
  game.onChange(function () { dirty = true; });
  handler = function (m) {
    if (m.t === 'hello') { remoteSeen = true; dirty = true; }
    else if (m.t === 'act') game.act(m.a);
  };

  // the shell calls this when the second screen comes or goes (hot-plug); state is untouched
  Overshift.setLayout = function (l) { setLayout(l); dirty = true; };
  Overshift.nativeButton = function (b, down) { sfx.unlock(); input.native(b, down); };
  Overshift.onPause = function () { game.pause(); dirty = true; };
  Overshift.game = game;

  ['pointerdown', 'keydown'].forEach(function (ev) { root.addEventListener(ev, function () { sfx.unlock(); }, { capture: true }); });

  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    input.update(now);
    if (game.tick(dt)) game.changed();
    deck.draw(dt);
    if (dirty) {
      dirty = false;
      var vm = game.viewModel();
      if (Overshift.layout === 'both') localEditor.render(vm);
      if (remoteSeen || nativeBridge || channel) send({ t: 'snap', s: vm });
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})(typeof self !== 'undefined' ? self : this);
