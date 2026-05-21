const express = require('express');
const {
  listHistory,
  getHistoryById,
  deleteHistory,
  toggleFavorite,
} = require('../controllers/historyController');

const router = express.Router();

router.get('/', listHistory);
router.get('/:id', getHistoryById);
router.delete('/:id', deleteHistory);
router.patch('/:id/favorite', toggleFavorite);

module.exports = router;

