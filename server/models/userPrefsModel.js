const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const CACHE_DIR = path.join(__dirname, '..', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'user_prefs.json');

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
    if (!Array.isArray(parsed)) throw new Error('user_prefs cache is not an array');
    memoryStore.length = 0;
    parsed.forEach((raw) => { if (raw && typeof raw === 'object') memoryStore.push({ ...raw }); });
    loaded = true;
  } catch (err) {
    if (err && err.code === 'ENOENT') { loaded = true; return; }
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      await fs.rename(CACHE_FILE, path.join(CACHE_DIR, `user_prefs.corrupt.${ts}.json`));
    } catch (_) { /* ignore */ }
    memoryStore.length = 0;
    loaded = true;
    console.warn('[user-prefs-cache] reset:', err?.message || err);
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
    .catch((err) => console.error('[user-prefs-cache] persist error:', err));
  return writeQueue;
}

const UserPrefs = {
  async sync() { await ensureLoaded(); },

  async findByUserId(userId) {
    await ensureLoaded();
    return memoryStore.find((p) => p.userId === userId) || null;
  },

  async findOrCreate(userId, fingerprint) {
    await ensureLoaded();
    let prefs = memoryStore.find((p) => p.userId === userId);
    if (!prefs) {
      prefs = {
        userId,
        fingerprint: fingerprint || '',
        label: '',
        recentModels: ['gpt-image-2'],
        defaultAspectRatio: '16:9',
        defaultImageSize: '1K',
        recentStyleProfileIds: [],
        recentTemplateIds: [],
        recentPromptPatterns: [],
        totalGenerations: 0,
        lastActiveAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      memoryStore.push(prefs);
      await enqueuePersist();
    }
    return prefs;
  },

  async update(userId, patch) {
    await ensureLoaded();
    const item = memoryStore.find((p) => p.userId === userId);
    if (!item) return null;
    Object.assign(item, patch, { updatedAt: new Date().toISOString() });
    await enqueuePersist();
    return item;
  },

  async recordGeneration(userId, { model, aspectRatio, imageSize, styleProfileId, templateId, promptPattern }) {
    await ensureLoaded();
    let prefs = memoryStore.find((p) => p.userId === userId);
    if (!prefs) {
      prefs = await this.findOrCreate(userId, '');
    }

    if (model && !prefs.recentModels.includes(model)) {
      prefs.recentModels = [model, ...prefs.recentModels].slice(0, 5);
    }
    if (aspectRatio) prefs.defaultAspectRatio = aspectRatio;
    if (imageSize) prefs.defaultImageSize = imageSize;
    if (styleProfileId && !prefs.recentStyleProfileIds.includes(styleProfileId)) {
      prefs.recentStyleProfileIds = [styleProfileId, ...prefs.recentStyleProfileIds].slice(0, 5);
    }
    if (templateId && !prefs.recentTemplateIds.includes(templateId)) {
      prefs.recentTemplateIds = [templateId, ...prefs.recentTemplateIds].slice(0, 10);
    }
    if (promptPattern) {
      prefs.recentPromptPatterns = [promptPattern, ...prefs.recentPromptPatterns].slice(0, 10);
    }
    prefs.totalGenerations = (prefs.totalGenerations || 0) + 1;
    prefs.lastActiveAt = new Date().toISOString();
    prefs.updatedAt = new Date().toISOString();

    await enqueuePersist();
    return prefs;
  },

  async findAll() {
    await ensureLoaded();
    return [...memoryStore].sort((a, b) => new Date(b.lastActiveAt) - new Date(a.lastActiveAt));
  },
};

module.exports = { UserPrefs };
