// The one list of price sweeps the server runs, so the hourly tick and the boot
// catch-up cannot drift apart: a provider added to only one of two hand-kept lists
// refreshes at the wrong time (or never) with nothing reporting it.
//
// `key` is the provider's SWEEP_COLUMN key in priceHelpers.js — the gate that
// shouldSweepPrices/markPricesSwept use. A key missing from that map goes quiet
// without an error, so test/pricesweeplist.test.js asserts every entry has one.
//
// Order is deliberate and unchanged from before the extraction: TCGCSV runs after
// the other Pokémon sweeps because it is the better source and should have the
// final say on any card it can place.
//
// Providers are required lazily, as the server did, to keep startup order intact.
const PRICE_SWEEPS = [
  { key: 'pokemon', run: () => require('../tcgApi').updateCollectionPrices() },
  { key: 'mtg', run: () => require('../scryfallApi').updateCollectionPrices() },
  { key: 'lorcana', run: () => require('../lorcastApi').updateCollectionPrices() },
  // Non-English Pokémon cards: their ids 404 on pokemontcg.io, so tcgApi's sweep
  // skips them and this is their only price refresh.
  { key: 'tcgdex', run: () => require('../tcgdexApi').updateCollectionPrices() },
  { key: 'pokemontcgapi', run: () => require('../pokemontcgapi').updateCollectionPrices() },
  { key: 'tcgcsv', run: () => require('../tcgcsvApi').updateCollectionPrices() },
  // Riftbound is a separate catalogue: TCGCSV category 89, its own sweep gate.
  { key: 'riftbound', run: () => require('../riftboundPrices').updateCollectionPrices() },
];

// Start every sweep, unforced: each decides for itself whether it is due.
function runPriceSweeps() {
  for (const sweep of PRICE_SWEEPS) sweep.run();
}

module.exports = { PRICE_SWEEPS, runPriceSweeps };
