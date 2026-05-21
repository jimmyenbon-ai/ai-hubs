const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const axios = require('axios');
const AdmZip = require('adm-zip');
const { BatchJob } = require('../models/batchModel');
const { Generation } = require('../models');
const { generateImage } = require('../utils/grsaiClient');
const { parseDocument } = require('../utils/documentParser');
const { deductPoints, confirmDeduct } = require('../utils/pointsService');
const { saveImage: saveImageLocal } = require('../utils/localStorage');
const logger = require('../utils/logger');

const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

// 模型积分映射（与 generateController 保持一致）
const MODEL_POINTS = {
  'gpt-image-2': 2,
  'gpt-image-2-vip': 5,
  'nano-banana': 1,
  'nano-banana-fast': 1,
  'nano-banana-2': 2,
  'nano-banana-2-cl': 2,
  'nano-banana-2-4k-cl': 4,
  'nano-banana-pro': 1,
  'nano-banana-pro-cl': 2,
  'nano-banana-pro-vip': 2,
  'nano-banana-pro-4k-vip': 4,
};

// 活跃队列：jobId → { abort: boolean }
const activeQueues = new Map();

// POST /api/batch/upload — 上传并解析文档
async function handleBatchUpload(req, res, next) {
  let tmpPath = null;
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: '请选择要上传的文件' });
    }

    const allowedExts = ['.txt', '.md', '.csv', '.xlsx', '.xls'];
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!allowedExts.includes(ext)) {
      return res.status(400).json({
        success: false,
        message: `不支持的文件格式: ${ext}，支持: ${allowedExts.join(', ')}`,
      });
    }

    tmpPath = file.path || file.filepath;
    const result = parseDocument(tmpPath, file.mimetype, file.originalname);

    if (!result.items || result.items.length === 0) {
      return res.status(400).json({ success: false, message: '未能从文档中解析到任何提示词，请检查文件内容' });
    }

    logger.info('批量文档解析成功', { name: result.name, count: result.items.length });

    res.json({
      success: true,
      data: {
        name: result.name,
        itemCount: result.items.length,
        items: result.items,
      },
    });
  } catch (err) {
    next(err);
  } finally {
    // 清理临时文件
    if (tmpPath) {
      try { await fsp.unlink(tmpPath); } catch (_) { /* ignore */ }
    }
  }
}

// POST /api/batch/start — 创建任务并启动队列
async function handleBatchStart(req, res, next) {
  try {
    const {
      name,
      items,
      defaultModel = 'gpt-image-2',
      defaultAspectRatio = '1:1',
      defaultImageSize = '1K',
    } = req.body || {};

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: '请提供要生成的项目列表' });
    }

    const job = await BatchJob.create({
      name: name || '批量生成',
      items: items.map((it, i) => ({
        index: i + 1,
        prompt: it.prompt,
        model: it.model || null,
        aspectRatio: it.aspectRatio || null,
        imageSize: it.imageSize || null,
        status: 'queued',
        resultImageUrl: null,
        error: null,
        recordId: null,
      })),
      defaultModel,
      defaultAspectRatio,
      defaultImageSize,
      status: 'queued',
    });

    logger.info('批量任务创建', { jobId: job.id, name: job.name, count: job.totalCount });

    // 异步启动处理
    setImmediate(() => processBatchJob(job.id));

    res.json({ success: true, data: { jobId: job.id, name: job.name, totalCount: job.totalCount } });
  } catch (err) {
    next(err);
  }
}

// GET /api/batch/status/:jobId — 查询进度
async function handleBatchStatus(req, res, next) {
  try {
    const jobId = Number(req.params.jobId);
    const job = await BatchJob.findByPk(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: '任务不存在' });
    }
    res.json({ success: true, data: job });
  } catch (err) {
    next(err);
  }
}

// GET /api/batch/download/:jobId — 打包下载所有成功图片
async function handleBatchDownload(req, res, next) {
  let tmpDir = null;
  try {
    const jobId = Number(req.params.jobId);
    const job = await BatchJob.findByPk(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: '任务不存在' });
    }

    const completedItems = job.items.filter((it) => it.status === 'completed' && it.resultImageUrl);
    if (completedItems.length === 0) {
      return res.status(400).json({ success: false, message: '没有成功生成的图片可供下载' });
    }

    // 创建临时目录
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'batch-dl-'));
    const zip = new AdmZip();

    for (const item of completedItems) {
      const ext = '.jpg';
      // try to get it from url, default to jpg
      let fileExt = ext;
      try {
        const urlExt = path.extname(new URL(item.resultImageUrl).pathname).toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(urlExt)) {
          fileExt = urlExt;
        }
      } catch (_) { /* ignore */ }

      const filename = `${String(item.index).padStart(3, '0')}${fileExt}`;
      const dlPath = path.join(tmpDir, filename);

      try {
        const resp = await axios.get(item.resultImageUrl, {
          responseType: 'arraybuffer',
          timeout: 30000,
        });
        await fsp.writeFile(dlPath, Buffer.from(resp.data));
        zip.addLocalFile(dlPath);
      } catch (dlErr) {
        logger.warn('批量下载：单张图片下载失败', { index: item.index, url: item.resultImageUrl, error: dlErr.message });
      }
    }

    if (zip.getEntries().length === 0) {
      return res.status(500).json({ success: false, message: '所有图片下载失败，无法打包' });
    }

    const zipBuf = zip.toBuffer();
    const safeName = (job.name || 'batch').replace(/[<>:"/\\|?*]/g, '_');
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(safeName)}-结果.zip"`);
    res.set('Content-Length', zipBuf.length);
    res.send(zipBuf);
  } catch (err) {
    next(err);
  } finally {
    if (tmpDir) {
      try { await fsp.rm(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    }
  }
}

// POST /api/batch/abort/:jobId — 中止任务
async function handleBatchAbort(req, res, next) {
  try {
    const jobId = Number(req.params.jobId);
    const job = await BatchJob.findByPk(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: '任务不存在' });
    }
    if (job.status !== 'running') {
      return res.status(400).json({ success: false, message: '任务不在运行中' });
    }

    const q = activeQueues.get(jobId);
    if (q) q.abort = true;
    activeQueues.delete(jobId);

    await BatchJob.updateById(jobId, { status: 'failed' });
    logger.info('批量任务已中止', { jobId });

    res.json({ success: true, message: '任务已中止' });
  } catch (err) {
    next(err);
  }
}

// POST /api/batch/retry/:jobId/:itemIndex — 重试单个失败条目
async function handleBatchRetry(req, res, next) {
  try {
    const jobId = Number(req.params.jobId);
    const itemIndex = Number(req.params.itemIndex);
    const job = await BatchJob.findByPk(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: '任务不存在' });
    }

    const item = job.items.find((x) => x.index === itemIndex);
    if (!item) {
      return res.status(404).json({ success: false, message: '条目不存在' });
    }
    if (item.status !== 'failed') {
      return res.status(400).json({ success: false, message: '只能重试失败的条目' });
    }

    // 重置为 queued 状态
    await BatchJob.updateItem(jobId, itemIndex, { status: 'queued', error: null });

    // 如果任务已完成但还有待处理项，重新激活
    const updatedJob = await BatchJob.findByPk(jobId);
    if (updatedJob.status === 'completed') {
      await BatchJob.updateById(jobId, { status: 'queued' });
      setImmediate(() => processBatchJob(jobId));
    }

    res.json({ success: true, message: '已重新排队' });
  } catch (err) {
    next(err);
  }
}

// GET /api/batch/list — 历史任务列表
async function handleBatchList(req, res, next) {
  try {
    const jobs = await BatchJob.findAll({ order: 'desc', limit: 50 });
    const summary = jobs.map((j) => ({
      id: j.id,
      name: j.name,
      status: j.status,
      totalCount: j.totalCount,
      completedCount: j.completedCount,
      failedCount: j.failedCount,
      createdAt: j.createdAt,
    }));
    res.json({ success: true, data: summary });
  } catch (err) {
    next(err);
  }
}

/**
 * 核心队列处理：逐条生成图片
 */
async function processBatchJob(jobId) {
  const queueCtx = { abort: false };
  activeQueues.set(jobId, queueCtx);

  try {
    let job = await BatchJob.findByPk(jobId);
    if (!job || job.status === 'running') {
      // 已经在运行中
      return;
    }

    await BatchJob.updateById(jobId, { status: 'running' });
    job = await BatchJob.findByPk(jobId);

    for (const item of job.items) {
      if (queueCtx.abort) {
        logger.info('批量任务被中止', { jobId });
        return;
      }

      if (item.status !== 'queued') continue;

      // 标记为 running
      await BatchJob.updateItem(jobId, item.index, { status: 'running' });

      const model = item.model || job.defaultModel;
      const aspectRatio = item.aspectRatio || job.defaultAspectRatio;
      const imageSize = item.imageSize || job.defaultImageSize;
      const pointsCost = MODEL_POINTS[model] || 2;

      try {
        // 积分预扣
        const deductResult = await deductPoints(pointsCost, `批量生成|模型:${model}`);
        if (!deductResult.success) {
          throw new Error(deductResult.message);
        }

        logger.info('批量生成：调用 API', { jobId, index: item.index, model });

        const imageUrl = await generateImage({
          prompt: item.prompt,
          model,
          aspectRatio,
          imageSize,
          referenceImages: [],
        });

        // 保存到历史
        const record = await Generation.create({
          originalPrompt: item.prompt,
          apiPrompt: item.prompt,
          aspectRatio,
          imageSize,
          resultImageUrl: imageUrl,
          referenceImages: [],
          apiProvider: 'grsai',
          modelName: model,
          userId: null,
          pointsCost,
        });

        // 确认积分
        await confirmDeduct(deductResult.balance, pointsCost, `批量生成|模型:${model}`);

        await BatchJob.updateItem(jobId, item.index, {
          status: 'completed',
          resultImageUrl: imageUrl,
          recordId: record.id,
        });

        // 本地存档（不阻塞队列）
        saveImageLocal(imageUrl, {
          id: record.id,
          model,
          provider: 'grsai',
          prompt: item.prompt,
        });

        logger.info('批量生成：完成', { jobId, index: item.index });
      } catch (err) {
        logger.warn('批量生成：失败', { jobId, index: item.index, error: err.message });

        await BatchJob.updateItem(jobId, item.index, {
          status: 'failed',
          error: err.message,
        });
      }
    }

    // 所有条目处理完毕
    job = await BatchJob.findByPk(jobId);
    const hasQueued = job.items.some((x) => x.status === 'queued');

    if (!hasQueued && !queueCtx.abort) {
      await BatchJob.updateById(jobId, { status: 'completed' });
      logger.info('批量任务完成', { jobId, completed: job.completedCount, failed: job.failedCount });
    }
  } catch (err) {
    logger.error('批量任务异常', { jobId, error: err.message });
    await BatchJob.updateById(jobId, { status: 'failed' });
  } finally {
    activeQueues.delete(jobId);
  }
}

module.exports = {
  handleBatchUpload,
  handleBatchStart,
  handleBatchStatus,
  handleBatchDownload,
  handleBatchAbort,
  handleBatchRetry,
  handleBatchList,
};
