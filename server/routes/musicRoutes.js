const express = require('express');
const { handleMusicGenerate, handleQueryMusicTask } = require('../controllers/musicController');
const { generateLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// 音乐生成限流：每分钟5次
router.post('/generate', generateLimiter, handleMusicGenerate);

// 查询音乐任务
router.get('/query/:taskId', handleQueryMusicTask);

module.exports = router;
