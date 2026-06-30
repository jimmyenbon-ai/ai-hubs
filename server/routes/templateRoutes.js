const express = require('express');
const multer = require('multer');
const path = require('path');
const router = express.Router();
const {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  generateFromTemplate,
} = require('../controllers/templateController');

// Multer：支持多个变量图片字段（fieldname = 变量 key）
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, process.env.UPLOAD_DIR || 'uploads');
  },
  filename: (req, file, cb) => {
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 7);
    const name = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_').replace(/\.[^.]+$/, '');
    cb(null, `${ts}-${rand}-${name}${path.extname(file.originalname)}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

// GET  /api/templates          - 模板列表
router.get('/', listTemplates);
// GET  /api/templates/:id       - 模板详情
router.get('/:id', getTemplate);
// POST /api/templates            - 新建模板
router.post('/', upload.any(), createTemplate);
// PUT  /api/templates/:id        - 更新模板（内核提示词、参数等）
router.put('/:id', upload.any(), updateTemplate);
// DELETE /api/templates/:id      - 删除模板
router.delete('/:id', deleteTemplate);

// POST /api/templates/generate  - 使用模板生成
// 支持多个变量图片字段，fieldname 即变量 key
router.post('/generate', upload.any(), generateFromTemplate);

module.exports = router;
