const { Generation } = require('../models')
const cache = require('../utils/cache');

function clearHistoryCache() {
  const keys = cache.keys ? cache.keys() : [];
  keys.forEach((k) => {
    if (k.startsWith('history_list')) cache.delete(k);
  });
  cache.delete('history_list');
  cache.delete('history_list_50');
  cache.delete('history_list_100');
  cache.delete('history_list_200');
}

// GET /api/history
// 支持: page, pageSize, dateFrom, dateTo, search, templateId, favorite
async function listHistory(req, res, next) {
  try {
    const {
      page: qPage,
      pageSize: qPageSize,
      dateFrom,
      dateTo,
      search,
      templateId,
      favorite,
    } = req.query;

    const page = Math.max(1, parseInt(qPage, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(qPageSize, 10) || 20));

    // 无条件查询时使用缓存
    const useCache = !templateId && !favorite && !dateFrom && !dateTo && !search && page === 1;
    const cacheKey = useCache ? `history_list_p${page}_ps${pageSize}` : null;
    if (cacheKey) {
      const cached = cache.get(cacheKey);
      if (cached !== null) return res.json({ success: true, ...cached, cached: true });
    }

    // 拉取全量数据（内存数据库，无需担心性能）
    let items = await Generation.findAll({
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'originalPrompt', 'imageSize', 'aspectRatio', 'resultImageUrl', 'createdAt', 'modelName', 'templateId', 'templateName', 'favorite'],
    });

    // 筛选
    if (templateId) {
      items = items.filter(i => String(i.templateId || '') === String(templateId));
    }
    if (favorite === 'true') {
      items = items.filter(i => i.favorite === true);
    }
    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      items = items.filter(i => new Date(i.createdAt).getTime() >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo + 'T23:59:59.999').getTime();
      items = items.filter(i => new Date(i.createdAt).getTime() <= to);
    }
    if (search && search.trim()) {
      const kw = search.trim().toLowerCase();
      items = items.filter(i =>
        (i.originalPrompt || '').toLowerCase().includes(kw) ||
        (i.modelName || '').toLowerCase().includes(kw) ||
        (i.templateName || '').toLowerCase().includes(kw)
      );
    }

    const total = items.length;
    const totalPages = Math.ceil(total / pageSize);
    const offset = (page - 1) * pageSize;
    const paged = items.slice(offset, offset + pageSize);

    const result = {
      data: paged,
      pagination: { page, pageSize, total, totalPages },
    };

    if (cacheKey) cache.set(cacheKey, result, 30000);

    res.json({ success: true, ...result, cached: false });
  } catch (err) {
    next(err);
  }
}

// GET /api/history/:id
async function getHistoryById(req, res, next) {
  try {
    const { id } = req.params;
    const item = await Generation.findByPk(id);
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

// DELETE /api/history/:id
async function deleteHistory(req, res, next) {
  try {
    const { id } = req.params;
    const deleted = await Generation.destroy({ where: { id } });
    if (deleted === 0) {
      const err = new Error('记录不存在');
      err.status = 404;
      throw err;
    }
    clearHistoryCache();
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/history/:id/favorite - 切换收藏状态
async function toggleFavorite(req, res, next) {
  try {
    const { id } = req.params;
    const item = await Generation.findByPk(id);
    if (!item) {
      const err = new Error('记录不存在');
      err.status = 404;
      throw err;
    }
    const newFavorite = !item.favorite;
    await Generation.updateById(id, { favorite: newFavorite });
    res.json({ success: true, data: { id: Number(id), favorite: newFavorite } });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listHistory,
  getHistoryById,
  deleteHistory,
  toggleFavorite,
};
