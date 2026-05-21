/**
 * 统一应用配置中心
 * - 从 server/cache/app_config.json 加载
 * - 环境变量作为初始默认值
 * - 支持前端 API 动态修改（修改后立即生效）
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '..', 'cache');
const CONFIG_FILE = path.join(CONFIG_DIR, 'app_config.json');

// 内存中的配置存储
const store = {
  // === API 密钥 ===
  grsai_api_key: process.env.GRSAI_API_KEY || '',
  grsai_api_host: process.env.GRSAI_API_HOST || 'https://grsai.dakka.com.cn',
  seedance_api_key: process.env.SEEDANCE_API_KEY || '',
  seedance_api_url: process.env.SEEDANCE_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
  seedance_default_model: process.env.SEEDANCE_DEFAULT_MODEL || 'doubao-seedance-2-0-260128',
  imgb_api_key: process.env.IMGBB_API_KEY || '',
  mx_api_key: process.env.MX_API_KEY || '',
  music_api_key: process.env.MUSIC_API_KEY || '',

  // === 图床上传 ===
  ref_image_upload_method: process.env.REF_IMAGE_UPLOAD_METHOD || 'auto',
  ref_image_upload_timeout_ms: Number(process.env.REF_IMAGE_UPLOAD_TIMEOUT_MS || 120000),

  // === 设置面板密码（简单密码，内部使用） ===
  config_password: 'enbon123',
};

// 加载持久化配置（覆盖环境变量默认值）
let loaded = false;

function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadFromDisk() {
  ensureDir();
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      const saved = JSON.parse(raw);
      // 只合并已知的 key（防止注入垃圾字段）
      for (const key of Object.keys(store)) {
        if (saved.hasOwnProperty(key)) {
          store[key] = saved[key];
        }
      }
    }
    loaded = true;
    console.log('[appConfig] 配置已加载');
  } catch (err) {
    console.warn('[appConfig] 配置加载失败，使用默认值:', err.message);
    loaded = true;
  }
}

async function saveToDisk() {
  ensureDir();
  // 只持久化密钥类配置（不包含运行时状态）
  const toSave = {};
  for (const key of Object.keys(store)) {
    toSave[key] = store[key];
  }
  const tmp = CONFIG_FILE + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(toSave, null, 2) + '\n', 'utf8');
  await fsp.rename(tmp, CONFIG_FILE);
}

// 启动时加载
loadFromDisk();

/**
 * 获取所有可配置的 key 列表（供前端展示）
 */
function getConfigKeys() {
  return [
    { key: 'grsai_api_key', label: 'GRSai API 密钥', type: 'password', group: '图片生成' },
    { key: 'grsai_api_host', label: 'GRSai API 地址', type: 'text', group: '图片生成' },
    { key: 'seedance_api_key', label: 'Seedance API 密钥', type: 'password', group: '视频生成' },
    { key: 'seedance_api_url', label: 'Seedance API 地址', type: 'text', group: '视频生成' },
    { key: 'seedance_default_model', label: '默认视频模型', type: 'text', group: '视频生成' },
    { key: 'imgb_api_key', label: 'ImgBB API 密钥', type: 'password', group: '图床上传' },
    { key: 'mx_api_key', label: 'MXAPI 密钥（备用）', type: 'password', group: '图片生成' },
    { key: 'music_api_key', label: '音乐生成 API 密钥', type: 'password', group: '音乐生成' },
    { key: 'ref_image_upload_method', label: '图床上传方式', type: 'select', options: ['auto', 'axios', 'curl'], group: '图床上传' },
    { key: 'ref_image_upload_timeout_ms', label: '图床上传超时(ms)', type: 'number', group: '图床上传' },
    { key: 'config_password', label: '设置面板密码', type: 'password', group: '系统' },
  ];
}

/**
 * 验证密码
 */
function verifyPassword(pwd) {
  return pwd === store.config_password;
}

/**
 * 批量更新配置并持久化
 */
async function updateSettings(updates) {
  for (const key of Object.keys(updates)) {
    if (store.hasOwnProperty(key)) {
      store[key] = updates[key];
    }
  }
  await saveToDisk();
  return { ...store };
}

/**
 * 获取单个配置值（用于服务读取）
 */
function get(key) {
  if (!loaded) loadFromDisk();
  return store[key];
}

// 导出：用 getter 让 require() 解构之后每次访问都能拿到最新值
// 注意：不能用解构 `const { grsaiApiKey } = appConfig`，需要用 `appConfig.grsaiApiKey`
const appConfig = new Proxy(store, {
  get(_target, prop) {
    if (!loaded) loadFromDisk();
    return store[prop];
  },
  set(_target, prop, value) {
    store[prop] = value;
    return true;
  },
});

module.exports = {
  appConfig,
  getConfigKeys,
  verifyPassword,
  updateSettings,
  get,
};
