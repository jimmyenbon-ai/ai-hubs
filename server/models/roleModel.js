const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const CACHE_DIR = path.join(__dirname, '..', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'roles.json');

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
    if (!Array.isArray(parsed)) throw new Error('roles cache is not an array');
    memoryStore.length = 0;
    parsed.forEach((raw) => { if (raw && typeof raw === 'object') memoryStore.push({ ...raw }); });
    loaded = true;
  } catch (err) {
    if (err && err.code === 'ENOENT') { loaded = true; return; }
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      await fs.rename(CACHE_FILE, path.join(CACHE_DIR, `roles.corrupt.${ts}.json`));
    } catch (_) { /* ignore */ }
    memoryStore.length = 0;
    loaded = true;
    console.warn('[roles-cache] reset:', err?.message || err);
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
    .catch((err) => console.error('[roles-cache] persist error:', err));
  return writeQueue;
}

const Role = {
  async sync() { await ensureLoaded(); },

  async findAll() {
    await ensureLoaded();
    return [...memoryStore].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  },

  async findById(id) {
    await ensureLoaded();
    return memoryStore.find((r) => r.id === id) || null;
  },

  async create(attrs) {
    await ensureLoaded();
    const record = {
      id: attrs.id || uuidv4(),
      name: attrs.name || '未命名角色',
      icon: attrs.icon || '👤',
      description: attrs.description || '',
      defaultWorkflowId: attrs.defaultWorkflowId || null,
      promptTemplateIds: attrs.promptTemplateIds || [],
      knowledgeFolders: attrs.knowledgeFolders || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    memoryStore.push(record);
    await enqueuePersist();
    return record;
  },

  async update(id, patch) {
    await ensureLoaded();
    const item = memoryStore.find((r) => r.id === id);
    if (!item) return null;
    Object.assign(item, patch, { updatedAt: new Date().toISOString() });
    await enqueuePersist();
    return item;
  },

  async destroy(id) {
    await ensureLoaded();
    const index = memoryStore.findIndex((r) => r.id === id);
    if (index === -1) return 0;
    memoryStore.splice(index, 1);
    await enqueuePersist();
    return 1;
  },
};

const PRESET_ROLES = [
  {
    id: 'role-graphic-design',
    name: '平面设计',
    icon: '🎨',
    description: '商品海报、电商Banner、社交媒体配图等视觉设计',
    knowledgeFolders: ['设计素材', '品牌VI'],
  },
  {
    id: 'role-copywriting',
    name: '文案策划',
    icon: '✍️',
    description: '多语言翻译、SEO文案、产品描述、广告语等文字内容',
    knowledgeFolders: ['产品资料', '营销文案'],
  },
  {
    id: 'role-video',
    name: '视频制作',
    icon: '🎬',
    description: '短视频脚本、分镜设计、AI视频生成',
    knowledgeFolders: ['视频素材', '脚本模板'],
  },
  {
    id: 'role-3d',
    name: '3D 建模',
    icon: '🧊',
    description: '产品3D渲染、多角度生成、Prompt优化',
    knowledgeFolders: ['3D参考图', '材质库'],
  },
  {
    id: 'role-general',
    name: '通用模式',
    icon: '🏠',
    description: '显示全部功能，不做岗位过滤',
    knowledgeFolders: [],
  },
];

async function initPresetRoles() {
  await ensureLoaded();
  if (memoryStore.length > 0) {
    console.log('[Role] Preset roles already exist, skipping init');
    return;
  }
  for (const role of PRESET_ROLES) {
    memoryStore.push({ ...role, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), defaultWorkflowId: null, promptTemplateIds: [] });
  }
  await enqueuePersist();
  console.log(`[Role] ${PRESET_ROLES.length} preset roles initialized`);
}

module.exports = { Role, initPresetRoles };
