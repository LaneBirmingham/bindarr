// SQLite's CURRENT_TIMESTAMP stores UTC but as a naive "YYYY-MM-DD HH:MM:SS"
// string with no timezone marker. JS's Date parser treats a string like that
// as LOCAL time, so on any server not running in UTC, a value that's really
// "now" gets parsed as hours off — enough to misorder it against a properly
// UTC-tagged timestamp (e.g. an ISO string with a trailing Z). Always read
// SQLite datetimes through this so they compare correctly against Date.now()
// or other real UTC timestamps.
function parseSqliteUtc(str) {
  if (!str) return new Date(NaN);
  return /Z$|[+-]\d\d:\d\d$/.test(str) ? new Date(str) : new Date(str.replace(' ', 'T') + 'Z');
}

function isRiftboundCard(card) {
  return !!card && (card.game === 'riftbound' || String(card.card_id || card.id || '').startsWith('riftbound-'));
}

// Riftbound prices are TCGplayer market prices via TCGCSV category 89, matched to
// the exact printing (set + collector number, variant suffix included). A printing
// TCGplayer has no listing for stays unavailable — and still says why, because
// "no listing" on a real card is something the owner can act on, and a plausible
// number invented to fill the gap is not.
const RIFTBOUND_NO_LISTING = 'No TCGplayer listing matched this printing.';

function priceMetadata(card) {
  if (!isRiftboundCard(card)) return {};
  if (card.market_value > 0) return { price_status: 'manual' };
  return card.price_trend > 0
    ? { price_status: 'available' }
    : { price_status: 'unavailable', price_unavailable_reason: RIFTBOUND_NO_LISTING };
}

// Unknown Riftbound prices remain null, including rows with stale/foreign
// provider columns. An explicit owner value is still a useful per-copy value.
function resolveCardPrice(card) {
  if (!card) return 0;
  // A value set on the copy wins over every provider price. It is either what the
  // owner typed or what a graded-price provider returned for this exact slab, and
  // both know something card_cache cannot: a PSA 10 is worth a multiple of the raw
  // price, and the raw price is all the card APIs quote. Only rows selected with
  // collection.market_value carry it, so a bare card_cache row is unaffected.
  if (card.market_value > 0) return card.market_value;
  // Riftbound is one price per printing with no finish fallback chain, so the
  // `|| 0` on the last line must not apply to it. An unlisted printing has to
  // stay null: valuationMetadata counts a null as unpriced, and returning 0 there
  // would present an unknown as a quote of nothing. A copy the owner marked as
  // the foil finish reads that column, which is the same choice the Pokémon path
  // makes for 'Holofoil'.
  if (isRiftboundCard(card)) {
    if (card.printing === 'Foil' && card.price_holofoil > 0) return card.price_holofoil;
    return card.price_trend > 0 ? card.price_trend : null;
  }
  if (card.printing === 'Holofoil' && card.price_holofoil !== null && card.price_holofoil > 0) {
    return card.price_holofoil;
  }
  if (card.printing === 'Reverse Holofoil' && card.price_reverse_holofoil !== null && card.price_reverse_holofoil > 0) {
    return card.price_reverse_holofoil;
  }
  if (card.printing === 'Normal' && card.price_normal !== null && card.price_normal > 0) {
    return card.price_normal;
  }
  // '1st Edition' has been a legal printing since v1.0 but had no price of its own,
  // so it fell through to price_trend — the UNLIMITED price. On a Base Set Charizard
  // that understates the card by thousands. Only TCGCSV fills this column, so the
  // fallthrough below still covers every row nothing has priced that way.
  if (card.printing === '1st Edition' && card.price_1st_edition !== null && card.price_1st_edition > 0) {
    return card.price_1st_edition;
  }
  return card.price_trend || 0;
}

// Totals are subtotals when a game has no approved price source. Carry coverage
// with every aggregate so an unknown value is never presented as a zero quote.
function valuationMetadata(rows) {
  let totalCards = 0, unpricedCards = 0;
  for (const row of rows) {
    const qty = row.quantity || 1;
    totalCards += qty;
    if (resolveCardPrice(row) === null) unpricedCards += qty;
  }
  const valuationAvailable = !unpricedCards || unpricedCards < totalCards;
  return {
    unpricedCards,
    valuationAvailable,
    partialValuation: unpricedCards > 0 && valuationAvailable,
    price_status: !unpricedCards ? 'available' : (valuationAvailable ? 'partial' : 'unavailable'),
  };
}

// Hydrate a raw card_cache row: its array columns are stored as JSON strings,
// so parse them back to arrays. Missing columns (e.g. color_identity on a
// Pokémon row) become []. Returns a shallow copy; the raw row is untouched.
function parseCardRow(row) {
  if (!row) return row;
  return {
    ...row,
    ...priceMetadata(row),
    subtypes: JSON.parse(row.subtypes || '[]'),
    types: JSON.parse(row.types || '[]'),
    color_identity: JSON.parse(row.color_identity || '[]'),
  };
}

// position orders cards WITHIN a single compartment (a binder page, a box
// row) — see compartmentSort.js for how a card's compartment+position is
// chosen in the first place.
async function rebalanceCompartmentPositions(db, compartmentId, userId) {
  if (!compartmentId) return;
  const cards = await db.all(`SELECT id FROM collection WHERE compartment_id = ? AND user_id = ? ORDER BY position ASC`, [compartmentId, userId]);
  for (let i = 0; i < cards.length; i++) {
    const cleanPos = (i + 1) * 1000;
    await db.run(`UPDATE collection SET position = ? WHERE id = ?`, [cleanPos, cards[i].id]);
  }
}

const isVintageSet = (setId) => {
  const id = (setId || '').toLowerCase();
  return id.startsWith('base') || id.startsWith('gym') || id.startsWith('neo') ||
         id.startsWith('lc') || id.startsWith('ecard') || id.startsWith('ex') ||
         id.startsWith('pop') || id.startsWith('promo1') || id.startsWith('si') ||
         id.startsWith('xy12') || id.startsWith('cel25');
};

// Record a price point, but only when it actually moved. The price sweep runs
// on every boot and nodemon reboots on every code edit, so the unguarded insert
// was writing a fresh row per card per restart — 17k rows in a single day, all
// the same number. A price series only needs the points where the price
// changed; the flat stretches between them are implied by the line.
async function recordPrice(cardId, price) {
  if (!cardId || !(price > 0)) return false;
  const db = require('../db');
  const last = await db.get(
    `SELECT price FROM price_history WHERE card_id = ? ORDER BY recorded_at DESC LIMIT 1`,
    [cardId]
  );
  if (last && last.price === price) return false;
  // Millisecond resolution, not CURRENT_TIMESTAMP. recorded_at is part of the
  // primary key, and the default is second-resolution — so two genuine price
  // movements in the same second collided and the second one was silently
  // dropped by OR IGNORE. %f keeps the guard while making that effectively
  // impossible. parseSqliteUtc already reads the fractional form correctly.
  const res = await db.run(
    `INSERT OR IGNORE INTO price_history (card_id, price, recorded_at)
     VALUES (?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    [cardId, price]
  );
  if (res && res.changes === 0) {
    await db.run(
      `INSERT OR IGNORE INTO price_history (card_id, price, recorded_at)
       VALUES (?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now', '+1 millisecond'))`,
      [cardId, price]
    );
  }
  return true;
}

// Scryfall: "We only update prices for cards once per day. Fetching card data
// more frequently than 24 hours will not yield new prices."
// (https://scryfall.com/docs/api/rate-limits). Sweeping more often than daily
// is pure load for zero new data, so both providers gate on this.
const PRICE_SWEEP_INTERVAL_MS = 1000 * 60 * 60 * 24;
// tcgdex gets its own clock: it serves the non-English Pokémon cards that
// pokemontcg.io has no rows for, so the two sweep different cards and letting
// either one mark the other's gate would silently skip a whole language.
// Every provider that sweeps needs an entry here, and an unknown key is treated as
// "do not sweep" — so a provider added to server.js but forgotten here goes quiet
// instead of loud: shouldSweepPrices returns false, the boot catch-up skips, and
// markPricesSwept no-ops. That is exactly what happened to tcgcsv on first run.
const SWEEP_COLUMN = {
  mtg: 'mtg_prices_swept_at',
  pokemon: 'pokemon_prices_swept_at',
  tcgdex: 'tcgdex_prices_swept_at',
  pokemontcgapi: 'pokemontcgapi_prices_swept_at',
  tcgcsv: 'tcgcsv_prices_swept_at',
  // Lorcana was the next one to go quiet exactly as the paragraph above
  // predicts. lorcastApi has asked for 'lorcana' since it was written and
  // db.js has had the column since then too, but this map never got the key --
  // so shouldSweepPrices('lorcana') answered false forever, markPricesSwept
  // no-opped, and lorcana_prices_swept_at has never once been written on any
  // install. It was invisible because the daily interval passed force: true and
  // skipped the gate, which is exactly why that argument is gone now.
  lorcana: 'lorcana_prices_swept_at',
  // Riftbound prices come from TCGCSV category 89 — TCGplayer's own Riftbound
  // catalogue — matched per printing. Its own clock: different game, different
  // cache rows, different group list and a different set of traps (see
  // riftboundPrices.js).
  riftbound: 'riftbound_prices_swept_at',
};

// How often the automatic sweep is allowed to run, as configured. 0 turns it off.
//
// Every provider here is free except one, and that one is metered: the optional
// pokemontcgapi.com provider charges credits per card refreshed, so a daily
// sweep of a 5,000-card collection is a recurring bill rather than a recurring
// courtesy. Someone who checks their collection value monthly should be able to
// say so and pay a thirtieth as much.
//
// Unreadable or missing settings fall back to daily, which is what every install
// did before this existed.
const DEFAULT_PRICE_REFRESH_DAYS = 1;

async function priceRefreshDays() {
  const db = require('../db');
  try {
    const row = await db.get(`SELECT price_refresh_days FROM app_settings WHERE id = 1`);
    const n = Number(row && row.price_refresh_days);
    return Number.isInteger(n) && n >= 0 ? n : DEFAULT_PRICE_REFRESH_DAYS;
  } catch {
    return DEFAULT_PRICE_REFRESH_DAYS;
  }
}

// Has this game's price sweep gone stale enough to be worth running again?
//
// This is now the ONLY thing deciding when an automatic sweep runs. server.js
// used to pass force: true from its daily timer, on the reasoning that the timer
// was itself the right cadence — which meant this function's answer was ignored
// in the only case that mattered, and that a provider missing from SWEEP_COLUMN
// (tcgcsv once, lorcana until today) looked fine because the forced path never
// asked. The timer now ticks hourly and unforced, and this decides.
//
// Hourly rather than daily on purpose: with a daily tick and a daily interval,
// any drift at all leaves "23h 59m elapsed" at the moment of the tick, which
// skips and turns a daily refresh into an every-other-day one. Checking often
// and refusing cheaply has no such edge.
async function shouldSweepPrices(game) {
  const col = SWEEP_COLUMN[game];
  if (!col) return false;
  const days = await priceRefreshDays();
  if (days === 0) return false;            // automatic refresh switched off
  const db = require('../db');
  try {
    const row = await db.get(`SELECT ${col} AS sweptAt FROM app_settings WHERE id = 1`);
    if (!row || !row.sweptAt) return true;
    return Date.now() - parseSqliteUtc(row.sweptAt).getTime() >= days * PRICE_SWEEP_INTERVAL_MS;
  } catch {
    return true; // never block the sweep on a bookkeeping failure
  }
}

async function markPricesSwept(game) {
  const col = SWEEP_COLUMN[game];
  if (!col) return;
  const db = require('../db');
  try {
    await db.run(`UPDATE app_settings SET ${col} = CURRENT_TIMESTAMP WHERE id = 1`);
  } catch (e) {
    console.warn(`Could not record ${game} price sweep time:`, e.message);
  }
}

module.exports = {
  parseSqliteUtc,
  shouldSweepPrices,
  markPricesSwept,
  priceRefreshDays,
  DEFAULT_PRICE_REFRESH_DAYS,
  PRICE_SWEEP_INTERVAL_MS,
  resolveCardPrice,
  priceMetadata,
  RIFTBOUND_NO_LISTING,
  valuationMetadata,
  isRiftboundCard,
  parseCardRow,
  rebalanceCompartmentPositions,
  isVintageSet,
  recordPrice
};
