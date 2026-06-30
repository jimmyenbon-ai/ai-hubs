// 模板持久化：落盘到 server/cache/templates.json
// 模板保存在前端可编辑的内核提示词/参数/表单配置

const fs = require('fs/promises');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', '..', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'templates.json');

const memoryStore = [];
let nextId = 1;
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
    if (!Array.isArray(parsed)) throw new Error('templates cache is not an array');
    memoryStore.length = 0;
    let maxId = 0;
    parsed.forEach((raw) => {
      if (!raw || typeof raw !== 'object') return;
      const rec = { ...raw, id: Number(raw.id) };
      memoryStore.push(rec);
      if (rec.id > maxId) maxId = rec.id;
    });
    nextId = maxId + 1;
    loaded = true;
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      loaded = true;
      return;
    }
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      await fs.rename(CACHE_FILE, path.join(CACHE_DIR, `templates.corrupt.${ts}.json`));
    } catch (_) { /* ignore */ }
    memoryStore.length = 0;
    nextId = 1;
    loaded = true;
    console.warn('[templates-cache] reset:', err?.message || err);
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
    .catch((err) => console.error('[templates-cache] persist error:', err));
  return writeQueue;
}

const Template = {
  async sync() {
    await ensureLoaded();
  },

  // 获取所有模板（可选按 group 筛选）
  async findAll({ group } = {}) {
    await ensureLoaded();
    let list = memoryStore.filter((t) => !t.deleted);
    if (group) list = list.filter((t) => t.group === group);
    return list;
  },

  // 获取单个模板
  async findById(id) {
    await ensureLoaded();
    return memoryStore.find((t) => t.id === Number(id) && !t.deleted) || null;
  },

  // 创建模板
  async create(attrs) {
    await ensureLoaded();
    const record = {
      id: nextId++,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deleted: false,
      ...attrs,
    };
    memoryStore.push(record);
    await enqueuePersist();
    return record;
  },

  // 更新模板（支持局部更新）
  async update(id, patch) {
    await ensureLoaded();
    const item = memoryStore.find((t) => t.id === Number(id));
    if (!item) return null;
    Object.assign(item, patch, { updatedAt: new Date().toISOString() });
    await enqueuePersist();
    return item;
  },

  // 删除模板（软删除）
  async delete(id) {
    await ensureLoaded();
    const item = memoryStore.find((t) => t.id === Number(id));
    if (!item) return false;
    item.deleted = true;
    item.updatedAt = new Date().toISOString();
    await enqueuePersist();
    return true;
  },

  // 替换整个模板列表（用于批量导入/重置）
  async replaceAll(list) {
    await ensureLoaded();
    memoryStore.length = 0;
    list.forEach((t, idx) => {
      memoryStore.push({ ...t, id: t.id || idx + 1 });
    });
    nextId = memoryStore.reduce((max, t) => Math.max(max, t.id || 0), 0) + 1;
    await enqueuePersist();
    return memoryStore;
  },
};

module.exports = { Template };
