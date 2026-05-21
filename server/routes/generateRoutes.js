const express = require('express');
const { handleGenerate } = require('../controllers/generateController');
const { generateLimiter } = require('../middleware/rateLimiter');
const { GPT_ASPECT_RATIOS, SUPPORTED_NANO_MODELS } = require('../utils/grsaiClient');

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
      models: [
        {
          id: 'gpt-image-2',
          name: 'GPT-Image 2',
          description: 'ChatGPT 最新绘图模型，支持比例',
          points: 2,
          aspectRatios: GPT_ASPECT_RATIOS,
          supportsImageSize: false,
        },
        {
          id: 'gpt-image-2-vip',
          name: 'GPT-Image 2 VIP',
          description: '支持 1K/2K/4K 分辨率',
          points: 5,
          aspectRatios: GPT_ASPECT_RATIOS,
          supportsImageSize: true,
          imageSizes: NANO_IMAGE_SIZES,
        },
        ...SUPPORTED_NANO_MODELS.map(m => ({
          id: m,
          name: m,
          description: '基础绘图模型',
          aspectRatios: NANO_ASPECT_RATIOS,
          supportsImageSize: true,
          imageSizes: NANO_IMAGE_SIZES,
        })),
      ],
    },
  });
});

module.exports = router;

