// Optional real-model integration: deliberately never downloads weights in CI.
// BINDARR_RIFTBOUND_SCAN=1 CV_MODEL_DIR=/path/to/models node test/e2e/riftboundscan.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

async function main() {
  if (process.env.BINDARR_RIFTBOUND_SCAN !== '1') {
    console.log('riftboundscan.test.js: real-model test skipped; set BINDARR_RIFTBOUND_SCAN=1 and CV_MODEL_DIR to run');
    return;
  }
  const sourceModels = process.env.CV_MODEL_DIR || path.resolve(__dirname, '../../data/models');
  for (const name of ['cornelius.onnx', 'milo.onnx']) {
    assert.ok(fs.existsSync(path.join(sourceModels, name)), `${name} is missing. Run backend/scripts/fetch-models.mjs explicitly first.`);
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bindarr-riftbound-scan-'));
  const models = path.join(temporary, 'models');
  fs.mkdirSync(models);
  for (const name of ['cornelius.onnx', 'milo.onnx']) fs.copyFileSync(path.join(sourceModels, name), path.join(models, name));
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let output = '';
  const server = spawn(process.execPath, ['-r', path.join(__dirname, 'riftbound-offline.js'),
    path.resolve(__dirname, '../../src/server.js')], {
    env: { ...process.env, PORT: String(port), HTTPS_PORT: '', DB_PATH: path.join(temporary, 'scan.db'),
      CV_MODEL_DIR: models, DEFAULT_ADMIN_PASSWORD: 'riftbound-scan-password' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  let token;
  async function api(route, body) {
    const response = await fetch(`${base}${route}`, { method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    assert.strictEqual(response.status, 200, `${route}: ${JSON.stringify(result)}`);
    return result;
  }
  try {
    let ready = false;
    for (let i = 0; i < 200; i++) {
      if (server.exitCode !== null) throw new Error(`Scan server exited ${server.exitCode}`);
      try { ready = (await fetch(`${base}/api/health`)).ok; } catch { /* starting */ }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'scan server did not start');
    ({ token } = await api('/api/auth/login', { username: 'admin', password: 'riftbound-scan-password' }));
    await api('/api/admin/catalogs/build', { game: 'riftbound', lang: 'English' });
    let completed;
    for (let i = 0; i < 1200; i++) {
      const progress = await api('/api/admin/catalogs/progress');
      if (!progress.progress && progress.last) { completed = progress.last; break; }
      if (i % 40 === 0) console.log(`Riftbound scan catalogue: ${JSON.stringify(progress.progress)}`);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(completed, 'full catalogue build timed out');
    assert.strictEqual(completed.phase, 'done', JSON.stringify(completed));
    const manifest = require('../../../shared/riftbound/manifest.json');
    const source = require('../../../shared/riftbound/cards.json');
    const uniqueSourceRecords = new Set(source.cards.map(card => JSON.stringify(card)));
    const meta = JSON.parse(fs.readFileSync(path.join(models, 'milo-riftbound-local.json'), 'utf8'));
    assert.strictEqual(meta.ids.length, uniqueSourceRecords.size, 'every distinct source printing must be embedded');
    assert.deepStrictEqual([...meta.ids].sort(), manifest.printings.map(card => card.id).sort());
    assert.strictEqual(fs.statSync(path.join(models, 'milo-riftbound-local.bin')).size, meta.ids.length * meta.dim * 4);
    assert.match(completed.message, /0 failed/);
    console.log(`PASS: F9-TC1 full offline Riftbound catalogue built: ${meta.ids.length} printings x ${meta.dim} dimensions`);

    const fixtures = [
      ['lonely-poro', 'riftbound-unl-221-219'], ['daring-poro', 'riftbound-unl-225-219'],
      ['mystic-poro', 'riftbound-unl-224-219'], ['veteran-poro', 'riftbound-unl-223-219'],
    ];
    const evidence = { model: 'cornelius + milo', external_network: 'blocked', catalog_printings: meta.ids.length,
      provenance: 'Real camera capture of a monitor displaying sleeved Riftbound cards; single-card rectangular crops.', results: [] };
    for (const [fixture, expected] of fixtures) {
      const image = fs.readFileSync(path.resolve(__dirname, '../fixtures/riftbound', `${fixture}.jpg`)).toString('base64');
      const result = await api('/api/scan-match', { game: 'riftbound', image });
      const first = result.candidates[0];
      console.log(`Riftbound ${fixture}: ${JSON.stringify({ cardId: first?.cardId, name: first?.card?.name,
        score: first?.score, detected: result.detected, notInCatalog: result.notInCatalog, margin: result.margin })}`);
      assert.ok(first, `${fixture} must yield candidates`);
      if (fixture === 'veteran-poro') {
        // This screen-photo frame is below the corner detector's sharpness gate.
        // Its raw-frame fallback must either recover the exact card or refuse
        // to endorse the nearest unrelated image as an identified printing.
        assert.ok(first.cardId === expected || (result.notInCatalog && first.score < 0.55),
          'Veteran must identify correctly or explicitly reject the low-quality frame');
      } else {
        assert.strictEqual(first.cardId, expected, `${fixture} must identify the exact pictured printing`);
        assert.ok(first.score > 0.5, `${fixture} needs useful candidate similarity`);
      }
      assert.strictEqual(first.card.game, 'riftbound');
      assert.strictEqual(first.card.price_status, 'unavailable');
      assert.strictEqual(first.card.price_trend, null);
      assert.strictEqual(typeof result.detected, 'boolean');
      assert.ok(result.crop.startsWith('data:image/jpeg;base64,'));
      assert.ok(result.candidates.every(candidate => candidate.card?.game === 'riftbound'));
      evidence.results.push({ fixture, expected, matched: first.cardId, exact: first.cardId === expected, score: first.score,
        detected: result.detected, notInCatalog: result.notInCatalog, margin: result.margin,
        aboveConfirmationThreshold: first.score >= 0.55 });
    }
    assert.ok(evidence.results.some(result => result.detected), 'exercise actual corner detection and dewarping, not only the raw-frame fallback');
    if (process.env.BINDARR_SCAN_EVIDENCE) fs.writeFileSync(process.env.BINDARR_SCAN_EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`);
    assert.ok(evidence.results.filter(result => result.detected && result.exact && result.aboveConfirmationThreshold).length >= 2,
      'at least two camera frames must identify exact printings above the ordinary confidence threshold');
    console.log('PASS: F9-TC2 real camera-photo scan: exact confident matches, manual candidate and safe low-quality rejection');
  } catch (error) {
    error.message += `\nServer output:\n${output}`;
    throw error;
  } finally {
    if (server.exitCode === null) {
      const closed = new Promise(resolve => server.once('close', resolve));
      server.kill('SIGKILL');
      await closed;
    }
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
