const express = require('express');
const {
  handleAuth,
  requireAuth,
  handleGetSettings,
  handleUpdateSettings,
} = require('../controllers/settingsController');

const router = express.Router();

router.post('/auth', handleAuth);
router.get('/', requireAuth, handleGetSettings);
router.put('/', requireAuth, handleUpdateSettings);

module.exports = router;
