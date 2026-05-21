const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const CACHE_DIR = path.join(__dirname, '..', 'cache');
const WORKFLOW_CACHE_FILE = path.join(CACHE_DIR, 'workflows.json');
const WORKFLOW_RUNS_CACHE_FILE = path.join(CACHE_DIR, 'workflow_runs.json');
const LLM_CONFIG_CACHE_FILE = path.join(CACHE_DIR, 'llm_configs.json');
const KNOWLEDGE_CACHE_FILE = path.join(CACHE_DIR, 'knowledge.json');

const memoryStore = { templates: [], runs: [], llmConfigs: [], knowledge: [] };
let loaded = false;
let loadPromise = null;
let writeQueue = Promise.resolve();

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

async function loadFromDisk() {
  await ensureCacheDir();

  // 加载工作流模板
  try {
    const text = await fs.readFile(WORKFLOW_CACHE_FILE, 'utf8');
    if (text.trim()) {
      memoryStore.templates = JSON.parse(text);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[workflow-cache] load error:', err.message);
  }

  // 加载工作流执行记录
  try {
    const text = await fs.readFile(WORKFLOW_RUNS_CACHE_FILE, 'utf8');
    if (text.trim()) {
      memoryStore.runs = JSON.parse(text);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[workflow-runs-cache] load error:', err.message);
  }

  // 加载 LLM 配置
  try {
    const text = await fs.readFile(LLM_CONFIG_CACHE_FILE, 'utf8');
    if (text.trim()) {
      memoryStore.llmConfigs = JSON.parse(text);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[llm-config-cache] load error:', err.message);
  }

  // 加载知识库
  try {
    const text = await fs.readFile(KNOWLEDGE_CACHE_FILE, 'utf8');
    if (text.trim()) {
      memoryStore.knowledge = JSON.parse(text);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[knowledge-cache] load error:', err.message);
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

  await fs.writeFile(WORKFLOW_CACHE_FILE, JSON.stringify(memoryStore.templates, null, 2));
  await fs.writeFile(WORKFLOW_RUNS_CACHE_FILE, JSON.stringify(memoryStore.runs, null, 2));
  await fs.writeFile(LLM_CONFIG_CACHE_FILE, JSON.stringify(memoryStore.llmConfigs, null, 2));
  await fs.writeFile(KNOWLEDGE_CACHE_FILE, JSON.stringify(memoryStore.knowledge, null, 2));
}

function enqueuePersist() {
  writeQueue = writeQueue
    .then(() => persistToDisk())
    .catch((err) => console.error('[workflow-cache] persist error:', err));
  return writeQueue;
}

// ============ Workflow Template ============
const WorkflowTemplate = {
  async findAll({ where } = {}) {
    await ensureLoaded();
    let list = [...memoryStore.templates];
    if (where?.category) {
      list = list.filter(t => t.category === where.category);
    }
    return list.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  },

  async findByPk(id) {
    await ensureLoaded();
    return memoryStore.templates.find(t => t.id === id) || null;
  },

  async create(attrs) {
    await ensureLoaded();
    const record = {
      id: uuidv4(),
      name: attrs.name || '未命名工作流',
      description: attrs.description || '',
      category: attrs.category || 'general',
      nodes: attrs.nodes || [],
      edges: attrs.edges || [],
      variables: attrs.variables || [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    memoryStore.templates.push(record);
    await enqueuePersist();
    return record;
  },

  async update(id, attrs) {
    await ensureLoaded();
    const index = memoryStore.templates.findIndex(t => t.id === id);
    if (index === -1) return null;
    memoryStore.templates[index] = {
      ...memoryStore.templates[index],
      ...attrs,
      updated_at: new Date().toISOString(),
    };
    await enqueuePersist();
    return memoryStore.templates[index];
  },

  async destroy(id) {
    await ensureLoaded();
    const index = memoryStore.templates.findIndex(t => t.id === id);
    if (index === -1) return 0;
    memoryStore.templates.splice(index, 1);
    await enqueuePersist();
    return 1;
  },
};

// ============ Workflow Run ============
const WorkflowRun = {
  async findAll({ where, limit = 50 } = {}) {
    await ensureLoaded();
    let list = [...memoryStore.runs];
    if (where?.template_id) {
      list = list.filter(r => r.template_id === where.template_id);
    }
    if (where?.status) {
      list = list.filter(r => r.status === where.status);
    }
    return list.sort((a, b) => new Date(b.started_at) - new Date(a.started_at)).slice(0, limit);
  },

  async findByPk(id) {
    await ensureLoaded();
    return memoryStore.runs.find(r => r.id === id) || null;
  },

  async create(attrs) {
    await ensureLoaded();
    const record = {
      id: attrs.id || uuidv4(),
      template_id: attrs.template_id,
      template_name: attrs.template_name || '',
      status: attrs.status || 'running',
      inputs: attrs.inputs || {},
      outputs: attrs.outputs || {},
      steps: attrs.steps || [],
      started_at: new Date().toISOString(),
      completed_at: null,
    };
    memoryStore.runs.push(record);
    await enqueuePersist();
    return record;
  },

  async update(id, attrs) {
    await ensureLoaded();
    const index = memoryStore.runs.findIndex(r => r.id === id);
    if (index === -1) return null;
    memoryStore.runs[index] = {
      ...memoryStore.runs[index],
      ...attrs,
    };
    if (attrs.status === 'completed' || attrs.status === 'failed') {
      memoryStore.runs[index].completed_at = new Date().toISOString();
    }
    await enqueuePersist();
    return memoryStore.runs[index];
  },
};

// ============ LLM Config ============
const LLMConfig = {
  async findAll() {
    await ensureLoaded();
    return [...memoryStore.llmConfigs];
  },

  async findByPk(id) {
    await ensureLoaded();
    return memoryStore.llmConfigs.find(c => c.id === id) || null;
  },

  async findDefault() {
    await ensureLoaded();
    return memoryStore.llmConfigs.find(c => c.is_default === 1) || null;
  },

  async create(attrs) {
    await ensureLoaded();
    const record = {
      id: uuidv4(),
      name: attrs.name,
      provider: attrs.provider,
      api_url: attrs.api_url,
      api_key: attrs.api_key || '',
      model: attrs.model,
      is_default: attrs.is_default ? 1 : 0,
      created_at: new Date().toISOString(),
    };
    if (attrs.is_default) {
      memoryStore.llmConfigs.forEach(c => c.is_default = 0);
    }
    memoryStore.llmConfigs.push(record);
    await enqueuePersist();
    return record;
  },

  async update(id, attrs) {
    await ensureLoaded();
    const index = memoryStore.llmConfigs.findIndex(c => c.id === id);
    if (index === -1) return null;
    if (attrs.is_default) {
      memoryStore.llmConfigs.forEach(c => c.is_default = 0);
    }
    memoryStore.llmConfigs[index] = {
      ...memoryStore.llmConfigs[index],
      ...attrs,
    };
    await enqueuePersist();
    return memoryStore.llmConfigs[index];
  },

  async destroy(id) {
    await ensureLoaded();
    const index = memoryStore.llmConfigs.findIndex(c => c.id === id);
    if (index === -1) return 0;
    memoryStore.llmConfigs.splice(index, 1);
    await enqueuePersist();
    return 1;
  },
};

// ============ Knowledge Base ============
const KnowledgeBase = {
  async findAll({ where, limit } = {}) {
    await ensureLoaded();
    let list = [...memoryStore.knowledge];
    if (where?.category) {
      list = list.filter(k => k.category === where.category);
    }
    if (where?.folder) {
      // 支持按文件夹路径过滤（精确匹配或子文件夹）
      const folderPath = where.folder.replace(/\/$/, '');
      list = list.filter(k => {
        const kFolder = (k.folder || k.category || '').replace(/\/$/, '');
        return kFolder === folderPath || kFolder.startsWith(folderPath + '/');
      });
    }
    if (where?.query) {
      const q = where.query.toLowerCase();
      list = list.filter(k =>
        (k.title || '').toLowerCase().includes(q) ||
        (k.originalName || '').toLowerCase().includes(q) ||
        (k.folder || '').toLowerCase().includes(q) ||
        (k.content || '').toLowerCase().includes(q)
      );
    }
    return list.slice(0, limit || 100);
  },

  async findByPk(id) {
    await ensureLoaded();
    return memoryStore.knowledge.find(k => k.id === id) || null;
  },

  /** 列出所有文件夹（从已有知识条目中提取） */
  async listFolders() {
    await ensureLoaded();
    const folderSet = new Set();
    for (const k of memoryStore.knowledge) {
      const f = k.folder || k.category || '';
      if (f) {
        // 添加所有层级的父文件夹
        const parts = f.split('/').filter(Boolean);
        let current = '';
        for (const part of parts) {
          current = current ? `${current}/${part}` : part;
          folderSet.add(current);
        }
      }
    }
    return [...folderSet].sort();
  },

  /** 批量移动知识条目到指定文件夹 */
  async moveToFolder(ids, folder) {
    await ensureLoaded();
    let count = 0;
    for (const id of ids) {
      const index = memoryStore.knowledge.findIndex(k => k.id === id);
      if (index !== -1) {
        memoryStore.knowledge[index].folder = folder || '';
        count++;
      }
    }
    if (count > 0) await enqueuePersist();
    return count;
  },

  async create(attrs) {
    await ensureLoaded();
    const record = {
      id: uuidv4(),
      category: attrs.category || 'general',
      folder: attrs.folder || attrs.category || 'general',
      title: attrs.title,
      originalName: attrs.originalName || attrs.title || '',
      content: attrs.content || '',
      fileUrl: attrs.fileUrl || null,
      type: attrs.type || 'text',
      metadata: attrs.metadata || {},
      created_at: new Date().toISOString(),
    };
    memoryStore.knowledge.push(record);
    await enqueuePersist();
    return record;
  },

  async update(id, attrs) {
    await ensureLoaded();
    const index = memoryStore.knowledge.findIndex(k => k.id === id);
    if (index === -1) return null;
    const allowed = ['category', 'folder', 'title', 'originalName', 'content', 'fileUrl', 'type', 'metadata'];
    for (const key of allowed) {
      if (attrs[key] !== undefined) {
        memoryStore.knowledge[index][key] = attrs[key];
      }
    }
    await enqueuePersist();
    return memoryStore.knowledge[index];
  },

  async destroy(id) {
    await ensureLoaded();
    const index = memoryStore.knowledge.findIndex(k => k.id === id);
    if (index === -1) return 0;
    memoryStore.knowledge.splice(index, 1);
    await enqueuePersist();
    return 1;
  },
};

// 初始化数据库（兼容 app.js）
const sequelize = {
  async sync() {
    await ensureLoaded();
    return true;
  },
};

module.exports = {
  sequelize,
  WorkflowTemplate,
  WorkflowRun,
  LLMConfig,
  KnowledgeBase,
};
