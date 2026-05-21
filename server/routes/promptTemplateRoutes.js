const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/promptTemplateController');

router.get('/', ctrl.listTemplates);
router.get('/categories', ctrl.getCategories);
router.get('/:id', ctrl.getTemplate);
router.post('/', ctrl.createTemplate);
router.put('/:id', ctrl.updateTemplate);
router.delete('/:id', ctrl.deleteTemplate);

module.exports = router;
