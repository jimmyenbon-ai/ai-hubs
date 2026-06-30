/**
 * StoryboardJob — AI视频自动化任务模型（内存存储 + JSON 文件持久化）
 * 持久化到 server/cache/storyboard_jobs.json
 */

const fs = require('fs/promises');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'storyboard_jobs.json');

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

  const normalizeShot = (shot) => {
    const camera = shot.camera && typeof shot.camera === 'object' ? shot.camera : {};
    const lightingRaw = shot.lighting;
    // 向前兼容：旧版字符串 lighting → 对象
    const lighting = lightingRaw && typeof lightingRaw === 'object' ? {
      style: String(lightingRaw.style || ''),
      keyDirection: String(lightingRaw.keyDirection || ''),
      fillRatio: String(lightingRaw.fillRatio || ''),
      quality: String(lightingRaw.quality || ''),
      colorTemp: String(lightingRaw.colorTemp || ''),
    } : { style: String(lightingRaw || ''), keyDirection: '', fillRatio: '', quality: '', colorTemp: '' };

    return {
      shotNumber: Number(shot.shotNumber),
      sceneTitle: String(shot.sceneTitle || ''),
      narrativeBeat: String(shot.narrativeBeat || ''),
      visualGoal: String(shot.visualGoal || ''),
      description: String(shot.description || ''),
      characters: Array.isArray(shot.characters) ? shot.characters : [],
      location: String(shot.location || ''),
      sceneDescription: String(shot.sceneDescription || ''),
      props: Array.isArray(shot.props) ? shot.props : [],
      camera: {
        shotSize: String(camera.shotSize || ''),
        angle: String(camera.angle || ''),
        focalLength: String(camera.focalLength || ''),       // 🆕
        aperture: String(camera.aperture || ''),              // 🆕
        lens: String(camera.lens || ''),
        composition: String(camera.composition || ''),
        position: String(camera.position || ''),              // 🆕
        movement: String(camera.movement || ''),
        depthOfField: String(camera.depthOfField || ''),     // 🆕
      },
      cameraAngle: String(shot.cameraAngle || ''),
      lighting,                                                // 🆕 结构化
      colorPalette: String(shot.colorPalette || ''),
      mood: String(shot.mood || ''),
      keyElements: Array.isArray(shot.keyElements) ? shot.keyElements : [],
      continuityNotes: String(shot.continuityNotes || ''),
      imagePrompt: String(shot.imagePrompt || ''),
      negativePrompt: String(shot.negativePrompt || ''),
      estimatedDuration: String(shot.estimatedDuration || ''),
      status: shot.status || 'pending',
      resultImageUrl: shot.resultImageUrl || null,
      generatedPrompt: shot.generatedPrompt || null,
      matchedReferences: Array.isArray(shot.matchedReferences) ? shot.matchedReferences : [],
      error: shot.error || null,
      recordId: shot.recordId || null,
      includeInGeneration: shot.includeInGeneration !== false,
    };
  };

  const normalizeRefGroup = (group) =>
    Array.isArray(group) ? group.map((r) => ({
      url: String(r.url || ''),
      name: String(r.name || ''),
      localUrl: String(r.localUrl || ''),
      note: String(r.note || ''), // 用户备注：人物名/场景名/产品名
    })) : [];

  const normalizeAssetGroup = (group) =>
    Array.isArray(group) ? group.map((a) => ({
      id: String(a.id || a.name || ''),
      name: String(a.name || a.id || ''),
      aliases: Array.isArray(a.aliases) ? a.aliases : [],
      description: String(a.description || ''),
      visualPrompt: String(a.visualPrompt || ''),
      negativePrompt: String(a.negativePrompt || ''),
      continuityRules: String(a.continuityRules || ''),
      sourceEvidence: String(a.sourceEvidence || ''),
      importance: String(a.importance || 'normal'),
    })) : [];

  return {
    id: Number(raw.id),
    script: String(raw.script || ''),
    scriptSource: raw.scriptSource || 'manual',
    style: String(raw.style || 'film'),
    customStylePrompt: String(raw.customStylePrompt || ''),
    globalStylePrompt: String(raw.globalStylePrompt || ''),
    shots: Array.isArray(raw.shots) ? raw.shots.map(normalizeShot) : [],
    referenceImages: {
      characters: normalizeRefGroup(raw.referenceImages?.characters),
      scenes: normalizeRefGroup(raw.referenceImages?.scenes),
      products: normalizeRefGroup(raw.referenceImages?.products),
    },
    assets: {
      characters: normalizeAssetGroup(raw.assets?.characters),
      locations: normalizeAssetGroup(raw.assets?.locations),
      props: normalizeAssetGroup(raw.assets?.props),
      visualRules: String(raw.assets?.visualRules || ''),
      styleNotes: String(raw.assets?.styleNotes || ''),
    },
    config: {
      model: raw.config?.model || 'gpt-image-2',
      imageSize: raw.config?.imageSize || '1K',
      aspectRatio: raw.config?.aspectRatio || '16:9',
      frameInterval: Number(raw.config?.frameInterval) || 1,
      maxFrames: Number(raw.config?.maxFrames) || 0,
      qualityTags: String(raw.config?.qualityTags || ''),
      productionType: String(raw.config?.productionType || ''),
      cameraGrammar: String(raw.config?.cameraGrammar || ''),
      compositionGrammar: String(raw.config?.compositionGrammar || ''),
      directorGrammar: String(raw.config?.directorGrammar || ''),
    },
    status: raw.status || 'input',
    totalShots: Number(raw.totalShots) || 0,
    completedShots: Number(raw.completedShots) || 0,
    failedShots: Number(raw.failedShots) || 0,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
    abortFlag: raw.abortFlag || false,
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
    if (!Array.isArray(parsed)) throw new Error('storyboard_jobs cache is not an array');
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
      await fs.rename(CACHE_FILE, path.join(CACHE_DIR, `storyboard_jobs.corrupt.${ts}.json`));
    } catch (_) { /* ignore */ }
    memoryStore.length = 0;
    nextId = 1;
    loaded = true;
    console.warn('[storyboard-cache] cache file was invalid; reset to empty:', err?.message || err);
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
    .catch((err) => { console.error('[storyboard-cache] persist error:', err); });
  return writeQueue;
}

const StoryboardJob = {
  async create(attrs) {
    await ensureLoaded();
    const now = new Date().toISOString();
    const record = normalizeRecord({
      id: nextId++,
      createdAt: now,
      updatedAt: now,
      ...attrs,
      totalShots: (attrs.shots || []).length,
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

  async updateShot(jobId, shotNumber, patch) {
    await ensureLoaded();
    const job = memoryStore.find((x) => x.id === Number(jobId));
    if (!job) return null;
    const shot = job.shots.find((x) => x.shotNumber === Number(shotNumber));
    if (!shot) return null;
    Object.assign(shot, patch);
    // 更新统计
    job.completedShots = job.shots.filter((x) => x.status === 'completed').length;
    job.failedShots = job.shots.filter((x) => x.status === 'failed').length;
    job.updatedAt = new Date().toISOString();
    await enqueuePersist();
    return shot;
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

module.exports = { StoryboardJob };
