// 简单的日志系统（生产环境建议使用Winston）
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');
const ERROR_LOG_FILE = path.join(LOG_DIR, 'error.log');

const MAX_LOG_SIZE = Number(process.env.MAX_LOG_SIZE_MB || 5) * 1024 * 1024; // 默认 5MB
const MAX_LOG_FILES = 7; // 保留最近 7 个轮转文件

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// 日志轮转：检查文件大小，超过上限则重命名
function rotateLogIfNeeded(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const stats = fs.statSync(filePath);
    if (stats.size >= MAX_LOG_SIZE) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedName = filePath.replace('.log', `.${timestamp}.log`);
      fs.renameSync(filePath, rotatedName);
      // 删除过旧的轮转日志
      cleanupOldLogs(filePath);
    }
  } catch (_) {}
}

// 清理超过保留数量的旧日志文件
function cleanupOldLogs(baseFile) {
  try {
    const dir = path.dirname(baseFile);
    const base = path.basename(baseFile, '.log');
    const files = fs.readdirSync(dir)
      .filter((f) => f.startsWith(base + '.') && f.endsWith('.log'))
      .map((f) => ({
        name: f,
        path: path.join(dir, f),
        mtime: fs.statSync(path.join(dir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.mtime - a.mtime);

    files.slice(MAX_LOG_FILES).forEach((f) => {
      try { fs.unlinkSync(f.path); } catch (_) {}
    });
  } catch (_) {}
}

// 格式化日志消息
function formatMessage(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level}] ${message}${metaStr}\n`;
}

// 写入日志文件
function writeLog(file, message) {
  try {
    rotateLogIfNeeded(file);
    fs.appendFileSync(file, message, 'utf8');
  } catch (err) {
    console.error('[logger] Failed to write log:', err.message);
  }
}

const logger = {
  info(message, meta = {}) {
    const logMessage = formatMessage('INFO', message, meta);
    writeLog(LOG_FILE, logMessage);
    if (process.env.NODE_ENV !== 'production') {
      console.log(logMessage.trim());
    }
  },

  error(message, meta = {}) {
    const logMessage = formatMessage('ERROR', message, meta);
    writeLog(ERROR_LOG_FILE, logMessage);
    writeLog(LOG_FILE, logMessage);
    console.error(logMessage.trim());
  },

  warn(message, meta = {}) {
    const logMessage = formatMessage('WARN', message, meta);
    writeLog(LOG_FILE, logMessage);
    if (process.env.NODE_ENV !== 'production') {
      console.warn(logMessage.trim());
    }
  },

  debug(message, meta = {}) {
    if (process.env.NODE_ENV !== 'production') {
      const logMessage = formatMessage('DEBUG', message, meta);
      writeLog(LOG_FILE, logMessage);
      console.debug(logMessage.trim());
    }
  },
};

module.exports = logger;
