const express = require('express');
const multer = require('multer');
const path = require('path');
const os = require('os');
const { uploadLimiter } = require('../middleware/rateLimiter');
const {
  handleBatchUpload,
  handleBatchStart,
  handleBatchStatus,
  handleBatchDownload,
  handleBatchAbort,
  handleBatchRetry,
  handleBatchList,
} = require('../controllers/batchController');

const router = express.Router();

// 文件上传临时目录
const tmpDir = os.tmpdir();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tmpDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '.txt');
    cb(null, `batch-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowed = ['.txt', '.md', '.csv', '.xlsx', '.xls'];
    if (!allowed.includes(ext)) {
      // pass the file through anyway, controller will validate and reject
      cb(null, true);
      return;
    }
    cb(null, true);
  },
});

router.post('/upload', uploadLimiter, upload.single('file'), handleBatchUpload);
router.post('/start', handleBatchStart);
router.get('/status/:jobId', handleBatchStatus);
router.get('/download/:jobId', handleBatchDownload);
router.post('/abort/:jobId', handleBatchAbort);
router.post('/retry/:jobId/:itemIndex', handleBatchRetry);
router.get('/list', handleBatchList);

module.exports = router;
