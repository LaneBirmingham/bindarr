import assert from 'node:assert/strict';
import { cardPriceText } from './cardPriceText.js';
import { resolveCardPrice } from './resolveCardPrice.js';

const t = key => ({ 'riftbound.priceUnavailable': 'Price unavailable' })[key] || key;
// Unpriced printings stay unavailable (null, never 0), whatever stale finish columns say.
for (const card of [
  { game: 'riftbound', price_trend: null },
  { game: 'riftbound', price_trend: 0 },
  { id: 'riftbound-ogn-001-298', price_trend: null, price_normal: 40, price_holofoil: 100 },
  { card_id: 'riftbound-ogn-001-298', printing: 'Normal', price_normal: 0 },
  { game: 'riftbound', printing: 'Foil', price_trend: null, price_holofoil: 0 },
]) {
  assert.strictEqual(resolveCardPrice(card, card.printing), null, 'unpriced printing must resolve to null, not 0');
  assert.strictEqual(cardPriceText(card, t), 'Price unavailable');
}
// A priced printing shows its price (by game flag or by id prefix).
const priced = { game: 'riftbound', price_trend: 161.33, price_holofoil: 300, price_currency: 'USD' };
assert.strictEqual(resolveCardPrice(priced), 161.33);
assert.strictEqual(cardPriceText(priced, t), '$161.33');
assert.strictEqual(cardPriceText({ id: 'riftbound-ven-179', price_trend: 99 }, t), '$99.00');
// Foil finish reads price_holofoil; a foil copy with no foil quote falls back to price_trend.
assert.strictEqual(resolveCardPrice(priced, 'Foil'), 300);
assert.strictEqual(cardPriceText({ ...priced, printing: 'Foil' }, t), '$300.00');
assert.strictEqual(resolveCardPrice({ game: 'riftbound', price_trend: 50 }, 'Foil'), 50);
// market_value wins over every provider price.
assert.strictEqual(resolveCardPrice({ ...priced, market_value: 7 }, 'Foil'), 7);
const manual = { game: 'riftbound', market_value: 12.5, price_trend: null };
assert.strictEqual(resolveCardPrice(manual), 12.5, 'explicit owner valuation remains usable');
assert.strictEqual(cardPriceText(manual, t), '$12.50');
assert.strictEqual(cardPriceText({ game: 'mtg', price_trend: 0 }, t), '$0.00', 'existing quoted-zero behavior is preserved');
assert.strictEqual(cardPriceText({ game: 'pokemon', printing: 'Holofoil', price_trend: 1, price_holofoil: 3 }, t), '$3.00');
console.log('cardPriceText unavailable, manual and existing-game checks passed');
