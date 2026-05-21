const fs = require('fs/promises');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', '..', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'prompt_templates.json');

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
    if (!text.trim()) {
      loaded = true;
      return;
    }
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('prompt_templates cache is not an array');
    memoryStore.length = 0;
    parsed.forEach((raw) => {
      if (!raw || typeof raw !== 'object') return;
      memoryStore.push({ ...raw });
    });
    loaded = true;
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      loaded = true;
      return;
    }
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      await fs.rename(CACHE_FILE, path.join(CACHE_DIR, `prompt_templates.corrupt.${ts}.json`));
    } catch (_) { /* ignore */ }
    memoryStore.length = 0;
    loaded = true;
    console.warn('[prompt-templates-cache] reset:', err?.message || err);
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
    .catch((err) => console.error('[prompt-templates-cache] persist error:', err));
  return writeQueue;
}

const PromptTemplate = {
  async sync() {
    await ensureLoaded();
  },

  // 获取所有模板（支持按 contentType 和 category 筛选）
  async findAll({ contentType, category, search } = {}) {
    await ensureLoaded();
    let list = memoryStore.filter((t) => !t.deleted);
    if (contentType) list = list.filter((t) => t.contentType === contentType);
    if (category) list = list.filter((t) => t.category === category);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          (t.name && t.name.toLowerCase().includes(q)) ||
          (t.prompt && t.prompt.toLowerCase().includes(q)) ||
          (t.tags && t.tags.some((tag) => tag.toLowerCase().includes(q)))
      );
    }
    return list;
  },

  // 获取单个模板
  async findById(id) {
    await ensureLoaded();
    return memoryStore.find((t) => t.id === id && !t.deleted) || null;
  },

  // 创建模板
  async create(attrs) {
    await ensureLoaded();
    const record = {
      id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deleted: false,
      contentType: 'image',
      pointsCost: 1,
      ...attrs,
    };
    memoryStore.push(record);
    await enqueuePersist();
    return record;
  },

  // 更新模板（支持局部更新）
  async update(id, patch) {
    await ensureLoaded();
    const item = memoryStore.find((t) => t.id === id);
    if (!item) return null;
    Object.assign(item, patch, { updatedAt: new Date().toISOString() });
    await enqueuePersist();
    return item;
  },

  // 删除模板（软删除）
  async delete(id) {
    await ensureLoaded();
    const item = memoryStore.find((t) => t.id === id);
    if (!item) return false;
    item.deleted = true;
    item.updatedAt = new Date().toISOString();
    await enqueuePersist();
    return true;
  },

  // 获取所有分类列表（去重）
  async getCategories(contentType) {
    await ensureLoaded();
    const cats = new Set();
    memoryStore
      .filter((t) => !t.deleted && (!contentType || t.contentType === contentType))
      .forEach((t) => { if (t.category) cats.add(t.category); });
    return [...cats].sort();
  },
};

module.exports = { PromptTemplate };
