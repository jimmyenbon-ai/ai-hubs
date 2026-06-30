const express = require('express');
const { PrevizProject } = require('../models/previzModel');

const router = express.Router();

router.get('/projects', async (req, res, next) => {
  try {
    const projects = await PrevizProject.findAll({ order: 'desc', limit: 50 });
    res.json({
      success: true,
      data: projects.map((project) => ({
        id: project.id,
        name: project.name,
        actorCount: project.actors.length,
        propCount: project.props.length,
        updatedAt: project.updatedAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/projects/:id', async (req, res, next) => {
  try {
    const project = await PrevizProject.findByPk(Number(req.params.id));
    if (!project) return res.status(404).json({ success: false, message: '项目不存在' });
    res.json({ success: true, data: project });
  } catch (err) {
    next(err);
  }
});

router.post('/projects', async (req, res, next) => {
  try {
    const { name, actors, props, cameras, timeline, config } = req.body || {};
    const project = await PrevizProject.create({
      name: name || '未命名项目',
      actors: actors || [],
      props: props || [],
      cameras: cameras || [],
      timeline: timeline || [],
      config: config || { aspectRatio: '16:9', fps: 24 },
    });
    res.json({ success: true, data: { id: project.id, name: project.name } });
  } catch (err) {
    next(err);
  }
});

router.put('/projects/:id', async (req, res, next) => {
  try {
    const existing = await PrevizProject.findByPk(Number(req.params.id));
    if (!existing) return res.status(404).json({ success: false, message: '项目不存在' });
    const updated = await PrevizProject.updateById(Number(req.params.id), req.body);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

router.delete('/projects/:id', async (req, res, next) => {
  try {
    const deleted = await PrevizProject.destroy(Number(req.params.id));
    if (!deleted) return res.status(404).json({ success: false, message: '项目不存在' });
    res.json({ success: true, message: '已删除' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
