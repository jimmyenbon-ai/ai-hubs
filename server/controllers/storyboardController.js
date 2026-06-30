/**
 * StoryboardController — AI视频自动化 请求处理
 */

const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { StoryboardJob } = require('../models/storyboardModel');
const { Generation } = require('../models');
const storyboardService = require('../services/storyboardService');
const { urlToBase64 } = require('../utils/imageUtils');
const { saveImage: saveImageLocal, localPathToUrl } = require('../utils/localStorage');
const { generateImage } = require('../utils/grsaiClient');
const { deductPoints, confirmDeduct } = require('../utils/pointsService');
const logger = require('../utils/logger');

const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

// POST /api/storyboard/analyze — LLM 分析剧本，返回分镜列表
async function handleAnalyze(req, res, next) {
  try {
    const { script, style, customStylePrompt, includeAssets } = req.body || {};

    if (!script || !script.trim()) {
      return res.status(400).json({ success: false, message: '请输入剧本/脚本内容' });
    }

    const result = await storyboardService.analyzeScript({
      script: script.trim(),
      style: style || 'film',
      customStylePrompt: customStylePrompt || '',
    });

    if (includeAssets && result?.success !== false) {
      const assetResult = await storyboardService.analyzeAssets({
        script: script.trim(),
        style: style || 'film',
        customStylePrompt: customStylePrompt || '',
      });
      result.assets = assetResult.success === false
        ? { characters: [], locations: [], props: [], visualRules: '', styleNotes: '' }
        : assetResult.assets;
      result.assetError = assetResult.success === false ? assetResult.message : '';
    }

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

// POST /api/storyboard/assets - extract reusable project assets
async function handleAnalyzeAssets(req, res, next) {
  try {
    const { script, style, customStylePrompt } = req.body || {};

    if (!script || !script.trim()) {
      return res.status(400).json({ success: false, message: '请先输入小说、剧本或拍摄脚本。' });
    }

    const result = await storyboardService.analyzeAssets({
      script: script.trim(),
      style: style || 'film',
      customStylePrompt: customStylePrompt || '',
    });

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

// POST /api/storyboard/analyze-upload — 上传 txt 文件并分析
async function handleAnalyzeUpload(req, res, next) {
  let tmpPath = null;
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: '请选择要上传的剧本文件' });
    }

    tmpPath = file.path || file.filepath;
    const script = await fs.readFile(tmpPath, 'utf8');

    if (!script || !script.trim()) {
      return res.status(400).json({ success: false, message: '文件内容为空' });
    }

    const { style, customStylePrompt } = req.body || {};

    const result = await storyboardService.analyzeScript({
      script: script.trim(),
      style: style || 'film',
      customStylePrompt: customStylePrompt || '',
    });

    res.json({
      success: true,
      data: { ...result, script: script.trim(), fileName: file.originalname },
    });
  } catch (err) {
    next(err);
  } finally {
    if (tmpPath) {
      try { await fs.unlink(tmpPath); } catch (_) { /* ignore */ }
    }
  }
}

// POST /api/storyboard/start — 创建任务并启动生成
async function handleStart(req, res, next) {
  try {
    const {
      script,
      scriptSource = 'manual',
      style = 'film',
      customStylePrompt = '',
      globalStylePrompt = '',
      assets,
      shots = [],
      referenceImages,
      config = {},
    } = req.body || {};

    if (!shots || !Array.isArray(shots) || shots.length === 0) {
      return res.status(400).json({ success: false, message: '请先完成AI分镜分析' });
    }

    const job = await StoryboardJob.create({
      script: script || '',
      scriptSource,
      style,
      customStylePrompt,
      globalStylePrompt,
      assets: assets || { characters: [], locations: [], props: [], visualRules: '', styleNotes: '' },
      shots: shots.map((s) => ({
        ...s,
        status: 'pending',
        resultImageUrl: null,
        generatedPrompt: null,
        error: null,
        recordId: null,
      })),
      referenceImages: referenceImages || { characters: [], scenes: [], products: [] },
      config: {
        model: config.model || 'gpt-image-2',
        imageSize: config.imageSize || '1K',
        aspectRatio: config.aspectRatio || '16:9',
        frameInterval: Number(config.frameInterval) || 1,
        maxFrames: Number(config.maxFrames) || 0,
        qualityTags: config.qualityTags || 'cinematic storyboard keyframe, consistent character, accurate composition, high detail',
        productionType: config.productionType || '',
        cameraGrammar: config.cameraGrammar || '',
        compositionGrammar: config.compositionGrammar || '',
        directorGrammar: config.directorGrammar || '',
      },
      status: 'queued',
    });

    logger.info('AI视频自动化任务创建', {
      jobId: job.id,
      style,
      shotCount: job.totalShots,
    });

    // 异步启动处理
    setImmediate(() => storyboardService.processJob(job.id));

    res.json({
      success: true,
      data: { jobId: job.id, totalShots: job.totalShots },
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/storyboard/status/:jobId — 查询任务状态
async function handleStatus(req, res, next) {
  try {
    const jobId = Number(req.params.jobId);
    const job = await StoryboardJob.findByPk(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: '任务不存在' });
    }
    res.json({ success: true, data: job });
  } catch (err) {
    next(err);
  }
}

// POST /api/storyboard/abort/:jobId — 中止任务
async function handleAbort(req, res, next) {
  try {
    const jobId = Number(req.params.jobId);
    const job = await StoryboardJob.findByPk(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: '任务不存在' });
    }
    if (job.status !== 'running') {
      return res.status(400).json({ success: false, message: '任务不在运行中' });
    }

    const q = storyboardService.activeQueues.get(jobId);
    if (q) q.abort = true;

    await StoryboardJob.updateById(jobId, { status: 'failed', abortFlag: true });
    logger.info('AI视频自动化任务已中止', { jobId });

    res.json({ success: true, message: '任务已中止' });
  } catch (err) {
    next(err);
  }
}

// POST /api/storyboard/retry/:jobId/:shotNumber — 重试单个失败分镜
async function handleRetry(req, res, next) {
  try {
    const jobId = Number(req.params.jobId);
    const shotNumber = Number(req.params.shotNumber);

    const job = await StoryboardJob.findByPk(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: '任务不存在' });
    }

    const shot = job.shots.find((x) => x.shotNumber === shotNumber);
    if (!shot) {
      return res.status(404).json({ success: false, message: '分镜不存在' });
    }
    if (shot.status !== 'failed') {
      return res.status(400).json({ success: false, message: '只能重试失败的分镜' });
    }

    // 智能匹配参考图（限制数量，格式修正为字符串数组）
    const MAX_REFS = 3;
    const matchResult = storyboardService.matchRefImagesToShot(shot, job.referenceImages);
    const refsForGeneration = matchResult.matched.slice(0, MAX_REFS);
    const matchedRefs = refsForGeneration;
    // 本地路径转 base64（GRSai 需要公网可访问的 URL 或 base64 data URI）
    const refUrlsForApi = [];
    for (const ref of refsForGeneration) {
      if (!ref.url) continue;
      if (ref.url.startsWith('/uploads/') || ref.url.startsWith('/local_storage/')) {
        try {
          const dataUri = await urlToBase64(ref.url);
          if (dataUri) refUrlsForApi.push(dataUri);
        } catch (e) {
          logger.warn('重试-参考图转base64失败', { url: ref.url, error: e.message });
        }
      } else if (ref.url.startsWith('http://') || ref.url.startsWith('https://')) {
        refUrlsForApi.push(ref.url);
      }
    }

    const model = job.config.model;
    const composedPrompt = storyboardService.composePrompt(
      shot,
      job.globalStylePrompt,
      job.config.qualityTags,
      matchedRefs,
      refsForGeneration,
      job.assets || {},
      job.config || {},
    );

    // 标记为生成中
    await StoryboardJob.updateShot(jobId, shotNumber, { status: 'generating', error: null });

    // 异步处理单帧重试
    setImmediate(async () => {
      try {
        const pointsCost = storyboardService.MODEL_POINTS[model] || 2;
        const deductResult = await deductPoints(pointsCost, `AI视频自动化重试|模型:${model}`);
        if (!deductResult.success) throw new Error(deductResult.message);

        const imageUrl = await generateImage({
          prompt: composedPrompt,
          model,
          aspectRatio: job.config.aspectRatio,
          imageSize: job.config.imageSize,
          referenceImages: refUrlsForApi, // string[] 格式
        });

        const record = await Generation.create({
          originalPrompt: shot.description,
          apiPrompt: composedPrompt,
          aspectRatio: job.config.aspectRatio,
          imageSize: job.config.imageSize,
          resultImageUrl: imageUrl,
          referenceImages: refsForGeneration.map((r) => ({
            url: r.url,
            name: r.name,
            note: r.note || '',
            category: r.category,
            categoryKey: r.categoryKey,
            score: r.score || 0,
          })),
          apiProvider: 'grsai',
          modelName: model,
          userId: null,
          pointsCost,
        });

        await confirmDeduct(deductResult.balance, pointsCost, `AI视频自动化重试|模型:${model}`);

        const localPath = await saveImageLocal(imageUrl, {
          id: record.id, model, provider: 'grsai', prompt: shot.description,
        });
        const finalUrl = localPath ? localPathToUrl(localPath) : imageUrl;
        if (localPath) {
          await Generation.updateById(record.id, { resultImageUrl: finalUrl });
        }

        await StoryboardJob.updateShot(jobId, shotNumber, {
          status: 'completed',
          resultImageUrl: finalUrl,
          generatedPrompt: composedPrompt,
          matchedReferences: refsForGeneration.map((r) => ({
            url: r.url,
            name: r.name,
            note: r.note || '',
            category: r.category,
            categoryKey: r.categoryKey,
            score: r.score || 0,
          })),
          recordId: record.id,
        });

        // 如果任务已经停止了，检查是否所有活跃分镜都完成了
        const updatedJob = await StoryboardJob.findByPk(jobId);
        const hasPending = updatedJob.shots.some((s) =>
          s.includeInGeneration !== false && s.status === 'pending'
        );
        if (!hasPending) {
          await StoryboardJob.updateById(jobId, { status: 'completed' });
        }
      } catch (err) {
        logger.warn('AI视频自动化：重试失败', { jobId, shotNumber, error: err.message });
        await StoryboardJob.updateShot(jobId, shotNumber, {
          status: 'failed',
          error: err.message,
        });
      }
    });

    res.json({ success: true, message: '已重新生成' });
  } catch (err) {
    next(err);
  }
}

// POST /api/storyboard/upload-ref-image — 上传参考图
async function handleUploadRefImage(req, res, next) {
  let tmpPath = null;
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: '请选择要上传的图片' });
    }

    tmpPath = file.path || file.filepath;

    // 将上传的文件放到 uploads 目录
    const destDir = path.join(uploadDir);
    await fs.mkdir(destDir, { recursive: true });
    const destName = `storyboard-ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname || '.png')}`;
    const destPath = path.join(destDir, destName);
    await fs.copyFile(tmpPath, destPath);

    const localUrl = `/uploads/${destName}`;

    const note = req.body?.note || '';

    // 本地 URL 在生成时会自动转 base64 传给 GRSai，无需公网图床
    res.json({
      success: true,
      data: { url: localUrl, localUrl, name: file.originalname, note },
    });
  } catch (err) {
    next(err);
  } finally {
    if (tmpPath) {
      try { await fs.unlink(tmpPath); } catch (_) { /* ignore */ }
    }
  }
}

// GET /api/storyboard/list — 历史任务列表
async function handleList(req, res, next) {
  try {
    const jobs = await StoryboardJob.findAll({ order: 'desc', limit: 50 });
    const summary = jobs.map((j) => ({
      id: j.id,
      scriptPreview: j.script.slice(0, 100),
      style: j.style,
      status: j.status,
      totalShots: j.totalShots,
      completedShots: j.completedShots,
      failedShots: j.failedShots,
      createdAt: j.createdAt,
    }));
    res.json({ success: true, data: summary });
  } catch (err) {
    next(err);
  }
}

// GET /api/storyboard/download/:jobId — 打包下载所有成功的关键帧
async function handleDownload(req, res, next) {
  let tmpDir = null;
  try {
    const jobId = Number(req.params.jobId);
    const job = await StoryboardJob.findByPk(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: '任务不存在' });
    }

    const completedShots = job.shots.filter((s) => s.status === 'completed' && s.resultImageUrl);
    if (completedShots.length === 0) {
      return res.status(400).json({ success: false, message: '没有成功生成的关键帧可供下载' });
    }

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storyboard-dl-'));
    const zip = new AdmZip();

    for (const shot of completedShots) {
      let fileExt = '.jpg';
      try {
        const urlExt = path.extname(new URL(shot.resultImageUrl).pathname).toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(urlExt)) {
          fileExt = urlExt;
        }
      } catch (_) { /* ignore */ }

      const filename = `shot-${String(shot.shotNumber).padStart(3, '0')}-${shot.sceneTitle.replace(/[<>:"/\\|?*]/g, '_')}${fileExt}`;
      const dlPath = path.join(tmpDir, filename);

      try {
        const url = shot.resultImageUrl;
        let buffer;

        if (url.startsWith('/local_storage/')) {
          const localPath = path.join(__dirname, '..', url);
          buffer = await fs.readFile(localPath);
        } else {
          const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
          buffer = Buffer.from(resp.data);
        }

        await fs.writeFile(dlPath, buffer);
        zip.addLocalFile(dlPath);
      } catch (dlErr) {
        logger.warn('下载关键帧失败', { shotNumber: shot.shotNumber, error: dlErr.message });
      }
    }

    if (zip.getEntries().length === 0) {
      return res.status(500).json({ success: false, message: '所有关键帧下载失败' });
    }

    const zipBuf = zip.toBuffer();
    const safeName = 'storyboard-result';
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(safeName)}.zip"`);
    res.set('Content-Length', zipBuf.length);
    res.send(zipBuf);
  } catch (err) {
    next(err);
  } finally {
    if (tmpDir) {
      try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    }
  }
}

module.exports = {
  handleAnalyzeAssets,
  handleAnalyze,
  handleAnalyzeUpload,
  handleStart,
  handleStatus,
  handleAbort,
  handleRetry,
  handleUploadRefImage,
  handleList,
  handleDownload,
};
