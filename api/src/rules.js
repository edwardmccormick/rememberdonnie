// Pure input rules for the memory wall: cleaning, validation and moderation.

export const LIMITS = Object.freeze({
  name: 80,
  relation: 80,
  message: 5000,
  photoBytes: 12 * 1024 * 1024,
});

// A person needs more than this long to write a memory. Faster submissions are bots.
export const MIN_COMPOSE_MS = 2500;

// C0/C1 controls (except tab and newline), zero-width characters and bidi overrides.
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/g;

const LINK = /https?:\/\/|www\.|\[url|<a[\s>]|\b[a-z0-9-]{2,}\.(com|net|org|io|ru|cn|xyz|info|biz|top|site|online|shop|ly)\b/i;

const PHOTO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function cleanLine(value) {
  if (typeof value !== 'string') return '';
  return value.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
}

export function cleanText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function containsLink(...values) {
  return values.some((value) => typeof value === 'string' && LINK.test(value));
}

export function isPhotoId(value) {
  return typeof value === 'string' && PHOTO_ID.test(value);
}

function dimension(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 10000 ? n : null;
}

/**
 * Validates a memory submission.
 * Returns { ok: false, error } for input a person should fix,
 * { ok: true, spam: true } for bot traffic we should quietly drop,
 * or { ok: true, value, suspicious } for a memory to store.
 */
export function parseMemoryInput(body, { now }) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Something went wrong reading that. Please try again.' };

  // Honeypot: a field people never see.
  if (cleanLine(body.website)) return { ok: true, spam: true };

  const startedAt = Number(body.startedAt);
  const hasTiming = Number.isFinite(startedAt) && startedAt > 0;
  if (hasTiming && now - startedAt < MIN_COMPOSE_MS) return { ok: true, spam: true };

  const name = cleanLine(body.name);
  const relation = cleanLine(body.relation);
  const message = cleanText(body.message);

  if (!name) return { ok: false, error: 'Please add your name.' };
  if (name.length > LIMITS.name) return { ok: false, error: `Please keep your name under ${LIMITS.name} characters.` };
  if (relation.length > LIMITS.relation) return { ok: false, error: `Please keep "how you knew DJ" under ${LIMITS.relation} characters.` };
  if (!message) return { ok: false, error: 'Please write a memory to share.' };
  if (message.length > LIMITS.message) return { ok: false, error: `Please keep your memory under ${LIMITS.message.toLocaleString('en-US')} characters.` };

  let photoId = null;
  if (body.photoId !== undefined && body.photoId !== null && body.photoId !== '') {
    if (!isPhotoId(body.photoId)) return { ok: false, error: 'That photo upload did not work. Please try adding it again.' };
    photoId = body.photoId;
  }

  return {
    ok: true,
    spam: false,
    // No timing data means the request did not come from our form. Hold it rather than drop it.
    suspicious: !hasTiming,
    value: {
      name,
      relation,
      message,
      photoId,
      photoWidth: photoId ? dimension(body.photoWidth) : null,
      photoHeight: photoId ? dimension(body.photoHeight) : null,
    },
  };
}

/**
 * Why a memory needs a human to look at it before it is public, or null if it can go straight up.
 * mode: 'photos-and-links' (default) | 'all' | 'none'
 */
export function reviewReason(memory, { mode = 'photos-and-links', suspicious = false } = {}) {
  if (mode === 'none') return null;
  if (mode === 'all') return 'all';
  if (memory.photoId) return 'photo';
  if (containsLink(memory.name, memory.relation, memory.message)) return 'link';
  if (suspicious) return 'unverified';
  return null;
}

/** Sortable, URL-safe id: base36 milliseconds (fixed width until 2059) plus randomness. */
export function newMemoryId(now, random) {
  return `${now.toString(36).padStart(9, '0')}-${random}`;
}

export function publicMemory(memory) {
  return {
    id: memory.id,
    name: memory.name,
    relation: memory.relation || '',
    message: memory.message,
    photo: memory.photo || null,
    photoWidth: memory.photo ? memory.photoWidth || null : null,
    photoHeight: memory.photo ? memory.photoHeight || null : null,
    createdAt: memory.createdAt,
  };
}
