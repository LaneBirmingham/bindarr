#!/usr/bin/env node
// Import a complete, already downloaded RiftCodex snapshot. Never uses the network.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const DEFAULT_TARGET = path.resolve(__dirname, '../../shared/riftbound');
// The snapshot carries no prices by design — it is an immutable catalogue of printing
// identities. Prices are TCGplayer's, fetched by the TCGCSV sweep (src/riftboundPrices.js)
// into card_cache once the printings are cached, so this string describes the snapshot
// rather than the game.
const PRICE_UNAVAILABLE = 'This snapshot carries printing identities only; prices come from the TCGCSV sweep once printings are cached.';
const NOTICE = 'Bindarr was created under Riot Games\' "Legal Jibber Jabber" policy using assets owned by Riot Games. Riot Games does not endorse or sponsor this project.';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function safeAsset(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new Error('Invalid art path');
  const file = fs.realpathSync(path.resolve(root, relative));
  if (!file.startsWith(`${root}${path.sep}`)) throw new Error('Art path escapes source directory');
  return file;
}
function atomicWrite(file, bytes) {
  const temp = `${file}.tmp-${process.pid}`;
  try { fs.writeFileSync(temp, bytes); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function realDestination(directory) {
  let ancestor = path.resolve(directory);
  const missing = [];
  while (!fs.existsSync(ancestor)) {
    missing.unshift(path.basename(ancestor));
    ancestor = path.dirname(ancestor);
  }
  return path.join(fs.realpathSync(ancestor), ...missing);
}
function printingNumber(record) {
  const prefix = `${String(record.set).toLowerCase()}-`;
  if (!String(record.riftbound_id).toLowerCase().startsWith(prefix)) throw new Error('Card ID does not match its set');
  const parts = record.riftbound_id.slice(prefix.length).split('-');
  // The final numeric segment is the printed set total, when supplied. Keep
  // letters, stars, promo and STAR suffixes: collector_number alone loses these.
  if (parts.length > 1 && /^\d+$/.test(parts.at(-1))) parts.pop();
  return parts.join('-');
}

async function ingest(sourceDir, targetDir = DEFAULT_TARGET) {
  const source = fs.realpathSync(sourceDir);
  const target = realDestination(targetDir);
  if (source === target || source.startsWith(`${target}${path.sep}`) || target.startsWith(`${source}${path.sep}`)) {
    throw new Error('Source and target directories must be separate');
  }
  const snapshotBytes = fs.readFileSync(path.join(source, 'cards.json'));
  const artBytes = fs.readFileSync(path.join(source, 'art-manifest.json'));
  const snapshot = JSON.parse(snapshotBytes), art = JSON.parse(artBytes);
  const snapshotSha = sha256(snapshotBytes);
  if (art.snapshot_sha256 !== snapshotSha) throw new Error('Art manifest does not match cards.json checksum');
  const records = snapshot.cards;
  if (!Array.isArray(records) || !records.length || snapshot.record_count !== records.length
      || art.record_count !== records.length || !Array.isArray(art.records) || art.records.length !== records.length
      || !art.failures || Object.keys(art.failures).length) throw new Error('Incomplete Riftbound snapshot or art manifest');

  // Validate every input before creating the destination, including actual image
  // decoding rather than trusting a file extension or the manifest dimensions.
  const imagesByPath = new Map(), imagesByHash = new Map();
  for (const image of Object.values(art.images || {})) {
    if (!image || !/^[a-f0-9]{64}$/.test(image.sha256) || !image.path?.endsWith('.webp')) throw new Error('Invalid art manifest entry');
    const previous = imagesByPath.get(image.path);
    if (previous) {
      if (['sha256', 'width', 'height', 'bytes'].some(k => previous[k] !== image[k])) throw new Error('Conflicting art manifest entries');
      continue;
    }
    const file = safeAsset(source, image.path), bytes = fs.readFileSync(file);
    if (sha256(bytes) !== image.sha256 || (image.bytes != null && bytes.length !== image.bytes)) throw new Error(`Art checksum/size mismatch: ${image.path}`);
    const metadata = await sharp(bytes).metadata();
    if (metadata.format !== 'webp' || metadata.width !== image.width || metadata.height !== image.height
        || !(image.width > 0 && image.height > 0)) throw new Error(`Art dimensions mismatch: ${image.path}`);
    await sharp(bytes).stats();
    const verified = { ...image, file, bytes: bytes.length };
    imagesByPath.set(image.path, verified);
    imagesByHash.set(image.sha256, verified);
  }
  if (!imagesByPath.size) throw new Error('Art manifest is empty');

  const groups = new Map();
  for (let index = 0; index < records.length; index++) {
    const record = records[index], link = art.records[index];
    if (!record || typeof record.riftbound_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.*!%-]{0,100}$/.test(record.riftbound_id)
        || !/^[A-Z0-9]+$/.test(record.set) || typeof record.name !== 'string' || !record.name
        || record.collector_number == null || !record.set_label || !record.type || !Array.isArray(record.domains)) throw new Error(`Invalid card record at row ${index}`);
    printingNumber(record);
    if (!link || link.index !== index || link.riftbound_id !== record.riftbound_id || !imagesByPath.has(link.image)) throw new Error(`Art record identity mismatch at row ${index}`);
    const recordSha = sha256(canonicalJson(record));
    let group = groups.get(record.riftbound_id);
    if (!group) groups.set(record.riftbound_id, group = new Map());
    let printing = group.get(recordSha);
    const image = imagesByPath.get(link.image);
    if (!printing) group.set(recordSha, printing = { record, recordSha, image, source_rows: [] });
    if (printing.image.sha256 !== image.sha256) throw new Error(`Identical card record has conflicting artwork: ${record.riftbound_id}`);
    printing.source_rows.push(index);
  }

  const printings = [];
  for (const [sourceId, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    for (const [recordSha, entry] of [...group].sort(([a], [b]) => a.localeCompare(b))) {
      const cardId = `riftbound-${encodeURIComponent(sourceId)}${group.size > 1 ? `-v${recordSha.slice(0, 16)}` : ''}`;
      printings.push({ id: cardId, riftbound_id: sourceId, set: entry.record.set, number: printingNumber(entry.record),
        source_record_sha256: recordSha, source_rows: entry.source_rows, image_sha256: entry.image.sha256 });
    }
  }
  if (new Set(printings.map(p => p.id)).size !== printings.length) throw new Error('Generated card IDs are not unique');
  const manifest = {
    schema_version: 1, game: 'riftbound', source: snapshot.generated_from, fetched_at: snapshot.generated_at,
    snapshot_sha256: snapshotSha, art_manifest_sha256: sha256(artBytes),
    enumerated_count: records.length, printing_count: printings.length,
    source_identity_count: groups.size, source_id_collision_count: [...groups.values()].filter(g => g.size > 1).length,
    duplicate_records_collapsed: records.length - printings.length, image_count: imagesByHash.size,
    price_status: 'unavailable', price_unavailable_reason: PRICE_UNAVAILABLE, attribution: NOTICE,
    images: Object.fromEntries([...imagesByHash].sort(([a], [b]) => a.localeCompare(b)).map(([hash, img]) => [hash, {
      width: img.width, height: img.height, bytes: img.bytes,
    }])), printings,
  };
  fs.mkdirSync(path.join(target, 'art'), { recursive: true });
  for (const [hash, image] of imagesByHash) {
    const destination = path.join(target, 'art', `${hash}.webp`);
    if (!fs.existsSync(destination) || sha256(fs.readFileSync(destination)) !== hash) atomicWrite(destination, fs.readFileSync(image.file));
  }
  // Preserve original inputs byte for byte; the derived manifest is published last.
  atomicWrite(path.join(target, 'cards.json'), snapshotBytes);
  atomicWrite(path.join(target, 'art-manifest.json'), artBytes);
  atomicWrite(path.join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || !args.length) {
    console.log('Usage: node backend/scripts/ingest-riftbound.js <source-data-directory> [target-directory]\nValidates and copies cards.json, art-manifest.json and every referenced WebP. No network access.');
    process.exitCode = args.includes('--help') ? 0 : 1;
  } else if (args.length > 2) { console.error('Expected source directory and optional target directory'); process.exitCode = 1; }
  else ingest(args[0], args[1]).then(m => console.log(`Imported ${m.enumerated_count} source records as ${m.printing_count} unique printings, ${m.image_count} verified images; prices unavailable.`))
    .catch(error => { console.error(`Riftbound ingest failed: ${error.message}`); process.exitCode = 1; });
}
module.exports = { ingest, printingNumber, canonicalJson, PRICE_UNAVAILABLE, NOTICE };
