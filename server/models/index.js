// 生成历史记录的“轻量持久化”实现：落盘到 server/cache/history.json
// 目标：刷新页面/重启后端后仍可读取历史记录（不依赖 SQLite）。

const fs = require('fs/promises');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'history.json');
const MUSIC_CACHE_FILE = path.join(CACHE_DIR, 'music_history.json');
const VIDEO_CACHE_FILE = path.join(CACHE_DIR, 'video_history.json');

const memoryStore = [];
let nextId = 1;

const musicMemoryStore = [];
let musicNextId = 1;

const videoMemoryStore = [];
let videoNextId = 1;

let loaded = false;
let loadPromise = null;
let writeQueue = Promise.resolve();

let musicLoaded = false;
let musicLoadPromise = null;
let musicWriteQueue = Promise.resolve();

let videoLoaded = false;
let videoLoadPromise = null;
let videoWriteQueue = Promise.resolve();

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const createdAt =
    raw.createdAt instanceof Date ? raw.createdAt : new Date(raw.createdAt);
  const updatedAt =
    raw.updatedAt instanceof Date ? raw.updatedAt : new Date(raw.updatedAt);

  return {
    ...raw,
    id: Number(raw.id),
    createdAt: Number.isNaN(createdAt.getTime()) ? new Date(0) : createdAt,
    updatedAt: Number.isNaN(updatedAt.getTime()) ? new Date(0) : updatedAt,
  };
}

function toDiskRecord(rec) {
  return {
    ...rec,
    createdAt: rec.createdAt instanceof Date ? rec.createdAt.toISOString() : rec.createdAt,
    updatedAt: rec.updatedAt instanceof Date ? rec.updatedAt.toISOString() : rec.updatedAt,
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
    if (!Array.isArray(parsed)) {
      throw new Error('history cache is not an array');
    }

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
    // 文件不存在：正常情况（首次启动）
    if (err && err.code === 'ENOENT') {
      loaded = true;
      return;
    }

    // 文件损坏：备份后重新开始
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      await fs.rename(CACHE_FILE, path.join(CACHE_DIR, `history.corrupt.${ts}.json`));
    } catch (_) {
      // ignore
    }

    memoryStore.length = 0;
    nextId = 1;
    loaded = true;
    // eslint-disable-next-line no-console
    console.warn('[history-cache] cache file was invalid; reset to empty:', err?.message || err);
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

  await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, CACHE_FILE);
}

function enqueuePersist() {
  writeQueue = writeQueue
    .then(() => persistToDisk())
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[history-cache] persist error:', err);
    });
  return writeQueue;
}

const sequelize = {
  // 与 app.js 中的 initDatabase 兼容：服务启动时加载落盘缓存
  async sync() {
    await ensureLoaded();
    await ensureMusicLoaded();
    await ensureVideoLoaded();
    return true;
  },
};

const Generation = {
  async create(attrs) {
    await ensureLoaded();

    const now = new Date();
    const record = normalizeRecord({
      id: nextId++,
      createdAt: now,
      updatedAt: now,
      ...attrs,
    });

    memoryStore.push(record);
    await enqueuePersist();
    return record;
  },

  async findAll({ order, limit, attributes, where } = {}) {
    await ensureLoaded();

    let list = [...memoryStore];

    if (where && typeof where === 'object') {
      list = list.filter((item) => {
        return Object.entries(where).every(([key, val]) => {
          if (key === 'templateId') return String(item.templateId || '') === String(val)
          return item[key] === val
        })
      })
    }

    if (order && Array.isArray(order) && order[0][0] === 'createdAt') {
      const dir = (order[0][1] || 'DESC').toUpperCase();
      list.sort((a, b) => {
        const at = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
        const bt = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
        return dir === 'DESC' ? bt - at : at - bt;
      });
    }

    if (typeof limit === 'number') {
      list = list.slice(0, limit);
    }

    if (attributes && Array.isArray(attributes)) {
      list = list.map((item) => {
        const picked = {};
        attributes.forEach((key) => {
          picked[key] = item[key];
        });
        return picked;
      });
    }

    return list;
  },

  async findByPk(id) {
    await ensureLoaded();
    const numId = Number(id);
    return memoryStore.find((item) => item.id === numId) || null;
  },

  async updateById(id, patch) {
    await ensureLoaded();
    const numId = Number(id);
    if (!Number.isFinite(numId)) return null;
    const item = memoryStore.find((x) => x.id === numId);
    if (!item) return null;
    Object.assign(item, patch || {}, { updatedAt: new Date() });
    await enqueuePersist();
    return item;
  },

  async destroy({ where }) {
    await ensureLoaded();
    const numId = Number(where?.id);
    if (!Number.isFinite(numId)) {
      return 0;
    }
    const index = memoryStore.findIndex((item) => item.id === numId);
    if (index === -1) {
      return 0;
    }
    memoryStore.splice(index, 1);
    await enqueuePersist();
    return 1;
  },
};

// Music Generation Model (similar structure)
async function loadMusicFromDisk() {
  await ensureCacheDir();

  try {
    const text = await fs.readFile(MUSIC_CACHE_FILE, 'utf8');
    if (!text.trim()) {
      musicLoaded = true;
      return;
    }

    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error('music history cache is not an array');
    }

    musicMemoryStore.length = 0;
    let maxId = 0;

    parsed.forEach((raw) => {
      const rec = normalizeRecord(raw);
      if (!rec || !Number.isFinite(rec.id)) return;
      musicMemoryStore.push(rec);
      if (rec.id > maxId) maxId = rec.id;
    });

    musicNextId = maxId + 1;
    musicLoaded = true;
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      musicLoaded = true;
      return;
    }

    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      await fs.rename(MUSIC_CACHE_FILE, path.join(CACHE_DIR, `music_history.corrupt.${ts}.json`));
    } catch (_) {
      // ignore
    }

    musicMemoryStore.length = 0;
    musicNextId = 1;
    musicLoaded = true;
    console.warn('[music-history-cache] cache file was invalid; reset to empty:', err?.message || err);
  }
}

async function ensureMusicLoaded() {
  if (musicLoaded) return;
  if (!musicLoadPromise) musicLoadPromise = loadMusicFromDisk();
  await musicLoadPromise;
}

async function persistMusicToDisk() {
  await ensureMusicLoaded();
  await ensureCacheDir();

  const payload = musicMemoryStore.map(toDiskRecord);
  const tmp = `${MUSIC_CACHE_FILE}.tmp`;

  await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, MUSIC_CACHE_FILE);
}

function enqueueMusicPersist() {
  musicWriteQueue = musicWriteQueue
    .then(() => persistMusicToDisk())
    .catch((err) => {
      console.error('[music-history-cache] persist error:', err);
    });
  return musicWriteQueue;
}

const MusicGeneration = {
  async create(attrs) {
    await ensureMusicLoaded();

    const now = new Date();
    const record = normalizeRecord({
      id: musicNextId++,
      createdAt: now,
      updatedAt: now,
      ...attrs,
    });

    musicMemoryStore.push(record);
    await enqueueMusicPersist();
    return record;
  },

  async updateById(id, patch) {
    await ensureMusicLoaded();
    const numId = Number(id);
    if (!Number.isFinite(numId)) return null;
    const item = musicMemoryStore.find((x) => x.id === numId);
    if (!item) return null;
    Object.assign(item, patch || {}, { updatedAt: new Date() });
    await enqueueMusicPersist();
    return item;
  },

  // 按 task_id 回填生成结果（audioUrl 等）
  async updateByTaskId(taskId, patch) {
    await ensureMusicLoaded();
    const t = Number(taskId);
    if (!Number.isFinite(t)) return null;
    const item = musicMemoryStore.find((x) => Array.isArray(x.task_ids) && x.task_ids.map(Number).includes(t));
    if (!item) return null;
    Object.assign(item, patch || {}, { updatedAt: new Date() });
    await enqueueMusicPersist();
    return item;
  },

  async findAll({ order, limit, attributes } = {}) {
    await ensureMusicLoaded();

    let list = [...musicMemoryStore];

    if (order && Array.isArray(order) && order[0][0] === 'createdAt') {
      const dir = (order[0][1] || 'DESC').toUpperCase();
      list.sort((a, b) => {
        const at = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
        const bt = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
        return dir === 'DESC' ? bt - at : at - bt;
      });
    }

    if (typeof limit === 'number') {
      list = list.slice(0, limit);
    }

    if (attributes && Array.isArray(attributes)) {
      list = list.map((item) => {
        const picked = {};
        attributes.forEach((key) => {
          picked[key] = item[key];
        });
        return picked;
      });
    }

    return list;
  },

  async findByPk(id) {
    await ensureMusicLoaded();
    const numId = Number(id);
    return musicMemoryStore.find((item) => item.id === numId) || null;
  },

  async destroy({ where }) {
    await ensureMusicLoaded();
    const numId = Number(where?.id);
    if (!Number.isFinite(numId)) {
      return 0;
    }
    const index = musicMemoryStore.findIndex((item) => item.id === numId);
    if (index === -1) {
      return 0;
    }
    musicMemoryStore.splice(index, 1);
    await enqueueMusicPersist();
    return 1;
  },
};

// Video Generation Model
async function loadVideoFromDisk() {
  await ensureCacheDir();

  try {
    const text = await fs.readFile(VIDEO_CACHE_FILE, 'utf8');
    if (!text.trim()) {
      videoLoaded = true;
      return;
    }

    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error('video history cache is not an array');
    }

    videoMemoryStore.length = 0;
    let maxId = 0;

    parsed.forEach((raw) => {
      const rec = normalizeRecord(raw);
      if (!rec || !Number.isFinite(rec.id)) return;
      videoMemoryStore.push(rec);
      if (rec.id > maxId) maxId = rec.id;
    });

    videoNextId = maxId + 1;
    videoLoaded = true;
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      videoLoaded = true;
      return;
    }

    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      await fs.rename(VIDEO_CACHE_FILE, path.join(CACHE_DIR, `video_history.corrupt.${ts}.json`));
    } catch (_) {
      // ignore
    }

    videoMemoryStore.length = 0;
    videoNextId = 1;
    videoLoaded = true;
    console.warn('[video-history-cache] cache file was invalid; reset to empty:', err?.message || err);
  }
}

async function ensureVideoLoaded() {
  if (videoLoaded) return;
  if (!videoLoadPromise) videoLoadPromise = loadVideoFromDisk();
  await videoLoadPromise;
}

async function persistVideoToDisk() {
  await ensureVideoLoaded();
  await ensureCacheDir();

  const payload = videoMemoryStore.map(toDiskRecord);
  const tmp = `${VIDEO_CACHE_FILE}.tmp`;

  await fs.writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, VIDEO_CACHE_FILE);
}

function enqueueVideoPersist() {
  videoWriteQueue = videoWriteQueue
    .then(() => persistVideoToDisk())
    .catch((err) => {
      console.error('[video-history-cache] persist error:', err);
    });
  return videoWriteQueue;
}

const VideoGeneration = {
  async create(attrs) {
    await ensureVideoLoaded();

    const now = new Date();
    const record = normalizeRecord({
      id: videoNextId++,
      createdAt: now,
      updatedAt: now,
      ...attrs,
    });

    videoMemoryStore.push(record);
    await enqueueVideoPersist();
    return record;
  },

  async updateById(id, patch) {
    await ensureVideoLoaded();
    const numId = Number(id);
    if (!Number.isFinite(numId)) return null;
    const item = videoMemoryStore.find((x) => x.id === numId);
    if (!item) return null;
    Object.assign(item, patch || {}, { updatedAt: new Date() });
    await enqueueVideoPersist();
    return item;
  },

  async updateByTaskId(taskId, patch) {
    await ensureVideoLoaded();
    const t = String(taskId);
    // 兼容 task_id 和 taskId 两种字段名
    const item = videoMemoryStore.find((x) => x.task_id === t || x.taskId === t);
    if (!item) return null;
    Object.assign(item, patch || {}, { updatedAt: new Date() });
    await enqueueVideoPersist();
    return item;
  },

  async findAll({ order, limit, attributes } = {}) {
    await ensureVideoLoaded();

    let list = [...videoMemoryStore];

    if (order && Array.isArray(order) && order[0][0] === 'createdAt') {
      const dir = (order[0][1] || 'DESC').toUpperCase();
      list.sort((a, b) => {
        const at = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt).getTime();
        const bt = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt).getTime();
        return dir === 'DESC' ? bt - at : at - bt;
      });
    }

    if (typeof limit === 'number') {
      list = list.slice(0, limit);
    }

    if (attributes && Array.isArray(attributes)) {
      list = list.map((item) => {
        const picked = {};
        attributes.forEach((key) => {
          picked[key] = item[key];
        });
        return picked;
      });
    }

    return list;
  },

  async findByPk(id) {
    await ensureVideoLoaded();
    const numId = Number(id);
    return videoMemoryStore.find((item) => item.id === numId) || null;
  },

  async destroy({ where }) {
    await ensureVideoLoaded();
    const numId = Number(where?.id);
    if (!Number.isFinite(numId)) {
      return 0;
    }
    const index = videoMemoryStore.findIndex((item) => item.id === numId);
    if (index === -1) {
      return 0;
    }
    videoMemoryStore.splice(index, 1);
    await enqueueVideoPersist();
    return 1;
  },
};

module.exports = {
  sequelize,
  Generation,
  MusicGeneration,
  VideoGeneration,
};
