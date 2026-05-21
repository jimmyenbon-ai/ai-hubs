const { verifyPassword, getConfigKeys, updateSettings, appConfig } = require('../utils/appConfig');
const logger = require('../utils/logger');

// 简单的内存 token 管理（内部工具，不需要 JWT）
const validTokens = new Set();

// POST /api/settings/auth
async function handleAuth(req, res, next) {
  try {
    const { password } = req.body || {};
    if (!password) {
      return res.status(400).json({ success: false, message: '请输入密码' });
    }

    if (verifyPassword(password)) {
      const token = `token-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      validTokens.add(token);
      // 5分钟过期
      setTimeout(() => validTokens.delete(token), 5 * 60 * 1000);
      return res.json({ success: true, data: { token } });
    }

    res.status(401).json({ success: false, message: '密码错误' });
  } catch (err) {
    next(err);
  }
}

// 验证 token 中间件
function requireAuth(req, res, next) {
  const token = req.headers['x-settings-token'] || req.query.token || '';
  if (!token || !validTokens.has(token)) {
    return res.status(401).json({ success: false, message: '未授权，请先输入密码' });
  }
  next();
}

// GET /api/settings
async function handleGetSettings(req, res, next) {
  try {
    const keys = getConfigKeys();
    const values = {};
    for (const k of keys) {
      values[k.key] = appConfig[k.key];
    }

    res.json({
      success: true,
      data: { keys, values },
    });
  } catch (err) {
    next(err);
  }
}

// PUT /api/settings
async function handleUpdateSettings(req, res, next) {
  try {
    const updates = req.body || {};
    await updateSettings(updates);
    logger.info('配置已更新', { keys: Object.keys(updates).join(', ') });
    res.json({ success: true, message: '配置已保存并生效' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  handleAuth,
  requireAuth,
  handleGetSettings,
  handleUpdateSettings,
};
