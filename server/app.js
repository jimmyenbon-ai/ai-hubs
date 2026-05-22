const express = require('express');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv');
const compression = require('compression');
const helmet = require('helmet');

dotenv.config();

const { sequelize } = require('./models');
const { Template } = require('./models/templates');
const uploadRoutes = require('./routes/uploadRoutes');
const generateRoutes = require('./routes/generateRoutes');
const historyRoutes = require('./routes/historyRoutes');
const pointsRoutes = require('./routes/pointsRoutes');
const musicRoutes = require('./routes/musicRoutes');
const musicHistoryRoutes = require('./routes/musicHistoryRoutes');
const videoRoutes = require('./routes/videoRoutes');
const videoHistoryRoutes = require('./routes/videoHistoryRoutes');
const templateRoutes = require('./routes/templateRoutes');
const promptTemplateRoutes = require('./routes/promptTemplateRoutes');
const workflowRoutes = require('./routes/workflowRoutes');
const llmConfigRoutes = require('./routes/llmConfigRoutes');
const knowledgeRoutes = require('./routes/knowledgeRoutes');
const batchRoutes = require('./routes/batchRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const errorHandler = require('./middleware/errorHandler');
const { generalLimiter } = require('./middleware/rateLimiter');

const app = express();

// 安全头设置（生产环境）
if (process.env.NODE_ENV === 'production') {
  app.use(helmet({
    contentSecurityPolicy: false, // 如果前端需要加载外部资源，可以设置为false
    crossOriginEmbedderPolicy: false,
  }));
}

// 请求压缩（减少传输大小）
app.use(compression());

// Basic middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 日志中间件（生产环境使用combined格式）
const logFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
app.use(morgan(logFormat));

// 全局API限流
app.use('/api', generalLimiter);

// Static uploads
const uploadDir = process.env.UPLOAD_DIR || 'uploads';
app.use('/uploads', express.static(path.join(__dirname, uploadDir)));

// 本地存档目录（AI 生成内容永久保存，避免远程 URL 过期）
app.use('/local_storage', express.static(path.join(__dirname, 'local_storage')));

// API routes
app.use('/api/upload', uploadRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/points', pointsRoutes);
app.use('/api/music', musicRoutes);
app.use('/api/music/history', musicHistoryRoutes);
app.use('/api/video', videoRoutes);
app.use('/api/video/history', videoHistoryRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/prompt-templates', promptTemplateRoutes);
app.use('/api/workflow', workflowRoutes);
app.use('/api/llm-config', llmConfigRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/batch', batchRoutes);
app.use('/api/settings', settingsRoutes);

// 健康检查（包含详细状态）
app.get('/api/health', (req, res) => {
  const health = {
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
    env: process.env.NODE_ENV || 'development',
  };
  res.json(health);
});

// 生产/演示模式：serve 前端构建产物
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
// SPA fallback：非 API/静态文件路由返回 index.html
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
  const ext = path.extname(req.path);
  if (ext && ext !== '.html') return next(); // 静态资源 404 交给 express.static
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next();
  });
});

// 404 handler for API routes (must be before error handler)
// This will only run if no previous route matched
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      success: false,
      message: 'API endpoint not found',
    });
  }
  next();
});

// Error handler
app.use(errorHandler);

async function initDatabase() {
  try {
    await sequelize.sync();
    await Template.sync();
    // eslint-disable-next-line no-console
    console.log('Database synced');
    // 初始化预设工作流
    const { initPresetWorkflows } = require('./initWorkflows');
    await initPresetWorkflows();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Database sync error:', err);
  }
}

module.exports = { app, initDatabase };

