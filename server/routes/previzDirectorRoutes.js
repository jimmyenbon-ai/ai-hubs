/**
 * PrevizDirectorRoutes — AI 导演指令路由
 * 挂载于 /api/previz/direct 和 /api/previz/direct-stream
 */

const express = require('express');
const router = express.Router();
const { handleDirect, handleDirectStream } = require('../controllers/previzDirectorController');

// POST /api/previz/direct — 标准请求-响应
router.post('/direct', handleDirect);

// POST /api/previz/direct-stream — SSE 流式（预留）
router.post('/direct-stream', handleDirectStream);

module.exports = router;
