const express = require('express');
const {
  listMusicHistory,
  getMusicHistoryById,
  deleteMusicHistory,
} = require('../controllers/musicHistoryController');

const router = express.Router();

router.get('/', listMusicHistory);
router.get('/:id', getMusicHistoryById);
router.delete('/:id', deleteMusicHistory);

module.exports = router;
