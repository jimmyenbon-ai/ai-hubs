const rateLimit = require('express-rate-limit');

// 通用API限流：每分钟100个请求
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1分钟
  max: 100, // 限制每个IP每分钟最多100个请求
  message: {
    success: false,
    message: '请求过于频繁，请稍后再试',
  },
  standardHeaders: true, // 返回标准的RateLimit头信息
  legacyHeaders: false, // 禁用X-RateLimit-*头
  // 跳过健康检查
  skip: (req) => req.path === '/api/health',
});

// 图像生成限流：每分钟5次（防止滥用）
const generateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1分钟
  max: 5, // 限制每个IP每分钟最多5次生成
  message: {
    success: false,
    message: '图像生成请求过于频繁，请稍后再试（每分钟最多5次）',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 积分查询限流：每分钟20次
const pointsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1分钟
  max: 20, // 限制每个IP每分钟最多20次查询
  message: {
    success: false,
    message: '积分查询过于频繁，请稍后再试',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 文件上传限流：每分钟10次
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1分钟
  max: 10, // 限制每个IP每分钟最多10次上传
  message: {
    success: false,
    message: '文件上传过于频繁，请稍后再试',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  generalLimiter,
  generateLimiter,
  pointsLimiter,
  uploadLimiter,
};
