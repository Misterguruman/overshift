/*
 * Ledger economy check: `npm run curve` prints the first-pass curve from the design doc
 * ("Economy curve") using the real contract data, so tuning stays a data change in ledger.js.
 * "Efficient" means 20% under par Cycles and 15% under par Size.
 */
'use strict';
globalThis.self = globalThis;
const path = require('path');
const C = globalThis.OvershiftCore = require(path.join(__dirname, '../web/js/core.js'));
const F = globalThis.OvershiftFloor = require(path.join(__dirname, '../web/js/floor.js'));
const LG = require(path.join(__dirname, '../web/js/ledger.js'));
const ALL = F.ALL;

const par = lv => LG.parRun(lv);
const eff = lv => ({ size: lv.parSize / 1.15, cycles: lv.parCycles * 0.8, parts: lv.parParts });
function stage(name, levels, bays, oc, hours) {
  const best = mk => levels.map(lv => LG.rate(lv, mk(lv), oc)).sort((a, b) => b - a).slice(0, bays).reduce((a, b) => a + b, 0);
  const firstPay = levels.reduce((t, lv) => t + LG.baseRate(lv) * (LG.FIRST_CLEAR_HOURS + 2 * LG.CHIP_HOURS), 0);
  const p = best(par), e = best(eff);
  console.log(`${name.padEnd(24)} ${String(bays).padStart(2)} bays  OC ${oc}  ${String(hours).padStart(2)}h | ` +
    `${LG.fmt(p).padStart(6)} / ${LG.fmt(e).padStart(6)} cr/h | night ${LG.fmt(p * hours).padStart(7)} / ${LG.fmt(e * hours).padStart(7)} | ` +
    `clears + chips pay ${LG.fmt(firstPay)}`);
}
console.log('stage                    setup             | income par / efficient | one night pays        | one-off pay');
stage('Night Shift cleared', ALL.slice(0, 10), 3, 0, 8);
stage('Junction Floor cleared', ALL.slice(0, 20), 5, 1, 10);
console.log('\nUpgrade costs (cr):');
for (const u of LG.UPGRADES) console.log(`  ${u.name.padEnd(13)} ${u.costs.map(c => LG.fmt(c, true)).join(', ')}`);
