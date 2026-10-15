// Offline snapshot validation: never publish crossed identities or corrupt art.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { ingest, printingNumber } = require('../scripts/ingest-riftbound');

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value));

async function fixture(root) {
  fs.mkdirSync(path.join(root, 'art'), { recursive: true });
  const image = await sharp({ create: { width: 120, height: 168, channels: 3, background: '#b75b38' } }).webp().toBuffer();
  fs.writeFileSync(path.join(root, 'art/card.webp'), image);
  const base = { riftbound_id: 'ogn-001-298', name: 'Example', set: 'OGN', set_label: 'Origins',
    collector_number: 1, type: 'Unit', domains: ['Fury'], text_clean: 'A test card.' };
  const cards = [base, { ...base }, { ...base, name: 'Example (Metal)' },
    { ...base, riftbound_id: 'unl-229*-219', set: 'UNL', set_label: 'Unleashed', name: 'Signature example', collector_number: 229 }];
  const snapshot = { generated_from: 'https://api.riftcodex.com/cards', generated_at: '2026-09-30T00:00:00Z', record_count: cards.length, cards };
  writeJson(path.join(root, 'cards.json'), snapshot);
  const art = { snapshot_sha256: sha256(fs.readFileSync(path.join(root, 'cards.json'))), record_count: cards.length,
    failures: {}, images: { one: { path: 'art/card.webp', sha256: sha256(image), width: 120, height: 168, bytes: image.length } },
    records: cards.map((card, index) => ({ index, riftbound_id: card.riftbound_id, image: 'art/card.webp' })) };
  writeJson(path.join(root, 'art-manifest.json'), art);
  return { snapshot, art, image };
}

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bindarr-riftbound-ingest-'));
  try {
    const source = path.join(temporary, 'source');
    const { image } = await fixture(source);
    const target = path.join(temporary, 'bundle');
    const original = fs.readFileSync(path.join(source, 'cards.json'));
    const result = await ingest(source, target);
    assert.strictEqual(result.enumerated_count, 4);
    assert.strictEqual(result.printing_count, 3);
    assert.strictEqual(result.duplicate_records_collapsed, 1);
    assert.strictEqual(result.source_id_collision_count, 1);
    assert.strictEqual(new Set(result.printings.map(card => card.id)).size, 3, 'Metal printing cannot overwrite its sibling');
    assert.strictEqual(result.printings.find(card => card.riftbound_id === 'unl-229*-219').number, '229*');
    assert.ok(result.printings.filter(card => card.riftbound_id === 'ogn-001-298').every(card => /-v[a-f0-9]{16}$/.test(card.id)));
    assert.deepStrictEqual(result.printings.flatMap(card => card.source_rows).sort(), [0, 1, 2, 3], 'every source record stays accounted for');
    assert.strictEqual(result.price_status, 'unavailable');
    assert.match(result.attribution, /Riot Games/);
    assert.deepStrictEqual(fs.readFileSync(path.join(target, 'cards.json')), original, 'preserve authoritative snapshot bytes');
    assert.deepStrictEqual(fs.readFileSync(path.join(target, 'art', `${sha256(image)}.webp`)), image, 'content address names the actual bytes');
    assert.deepStrictEqual(await ingest(source, target), result, 'reingest preserves stable printing identities');
    assert.deepStrictEqual(fs.readFileSync(path.join(source, 'cards.json')), original, 'ingest cannot alter its source');

    for (const [id, expected] of [['ogn-001a-298', '001a'], ['ogn-001-P', '001-P'], ['ogs-003-STAR', '003-STAR'], ['unl-229*-219', '229*']]) {
      assert.strictEqual(printingNumber({ set: id.slice(0, 3).toUpperCase(), riftbound_id: id }), expected);
    }

    for (const damage of ['snapshot', 'image', 'dimensions', 'identity', 'escape']) {
      const damagedSource = path.join(temporary, `source-${damage}`);
      const { art } = await fixture(damagedSource);
      if (damage === 'snapshot') art.snapshot_sha256 = '0'.repeat(64);
      if (damage === 'image') fs.writeFileSync(path.join(damagedSource, 'art/card.webp'), 'corrupt');
      if (damage === 'dimensions') art.images.one.width++;
      if (damage === 'identity') art.records[0].riftbound_id = 'ogn-999-298';
      if (damage === 'escape') {
        fs.copyFileSync(path.join(damagedSource, 'art/card.webp'), path.join(temporary, 'outside.webp'));
        art.images.one.path = '../outside.webp';
        art.records.forEach(record => { record.image = '../outside.webp'; });
      }
      writeJson(path.join(damagedSource, 'art-manifest.json'), art);
      const destination = path.join(temporary, `bad-${damage}`);
      await assert.rejects(ingest(damagedSource, destination), undefined, `reject ${damage}`);
      assert.ok(!fs.existsSync(destination), `${damage} must fail before publishing any files`);
    }
    await assert.rejects(ingest(source, source), /separate/);
    await assert.rejects(ingest(source, path.join(source, 'nested')), /separate/);
    console.log('riftboundingest.test.js: stable identities, byte preservation and five corruption boundaries passed');
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
