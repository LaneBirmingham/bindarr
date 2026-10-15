// Riftbound uses a bundled, validated snapshot. Core catalogue operations never
// contact RiftCodex, image hosts, sibling projects or a marketplace.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { cacheNormalizedCards } = require('./utils/cardCache');
const { parseSetList } = require('./utils/setQuery');
const languages = require('./utils/languages');

const DATA_DIR = path.resolve(__dirname, '../../shared/riftbound');
const ART_DIR = path.join(DATA_DIR, 'art');
const PRICE_UNAVAILABLE = 'No exact-printing price source with an approved licence has been verified.';
const NOTICE = 'Bindarr was created under Riot Games\' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
let snapshotCache;

function decodeText(value) {
  let text = String(value || '');
  const named = { amp: '&', gt: '>', lt: '<', quot: '"', apos: "'", nbsp: ' ' };
  for (let i = 0; i < 2; i++) {
    text = text.replace(/&(#x[0-9a-f]+|#\d+|amp|gt|lt|quot|apos|nbsp);/gi, (entity, token) => {
      if (token[0] !== '#') return named[token.toLowerCase()] || entity;
      const point = token[1].toLowerCase() === 'x' ? parseInt(token.slice(2), 16) : parseInt(token.slice(1), 10);
      return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    });
  }
  return text.replace(/\]\s*\[/g, '] [');
}
function loadSnapshot() {
  if (snapshotCache) return snapshotCache;
  const manifest = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'manifest.json'), 'utf8'));
  const cardBytes = fs.readFileSync(path.join(DATA_DIR, 'cards.json'));
  const artBytes = fs.readFileSync(path.join(DATA_DIR, 'art-manifest.json'));
  if (manifest.schema_version !== 1 || manifest.game !== 'riftbound'
      || sha256(cardBytes) !== manifest.snapshot_sha256 || sha256(artBytes) !== manifest.art_manifest_sha256) {
    throw new Error('Riftbound snapshot checksum mismatch; run the offline ingest script');
  }
  const source = JSON.parse(cardBytes);
  if (source.cards?.length !== manifest.enumerated_count || source.record_count !== manifest.enumerated_count
      || manifest.printings?.length !== manifest.printing_count) throw new Error('Riftbound snapshot is incomplete');
  const entries = new Map(), sourceRows = new Set();
  for (const printing of manifest.printings) {
    const raw = source.cards[printing.source_rows?.[0]];
    if (!raw || entries.has(printing.id) || !printing.id.startsWith('riftbound-')
        || printing.riftbound_id !== raw.riftbound_id || printing.set !== raw.set
        || !manifest.images[printing.image_sha256]) throw new Error('Invalid Riftbound printing identity');
    for (const index of printing.source_rows) {
      if (!Number.isInteger(index) || index < 0 || index >= source.cards.length || sourceRows.has(index)
          || source.cards[index].riftbound_id !== raw.riftbound_id) throw new Error('Invalid Riftbound source row mapping');
      sourceRows.add(index);
    }
    entries.set(printing.id, { raw, printing });
  }
  if (sourceRows.size !== manifest.enumerated_count) throw new Error('Riftbound source rows are missing');
  snapshotCache = { manifest, entries, setCodes: new Set(manifest.printings.map(printing => printing.set.toLowerCase())) };
  return snapshotCache;
}
function normalizeCard(raw, printing) {
  if (!printing) {
    const found = [...loadSnapshot().entries.values()].find(entry => entry.raw === raw
      || (entry.raw.riftbound_id === raw?.riftbound_id && JSON.stringify(entry.raw) === JSON.stringify(raw)));
    if (!found) throw new Error('A verified Riftbound printing is required');
    printing = found.printing;
  }
  return {
    id: printing.id,
    name: decodeText(raw.name),
    supertype: raw.type,
    subtypes: raw.supertype ? [raw.supertype] : [],
    types: [...(raw.domains || [])],
    rarity: raw.rarity || 'Unknown',
    set_id: `riftbound-${raw.set.toLowerCase()}`,
    set_name: raw.set_label,
    number: printing.number,
    image_url: `/api/riftbound/art/${printing.image_sha256}.webp`,
    price_trend: null, price_normal: null, price_holofoil: null,
    price_reverse_holofoil: null, price_avg1: null, price_avg7: null, price_avg30: null,
    price_1st_edition: null, price_currency: null, price_source: null,
    price_status: 'unavailable', price_unavailable_reason: PRICE_UNAVAILABLE,
    cmc: raw.energy, color_identity: [...(raw.domains || [])],
    game: 'riftbound', language: 'English', printed_name: null,
    tcgplayer_url: null, cardmarket_url: null, tcgplayer_product_id: null,
    riftbound_id: raw.riftbound_id, collector_number: String(raw.collector_number),
    rules_text: decodeText(raw.text_clean || raw.text), text: decodeText(raw.text),
    keywords: [...(raw.keywords || [])], play_keywords: [...(raw.play_keywords || [])],
    ability_keywords: [...(raw.ability_keywords || [])], referenced_keywords: [...(raw.referenced_keywords || [])],
    energy: raw.energy, power: raw.power, might: raw.might, speed: raw.speed,
    hidden: !!raw.hidden, playable_from_hand: !!raw.playable_from_hand,
    alternate_art: !!raw.alternate_art, signature: !!raw.signature,
    overnumbered: !!raw.overnumbered, is_base_printing: !!raw.is_base_printing,
    source_record_sha256: printing.source_record_sha256, source_rows: [...printing.source_rows],
    image_sha256: printing.image_sha256, attribution: NOTICE,
  };
}
function allCards() { return [...loadSnapshot().entries.values()].map(({ raw, printing }) => normalizeCard(raw, printing)); }
async function cacheCards(cards) {
  const entries = loadSnapshot().entries;
  // Only immutable catalogue identities are accepted. In particular, callers
  // cannot attach a guessed marketplace price to a Riftbound row by re-caching.
  const verified = (cards || []).map(c => entries.get(c?.id)).filter(Boolean)
    .map(({ raw, printing }) => normalizeCard(raw, printing));
  await cacheNormalizedCards(verified, 'riftbound');
}
function cleanNumber(number) {
  return String(number || '').trim().replace(/^#/, '').split('/')[0].trim().toLowerCase();
}
function matchesNumber(card, value) {
  const number = cleanNumber(value);
  if (!number) return true;
  const strip = n => String(n).replace(/^0+(?=\d)/, '').toLowerCase();
  // Numeric searches find all variants of that numbered card. A suffix search
  // is exact, so 229* and 229 do not silently select the same printing.
  if (/^\d+$/.test(number)) return strip(card.collector_number) === strip(number)
    || strip(card.number) === strip(number);
  return strip(card.number) === strip(number) || card.riftbound_id.toLowerCase() === number;
}
function matchesSet(card, sets) {
  return !sets.length || sets.some(set => {
    const term = String(set).trim().toLowerCase();
    const code = term.replace(/^riftbound-/, '');
    // PR is a set code, while "Proving Grounds" and every promotional set
    // contain that substring. A recognized code selects one exact set only.
    if (loadSnapshot().setCodes.has(code)) return card.set_id === `riftbound-${code}`;
    return card.set_name.toLowerCase().includes(term);
  });
}
async function searchCards({ name = '', number = '', set = '', scope = 'database', userId = null,
  page = 1, limit = 60, lang = 'en' } = {}) {
  if (!languages.isEnglish(lang)) return { cards: [], total: 0 };
  const term = String(name).trim().toLowerCase(), sets = parseSetList(set);
  let cards = allCards().filter(card => card.name.toLowerCase().includes(term) && matchesNumber(card, number) && matchesSet(card, sets));
  if (scope === 'collection') {
    const owned = await db.all(`SELECT card_id, SUM(quantity) AS owned_qty FROM collection
      WHERE user_id = ? AND list_type = 'collection' GROUP BY card_id`, [userId]);
    const quantities = new Map(owned.map(row => [row.card_id, row.owned_qty]));
    cards = cards.filter(card => quantities.has(card.id)).map(card => ({ ...card, owned_qty: quantities.get(card.id) }));
  }
  cards.sort((a, b) => a.set_id.localeCompare(b.set_id)
    || a.number.localeCompare(b.number, 'en', { numeric: true }) || a.id.localeCompare(b.id));
  const total = cards.length, size = Math.max(1, Math.min(5000, Number(limit) || 60));
  const offset = (Math.max(1, Number(page) || 1) - 1) * size;
  const selected = cards.slice(offset, offset + size);
  await cacheCards(selected);
  return { cards: selected, total };
}
async function getCardById(id) {
  const entry = loadSnapshot().entries.get(String(id));
  if (!entry) return null;
  const card = normalizeCard(entry.raw, entry.printing);
  await cacheCards([card]);
  return card;
}
async function getCardsBySet(set, lang = 'en') {
  if (!languages.isEnglish(lang)) return [];
  const cards = allCards().filter(card => matchesSet(card, [set]));
  await cacheCards(cards);
  return cards;
}
async function listSets(lang = 'en') {
  if (!languages.isEnglish(lang)) return [];
  const sets = new Map();
  for (const card of allCards()) {
    let set = sets.get(card.set_id);
    if (!set) sets.set(card.set_id, set = { id: card.set_id, name: card.set_name, series: 'Riftbound', total: 0,
      printed_total: 0, release_date: '', ptcgo_code: card.set_id.replace(/^riftbound-/, '').toUpperCase(), symbol_url: '', logo_url: '', game: 'riftbound' });
    set.total++;
    if (card.is_base_printing) set.printed_total++;
  }
  return [...sets.values()].sort((a, b) => a.name.localeCompare(b.name));
}
async function fetchAndCacheSets() {
  const sets = await listSets();
  for (const s of sets) await db.run(`INSERT INTO sets
    (id, name, series, printed_total, total, release_date, ptcgo_code, symbol_url, logo_url, game)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'riftbound')
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, series=excluded.series, printed_total=excluded.printed_total,
      total=excluded.total, release_date=excluded.release_date, ptcgo_code=excluded.ptcgo_code, game=excluded.game`,
  [s.id, s.name, s.series, s.printed_total, s.total, s.release_date, s.ptcgo_code, s.symbol_url, s.logo_url]);
  return sets;
}
async function cacheAllCards() {
  const cards = allCards();
  await cacheCards(cards);
  return cards;
}
async function updateCollectionPrices() {
  // Deliberately no request and no price-history point: no licensed exact-printing
  // provider has been approved for this snapshot.
  return { price_status: 'unavailable', reason: PRICE_UNAVAILABLE };
}
function localArtPath(imageUrl) {
  const match = String(imageUrl || '').match(/^\/api\/riftbound\/art\/([a-f0-9]{64})\.webp$/);
  if (!match || !loadSnapshot().manifest.images[match[1]]) return null;
  return path.join(ART_DIR, `${match[1]}.webp`);
}
module.exports = { searchCards, normalizeCard, cacheCards, getCardsBySet, cacheAllCards, listSets,
  fetchAndCacheSets, updateCollectionPrices, getCardById, localArtPath, DATA_DIR, ART_DIR, NOTICE, PRICE_UNAVAILABLE };
