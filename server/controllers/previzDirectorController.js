/**
 * PrevizDirectorController - handles AI director requests.
 */

const { processDirective, generateShotPlan } = require('../services/previzDirectorService');
const logger = require('../utils/logger');

async function handleDirect(req, res, next) {
  try {
    const { scene_context, prompt, director_profile, material_type, source_title } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({
        success: false,
        message: '请输入场景描述指令。',
      });
    }

    const result = await processDirective({
      sceneContext: scene_context,
      prompt,
      directorProfile: director_profile,
      materialType: material_type,
      sourceTitle: source_title,
    });

    if (result.success) {
      return res.json(result);
    }

    const status = result.needConfig ? 400 : 500;
    return res.status(status).json(result);
  } catch (err) {
    logger.error('[previzDirectorController] handleDirect error:', err.message);
    next(err);
  }
}

async function handlePlan(req, res, next) {
  try {
    const { prompt, director_profile, material_type, source_title, preferred_shot_count } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({
        success: false,
        message: '请输入需要拆分镜的文本。',
      });
    }

    const result = await generateShotPlan({
      prompt,
      directorProfile: director_profile,
      materialType: material_type,
      sourceTitle: source_title,
      preferredShotCount: preferred_shot_count,
    });

    if (result.success) {
      return res.json(result);
    }

    const status = result.needConfig ? 400 : 500;
    return res.status(status).json(result);
  } catch (err) {
    logger.error('[previzDirectorController] handlePlan error:', err.message);
    next(err);
  }
}

async function handleDirectStream(req, res) {
  const { scene_context, prompt, director_profile, material_type, source_title } = req.body;

  if (!prompt || !prompt.trim()) {
    return res.status(400).json({
      success: false,
      message: '请输入场景描述指令。',
    });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
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
      directorProfile: director_profile,
      materialType: material_type,
      sourceTitle: source_title,
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
  handlePlan,
  handleDirectStream,
};
