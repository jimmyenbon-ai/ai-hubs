const fs = require('fs/promises');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const CACHE_DIR = path.join(__dirname, '..', 'cache');
const CONVERSATIONS_FILE = path.join(CACHE_DIR, 'ai_dialog_conversations.json');

const memoryStore = { conversations: [] };
let loaded = false;
let writeQueue = Promise.resolve();

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

async function loadFromDisk() {
  await ensureCacheDir();
  try {
    const text = await fs.readFile(CONVERSATIONS_FILE, 'utf8');
    if (text.trim()) {
      memoryStore.conversations = JSON.parse(text);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[ai-dialog-cache] load error:', err.message);
  }
  loaded = true;
}

async function ensureLoaded() {
  if (loaded) return;
  await loadFromDisk();
}

async function persistToDisk() {
  await ensureLoaded();
  await ensureCacheDir();
  await fs.writeFile(CONVERSATIONS_FILE, JSON.stringify(memoryStore.conversations, null, 2));
}

function enqueuePersist() {
  writeQueue = writeQueue
    .then(() => persistToDisk())
    .catch((err) => console.error('[ai-dialog-cache] persist error:', err));
  return writeQueue;
}

const Conversation = {
  async findAll({ where, limit = 50 } = {}) {
    await ensureLoaded();
    let list = [...memoryStore.conversations];
    if (where?.status) {
      list = list.filter(c => c.status === where.status);
    }
    return list.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, limit);
  },

  async findByPk(id) {
    await ensureLoaded();
    return memoryStore.conversations.find(c => c.id === id) || null;
  },

  async create(attrs) {
    await ensureLoaded();
    const record = {
      id: attrs.id || uuidv4(),
      title: attrs.title || '新对话',
      status: attrs.status || 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    memoryStore.conversations.unshift(record);
    await enqueuePersist();
    return record;
  },

  async touch(id) {
    await ensureLoaded();
    const index = memoryStore.conversations.findIndex(c => c.id === id);
    if (index === -1) return;
    memoryStore.conversations[index].updated_at = new Date().toISOString();
    await enqueuePersist();
  },

  async update(id, attrs) {
    await ensureLoaded();
    const index = memoryStore.conversations.findIndex(c => c.id === id);
    if (index === -1) return null;
    memoryStore.conversations[index] = {
      ...memoryStore.conversations[index],
      ...attrs,
      updated_at: new Date().toISOString(),
    };
    await enqueuePersist();
    return memoryStore.conversations[index];
  },

  async destroy(id) {
    await ensureLoaded();
    const index = memoryStore.conversations.findIndex(c => c.id === id);
    if (index === -1) return 0;
    memoryStore.conversations.splice(index, 1);
    await enqueuePersist();
    return 1;
  },
};

// 消息存储：每个会话一个 JSON 文件
function getMessagesFile(conversationId) {
  return path.join(CACHE_DIR, `ai_dialog_messages_${conversationId}.json`);
}

const Message = {
  async findAll(conversationId) {
    try {
      const text = await fs.readFile(getMessagesFile(conversationId), 'utf8');
      return JSON.parse(text || '[]');
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  },

  async create(conversationId, attrs) {
    const messages = await this.findAll(conversationId);
    const record = {
      id: uuidv4(),
      role: attrs.role,
      content: attrs.content,
      attachments: attrs.attachments || [],
      created_at: new Date().toISOString(),
    };
    messages.push(record);
    await fs.writeFile(getMessagesFile(conversationId), JSON.stringify(messages, null, 2));
    return record;
  },

  async clear(conversationId) {
    try {
      await fs.unlink(getMessagesFile(conversationId));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  },
};

module.exports = {
  Conversation,
  Message,
};
