// Real server + fresh SQLite + bundled snapshot, with external HTTP disabled.
// Run: node test/e2e/riftbound.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '../../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bindarr-riftbound-e2e-'));
let output = '';

async function unusedPort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

async function main() {
  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['-r', path.join(__dirname, 'riftbound-offline.js'),
    path.join(projectRoot, 'backend/src/server.js')], {
    env: { ...process.env, PORT: String(port), HTTPS_PORT: '',
      DB_PATH: path.join(temporary, 'collection.db'), CV_MODEL_DIR: path.join(temporary, 'models'),
      DEFAULT_ADMIN_PASSWORD: 'riftbound-test-password', ALLOW_REGISTRATION: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });

  async function request(route, { token, method = 'GET', body, status = 200, text = false } = {}) {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = text ? await response.text() : await response.json();
    assert.strictEqual(response.status, status, `${method} ${route}: ${JSON.stringify(result)}`);
    return result;
  }

  try {
    let ready = false;
    for (let attempt = 0; attempt < 200; attempt++) {
      if (child.exitCode !== null) throw new Error(`Server exited ${child.exitCode}: ${output}`);
      try { ready = (await fetch(`${base}/api/health`)).ok; } catch { /* starting */ }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, `Server startup timed out: ${output}`);
    await request('/api/collection', { status: 401 });
    const { token } = await request('/api/auth/login', {
      method: 'POST', body: { username: 'admin', password: 'riftbound-test-password' },
    });
    assert.ok(token);

    const sets = await request('/api/sets?game=riftbound', { token });
    assert.ok(sets.length > 0, 'snapshot ingestion must populate the real set catalogue');
    assert.ok(sets.every(set => set.game === 'riftbound' && set.id.startsWith('riftbound-')));
    const cards = await request('/api/search?game=riftbound&set=OGN&number=001&scope=internet', { token });
    assert.ok(cards.length > 0, 'Origins #001 must be available without external HTTP');
    assert.ok(cards.every(card => card.game === 'riftbound' && card.set_id === 'riftbound-ogn' && /^0*1$/.test(card.number)));
    const card = cards[0];
    assert.strictEqual(card.price_trend, null, 'catalogue must not invent a market price');
    assert.strictEqual(card.price_status, 'unavailable');
    assert.ok(card.image_url.startsWith('/'), 'core art must be served locally');
    const art = await fetch(`${base}${card.image_url}`);
    assert.strictEqual(art.status, 200);
    assert.match(art.headers.get('content-type'), /image\//);
    assert.match(art.headers.get('x-riftbound-attribution'), /Riot Games/);
    assert.match(art.headers.get('link'), /\/api\/riftbound\/attribution/);
    assert.ok((await art.arrayBuffer()).byteLength > 1000);
    assert.match((await request('/api/riftbound/attribution')).notice, /Riot Games/);
    await request('/api/riftbound/art/' + '0'.repeat(64) + '.webp', { status: 404 });
    const search = await request(`/api/search?game=riftbound&name=${encodeURIComponent(card.name)}`, { token });
    assert.ok(search.some(row => row.id === card.id));
    assert.deepStrictEqual(await request('/api/search?game=riftbound&lang=ja', { token }), [], 'English snapshot must not invent translations');
    console.log('PASS: F8-TC1 offline ingest, exact set/number/name search, local card art');

    const binder = await request('/api/locations', { token, method: 'POST', body: {
      name: 'Riftbound Binder', type: 'Binder', game: 'riftbound', sort_order: 'custom',
      compartmentPlan: { count: 2, capacity: 9 },
    } });
    const pages = await request(`/api/locations/${binder.id}/compartments`, { token });
    assert.strictEqual(pages.length, 2);
    await request('/api/collection', { token, method: 'POST', body: {
      card_id: card.id, quantity: 1, game: 'riftbound', language: 'English', printing: 'Normal', purchase_price: 7.25,
    } });
    let owned = await request('/api/collection?game=riftbound', { token });
    assert.strictEqual(owned.length, 1);
    const entry = owned[0];
    assert.strictEqual(entry.game, 'riftbound');
    assert.strictEqual(entry.price_status, 'unavailable');
    await request(`/api/collection/${entry.entry_id}/place`, { token, method: 'POST',
      body: { compartment_id: pages[1].id, slot: 5 } });
    owned = await request('/api/collection?game=riftbound', { token });
    assert.strictEqual(owned[0].location_id, binder.id);
    assert.strictEqual(owned[0].compartment_id, pages[1].id);
    assert.strictEqual(owned[0].position, 5000, 'binder slot uses slot * 1000');
    console.log('PASS: F8-TC2 add collection and place into binder page 2 pocket 5');

    const deck = await request('/api/decks', { token, method: 'POST', status: 201,
      body: { name: 'Riftbound E2E', game: 'riftbound', target_size: 40 } });
    await request(`/api/decks/${deck.id}/cards`, { token, method: 'POST', body: { card_id: card.id, quantity: 1 } });
    const details = await request(`/api/decks/${deck.id}`, { token });
    assert.strictEqual(details.game, 'riftbound');
    assert.strictEqual(details.cards[0].id, card.id);
    assert.strictEqual(details.cards[0].price_status, 'unavailable');
    const locator = await request(`/api/decks/${deck.id}/locations`, { token });
    assert.strictEqual(locator[0].found, 1);
    assert.strictEqual(locator[0].missing, 0);
    assert.strictEqual(locator[0].locations[0].position, 5000);
    await request(`/api/decks/${deck.id}/checkout`, { token, method: 'PUT' });
    assert.strictEqual((await request(`/api/decks/${deck.id}`, { token })).checked_out, 1);
    await request(`/api/decks/${deck.id}/return`, { token, method: 'PUT' });
    assert.strictEqual((await request(`/api/decks/${deck.id}`, { token })).checked_out, 0);
    console.log('PASS: F8-TC3 Riftbound deck, physical locator, checkout and return');

    const stats = await request('/api/stats?game=riftbound', { token });
    assert.strictEqual(stats.summary.totalCards, 1);
    assert.strictEqual(stats.summary.totalSpent, 7.25);
    assert.strictEqual(stats.summary.totalValue, null);
    assert.strictEqual(stats.summary.unpricedCards, 1);
    assert.strictEqual(stats.summary.valuationAvailable, false);
    assert.strictEqual(stats.summary.roi.abs, null);
    const networth = await request('/api/stats/networth?game=riftbound', { token });
    assert.strictEqual(networth.totalValue, null);
    assert.strictEqual(networth.gain, null);
    assert.strictEqual(networth.gainPct, null);
    assert.strictEqual(networth.byGame.riftbound.value, null);
    console.log('PASS: F8-TC4 dashboard and net worth explicitly unavailable');

    const exported = await request('/api/export?format=json', { token });
    assert.strictEqual(exported.length, 1);
    assert.strictEqual(exported[0].card_id, card.id);
    assert.strictEqual(exported[0].game, 'riftbound');
    assert.strictEqual(exported[0].price_status, 'unavailable');
    assert.strictEqual(exported[0].market_price, null);
    assert.strictEqual(exported[0].sub_location_2, '5');
    const csv = await request('/api/export?format=csv', { token, text: true });
    assert.ok(csv.split('\n')[0].includes('Game'));
    assert.ok(csv.split('\n')[0].includes('Price Status'));
    assert.ok(csv.includes('"riftbound"'));

    await request('/api/auth/register', { method: 'POST', status: 201,
      body: { username: 'riftbound-second', password: 'riftbound-second-password' } });
    const { token: second } = await request('/api/auth/login', { method: 'POST',
      body: { username: 'riftbound-second', password: 'riftbound-second-password' } });
    assert.deepStrictEqual(await request('/api/collection', { token: second }), []);
    assert.deepStrictEqual(await request('/api/locations', { token: second }), []);
    await request(`/api/decks/${deck.id}`, { token: second, status: 404 });
    await request(`/api/decks/${deck.id}/checkout`, { token: second, method: 'PUT', status: 404 });
    await request(`/api/collection/${entry.entry_id}/place`, { token: second, method: 'POST', status: 404,
      body: { compartment_id: pages[1].id, slot: 1 } });
    const imported = await request('/api/import', { token: second, method: 'POST',
      body: { format: 'json', data: exported } });
    assert.strictEqual(imported.count, 1);
    const secondCards = await request('/api/collection', { token: second });
    assert.strictEqual(secondCards.length, 1);
    assert.strictEqual(secondCards[0].card_id, card.id);
    assert.strictEqual(secondCards[0].game, 'riftbound');
    assert.strictEqual(secondCards[0].price_status, 'unavailable');
    assert.strictEqual(secondCards[0].location_id, null, 'import cannot claim another user storage');
    const csvImport = await request('/api/import', { token: second, method: 'POST', body: { format: 'internal', data: csv } });
    assert.strictEqual(csvImport.count, 1);
    const pairImport = await request('/api/import', { token: second, method: 'POST', body: { format: 'json',
      data: [{ game: 'riftbound', set_code: card.set_id, collector_number: card.number, name: card.name, quantity: 1 }] } });
    assert.strictEqual(pairImport.count, 1, 'set and collector number resolve from the local snapshot');
    assert.strictEqual((await request('/api/collection', { token: second })).length, 3);
    await request('/api/import', { token: second, method: 'POST', status: 400,
      body: { format: 'json', data: [{ game: 'riftbound', name: card.name, quantity: 1 }] } });
    await request('/api/import', { token: second, method: 'POST', status: 400,
      body: { format: 'json', data: [{ game: 'riftbound', card_id: card.id, language: 'Japanese', quantity: 1 }] } });
    assert.strictEqual((await request('/api/collection', { token: second })).length, 3, 'failed imports must not create guessed or translated printings');
    assert.strictEqual((await request('/api/collection', { token })).length, 1);
    console.log('PASS: F8-TC5 JSON/CSV/exact-pair import, language rejection and cross-user isolation');


    const box = await request('/api/locations', { token, method: 'POST', body: {
      name: 'Riftbound Box', type: 'Box', game: 'riftbound', sort_order: 'custom',
      compartmentPlan: { count: 1, capacity: 20 },
    } });
    const rows = await request(`/api/locations/${box.id}/compartments`, { token });
    await request(`/api/collection/${entry.entry_id}/place`, { token, method: 'POST',
      body: { compartment_id: rows[0].id, slot: 1 } });
    const boxed = (await request('/api/collection?game=riftbound', { token }))[0];
    assert.strictEqual(boxed.location_id, box.id);
    assert.strictEqual(boxed.position, 1000);
    const sharing = await request('/api/auth/settings', { token, method: 'PUT',
      body: { share_enabled: true, share_locations: true } });
    const publicRoute = `/api/shared/${sharing.user.share_token}`;
    let shared = await request(publicRoute);
    assert.strictEqual(shared.stats.summary.totalValue, null);
    assert.strictEqual(shared.collection[0].game, 'riftbound');
    assert.strictEqual(shared.collection[0].price_status, 'unavailable');
    const publicBox = await request(`${publicRoute}/containers/${box.id}`);
    assert.strictEqual(publicBox.cards[0].position, 1000);
    assert.strictEqual(publicBox.cards[0].price_trend, null);
    await request(`/api/collection/${entry.entry_id}`, { token, method: 'PUT', body: { market_value: 12.5 } });
    const manuallyValued = await request('/api/stats?game=riftbound', { token });
    assert.strictEqual(manuallyValued.summary.totalValue, 12.5);
    assert.strictEqual(manuallyValued.summary.unpricedCards, 0);
    shared = await request(publicRoute);
    assert.strictEqual(shared.stats.summary.totalValue, 12.5);
    assert.strictEqual(shared.collection[0].price_status, 'manual');
    await request(`/api/collection/${entry.entry_id}`, { token, method: 'PUT', body: { market_value: null } });
    assert.strictEqual((await request('/api/stats?game=riftbound', { token })).summary.totalValue, null);
    await request(`/api/collection/${entry.entry_id}/place`, { token, method: 'POST',
      body: { compartment_id: pages[1].id, slot: 5 } });
    console.log('PASS: F8-TC8 box storage, public sharing and explicit owner value roundtrip');

    await request('/api/collection', { token, method: 'POST', status: 400,
      body: { card_id: card.id, game: 'riftbound', language: 'Japanese', quantity: 1 } });
    await request('/api/collection', { token, method: 'POST',
      body: { card_id: card.id, game: 'riftbound', language: 'English', quantity: 4 } });
    await request(`/api/decks/${deck.id}/cards`, { token, method: 'POST', body: { card_id: card.id, quantity: 5 } });
    assert.strictEqual((await request(`/api/decks/${deck.id}`, { token })).cards[0].quantity, 5,
      'casual Riftbound lists must not inherit the other games four-copy cap');
    await request(`/api/decks/${deck.id}/cards`, { token, method: 'POST', status: 400, body: { card_id: card.id, quantity: 6 } });
    const foreignDeck = await request('/api/decks', { token, method: 'POST', status: 201,
      body: { name: 'Pokemon boundary', game: 'pokemon' } });
    await request(`/api/decks/${foreignDeck.id}/cards`, { token, method: 'POST', status: 400,
      body: { card_id: card.id, quantity: 1 } });
    const signatures = await request('/api/search?game=riftbound&set=UNL&number=229*', { token });
    const signature = signatures[0];
    assert.ok(signature.id.includes('*'));
    await request('/api/collection', { token, method: 'POST',
      body: { card_id: signature.id, quantity: 1, game: 'riftbound', language: 'English' } });
    const signatureDeck = await request('/api/decks', { token, method: 'POST', status: 201, body: {
      name: 'Exact signature deck', game: 'riftbound', decklist_text: `1 ${signature.name} [${signature.id}]`,
    } });
    assert.strictEqual((await request(`/api/decks/${signatureDeck.id}`, { token })).cards[0].id, signature.id);
    console.log('PASS: F8-TC7 owned-copy and game deck boundaries, casual lists and star-signature exact list import');

    const noCatalog = await request('/api/scan-match', { token, method: 'POST', status: 503,
      body: { game: 'riftbound', image: Buffer.alloc(200, 1).toString('base64') } });
    assert.strictEqual(noCatalog.game, 'riftbound');
    assert.strictEqual(noCatalog.notBuilt, true);
    assert.strictEqual(noCatalog.verified, false);
    assert.deepStrictEqual(noCatalog.candidates, []);
    console.log('PASS: F8-TC6 missing Riftbound scan catalog retains 503 notBuilt contract');
  } catch (error) {
    error.message += `\nServer output:\n${output}`;
    throw error;
  } finally {
    if (child.exitCode === null) {
      const closed = new Promise(resolve => child.once('close', resolve));
      child.kill('SIGKILL');
      await closed;
    }
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
