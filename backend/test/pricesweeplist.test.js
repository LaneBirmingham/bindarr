// Every sweep the server runs must have a SWEEP_COLUMN key. shouldSweepPrices()
// answers false for an unknown key and markPricesSwept() no-ops, so a provider added
// to the sweep list but not to that map goes quiet with no error anywhere (tcgcsv
// first, then Lorcana). Plain node + assert. Run: `node test/pricesweeplist.test.js`
const assert = require('assert');
const { PRICE_SWEEPS } = require('../src/utils/priceSweeps');
const { SWEEP_COLUMN } = require('../src/utils/priceHelpers');

assert.ok(PRICE_SWEEPS.length >= 7, 'the sweep list is not empty');
const keys = PRICE_SWEEPS.map(s => s.key);
assert.strictEqual(new Set(keys).size, keys.length, 'no provider is listed twice');
for (const sweep of PRICE_SWEEPS) {
  assert.strictEqual(typeof sweep.run, 'function', `${sweep.key} has a run function`);
  assert.ok(SWEEP_COLUMN[sweep.key], `sweep "${sweep.key}" has no SWEEP_COLUMN key and would never run`);
}
for (const key of Object.keys(SWEEP_COLUMN)) {
  assert.ok(keys.includes(key), `SWEEP_COLUMN has "${key}" but no sweep in the list uses it`);
}
console.log('pricesweeplist.test.js: every listed sweep has a gate column and vice versa');
