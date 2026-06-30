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

// GET /api/settings/video-provider - 无需认证
router.get('/video-provider', (req, res) => {
  const { appConfig } = require('../utils/appConfig');
  const provider = appConfig.default_video_provider || 'seedance';
  res.json({ success: true, data: { provider } });
});

module.exports = router;
