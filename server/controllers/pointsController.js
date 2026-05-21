const { fetchBalance } = require('../utils/pointsService');

// GET /api/points/balance
async function handleGetBalance(req, res, next) {
  try {
    const balance = await fetchBalance();

    if (balance === null) {
      return res.json({
        success: false,
        message: '无法获取积分余额（GRSAI_API_KEY 未配置或查询失败）',
        data: null,
      });
    }

    res.json({
      success: true,
      data: balance,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  handleGetBalance,
};
