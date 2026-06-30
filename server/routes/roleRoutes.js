const express = require('express');
const router = express.Router();
const { Role } = require('../models/roleModel');
const { WorkflowTemplate } = require('../models/workflowModel');

// 获取所有岗位
router.get('/', async (req, res) => {
  try {
    const roles = await Role.findAll();
    res.json({ success: true, data: roles });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 获取单个岗位
router.get('/:id', async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) return res.status(404).json({ success: false, message: 'Role not found' });
    res.json({ success: true, data: role });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 创建岗位
router.post('/', async (req, res) => {
  try {
    const role = await Role.create(req.body);
    res.json({ success: true, data: role });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 更新岗位
router.put('/:id', async (req, res) => {
  try {
    const role = await Role.update(req.params.id, req.body);
    if (!role) return res.status(404).json({ success: false, message: 'Role not found' });
    res.json({ success: true, data: role });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 删除岗位
router.delete('/:id', async (req, res) => {
  try {
    const result = await Role.destroy(req.params.id);
    if (result === 0) return res.status(404).json({ success: false, message: 'Role not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 获取该岗位关联的工作流
router.get('/:id/workflows', async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) return res.status(404).json({ success: false, message: 'Role not found' });

    const allWorkflows = await WorkflowTemplate.findAll();
    // 通用模式返回全部，其他角色按 roleId 过滤
    let workflows;
    if (req.params.id === 'role-general') {
      workflows = allWorkflows;
    } else {
      workflows = allWorkflows.filter((w) => w.roleId === req.params.id || !w.roleId);
    }
    res.json({ success: true, data: workflows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
