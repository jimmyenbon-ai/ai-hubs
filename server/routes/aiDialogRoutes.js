const express = require('express');
const router = express.Router();
const { Conversation, Message } = require('../models/conversationModel');
const { handleChat } = require('../services/aiDialogService');

// 获取对话列表
router.get('/conversations', async (req, res) => {
  try {
    const list = await Conversation.findAll({});
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 创建新对话
router.post('/conversations', async (req, res) => {
  try {
    const { title } = req.body;
    const conversation = await Conversation.create({ title });
    res.json({ success: true, data: conversation });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 获取指定对话的消息历史
router.get('/conversations/:id', async (req, res) => {
  try {
    const conversation = await Conversation.findByPk(req.params.id);
    if (!conversation) {
      return res.status(404).json({ success: false, message: '对话不存在' });
    }
    const messages = await Message.findAll(req.params.id);
    res.json({ success: true, data: { conversation, messages } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 删除对话
router.delete('/conversations/:id', async (req, res) => {
  try {
    await Message.clear(req.params.id);
    await Conversation.destroy(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 发送消息并处理（核心接口）
router.post('/chat', async (req, res) => {
  try {
    const { conversationId, message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: '消息内容不能为空' });
    }

    let convId = conversationId;

    // 如果没有 conversationId，自动创建新对话
    if (!convId) {
      const title = message.slice(0, 30) + (message.length > 30 ? '...' : '');
      const newConv = await Conversation.create({ title });
      convId = newConv.id;
    }

    // 处理对话
    const result = await handleChat(convId, message);

    // 更新对话的更新时间
    await Conversation.touch(convId);

    res.json({
      success: true,
      data: {
        conversationId: convId,
        ...result,
      },
    });
  } catch (err) {
    console.error('[AI-Dialog] /chat error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
