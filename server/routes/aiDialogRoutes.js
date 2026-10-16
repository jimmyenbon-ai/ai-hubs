const express = require('express');
const { randomUUID } = require('crypto');
const { Conversation, Message } = require('../models/conversationModel');
const { getDialogService } = require('../services/aiDialogService');
const { ALL_IMAGE_MODELS } = require('../config/imageModels');

function createAIDialogRouter({ service = getDialogService, conversations = Conversation, messages = Message } = {}) {
  const router = express.Router();
  const runs = () => typeof service === 'function' ? service() : service;
  const wrap = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) { next(error); } };
  const validId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
  const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
  const snapshot = item => item ? { ...item, events: runs().events(item.id) } : null;
  async function conversation(id) {
    if (!validId(id)) fail('对话标识无效');
    const item = await conversations.findByPk(id);
    if (!item) fail('对话不存在', 404);
    return item;
  }
  function run(id) { if (!validId(id)) fail('任务标识无效'); const item = runs().get(id); if (!item) fail('任务不存在', 404); return item; }
  async function start(body) {
    if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 10000) fail('需求不能为空，且不能超过 10000 字符');
    const requestId = body.requestId || randomUUID();
    if (!validId(requestId)) fail('请求标识无效');
    const options = { model: body.options?.model || 'auto', styleId: body.options?.styleId || 'auto' };
    if (options.model !== 'auto' && !ALL_IMAGE_MODELS.some(m => m.value === options.model)) fail('不支持的生图模型');
    if (options.styleId !== 'auto' && !validId(options.styleId)) fail('风格标识无效');
    const previous = runs().byRequest(requestId);
    let id = body.conversationId || previous?.conversation_id;
    if (!id) id = (await conversations.create({ title: body.message.slice(0, 30) })).id;
    await conversation(id);
    return runs().start({ conversationId: id, message: body.message.trim(), requestId, options });
  }
  function stream(req, res, item) {
    let after = Math.max(0, Number(req.query.after || req.get('Last-Event-ID')) || 0), closed = false;
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const poll = () => {
      if (closed) return;
      for (const event of runs().events(item.id, after)) {
        res.write(`id: ${event.seq}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
        res.flush?.();
        after = event.seq;
      }
      const current = runs().get(item.id);
      if (runs().terminal(current.status)) { clearInterval(timer); clearInterval(heartbeat); res.end(); }
    };
    const timer = setInterval(poll, 300);
    const heartbeat = setInterval(() => { if (!closed) res.write(': heartbeat\n\n'); }, 15000);
    res.on('close', () => { closed = true; clearInterval(timer); clearInterval(heartbeat); });
    poll();
  }
  router.get('/options', wrap(async (req, res) => {
    const { StyleProfile } = require('../models/styleProfileModel');
    res.json({ success: true, data: { models: ALL_IMAGE_MODELS, styles: (await StyleProfile.findAll()).map(p => ({ id: p.id, name: p.name, isDefault: p.parameters?.dialogDefault === true })) } });
  }));
  router.get('/conversations', wrap(async (req, res) => res.json({ success: true, data: await conversations.findAll({}) })));
  router.post('/conversations', wrap(async (req, res) => res.json({ success: true, data: await conversations.create({ title: typeof req.body.title === 'string' ? req.body.title.slice(0, 100) : '新对话' }) })));
  router.get('/conversations/:id', wrap(async (req, res) => {
    const item = await conversation(req.params.id);
    res.json({ success: true, data: { conversation: item, messages: await messages.findAll(item.id), latestRun: snapshot(runs().latest(item.id)) } });
  }));
  router.delete('/conversations/:id', wrap(async (req, res) => {
    await conversation(req.params.id);
    if (runs().isBusy(req.params.id)) fail('请先停止正在执行的任务', 409);
    await messages.clear(req.params.id);
    await conversations.destroy(req.params.id);
    res.json({ success: true });
  }));
  router.post('/runs', wrap(async (req, res) => res.json({ success: true, data: snapshot(await start(req.body)) })));
  router.get('/requests/:id', wrap(async (req, res) => {
    if (!validId(req.params.id)) fail('请求标识无效');
    const item = runs().byRequest(req.params.id);
    if (!item) fail('请求尚未接收，可重新发送', 404);
    await conversation(item.conversation_id);
    res.json({ success: true, data: snapshot(item) });
  }));
  router.get('/runs/:id', wrap(async (req, res) => { const item = run(req.params.id); await conversation(item.conversation_id); res.json({ success: true, data: snapshot(item) }); }));
  router.post('/runs/:id/cancel', wrap(async (req, res) => { const item = run(req.params.id); await conversation(item.conversation_id); runs().cancel(item.id); res.json({ success: true }); }));
  router.get('/runs/:id/events', wrap(async (req, res) => { const item = run(req.params.id); await conversation(item.conversation_id); stream(req, res, item); }));
  router.post('/chat-stream', wrap(async (req, res) => stream(req, res, await start(req.body))));
  router.post('/chat', wrap(async (req, res) => {
    const item = await start(req.body), completed = await runs().wait(item.id);
    if (!completed.result) fail(completed.error || '任务未完成', 502);
    res.json({ success: true, data: { ...completed.result, conversationId: item.conversation_id, runId: item.id } });
  }));
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error('[AI-Dialog]', error.message);
    res.status(error.status || 500).json({ success: false, message: error.status ? error.message : '智能对话服务异常，请稍后重试' });
  });
  return router;
}

module.exports = createAIDialogRouter();
module.exports.createAIDialogRouter = createAIDialogRouter;
