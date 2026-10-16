const { createDialogAgent } = require('./dialogAgent');
const { createDialogRuns } = require('./dialogRuns');

async function getLLMConfig() {
  const { LLMConfig } = require('../models/workflowModel');
  const config = await LLMConfig.findDefault();
  if (config && (config.api_key || config.provider === 'ollama')) return { ...config };
  return require('./llmService').getDefaultConfig();
}

async function generateSingleImage({ prompt, model, aspectRatio, imageSize, referenceImages, signal, onSubmitted }) {
  const { materialImageInput } = require('./materialImageInput');
  const { generateImage } = require('../utils/grsaiClient');
  const { saveImage, localPathToUrl } = require('../utils/localStorage');
  const { Generation } = require('../models');
  const { IMAGE_MODEL_POINTS } = require('../config/imageModels');
  const refs = [];
  for (const url of referenceImages) refs.push(await materialImageInput(url));
  if (signal?.aborted) throw new Error('任务已停止');
  onSubmitted?.({ submittedAt: new Date().toISOString() });
  const remote = await generateImage({ prompt, model, aspectRatio, imageSize, referenceImages: refs, signal });
  // Keep a successful paid result even if local archiving is temporarily unavailable.
  let imageUrl = remote;
  try { imageUrl = localPathToUrl(await saveImage(remote, { model, prompt })) || remote; }
  catch (error) { console.warn('[AI-Dialog] 本地存档失败，保留上游结果:', error.message); }
  try {
    await Generation.create({ originalPrompt: prompt, apiPrompt: prompt, aspectRatio, imageSize, resultImageUrl: imageUrl, referenceImages, apiProvider: 'grsai', modelName: model, userId: null, pointsCost: IMAGE_MODEL_POINTS[model] || 0 });
  } catch (error) { console.warn('[AI-Dialog] 历史记录写入失败，保留任务结果:', error.message); }
  return { imageUrl };
}

function createAIDialogService(deps = {}) {
  const { KnowledgeBase } = require('../models/workflowModel');
  const { StyleProfile } = require('../models/styleProfileModel');
  const { Message, Conversation } = require('../models/conversationModel');
  const llm = require('./llmService');
  const messages = deps.messages || Message;
  let runs;
  runs = createDialogRuns({ filename: deps.filename, execute: async params => {
    const config = deps.invoke ? null : await getLLMConfig();
    const execute = createDialogAgent({
      invoke: deps.invoke || ((system, input, signal) => llm.complete(config, system, input, { signal })),
      knowledge: deps.knowledge || (() => KnowledgeBase.findForRetrieval()),
      styles: deps.styles || (() => StyleProfile.findAll()),
      generate: deps.generate || generateSingleImage,
      saveMessage: (id, record) => messages.create(id, record),
      history: id => messages.findAll(id),
      previous: id => runs.previous(id),
      checkpoint: params.checkpoint,
      externalModel: config?.provider !== 'ollama',
    });
    const result = await execute(params);
    if (!deps.messages) await Conversation.touch(params.conversationId);
    return result;
  } });
  return runs;
}

let service;
const getDialogService = () => service || (service = createAIDialogService());

module.exports = { createAIDialogService, getDialogService, getLLMConfig };
