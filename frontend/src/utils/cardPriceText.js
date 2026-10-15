import { priceText } from './formatPrice.js';
import { resolveCardPrice } from './resolveCardPrice.js';

// Unknown Riftbound prices stay unknown in every card view, including public
// shares. Explicit owner values are labelled separately in the inspector.
export function cardPriceText(card, t, printing = card?.printing) {
  const price = resolveCardPrice(card, printing);
  return price === null ? t('riftbound.priceUnavailable') : priceText(price, card?.price_currency);
}
