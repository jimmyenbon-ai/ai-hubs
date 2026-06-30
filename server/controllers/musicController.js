const { MusicGeneration } = require('../models');
const { generateMusic, queryMusicTask } = require('../utils/musicApiClient');
const { deductPoints } = require('../utils/pointsService');
const cache = require('../utils/cache');
const { saveAudio: saveAudioLocal } = require('../utils/localStorage');

// 音乐模型积分消耗
const MUSIC_MODEL_POINTS = {
  'chirp-v3-0': 2,
  'chirp-v3-5': 3,
  'chirp-v4': 4,
  'chirp-blue': 2,
  'chirp-bluejay': 2,
  'chirp-auk': 3,
  'chirp-auk-turbo': 2,
  // 默认消耗
  default: 2,
};

function extractAudioUrls(obj) {
  // 尽量从上游查询结果里找出音频 URL（不同上游字段名可能不同）
  const urls = [];
  const seenObj = new Set();
  const seenUrl = new Set();
  const queue = [obj];

  const maybePushUrl = (u, opts = {}) => {
    if (typeof u !== 'string') return;
    if (!/^https?:\/\//i.test(u)) return;
    // 常见音频后缀（上游一般是 mp3；但有时是无后缀的签名 URL）
    if (!opts.allowNoExt && !/\.(mp3|wav|m4a|aac|flac)(\?|#|$)/i.test(u)) return;
    if (seenUrl.has(u)) return;
    seenUrl.add(u);
    urls.push(u);
  };

  while (queue.length) {
    const cur = queue.shift();
    if (!cur || (typeof cur !== 'object' && typeof cur !== 'string')) continue;

    if (typeof cur === 'string') {
      maybePushUrl(cur);
      continue;
    }

    if (seenObj.has(cur)) continue;
    seenObj.add(cur);

    // 常见字段优先（mxapi/suno/第三方聚合字段名差异很大）
    const directAudioFields = [
      cur.audioUrl,
      cur.audio_url,
      cur.audio,
      cur.audioSrc,
      cur.audio_src,
      cur.audioSource,
      cur.mp3,
      cur.mp3_url,
      cur.mp3Url,
      cur.stream_url,
      cur.streamUrl,
      cur.download_url,
      cur.downloadUrl,
    ];
    // 对明确的“音频字段”放宽：允许无后缀/无扩展名的签名 URL
    directAudioFields.forEach((u) => maybePushUrl(u, { allowNoExt: true }));

    // 其他泛用字段仍保持后缀过滤，避免误把封面图/页面 URL 当成音频
    [cur.url, cur.file, cur.file_url, cur.fileUrl].forEach((u) =>
      maybePushUrl(u, { allowNoExt: false }),
    );

    // 若对象里有 key 含 audio/mp3/stream/download，也尝试作为音频 URL（允许无后缀）
    for (const [k, v] of Object.entries(cur)) {
      if (!v || typeof v !== 'string') continue;
      if (/(audio|mp3|stream|download)/i.test(k)) {
        maybePushUrl(v, { allowNoExt: true });
      }
    }

    for (const v of Object.values(cur)) {
      if (!v) continue;
      if (typeof v === 'string' || typeof v === 'object') queue.push(v);
    }
  }

  return urls;
}

// POST /api/music/generate
async function handleMusicGenerate(req, res, next) {
  try {
    const {
      model,
      mv,
      title,
      make_instrumental,
      gpt_description_prompt,
      prompt,
      tags,
      negative_tags,
      task,
      continue_clip_id,
      continue_at,
      cover_clip_id,
      metadata,
    } = req.body || {};

    const resolvedModel = mv || model;

    if (!resolvedModel || !title) {
      const err = new Error('缺少必填参数：mv(模型版本) 或 title');
      err.status = 400;
      throw err;
    }

    if (!gpt_description_prompt && !prompt) {
      const err = new Error('缺少必填参数：gpt_description_prompt 或 prompt');
      err.status = 400;
      throw err;
    }

    // 积分扣减
    const pointsCost = MUSIC_MODEL_POINTS[resolvedModel] || MUSIC_MODEL_POINTS.default
    const deductResult = await deductPoints(pointsCost, `音乐生成|模型:${resolvedModel}|曲名:${title}`)
    if (!deductResult.success) {
      return res.status(402).json({ success: false, message: deductResult.message });
    }

    const taskIds = await generateMusic({
      model: resolvedModel,
      mv: resolvedModel,
      title,
      make_instrumental: make_instrumental || false,
      gpt_description_prompt,
      prompt,
      tags,
      negative_tags,
      task,
      continue_clip_id,
      continue_at,
      cover_clip_id,
      metadata,
    });

    const record = await MusicGeneration.create({
      model,
      title,
      make_instrumental: make_instrumental || false,
      gpt_description_prompt,
      prompt,
      tags,
      negative_tags,
      task,
      continue_clip_id,
      continue_at,
      cover_clip_id,
      metadata: metadata || {},
      task_ids: taskIds,
      userId: null,
      pointsCost,
    });

    // 清除历史记录缓存
    const allKeys = cache.keys ? cache.keys() : []
    allKeys.forEach((k) => { if (k.startsWith('music_history_list')) cache.delete(k) })

    res.json({
      success: true,
      message: `音乐生成中，余额充足`,
      data: {
        taskIds,
        recordId: record.id,
        pointsCost,
      },
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/music/query/:taskId
async function handleQueryMusicTask(req, res, next) {
  try {
    const { taskId } = req.params;

    if (!taskId) {
      const err = new Error('缺少参数：taskId');
      err.status = 400;
      throw err;
    }

    // 轮询接口禁用缓存，避免出现 304 导致前端拿不到 JSON
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    let result;
    try {
      result = await queryMusicTask(taskId);
    } catch (err) {
      // 上游常见：任务未就绪时会返回 404（甚至是 nginx HTML）。
      // 对前端来说这不应算失败：保持 200 并标记 pending 继续轮询。
      if (err && (err.status === 404 || err.statusCode === 404)) {
        return res.json({
          success: true,
          message: '任务处理中',
          data: { raw: null, pending: true, audioUrl: null, audioUrls: [] },
        });
      }
      throw err;
    }

    // 如果查到音频地址，自动回填到历史记录里，让右侧能展示
    const audioUrls = extractAudioUrls(result);
    const audioUrl = audioUrls[0] || null;
    if (audioUrl) {
      await MusicGeneration.updateByTaskId(taskId, { audioUrl, audioUrls });

      // 本地存档（不阻塞响应）
      saveAudioLocal(audioUrl, { taskId });

      const allKeys = cache.keys ? cache.keys() : []
      allKeys.forEach((k) => { if (k.startsWith('music_history_list')) cache.delete(k) })
    }

    res.json({
      success: true,
      message: audioUrl ? '查询成功' : '任务处理中',
      data: { raw: result, pending: !audioUrl, audioUrl, audioUrls },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  handleMusicGenerate,
  handleQueryMusicTask,
};
