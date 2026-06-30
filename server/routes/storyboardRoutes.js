/**
 * StoryboardRoutes — AI视频自动化 API 路由
 */

const express = require('express');
const multer = require('multer');
const os = require('os');
const path = require('path');
const { uploadLimiter } = require('../middleware/rateLimiter');
const {
  handleAnalyze,
  handleAnalyzeAssets,
  handleAnalyzeUpload,
  handleStart,
  handleStatus,
  handleAbort,
  handleRetry,
  handleUploadRefImage,
  handleList,
  handleDownload,
} = require('../controllers/storyboardController');

const router = express.Router();
const tmpDir = os.tmpdir();

// Script 文件上传 (txt/md)
const scriptUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tmpDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '.txt');
      cb(null, `storyboard-script-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const allowedExts = ['.txt', '.md'];
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!allowedExts.includes(ext)) {
      cb(new Error(`不支持的文件格式: ${ext}，支持: ${allowedExts.join(', ')}`), false);
      return;
    }
    cb(null, true);
  },
});

// 参考图上传 (图片)
const refImageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tmpDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '.png');
      cb(null, `storyboard-ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('只支持图片文件'), false);
      return;
    }
    cb(null, true);
  },
});

// 分镜分析 (手动输入文本)
router.post('/analyze', handleAnalyze);
router.post('/assets', handleAnalyzeAssets);

// 分镜分析 (上传文件)
router.post('/analyze-upload', scriptUpload.single('file'), handleAnalyzeUpload);

// 开始关键帧生成
router.post('/start', handleStart);

// 查询任务状态
router.get('/status/:jobId', handleStatus);

// 中止任务
router.post('/abort/:jobId', handleAbort);

// 重试单个分镜
router.post('/retry/:jobId/:shotNumber', handleRetry);

// 上传参考图
router.post('/upload-ref-image', uploadLimiter, refImageUpload.single('file'), handleUploadRefImage);

// 历史任务列表
router.get('/list', handleList);

// 下载结果
router.get('/download/:jobId', handleDownload);

module.exports = router;
