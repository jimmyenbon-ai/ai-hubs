const express = require('express');
const { handleGetBalance } = require('../controllers/pointsController');
const { pointsLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// GET /api/points/balance - 积分查询限流：每分钟20次
router.get('/balance', pointsLimiter, handleGetBalance);

module.exports = router;
