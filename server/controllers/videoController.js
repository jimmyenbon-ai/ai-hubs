const { VideoGeneration } = require('../models');
const { createVideoTask, queryVideoTask, deleteVideoTask, formatTextContent, formatImageUrl, formatVideoUrl, formatAudioUrl } = require('../utils/seedanceApiClient');
const { createAgnesVideoTask, queryAgnesVideoTask } = require('../utils/agnesVideoClient');
const { deductPoints } = require('../utils/pointsService');
const cache = require('../utils/cache');
const { saveVideo: saveVideoLocal, localPathToUrl } = require('../utils/localStorage');

// 生成模式常量
const GENERATION_MODE = {
  TEXT_TO_VIDEO: 'text_to_video',           // 文生视频
  IMAGE_TO_VIDEO_FIRST: 'image_to_video_first',   // 图生视频-首帧
  IMAGE_TO_VIDEO_FIRST_LAST: 'image_to_video_first_last', // 图生视频-首尾帧
  MULTIMODAL_REFERENCE: 'multimodal_reference',  // 多模态参考生视频
};

// 视频模型积分消耗
const VIDEO_MODEL_POINTS = {
  'doubao-seedance-2-0-260128': 10,
  'doubao-seedance-2-0-fast-260128': 5,
  'doubao-seedance-1-5-pro-251215': 6,
  'doubao-seedance-1-0-pro-250123': 4,
  default: 8,
  'agnes-video-v2.0': 10,
};

// 默认配置
const DEFAULT_CONFIG = {
  model: process.env.SEEDANCE_DEFAULT_MODEL || 'doubao-seedance-2-0-260128',
  resolution: '720p',
  ratio: '16:9',
  duration: 5,
  generate_audio: true,
  watermark: false,
  return_last_frame: true,
};

/**
 * 根据生成模式构建 content 内容
 */
function buildContent(mode, params) {
  const content = [];
  const { prompt, firstFrameImage, lastFrameImage, referenceImages, referenceVideo, referenceAudio } = params;

  // 添加文本提示词（可选）
  if (prompt && prompt.trim()) {
    content.push(formatTextContent(prompt));
  }

  switch (mode) {
    case GENERATION_MODE.TEXT_TO_VIDEO:
      // 纯文生视频：只需要文本
      break;

    case GENERATION_MODE.IMAGE_TO_VIDEO_FIRST:
      // 图生视频-首帧：首帧图片
      if (firstFrameImage) {
        content.push(formatImageUrl(firstFrameImage, 'first_frame'));
      }
      break;

    case GENERATION_MODE.IMAGE_TO_VIDEO_FIRST_LAST:
      // 图生视频-首尾帧：首帧 + 尾帧
      if (firstFrameImage) {
        content.push(formatImageUrl(firstFrameImage, 'first_frame'));
      }
      if (lastFrameImage) {
        content.push(formatImageUrl(lastFrameImage, 'last_frame'));
      }
      break;

    case GENERATION_MODE.MULTIMODAL_REFERENCE:
      // 多模态参考生视频：参考图片（0~9）+ 参考视频（0~1）+ 参考音频（0~1）
      if (referenceImages && Array.isArray(referenceImages)) {
        referenceImages.forEach((img, idx) => {
          // 最多支持9张参考图
          if (idx < 9) {
            content.push(formatImageUrl(img, 'reference_image'));
          }
        });
      }
      if (referenceVideo) {
        content.push(formatVideoUrl(referenceVideo, 'reference_video'));
      }
      if (referenceAudio) {
        content.push(formatAudioUrl(referenceAudio, 'reference_audio'));
      }
      break;

    default:
      break;
  }

  return content;
}

/**
 * POST /api/video/generate
 * 创建视频生成任务
 */
function isAgnesModel(model) { return model && model.startsWith('agnes-'); }

async function handleVideoGenerate(req, res, next) {
  try {
    const {
      mode = GENERATION_MODE.TEXT_TO_VIDEO,
      model = DEFAULT_CONFIG.model,
      prompt,
      firstFrameImage,
      lastFrameImage,
      referenceImages,
      referenceVideo,
      referenceAudio,
      content, // 前端直接传入的 content 数组（多模态模式使用）
      resolution = DEFAULT_CONFIG.resolution,
      ratio = DEFAULT_CONFIG.ratio,
      duration = DEFAULT_CONFIG.duration,
      seed,
      generate_audio = DEFAULT_CONFIG.generate_audio,
      watermark = DEFAULT_CONFIG.watermark,
      return_last_frame = DEFAULT_CONFIG.return_last_frame,
      service_tier,
      execution_expires_after,
      tools,
    } = req.body || {};

    // 如果前端直接传了 content 数组（多模态模式），直接使用
    let requestContent = content

    if (!requestContent || !Array.isArray(requestContent) || requestContent.length === 0) {
      // 验证必填参数
      if (!prompt || !prompt.trim()) {
        if (mode === GENERATION_MODE.TEXT_TO_VIDEO) {
          const err = new Error('请输入视频描述词');
          err.status = 400;
          throw err;
        }
      }

      // 根据模式验证必填参数
      if (mode === GENERATION_MODE.IMAGE_TO_VIDEO_FIRST && !firstFrameImage) {
        const err = new Error('请上传首帧图片');
        err.status = 400;
        throw err;
      }

      if (mode === GENERATION_MODE.IMAGE_TO_VIDEO_FIRST_LAST && (!firstFrameImage || !lastFrameImage)) {
        const err = new Error('请上传首帧和尾帧图片');
        err.status = 400;
        throw err;
      }

      // 构建 content 内容
      requestContent = buildContent(mode, {
        prompt,
        firstFrameImage,
        lastFrameImage,
        referenceImages,
        referenceVideo,
        referenceAudio,
      });
    }

    const pointsCost = VIDEO_MODEL_POINTS[model] || VIDEO_MODEL_POINTS.default

    // 积分扣减
    const deductResult = await deductPoints(pointsCost, `视频生成|模型:${model}|模式:${mode}`)
    if (!deductResult.success) {
      return res.status(402).json({ success: false, message: deductResult.message });
    }

    // 路由到 Agnes 或 Seedance API
    const useAgnes = isAgnesModel(model);
    let result;
    if (useAgnes) {
      // 构建 Agnes API 参数（接受前端直接传参或映射旧参数）
      const agnesParam = { model, prompt };
      // 优先使用前端传来的 Agnes 参数
      if (req.body.height) agnesParam.height = parseInt(req.body.height, 10) || 768;
      else agnesParam.height = resolution === '1080p' ? 1080 : resolution === '480p' ? 480 : 768;
      if (req.body.width) agnesParam.width = parseInt(req.body.width, 10) || 1152;
      else agnesParam.width = ratio === '9:16' ? 576 : ratio === '1:1' ? 768 : ratio === '21:9' ? 1792 : 1152;
      if (req.body.num_frames) agnesParam.num_frames = parseInt(req.body.num_frames, 10);
      if (req.body.frame_rate) agnesParam.frame_rate = parseInt(req.body.frame_rate, 10);
      if (req.body.negative_prompt && req.body.negative_prompt.trim()) agnesParam.negative_prompt = req.body.negative_prompt.trim();
      if (seed >= 0) agnesParam.seed = seed;
      if (firstFrameImage) agnesParam.image = firstFrameImage;
      if (referenceImages && referenceImages.length > 0) {
        agnesParam.extra_body = { image: referenceImages };
        if (mode === 'keyframes') agnesParam.extra_body.mode = 'keyframes';
      }
      result = await createAgnesVideoTask(agnesParam);
    } else {
      result = await createVideoTask({
      model,
      content: requestContent,
      resolution,
      ratio,
      duration,
      seed,
      generate_audio,
      watermark,
      return_last_frame,
      service_tier,
      execution_expires_after,
      tools,
    });

    }

    // 保存到本地记录
    const record = await VideoGeneration.create({
      task_id: result.taskId,
      model,
      mode,
      prompt,
      firstFrameImage,
      lastFrameImage,
      referenceImages: referenceImages || [],
      referenceVideo,
      referenceAudio,
      resolution,
      ratio,
      duration,
      seed,
      generate_audio,
      watermark,
      status: 'queued',
      videoUrl: null,
      lastFrameUrl: null,
      userId: null,
      pointsCost,
    });

    // 清除视频历史缓存
    const allKeys = cache.keys ? cache.keys() : []
    allKeys.forEach((k) => { if (k.startsWith('video_history_list')) cache.delete(k) })

    res.json({
      success: true,
      message: `视频生成任务已创建，余额充足`,
      data: {
        taskId: result.taskId,
        recordId: record.id,
        status: 'queued',
        pointsCost,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/video/query/:taskId
 * 查询视频生成任务状态
 */
async function handleQueryVideoTask(req, res, next) {
  try {
    const { taskId } = req.params;

    if (!taskId) {
      const err = new Error('缺少参数：taskId');
      err.status = 400;
      throw err;
    }

    // 禁用缓存，确保获取最新状态
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    // 从本地记录判断是 Agnes 还是 Seedance 任务
    const allRecords = await VideoGeneration.findAll({ limit: 100 });
    const localRecord = allRecords.find(r => r.task_id === taskId);
    const isAgnesTask = localRecord && localRecord.model && localRecord.model.startsWith('agnes-');

    let result;
    try {
      if (isAgnesTask) {
        result = await queryAgnesVideoTask(taskId);
      } else {
        result = await queryVideoTask(taskId);
      }
    } catch (err) {
      // 任务不存在或未就绪时返回 pending 状态
      if (err && (err.status === 404 || err.statusCode === 404)) {
        return res.json({
          success: true,
          message: '任务处理中',
          data: {
            taskId,
            status: 'pending',
            videoUrl: null,
            pending: true,
          },
        });
      }
      throw err;
    }

    const videoUrl = result.video_url || result.content?.video_url || null;
    const coverUrl = result.cover_image_url || result.content?.last_frame_url || null;

    // 如果任务成功，自动更新本地记录
    if ((((result.status === 'succeeded' || result.status === 'completed') || result.status === 'completed') || result.status === 'completed') && videoUrl) {
      // 先保存到本地，然后使用本地 URL
      const localPath = await saveVideoLocal(videoUrl, {
        taskId,
        model: result.model,
        duration: result.duration,
        resolution: result.resolution,
        prompt: result.prompt,
      });
      // 如果本地保存成功，使用本地 URL；否则使用云端 URL
      const savedVideoUrl = localPath ? localPathToUrl(localPath) : videoUrl;
      
      await VideoGeneration.updateByTaskId(taskId, {
        status: 'succeeded',
        videoUrl: savedVideoUrl,
        lastFrameUrl: coverUrl,
        duration: result.duration,
        resolution: result.resolution,
        ratio: result.ratio,
        usage: result.usage,
      });

      cache.delete('video_history_list_30');
      cache.delete('video_history_list_50');
      const allKeys = cache.keys ? cache.keys() : []
      allKeys.forEach((k) => { if (k.startsWith('video_history_list')) cache.delete(k) })
    } else if (result.status === 'failed') {
      await VideoGeneration.updateByTaskId(taskId, {
        status: 'failed',
        error: result.error,
      });
    }

    res.json({
      success: true,
      message: (((result.status === 'succeeded' || result.status === 'completed') || result.status === 'completed') || result.status === 'completed') ? '视频生成成功' : '任务处理中',
      data: {
        taskId: result.id,
        model: result.model,
        status: result.status,
        error: result.error,
        videoUrl: result.video_url || result.content?.video_url || null,
        lastFrameUrl: result.cover_image_url || result.content?.last_frame_url || null,
        duration: result.duration,
        resolution: result.resolution,
        ratio: result.ratio,
        frames: result.frames,
        framespersecond: result.framespersecond,
        generate_audio: result.generate_audio,
        draft: result.draft,
        draft_task_id: result.draft_task_id,
        service_tier: result.service_tier,
        execution_expires_after: result.execution_expires_after,
        usage: result.usage,
        pending: result.status !== 'succeeded',
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/video/cancel/:taskId
 * 取消或删除视频生成任务
 */
async function handleCancelVideoTask(req, res, next) {
  try {
    const { taskId } = req.params;

    if (!taskId) {
      const err = new Error('缺少参数：taskId');
      err.status = 400;
      throw err;
    }

    // 从数据库获取任务状态
    const allRecords = await VideoGeneration.findAll({ limit: 100 });
    const record = allRecords.find(r => r.task_id === taskId);

    if (!record) {
      const err = new Error('任务记录不存在');
      err.status = 404;
      throw err;
    }

    // 如果任务在排队中，先尝试取消
    if (record.status === 'queued') {
      try {
        await deleteVideoTask(taskId);
      } catch (err) {
        // 忽略取消失败（可能任务已经开始了）
        console.warn('取消任务失败，可能任务已开始:', err.message);
      }
      await VideoGeneration.updateById(record.id, { status: 'cancelled' });
    } else if (record.status === 'succeeded' || record.status === 'failed' || record.status === 'expired') {
      // 对于已完成/失败/超时的任务，只删除本地记录
      await VideoGeneration.destroy({ where: { id: record.id } });
    } else {
      // running 状态的任务不能删除
      const err = new Error('正在运行的任务无法取消');
      err.status = 400;
      throw err;
    }

    // 清除缓存
    const allKeys = cache.keys ? cache.keys() : []
    allKeys.forEach((k) => { if (k.startsWith('video_history_list')) cache.delete(k) })

    res.json({
      success: true,
      message: '任务已取消/删除',
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/video/history
 * 获取视频生成历史记录
 */
async function handleVideoHistory(req, res, next) {
  try {
    // 禁用缓存，确保前端总是获取最新状态
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    const {
      page: qPage,
      pageSize: qPageSize,
      dateFrom,
      dateTo,
      search,
    } = req.query;

    const page = Math.max(1, parseInt(qPage, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(qPageSize, 10) || 20));

    let records = await VideoGeneration.findAll({
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'task_id', 'model', 'mode', 'prompt', 'status', 'videoUrl', 'lastFrameUrl', 'createdAt', 'updatedAt', 'resolution', 'ratio', 'duration', 'error'],
    });

    // 日期筛选
    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      records = records.filter(r => new Date(r.createdAt).getTime() >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo + 'T23:59:59.999').getTime();
      records = records.filter(r => new Date(r.createdAt).getTime() <= to);
    }
    // 关键词搜索
    if (search && search.trim()) {
      const kw = search.trim().toLowerCase();
      records = records.filter(r =>
        (r.prompt || '').toLowerCase().includes(kw) ||
        (r.model || '').toLowerCase().includes(kw) ||
        (r.mode || '').toLowerCase().includes(kw)
      );
    }

    const total = records.length;
    const totalPages = Math.ceil(total / pageSize);
    const offset = (page - 1) * pageSize;
    const paged = records.slice(offset, offset + pageSize);

    res.json({
      success: true,
      data: paged,
      pagination: { page, pageSize, total, totalPages },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/video/models
 * 获取支持的视频模型列表
 */
async function handleVideoModels(req, res, next) {
  try {
    const models = [
      {
        id: 'doubao-seedance-2-0-260128',
        name: 'Seedance 2.0',
        description: '最新旗舰视频生成模型，支持文生视频、图生视频、多模态参考生视频',
        features: ['文生视频', '图生视频-首帧', '图生视频-首尾帧', '多模态参考生视频', '支持参考视频', '支持参考音频'],
        maxDuration: 15,
        maxImages: 9,
        maxVideos: 3,
        maxAudios: 3,
      },
      {
        id: 'doubao-seedance-2-0-fast-260128',
        name: 'Seedance 2.0 fast',
        description: '快速视频生成模型，适合需要快速反馈的场景',
        features: ['文生视频', '图生视频-首帧', '图生视频-首尾帧', '多模态参考生视频', '生成速度快'],
        maxDuration: 15,
        maxImages: 9,
        maxVideos: 3,
        maxAudios: 3,
      },
      {
        id: 'doubao-seedance-1-5-pro-251215',
        name: 'Seedance 1.5 pro',
        description: '专业级视频生成模型',
        features: ['文生视频', '图生视频-首帧', '图生视频-首尾帧'],
        maxDuration: 12,
        maxImages: 1,
        maxVideos: 0,
        maxAudios: 0,
      },
      {
        id: 'agnes-video-v2.0',
        name: 'Agnes Video V2.0',
        description: 'Agnes AI 电影级视频生成模型，支持文生视频、图生视频、多图视频、关键帧动画',
        features: ['文生视频', '图生视频', '多图视频生成', '关键帧动画', '电影级画质', '异步任务'],
        maxDuration: 30,
        maxImages: 10,
        maxVideos: 0,
        maxAudios: 0,
      },
    ];

    res.json({
      success: true,
      data: models,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/video/config
 * 获取视频生成默认配置
 */
async function handleVideoConfig(req, res, next) {
  try {
    res.json({
      success: true,
      data: {
        defaultModel: DEFAULT_CONFIG.model,
        defaultResolution: DEFAULT_CONFIG.resolution,
        defaultRatio: DEFAULT_CONFIG.ratio,
        defaultDuration: DEFAULT_CONFIG.duration,
        defaultGenerateAudio: DEFAULT_CONFIG.generate_audio,
        defaultWatermark: DEFAULT_CONFIG.watermark,
        defaultVideoProvider: require('../utils/appConfig').appConfig.default_video_provider || 'seedance',
        defaultReturnLastFrame: DEFAULT_CONFIG.return_last_frame,
        defaultAgnesModel: 'agnes-video-v2.0',
        defaultAgnesApiUrl: 'https://apihub.agnes-ai.com/v1/videos',
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  GENERATION_MODE,
  handleVideoGenerate,
  handleQueryVideoTask,
  handleCancelVideoTask,
  handleVideoHistory,
  handleVideoModels,
  handleVideoConfig,
};