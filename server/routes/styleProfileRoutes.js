const express = require('express');
const router = express.Router();
const { StyleProfile } = require('../models/styleProfileModel');
const { Generation } = require('../models');
const { extractStyleIntent, matchStyleProfile, buildStyleAwarePrompt } = require('../services/styleMatcher');

// 获取所有风格画像
router.get('/', async (req, res) => {
  try {
    const { tag, search } = req.query;
    const profiles = await StyleProfile.findAll({ tag, search });
    res.json({ success: true, data: profiles });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 获取单个风格画像
router.get('/:id', async (req, res) => {
  try {
    const profile = await StyleProfile.findById(req.params.id);
    if (!profile) return res.status(404).json({ success: false, message: 'Style profile not found' });
    res.json({ success: true, data: profile });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 从历史记录创建风格画像
router.post('/', async (req, res) => {
  try {
    const { historyId, name, description, promptTemplate, parameters, referenceImageUrl, tags } = req.body;

    let sourceId = historyId;
    let prompt = promptTemplate;
    let params = parameters || {};
    let refUrl = referenceImageUrl;

    // 如果指定了 historyId，从历史记录中提取默认值
    if (historyId) {
      const item = await Generation.findByPk(historyId);
      if (item) {
        sourceId = item.id;
        prompt = prompt || item.originalPrompt || '';
        params = {
          model: parameters?.model || item.modelName || 'gpt-image-2',
          aspectRatio: parameters?.aspectRatio || item.aspectRatio || '16:9',
          imageSize: parameters?.imageSize || item.imageSize || '1K',
          negativePrompt: parameters?.negativePrompt || '',
        };
        refUrl = refUrl || item.resultImageUrl || null;
      }
    }

    const profile = await StyleProfile.create({
      name: name || '未命名风格',
      description: description || '',
      sourceHistoryId: sourceId,
      promptTemplate: prompt,
      parameters: params,
      referenceImageUrl: refUrl,
      tags: tags || [],
    });

    res.json({ success: true, data: profile });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 更新风格画像
router.put('/:id', async (req, res) => {
  try {
    const profile = await StyleProfile.update(req.params.id, req.body);
    if (!profile) return res.status(404).json({ success: false, message: 'Style profile not found' });
    res.json({ success: true, data: profile });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 删除风格画像
router.delete('/:id', async (req, res) => {
  try {
    const result = await StyleProfile.destroy(req.params.id);
    if (result === 0) return res.status(404).json({ success: false, message: 'Style profile not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 匹配风格意图并返回匹配结果（不生成图片，仅预览）
router.post('/match', async (req, res) => {
  try {
    const { userInput } = req.body;
    if (!userInput) return res.status(400).json({ success: false, message: 'userInput is required' });

    const intent = await extractStyleIntent(userInput);
    const allProfiles = await StyleProfile.findAll();
    const matched = await matchStyleProfile(intent, allProfiles);

    res.json({
      success: true,
      data: { intent, matched },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
