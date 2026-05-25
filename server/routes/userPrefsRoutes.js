const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { UserPrefs } = require('../models/userPrefsModel');

// 首次访问：分配 userId
router.get('/init', async (req, res) => {
  try {
    const userId = uuidv4();
    const fingerprint = req.ip || req.connection?.remoteAddress || '';
    const prefs = await UserPrefs.findOrCreate(userId, fingerprint);
    res.json({ success: true, data: { userId, prefs } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 获取用户偏好
router.get('/:userId', async (req, res) => {
  try {
    let prefs = await UserPrefs.findByUserId(req.params.userId);
    if (!prefs) {
      const fingerprint = req.ip || req.connection?.remoteAddress || '';
      prefs = await UserPrefs.findOrCreate(req.params.userId, fingerprint);
    }
    res.json({ success: true, data: prefs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 更新用户偏好
router.put('/:userId', async (req, res) => {
  try {
    const prefs = await UserPrefs.update(req.params.userId, req.body);
    if (!prefs) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, data: prefs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 记录一次生成行为（更新偏好）
router.post('/:userId/record', async (req, res) => {
  try {
    const { model, aspectRatio, imageSize, styleProfileId, templateId, promptPattern } = req.body || {};
    const prefs = await UserPrefs.recordGeneration(req.params.userId, {
      model,
      aspectRatio,
      imageSize,
      styleProfileId,
      templateId,
      promptPattern,
    });
    res.json({ success: true, data: prefs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 获取该用户的生成历史
router.get('/:userId/history', async (req, res) => {
  try {
    const { Generation } = require('../models');
    const allItems = await Generation.findAll({ order: [['createdAt', 'DESC']] });
    const userItems = allItems.filter((i) => String(i.userId) === String(req.params.userId)).slice(0, 20);
    res.json({ success: true, data: userItems });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 获取所有用户统计（管理员查看）
router.get('/', async (req, res) => {
  try {
    const all = await UserPrefs.findAll();
    res.json({ success: true, data: all });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
