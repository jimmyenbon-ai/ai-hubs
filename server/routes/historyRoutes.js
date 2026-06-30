const express = require('express');
const {
  listHistory,
  getHistoryById,
  deleteHistory,
  toggleFavorite,
  submitFeedback,
  getFeedbackStats,
  getFeedbackSuggestions,
  convertSuggestion,
} = require('../controllers/historyController');

const router = express.Router();

router.get('/', listHistory);
router.get('/:id', getHistoryById);
router.delete('/:id', deleteHistory);
router.patch('/:id/favorite', toggleFavorite);
router.post('/:id/feedback', submitFeedback);

module.exports = router;
