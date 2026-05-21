const { Generation } = require('../models')
const cache = require('../utils/cache');

// 统一的历史列表缓存键（只缓存 limit=50 的大列表，减少缓存碎片）
const HISTORY_CACHE_KEY = 'history_list';

function clearHistoryCache() {
  // 清除所有以 history_list_ 开头的缓存键
  const keys = cache.keys ? cache.keys() : [];
  keys.forEach((k) => {
    if (k.startsWith('history_list')) cache.delete(k);
  });
  // 兜底：清除已知键
  cache.delete('history_list');
  cache.delete('history_list_50');
  cache.delete('history_list_100');
  cache.delete('history_list_200');
}

// GET /api/history
async function listHistory(req, res, next) {
  try {
    const { limit: qLimit = 50, templateId, favorite } = req.query
    const limit = Number(qLimit) || 50

    // 按模板筛选或不缓存时不使用缓存（每次都要最新）
    const cacheKey = templateId || favorite ? null : `${HISTORY_CACHE_KEY}_${limit}`
    if (cacheKey) {
      const cachedItems = cache.get(cacheKey)
      if (cachedItems !== null) {
        return res.json({ success: true, data: cachedItems, cached: true })
      }
    }

    const findOptions = {
      order: [['createdAt', 'DESC']],
      limit,
      attributes: ['id', 'originalPrompt', 'imageSize', 'aspectRatio', 'resultImageUrl', 'createdAt', 'modelName', 'templateId', 'templateName', 'favorite'],
    }

    if (templateId) {
      findOptions.where = { templateId }
    }

    // 支持按收藏状态筛选
    if (favorite === 'true') {
      findOptions.where = findOptions.where || {}
      findOptions.where.favorite = true
    }

    const items = await Generation.findAll(findOptions)

    if (cacheKey) cache.set(cacheKey, items, 60000)

    res.json({ success: true, data: items, cached: false })
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

    res.json({
      success: true,
      data: item,
    });
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

    clearHistoryCache()

    res.json({
      success: true,
      message: '删除成功',
    });
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

    // 切换收藏状态
    const newFavorite = !item.favorite;
    const updated = await Generation.updateById(id, { favorite: newFavorite });

    res.json({
      success: true,
      data: { id: Number(id), favorite: newFavorite },
    });
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

