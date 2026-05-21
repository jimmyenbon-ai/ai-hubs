const { PromptTemplate } = require('../models/promptTemplateModel');

// 获取模板列表
async function listTemplates(req, res) {
  try {
    const { contentType, category, search } = req.query;
    const list = await PromptTemplate.findAll({
      contentType: contentType || undefined,
      category: category || undefined,
      search: search || undefined,
    });
    res.json({ success: true, data: list });
  } catch (err) {
    console.error('[promptTemplateController] listTemplates error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// 获取单个模板
async function getTemplate(req, res) {
  try {
    const { id } = req.params;
    const tpl = await PromptTemplate.findById(id);
    if (!tpl) return res.status(404).json({ success: false, message: '模板不存在' });
    res.json({ success: true, data: tpl });
  } catch (err) {
    console.error('[promptTemplateController] getTemplate error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// 新建模板
async function createTemplate(req, res) {
  try {
    const { name, contentType, category, tags, coverImage, prompt, model, aspectRatio, imageSize, pointsCost } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: '模板名称不能为空' });
    }
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ success: false, message: '提示词不能为空' });
    }
    const record = await PromptTemplate.create({
      name: name.trim(),
      contentType: contentType || 'image',
      category: category || '',
      tags: Array.isArray(tags) ? tags : [],
      coverImage: coverImage || '',
      prompt: prompt.trim(),
      model: model || 'gpt-image-2',
      aspectRatio: aspectRatio || 'auto',
      imageSize: imageSize || '1K',
      pointsCost: typeof pointsCost === 'number' ? pointsCost : 1,
    });
    res.json({ success: true, data: record });
  } catch (err) {
    console.error('[promptTemplateController] createTemplate error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// 更新模板
async function updateTemplate(req, res) {
  try {
    const { id } = req.params;
    const existing = await PromptTemplate.findById(id);
    if (!existing) return res.status(404).json({ success: false, message: '模板不存在' });
    const patch = {};
    const allowed = ['name', 'contentType', 'category', 'tags', 'coverImage', 'prompt', 'model', 'aspectRatio', 'imageSize', 'pointsCost'];
    allowed.forEach((k) => {
      if (req.body[k] !== undefined) patch[k] = req.body[k];
    });
    if (patch.name !== undefined && !patch.name.trim()) {
      return res.status(400).json({ success: false, message: '模板名称不能为空' });
    }
    if (patch.prompt !== undefined && !patch.prompt.trim()) {
      return res.status(400).json({ success: false, message: '提示词不能为空' });
    }
    if (patch.tags !== undefined && !Array.isArray(patch.tags)) {
      patch.tags = [];
    }
    const updated = await PromptTemplate.update(id, patch);
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('[promptTemplateController] updateTemplate error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// 删除模板
async function deleteTemplate(req, res) {
  try {
    const { id } = req.params;
    const existing = await PromptTemplate.findById(id);
    if (!existing) return res.status(404).json({ success: false, message: '模板不存在' });
    await PromptTemplate.delete(id);
    res.json({ success: true, data: true });
  } catch (err) {
    console.error('[promptTemplateController] deleteTemplate error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// 获取分类列表
async function getCategories(req, res) {
  try {
    const { contentType } = req.query;
    const cats = await PromptTemplate.getCategories(contentType || undefined);
    res.json({ success: true, data: cats });
  } catch (err) {
    console.error('[promptTemplateController] getCategories error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getCategories,
};
