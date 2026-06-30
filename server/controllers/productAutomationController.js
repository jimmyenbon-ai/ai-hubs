const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const axios = require('axios');
const { ProductAutomationJob } = require('../models/productAutomationModel');
const productAutomationService = require('../services/productAutomationService');
const logger = require('../utils/logger');

const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

async function handleAnalyze(req, res, next) {
  try {
    const options = req.body || {};
    const result = await productAutomationService.analyzeProduct(options);
    res.status(result.success === false ? 400 : 200).json({ success: result.success !== false, data: result, message: result.message });
  } catch (err) {
    next(err);
  }
}

async function handleAnalyzeUpload(req, res, next) {
  let tmpPath = null;
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, message: '请选择产品资料文件。' });
    tmpPath = file.path || file.filepath;
    const text = await fs.readFile(tmpPath, 'utf8');
    res.json({ success: true, data: { text, fileName: file.originalname } });
  } catch (err) {
    next(err);
  } finally {
    if (tmpPath) {
      try { await fs.unlink(tmpPath); } catch (_) {}
    }
  }
}

async function handleUploadRefImage(req, res, next) {
  let tmpPath = null;
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, message: '请选择产品参考图。' });

    tmpPath = file.path || file.filepath;
    await fs.mkdir(uploadDir, { recursive: true });
    const destName = `product-ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname || '.png')}`;
    const destPath = path.join(uploadDir, destName);
    await fs.copyFile(tmpPath, destPath);
    const url = `/uploads/${destName}`;

    res.json({
      success: true,
      data: {
        url,
        name: file.originalname || destName,
        note: req.body?.note || '',
      },
    });
  } catch (err) {
    next(err);
  } finally {
    if (tmpPath) {
      try { await fs.unlink(tmpPath); } catch (_) {}
    }
  }
}

async function handleStart(req, res, next) {
  try {
    const {
      productName = '',
      productBrief = '',
      expertRole = 'ecommerce',
      commerceType = 'independent_site',
      visualStyle = 'premium_minimal',
      customStylePrompt = '',
      strategy = {},
      referenceImages = [],
      items = [],
      config = {},
    } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: '请先生成或手动添加产品图方案。' });
    }
    if (!Array.isArray(referenceImages) || referenceImages.length === 0) {
      return res.status(400).json({ success: false, message: '请至少上传一张产品参考图，避免产品外观跑偏。' });
    }

    const job = await ProductAutomationJob.create({
      productName,
      productBrief,
      expertRole,
      commerceType,
      visualStyle,
      customStylePrompt,
      strategy,
      referenceImages,
      items: items.map((item, index) => ProductAutomationJob.normalizeImageItem({
        ...item,
        status: item.includeInGeneration === false ? 'skipped' : 'pending',
        resultImageUrl: null,
        error: null,
        recordId: null,
      }, index)),
      config: {
        model: config.model || 'gpt-image-2',
        imageSize: config.imageSize || '1K',
        aspectRatio: config.aspectRatio || '16:9',
        qualityTags: config.qualityTags || 'commercial product photography, ecommerce detail image, high clarity, accurate product shape',
        imageCount: Number(config.imageCount) || items.length,
        includeText: config.includeText === true,
        language: config.language || 'zh-CN',
      },
      status: 'queued',
    });

    logger.info('[productAutomation] job created', { jobId: job.id, itemCount: job.totalItems });
    setImmediate(() => productAutomationService.processJob(job.id));
    res.json({ success: true, data: { jobId: job.id, totalItems: job.totalItems } });
  } catch (err) {
    next(err);
  }
}

async function handleStatus(req, res, next) {
  try {
    const job = await ProductAutomationJob.findByPk(Number(req.params.jobId));
    if (!job) return res.status(404).json({ success: false, message: '任务不存在。' });
    res.json({ success: true, data: job });
  } catch (err) {
    next(err);
  }
}

async function handleAbort(req, res, next) {
  try {
    const jobId = Number(req.params.jobId);
    const job = await ProductAutomationJob.findByPk(jobId);
    if (!job) return res.status(404).json({ success: false, message: '任务不存在。' });
    const q = productAutomationService.activeQueues.get(jobId);
    if (q) q.abort = true;
    await ProductAutomationJob.updateById(jobId, { status: 'failed', abortFlag: true });
    res.json({ success: true, message: '任务已中止。' });
  } catch (err) {
    next(err);
  }
}

async function handleList(req, res, next) {
  try {
    const list = await ProductAutomationJob.findAll({ order: 'desc', limit: 50 });
    res.json({ success: true, data: list });
  } catch (err) {
    next(err);
  }
}

async function handleDownload(req, res, next) {
  const tmpDir = path.join(os.tmpdir(), `product-automation-${Date.now()}`);
  try {
    const job = await ProductAutomationJob.findByPk(Number(req.params.jobId));
    if (!job) return res.status(404).json({ success: false, message: '任务不存在。' });
    await fs.mkdir(tmpDir, { recursive: true });

    const zip = new AdmZip();
    const manifest = {
      id: job.id,
      productName: job.productName,
      strategy: job.strategy,
      items: [],
    };

    for (const item of job.items) {
      manifest.items.push({
        imageNumber: item.imageNumber,
        title: item.title,
        imageType: item.imageType,
        prompt: item.generatedPrompt || item.prompt,
        resultImageUrl: item.resultImageUrl,
        status: item.status,
      });

      if (!item.resultImageUrl) continue;
      try {
        let buffer = null;
        if (item.resultImageUrl.startsWith('/local_storage/') || item.resultImageUrl.startsWith('/uploads/')) {
          const rel = item.resultImageUrl.replace(/^\/+/, '');
          const filePath = path.join(__dirname, '..', rel);
          buffer = await fs.readFile(filePath);
        } else if (/^https?:\/\//i.test(item.resultImageUrl)) {
          const resp = await axios.get(item.resultImageUrl, { responseType: 'arraybuffer', timeout: 60000 });
          buffer = Buffer.from(resp.data);
        }
        if (buffer) zip.addFile(`${String(item.imageNumber).padStart(2, '0')}-${item.title || 'product'}.jpg`, buffer);
      } catch (err) {
        logger.warn('[productAutomation] download image failed', { url: item.resultImageUrl, error: err.message });
      }
    }

    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
    const zipPath = path.join(tmpDir, `product-automation-${job.id}.zip`);
    zip.writeZip(zipPath);
    res.download(zipPath, `product-automation-${job.id}.zip`);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  handleAnalyze,
  handleAnalyzeUpload,
  handleUploadRefImage,
  handleStart,
  handleStatus,
  handleAbort,
  handleList,
  handleDownload,
};
