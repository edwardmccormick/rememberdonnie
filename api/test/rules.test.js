import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanLine, cleanText, containsLink, newMemoryId, parseMemoryInput, reviewReason } from '../src/rules.js';

const NOW = Date.parse('2026-11-10T20:00:00Z');
const form = (overrides = {}) => ({ name: 'Ted', relation: 'Coworker', message: 'He always had time for you.', startedAt: NOW - 60_000, ...overrides });

test('cleanLine collapses whitespace and strips invisible characters', () => {
  assert.equal(cleanLine('  Ted \n\t McCormick​‮ '), 'Ted McCormick');
  assert.equal(cleanLine(undefined), '');
});

test('cleanText keeps paragraphs but normalizes line endings and runs of blank lines', () => {
  assert.equal(cleanText('First line  \r\nsecond\r\n\r\n\r\n\r\nthird\u0007'), 'First line\nsecond\n\nthird');
});

test('containsLink spots urls and bare domains but not ordinary prose', () => {
  assert.ok(containsLink('see https://example.org'));
  assert.ok(containsLink('visit www.example.org'));
  assert.ok(containsLink('cheap-pills.com today'));
  assert.ok(!containsLink('He loved Node.js, e.g. late nights shipping the payments service.'));
  assert.ok(!containsLink('DJ was the best.'));
});

test('a complete memory is accepted and cleaned', () => {
  const result = parseMemoryInput(form({ name: '  Ted  ', message: 'One\r\ntwo' }), { now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.spam, false);
  assert.equal(result.suspicious, false);
  assert.deepEqual(result.value, { name: 'Ted', relation: 'Coworker', message: 'One\ntwo', photoId: null, photoWidth: null, photoHeight: null });
});

test('missing or oversized fields come back as a friendly error', () => {
  assert.match(parseMemoryInput(form({ name: '   ' }), { now: NOW }).error, /your name/);
  assert.match(parseMemoryInput(form({ message: '' }), { now: NOW }).error, /write a memory/);
  assert.match(parseMemoryInput(form({ name: 'x'.repeat(81) }), { now: NOW }).error, /under 80/);
  assert.match(parseMemoryInput(form({ message: 'x'.repeat(5001) }), { now: NOW }).error, /under 5,000/);
  assert.match(parseMemoryInput(form({ photoId: '../../etc/passwd' }), { now: NOW }).error, /photo/);
  assert.equal(parseMemoryInput(null, { now: NOW }).ok, false);
});

test('honeypot and too-fast submissions are flagged as spam', () => {
  assert.deepEqual(parseMemoryInput(form({ website: 'http://spam' }), { now: NOW }), { ok: true, spam: true });
  assert.deepEqual(parseMemoryInput(form({ startedAt: NOW - 500 }), { now: NOW }), { ok: true, spam: true });
});

test('a submission without form timing is kept but marked suspicious', () => {
  const result = parseMemoryInput(form({ startedAt: undefined }), { now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.suspicious, true);
});

test('photo dimensions are kept only alongside a photo', () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  assert.equal(parseMemoryInput(form({ photoId: id, photoWidth: 1600, photoHeight: 1200 }), { now: NOW }).value.photoWidth, 1600);
  assert.equal(parseMemoryInput(form({ photoWidth: 1600 }), { now: NOW }).value.photoWidth, null);
  assert.equal(parseMemoryInput(form({ photoId: id, photoWidth: -3 }), { now: NOW }).value.photoWidth, null);
});

test('reviewReason holds photos, links and unverified posts by default', () => {
  assert.equal(reviewReason({ message: 'Plain words.' }), null);
  assert.equal(reviewReason({ message: 'Plain words.', photoId: 'x' }), 'photo');
  assert.equal(reviewReason({ message: 'https://x.org' }), 'link');
  assert.equal(reviewReason({ name: 'www.spam.example', message: 'hi' }), 'link');
  assert.equal(reviewReason({ message: 'Plain words.' }, { suspicious: true }), 'unverified');
});

test('reviewReason respects the moderation mode', () => {
  assert.equal(reviewReason({ message: 'Plain words.' }, { mode: 'all' }), 'all');
  assert.equal(reviewReason({ message: 'https://x.org', photoId: 'x' }, { mode: 'none' }), null);
});

test('memory ids sort in creation order', () => {
  const a = newMemoryId(Date.parse('2026-11-10T00:00:00Z'), 'ffffffff');
  const b = newMemoryId(Date.parse('2026-11-10T00:00:01Z'), '00000000');
  const c = newMemoryId(Date.parse('2031-01-01T00:00:00Z'), '00000000');
  assert.ok(a < b && b < c);
  assert.match(a, /^[0-9a-z]{9}-ffffffff$/);
});
