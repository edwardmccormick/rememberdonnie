import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, RATE_LIMITS } from '../src/app.js';
import { createMemoryMedia, createMemoryNotifier, createMemoryStore } from '../src/memory-adapters.js';

const ADMIN_KEY = 'test-admin-key-0123456789';

function setup({ moderationMode } = {}) {
  let clock = Date.parse('2026-11-10T20:00:00Z');
  const store = createMemoryStore();
  const media = createMemoryMedia();
  const notifier = createMemoryNotifier();
  const handle = createApp({
    store,
    media,
    notifier,
    getSecret: async () => ADMIN_KEY,
    config: { moderationMode, siteUrl: 'https://rememberdonnie.com' },
    now: () => clock,
    log: { info() {}, error() {} },
  });

  async function call(method, path, { body, headers = {}, ip = '203.0.113.7' } = {}) {
    const res = await handle({
      rawPath: path,
      requestContext: { http: { method, path, sourceIp: '10.0.0.1' } },
      headers: { 'cloudfront-viewer-address': `${ip}:443`, ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, headers: res.headers };
  }

  const memory = (overrides = {}) => ({ name: 'Ted', relation: 'Coworker', message: 'He made every code review kinder.', startedAt: clock - 30_000, ...overrides });
  const admin = { 'x-admin-key': ADMIN_KEY };

  return { call, memory, admin, store, media, notifier, advance: (ms) => (clock += ms) };
}

test('a plain-text memory goes straight onto the wall', async () => {
  const { call, memory, notifier } = setup();
  const created = await call('POST', '/api/memories', { body: memory() });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'approved');
  assert.equal(created.body.memory.name, 'Ted');

  const list = await call('GET', '/api/memories');
  assert.equal(list.status, 200);
  assert.equal(list.body.count, 1);
  assert.equal(list.body.memories[0].message, 'He made every code review kinder.');
  assert.equal(list.body.memories[0].status, undefined, 'public view hides moderation fields');
  assert.equal(list.headers['cache-control'], 'no-store');

  assert.equal(notifier.sent.length, 1);
  assert.match(notifier.sent[0].message, /live on https:\/\/rememberdonnie.com/);
});

test('the wall lists newest memories first', async () => {
  const { call, memory, advance } = setup();
  await call('POST', '/api/memories', { body: memory({ name: 'First' }) });
  advance(5_000);
  await call('POST', '/api/memories', { body: memory({ name: 'Second' }) });
  const list = await call('GET', '/api/memories');
  assert.deepEqual(list.body.memories.map((m) => m.name), ['Second', 'First']);
});

test('a memory with a link waits for review, then appears once approved', async () => {
  const { call, memory, admin, notifier } = setup();
  const created = await call('POST', '/api/memories', { body: memory({ message: 'Photos at https://example.org/dj' }) });
  assert.equal(created.body.status, 'pending');
  assert.equal(created.body.memory, null);
  assert.equal((await call('GET', '/api/memories')).body.count, 0);
  assert.match(notifier.sent[0].subject, /waiting for review/);

  const queue = await call('GET', '/api/admin/memories', { headers: admin });
  assert.equal(queue.status, 200);
  assert.equal(queue.body.memories[0].status, 'pending');
  assert.equal(queue.body.memories[0].reviewReason, 'link');

  const approved = await call('POST', '/api/admin/memories', { headers: admin, body: { id: queue.body.memories[0].id, action: 'approve' } });
  assert.equal(approved.status, 200);
  assert.equal((await call('GET', '/api/memories')).body.count, 1);
});

test('the photo flow: ticket, upload, pending review, approve publishes the photo', async () => {
  const { call, memory, admin, media } = setup();
  const ticket = await call('POST', '/api/photos', { body: { contentType: 'image/jpeg', size: 1234 } });
  assert.equal(ticket.status, 201);
  const { photoId } = ticket.body;
  assert.match(ticket.body.upload.url, new RegExp(photoId));

  const missing = await call('POST', '/api/memories', { body: memory({ photoId }) });
  assert.equal(missing.status, 400, 'memory cannot point at a photo that was never uploaded');

  media.receiveUpload(photoId, Buffer.alloc(1234));
  const created = await call('POST', '/api/memories', { body: memory({ photoId, photoWidth: 1600, photoHeight: 1200 }) });
  assert.equal(created.body.status, 'pending');

  const queue = await call('GET', '/api/admin/memories', { headers: admin });
  assert.equal(queue.body.memories[0].photoPreview, `/__dev/pending/${photoId}.jpg`);

  await call('POST', '/api/admin/memories', { headers: admin, body: { id: queue.body.memories[0].id, action: 'approve' } });
  const [shown] = (await call('GET', '/api/memories')).body.memories;
  assert.equal(shown.photo, `/photos/${photoId}.jpg`);
  assert.equal(shown.photoWidth, 1600);
  assert.ok(media.published.has(photoId));
});

test('hiding takes a memory and its photo off the wall; delete removes everything', async () => {
  const { call, memory, admin, media } = setup({ moderationMode: 'none' });
  const { body: ticket } = await call('POST', '/api/photos', { body: { contentType: 'image/jpeg', size: 10 } });
  media.receiveUpload(ticket.photoId, Buffer.alloc(10));
  const created = await call('POST', '/api/memories', { body: memory({ photoId: ticket.photoId }) });
  assert.equal(created.body.status, 'approved', "moderation mode 'none' publishes photos immediately");
  const id = created.body.memory.id;

  await call('POST', '/api/admin/memories', { headers: admin, body: { id, action: 'hide' } });
  assert.equal((await call('GET', '/api/memories')).body.count, 0);
  assert.ok(!media.published.has(ticket.photoId));
  assert.ok(media.pending.has(ticket.photoId), 'hiding keeps the original so it can be re-approved');

  await call('POST', '/api/admin/memories', { headers: admin, body: { id, action: 'delete' } });
  assert.equal((await call('GET', '/api/admin/memories', { headers: admin })).body.memories.length, 0);
  assert.ok(!media.pending.has(ticket.photoId));
});

test('admin endpoints require the admin key', async () => {
  const { call } = setup();
  assert.equal((await call('GET', '/api/admin/memories')).status, 401);
  assert.equal((await call('GET', '/api/admin/memories', { headers: { 'x-admin-key': 'nope' } })).status, 401);
  assert.equal((await call('POST', '/api/admin/memories', { body: { id: 'x', action: 'delete' } })).status, 401);
});

test('admin actions on unknown memories or actions fail cleanly', async () => {
  const { call, admin, memory } = setup();
  assert.equal((await call('POST', '/api/admin/memories', { headers: admin, body: { id: 'nope', action: 'approve' } })).status, 404);
  const { body } = await call('POST', '/api/memories', { body: memory() });
  assert.equal((await call('POST', '/api/admin/memories', { headers: admin, body: { id: body.memory.id, action: 'explode' } })).status, 400);
});

test('bots get a fake success and nothing is stored', async () => {
  const { call, memory, notifier } = setup();
  const honeypot = await call('POST', '/api/memories', { body: memory({ website: 'buy now' }) });
  assert.equal(honeypot.status, 201);
  const tooFast = await call('POST', '/api/memories', { body: memory({ startedAt: Date.parse('2026-11-10T20:00:00Z') - 100 }) });
  assert.equal(tooFast.status, 201);
  assert.equal((await call('GET', '/api/memories')).body.count, 0);
  assert.equal(notifier.sent.length, 0);
});

test('validation errors are returned to the person as a message', async () => {
  const { call, memory } = setup();
  const res = await call('POST', '/api/memories', { body: memory({ name: '' }) });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /your name/);
  assert.equal((await call('POST', '/api/memories', { body: '{not json' })).status, 400);
  assert.equal((await call('POST', '/api/memories', { body: 'x'.repeat(40_000) })).status, 413);
});

test('photo tickets only accept reasonably sized JPEGs', async () => {
  const { call } = setup();
  assert.equal((await call('POST', '/api/photos', { body: { contentType: 'image/png', size: 10 } })).status, 400);
  assert.equal((await call('POST', '/api/photos', { body: { contentType: 'image/jpeg', size: 50 * 1024 * 1024 } })).status, 400);
});

test('candles count up and are rate limited per visitor per day', async () => {
  const { call, advance } = setup();
  assert.equal((await call('GET', '/api/candles')).body.count, 0);
  assert.equal((await call('POST', '/api/candles')).body.count, 1);
  for (let i = 1; i < RATE_LIMITS.candle; i++) await call('POST', '/api/candles');
  const limited = await call('POST', '/api/candles');
  assert.equal(limited.status, 429);
  assert.equal(limited.body.count, RATE_LIMITS.candle);

  assert.equal((await call('POST', '/api/candles', { ip: '198.51.100.9' })).status, 201, 'other visitors are unaffected');
  advance(24 * 60 * 60 * 1000);
  assert.equal((await call('POST', '/api/candles')).status, 201, 'the limit resets the next day');
});

test('memories are rate limited per visitor', async () => {
  const { call, memory } = setup();
  for (let i = 0; i < RATE_LIMITS.memory; i++) assert.equal((await call('POST', '/api/memories', { body: memory() })).status, 201);
  assert.equal((await call('POST', '/api/memories', { body: memory() })).status, 429);
});

test('IPv6 viewer addresses are parsed for rate limiting', async () => {
  const { call } = setup();
  const res = await call('POST', '/api/candles', { headers: { 'cloudfront-viewer-address': '[2001:db8::1]:443' } });
  assert.equal(res.status, 201);
});

test('unknown routes 404 and the health check answers', async () => {
  const { call } = setup();
  assert.equal((await call('GET', '/api/nope')).status, 404);
  assert.deepEqual((await call('GET', '/api/health')).body, { ok: true });
});
