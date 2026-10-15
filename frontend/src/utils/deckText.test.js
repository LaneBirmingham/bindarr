import assert from 'node:assert';
import { buildDeckExport, parseDeckLine, selectImportedCard } from './deckText.js';

const cards = [
  { quantity: 4, name: 'Pikachu ex', set_id: 'svi', number: '63', supertype: 'Pokémon' },
  { quantity: 2, name: "Boss's Orders", set_id: 'pal', number: '172', supertype: 'Trainer' },
  { quantity: 6, name: 'Lightning Energy', set_id: 'sve', number: '4', supertype: 'Energy' },
];

const ptcgl = buildDeckExport(cards, 'ptcgl');
assert.ok(ptcgl.includes('Pokémon: 4'), 'ptcgl Pokémon count');
assert.ok(ptcgl.includes('Energy: 6'), 'ptcgl Energy count');
assert.ok(ptcgl.includes('4 Pikachu ex SVI 63'), 'ptcgl card line');
assert.ok(ptcgl.trim().endsWith('Total Cards: 12'), 'ptcgl total');

const mtga = buildDeckExport(cards, 'mtga');
assert.ok(mtga.startsWith('Deck\n'), 'mtga header');
assert.ok(mtga.includes('4 Pikachu ex (SVI) 63'), 'mtga card line');

assert.strictEqual(buildDeckExport(cards, 'plain').split('\n')[0], '4 Pikachu ex', 'plain line');

assert.deepStrictEqual(parseDeckLine('4 Pikachu ex SVI 63'), { qty: 4, name: 'Pikachu ex' });
assert.deepStrictEqual(parseDeckLine('4 Lightning Bolt (2X2) 117'), { qty: 4, name: 'Lightning Bolt' });
assert.deepStrictEqual(parseDeckLine('2 Pikachu (SVI) #63'), { qty: 2, name: 'Pikachu' });
assert.deepStrictEqual(parseDeckLine('4 Pikachu'), { qty: 4, name: 'Pikachu' });
assert.deepStrictEqual(parseDeckLine('1 Mewtwo GX'), { qty: 1, name: 'Mewtwo GX' }, 'trailing GX kept');
assert.deepStrictEqual(parseDeckLine('3 Pikachu V'), { qty: 3, name: 'Pikachu V' }, 'trailing V kept');
assert.strictEqual(parseDeckLine('not a card line'), null);

console.log('deckText self-check passed');

// buylist: only shortfall vs owned, TCGplayer mass-entry lines
const bl = buildDeckExport([
  { quantity: 4, name: 'Pikachu ex', owned_qty: 1 },
  { quantity: 2, name: 'Ultra Ball', owned_qty: 2 },
  { quantity: 3, name: 'Iono', owned_qty: 0 },
], 'buylist');
assert.strictEqual(bl, '3 Pikachu ex\n3 Iono', 'buylist shortfall lines');

console.log('deckText buylist check passed');

// Exact printing IDs preserve promo/star variants and name suffixes. A name is
// insufficient when the snapshot has several distinct printings of that card.
const riftbound = [
  { id: 'riftbound-ogn-001-298', name: 'Annie', quantity: 2 },
  { id: 'riftbound-unl-229*-219', name: 'Kai’Sa (Signature)', quantity: 1 },
  { id: 'riftbound-ogs-003-STAR', name: 'Example (Alternate Art)', quantity: 1 },
  { id: 'riftbound-ogn-001-P-v1234567890abcdef', name: 'Annie (Metal)', quantity: 1 },
];
const exactLines = buildDeckExport(riftbound, 'riftbound').split('\n');
for (const [index, line] of exactLines.entries()) {
  const card = riftbound[index];
  const parsed = parseDeckLine(line);
  assert.deepStrictEqual(parsed, { qty: card.quantity, name: card.name, cardId: card.id });
  assert.strictEqual(selectImportedCard(riftbound, parsed, 'riftbound'), card);
}
assert.strictEqual(selectImportedCard([
  { id: 'printing-1', name: 'Annie' }, { id: 'printing-2', name: 'Annie' },
], { name: 'Annie', qty: 1 }, 'riftbound'), null, 'ambiguous names require printing selection');
assert.strictEqual(selectImportedCard(riftbound, { name: 'Annie', cardId: 'riftbound-missing', qty: 1 }, 'riftbound'), null,
  'unknown exact IDs never fall back to a same-name printing');
assert.strictEqual(selectImportedCard(riftbound, { name: 'Annie', qty: 1 }, 'riftbound'), riftbound[0]);
assert.strictEqual(selectImportedCard([], { name: 'Missing', qty: 1 }, 'riftbound'), null);
console.log('deckText Riftbound exact-printing round trip passed');
