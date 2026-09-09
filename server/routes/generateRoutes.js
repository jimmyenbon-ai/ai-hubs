const express = require('express');
const { handleGenerate } = require('../controllers/generateController');
const { generateLimiter } = require('../middleware/rateLimiter');
const { GPT_ASPECT_RATIOS } = require('../utils/grsaiClient');
const { ALL_IMAGE_MODELS, IMAGE_MODEL_POINTS } = require('../config/imageModels');

// Nano Banana 专用的 aspectRatio 和 imageSize
const NANO_ASPECT_RATIOS = [
  { value: 'auto', label: '自动' },
  { value: '1:1', label: '1:1 方形' },
  { value: '16:9', label: '16:9 横版' },
  { value: '9:16', label: '9:16 竖版' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4 竖版' },
  { value: '3:2', label: '3:2 横版' },
  { value: '2:3', label: '2:3 竖版' },
  { value: '5:4', label: '5:4' },
  { value: '4:5', label: '4:5 竖版' },
  { value: '21:9', label: '21:9 宽屏' },
  { value: '1:4', label: '1:4 超竖' },
  { value: '4:1', label: '4:1 超横' },
  { value: '1:8', label: '1:8 极竖' },
  { value: '8:1', label: '8:1 极横' },
]

const NANO_IMAGE_SIZES = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
]

const router = express.Router();

// POST /api/generate - 创建图片生成任务
router.post('/', generateLimiter, handleGenerate);

// GET /api/generate/config - 获取图片生成配置
router.get('/config', (req, res) => {
  res.json({
    success: true,
    data: {
      models: ALL_IMAGE_MODELS.map((model) => ({
        id: model.value,
        name: model.label,
        description: model.category === 'gpt'
          ? (model.supportsImageSize ? '支持 1K/2K/4K 分辨率' : '支持常用画幅比例')
          : 'Nano Banana 绘图模型',
        points: IMAGE_MODEL_POINTS[model.value],
        aspectRatios: model.category === 'gpt' ? GPT_ASPECT_RATIOS : NANO_ASPECT_RATIOS,
        supportsImageSize: model.supportsImageSize,
        imageSizes: model.supportsImageSize ? NANO_IMAGE_SIZES : undefined,
      })),
    },
  });
});

module.exports = router;
