const express = require('express');
const router = express.Router();
const { LLMConfig } = require('../models/workflowModel');
const llmService = require('../services/llmService');

// 获取所有 LLM 配置
router.get('/', async (req, res) => {
  try {
    const configs = await LLMConfig.findAll();
    res.json({ success: true, data: configs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 获取默认 LLM 配置
router.get('/default', async (req, res) => {
  try {
    const config = await LLMConfig.findDefault();
    if (!config) {
      // 返回内置默认配置
      return res.json({ success: true, data: llmService.getDefaultConfig() });
    }
    res.json({ success: true, data: config });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 获取支持的提供商列表
router.get('/providers', (req, res) => {
  res.json({ success: true, data: llmService.listProviders() });
});

// 创建 LLM 配置
router.post('/', async (req, res) => {
  try {
    const { name, provider, api_url, api_key, model, is_default } = req.body;

    if (!name || !provider || !api_url || !model) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const config = await LLMConfig.create({
      name,
      provider,
      api_url,
      api_key,
      model,
      is_default: is_default || false,
    });

    res.json({ success: true, data: config });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 更新 LLM 配置
router.put('/:id', async (req, res) => {
  try {
    const { name, provider, api_url, api_key, model, is_default } = req.body;

    const config = await LLMConfig.update(req.params.id, {
      name,
      provider,
      api_url,
      api_key,
      model,
      is_default,
    });

    if (!config) {
      return res.status(404).json({ success: false, message: 'Config not found' });
    }

    res.json({ success: true, data: config });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 删除 LLM 配置
router.delete('/:id', async (req, res) => {
  try {
    const result = await LLMConfig.destroy(req.params.id);
    if (result === 0) {
      return res.status(404).json({ success: false, message: 'Config not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 测试 LLM 连接
router.post('/test', async (req, res) => {
  try {
    const { provider, api_url, api_key, model } = req.body;

    const config = { provider, api_url, api_key, model };

    const result = await llmService.complete(
      config,
      '你是一个测试助手。请回复"连接成功"。',
      '你好，请确认连接是否正常。'
    );

    res.json({ success: true, data: { message: '连接成功', response: result.content } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
