const express = require('express');
const multer = require('multer');
const os = require('os');
const path = require('path');
const { uploadLimiter } = require('../middleware/rateLimiter');
const {
  handleAnalyze,
  handleAnalyzeUpload,
  handleUploadRefImage,
  handleStart,
  handleStatus,
  handleAbort,
  handleList,
  handleDownload,
} = require('../controllers/productAutomationController');

const router = express.Router();
const tmpDir = os.tmpdir();

const docUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tmpDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '.txt');
      cb(null, `product-doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowed = ['.txt', '.md', '.csv', '.json'];
    if (!allowed.includes(ext)) {
      cb(new Error(`暂不支持 ${ext}，当前支持 ${allowed.join(', ')}`), false);
      return;
    }
    cb(null, true);
  },
});

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tmpDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '.png');
      cb(null, `product-ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('只支持图片文件'), false);
      return;
    }
    cb(null, true);
  },
});

router.post('/analyze', handleAnalyze);
router.post('/analyze-upload', docUpload.single('file'), handleAnalyzeUpload);
router.post('/upload-ref-image', uploadLimiter, imageUpload.single('file'), handleUploadRefImage);
router.post('/start', handleStart);
router.get('/status/:jobId', handleStatus);
router.post('/abort/:jobId', handleAbort);
router.get('/list', handleList);
router.get('/download/:jobId', handleDownload);

module.exports = router;
