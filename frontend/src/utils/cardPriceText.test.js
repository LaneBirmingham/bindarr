import assert from 'node:assert/strict';
import { cardPriceText } from './cardPriceText.js';
import { resolveCardPrice } from './resolveCardPrice.js';

const t = key => ({ 'riftbound.priceUnavailable': 'Price unavailable' })[key] || key;
for (const card of [
  { game: 'riftbound', price_trend: null },
  { id: 'riftbound-ogn-001-298', price_trend: 99, price_normal: 40, price_holofoil: 100 },
  { card_id: 'riftbound-ogn-001-298', printing: 'Normal', price_normal: 0 },
]) {
  assert.strictEqual(resolveCardPrice(card, 'Holofoil'), null, 'unsupported guessed/foreign quotes must stay unavailable');
  assert.strictEqual(cardPriceText(card, t), 'Price unavailable');
}
const manual = { game: 'riftbound', market_value: 12.5, price_trend: null };
assert.strictEqual(resolveCardPrice(manual), 12.5, 'explicit owner valuation remains usable');
assert.strictEqual(cardPriceText(manual, t), '$12.50');
assert.strictEqual(cardPriceText({ game: 'mtg', price_trend: 0 }, t), '$0.00', 'existing quoted-zero behavior is preserved');
assert.strictEqual(cardPriceText({ game: 'pokemon', printing: 'Holofoil', price_trend: 1, price_holofoil: 3 }, t), '$3.00');
console.log('cardPriceText unavailable, manual and existing-game checks passed');
