const express = require('express');
const upload = require('../middleware/uploadConfig');
const { handleUpload } = require('../controllers/uploadController');
const { uploadLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// 文件上传限流：每分钟10次
router.post('/', uploadLimiter, upload.array('files', 9), handleUpload);

module.exports = router;

