const express = require('express');
const router = express.Router();
const { handleDirect, handlePlan, handleDirectStream } = require('../controllers/previzDirectorController');

router.post('/direct', handleDirect);
router.post('/plan', handlePlan);
router.post('/direct-stream', handleDirectStream);

module.exports = router;
