// HTTP API (payload v2) handler for rememberdonnie.com, independent of AWS.
// Lambda wires it to DynamoDB/S3/SNS (index.js); tests and the dev server wire it to memory.

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { LIMITS, newMemoryId, parseMemoryInput, publicMemory, reviewReason } from './rules.js';

const DAY_SECONDS = 24 * 60 * 60;

export const RATE_LIMITS = Object.freeze({
  memory: 8,
  photo: 16,
  candle: 12,
});

const MAX_BODY_BYTES = 32 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(status, body, headers = {}) {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
    body: body === undefined ? '' : JSON.stringify(body),
  };
}

function readBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new HttpError(413, 'That is a bit too long to send in one go.');
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Something went wrong reading that. Please try again.');
  }
}

function header(event, name) {
  const headers = event.headers || {};
  return headers[name] ?? headers[name.toLowerCase()];
}

function clientIp(event) {
  // CloudFront-Viewer-Address is "ip:port" or "[ipv6]:port" and cannot be spoofed by the viewer.
  const viewer = header(event, 'cloudfront-viewer-address');
  if (viewer) {
    const bracketed = viewer.match(/^\[(.+)\]:\d+$/);
    if (bracketed) return bracketed[1];
    const idx = viewer.lastIndexOf(':');
    return idx > 0 ? viewer.slice(0, idx) : viewer;
  }
  return event.requestContext?.http?.sourceIp || 'unknown';
}

function today(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function asciiSubject(text) {
  return text.normalize('NFKD').replace(/[^\x20-\x7E]/g, '').slice(0, 99);
}

export function createApp({ store, media, notifier, getSecret, config = {}, now = () => Date.now(), log = console }) {
  const moderationMode = config.moderationMode || 'photos-and-links';
  const siteUrl = (config.siteUrl || '').replace(/\/$/, '');

  async function ipKey(event) {
    const secret = await getSecret();
    return createHmac('sha256', secret).update(clientIp(event)).digest('hex').slice(0, 32);
  }

  async function allow(event, action) {
    const key = await ipKey(event);
    const t = now();
    return store.hitRateLimit(`${key}#${action}#${today(t)}`, RATE_LIMITS[action], Math.floor(t / 1000) + 2 * DAY_SECONDS);
  }

  async function requireAdmin(event) {
    const given = header(event, 'x-admin-key') || '';
    const secret = await getSecret();
    const a = Buffer.from(given);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new HttpError(401, 'That admin key is not right.');
  }

  async function listPublic() {
    const all = await store.listMemories();
    const memories = all.filter((m) => m.status === 'approved').map(publicMemory);
    return json(200, { memories, count: memories.length });
  }

  async function createMemory(event) {
    const body = readBody(event);
    const t = now();
    const parsed = parseMemoryInput(body, { now: t });
    if (!parsed.ok) throw new HttpError(400, parsed.error);

    if (parsed.spam) {
      // Look successful so bots learn nothing; store nothing.
      log.info?.('Dropped a submission that looked automated.');
      return json(201, { status: 'pending', memory: null });
    }

    if (!(await allow(event, 'memory'))) {
      throw new HttpError(429, 'Thank you for sharing so much. Please try again tomorrow.');
    }

    const input = parsed.value;
    if (input.photoId) {
      const info = await media.pendingPhotoInfo(input.photoId);
      if (!info) throw new HttpError(400, 'We could not find that photo. Please try adding it again.');
      if (info.size > LIMITS.photoBytes) throw new HttpError(400, 'That photo is too large.');
    }

    const reason = reviewReason(input, { mode: moderationMode, suspicious: parsed.suspicious });
    const memory = {
      id: newMemoryId(t, randomUUID().slice(0, 8)),
      ...input,
      photo: null,
      status: reason ? 'pending' : 'approved',
      reviewReason: reason,
      createdAt: new Date(t).toISOString(),
    };
    if (memory.status === 'approved' && memory.photoId) {
      memory.photo = await media.publishPhoto(memory.photoId);
    }
    await store.saveMemory(memory);

    try {
      const pending = memory.status === 'pending';
      await notifier.notify(
        asciiSubject(pending ? `Memory for Donnie waiting for review (${reason})` : 'New memory shared for Donnie'),
        [
          `${memory.name}${memory.relation ? ` (${memory.relation})` : ''} shared a memory${memory.photoId ? ' with a photo' : ''}:`,
          '',
          memory.message,
          '',
          pending ? `It is waiting for review: ${siteUrl}/admin` : `It is live on ${siteUrl}/#memories`,
        ].join('\n'),
      );
    } catch (err) {
      log.error?.('Notification failed', err);
    }

    return json(201, { status: memory.status, memory: memory.status === 'approved' ? publicMemory(memory) : null });
  }

  async function createPhotoTicket(event) {
    const body = readBody(event);
    if (body.contentType !== 'image/jpeg') throw new HttpError(400, 'Photos are uploaded as JPEG.');
    const size = Number(body.size);
    if (!Number.isFinite(size) || size <= 0 || size > LIMITS.photoBytes) throw new HttpError(400, 'That photo is too large.');
    if (!(await allow(event, 'photo'))) throw new HttpError(429, 'That is a lot of photos for one day. Please try again tomorrow.');
    const photoId = randomUUID();
    const upload = await media.createUploadTicket(photoId, LIMITS.photoBytes);
    return json(201, { photoId, upload });
  }

  async function candles(event, method) {
    if (method === 'GET') return json(200, { count: await store.getCandleCount() });
    if (!(await allow(event, 'candle'))) {
      return json(429, { error: 'Your candles are lit. Thank you.', count: await store.getCandleCount() });
    }
    return json(201, { count: await store.incrementCandles() });
  }

  async function adminList(event) {
    await requireAdmin(event);
    const all = await store.listMemories();
    const memories = await Promise.all(
      all.map(async (m) => ({
        ...publicMemory(m),
        status: m.status,
        reviewReason: m.reviewReason || null,
        photoId: m.photoId || null,
        photoWidth: m.photoWidth || null,
        photoHeight: m.photoHeight || null,
        photoPreview: m.photoId && !m.photo ? await media.previewUrl(m.photoId) : m.photo || null,
      })),
    );
    return json(200, { memories, candles: await store.getCandleCount() });
  }

  async function adminAction(event) {
    await requireAdmin(event);
    const { id, action } = readBody(event);
    if (typeof id !== 'string' || !id) throw new HttpError(400, 'Which memory?');
    const memory = await store.getMemory(id);
    if (!memory) throw new HttpError(404, 'That memory no longer exists.');

    if (action === 'approve') {
      if (memory.photoId && !memory.photo) memory.photo = await media.publishPhoto(memory.photoId);
      memory.status = 'approved';
      memory.reviewedAt = new Date(now()).toISOString();
      await store.saveMemory(memory);
      return json(200, { memory: { ...publicMemory(memory), status: memory.status } });
    }
    if (action === 'hide') {
      if (memory.photo) await media.unpublishPhoto(memory.photoId);
      memory.photo = null;
      memory.status = 'hidden';
      memory.reviewedAt = new Date(now()).toISOString();
      await store.saveMemory(memory);
      return json(200, { memory: { ...publicMemory(memory), status: memory.status } });
    }
    if (action === 'delete') {
      if (memory.photoId) await media.deletePhoto(memory.photoId);
      await store.deleteMemory(id);
      return json(200, { deleted: id });
    }
    throw new HttpError(400, 'Unknown action.');
  }

  return async function handle(event) {
    const method = (event.requestContext?.http?.method || 'GET').toUpperCase();
    const path = (event.rawPath || event.requestContext?.http?.path || '/').replace(/\/+$/, '');

    try {
      if (path === '/api/health' && method === 'GET') return json(200, { ok: true });
      if (path === '/api/memories' && method === 'GET') return await listPublic();
      if (path === '/api/memories' && method === 'POST') return await createMemory(event);
      if (path === '/api/photos' && method === 'POST') return await createPhotoTicket(event);
      if (path === '/api/candles' && (method === 'GET' || method === 'POST')) return await candles(event, method);
      if (path === '/api/admin/memories' && method === 'GET') return await adminList(event);
      if (path === '/api/admin/memories' && method === 'POST') return await adminAction(event);
      return json(404, { error: 'Not found.' });
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      log.error?.('Unhandled error', err);
      return json(500, { error: 'Something went wrong on our side. Please try again in a moment.' });
    }
  };
}
