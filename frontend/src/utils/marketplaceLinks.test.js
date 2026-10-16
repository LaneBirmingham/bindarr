import assert from 'node:assert/strict';
import { noLinkReason, tcgplayerUrl } from './marketplaceLinks.js';

// Riftbound: the set matched a TCGplayer group, the printing did not. The reason
// must not blame the set.
const unlisted = { game: 'riftbound', id: 'riftbound-pr-001', price_trend: null };
assert.match(noLinkReason(unlisted), /printing/);
assert.doesNotMatch(noLinkReason(unlisted), /set may not be matched/);
assert.notStrictEqual(noLinkReason({ game: 'mtg', id: 'mtg-x' }), noLinkReason(unlisted), 'other games keep their own wording');

// A matched printing links to its product and needs no reason.
const listed = { game: 'riftbound', id: 'riftbound-ven-179-166', tcgplayer_product_id: 693040 };
assert.strictEqual(tcgplayerUrl(listed), 'https://www.tcgplayer.com/product/693040');
assert.strictEqual(noLinkReason(listed), null);
console.log('marketplaceLinks noLinkReason checks passed');
