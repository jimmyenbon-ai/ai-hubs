/**
 * BatchJob — 批量生成任务模型（内存存储 + JSON 文件持久化）
 * 持久化到 server/cache/batch_jobs.json
 */

const fs = require('fs/promises');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'batch_jobs.json');

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
    name: String(raw.name || ''),
    items: Array.isArray(raw.items) ? raw.items.map((item) => ({
      index: Number(item.index),
      prompt: String(item.prompt || ''),
      model: item.model || null,
      aspectRatio: item.aspectRatio || null,
      imageSize: item.imageSize || null,
      status: item.status || 'queued',
      resultImageUrl: item.resultImageUrl || null,
      error: item.error || null,
      recordId: item.recordId || null,
    })) : [],
    defaultModel: raw.defaultModel || 'gpt-image-2',
    defaultAspectRatio: raw.defaultAspectRatio || '1:1',
    defaultImageSize: raw.defaultImageSize || '1K',
    status: raw.status || 'queued',
    totalCount: Number(raw.totalCount) || 0,
    completedCount: Number(raw.completedCount) || 0,
    failedCount: Number(raw.failedCount) || 0,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

function toDiskRecord(rec) {
  return { ...rec };
}

async function loadFromDisk() {
  await ensureCacheDir();
  try {
    const text = await fs.readFile(CACHE_FILE, 'utf8');
    if (!text.trim()) { loaded = true; return; }
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('batch_jobs cache is not an array');
    memoryStore.length = 0;
    let maxId = 0;
    parsed.forEach((raw) => {
      const rec = normalizeRecord(raw);
      if (!rec || !Number.isFinite(rec.id)) return;
      memoryStore.push(rec);
      if (rec.id > maxId) maxId = rec.id;
    });
    nextId = maxId + 1;
    loaded = true;
  } catch (err) {
    if (err && err.code === 'ENOENT') { loaded = true; return; }
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      await fs.rename(CACHE_FILE, path.join(CACHE_DIR, `batch_jobs.corrupt.${ts}.json`));
    } catch (_) { /* ignore */ }
    memoryStore.length = 0;
    nextId = 1;
    loaded = true;
    console.warn('[batch-cache] cache file was invalid; reset to empty:', err?.message || err);
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
  const payload = memoryStore.map(toDiskRecord);
  const tmp = `${CACHE_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, CACHE_FILE);
}

function enqueuePersist() {
  writeQueue = writeQueue
    .then(() => persistToDisk())
    .catch((err) => { console.error('[batch-cache] persist error:', err); });
  return writeQueue;
}

const BatchJob = {
  async create(attrs) {
    await ensureLoaded();
    const now = new Date().toISOString();
    const record = normalizeRecord({
      id: nextId++,
      createdAt: now,
      updatedAt: now,
      ...attrs,
      totalCount: (attrs.items || []).length,
    });
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
    const item = memoryStore.find((x) => x.id === Number(id));
    if (!item) return null;
    Object.assign(item, patch, { updatedAt: new Date().toISOString() });
    await enqueuePersist();
    return item;
  },

  async updateItem(jobId, itemIndex, patch) {
    await ensureLoaded();
    const job = memoryStore.find((x) => x.id === Number(jobId));
    if (!job) return null;
    const item = job.items.find((x) => x.index === Number(itemIndex));
    if (!item) return null;
    Object.assign(item, patch);
    // update counts
    job.completedCount = job.items.filter((x) => x.status === 'completed').length;
    job.failedCount = job.items.filter((x) => x.status === 'failed').length;
    job.updatedAt = new Date().toISOString();
    await enqueuePersist();
    return item;
  },

  async destroy(id) {
    await ensureLoaded();
    const idx = memoryStore.findIndex((x) => x.id === Number(id));
    if (idx === -1) return 0;
    memoryStore.splice(idx, 1);
    await enqueuePersist();
    return 1;
  },
};

module.exports = { BatchJob };
