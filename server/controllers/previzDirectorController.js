/**
 * PrevizDirectorController — 处理 AI 导演指令请求
 */

const { processDirective } = require('../services/previzDirectorService');
const logger = require('../utils/logger');

/**
 * POST /api/previz/direct
 * 标准请求-响应模式
 */
async function handleDirect(req, res, next) {
  try {
    const { scene_context, prompt } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({
        success: false,
        message: '请输入场景描述指令。',
      });
    }

    const result = await processDirective({
      sceneContext: scene_context,
      prompt,
    });

    if (result.success) {
      return res.json(result);
    }

    // 区分"未配置"和其他错误
    const status = result.needConfig ? 400 : 500;
    return res.status(status).json(result);

  } catch (err) {
    logger.error('[previzDirectorController] handleDirect error:', err.message);
    next(err);
  }
}

/**
 * POST /api/previz/direct-stream
 * SSE 流式模式 — 预留（Phase 4 实现）
 */
async function handleDirectStream(req, res) {
  const { scene_context, prompt } = req.body;

  if (!prompt || !prompt.trim()) {
    return res.status(400).json({
      success: false,
      message: '请输入场景描述指令。',
    });
  }

  // SSE 头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    send('progress', { phase: 'analyzing', message: '正在分析场景指令...' });

    const result = await processDirective({
      sceneContext: scene_context,
      prompt,
    });

    if (result.success) {
      send('progress', { phase: 'done', message: result.data.explanation });
      send('result', result.data);
    } else {
      send('error', { message: result.message });
    }
  } catch (err) {
    logger.error('[previzDirectorController] handleDirectStream error:', err.message);
    send('error', { message: `AI 场景生成失败：${err.message}` });
  } finally {
    send('done', {});
    res.end();
  }
}

module.exports = {
  handleDirect,
  handleDirectStream,
};
