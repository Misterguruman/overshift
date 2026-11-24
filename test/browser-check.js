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

  // the first-run tutorial and tips (tutor.js, tutorview.js), played by touch on one screen
  {
    const tc = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const tp = await tc.newPage();
    watch(tp, 'tutorial');
    await tp.goto(base, { waitUntil: 'load' });
    await tp.waitForSelector('.ed-tipping .tc-go', { timeout: 5000 });
    const st = await tp.evaluate(() => ({ state: Overshift.game.save.tut.state, overlay: Overshift.game.overlay, title: document.querySelector('.tc-title').textContent }));
    console.log('fresh save opens the tutorial:', JSON.stringify(st));
    if (st.state !== 'active' || st.overlay !== null) problems++;
    await tp.screenshot({ path: `${out}/tut-welcome-desktop.png` });
    await tp.click('.tc-go');
    const steps = [];
    for (let k = 0; k < 2; k++) {
      await tp.waitForSelector('.ed-pal .coach-hl', { timeout: 3000 });
      steps.push(await tp.evaluate(() => document.querySelector('.coach-hl').textContent));
      if (k === 0) await tp.screenshot({ path: `${out}/tut-grab-desktop.png` });
      await tp.click('.ed-pal .coach-hl');
    }
    await tp.waitForSelector('.ed-run.coach-hl', { timeout: 3000 });
    console.log('coach points at', steps.join(', '), 'then Run');
    if (steps.join() !== 'GRAB,SHIP') problems++;
    await tp.click('.ed-run');
    await tp.waitForFunction(() => Overshift.game.save.tut.step === 'more', null, { timeout: 15000 });
    await tp.screenshot({ path: `${out}/tut-more-desktop.png` });
    for (let k = 0; k < 2; k++) { await tp.click('.ed-pal .tile >> nth=0'); await tp.click('.ed-pal .tile >> nth=1'); }
    await tp.click('.ed-run');
    await tp.waitForFunction(() => Overshift.game.save.tut.step === 'cleared', null, { timeout: 15000 });
    await tp.waitForTimeout(200);
    await tp.screenshot({ path: `${out}/tut-cleared-desktop.png` });
    await tp.keyboard.press('KeyZ'); // A: next contract
    await tp.waitForTimeout(200);
    const end = await tp.evaluate(() => ({ state: Overshift.game.save.tut.state, level: Overshift.game.level.id, coach: !!document.querySelector('.ed-coach.on') }));
    console.log('tutorial finished:', JSON.stringify(end));
    if (end.state !== 'done' || end.level !== 'defects' || end.coach) problems++;
    // a fault opens its tip; the card's button closes it
    await tp.evaluate(() => { const g = Overshift.game; g.program = OvershiftCore.parseProgram('SHIP'); g.afterEdit(); g.run(true); g.changed(); });
    await tp.waitForSelector('.ed-tipping .tc-go', { timeout: 15000 });
    await tp.screenshot({ path: `${out}/tip-fault-desktop.png` });
    await tp.click('.tc-go');
    await tp.waitForTimeout(150);
    const closed = await tp.evaluate(() => !Overshift.game.tipCard && !document.querySelector('.ed-tipping'));
    console.log('fault tip shown and closed:', closed);
    if (!closed) problems++;
    await tc.close();

    // the Thor's two screens: the card's gamepad prompts on top, its touch buttons below
    const t2 = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const top = await t2.newPage(); watch(top, 'tut-top');
    await top.goto(base + '?screen=deck', { waitUntil: 'load' });
    const bottom = await t2.newPage(); watch(bottom, 'tut-bottom');
    await bottom.setViewportSize({ width: 620, height: 540 });
    await bottom.goto(base + '?screen=editor', { waitUntil: 'load' });
    await bottom.waitForSelector('.ed-tipping .tc-go', { timeout: 5000 });
    const shot = async name => { await top.waitForTimeout(250); await top.screenshot({ path: `${out}/${name}-thor-top.png` }); await bottom.screenshot({ path: `${out}/${name}-thor-bottom.png` }); };
    await shot('tut-welcome');
    await top.keyboard.press('KeyZ'); // A on the top screen starts it
    await bottom.waitForSelector('.ed-coach.on', { timeout: 3000 });
    const edText = await bottom.evaluate(() => document.querySelector('.ed-coach').textContent);
    console.log('two-screen coach on the bottom screen:', edText);
    await shot('tut-grab');
    await bottom.click('.ed-coach .tc-skip');
    await top.waitForTimeout(200);
    const skipped = await top.evaluate(() => Overshift.game.save.tut.state);
    console.log('Skip on the bottom screen:', skipped);
    if (skipped !== 'skipped') problems++;
    for (const [lvl, tip] of [['two-docks', 'floor'], ['first-run', 'truck']]) {
      await top.evaluate(id => { const g = Overshift.game; g.unlockAll = true; g.act({ type: 'level', i: OvershiftGame.LEVELS.findIndex(l => l.id === id) }); }, lvl);
      await bottom.waitForSelector('.ed-tipping .tc-go', { timeout: 3000 });
      const id = await top.evaluate(() => Overshift.game.tipCard && Overshift.game.tipCard.id);
      if (id !== tip) { problems++; console.log('expected tip', tip, 'got', id); }
      await shot('tip-' + tip);
      await bottom.click('.tc-go'); if (tip === 'floor') await bottom.click('.tc-go');
    }
    await top.evaluate(() => { const g = Overshift.game; g.save.cleared['clock-in'] = true; g.overlay = 'board'; g.act({ type: 'ledger' }); });
    await bottom.waitForSelector('.ed-tipping .tc-go', { timeout: 3000 });
    await shot('tip-ledger');
    await bottom.click('.tc-go');
    await top.evaluate(() => { const g = Overshift.game; g.overlay = 'board'; g.boardSel = 0; g.changed(); });
    await shot('board-tutorial');
    await t2.close();
  }

  // play contract 1 by keyboard on the desktop layout
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  watch(page, 'play');
  await page.goto(base + '?tutorial=off&tips=off', { waitUntil: 'load' });
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

  // chapter 2: build a floor by tapping the bottom-screen map, then run every reference floor
  for (const [name, w, h] of [['ch2-desktop', 1440, 900], ['ch2-thor-top', 960, 540], ['ch2-thor-bottom', 620, 540]]) {
    const c4 = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const p4 = await c4.newPage();
    watch(p4, name);
    await p4.goto(base + '?unlock=all', { waitUntil: 'load' });
    await p4.evaluate(() => { const g = Overshift.game; g.selectLevel(OvershiftCore.LEVELS.length); g.changed(); });
    await p4.waitForTimeout(250);
    await p4.screenshot({ path: `${out}/${name}-build-empty.png` });
    if (name === 'ch2-desktop') {
      await p4.click('.ed-map [data-tile="1,2"]');
      await p4.click('.ed-map [data-tile="2,2"]');
      const laid = await p4.evaluate(() => Object.keys(Overshift.game.floor.tiles).length);
      console.log('map taps lay belts:', laid === 2);
      if (laid !== 2) problems++;
      await p4.keyboard.press('Tab');
      const mode = await p4.evaluate(() => Overshift.game.fmode);
      console.log('Tab with no node stays in Build:', mode === 'build');
    }
    await p4.evaluate(() => {
      const g = Overshift.game; g.floor = JSON.parse(JSON.stringify(g.level.refFloor));
      g.active = OvershiftFloor.placedSlots(g.floor)[0]; g.bindActive(); g.afterEdit(); g.changed();
    });
    await p4.waitForTimeout(200);
    await p4.screenshot({ path: `${out}/${name}-build-ref.png` });
    await p4.keyboard.press('Tab');
    await p4.waitForTimeout(200);
    await p4.screenshot({ path: `${out}/${name}-program.png` });
    await p4.keyboard.press('Space');
    await p4.waitForTimeout(1200);
    await p4.screenshot({ path: `${out}/${name}-running.png` });
    await c4.close();
  }
  {
    const c5 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p5 = await c5.newPage(); watch(p5, 'ch2-all');
    await p5.goto(base + '?unlock=all', { waitUntil: 'load' });
    const n1 = await p5.evaluate(() => OvershiftCore.LEVELS.length);
    for (let i = 0; i < 10; i++) {
      await p5.evaluate(i => {
        const g = Overshift.game; g.selectLevel(i); g.floor = JSON.parse(JSON.stringify(g.level.refFloor));
        g.active = OvershiftFloor.placedSlots(g.floor)[0]; g.bindActive(); g.afterEdit(); g.run(true);
        let k = 0; while (g.mode !== 'done' && k++ < 2000) g.tick(5);
        g.changed();
      }, n1 + i);
      await p5.waitForTimeout(100);
      const r = await p5.evaluate(() => ({ id: Overshift.game.level.id, ok: Overshift.game.overlay === 'cleared' }));
      if (!r.ok) { problems++; console.log('chapter 2 reference did not clear in browser:', r.id); }
      if (i === 9) await p5.screenshot({ path: `${out}/ch2-night-audit-cleared.png` });
    }
    await p5.evaluate(() => { const g = Overshift.game; g.overlay = 'board'; g.boardSel = OvershiftCore.LEVELS.length; g.changed(); });
    await p5.waitForTimeout(200);
    await p5.screenshot({ path: `${out}/ch2-board.png` });
    console.log('chapter 2 references ran in browser');

    // the Ledger: the ten floors just cleared now earn in bays
    await p5.evaluate(() => { const g = Overshift.game; g.overlay = 'board'; g.boardSel = 0; g.changed(); });
    await p5.keyboard.press('KeyQ'); // L1: the board's first page is the Ledger
    await p5.waitForTimeout(250);
    const lg = await p5.evaluate(() => ({ overlay: Overshift.game.overlay, rows: document.querySelectorAll('.ed-ledger .lg-row').length, credits: Overshift.game.save.ledger.credits }));
    console.log('Ledger page:', JSON.stringify(lg));
    if (lg.overlay !== 'ledger' || lg.rows !== 10 || !(lg.credits > 0)) problems++;
    await p5.screenshot({ path: `${out}/ledger-bays.png` });
    // tap a row twice: select, then move it out of its bay
    const inBay0 = await p5.evaluate(() => Overshift.game.save.ledger.bays.length);
    const idx = await p5.evaluate(() => [...document.querySelectorAll('.ed-ledger .lg-row')].findIndex(e => e.classList.contains('in')));
    await p5.evaluate(i => { const g = Overshift.game; g.ledgerSel = i === 0 ? 1 : 0; g.changed(); }, idx);
    await p5.waitForTimeout(100);
    await p5.click(`.ed-ledger .lg-row >> nth=${idx}`);
    await p5.waitForTimeout(100);
    await p5.click(`.ed-ledger .lg-row >> nth=${idx}`);
    await p5.waitForTimeout(100);
    const inBay1 = await p5.evaluate(() => Overshift.game.save.ledger.bays.length);
    console.log('tapping a contract twice moves it out of its bay:', inBay1 === inBay0 - 1, inBay0, '->', inBay1);
    if (inBay1 !== inBay0 - 1) problems++;
    // Upgrades tab: press and hold to buy
    await p5.click('.ed-ledger [data-ltab="1"]');
    await p5.evaluate(() => { Overshift.game.save.ledger.credits = 5000; Overshift.game.changed(); });
    await p5.waitForTimeout(150);
    const row = await p5.$('.ed-ledger .lg-row >> nth=0');
    const box = await row.boundingBox();
    await p5.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p5.mouse.down();
    await p5.waitForTimeout(250);
    await p5.screenshot({ path: `${out}/ledger-upgrades-holding.png` });
    await p5.waitForTimeout(450);
    await p5.mouse.up();
    const bought = await p5.evaluate(() => Overshift.game.save.ledger.up.bays);
    console.log('press and hold bought a bay:', bought === 1);
    if (bought !== 1) problems++;
    await p5.waitForTimeout(150);
    await p5.screenshot({ path: `${out}/ledger-upgrades.png` });
    // time away: move the stored time back 3 hours and settle as on resume
    await p5.evaluate(() => { const g = Overshift.game; g.ledgerPause(); g.save.ledger.lastSeen -= 3 * 3600 * 1000; g.ledgerResume(); });
    await p5.waitForTimeout(2800);
    const rep = await p5.evaluate(() => Overshift.game.overlay);
    console.log('3 hours away shows the Shift report:', rep === 'report');
    if (rep !== 'report') problems++;
    await p5.screenshot({ path: `${out}/ledger-shift-report.png` });
    await p5.keyboard.press('KeyZ');
    await c5.close();
  }
  // the Ledger at the Thor's two screen shapes
  for (const [name, w, h] of [['thor-top', 960, 540], ['thor-bottom', 620, 540], ['phone-portrait', 390, 844]]) {
    const c6 = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const p6 = await c6.newPage(); watch(p6, 'ledger-' + name);
    await p6.goto(base + '?unlock=all', { waitUntil: 'load' });
    await p6.evaluate(() => {
      const g = Overshift.game, all = OvershiftGame.LEVELS;
      for (const lv of all.slice(0, 13)) OvershiftLedger.recordClear(g.save, all, lv, OvershiftLedger.parRun(lv));
      g.save.ledger.credits = 2345; g.openLedger(); g.changed();
    });
    await p6.waitForTimeout(250);
    await p6.screenshot({ path: `${out}/ledger-${name}.png` });
    await c6.close();
  }

  // chapter 3 (Dispatch): truck contracts at every screen shape, then every reference in the browser
  for (const [name, w, h] of [['ch3-desktop', 1440, 900], ['ch3-thor-top', 960, 540], ['ch3-thor-bottom', 620, 540], ['ch3-phone', 390, 844]]) {
    const c7 = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const p7 = await c7.newPage(); watch(p7, name);
    await p7.goto(base + '?unlock=all', { waitUntil: 'load' });
    await p7.evaluate(() => {
      const g = Overshift.game, D = OvershiftDispatch, i = D.LEVELS[6].index;
      g.selectLevel(i); g.routes = D.LEVELS[6].refPrograms.map(p => JSON.parse(JSON.stringify(p))); g.active = 0; g.bindTruck(); g.afterEdit(); g.changed();
    });
    await p7.waitForTimeout(250);
    await p7.screenshot({ path: `${out}/${name}-edit.png` });
    if (name === 'ch3-desktop') {
      await p7.click('.ed-modes [data-truck="1"]');
      const act = await p7.evaluate(() => Overshift.game.active);
      console.log('tapping the Truck 2 tab switches trucks:', act === 1);
      if (act !== 1) problems++;
    }
    await p7.evaluate(() => { const g = Overshift.game; g.run(false); for (let k = 0; k < 14; k++) g.stepOnce(); g.mode = 'pause'; g.changed(); });
    await p7.waitForTimeout(600);
    await p7.screenshot({ path: `${out}/${name}-running.png` });
    await c7.close();
  }
  {
    const c8 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p8 = await c8.newPage(); watch(p8, 'ch3-all');
    await p8.goto(base + '?unlock=all', { waitUntil: 'load' });
    for (let i = 0; i < 8; i++) {
      const r = await p8.evaluate(i => {
        const g = Overshift.game, lv = OvershiftDispatch.LEVELS[i];
        g.selectLevel(lv.index); g.routes = lv.refPrograms.map(p => JSON.parse(JSON.stringify(p))); g.active = 0; g.bindTruck(); g.afterEdit(); g.run(true);
        let k = 0; while (g.mode !== 'done' && k++ < 5000) g.tick(5);
        g.changed();
        return { id: lv.id, ok: g.overlay === 'cleared' };
      }, i);
      if (!r.ok) { problems++; console.log('chapter 3 reference did not clear in browser:', r.id); }
      if (i === 7) { await p8.waitForTimeout(150); await p8.screenshot({ path: `${out}/ch3-standing-orders-cleared.png` }); }
    }
    console.log('chapter 3 references ran in browser');
    await p8.evaluate(() => { const g = Overshift.game; g.overlay = 'board'; g.boardSel = OvershiftDispatch.LEVELS[0].index; g.changed(); });
    await p8.waitForTimeout(200);
    await p8.screenshot({ path: `${out}/ch3-board.png` });
    await c8.close();
  }
  // the Ledger's Dispatch tab and the city route, at the Thor's two screen shapes and on a phone
  for (const [name, w, h] of [['thor-top', 960, 540], ['thor-bottom', 620, 540], ['phone-portrait', 390, 844], ['desktop', 1440, 900]]) {
    const c9 = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const p9 = await c9.newPage(); watch(p9, 'dispatch-' + name);
    await p9.goto(base + '?unlock=all', { waitUntil: 'load' });
    await p9.evaluate(() => {
      const g = Overshift.game, all = OvershiftGame.LEVELS;
      for (const lv of all.slice(0, 20)) { g.save.cleared[lv.id] = true; OvershiftLedger.recordClear(g.save, all, lv, OvershiftLedger.parRun(lv)); }
      g.save.routes['city-routes'] = [OvershiftCore.parseProgram('LOAD; IF to:market; DRIVE market; ELSE; IF to:heights; DRIVE heights; ELSE; DRIVE canal; DRIVE spire; END; END')];
      g.save.ledger.credits = 12345; g.dispatchRefresh(true);
      g.openLedger(); g.setLedgerTab(2); g.changed();
    });
    await p9.waitForTimeout(300);
    await p9.screenshot({ path: `${out}/dispatch-tab-${name}.png` });
    const d = await p9.evaluate(() => Overshift.game.save.ledger.dispatch);
    if (!(d && d.ok && d.rate > 0)) { problems++; console.log('city route did not earn:', JSON.stringify(d)); }
    if (name === 'desktop') {
      console.log('city route earns', d.rate, 'cr/h');
      await p9.click('.ed-ledger [data-act=lopen]');
      await p9.waitForTimeout(200);
      const city = await p9.evaluate(() => !!Overshift.game.level.city && Overshift.game.overlay === null);
      console.log('Edit route opens the city route:', city);
      if (!city) problems++;
      await p9.screenshot({ path: `${out}/city-edit.png` });
      await p9.evaluate(() => { const g = Overshift.game; g.run(false); for (let k = 0; k < 60; k++) g.stepOnce(); g.mode = 'pause'; g.changed(); });
      await p9.waitForTimeout(600);
      await p9.screenshot({ path: `${out}/city-running.png` });
      await p9.evaluate(() => { const g = Overshift.game; g.run(true); let k = 0; while (g.mode !== 'done' && k++ < 20000) g.tick(5); g.changed(); });
      await p9.waitForTimeout(200);
      await p9.screenshot({ path: `${out}/city-done.png` });
      console.log('city sample:', await p9.evaluate(() => Overshift.game.sim.msg));
    } else if (name === 'thor-top' || name === 'thor-bottom') {
      // the city route in the editor at this shape
      await p9.evaluate(() => { const g = Overshift.game; g.openCity(); g.changed(); });
      await p9.waitForTimeout(250);
      await p9.screenshot({ path: `${out}/city-edit-${name}.png` });
    }
    await c9.close();
  }

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
