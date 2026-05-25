const express = require('express');
const {
  getFeedbackStats,
  getFeedbackSuggestions,
  convertSuggestion,
} = require('../controllers/historyController');

const router = express.Router();

router.get('/stats', getFeedbackStats);
router.get('/suggestions', getFeedbackSuggestions);
router.post('/suggestions/:pattern/convert', convertSuggestion);

module.exports = router;
