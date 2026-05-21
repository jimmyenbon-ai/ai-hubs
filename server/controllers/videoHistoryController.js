const { VideoGeneration } = require('../models');

// GET /api/video/history - 获取视频生成历史
async function handleGetVideoHistory(req, res, next) {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const page = parseInt(req.query.page || '1', 10);

    // 检查缓存（如果没分页的话）
    const cacheKey = `video_history_list_${limit}`;
    if (page === 1 && !req.query.page) {
      const cache = require('../utils/cache');
      const cached = cache.get(cacheKey);
      if (cached) {
        return res.json({
          success: true,
          data: cached,
        });
      }
    }

    const list = await VideoGeneration.findAll({
      order: [['createdAt', 'DESC']],
      limit: limit,
    });

    // 缓存第一页结果
    if (page === 1 && !req.query.page) {
      const cache = require('../utils/cache');
      cache.set(cacheKey, list, 5 * 60 * 1000); // 5分钟缓存
    }

    res.json({
      success: true,
      data: list,
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/video/history/:id - 获取单条历史记录
async function handleGetVideoHistoryItem(req, res, next) {
  try {
    const { id } = req.params;
    const record = await VideoGeneration.findByPk(id);

    if (!record) {
      const err = new Error('记录不存在');
      err.status = 404;
      throw err;
    }

    res.json({
      success: true,
      data: record,
    });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/video/history/:id - 删除历史记录
async function handleDeleteVideoHistory(req, res, next) {
  try {
    const { id } = req.params;

    const record = await VideoGeneration.findByPk(id);
    if (!record) {
      const err = new Error('记录不存在');
      err.status = 404;
      throw err;
    }

    await VideoGeneration.destroy({ where: { id } });

    // 清除缓存
    const cache = require('../utils/cache');
    cache.delete('video_history_list_50');
    cache.delete('video_history_list_100');

    res.json({
      success: true,
      message: '删除成功',
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  handleGetVideoHistory,
  handleGetVideoHistoryItem,
  handleDeleteVideoHistory,
};
