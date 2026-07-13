const express = require('express');
const router = express.Router();
const { handleDirect, handlePlan, handleDirectStream } = require('../controllers/previzDirectorController');
const { normalizePrevizVideo } = require('../controllers/previzVideoController');
const upload = require('../middleware/uploadConfig');

router.post('/direct', handleDirect);
router.post('/plan', handlePlan);
router.post('/direct-stream', handleDirectStream);
router.post('/normalize-video', upload.single('video'), normalizePrevizVideo);

module.exports = router;
