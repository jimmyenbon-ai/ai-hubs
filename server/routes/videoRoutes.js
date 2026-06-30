const express = require('express');
const {
  handleVideoGenerate,
  handleQueryVideoTask,
  handleCancelVideoTask,
  handleVideoHistory,
  handleVideoModels,
  handleVideoConfig,
} = require('../controllers/videoController');
const { generateLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// 创建视频生成任务
router.post('/generate', generateLimiter, handleVideoGenerate);

// 查询视频任务状态
router.get('/query/:taskId', handleQueryVideoTask);

// 取消/删除视频任务
router.delete('/cancel/:taskId', handleCancelVideoTask);

// 获取视频生成历史
router.get('/history', handleVideoHistory);

// 获取支持的视频模型列表
router.get('/models', handleVideoModels);

// 获取默认配置
router.get('/config', handleVideoConfig);

module.exports = router;