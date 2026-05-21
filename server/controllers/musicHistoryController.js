const { MusicGeneration } = require('../models');
const cache = require('../utils/cache');

function clearMusicCache() {
  const keys = cache.keys ? cache.keys() : [];
  keys.forEach((k) => { if (k.startsWith('music_history')) cache.delete(k) });
  cache.delete('music_history_list_50');
  cache.delete('music_history_list_100');
}

// GET /api/music/history
// 支持: page, pageSize, dateFrom, dateTo, search
async function listMusicHistory(req, res, next) {
  try {
    const {
      page: qPage,
      pageSize: qPageSize,
      dateFrom,
      dateTo,
      search,
    } = req.query;

    const page = Math.max(1, parseInt(qPage, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(qPageSize, 10) || 20));

    let items = await MusicGeneration.findAll({
      order: [['createdAt', 'DESC']],
      attributes: [
        'id', 'title', 'model', 'make_instrumental', 'prompt',
        'gpt_description_prompt', 'task_ids', 'audioUrl', 'audioUrls', 'createdAt',
      ],
    });

    // 日期筛选
    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      items = items.filter(i => new Date(i.createdAt).getTime() >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo + 'T23:59:59.999').getTime();
      items = items.filter(i => new Date(i.createdAt).getTime() <= to);
    }
    // 关键词搜索
    if (search && search.trim()) {
      const kw = search.trim().toLowerCase();
      items = items.filter(i =>
        (i.prompt || '').toLowerCase().includes(kw) ||
        (i.title || '').toLowerCase().includes(kw) ||
        (i.model || '').toLowerCase().includes(kw)
      );
    }

    const total = items.length;
    const totalPages = Math.ceil(total / pageSize);
    const offset = (page - 1) * pageSize;
    const paged = items.slice(offset, offset + pageSize);

    res.json({
      success: true,
      data: paged,
      pagination: { page, pageSize, total, totalPages },
      cached: false,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/music/history/:id
async function getMusicHistoryById(req, res, next) {
  try {
    const { id } = req.params;
    const item = await MusicGeneration.findByPk(id);
    if (!item) {
      const err = new Error('记录不存在');
      err.status = 404;
      throw err;
    }
    res.json({ success: true, data: item });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/music/history/:id
async function deleteMusicHistory(req, res, next) {
  try {
    const { id } = req.params;
    const deleted = await MusicGeneration.destroy({ where: { id } });
    if (deleted === 0) {
      const err = new Error('记录不存在');
      err.status = 404;
      throw err;
    }
    clearMusicCache();
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listMusicHistory,
  getMusicHistoryById,
  deleteMusicHistory,
};
