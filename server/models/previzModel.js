const fs = require('fs/promises');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'previz_projects.json');

const memoryStore = [];
let nextId = 1;
let loaded = false;
let loadPromise = null;
let writeQueue = Promise.resolve();

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: Number(raw.id),
    name: String(raw.name || '未命名项目'),
    actors: Array.isArray(raw.actors) ? raw.actors : [],
    props: Array.isArray(raw.props) ? raw.props : [],
    cameras: Array.isArray(raw.cameras) ? raw.cameras : [],
    timeline: Array.isArray(raw.timeline) ? raw.timeline : [],
    config: raw.config || { aspectRatio: '16:9', fps: 24 },
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

async function loadFromDisk() {
  await ensureCacheDir();
  try {
    const text = await fs.readFile(CACHE_FILE, 'utf8');
    if (!text.trim()) {
      loaded = true;
      return;
    }
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('previz_projects cache is not an array');
    memoryStore.length = 0;
    let maxId = 0;
    parsed.forEach((raw) => {
      const record = normalizeRecord(raw);
      if (!record || !Number.isFinite(record.id)) return;
      memoryStore.push(record);
      if (record.id > maxId) maxId = record.id;
    });
    nextId = maxId + 1;
    loaded = true;
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      loaded = true;
      return;
    }
    memoryStore.length = 0;
    nextId = 1;
    loaded = true;
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
    .catch((err) => console.error('[previz-cache] persist error:', err));
  return writeQueue;
}

const PrevizProject = {
  async create(attrs) {
    await ensureLoaded();
    const now = new Date().toISOString();
    const record = normalizeRecord({ id: nextId++, createdAt: now, updatedAt: now, ...attrs });
    memoryStore.push(record);
    await enqueuePersist();
    return record;
  },

  async findByPk(id) {
    await ensureLoaded();
    return memoryStore.find((item) => item.id === Number(id)) || null;
  },

  async findAll(opts = {}) {
    await ensureLoaded();
    let list = [...memoryStore];
    if (opts.order === 'desc') list.reverse();
    if (typeof opts.limit === 'number') list = list.slice(0, opts.limit);
    return list;
  },

  async updateById(id, patch) {
    await ensureLoaded();
    const item = memoryStore.find((record) => record.id === Number(id));
    if (!item) return null;
    Object.assign(item, patch, { updatedAt: new Date().toISOString() });
    await enqueuePersist();
    return item;
  },

  async destroy(id) {
    await ensureLoaded();
    const index = memoryStore.findIndex((item) => item.id === Number(id));
    if (index === -1) return 0;
    memoryStore.splice(index, 1);
    await enqueuePersist();
    return 1;
  },
};

module.exports = { PrevizProject };
