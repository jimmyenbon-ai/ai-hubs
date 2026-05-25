const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const CACHE_DIR = path.join(__dirname, '..', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'style_profiles.json');

const memoryStore = [];
let loaded = false;
let loadPromise = null;
let writeQueue = Promise.resolve();

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

async function loadFromDisk() {
  await ensureCacheDir();
  try {
    const text = await fs.readFile(CACHE_FILE, 'utf8');
    if (!text.trim()) { loaded = true; return; }
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('style_profiles cache is not an array');
    memoryStore.length = 0;
    parsed.forEach((raw) => { if (raw && typeof raw === 'object') memoryStore.push({ ...raw }); });
    loaded = true;
  } catch (err) {
    if (err && err.code === 'ENOENT') { loaded = true; return; }
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      await fs.rename(CACHE_FILE, path.join(CACHE_DIR, `style_profiles.corrupt.${ts}.json`));
    } catch (_) { /* ignore */ }
    memoryStore.length = 0;
    loaded = true;
    console.warn('[style-profiles-cache] reset:', err?.message || err);
  }
}

async function ensureLoaded() {
  if (loaded) return;
  if (!loadPromise) loadPromise = loadFromDisk();
  await loadPromise;
}

async function persistToDisk() {
  await ensureLoaded();
  await ensureCacheDir();
  const tmp = `${CACHE_FILE}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(memoryStore, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, CACHE_FILE);
}

function enqueuePersist() {
  writeQueue = writeQueue
    .then(() => persistToDisk())
    .catch((err) => console.error('[style-profiles-cache] persist error:', err));
  return writeQueue;
}

const StyleProfile = {
  async sync() { await ensureLoaded(); },

  async findAll({ tag, search } = {}) {
    await ensureLoaded();
    let list = [...memoryStore];
    if (tag) list = list.filter((s) => s.tags && s.tags.includes(tag));
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((s) =>
        (s.name || '').toLowerCase().includes(q) ||
        (s.description || '').toLowerCase().includes(q) ||
        (s.promptTemplate || '').toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  },

  async findById(id) {
    await ensureLoaded();
    return memoryStore.find((s) => s.id === id) || null;
  },

  async create(attrs) {
    await ensureLoaded();
    const record = {
      id: attrs.id || uuidv4(),
      name: attrs.name || '未命名风格',
      description: attrs.description || '',
      sourceHistoryId: attrs.sourceHistoryId || null,
      promptTemplate: attrs.promptTemplate || '',
      parameters: attrs.parameters || { model: 'gpt-image-2', aspectRatio: '16:9', imageSize: '1K' },
      referenceImageUrl: attrs.referenceImageUrl || null,
      tags: attrs.tags || [],
      usageCount: attrs.usageCount || 0,
      rating: attrs.rating || 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    memoryStore.push(record);
    await enqueuePersist();
    return record;
  },

  async update(id, patch) {
    await ensureLoaded();
    const item = memoryStore.find((s) => s.id === id);
    if (!item) return null;
    Object.assign(item, patch, { updatedAt: new Date().toISOString() });
    await enqueuePersist();
    return item;
  },

  async destroy(id) {
    await ensureLoaded();
    const index = memoryStore.findIndex((s) => s.id === id);
    if (index === -1) return 0;
    memoryStore.splice(index, 1);
    await enqueuePersist();
    return 1;
  },

  async incrementUsage(id) {
    await ensureLoaded();
    const item = memoryStore.find((s) => s.id === id);
    if (!item) return;
    item.usageCount = (item.usageCount || 0) + 1;
    item.updatedAt = new Date().toISOString();
    await enqueuePersist();
  },
};

module.exports = { StyleProfile };
