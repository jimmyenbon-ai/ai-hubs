const fs = require('fs/promises');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'product_automation_jobs.json');

const memoryStore = [];
let nextId = 1;
let loaded = false;
let loadPromise = null;
let writeQueue = Promise.resolve();

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

function normalizeImageItem(item = {}, index = 0) {
  return {
    imageNumber: Number(item.imageNumber || index + 1),
    title: String(item.title || `产品图 ${index + 1}`),
    imageType: String(item.imageType || ''),
    objective: String(item.objective || ''),
    scene: String(item.scene || ''),
    composition: String(item.composition || ''),
    lighting: String(item.lighting || ''),
    copywriting: String(item.copywriting || ''),
    prompt: String(item.prompt || item.imagePrompt || ''),
    negativePrompt: String(item.negativePrompt || ''),
    includeText: item.includeText === true,
    includeInGeneration: item.includeInGeneration !== false,
    status: item.status || 'pending',
    resultImageUrl: item.resultImageUrl || null,
    generatedPrompt: item.generatedPrompt || null,
    matchedReferences: Array.isArray(item.matchedReferences) ? item.matchedReferences : [],
    error: item.error || null,
    recordId: item.recordId || null,
  };
}

function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: Number(raw.id),
    productName: String(raw.productName || ''),
    productBrief: String(raw.productBrief || ''),
    expertRole: String(raw.expertRole || 'ecommerce'),
    commerceType: String(raw.commerceType || 'independent_site'),
    visualStyle: String(raw.visualStyle || 'premium_minimal'),
    customStylePrompt: String(raw.customStylePrompt || ''),
    strategy: raw.strategy && typeof raw.strategy === 'object' ? raw.strategy : {},
    referenceImages: Array.isArray(raw.referenceImages) ? raw.referenceImages.map((r) => ({
      url: String(r.url || ''),
      name: String(r.name || ''),
      note: String(r.note || ''),
      localUrl: String(r.localUrl || ''),
    })) : [],
    items: Array.isArray(raw.items) ? raw.items.map(normalizeImageItem) : [],
    config: {
      model: raw.config?.model || 'gpt-image-2',
      imageSize: raw.config?.imageSize || '1K',
      aspectRatio: raw.config?.aspectRatio || '16:9',
      qualityTags: String(raw.config?.qualityTags || ''),
      imageCount: Number(raw.config?.imageCount) || 6,
      includeText: raw.config?.includeText === true,
      language: String(raw.config?.language || 'zh-CN'),
    },
    status: raw.status || 'queued',
    totalItems: Number(raw.totalItems) || 0,
    completedItems: Number(raw.completedItems) || 0,
    failedItems: Number(raw.failedItems) || 0,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
    abortFlag: raw.abortFlag || false,
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
    if (!Array.isArray(parsed)) throw new Error('product automation cache is not an array');
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
    if (err?.code === 'ENOENT') {
      loaded = true;
      return;
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    try { await fs.rename(CACHE_FILE, path.join(CACHE_DIR, `product_automation_jobs.corrupt.${ts}.json`)); } catch (_) {}
    memoryStore.length = 0;
    nextId = 1;
    loaded = true;
    console.warn('[product-automation-cache] reset invalid cache:', err?.message || err);
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
  await fs.writeFile(tmp, JSON.stringify(memoryStore, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, CACHE_FILE);
}

function enqueuePersist() {
  writeQueue = writeQueue.then(() => persistToDisk()).catch((err) => {
    console.error('[product-automation-cache] persist error:', err);
  });
  return writeQueue;
}

const ProductAutomationJob = {
  normalizeImageItem,

  async create(attrs) {
    await ensureLoaded();
    const now = new Date().toISOString();
    const record = normalizeRecord({
      id: nextId++,
      createdAt: now,
      updatedAt: now,
      ...attrs,
      totalItems: (attrs.items || []).filter((item) => item.includeInGeneration !== false).length,
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

  async updateItem(jobId, imageNumber, patch) {
    await ensureLoaded();
    const job = memoryStore.find((x) => x.id === Number(jobId));
    if (!job) return null;
    const item = job.items.find((x) => x.imageNumber === Number(imageNumber));
    if (!item) return null;
    Object.assign(item, patch);
    job.completedItems = job.items.filter((x) => x.status === 'completed').length;
    job.failedItems = job.items.filter((x) => x.status === 'failed').length;
    job.updatedAt = new Date().toISOString();
    await enqueuePersist();
    return item;
  },
};

module.exports = { ProductAutomationJob };
