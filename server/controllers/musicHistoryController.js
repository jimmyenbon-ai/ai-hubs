const { MusicGeneration } = require('../models');
const cache = require('../utils/cache');

// GET /api/music/history
async function listMusicHistory(req, res, next) {
  try {
    const limit = Number(req.query.limit) || 50;
    const cacheKey = `music_history_list_${limit}`;
    
    const cachedItems = cache.get(cacheKey);
    if (cachedItems !== null) {
      return res.json({
        success: true,
        data: cachedItems,
        cached: true,
      });
    }

    const items = await MusicGeneration.findAll({
      order: [['createdAt', 'DESC']],
      limit,
      attributes: [
        'id',
        'title',
        'model',
        'make_instrumental',
        'prompt',
        'gpt_description_prompt',
        'task_ids',
        'audioUrl',
        'audioUrls',
        'createdAt',
      ],
    });

    cache.set(cacheKey, items, 60000);

    res.json({
      success: true,
      data: items,
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

    res.json({
      success: true,
      data: item,
    });
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

    cache.delete('music_history_list_50');
    cache.delete('music_history_list_100');

    res.json({
      success: true,
      message: '删除成功',
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listMusicHistory,
  getMusicHistoryById,
  deleteMusicHistory,
};
