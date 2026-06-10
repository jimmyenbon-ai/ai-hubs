/**
 * AI 对话服务
 * 核心逻辑：知识库检索 → DeepSeek 生成文案 + 生图提示词 → 批量生图 → 聚合结果
 */

const { KnowledgeBase } = require('../models/workflowModel');
const { intelligentSearch } = require('./knowledgeSearch');
const llmService = require('./llmService');
const { LLMConfig } = require('../models/workflowModel');
const { Message } = require('../models/conversationModel');
const { appConfig } = require('../utils/appConfig');
const { ensurePublicImageUrl } = require('../utils/imageUtils');
const { saveImage: saveImageLocal, localPathToUrl } = require('../utils/localStorage');
const { generateImage: generateGrsImage } = require('../utils/grsaiClient');
const { generateImage: generateMxImage } = require('../utils/mxapiClient');
const { deductPoints, confirmDeduct } = require('../utils/pointsService');
const { Generation } = require('../models');
const { v4: uuidv4 } = require('uuid');

const MODEL_POINTS = {
  'gpt-image-2': 2,
  'gpt-image-2-vip': 5,
  'nano-banana': 1,
  'nano-banana-fast': 1,
  'nano-banana-2': 2,
  'nano-banana-2-cl': 2,
  'nano-banana-2-4k-cl': 4,
  'nano-banana-pro': 1,
  'nano-banana-pro-cl': 2,
  'nano-banana-pro-vip': 2,
  'nano-banana-pro-4k-vip': 4,
};

const GRSAI_MODELS = Object.keys(MODEL_POINTS);

const getApiBase = () => process.env.API_BASE_URL || 'http://localhost:3007';

// ============ LLM 配置获取 ============

async function getLLMConfig() {
  try {
    const dbConfig = await LLMConfig.findDefault();
    if (dbConfig && dbConfig.api_key) {
      return {
        provider: dbConfig.provider || 'deepseek',
        api_url: dbConfig.api_url || 'https://api.deepseek.com',
        api_key: dbConfig.api_key,
        model: dbConfig.model || 'deepseek-chat',
      };
    }
  } catch (_) {}

  const dsKey = appConfig.deepseek_api_key;
  if (dsKey) {
    return {
      provider: 'deepseek',
      api_url: appConfig.deepseek_api_url || 'https://api.deepseek.com',
      api_key: dsKey,
      model: appConfig.deepseek_model || 'deepseek-chat',
    };
  }

  return {
    provider: 'deepseek',
    api_url: 'https://api.deepseek.com',
    model: 'deepseek-chat',
  };
}

// ============ 系统提示词 ============

const SYSTEM_PROMPT = `你是一个专业的 AI 设计任务助手。

当用户提出需求时，你需要：
1. 理解用户的最终目标（生成文案？生成图片？或者两者都要？）
2. 如果需要文案，结合知识库检索结果撰写
3. 如果需要图片，为每张图生成详细的英文生图提示词（用于 AI 生图模型）
4. 始终用中文回复用户，除非用户明确要求其他语言

重要规则：
- 文案要专业、有吸引力，符合营销场景
- 每张图片的提示词要具体、描述性强，包含主体、风格、光照、构图等细节
- 在回复末尾用固定格式引用生成的图片：[图片1] [图片2] [图片3]
- 如果用户只需要文案，不需要图片，不要生成图片提示词
- 图片数量由用户决定（用户说"3张"就生成3个提示词）`;

const IMAGE_PROMPT_SYSTEM = `你是一个专业的 AI 生图提示词工程师。

根据用户需求和知识库内容，为每张图片生成详细的英文生图提示词。

要求：
1. 每个提示词都是完整的、描述性的英文句子
2. 包含：主体内容、风格、光照、构图、色彩、细节等
3. 长度：每个提示词 50-150 个英文单词
4. 输出格式：一个 JSON 数组，每个元素包含 index（序号）、aspectRatio（比例，如 1:1、16:9、9:16）、prompt（英文提示词）
5. 不要输出任何解释文字，只输出 JSON 数组

示例格式：
[
  {"index": 1, "aspectRatio": "16:9", "prompt": "A sleek LED display panel..."},
  {"index": 2, "aspectRatio": "9:16", "prompt": "Close-up view of..."}
]`;

// ============ 知识库检索 ============

async function searchKnowledge(userMessage) {
  const allKnowledge = await KnowledgeBase.findAll({});
  const results = intelligentSearch(allKnowledge, {
    query: userMessage,
    limit: 10,
    minScore: 0.1,
  });

  const texts = [];
  const imageUrls = [];

  for (const item of results) {
    if (item._isImage && item._imageUrl) {
      imageUrls.push(item._imageUrl);
    } else if (item._textContent) {
      texts.push(`【${item.title || item.originalName || '知识条目'}】\n${item._textContent}`);
    }
  }

  return {
    texts,
    imageUrls,
    total: results.length,
  };
}

// ============ 核心对话处理 ============

async function handleChat(conversationId, userMessage) {
  const llmConfig = await getLLMConfig();

  // 1. 保存用户消息
  await Message.create(conversationId, {
    role: 'user',
    content: userMessage,
    attachments: [],
  });

  // 2. 检索知识库
  let knowledgeResult;
  try {
    knowledgeResult = await searchKnowledge(userMessage);
  } catch (err) {
    console.error('[AI-Dialog] 知识库检索失败:', err.message);
    knowledgeResult = { texts: [], imageUrls: [], total: 0 };
  }

  // 3. 让 DeepSeek 分析需求，决定是否需要文案和生图
  const needsText = /文|文章|博客|copy|文案|内容|描述|介绍|说明|推广|营销/i.test(userMessage);
  const needsImages = /图|图片|配图|生图|照片|画面|图像/i.test(userMessage);

  // 从用户消息中推断图片数量
  const numMatch = userMessage.match(/(\d+)\s*[张个幅]/);
  const imageCount = numMatch ? Math.min(parseInt(numMatch[1]), 10) : 3;

  // 4. 构建上下文
  let contextSection = '';
  if (knowledgeResult.texts.length > 0) {
    contextSection = `\n\n## 知识库参考资料\n${knowledgeResult.texts.join('\n\n')}`;
  }
  if (knowledgeResult.imageUrls.length > 0) {
    contextSection += `\n\n## 知识库参考图片 URL（可在生图时作为风格参考）\n${knowledgeResult.imageUrls.join('\n')}`;
  }

  // 5. 生成文案（如果需要）
  let generatedText = '';
  if (needsText) {
    const textPrompt = `${SYSTEM_PROMPT}${contextSection}\n\n## 用户需求\n${userMessage}\n\n请根据以上信息和知识库内容，完成用户的任务。如果需要生成图片，请在文案之后给出每个图片的生图提示词。`;
    try {
      const textResult = await llmService.complete(llmConfig, SYSTEM_PROMPT, `请完成以下任务：\n\n## 知识库内容\n${knowledgeResult.texts.join('\n\n') || '（无相关知识库内容）'}\n\n## 用户需求\n${userMessage}`);
      generatedText = textResult.content;
    } catch (err) {
      console.error('[AI-Dialog] 文案生成失败:', err.message);
      generatedText = `（文案生成失败：${err.message}）`;
    }
  }

  // 6. 生成图片（如果需要）
  let generatedImages = [];
  if (needsImages && imageCount > 0) {
    const refImagesForGeneration = knowledgeResult.imageUrls.slice(0, 3);

    // 6a. 让 LLM 生成生图提示词
    let imagePrompts = [];
    try {
      const promptResult = await llmService.complete(llmConfig, IMAGE_PROMPT_SYSTEM,
        `## 用户需求\n${userMessage}\n\n## 知识库内容摘要\n${knowledgeResult.texts.slice(0, 3).join('\n\n') || '无'}\n\n## 参考图片URL（可选使用）\n${refImagesForGeneration.join('\n') || '无'}\n\n请生成 ${imageCount} 个生图提示词（JSON数组）：`);
      
      const content = promptResult.content.trim();
      let jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        imagePrompts = JSON.parse(jsonMatch[0]);
      } else {
        imagePrompts = parseFlexiblePrompts(content, imageCount);
      }
    } catch (err) {
      console.error('[AI-Dialog] 生图提示词生成失败:', err.message);
    }

    // 6b. 批量生成图片
    if (imagePrompts.length > 0) {
      generatedImages = await generateImages(imagePrompts, refImagesForGeneration, userMessage);
    } else {
      // fallback：使用通用提示词
      generatedImages = await generateImages(
        Array.from({ length: imageCount }, (_, i) => ({
          index: i + 1,
          aspectRatio: '1:1',
          prompt: `${userMessage} - image ${i + 1}, high quality, professional photography`,
        })),
        refImagesForGeneration,
        userMessage
      );
    }
  }

  // 7. 组合最终回复
  const assistantContent = buildFinalResponse(generatedText, generatedImages);

  // 8. 保存助手消息
  const assistantMessage = await Message.create(conversationId, {
    role: 'assistant',
    content: assistantContent,
    attachments: generatedImages.map((img, i) => ({
      type: 'image',
      url: img.imageUrl,
      prompt: img.prompt,
      index: i + 1,
    })),
  });

  return {
    messageId: assistantMessage.id,
    content: assistantContent,
    images: generatedImages,
    knowledgeUsed: knowledgeResult.total,
  };
}

// ============ 批量生图 ============

async function generateImages(imagePrompts, referenceUrls, originalPrompt) {
  const results = [];

  for (const item of imagePrompts) {
    const prompt = typeof item === 'string' ? item : item.prompt;
    const aspectRatio = (item.aspectRatio || '1:1').replace(':', 'x');
    const model = 'gpt-image-2';

    try {
      const imageUrl = await generateSingleImage(prompt, model, aspectRatio, referenceUrls);
      results.push({
        index: item.index || (results.length + 1),
        prompt,
        imageUrl,
        aspectRatio: item.aspectRatio || '1:1',
      });
    } catch (err) {
      console.error(`[AI-Dialog] 第 ${results.length + 1} 张图片生成失败:`, err.message);
      results.push({
        index: item.index || (results.length + 1),
        prompt,
        imageUrl: null,
        error: err.message,
      });
    }
  }

  return results;
}

async function generateSingleImage(prompt, model, aspectRatio, referenceUrls = []) {
  const pointsCost = MODEL_POINTS[model] || 1;

  // 积分预检查
  const deductResult = await deductPoints(pointsCost, `AI对话生图|模型:${model}`);
  if (!deductResult.success) {
    throw new Error(deductResult.message);
  }

  // 参考图处理
  const validRefs = [];
  if (referenceUrls && referenceUrls.length > 0) {
    for (const url of referenceUrls) {
      try {
        const publicUrl = await ensurePublicImageUrl(url);
        if (publicUrl) validRefs.push(publicUrl);
      } catch (_) {}
    }
  }

  let imageUrl;
  let apiProvider = 'grsai';

  try {
    imageUrl = await generateGrsImage({
      prompt,
      model,
      aspectRatio: aspectRatio.replace('x', ':'),
      imageSize: '1K',
      referenceImages: validRefs,
    });
  } catch (grsErr) {
    console.warn('[AI-Dialog] GRSai 生图失败，尝试 MXAPI 备用:', grsErr.message);
    try {
      imageUrl = await generateMxImage({
        prompt,
        imageSize: '1K',
        aspectRatio: aspectRatio.replace('x', ':'),
        referenceImages: validRefs,
      });
      apiProvider = 'mxapi';
    } catch (mxErr) {
      throw new Error(`生图失败：${grsErr.message}`);
    }
  }

  // 下载到本地永久保存
  const localPath = await saveImageLocal(imageUrl, { model, prompt });
  const displayUrl = localPathToUrl(localPath) || imageUrl;

  // 记录生成历史
  await Generation.create({
    originalPrompt: prompt,
    apiPrompt: prompt,
    aspectRatio: aspectRatio.replace('x', ':'),
    imageSize: '1K',
    resultImageUrl: displayUrl,
    referenceImages: validRefs,
    apiProvider,
    modelName: model,
    userId: null,
    pointsCost,
    rating: null,
    feedback: null,
  });

  // 确认积分扣减
  await confirmDeduct(deductResult.balance, pointsCost, `AI对话生图|模型:${model}`);

  return displayUrl;
}

// ============ 工具函数 ============

function parseFlexiblePrompts(content, count) {
  const lines = content.split('\n').filter(l => l.trim().length > 10);
  return lines.slice(0, count).map((line, i) => {
    const clean = line.replace(/^[\d\.\-\*\✅]+\s*/, '').trim();
    return {
      index: i + 1,
      aspectRatio: '1:1',
      prompt: clean || `AI generated image ${i + 1}`,
    };
  });
}

function buildFinalResponse(text, images) {
  const parts = [];
  if (text) parts.push(text);
  if (images.length > 0) {
    const successImages = images.filter(img => img.imageUrl);
    if (successImages.length > 0) {
      parts.push('\n\n---\n\n已生成图片：');
      successImages.forEach((img, i) => {
        parts.push(`[图片${i + 1}] ${img.imageUrl}`);
      });
    }
    const failedCount = images.length - successImages.length;
    if (failedCount > 0) {
      parts.push(`\n（${failedCount} 张图片生成失败，请稍后重试）`);
    }
  }
  return parts.join('\n');
}

module.exports = {
  handleChat,
  searchKnowledge,
  getLLMConfig,
};
