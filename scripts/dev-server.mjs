// Local preview for rememberdonnie.com.
// Serves site/ and runs the real API (api/src/app.js) against in-memory storage,
// with the same Content-Security-Policy as production so violations show up here.
//
//   node scripts/dev-server.mjs            empty wall
//   node scripts/dev-server.mjs --seed     placeholder memories to preview the layout
//
// Admin page: http://localhost:8787/admin  (key: dev-admin-key)

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../api/src/app.js';
import { createMemoryMedia, createMemoryStore } from '../api/src/memory-adapters.js';

const ROOT = resolve(fileURLToPath(new URL('../site', import.meta.url)));
const args = process.argv.slice(2);
const PORT = Number(process.env.PORT || 8787);
const ADMIN_KEY = 'dev-admin-key';
const MAX_UPLOAD = 12 * 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const store = createMemoryStore();
const media = createMemoryMedia();
const handle = createApp({
  store,
  media,
  notifier: { async notify(subject, message) { console.log(`\n[email] ${subject}\n${message}\n`); } },
  getSecret: async () => ADMIN_KEY,
  config: { siteUrl: `http://localhost:${PORT}` },
});

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_UPLOAD + 64 * 1024) throw new Error('too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Pulls the "file" part out of a multipart/form-data body (what S3 presigned POST receives). */
function multipartFile(body, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!match) return null;
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  let start = body.indexOf(boundary);
  while (start !== -1) {
    const next = body.indexOf(boundary, start + boundary.length);
    if (next === -1) break;
    const part = body.subarray(start + boundary.length + 2, next - 2);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1 && /name="file"/.test(part.subarray(0, headerEnd).toString())) return part.subarray(headerEnd + 4);
    start = next;
  }
  return null;
}

function send(res, status, body, type = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers });
  res.end(body);
}

async function serveStatic(res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel === '/admin' || rel === '/admin/') rel = '/admin.html';
  const file = resolve(ROOT, `.${rel}`);
  if (file !== ROOT && !file.startsWith(ROOT + sep)) return send(res, 403, 'Forbidden');
  try {
    const info = await stat(file);
    const target = info.isDirectory() ? join(file, 'index.html') : file;
    const body = await readFile(target);
    const type = TYPES[extname(target)] || 'application/octet-stream';
    return send(res, 200, body, type, type.startsWith('text/html') ? { 'content-security-policy': CSP } : {});
  } catch {
    const body = await readFile(join(ROOT, '404.html'));
    return send(res, 404, body, TYPES['.html'], { 'content-security-policy': CSP });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname } = url;
  try {
    if (pathname.startsWith('/api/')) {
      const body = await readBody(req);
      const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(',') : v]));
      const result = await handle({
        rawPath: pathname,
        rawQueryString: url.search.slice(1),
        headers,
        requestContext: { http: { method: req.method, path: pathname, sourceIp: req.socket.remoteAddress } },
        body: body.length ? body.toString('utf8') : undefined,
        isBase64Encoded: false,
      });
      res.writeHead(result.statusCode, result.headers);
      return res.end(result.body);
    }

    const upload = pathname.match(/^\/__dev\/upload\/([0-9a-f-]{36})$/);
    if (upload && req.method === 'POST') {
      const file = multipartFile(await readBody(req), req.headers['content-type']);
      if (!file || file.length > MAX_UPLOAD) return send(res, 400, 'Bad upload');
      media.receiveUpload(upload[1], file);
      return send(res, 204, '');
    }

    const photo = pathname.match(/^\/(__dev\/pending|photos)\/([0-9a-f-]{36})\.jpg$/);
    if (photo) {
      const bytes = (photo[1] === 'photos' ? media.published : media.pending).get(photo[2]);
      return bytes ? send(res, 200, bytes, 'image/jpeg') : serveStatic(res, '/404');
    }

    return serveStatic(res, pathname);
  } catch (err) {
    console.error(err);
    return send(res, 500, 'Server error');
  }
});

async function seed() {
  const now = Date.now();
  const sample = (minutesAgo, fields) => {
    const created = now - minutesAgo * 60_000;
    return store.saveMemory({
      id: `${created.toString(36).padStart(9, '0')}-${Math.random().toString(16).slice(2, 10)}`,
      relation: '',
      photoId: null,
      photo: null,
      status: 'approved',
      reviewReason: null,
      createdAt: new Date(created).toISOString(),
      ...fields,
    });
  };
  const photoId = '00000000-0000-4000-8000-000000000001';
  media.receiveUpload(photoId, await readFile(join(ROOT, 'assets/img/og.jpg')));
  await media.publishPhoto(photoId);

  await sample(5, { name: 'Sample Person', relation: 'Local preview only', message: 'This is placeholder text so the memory wall can be previewed locally. Real memories are shared on rememberdonnie.com.' });
  await sample(40, { name: 'Another Sample', relation: 'Coworker', message: 'A placeholder memory with a photo attached, to check how photos sit on the wall.', photoId, photo: `/photos/${photoId}.jpg`, photoWidth: 1200, photoHeight: 630 });
  await sample(90, { name: 'Long Placeholder', relation: 'Friend', message: `${'A longer placeholder memory to check how the wall handles several paragraphs of text and the read-more toggle. '.repeat(3)}\n\n${'It keeps going for a while, the way the best stories do when someone has a lot to say. '.repeat(4)}\n\nAnd a final short paragraph.` });
  await sample(200, { name: 'Short One', message: 'A short placeholder.' });
  await sample(300, { name: 'Sample Family Member', relation: 'Family', message: 'Placeholder text of a medium length. Enough to wrap onto a few lines so the masonry layout has some variety to work with.' });
  await sample(400, { name: 'Pending Sample', message: 'This placeholder includes a link (https://example.org) so it waits in the admin review queue.', status: 'pending', reviewReason: 'link' });
  for (let i = 0; i < 23; i++) await store.incrementCandles();
}

if (args.includes('--seed')) await seed();

server.listen(PORT, () => {
  console.log(`rememberdonnie dev server: http://localhost:${PORT}${args.includes('--seed') ? ' (seeded with placeholders)' : ''}`);
  console.log(`admin: http://localhost:${PORT}/admin  key: ${ADMIN_KEY}`);
});
