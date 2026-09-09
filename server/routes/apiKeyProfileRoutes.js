const express = require('express');
const router = express.Router();
const { ApiKeyProfile } = require('../models/apiKeyProfileModel');
const { LLMConfig } = require('../models/workflowModel');
const { updateSettings } = require('../utils/appConfig');
const { requireAuth } = require('../controllers/settingsController');
const logger = require('../utils/logger');

async function applyProfile(profile) {
  let llmConfig = null;
  const llmPayload = {
    name: `${profile.name} / LLM`,
    provider: profile.llm.provider,
    api_url: profile.llm.api_url,
    api_key: profile.llm.api_key || '',
    model: profile.llm.model,
    is_default: true,
  };

  if (profile.llm.config_id) {
    llmConfig = await LLMConfig.update(profile.llm.config_id, llmPayload);
  }

  if (!llmConfig) {
    llmConfig = await LLMConfig.create(llmPayload);
    profile = await ApiKeyProfile.update(profile.id, {
      llm: { ...profile.llm, config_id: llmConfig.id },
      is_active: true,
    });
  }

  const settingsPatch = {
    grsai_api_key: profile.grsai.api_key || '',
    grsai_api_host: profile.grsai.api_host || 'https://grsai.dakka.com.cn',
  };

  if (profile.llm.provider === 'deepseek') {
    settingsPatch.deepseek_api_key = profile.llm.api_key || '';
    settingsPatch.deepseek_api_url = profile.llm.api_url || '';
    settingsPatch.deepseek_model = profile.llm.model || '';
  }

  await updateSettings(settingsPatch);
  return { profile, llmConfig };
}

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const profiles = await ApiKeyProfile.findAll();
    res.json({ success: true, data: profiles });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/active', async (req, res) => {
  try {
    const profile = await ApiKeyProfile.findActive();
    res.json({ success: true, data: profile });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    let profile = await ApiKeyProfile.create(req.body || {});
    if (profile.is_active === 1) {
      const applied = await applyProfile(profile);
      profile = applied.profile;
    }
    res.json({ success: true, data: profile });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    let profile = await ApiKeyProfile.update(req.params.id, req.body || {});
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }
    if (profile.is_active === 1) {
      const applied = await applyProfile(profile);
      profile = applied.profile;
    }
    res.json({ success: true, data: profile });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const count = await ApiKeyProfile.destroy(req.params.id);
    if (!count) {
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/:id/activate', async (req, res) => {
  try {
    let profile = await ApiKeyProfile.markActive(req.params.id);
    if (!profile) {
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }
    const applied = await applyProfile(profile);
    logger.info('API Key 配置档已切换', { profileId: profile.id, profileName: profile.name });
    res.json({ success: true, data: applied.profile });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
