// Riftbound prices from TCGCSV category 89 (TCGplayer's Riftbound catalogue).
//
// Offline. Every product, price row and group below was copied out of a live TCGCSV
// response while this was written, so the shapes and the numbers are the real ones —
// but nothing here makes a request, because what needs pinning is the JOIN and the
// four ways it can go quietly wrong. None of them fails loudly:
//
//   * a number key that strips '*', which collapses an Overnumbered printing onto its
//     Signature twin and then drops both as "ambiguous" (silently unpriced);
//   * a duplicate number that is discarded instead of resolved, losing the 59 OPP
//     promos and 7 token keys that legitimately share one;
//   * a finish map without 'Foil' — which is most of the catalogue;
//   * a re-cache that overwrites prices with the snapshot's nulls, erasing the whole
//     sweep on the next boot.
//
// The OPP numbers below are the reason this file exists: the plain promo is $12.89
// and the "Metal (Prize Wall)" printing sharing its Number is $1,586.93. Picking the
// wrong one is not an error message, it is a collection that reads 100x high.
//
// Measured over the bundled 1,356 printings against live data: 1,349 (99.5%) resolve
// to a product with a market price; the 5 misses are all in PR.
//
// No framework — plain node + assert. Run: `node test/riftboundprices.test.js`
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bindarr-riftbound-prices-'));
process.env.DB_PATH = path.join(temporary, 'bindarr.db');
process.env.DEFAULT_ADMIN_PASSWORD = '';

const db = require('../src/db');
const prices = require('../src/riftboundPrices');
const tcgcsv = require('../src/tcgcsvApi');
const api = require('../src/riftboundApi');
const { cacheNormalizedCards } = require('../src/utils/cardCache');
const { resolveCardPrice, shouldSweepPrices, markPricesSwept, priceMetadata } = require('../src/utils/priceHelpers');

// Verbatim groups from /tcgplayer/89/groups. Note the abbreviations ARE our set codes.
const GROUPS = [
  { groupId: 24344, name: 'Origins', abbreviation: 'OGN', categoryId: 89 },
  { groupId: 24439, name: 'Origins: Proving Grounds', abbreviation: 'OGS', categoryId: 89 },
  { groupId: 24519, name: 'Spiritforged', abbreviation: 'SFD', categoryId: 89 },
  { groupId: 24560, name: 'Unleashed', abbreviation: 'UNL', categoryId: 89 },
  { groupId: 24698, name: 'Vendetta', abbreviation: 'VEN', categoryId: 89 },
  { groupId: 24528, name: 'Riftbound Organized Play Promotional Cards', abbreviation: 'OPP', categoryId: 89 },
  { groupId: 24343, name: 'Riftbound Promotional Cards', abbreviation: 'PR', categoryId: 89 },
  { groupId: 24552, name: 'Riftbound Judge Promotional Cards', abbreviation: 'JDG', categoryId: 89 },
  // Categories we deliberately do not carry: a new set's group must not be mistaken
  // for one of ours, and matching by abbreviation alone is what guarantees that.
  { groupId: 24819, name: 'Radiance', abbreviation: 'RAD', categoryId: 89 },
  { groupId: 24832, name: 'Legacy', abbreviation: 'LGC', categoryId: 89 },
];

const ext = (Number_, Rarity) => [{ name: 'Number', displayName: 'Card Number', value: Number_ },
  { name: 'Rarity', displayName: 'Rarity', value: Rarity }];

// Verbatim UNL products 685521/685522 (Vi, Overnumbered vs Signature) and
// 685527/685605 (Master Yi), plus the sealed booster pack that carries no Number.
const PRODUCTS_UNL = [
  { productId: 678149, name: 'Unleashed - Booster Pack', cleanName: 'Unleashed Booster Pack',
    url: 'https://www.tcgplayer.com/product/678149/x', groupId: 24560, extendedData: [] },
  { productId: 685521, name: 'Vi, Piltover Enforcer (Overnumbered)', cleanName: 'Vi Piltover Enforcer Overnumbered',
    url: 'https://www.tcgplayer.com/product/685521/x', groupId: 24560, extendedData: ext('229/219', 'Showcase') },
  { productId: 685522, name: 'Vi, Piltover Enforcer (Signature)', cleanName: 'Vi Piltover Enforcer Signature',
    url: 'https://www.tcgplayer.com/product/685522/x', groupId: 24560, extendedData: ext('229*/219', 'Showcase') },
  { productId: 685527, name: 'Master Yi, Wuju Master (Overnumbered)', cleanName: 'Master Yi Wuju Master Overnumbered',
    url: 'https://www.tcgplayer.com/product/685527/x', groupId: 24560, extendedData: ext('231/219', 'Showcase') },
  { productId: 685605, name: 'Master Yi, Wuju Master (Signature)', cleanName: 'Master Yi Wuju Master Signature',
    url: 'https://www.tcgplayer.com/product/685605/x', groupId: 24560, extendedData: ext('231*/219', 'Showcase') },
  // A token face. Number carries a double slash because the card is two faces.
  { productId: 695879, name: 'Baron Pit // Gold', cleanName: 'Baron Pit Gold',
    url: 'https://www.tcgplayer.com/product/695879/x', groupId: 24560, extendedData: ext('T01 // T05', 'None') },
];

const PRICES_UNL = [
  { productId: 678149, lowPrice: 6.99, midPrice: 7.93, highPrice: 9.98, marketPrice: 7.94, subTypeName: 'Normal' },
  { productId: 685521, lowPrice: 80.0, midPrice: 92.27, highPrice: 350.0, marketPrice: 90.88, subTypeName: 'Foil' },
  { productId: 685522, lowPrice: 760.01, midPrice: 837.5, highPrice: 1249.98, marketPrice: 641.0, subTypeName: 'Foil' },
  { productId: 685527, lowPrice: 45.5, midPrice: 53.66, highPrice: 350.0, marketPrice: 48.71, subTypeName: 'Foil' },
  { productId: 685605, lowPrice: 453.0, midPrice: 637.49, highPrice: 1450.0, marketPrice: 445.29, subTypeName: 'Foil' },
  { productId: 695879, lowPrice: 0.04, midPrice: 0.2, highPrice: 3.66, marketPrice: 0.14, subTypeName: 'Normal' },
];

// Verbatim OPP 269: one Number, three products, two prices 123x apart.
const PRODUCTS_OPP = [
  { productId: 662885, name: 'Sett, The Boss', cleanName: 'Sett The Boss',
    url: 'https://www.tcgplayer.com/product/662885/x', groupId: 24528, extendedData: ext('269/298', 'Promo') },
  { productId: 669263, name: 'Sett, The Boss (Metal) (Best Of)', cleanName: 'Sett The Boss Metal Best Of',
    url: 'https://www.tcgplayer.com/product/669263/x', groupId: 24528, extendedData: ext('269/298', 'Promo') },
  { productId: 689177, name: 'Sett, The Boss (Metal) (Prize Wall)', cleanName: 'Sett The Boss Metal Prize Wall',
    url: 'https://www.tcgplayer.com/product/689177/x', groupId: 24528, extendedData: ext('269/298', 'Promo') },
];
const PRICES_OPP = [
  { productId: 662885, lowPrice: 12.01, midPrice: 17.79, highPrice: 99.0, marketPrice: 12.89, subTypeName: 'Foil' },
  { productId: 689177, lowPrice: 2499.99, midPrice: 3299.5, highPrice: 3999.99, marketPrice: 1586.93, subTypeName: 'Normal' },
];

const row = (id, name, set, number) => `INSERT INTO card_cache (id, name, set_id, number, game, last_updated)
  VALUES ('${id}', '${name}', 'riftbound-${set}', '${number}', 'riftbound', CURRENT_TIMESTAMP)`;

async function main() {
  try {
    await db.initDb();

    // --- 1. The number key keeps the variant suffix -------------------------
    // This is the collapse that would unpriced every showcase pair: tcgcsvApi's
    // normNumber strips '*', so '229*' became '229' and the duplicate rule then
    // threw BOTH away as ambiguous.
    assert.strictEqual(prices.numberKey('229/219'), '229');
    assert.strictEqual(prices.numberKey('229*/219'), '229*');
    assert.notStrictEqual(prices.numberKey('229*/219'), prices.numberKey('229/219'),
      'an Overnumbered and a Signature printing must never share a key');
    assert.strictEqual(tcgcsv.normNumber('229*/219'), '229', 'the Pokemon key does strip it — do not reuse it');
    // Leading zeros go, letters and the slash-form total stay.
    assert.strictEqual(prices.numberKey('004/102'), '4');
    assert.strictEqual(prices.numberKey('078a/298'), '78a');
    assert.strictEqual(prices.numberKey('#229'), '229');
    assert.strictEqual(prices.numberKey('T01 // T05'), 't01', 'a two-faced token number keys on the first face');
    assert.strictEqual(prices.numberKey(''), '');
    assert.strictEqual(prices.numberKey(null), '');

    // --- 2. Sealed product is ruled out by shape ---------------------------
    assert.strictEqual(prices.numberOf(PRODUCTS_UNL[0]), null, 'a booster pack carries no Number');
    assert.strictEqual(prices.numberOf(PRODUCTS_UNL[1]), '229/219');

    // --- 3. One Number, several products: the plain one wins ---------------
    // $12.89 vs $1,586.93 on the same Number.
    const opp = prices.pickProduct(PRODUCTS_OPP, 'Sett, The Boss');
    assert.strictEqual(opp.productId, 662885, 'the unmarked printing is the card, not the Metal prize-wall promo');
    const unlDup = prices.pickProduct([PRODUCTS_UNL[1], PRODUCTS_UNL[2]], 'Vi, Piltover Enforcer');
    assert.strictEqual(unlDup.productId, 685521, 'the plain print wins over the labelled variant');

    // --- 4. priceSet: the real join, against fixtures -----------------------
    for (const [id, name, set, number] of [
      ['riftbound-unl-229-219', 'Vi, Piltover Enforcer', 'unl', '229'],
      ['riftbound-unl-229*-219', 'Vi, Piltover Enforcer (Signature)', 'unl', '229*'],
      ['riftbound-unl-231-219', 'Master Yi, Wuju Master', 'unl', '231'],
      ['riftbound-unl-231*-219', 'Master Yi, Wuju Master (Signature)', 'unl', '231*'],
      ['riftbound-unl-t01-219', 'Baron Pit', 'unl', 'T01'],
      // No product on TCGplayer for this number at all.
      ['riftbound-unl-999-219', 'Unlisted Card', 'unl', '999'],
    ]) await db.run(row(id, name, set, number));
    await db.run(row('riftbound-opp-269-298', 'Sett, The Boss', 'opp', '269'));

    tcgcsv.getProducts = async (categoryId, groupId) => {
      assert.strictEqual(categoryId, 89, 'Riftbound prices come from TCGCSV category 89');
      if (groupId === 24560) return PRODUCTS_UNL;
      if (groupId === 24528) return PRODUCTS_OPP;
      return [];
    };
    const pricesFor = async (categoryId, groupId) => (groupId === 24560 ? PRICES_UNL
      : (groupId === 24528 ? PRICES_OPP : []));
    tcgcsv.getPrices = pricesFor;

    const unl = await prices.priceSet({ set_id: 'riftbound-unl', n: 6 }, GROUPS);
    assert.strictEqual(unl.matched, true);
    assert.strictEqual(unl.group, 'Unleashed', 'matched on the abbreviation, exactly');
    assert.strictEqual(unl.cached, 6);
    assert.strictEqual(unl.priced, 5, 'five of six printings have a listing');
    assert.deepStrictEqual(unl.unlisted, ['999'], 'the gap is reported, not filled in');

    const get = (id) => db.get('SELECT * FROM card_cache WHERE id = ?', [id]);
    const over = await get('riftbound-unl-229-219');
    assert.strictEqual(over.price_holofoil, 90.88, 'the Foil finish lands in price_holofoil');
    assert.strictEqual(over.price_normal, null, 'there is no Normal product for this printing');
    assert.strictEqual(over.price_trend, 90.88, 'trend falls back to the only real price');
    assert.strictEqual(over.price_currency, 'USD');
    assert.strictEqual(over.price_source, 'tcgcsv');
    assert.strictEqual(over.tcgplayer_product_id, 685521);
    assert.match(over.tcgplayer_url, /^https:\/\/www\.tcgplayer\.com\/product\/685521\//);

    const signature = await get('riftbound-unl-229*-219');
    assert.strictEqual(signature.price_holofoil, 641.0, "the Signature twin is priced off its OWN product");
    assert.strictEqual(signature.tcgplayer_product_id, 685522);
    assert.notStrictEqual(signature.price_holofoil, over.price_holofoil,
      'two products sharing a number must not end up sharing a price');

    const oppSweep = await prices.priceSet({ set_id: 'riftbound-opp', n: 1 }, GROUPS);
    assert.strictEqual(oppSweep.priced, 1);
    const oppRow = await get('riftbound-opp-269-298');
    assert.strictEqual(oppRow.price_holofoil, 12.89, 'the promo is the $12.89 printing');
    assert.strictEqual(oppRow.tcgplayer_product_id, 662885);

    const unlisted = await get('riftbound-unl-999-219');
    for (const column of ['price_trend', 'price_normal', 'price_holofoil', 'price_source']) {
      assert.strictEqual(unlisted[column], null, `${column} must stay unknown when nothing is listed`);
    }
    // price_currency is the one column that is not the sweep's to leave null: the
    // schema defaults it to 'USD' for every game, so it reads USD on an unpriced row
    // here too. What must NOT happen is a source claiming to have priced it.
    assert.strictEqual(unlisted.tcgplayer_product_id, null, 'no product may be attached to an unlisted printing');
    // An unknown price is null, never 0 — 0 is a quote.
    assert.strictEqual(resolveCardPrice({ ...unlisted, game: 'riftbound' }), null);
    assert.strictEqual(priceMetadata({ ...unlisted, game: 'riftbound' }).price_status, 'unavailable');
    assert.strictEqual(priceMetadata({ ...unlisted, game: 'riftbound' }).price_unavailable_reason, api.PRICE_UNAVAILABLE);
    assert.strictEqual(priceMetadata({ ...over, game: 'riftbound' }).price_status, 'available');
    assert.strictEqual(resolveCardPrice({ ...over, game: 'riftbound' }), 90.88);
    // A copy the owner marked as the foil finish reads that column, like 'Holofoil' for Pokemon.
    assert.strictEqual(resolveCardPrice({ ...over, game: 'riftbound', printing: 'Foil' }), 90.88);

    // One price-history point per priced card — 5 Unleashed printings plus the OPP
    // promo — and none for the unlisted one.
    const history = await db.get("SELECT COUNT(*) AS count FROM price_history WHERE card_id LIKE 'riftbound-%'");
    assert.strictEqual(history.count, 6, 'price history records only cards with a price');

    // A set code TCGplayer has no group for is reported unmatched rather than
    // silently skipped. (RAD and LGC DO resolve — they are real TCGplayer groups,
    // just releases this bundle does not carry — so a group existing is not the same
    // as a group holding our cards. The sweep only ever walks cached set_ids.)
    const unmatched = await prices.priceSet({ set_id: 'riftbound-zzz', n: 1 }, GROUPS);
    assert.strictEqual(unmatched.matched, false);
    assert.strictEqual(unmatched.priced, 0);

    // --- 5. A re-cache must not erase the sweep ----------------------------
    // This is the failure that would have made the whole feature look broken a day
    // later with nothing in the logs: cacheAllCards() runs on every boot and
    // searchCards() re-caches on every search, and both write the snapshot's nulls
    // over every price column.
    const source = JSON.parse(fs.readFileSync(path.join(api.DATA_DIR, 'cards.json'), 'utf8'));
    const manifest = JSON.parse(fs.readFileSync(path.join(api.DATA_DIR, 'manifest.json'), 'utf8'));
    const snapshotCard = api.normalizeCard(source.cards[manifest.printings[0].source_rows[0]], manifest.printings[0]);
    await cacheNormalizedCards([snapshotCard], 'riftbound');
    await db.run(`UPDATE card_cache SET price_trend = 42.5, price_holofoil = 42.5, price_currency = 'USD',
      price_source = 'tcgcsv', tcgplayer_product_id = 1 WHERE id = ?`, [snapshotCard.id]);
    await cacheNormalizedCards([{ ...snapshotCard, price_trend: null, price_holofoil: null,
      price_currency: null, price_source: null, tcgplayer_product_id: null }], 'riftbound');
    const survived = await get(snapshotCard.id);
    assert.strictEqual(survived.price_trend, 42.5, 'a re-cache with no price must NOT blank a cached price');
    assert.strictEqual(survived.tcgplayer_product_id, 1, 'nor the product id behind it');

    // --- 6. The sweep gate knows this provider -----------------------------
    // shouldSweepPrices() returns false for an unknown key and markPricesSwept()
    // no-ops, which is how a provider goes silent with no error anywhere.
    assert.strictEqual(await shouldSweepPrices('riftbound'), true, 'a fresh install is due a sweep');
    await markPricesSwept('riftbound');
    assert.strictEqual(await shouldSweepPrices('riftbound'), false, 'and not due again the same minute');
    const stamped = await db.get('SELECT riftbound_prices_swept_at AS at FROM app_settings WHERE id = 1');
    assert.ok(stamped.at, 'the sweep timestamp column exists and is written');

    // --- 7. A delisted printing stops showing its old price -----------------
    // The sweep used to `continue` past a printing with no quote, and the cache
    // upsert COALESCEs, so a price that vanished from TCGplayer stayed on the card
    // forever. It is cleared to NULL (never 0) — but only when the group returned
    // usable quotes, so a bad response cannot blank a whole set.
    const viId = 'riftbound-unl-229-219';
    const withoutVi = PRICES_UNL.filter(p => p.productId !== 685521);
    assert.strictEqual((await get(viId)).price_trend, 90.88, 'priced before the listing goes');
    tcgcsv.getPrices = async () => withoutVi;
    const delisted = await prices.priceSet({ set_id: 'riftbound-unl', n: 6 }, GROUPS);
    assert.strictEqual(delisted.cleared, 1, 'exactly the delisted printing is cleared');
    const gone = await get(viId);
    for (const column of ['price_trend', 'price_normal', 'price_holofoil']) {
      assert.strictEqual(gone[column], null, `${column} must be NULL after delisting, never 0`);
    }
    assert.strictEqual(gone.tcgplayer_product_id, 685521, 'the product is still known');
    assert.strictEqual(resolveCardPrice({ ...gone, game: 'riftbound' }), null);
    assert.strictEqual((await get('riftbound-unl-229*-219')).price_holofoil, 641.0, 'neighbours keep their prices');
    // Repriced: back again.
    tcgcsv.getPrices = pricesFor;
    await prices.priceSet({ set_id: 'riftbound-unl', n: 6 }, GROUPS);
    assert.strictEqual((await get(viId)).price_trend, 90.88);

    // The guard: an empty price list clears nothing...
    tcgcsv.getPrices = async () => [];
    const empty = await prices.priceSet({ set_id: 'riftbound-unl', n: 6 }, GROUPS);
    assert.strictEqual(empty.cleared, 0, 'an empty price list must not blank the set');
    assert.strictEqual((await get(viId)).price_trend, 90.88);
    // ...and neither does a list holding only a finish we do not map, which is
    // also counted rather than silently dropped.
    tcgcsv.getPrices = async () => [{ productId: 685521, marketPrice: 5, subTypeName: 'Reverse Foil' },
      { productId: 685522, marketPrice: 6, subTypeName: 'Reverse Foil' }];
    const odd = await prices.priceSet({ set_id: 'riftbound-unl', n: 6 }, GROUPS);
    assert.strictEqual(odd.cleared, 0, 'a response with no usable quote must not blank the set');
    assert.deepStrictEqual(odd.unmappedFinishes, { 'Reverse Foil': 2 }, 'unmapped finishes are counted');
    assert.strictEqual((await get(viId)).price_trend, 90.88);
    tcgcsv.getPrices = pricesFor;

    // --- 8. The sweep: one failing set, unmatched sets, a total outage -------
    await db.run(row('riftbound-zzz-001-1', 'No Group', 'zzz', '001'));
    tcgcsv.getGroups = async () => GROUPS;
    const unmappedBefore = console.warn;
    const warnings = [];
    console.warn = (...a) => warnings.push(a.join(' '));
    try {
      await db.run(`UPDATE app_settings SET riftbound_prices_swept_at = NULL WHERE id = 1`);
      await db.run(`UPDATE card_cache SET price_trend = NULL, price_normal = NULL, price_holofoil = NULL
        WHERE id = 'riftbound-opp-269-298'`);
      tcgcsv.getProducts = async (categoryId, groupId) => {
        if (groupId === 24560) throw new Error('boom');
        return groupId === 24528 ? PRODUCTS_OPP : [];
      };
      const partial = await prices.updateCollectionPrices(true);
      assert.strictEqual(partial.failed.length, 1, 'the failing set is in the summary');
      assert.strictEqual(partial.failed[0].set, 'riftbound-unl');
      assert.match(partial.failed[0].error, /boom/);
      assert.strictEqual((await get('riftbound-opp-269-298')).price_holofoil, 12.89,
        'a set after the failing one is still priced');
      assert.ok(partial.unmatched.includes('riftbound-zzz'), 'sets with no TCGplayer group are in the summary');
      assert.ok(warnings.some(w => w.includes('riftbound-zzz')), 'and warned about, not just logged');
      assert.strictEqual(await shouldSweepPrices('riftbound'), false, 'a partial failure still counts as a sweep');

      // Total outage: every set throws. The gate must stay open for the next tick.
      await db.run(`UPDATE app_settings SET riftbound_prices_swept_at = NULL WHERE id = 1`);
      tcgcsv.getProducts = async () => { throw new Error('mirror down'); };
      const outage = await prices.updateCollectionPrices(true);
      assert.ok(outage.results.every(r => !r.matched), 'nothing was fetched successfully');
      assert.ok(outage.failed.length >= 2, 'every failing set is reported');
      assert.strictEqual(await shouldSweepPrices('riftbound'), true, 'a total outage must leave the sweep gate open');
    } finally {
      console.warn = unmappedBefore;
    }

    console.log('riftboundprices.test.js: variant keys, duplicate resolution, Foil mapping, '
      + 'unlisted-stays-null, re-cache preservation and the sweep gate all passed');
  } finally {
    await new Promise((resolve, reject) => db.dbConnection.close(error => error ? reject(error) : resolve()));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
