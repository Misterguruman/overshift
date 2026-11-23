/*
 * Browser smoke test: loads the page in headless Chromium at several screen shapes, fails on any
 * page error or console error, plays contract 1 with the keyboard, and checks the two-window
 * (deck + editor) mode over BroadcastChannel. Saves screenshots to the folder in argv[2].
 * Usage: CHROME=/path/to/chromium node test/browser-check.js <outdir> [baseUrl]
 */
'use strict';
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright-core');
const out = process.argv[2] || '.';
const base = process.argv[3] || 'http://127.0.0.1:8765/index.html';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  let problems = 0;
  function watch(page, label) {
    page.on('pageerror', e => { problems++; console.log(`[${label}] PAGE ERROR ${e.message}`); });
    page.on('console', m => {
      if (m.type() !== 'error') return;
      if (/fonts\.(googleapis|gstatic)|ERR_|Failed to load resource/.test(m.text())) return; // offline fonts
      problems++; console.log(`[${label}] CONSOLE ERROR ${m.text()}`);
    });
  }
  const shapes = [
    ['desktop', 1440, 900], ['phone-portrait', 390, 844], ['phone-landscape', 844, 390],
    ['thor-top', 960, 540], ['thor-bottom', 620, 540]
  ];
  for (const [name, w, h] of shapes) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    watch(page, name);
    await page.goto(base + '?unlock=all', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/board-${name}.png` });
    await page.keyboard.press('KeyX'); // close the contract board
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${out}/edit-${name}.png` });
    await ctx.close();
  }

  // play contract 1 by keyboard on the desktop layout
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  watch(page, 'play');
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyZ'); // open contract 1 from the board
  for (let k = 0; k < 3; k++) {
    await page.keyboard.press('ArrowLeft'); // back to GRAB (arrows pick the operation)
    await page.evaluate(() => { Overshift.game.paletteIdx = 0; });
    await page.keyboard.press('KeyZ');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('KeyZ');
  }
  const prog = await page.evaluate(() => Overshift.game.program.map(l => l.op).join(' '));
  console.log('built program:', prog);
  await page.screenshot({ path: `${out}/play-built.png` });
  await page.keyboard.press('Space'); // run
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/play-running.png` });
  await page.waitForFunction(() => Overshift.game.mode === 'done', null, { timeout: 15000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/play-cleared.png` });
  const cleared = await page.evaluate(() => Overshift.game.overlay === 'cleared');
  console.log('contract 1 cleared in browser:', cleared);
  if (!cleared) problems++;

  // tap test: tap a palette tile and the Run button on the editor
  await page.keyboard.press('KeyX');
  await page.click('.ed-transport [data-act=reset]');
  const n0 = await page.evaluate(() => Overshift.game.program.length);
  await page.click('.ed-pal .tile >> nth=0');
  const n1 = await page.evaluate(() => Overshift.game.program.length);
  console.log('tile tap inserts a line:', n1 === n0 + 1);
  if (n1 !== n0 + 1) problems++;
  await ctx.close();

  // a later contract with blocks, run fast, screenshot
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await ctx2.newPage();
  watch(p2, 'double-time');
  await p2.goto(base + '?unlock=all', { waitUntil: 'load' });
  await p2.evaluate(() => {
    const g = Overshift.game; g.selectLevel(9);
    g.program = OvershiftCore.parseProgram(OvershiftCore.LEVELS[9].reference); g.cursor = 3; g.afterEdit(); g.changed();
  });
  await p2.keyboard.press('BracketRight'); await p2.keyboard.press('BracketRight'); await p2.keyboard.press('BracketRight');
  await p2.waitForTimeout(500);
  await p2.screenshot({ path: `${out}/double-time-stepping.png` });
  await p2.evaluate(() => { const g = Overshift.game; g.program[2].arg = 'magenta'; g.afterEdit(); g.run(true); g.changed(); });
  await p2.waitForFunction(() => Overshift.game.mode === 'done', null, { timeout: 15000 });
  await p2.waitForTimeout(300);
  await p2.screenshot({ path: `${out}/double-time-fault.png` });
  console.log('fault message:', await p2.evaluate(() => Overshift.game.sim.msg));
  await ctx2.close();

  // two windows: deck host + remote editor over BroadcastChannel
  const ctx3 = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const deckPage = await ctx3.newPage(); watch(deckPage, 'deck');
  await deckPage.goto(base + '?screen=deck&unlock=all', { waitUntil: 'load' });
  await deckPage.evaluate(() => { Overshift.game.overlay = null; Overshift.game.changed(); });
  const edPage = await ctx3.newPage(); watch(edPage, 'editor');
  await edPage.setViewportSize({ width: 620, height: 540 });
  await edPage.goto(base + '?screen=editor', { waitUntil: 'load' });
  await edPage.waitForSelector('.ed-pal .tile', { timeout: 5000 });
  await edPage.click('.ed-pal .tile >> nth=0');
  await deckPage.waitForTimeout(300);
  const remoteLen = await deckPage.evaluate(() => Overshift.game.program.length);
  const edRows = await edPage.evaluate(() => document.querySelectorAll('.ed-prog .row').length - 1);
  console.log('remote editor tap reached host:', remoteLen > 0, 'editor shows', edRows, 'lines, host has', remoteLen);
  if (!(remoteLen > 0 && edRows === remoteLen)) problems++;
  await deckPage.screenshot({ path: `${out}/two-window-deck.png` });
  await edPage.screenshot({ path: `${out}/two-window-editor.png` });
  // hot-plug: deck page switches to both, keeps the program
  await deckPage.evaluate(() => Overshift.setLayout('both'));
  await deckPage.waitForTimeout(200);
  const kept = await deckPage.evaluate(() => Overshift.game.program.length);
  console.log('layout switch kept state:', kept === remoteLen);
  if (kept !== remoteLen) problems++;
  await ctx3.close();

  await browser.close();
  console.log(problems ? `${problems} problem(s)` : 'browser check: no errors');
  process.exit(problems ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
