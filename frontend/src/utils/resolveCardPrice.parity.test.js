// The frontend resolver is a hand-kept twin of backend/src/utils/priceHelpers.js.
// They drifted once (the backend learned to price Riftbound and this side kept
// returning null), and nothing failed. This runs one fixture table through BOTH.
//
// Signatures differ: the backend reads `card.printing`, the frontend takes
// `printing` as an argument. Every row passes `card.printing` to both.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolveCardPrice } from './resolveCardPrice.js';

const require = createRequire(import.meta.url);
const backend = require('../../../backend/src/utils/priceHelpers.js');

const pokemon = { game: 'pokemon', price_trend: 10, price_normal: 8, price_holofoil: 30, price_reverse_holofoil: 15, price_1st_edition: 900 };
const rift = { game: 'riftbound', price_trend: 161.33, price_normal: 161.33, price_holofoil: 300 };

const cases = [
  ['pokemon holofoil', { ...pokemon, printing: 'Holofoil' }, 30],
  ['pokemon reverse holofoil', { ...pokemon, printing: 'Reverse Holofoil' }, 15],
  ['pokemon 1st edition', { ...pokemon, printing: '1st Edition' }, 900],
  ['pokemon normal', { ...pokemon, printing: 'Normal' }, 8],
  ['pokemon holofoil with no holo quote falls back to trend', { ...pokemon, price_holofoil: null, printing: 'Holofoil' }, 10],
  ['pokemon no printing', { ...pokemon }, 10],
  ['mtg quoted zero stays 0', { game: 'mtg', price_trend: 0 }, 0],
  ['mtg priced', { game: 'mtg', price_trend: 2.5 }, 2.5],
  ['riftbound priced', { ...rift, printing: 'Normal' }, 161.33],
  ['riftbound foil copy', { ...rift, printing: 'Foil' }, 300],
  ['riftbound foil copy, no foil quote', { ...rift, price_holofoil: null, printing: 'Foil' }, 161.33],
  ['riftbound unpriced is null', { game: 'riftbound', price_trend: null }, null],
  ['riftbound zero trend is null, not 0', { game: 'riftbound', price_trend: 0, price_holofoil: 0 }, null],
  ['riftbound stale foreign columns ignored', { game: 'riftbound', price_trend: null, price_normal: 40, price_holofoil: 100, printing: 'Normal' }, null],
  ['riftbound by id prefix', { id: 'riftbound-ven-179-166', price_trend: 99 }, 99],
  ['market_value beats provider price', { ...pokemon, printing: 'Holofoil', market_value: 7 }, 7],
  ['market_value beats riftbound foil', { ...rift, printing: 'Foil', market_value: 7 }, 7],
  ['market_value on an unpriced riftbound card', { game: 'riftbound', price_trend: null, market_value: 12.5 }, 12.5],
  ['market_value 0 is not a value', { ...pokemon, market_value: 0, printing: 'Normal' }, 8],
];

for (const [name, card, expected] of cases) {
  const front = resolveCardPrice(card, card.printing);
  const back = backend.resolveCardPrice(card);
  assert.strictEqual(front, expected, `frontend: ${name}`);
  assert.strictEqual(back, expected, `backend: ${name}`);
  assert.strictEqual(front, back, `twins disagree: ${name}`);
}
console.log(`resolveCardPrice parity: ${cases.length} fixtures agree across frontend and backend`);
