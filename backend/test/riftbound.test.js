// Complete offline provider contract against the committed snapshot and real SQLite.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bindarr-riftbound-provider-'));
process.env.DB_PATH = path.join(temporary, `bindarr-riftbound-${process.pid}.db`);
process.env.DEFAULT_ADMIN_PASSWORD = '';

// Fail even when a provider catches a network exception and returns a fallback.
const networkAttempts = [];
const restorations = [];
for (const [object, methods] of [
  [require('http'), ['request', 'get']], [require('https'), ['request', 'get']],
  [require('net'), ['connect', 'createConnection']], [require('tls'), ['connect']],
  [globalThis, ['fetch']],
]) {
  for (const method of methods) {
    const original = object[method];
    object[method] = (...args) => {
      networkAttempts.push({ method, target: String(args[0]) });
      throw new Error(`Riftbound provider attempted network access through ${method}`);
    };
    restorations.push(() => { object[method] = original; });
  }
}

// DB_PATH must be set before any of these DB-dependent modules are imported.
const db = require('../src/db');
const api = require('../src/riftboundApi');
const cardApi = require('../src/utils/cardApi');
const cardSets = require('../src/cardSets');
const { resolveCardPrice, parseCardRow, valuationMetadata } = require('../src/utils/priceHelpers');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const ids = cards => cards.map(card => card.id).sort();
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const PRICE_COLUMNS = ['price_trend', 'price_normal', 'price_holofoil', 'price_reverse_holofoil',
  'price_avg1', 'price_avg7', 'price_avg30', 'price_1st_edition', 'price_currency', 'price_source'];

async function main() {
  try {
    await db.initDb();
    const sourceBytes = fs.readFileSync(path.join(api.DATA_DIR, 'cards.json'));
    const artBytes = fs.readFileSync(path.join(api.DATA_DIR, 'art-manifest.json'));
    const source = JSON.parse(sourceBytes), art = JSON.parse(artBytes);
    const manifest = readJson(path.join(api.DATA_DIR, 'manifest.json'));
    assert.strictEqual(source.record_count, 1451);
    assert.strictEqual(source.cards.length, 1451);
    assert.strictEqual(new Set(source.cards.map(card => JSON.stringify(card))).size, 1356,
      'the source has 95 exact duplicate records, not 1451 distinct selectable printings');
    assert.strictEqual(manifest.snapshot_sha256, sha256(sourceBytes));
    assert.strictEqual(manifest.art_manifest_sha256, sha256(artBytes));
    assert.strictEqual(art.snapshot_sha256, sha256(sourceBytes));
    assert.deepStrictEqual(art.failures, {});
    assert.strictEqual(manifest.attribution, api.NOTICE);
    assert.strictEqual(manifest.printing_count, 1356);
    assert.strictEqual(manifest.duplicate_records_collapsed, 95);

    const { cards, total } = await api.searchCards({ limit: 5000 });
    assert.strictEqual(total, 1356);
    assert.strictEqual(cards.length, total);
    assert.strictEqual(new Set(ids(cards)).size, total);
    const byId = new Map(cards.map(card => [card.id, card]));
    const bySourceRow = new Map();
    const artByPath = new Map(Object.values(art.images).map(image => [image.path, image]));
    for (const card of cards) {
      assert.strictEqual(card.game, 'riftbound');
      assert.strictEqual(card.language, 'English');
      assert.strictEqual(card.price_status, 'unavailable');
      assert.strictEqual(card.price_unavailable_reason, api.PRICE_UNAVAILABLE);
      assert.strictEqual(card.attribution, api.NOTICE);
      assert.strictEqual(resolveCardPrice(card), null);
      for (const column of PRICE_COLUMNS) assert.strictEqual(card[column], null, `${card.id}: ${column} must be unknown`);
      assert.strictEqual(card.tcgplayer_url, null);
      assert.strictEqual(card.cardmarket_url, null);
      assert.strictEqual(card.tcgplayer_product_id, null);
      assert.match(card.image_url, /^\/api\/riftbound\/art\/[a-f0-9]{64}\.webp$/);
      assert.ok(card.source_rows.length);
      for (const index of card.source_rows) {
        assert.ok(!bySourceRow.has(index), `source row ${index} cannot map to two identities`);
        bySourceRow.set(index, card);
        const raw = source.cards[index];
        assert.strictEqual(card.riftbound_id, raw.riftbound_id);
        assert.strictEqual(card.name, raw.name);
        assert.strictEqual(card.set_id, `riftbound-${raw.set.toLowerCase()}`);
        assert.strictEqual(card.set_name, raw.set_label);
        assert.strictEqual(card.collector_number, String(raw.collector_number));
        assert.strictEqual(card.supertype, raw.type);
        assert.strictEqual(card.energy, raw.energy);
        assert.strictEqual(card.power, raw.power);
        assert.strictEqual(card.might, raw.might);
        assert.deepStrictEqual(card.types, raw.domains);
        assert.deepStrictEqual(card.keywords, raw.keywords);
        assert.deepStrictEqual(card.play_keywords, raw.play_keywords);
        assert.deepStrictEqual(card.ability_keywords, raw.ability_keywords);
        assert.deepStrictEqual(card.referenced_keywords, raw.referenced_keywords);
        assert.strictEqual(art.records[index].index, index);
        assert.strictEqual(art.records[index].riftbound_id, raw.riftbound_id);
        assert.strictEqual(card.image_sha256, artByPath.get(art.records[index].image).sha256,
          'each printing must retain its own source artwork, including variants');
      }
    }
    assert.deepStrictEqual([...bySourceRow.keys()].sort((a, b) => a - b),
      Array.from({ length: 1451 }, (_, i) => i), 'all source records must remain accounted for');

    // Check actual shipped assets, not merely the manifest's reported image count.
    const imageHashes = new Set(cards.map(card => card.image_sha256));
    assert.strictEqual(imageHashes.size, 1171);
    assert.strictEqual(manifest.image_count, 1171);
    assert.deepStrictEqual(fs.readdirSync(api.ART_DIR).sort(), [...imageHashes].map(hash => `${hash}.webp`).sort());
    for (const hash of imageHashes) {
      const file = api.localArtPath(`/api/riftbound/art/${hash}.webp`);
      assert.strictEqual(path.dirname(file), api.ART_DIR);
      const bytes = fs.readFileSync(file), expected = manifest.images[hash];
      assert.strictEqual(sha256(bytes), hash, `art bytes must match content address ${hash}`);
      assert.strictEqual(bytes.length, expected.bytes);
      const metadata = await sharp(bytes).metadata();
      assert.strictEqual(metadata.format, 'webp');
      assert.deepStrictEqual([metadata.width, metadata.height], [expected.width, expected.height]);
    }
    for (const invalid of [
      'https://example.invalid/card.webp', '/api/riftbound/art/../cards.json',
      `/api/riftbound/art/${'0'.repeat(64)}.webp`, `${cards[0].image_url}?remote=1`,
    ]) assert.strictEqual(api.localArtPath(invalid), null, 'only known local content addresses may resolve');

    // Collector-number suffixes survive; name equality cannot merge distinct art.
    const signature = (await api.searchCards({ set: 'UNL', number: '229*' })).cards;
    assert.deepStrictEqual(signature.map(card => [card.riftbound_id, card.number, card.signature]),
      [['unl-229*-219', '229*', true]]);
    const numeric = (await api.searchCards({ set: 'riftbound-unl', number: '#229/219' })).cards;
    assert.strictEqual(numeric.length, 2);
    assert.ok(numeric.some(card => card.signature) && numeric.some(card => card.overnumbered));
    const alternate = (await api.searchCards({ set: 'OGN', number: '112a' })).cards;
    assert.strictEqual(alternate.length, 1);
    assert.strictEqual(alternate[0].number, '112a');
    assert.strictEqual(alternate[0].alternate_art, true);
    for (const [set, number, expected] of [['VEN', 'sp4', 'ven-sp4-006'], ['VEN', 'r06', 'ven-r06']]) {
      const matches = (await api.searchCards({ set, number })).cards;
      assert.ok(matches.length && matches.every(card => card.riftbound_id === expected));
    }
    const colliding = cards.filter(card => card.riftbound_id === 'opp-259-298');
    assert.strictEqual(colliding.length, 2);
    assert.deepStrictEqual(colliding.map(card => card.name).sort(), ['Yasuo - Unforgiven', 'Yasuo - Unforgiven (Metal)']);
    assert.strictEqual(new Set(ids(colliding)).size, 2);
    assert.ok(colliding.every(card => /-v[a-f0-9]{16}$/.test(card.id)));
    const sameName = cards.filter(card => card.name === 'World Atlas');
    assert.ok(sameName.length > 1, 'distinct source printings must not be name-merged');

    // Paging must preserve exactly the complete result, including a short final page.
    const paged = [];
    for (let page = 1; page <= Math.ceil(total / 79); page++) {
      const result = await api.searchCards({ page, limit: 79, scope: 'internet' });
      assert.strictEqual(result.total, total);
      paged.push(...result.cards);
    }
    assert.deepStrictEqual(paged.map(card => card.id), cards.map(card => card.id));
    assert.deepStrictEqual((await api.searchCards({ page: 1000, limit: 79 })).cards, []);
    const expectedSetIds = ['riftbound-jdg', 'riftbound-ogn', 'riftbound-ogs', 'riftbound-opp',
      'riftbound-pr', 'riftbound-sfd', 'riftbound-unl', 'riftbound-ven'];
    const sets = await api.fetchAndCacheSets();
    assert.deepStrictEqual(sets.map(set => set.id).sort(), expectedSetIds);
    assert.strictEqual(sets.reduce((sum, set) => sum + set.total, 0), 1356);
    for (const set of sets) {
      const expected = cards.filter(card => card.set_id === set.id);
      assert.strictEqual(set.total, expected.length);
      assert.deepStrictEqual(ids(await api.getCardsBySet(set.ptcgo_code)), ids(expected));
      assert.deepStrictEqual(ids(await api.getCardsBySet(set.id)), ids(expected), 'prefixed set IDs must stay exact for every set');
      assert.deepStrictEqual(ids((await api.searchCards({ set: set.id, limit: 5000 })).cards), ids(expected));
      assert.deepStrictEqual(ids((await api.searchCards({ set: set.ptcgo_code, limit: 5000 })).cards), ids(expected));
      assert.deepStrictEqual(ids((await api.searchCards({ set: set.name, limit: 5000 })).cards), ids(expected));
    }
    const union = (await api.searchCards({ set: 'OGN, riftbound-ogs', limit: 5000 })).cards;
    assert.deepStrictEqual(ids(union), ids(cards.filter(card => ['riftbound-ogn', 'riftbound-ogs'].includes(card.set_id))));
    assert.deepStrictEqual(await api.searchCards({ lang: 'ja' }), { cards: [], total: 0 });
    assert.deepStrictEqual(await api.listSets('Japanese'), []);
    assert.deepStrictEqual(await api.getCardsBySet('OGN', 'ja'), []);
    assert.deepStrictEqual((await api.searchCards({ name: 'this-card-does-not-exist' })).cards, []);
    assert.strictEqual(await api.getCardById('riftbound-invented'), null);

    // Scope stays within this owner and collection, regardless of other users or wishlist rows.
    const userOne = (await db.run('INSERT INTO users (username, password_hash, share_token) VALUES (?, ?, ?)',
      ['riftbound-one', 'test-only', 'riftbound-one-share'])).lastID;
    const userTwo = (await db.run('INSERT INTO users (username, password_hash, share_token) VALUES (?, ?, ?)',
      ['riftbound-two', 'test-only', 'riftbound-two-share'])).lastID;
    const normal = cards.find(card => card.riftbound_id === 'ogn-001-298');
    assert.ok(normal);
    for (const [user, card, quantity, list] of [[userOne, normal, 2, 'collection'], [userOne, alternate[0], 3, 'collection'],
      [userOne, signature[0], 1, 'wishlist'], [userTwo, signature[0], 7, 'collection']]) {
      await db.run('INSERT INTO collection (card_id, user_id, quantity, list_type, game) VALUES (?, ?, ?, ?, ?)',
        [card.id, user, quantity, list, 'riftbound']);
    }
    const owned = await api.searchCards({ scope: 'collection', userId: userOne, limit: 5000 });
    assert.deepStrictEqual(ids(owned.cards), ids([normal, alternate[0]]));
    assert.deepStrictEqual(Object.fromEntries(owned.cards.map(card => [card.id, card.owned_qty])),
      { [normal.id]: 2, [alternate[0].id]: 3 });
    assert.deepStrictEqual((await api.searchCards({ scope: 'collection', userId: userOne, set: 'UNL' })).cards, []);

    // An uncached exact printing routes through the central adapter without any provider request.
    const dispatchCard = cards.find(card => card.riftbound_id === 'unl-012-219');
    await db.run('DELETE FROM card_cache WHERE id = ?', [dispatchCard.id]);
    assert.strictEqual(cardApi.isRiftboundId(dispatchCard.id), true);
    assert.strictEqual(cardApi.gameOf(dispatchCard.id), 'riftbound');
    assert.strictEqual(cardApi.gameOf('', 'riftbound'), 'riftbound');
    assert.strictEqual((await cardApi.getCardById(dispatchCard.id)).id, dispatchCard.id);
    await cardApi.hydrate(dispatchCard.id);
    assert.strictEqual(await cardApi.printingInLanguage(dispatchCard, 'Japanese'), null);
    assert.deepStrictEqual((await cardSets.listAllSets('riftbound', 'English')).sort(), expectedSetIds);
    await db.run("DELETE FROM card_cache WHERE game = 'riftbound' AND set_id = 'riftbound-ogs'");
    const fetched = await cardSets.cacheSetCards('riftbound', 'OGS', 'English');
    const provingGrounds = cards.filter(card => card.set_id === 'riftbound-ogs');
    assert.strictEqual(fetched.length, 24);
    assert.deepStrictEqual(fetched.map(card => card.raw.id).sort(), ids(provingGrounds));
    assert.ok(fetched.every(card => card.img === byId.get(card.raw.id).image_url && card.number === card.raw.number));
    await assert.rejects(cardSets.cacheSetCards('riftbound', 'OGN', 'Japanese'), error => error.absent === true);

    // Own Ambush reminder text does not become a Reaction permission/ability.
    assert.ok(dispatchCard.text.includes('[Reaction]'));
    assert.deepStrictEqual(dispatchCard.play_keywords, ['Ambush']);
    assert.deepStrictEqual(dispatchCard.ability_keywords, []);
    assert.ok(!dispatchCard.keywords.includes('Reaction'));
    assert.strictEqual(dispatchCard.speed, 'reaction');
    const quickDraw = cards.find(card => card.riftbound_id === 'opp-064-221');
    assert.ok(quickDraw.play_keywords.includes('Quick-Draw'));
    assert.strictEqual(quickDraw.speed, 'reaction');
    assert.ok(cards.find(card => card.riftbound_id === 'unl-024a-219').keywords.includes('Assault 2'));
    const glued = cards.find(card => card.riftbound_id === 'unl-078-219');
    assert.ok(glued.rules_text.includes('[Deathknell] [>]'));
    assert.ok(!glued.text.includes(']['));
    assert.ok(!glued.rules_text.includes(':rb_'), 'display text expands source rune/might tokens');
    const entityFixture = api.normalizeCard({ ...source.cards[0], name: 'A &quot;card&quot; &amp; more',
      text: '[Deathknell][&gt;] &amp; &#x41; &#65;', text_clean: '[Deathknell][&amp;gt;] draw a card.' }, manifest.printings[0]);
    assert.strictEqual(entityFixture.name, 'A "card" & more');
    assert.strictEqual(entityFixture.text, '[Deathknell] [>] & A A');
    assert.strictEqual(entityFixture.rules_text, '[Deathknell] [>] draw a card.');

    // Re-caching caller metadata cannot poison immutable identities or invent prices.
    await api.cacheCards([{ ...normal, name: 'Injected name', price_trend: 999, price_currency: 'USD', tcgplayer_product_id: 123 },
      { id: 'riftbound-invented', name: 'Not in the snapshot', price_trend: 999 }]);
    const cached = parseCardRow(await db.get('SELECT * FROM card_cache WHERE id = ?', [normal.id]));
    assert.strictEqual(cached.name, normal.name);
    assert.strictEqual(cached.price_status, 'unavailable');
    for (const column of PRICE_COLUMNS) assert.strictEqual(cached[column], null);
    assert.strictEqual(await db.get('SELECT * FROM card_cache WHERE id = ?', ['riftbound-invented']), undefined);
    await api.cacheAllCards();
    const cacheCount = await db.get("SELECT COUNT(*) AS count FROM card_cache WHERE game = 'riftbound'");
    assert.strictEqual(cacheCount.count, 1356);
    const cacheSets = await db.all("SELECT id FROM sets WHERE game = 'riftbound'");
    assert.deepStrictEqual(cacheSets.map(set => set.id).sort(), expectedSetIds);
    // The price sweep is deliberately NOT part of this offline contract. It is the one
    // operation in the Riftbound path that is supposed to reach out — to TCGCSV, which
    // mirrors TCGplayer's Riftbound catalogue — so it is pinned against fixtures in
    // riftboundprices.test.js instead. What this file proves is that the catalogue
    // itself still needs no network at all, and that a price can only ever arrive from
    // the cache rather than from the snapshot.
    assert.strictEqual((await db.get('SELECT COUNT(*) AS count FROM price_history')).count, 0);
    // A cached price is what the row resolves to, and both finishes read from it.
    assert.strictEqual(resolveCardPrice({ game: 'riftbound', price_trend: 99, price_normal: 90 }), 99);
    assert.strictEqual(resolveCardPrice({ game: 'riftbound', printing: 'Foil', price_holofoil: 40, price_trend: 12 }), 40);
    // An unlisted printing stays null. `price_trend || 0` would have made an unknown
    // price read as a quote of nothing, and valuationMetadata would count it as priced.
    assert.strictEqual(resolveCardPrice({ game: 'riftbound', price_trend: null, price_normal: 90 }), null);
    assert.strictEqual(resolveCardPrice({ game: 'riftbound', price_trend: 0 }), null);
    // A per-copy value the owner set still wins over any provider price.
    assert.strictEqual(resolveCardPrice({ game: 'riftbound', market_value: 12.5, price_trend: 99 }), 12.5);
    assert.deepStrictEqual(valuationMetadata([{ game: 'riftbound', quantity: 2 }]), {
      unpricedCards: 2, valuationAvailable: false, partialValuation: false, price_status: 'unavailable',
    });
    assert.deepStrictEqual(valuationMetadata([{ game: 'riftbound' }, { game: 'mtg', price_trend: 3 }]), {
      unpricedCards: 1, valuationAvailable: true, partialValuation: true, price_status: 'partial',
    });
    assert.deepStrictEqual(networkAttempts, [], 'every provider, dispatch and set operation must work with networking disabled');
    console.log('riftbound.test.js: 1451 source rows, 1356 exact printings, 1171 verified local images; offline provider, scope, dispatch and text/price contracts passed');
  } finally {
    for (const restore of restorations) restore();
    await new Promise((resolve, reject) => db.dbConnection.close(error => error ? reject(error) : resolve()));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
