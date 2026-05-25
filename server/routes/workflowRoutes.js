const express = require('express');
const router = express.Router();
const { WorkflowExecutor } = require('../services/workflowExecutor');
const { WorkflowTemplate, WorkflowRun } = require('../models/workflowModel');

// 获取所有工作流模板
router.get('/templates', async (req, res) => {
  try {
    const where = {};
    if (req.query.roleId) where.roleId = req.query.roleId;
    if (req.query.category) where.category = req.query.category;
    const templates = await WorkflowTemplate.findAll({ where });
    res.json({ success: true, data: templates });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 获取单个模板
router.get('/templates/:id', async (req, res) => {
  try {
    const template = await WorkflowTemplate.findByPk(req.params.id);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }
    res.json({ success: true, data: template });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 创建工作流模板
router.post('/templates', async (req, res) => {
  try {
    const { name, description, category, nodes, edges, variables } = req.body;
    const template = await WorkflowTemplate.create({
      name: name || '未命名工作流',
      description: description || '',
      category: category || 'general',
      nodes: nodes || [],
      edges: edges || [],
      variables: variables || [],
    });
    res.json({ success: true, data: template });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 更新工作流模板
router.put('/templates/:id', async (req, res) => {
  try {
    const { name, description, category, nodes, edges, variables } = req.body;
    const template = await WorkflowTemplate.update(req.params.id, {
      name,
      description,
      category,
      nodes,
      edges,
      variables,
    });
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }
    res.json({ success: true, data: template });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 删除工作流模板
router.delete('/templates/:id', async (req, res) => {
  try {
    const template = await WorkflowTemplate.findByPk(req.params.id);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }
    if (template.isPreset) {
      return res.status(403).json({ success: false, message: '预设工作流不可删除，请先复制副本再修改' });
    }
    const result = await WorkflowTemplate.destroy(req.params.id);
    if (result === 0) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 复制工作流模板（用于复制预设工作流）
router.post('/templates/:id/clone', async (req, res) => {
  try {
    const source = await WorkflowTemplate.findByPk(req.params.id);
    if (!source) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }
    const clone = await WorkflowTemplate.create({
      name: req.body.name || `${source.name} (副本)`,
      description: source.description,
      category: source.category,
      nodes: source.nodes,
      edges: source.edges,
      variables: source.variables,
      roleId: source.roleId,
      isPreset: false,
      tags: [...(source.tags || [])],
    });
    res.json({ success: true, data: clone });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 执行工作流
router.post('/run', async (req, res) => {
  try {
    const { templateId, inputs } = req.body;

    if (!templateId) {
      return res.status(400).json({ success: false, message: 'templateId is required' });
    }

    // 异步执行，不阻塞响应
    new WorkflowExecutor().execute(templateId, inputs || {}).catch(err => {
      console.error('[Workflow] Execute error:', err);
    });

    res.json({ success: true, message: 'Workflow started' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 执行工作流（同步，等待完成）
router.post('/run/sync', async (req, res) => {
  try {
    const { templateId, inputs } = req.body;

    if (!templateId) {
      return res.status(400).json({ success: false, message: 'templateId is required' });
    }

    const result = await new WorkflowExecutor().execute(templateId, inputs || {});

    if (result.success) {
      res.json({ success: true, data: result });
    } else {
      res.status(500).json({ success: false, message: result.error, data: result });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 获取执行记录
router.get('/runs', async (req, res) => {
  try {
    const runs = await WorkflowRun.findAll({ limit: 50 });
    res.json({ success: true, data: runs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 获取单个执行记录
router.get('/runs/:id', async (req, res) => {
  try {
    const run = await WorkflowRun.findByPk(req.params.id);
    if (!run) {
      return res.status(404).json({ success: false, message: 'Run not found' });
    }
    res.json({ success: true, data: run });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 获取执行状态（轮询用）
router.get('/runs/:id/status', async (req, res) => {
  try {
    const run = await WorkflowRun.findByPk(req.params.id);
    if (!run) {
      return res.status(404).json({ success: false, message: 'Run not found' });
    }
    res.json({ success: true, data: { status: run.status, steps: run.steps } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
