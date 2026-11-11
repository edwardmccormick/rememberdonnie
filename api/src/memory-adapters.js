// In-memory store/media/notifier with the same contracts as aws.js.
// Used by the tests and by scripts/dev-server.mjs.

export function createMemoryStore() {
  const memories = new Map();
  const counters = new Map();
  let candles = 0;
  return {
    async listMemories() {
      return [...memories.values()].sort((a, b) => (a.id < b.id ? 1 : -1)).map((m) => ({ ...m }));
    },
    async getMemory(id) {
      const m = memories.get(id);
      return m ? { ...m } : null;
    },
    async saveMemory(memory) {
      memories.set(memory.id, { ...memory });
    },
    async deleteMemory(id) {
      memories.delete(id);
    },
    async getCandleCount() {
      return candles;
    },
    async incrementCandles() {
      candles += 1;
      return candles;
    },
    async hitRateLimit(key, limit) {
      const count = counters.get(key) || 0;
      if (count >= limit) return false;
      counters.set(key, count + 1);
      return true;
    },
  };
}

/**
 * uploadUrl(photoId) is where the browser should POST the file; the dev server
 * implements that endpoint and calls receiveUpload().
 */
export function createMemoryMedia({ uploadUrl = (id) => `/__dev/upload/${id}`, previewPath = (id) => `/__dev/pending/${id}.jpg` } = {}) {
  const pending = new Map();
  const published = new Map();
  return {
    pending,
    published,
    receiveUpload(photoId, bytes) {
      pending.set(photoId, Buffer.from(bytes));
    },
    async createUploadTicket(photoId) {
      return { url: uploadUrl(photoId), fields: { 'Content-Type': 'image/jpeg' } };
    },
    async pendingPhotoInfo(photoId) {
      const bytes = pending.get(photoId);
      return bytes ? { size: bytes.length, contentType: 'image/jpeg' } : null;
    },
    async publishPhoto(photoId) {
      published.set(photoId, pending.get(photoId));
      return `/photos/${photoId}.jpg`;
    },
    async unpublishPhoto(photoId) {
      published.delete(photoId);
    },
    async deletePhoto(photoId) {
      pending.delete(photoId);
      published.delete(photoId);
    },
    async previewUrl(photoId) {
      return previewPath(photoId);
    },
  };
}

export function createMemoryNotifier() {
  const sent = [];
  return {
    sent,
    async notify(subject, message) {
      sent.push({ subject, message });
    },
  };
}
