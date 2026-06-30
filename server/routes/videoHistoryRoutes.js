const express = require('express');
const { handleGetVideoHistory, handleGetVideoHistoryItem, handleDeleteVideoHistory } = require('../controllers/videoHistoryController');

const router = express.Router();

// 获取视频生成历史列表
router.get('/', handleGetVideoHistory);

// 获取单条历史记录
router.get('/:id', handleGetVideoHistoryItem);

// 删除历史记录
router.delete('/:id', handleDeleteVideoHistory);

module.exports = router;
