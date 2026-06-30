const express = require('express');
const router = express.Router();
const { KnowledgeBase } = require('../models/workflowModel');
const path = require('path');
const fs = require('fs').promises;
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const pdfParse = require('pdf-parse');

// ========== 文件存储配置 ==========
const uploadDir = path.join(__dirname, '..', 'uploads', 'knowledge');
let storageInitialized = false;

async function ensureUploadDir() {
  if (storageInitialized) return;
  try {
    await fs.mkdir(uploadDir, { recursive: true });
    storageInitialized = true;
  } catch (e) { /* ignore */ }
}

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await ensureUploadDir();
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const originalName = fixFileName(file.originalname);
    const ext = path.extname(originalName).toLowerCase();
    const base = path.basename(originalName, ext);
    const safe = base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').substring(0, 120) || 'file';
    const shortId = uuidv4().substring(0, 8);
    cb(null, `${safe}_${shortId}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.txt', '.md', '.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
    const originalName = fixFileName(file.originalname);
    const ext = path.extname(originalName).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('不支持的文件格式: ' + ext));
    }
  }
});

// ========== 辅助函数 ==========

// multer 默认用 latin1 解析文件名，中文等非 ASCII 字符会乱码
function fixFileName(name) {
  return Buffer.from(name, 'latin1').toString('utf8');
}

// 判断是否为图片
function isImage(ext) {
  return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext);
}

// 判断是否为文档（需要文本提取）
function isDocument(ext) {
  return ['.txt', '.md', '.pdf', '.doc', '.docx'].includes(ext);
}

// 解析 PDF（使用 pdf-parse）
async function parsePDF(buffer) {
  try {
    const data = await pdfParse(buffer);
    const text = (data.text || '').trim();
    if (!text) {
      return null; // 空内容
    }
    // 清理多余空白
    return text.replace(/\s+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  } catch (err) {
    console.error('[PDF解析] 失败:', err.message);
    return null;
  }
}

// 解析 Word 文档
async function parseWord(buffer, ext) {
  try {
    if (ext === '.docx') {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(buffer);
      const xmlContent = zip.readAsText('word/document.xml');
      if (!xmlContent) return null;

      // 提取纯文本
      const text = xmlContent
        .replace(/<[^>]+>/g, ' ')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      return text.length > 10 ? text : null;
    }

    if (ext === '.doc') {
      // .doc 是二进制格式，尝试用 strings 提取文本片段
      const text = buffer.toString('latin1');
      const lines = [];
      const re = /[a-zA-Z]{4,}[a-zA-Z0-9 ,.:;!?\-]{0,50}/g;
      let match;
      while ((match = re.exec(text)) !== null) {
        const line = match[0].trim();
        if (line.length > 15) lines.push(line);
      }
      return lines.slice(0, 200).join(' ') || null;
    }

    return null;
  } catch (err) {
    console.error('[Word解析] 失败:', err.message);
    return null;
  }
}

// ========== 路由 ==========

// 文件上传处理（支持多文件 + 文件夹）
router.post('/upload', upload.array('files', 10), async (req, res) => {
  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ success: false, message: '没有上传文件' });
    }

    const folder = req.body.folder || req.query.folder || '';
    const category = req.body.category || folder.split('/')[0] || 'general';

    const results = [];

    for (const file of files) {
      const originalName = fixFileName(file.originalname);
      const ext = path.extname(originalName).toLowerCase();
      const title = path.basename(originalName, ext).replace(/[_-]+/g, ' ').trim();
      let content = '';
      let fileUrl = null;
      let type = 'text';

      if (isImage(ext)) {
        // 图片：保存文件，返回 URL
        type = 'image';
        fileUrl = `/uploads/knowledge/${file.filename}`;
        content = `【图片】${title}。文件: ${originalName}，大小: ${(file.size / 1024).toFixed(1)} KB`;
      } else if (isDocument(ext)) {
        // 文档：尝试提取文本
        type = 'text';
        fileUrl = `/uploads/knowledge/${file.filename}`;

        // diskStorage 不提供 file.buffer，从磁盘读取
        const fileBuffer = await fs.readFile(file.path);
        if (ext === '.txt' || ext === '.md') {
          content = fileBuffer.toString('utf-8');
        } else if (ext === '.pdf') {
          content = await parsePDF(fileBuffer) || `【PDF】${title}。文件已上传，请确认内容是否提取成功。`;
        } else {
          content = await parseWord(fileBuffer, ext) || `【文档】${title}。文件已上传 (${ext})，请确认内容是否提取成功。`;
        }

        if (content.length > 15000) {
          content = content.substring(0, 15000) + '\n\n... (内容过长已截断)';
        }
      } else {
        // 其他文件
        content = `【附件】${title}。文件名: ${originalName}，大小: ${(file.size / 1024).toFixed(1)} KB`;
      }

      // 保存到数据库
      const record = await KnowledgeBase.create({
        category,
        folder: folder || category,
        title,
        originalName,
        content: content.trim(),
        fileUrl,
        type,
        metadata: {
          fileSize: file.size,
          extension: ext,
          uploadedAt: new Date().toISOString(),
        },
      });

      results.push({
        id: record.id,
        title,
        content: content.trim(),
        fileUrl,
        type,
        originalName,
        fileSize: file.size,
        folder: record.folder,
      });
    }

    res.json({
      success: true,
      data: results,
      message: `成功处理 ${results.length} 个文件`,
    });

  } catch (err) {
    console.error('[知识库上传] 失败:', err);
    res.status(500).json({ success: false, message: '文件处理失败: ' + err.message });
  }
});

// 获取所有文件夹
router.get('/folders', async (req, res) => {
  try {
    const folders = await KnowledgeBase.listFolders();
    res.json({ success: true, data: folders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 批量移动知识条目到文件夹
router.post('/move', async (req, res) => {
  try {
    const { ids, folder } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: '请提供要移动的知识条目ID列表' });
    }
    const count = await KnowledgeBase.moveToFolder(ids, folder || '');
    res.json({ success: true, data: { count }, message: `成功移动 ${count} 条知识到 ${folder || '根目录'}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 批量删除知识条目
router.post('/batch-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: '请提供要删除的知识条目ID列表' });
    }
    const count = await KnowledgeBase.destroyMany(ids);
    res.json({ success: true, data: { count }, message: `成功删除 ${count} 条知识` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 获取所有知识（支持文件夹过滤）
router.get('/', async (req, res) => {
  try {
    const { category, folder, query, limit } = req.query;
    const items = await KnowledgeBase.findAll({
      where: { category, folder, query },
      limit: limit ? parseInt(limit) : undefined,
    });
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 获取单个知识
router.get('/:id', async (req, res) => {
  try {
    const item = await KnowledgeBase.findByPk(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 创建知识
router.post('/', async (req, res) => {
  try {
    const { category, folder, title, originalName, content, metadata, fileUrl, type } = req.body;

    if (!title || !content) {
      return res.status(400).json({ success: false, message: '标题和内容不能为空' });
    }

    const item = await KnowledgeBase.create({
      category: category || 'other',
      folder: folder || category || 'other',
      title,
      originalName: originalName || title,
      content,
      metadata: metadata || {},
      fileUrl: fileUrl || null,
      type: type || 'text',
    });

    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 更新知识
router.put('/:id', async (req, res) => {
  try {
    const { category, folder, title, originalName, content, metadata, fileUrl, type } = req.body;

    const item = await KnowledgeBase.update(req.params.id, {
      category,
      folder,
      title,
      originalName,
      content,
      metadata,
      fileUrl: fileUrl || null,
      type: type || 'text',
    });

    if (!item) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 删除知识
router.delete('/:id', async (req, res) => {
  try {
    const result = await KnowledgeBase.destroy(req.params.id);
    if (result === 0) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ========== 临时图片上传（工作流参考图用，不存入知识库） ==========
const tempUploadDir = path.join(__dirname, '..', 'uploads', 'temp');
let tempDirReady = false;

const tempStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    if (!tempDirReady) {
      await fs.mkdir(tempUploadDir, { recursive: true });
      tempDirReady = true;
    }
    cb(null, tempUploadDir);
  },
  filename: (req, file, cb) => {
    const originalName = fixFileName(file.originalname);
    const ext = path.extname(originalName).toLowerCase();
    const shortId = uuidv4().substring(0, 8);
    cb(null, `ref_${Date.now()}_${shortId}${ext}`);
  }
});

const tempUpload = multer({
  storage: tempStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
    const ext = path.extname(fixFileName(file.originalname)).toLowerCase();
    allowed.includes(ext) ? cb(null, true) : cb(new Error('仅支持图片格式'));
  }
});

router.post('/temp-upload', tempUpload.array('images', 9), async (req, res) => {
  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ success: false, message: '没有上传文件' });
    }
    const results = files.map(f => ({
      url: `/uploads/temp/${f.filename}`,
      name: fixFileName(f.originalname),
      size: f.size,
    }));
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
