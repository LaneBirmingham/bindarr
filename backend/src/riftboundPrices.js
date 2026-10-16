// Riftbound prices, from TCGCSV category 89.
//
// TCGCSV is a free daily mirror of TCGplayer's catalogue and price endpoints, and
// it is already the price source this app trusts for Pokémon (see tcgcsvApi.js for
// why TCGplayer's own API is not an option: it has been closed to new applicants
// since late 2024 and there is no key to apply for). This module is the Riftbound
// half — the earlier "no exact-printing price source with an approved licence has
// been verified" stance was accurate when it was written and is now out of date.
//
// TCGplayer files Riftbound under a single category (89) split into one group per
// set, and our set codes ARE its group abbreviations — OGN, OGS, SFD, UNL, VEN, OPP,
// PR, JDG all match exactly. So there is no fuzzy matching here: no SET_ALIASES, no
// suffix pass, no confidence score, no second catalogue to disambiguate against.
// Measured over the bundled 1,356 printings: 1,349 (99.5%) resolve to a product
// carrying a market price. The five that do not are all in PR, the promotional set,
// where TCGplayer simply has no listing for every promo.
//
// Four details are load-bearing. Each is a silent failure if it is got wrong, which
// is the actual reason this is its own module rather than a category id added to the
// Pokémon provider:
//
//   1. THE NUMBER KEY KEEPS THE VARIANT SUFFIX. tcgcsvApi.normNumber strips every
//      non-alphanumeric character, which folds '229*' onto '229' — and the provider
//      then applies "a number claimed by two products is dropped", so every
//      Signature/Overnumbered showcase pair would come back unpriced with nothing
//      reported as wrong. TCGplayer writes the variant into Number exactly as the
//      bundle writes it into `number` ('229/219' vs '229*/219'), so the two sides
//      line up the moment nothing is stripped.
//
//   2. A DUPLICATE NUMBER IS RESOLVED, NOT DISCARDED. Seven keys are token faces
//      ('t01' is both "Empowered // Gold" and "Empowered // Mech") and 59 are OPP
//      promos where one Number carries a plain printing alongside "Metal (Best Of)"
//      and "Metal (Prize Wall)" variants. Dropping the key loses ~66 printings, so
//      the plain product wins and the rest are left alone.
//
//   3. FINISHES ARE 'Normal' AND 'Foil', AND BOTH MATTER. tcgcsvApi's finish map is
//      Pokémon's and has no Foil entry at all; unmapped finishes are dropped by
//      design there, which here would throw away most of the catalogue (Unleashed is
//      293 Foil rows to 152 Normal).
//
//   4. price_trend PREFERS THE NON-FOIL. Riftbound's base printing is the ordinary
//      one — the opposite of tcgcsvApi's holo-first fallback, where the card anyone
//      looks up a price for is the holo.
//
// A price is only ever TCGplayer's own marketPrice (their computed value from real
// sales), falling back to midPrice only when there is no market price — the same
// rule and the same reason as the Pokémon provider: midPrice is the midpoint of
// current listings, which is a seller's asking price and runs high. A printing with
// no product, no price row, or no positive price is left null and reported in the
// sweep summary; it is never filled in with a guess, and never zero.
const db = require('./db');
const tcgcsv = require('./tcgcsvApi');
const { recordPrice, shouldSweepPrices, markPricesSwept } = require('./utils/priceHelpers');

const CATEGORY_ID = 89;
const GAME = 'riftbound';
// The same source string tcgcsvApi uses for an exact-catalogue match: these are
// TCGplayer market prices in USD, and the Riftbound snapshot is English-only, so
// there is no proxy to label. A non-English Riftbound printing does not exist yet.
const SOURCE = 'tcgcsv';

// TCGplayer's finish name for this category -> the card_cache column it belongs in.
// 'Foil' maps to price_holofoil because that is the column the app already reads
// for a foil finish (`collection.printing = 'Foil'`, and isRiftboundCard in
// priceHelpers.js prefers it for exactly that value).
const FINISH_COLUMN = { Normal: 'price_normal', Foil: 'price_holofoil' };

// Our printing identity as TCGplayer's `Number` can be compared to it.
//
// Take the part before the slash ('229/219' and '147/219' are both number/total),
// drop a leading '#', lowercase, and strip leading zeros from the digit run while
// KEEPING any letters and the '*' — '078a' stays '78a', '229*' stays '229*'. This is
// deliberately not tcgcsvApi.normNumber: that function removes '*', which is the one
// character distinguishing two products that share a number.
function numberKey(value) {
  const head = String(value == null ? '' : value).split('/')[0].trim().toLowerCase().replace(/^#/, '');
  return head.replace(/\s+/g, '').replace(/^0+(?=\d)/, '');
}

// Singles carry a Number in extendedData; sealed product (booster packs, boxes,
// bundles) does not. Ruled out by shape rather than by name, so a renamed sealed
// product cannot drift into the match.
function numberOf(product) {
  const ext = product.extendedData || [];
  const found = ext.find(e => e && String(e.name).toLowerCase() === 'number');
  return found ? found.value : null;
}

// Which of several products sharing one Number is this printing.
//
// The plain product wins: TCGplayer's variant products carry a parenthetical marker
// and the base one does not, so an exact name match is preferred, then the absence
// of any marker, then the lowest productId so the answer is stable across sweeps.
// Only the choice of product is affected — a wrong pick here does not invent a
// price, it picks a different real one, and the caller records which.
function pickProduct(candidates, cardName) {
  if (!candidates || !candidates.length) return null;
  const wanted = String(cardName || '').trim().toLowerCase();
  const scored = candidates.map(p => ({
    p,
    exact: wanted && String(p.cleanName || p.name || '').trim().toLowerCase() === wanted ? 0 : 1,
    marked: /\(|\)/.test(String(p.name || '')) ? 1 : 0,
    id: Number(p.productId) || 0,
  }));
  scored.sort((a, b) => a.exact - b.exact || a.marked - b.marked || a.id - b.id);
  return scored[0].p;
}

const quoteOf = (row) => (row.marketPrice > 0 ? row.marketPrice : (row.midPrice > 0 ? row.midPrice : null));

// One group: its products and prices joined to our cached rows by printing number.
// Returns counts rather than throwing — one set failing must not abandon the rest.
async function priceSet(set, groups) {
  const code = String(set.set_id).replace(/^riftbound-/, '').toUpperCase();
  const group = groups.find(g => String(g.abbreviation || '').toUpperCase() === code);
  if (!group) return { set: set.set_id, matched: false, priced: 0, unlisted: [] };

  const [products, prices] = await Promise.all([
    tcgcsv.getProducts(CATEGORY_ID, group.groupId),
    tcgcsv.getPrices(CATEGORY_ID, group.groupId),
  ]);

  const quotes = new Map();
  for (const row of prices) {
    const column = FINISH_COLUMN[row.subTypeName];
    if (!column) continue;                       // an unmapped finish is not a price
    const amount = quoteOf(row);
    if (amount == null) continue;
    const current = quotes.get(row.productId) || {};
    if (current[column] == null) current[column] = amount;
    quotes.set(row.productId, current);
  }

  const byNumber = new Map();
  for (const product of products) {
    const number = numberOf(product);
    if (!number) continue;                       // sealed product
    const key = numberKey(number);
    if (!key) continue;
    if (!byNumber.has(key)) byNumber.set(key, []);
    byNumber.get(key).push(product);
  }

  const rows = await db.all(
    `SELECT id, name, number FROM card_cache WHERE game = ? AND set_id = ?`,
    [GAME, set.set_id]
  );

  let priced = 0;
  const unlisted = [];
  for (const row of rows) {
    const product = pickProduct(byNumber.get(numberKey(row.number)), row.name);
    if (!product) { unlisted.push(row.number); continue; }
    // Worth storing even with no price: it is what makes the marketplace link point
    // at this printing instead of at a name search.
    await db.run(
      `INSERT OR REPLACE INTO tcgplayer_product (card_id, product_id, category_id, confidence, matched_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [row.id, product.productId, CATEGORY_ID, 1]
    );
    const quote = quotes.get(product.productId);
    const trend = quote ? (quote.price_normal ?? quote.price_holofoil ?? null) : null;
    if (!(trend > 0)) { unlisted.push(row.number); continue; }
    await db.run(
      `UPDATE card_cache
          SET price_trend = ?, price_normal = ?, price_holofoil = ?,
              price_currency = 'USD', price_source = ?, tcgplayer_product_id = ?,
              tcgplayer_url = COALESCE(?, tcgplayer_url)
        WHERE id = ?`,
      [trend, quote.price_normal ?? null, quote.price_holofoil ?? null,
       SOURCE, product.productId, product.url || null, row.id]
    );
    await recordPrice(row.id, trend);
    priced++;
  }
  return { set: set.set_id, group: group.name, matched: true, priced, cached: rows.length, unlisted };
}

// Every Riftbound set in the cache, largest first.
//
// No 'owned' scope here, unlike the Pokémon provider: that one walks hundreds of
// groups and owes its collection-only default to the request count, while the whole
// Riftbound catalogue is eight groups. Sweeping all of it keeps prices available in
// search and browse, not only on the rows the owner happens to hold, for ~16
// requests once a day.
async function setsToPrice() {
  return db.all(
    `SELECT set_id, COUNT(*) AS n FROM card_cache WHERE game = ? GROUP BY set_id ORDER BY n DESC`,
    [GAME]
  );
}

async function updateCollectionPrices(force = false) {
  try {
    if (!force && !(await shouldSweepPrices(GAME))) return { skipped: true };
    const groups = await tcgcsv.getGroups(CATEGORY_ID);
    const sets = await setsToPrice();
    if (!sets.length) return { sets: 0, priced: 0 };

    const results = [];
    for (const set of sets) results.push(await priceSet(set, groups));

    const priced = results.reduce((n, r) => n + (r.priced || 0), 0);
    const cached = results.reduce((n, r) => n + (r.cached || 0), 0);
    const unlisted = results.reduce((n, r) => n + (r.unlisted || []).length, 0);
    const unmatched = results.filter(r => !r.matched).map(r => r.set);
    if (unmatched.length) {
      console.log(`TCGCSV Riftbound: no TCGplayer group for ${unmatched.length} set(s): ${unmatched.join(', ')}`);
    }
    console.log(`TCGCSV Riftbound: priced ${priced}/${cached} printing(s) across ${results.length} set(s); ${unlisted} without a listing`);
    await markPricesSwept(GAME);
    return { sets: results.length, cached, priced, unlisted, unmatched, results };
  } catch (err) {
    console.error('Error during Riftbound price update:', err.message);
    return { error: err.message };
  }
}

module.exports = {
  CATEGORY_ID,
  FINISH_COLUMN,
  SOURCE,
  numberKey,
  numberOf,
  pickProduct,
  priceSet,
  setsToPrice,
  updateCollectionPrices,
};
