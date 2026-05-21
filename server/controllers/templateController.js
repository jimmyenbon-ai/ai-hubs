// 模板 API 控制器
const { Template } = require('../models/templates');
const { ensurePublicImageUrl } = require('../utils/imageUtils');

async function listTemplates(req, res, next) {
  try {
    const { group } = req.query;
    const templates = await Template.findAll({ group });
    res.json({ success: true, data: templates });
  } catch (err) {
    next(err);
  }
}

async function getTemplate(req, res, next) {
  try {
    const { id } = req.params;
    const template = await Template.findById(id);
    if (!template) {
      return res.status(404).json({ success: false, message: '模板不存在' });
    }
    res.json({ success: true, data: template });
  } catch (err) {
    next(err);
  }
}

async function createTemplate(req, res, next) {
  try {
    const template = await Template.create(req.body);
    res.status(201).json({ success: true, data: template });
  } catch (err) {
    next(err);
  }
}

async function updateTemplate(req, res, next) {
  try {
    const { id } = req.params;
    const template = await Template.update(id, req.body);
    if (!template) {
      return res.status(404).json({ success: false, message: '模板不存在' });
    }
    res.json({ success: true, data: template });
  } catch (err) {
    next(err);
  }
}

async function deleteTemplate(req, res, next) {
  try {
    const { id } = req.params;
    const ok = await Template.delete(id);
    if (!ok) {
      return res.status(404).json({ success: false, message: '模板不存在' });
    }
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    next(err);
  }
}

// 模板模型积分消耗映射（可按需配置）
const MODEL_POINTS = {
  'gpt-image-2': 2,
  'gpt-image-2-vip': 5,
  'nano-banana-pro': 1,
  'nano-banana': 1,
  'nano-banana-fast': 1,
  'nano-banana-2': 2,
  'nano-banana-2-cl': 2,
  'nano-banana-2-4k-cl': 4,
  'nano-banana-pro-vt': 2,
  'nano-banana-pro-cl': 2,
  'nano-banana-pro-vip': 2,
  'nano-banana-pro-4k-vip': 4,
}

// 使用模板生成图片（复用 /api/generate 的逻辑，但替换提示词和参数）
async function generateFromTemplate(req, res, next) {
  let beforeBalance = null // 用于积分确认
  let pointsCost = 1

  try {
    const { templateId, variables } = req.body;
    if (!templateId) {
      return res.status(400).json({ success: false, message: '缺少 templateId' });
    }

    const template = await Template.findById(templateId);
    if (!template) {
      return res.status(404).json({ success: false, message: '模板不存在' });
    }

    pointsCost = template.pointsCost || MODEL_POINTS[template.model] || 1

    // Canvas 类型模板跳过 AI 生成，由前端自行渲染
    if (template.renderType === 'canvas') {
      return res.json({
        success: true,
        message: 'Canvas 模板，生成在前端完成',
        data: { renderType: 'canvas', pointsCost: 0 },
      })
    }

    // 积分扣减（仅 AI 模板）
    const { deductPoints, confirmDeduct } = require('../utils/pointsService')
    const deductResult = await deductPoints(pointsCost, `模板生成|模板:${template.name}|模型:${template.model}`)
    if (!deductResult.success) {
      return res.status(402).json({ success: false, message: deductResult.message });
    }
    beforeBalance = deductResult.balance // 保存余额用于后续确认

    // 合并模板预设的参考图 + 额外固定参考图 + 模板底图
    const presetRefImages = Array.isArray(template.referenceImages) ? template.referenceImages : [];
    let extraRefImages = [];
    if (req.body.fixedReferenceImages) {
      try {
        extraRefImages = JSON.parse(req.body.fixedReferenceImages);
      } catch (_) {}
    }

    // 模板底图（如果配置了 templateImage，放在参考图列表最前面作为底图）
    const allRefImages = [];
    if (template.templateImage) {
      allRefImages.push(template.templateImage);
    }
    allRefImages.push(...presetRefImages, ...extraRefImages);

    // 处理用户上传的变量图片
    const uploadedImages = {}; // { key: url }
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const key = file.fieldname; // fieldname 就是变量 key
        const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${file.filename}`;
        uploadedImages[key] = fileUrl;
      }
    }

    // 替换提示词变量
    let apiPrompt = template.promptTemplate || '';
    if (variables && typeof variables === 'object') {
      for (const [key, value] of Object.entries(variables)) {
        if (typeof value === 'string') {
          // 重置正则 lastIndex 避免匹配问题
          const varRegex = new RegExp(`\\{${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g')
          apiPrompt = apiPrompt.replace(varRegex, value);
        }
        // 如果变量值是图片URL，追加到参考图列表
        if (uploadedImages[key]) {
          allRefImages.push(uploadedImages[key]);
        }
      }
    }

    // 追加固定参考图提示词（当有模板底图或参考图时，强调保留设计布局）
    if (allRefImages.length > 0) {
      apiPrompt += '\n\n[IMPORTANT - Reference Image Instruction]\nYou MUST use the first reference image as the ONLY visual template/base design. Strictly follow its layout, composition, color palette, design style, typography, and all decorative elements. Only replace: personal names, portrait photos, phone numbers, department names, job titles, and contact information. DO NOT alter any other design elements, decorative patterns, layout structure, background, or brand visuals from the template.';
    }

    // 将所有参考图转为公网可访问地址
    const resolvedRefImages = [];
    for (const imgUrl of allRefImages) {
      try {
        const publicUrl = await ensurePublicImageUrl(imgUrl);
        resolvedRefImages.push(publicUrl);
      } catch (_) {
        resolvedRefImages.push(imgUrl);
      }
    }

    // 调用生成
    const { generateImage } = require('../utils/grsaiClient');
    const result = await generateImage({
      prompt: apiPrompt,
      model: template.model || 'gpt-image-2',
      imageSize: template.imageSize || '1K',
      aspectRatio: template.aspectRatio || 'auto',
      referenceImages: resolvedRefImages,
    });

    // 生成成功：确认积分消耗
    await confirmDeduct(beforeBalance, pointsCost, `模板生成|模板:${template.name}|模型:${template.model}`)

    // 保存到历史记录
    const { Generation } = require('../models');
    await Generation.create({
      originalPrompt: apiPrompt,
      apiPrompt,
      modelName: template.model || 'gpt-image-2',
      aspectRatio: template.aspectRatio,
      imageSize: template.imageSize,
      resultImageUrl: result.imageUrl,
      referenceImages: resolvedRefImages,
      templateId,
      templateName: template.name,
      pointsCost,
    });

    const cache = require('../utils/cache');
    const allKeys = cache.keys ? cache.keys() : []
    allKeys.forEach((k) => { if (k.startsWith('history_list')) cache.delete(k) })

    res.json({
      success: true,
      message: `生成成功，余额充足`,
      data: {
        ...result,
        pointsCost,
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  generateFromTemplate,
};
