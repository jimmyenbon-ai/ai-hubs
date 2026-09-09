const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const CACHE_DIR = path.join(__dirname, '..', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'api_key_profiles.json');

let profiles = [];
let loaded = false;
let loadPromise = null;
let writeQueue = Promise.resolve();

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

function normalizeProfile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: raw.id || uuidv4(),
    name: raw.name || '未命名配置',
    scope: raw.scope || 'personal',
    notes: raw.notes || '',
    llm: {
      provider: raw.llm?.provider || 'deepseek',
      api_url: raw.llm?.api_url || 'https://api.deepseek.com',
      api_key: raw.llm?.api_key || '',
      model: raw.llm?.model || 'deepseek-chat',
      config_id: raw.llm?.config_id || null,
    },
    grsai: {
      api_host: raw.grsai?.api_host || 'https://grsai.dakka.com.cn',
      api_key: raw.grsai?.api_key || '',
    },
    is_active: raw.is_active ? 1 : 0,
    created_at: raw.created_at || new Date().toISOString(),
    updated_at: raw.updated_at || raw.created_at || new Date().toISOString(),
  };
}

async function loadFromDisk() {
  await ensureCacheDir();
  try {
    const text = await fs.readFile(CACHE_FILE, 'utf8');
    const parsed = text.trim() ? JSON.parse(text) : [];
    profiles = Array.isArray(parsed) ? parsed.map(normalizeProfile).filter(Boolean) : [];
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('[api-key-profiles] load error:', err.message);
    }
    profiles = [];
  }
  loaded = true;
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
  await fs.writeFile(tmp, `${JSON.stringify(profiles, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, CACHE_FILE);
}

function enqueuePersist() {
  writeQueue = writeQueue
    .then(() => persistToDisk())
    .catch((err) => console.error('[api-key-profiles] persist error:', err));
  return writeQueue;
}

function sanitizeProfile(input) {
  const profile = normalizeProfile(input);
  if (!profile.name.trim()) {
    throw new Error('请填写配置名称');
  }
  if (!profile.llm.api_url.trim()) {
    throw new Error('请填写 LLM API 地址');
  }
  if (!profile.llm.model.trim()) {
    throw new Error('请填写 LLM 模型');
  }
  if (!profile.grsai.api_host.trim()) {
    throw new Error('请填写 GRSai API 地址');
  }
  profile.name = profile.name.trim();
  profile.scope = profile.scope.trim() || 'personal';
  profile.notes = profile.notes.trim();
  profile.llm.api_url = profile.llm.api_url.trim();
  profile.llm.model = profile.llm.model.trim();
  profile.grsai.api_host = profile.grsai.api_host.trim();
  return profile;
}

const ApiKeyProfile = {
  async findAll() {
    await ensureLoaded();
    return [...profiles].sort((a, b) => {
      if (a.is_active !== b.is_active) return b.is_active - a.is_active;
      return new Date(b.updated_at) - new Date(a.updated_at);
    });
  },

  async findByPk(id) {
    await ensureLoaded();
    return profiles.find((p) => p.id === id) || null;
  },

  async findActive() {
    await ensureLoaded();
    return profiles.find((p) => p.is_active === 1) || null;
  },

  async create(attrs) {
    await ensureLoaded();
    const now = new Date().toISOString();
    const record = sanitizeProfile({
      ...attrs,
      id: uuidv4(),
      is_active: profiles.length === 0 ? 1 : attrs.is_active,
      created_at: now,
      updated_at: now,
    });
    if (record.is_active) profiles.forEach((p) => { p.is_active = 0; });
    profiles.push(record);
    await enqueuePersist();
    return record;
  },

  async update(id, attrs) {
    await ensureLoaded();
    const index = profiles.findIndex((p) => p.id === id);
    if (index === -1) return null;
    const record = sanitizeProfile({
      ...profiles[index],
      ...attrs,
      llm: { ...profiles[index].llm, ...(attrs.llm || {}) },
      grsai: { ...profiles[index].grsai, ...(attrs.grsai || {}) },
      id,
      updated_at: new Date().toISOString(),
    });
    if (record.is_active) profiles.forEach((p) => { p.is_active = 0; });
    profiles[index] = record;
    await enqueuePersist();
    return record;
  },

  async destroy(id) {
    await ensureLoaded();
    const index = profiles.findIndex((p) => p.id === id);
    if (index === -1) return 0;
    const wasActive = profiles[index].is_active === 1;
    profiles.splice(index, 1);
    if (wasActive && profiles[0]) profiles[0].is_active = 1;
    await enqueuePersist();
    return 1;
  },

  async markActive(id) {
    await ensureLoaded();
    const profile = profiles.find((p) => p.id === id);
    if (!profile) return null;
    profiles.forEach((p) => { p.is_active = p.id === id ? 1 : 0; });
    profile.updated_at = new Date().toISOString();
    await enqueuePersist();
    return profile;
  },
};

module.exports = { ApiKeyProfile };
