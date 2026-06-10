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
- 图片数量由用户决定（用户说"3张"就生成3个提示词）

⚠️ 输出格式要求（极其重要）：
- 禁止使用 Markdown 语法！不要输出 ##、**、*、-、--、=== 等符号
- 标题直接写成一行中文，用【】包裹，如：【产品概述】
- 段落之间空一行分隔，每个段落是自然流畅的中文句子
- 列表项用中文序号"一、二、三"或"1）2）3）"表示
- 强调语句直接用引号「」包裹，不要用加粗或斜体
- 最终输出必须是纯文本，用户可以直接复制发布到公众号/官网

⚠️ 产品型号精确匹配（极其重要）：
- 用户在查询中提到的产品型号/变体名称（如"R5任意弧"、"R5直角锁"、"R5弧形锁"、"R5 90°"等），你必须精确识别
- 知识库中的文档可能用英文命名（如 "R5-Curve" = 任意弧，"R5-Straight" = 直角锁，"R5-Arc" = 弧形锁，"R5-90" = 90°）
- 如果知识库返回了多个同系列不同型号的内容，你必须只使用与用户指定型号匹配的内容
- 如果知识库中找不到用户指定的具体型号，请在回答中诚实说明，不要用同系列其他型号的内容代替
- 中文-英文产品名对照参考：
  · 任意弧 = Curve / Flexible / Curved
  · 直角锁 = Straight / Right Angle
  · 弧形锁 = Arc / Arched
  · 90° = 90-degree / Right Angle`;

const IMAGE_PROMPT_SYSTEM = `你是一个专业的 AI 生图提示词工程师。

根据用户需求，为每张图片生成详细的英文生图提示词。

核心原则：忠实还原用户需求，用户怎么描述就怎么生成。
1. 用户指定的渲染风格（如"苹果质感"、"金属质感"、"赛博朋克"）必须在 prompt 中体现
2. 用户指定的构图细节（如"右上角"、"居中"、"俯拍"）必须原样保留
3. 用户要求加 logo 时，品牌名写 Enbon，位置严格按用户说的（如"右上角"、"左下角"、"屏幕中央"），用户没说位置则默认放在产品主体显眼处
4. 参考图片中可能包含产品图和 logo 素材，综合参考它们来构造 prompt

输出要求：
- 每个 prompt 50-150 个英文单词，描述性强
- 包含：主体、风格、光照、构图、色彩、细节
- JSON 数组格式，每个元素含 index、aspectRatio、prompt
- 不要输出任何解释文字，只输出 JSON 数组

示例格式：
[
  {"index": 1, "aspectRatio": "16:9", "prompt": "A sleek LED display panel..."},
  {"index": 2, "aspectRatio": "9:16", "prompt": "Close-up view of..."}
]`;

// ============ 知识库检索 ============

async function searchKnowledge(userMessage) {
  const allKnowledge = await KnowledgeBase.findAll({});
  let results = intelligentSearch(allKnowledge, {
    query: userMessage,
    limit: 10,
    minScore: 0.1,
  });

  // 变体过滤：用户指定了具体型号时，排除同系列其他型号的文档
  results = filterByVariant(results, userMessage);

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

// ============ 产品变体过滤 ============
// 知识库搜索可能返回同系列不同变体的文档（如搜R5任意弧，也返回R5-90°）
// 此函数根据用户查询中的变体关键词过滤结果
const VARIANT_INDICATORS = [
  { query: ['任意弧', 'curve', 'flexible', 'curved', 'r5-curve', 'r5-flexible'], names: ['curve', 'flexible', '任意弧'] },
  { query: ['直角锁', 'straight', 'right angle', 'r5-straight'], names: ['straight', 'right-angle', '直角'] },
  { query: ['弧形锁', 'arc', 'arched', 'r5-arc'], names: ['arc', 'arched', '弧形'] },
  { query: ['90°', '90-degree', '90 degree', 'r5-90'], names: ['90', '90°', '90-degree'] },
];

function filterByVariant(results, userMessage) {
  const msgLower = userMessage.toLowerCase();

  for (const group of VARIANT_INDICATORS) {
    const userMentionsVariant = group.query.some(q => msgLower.includes(q.toLowerCase()));
    if (userMentionsVariant) {
      const filtered = results.filter(item => {
        // 图片资产（Logo、品牌素材等）不属于产品变体，始终保留
        if (item._isImage) return true;
        const name = `${item.title || ''} ${item.originalName || ''} ${item.folder || ''}`.toLowerCase();
        return group.names.some(n => name.includes(n.toLowerCase()));
      });
      if (filtered.length > 0) {
        console.log(`[AI-Dialog] 变体过滤: 匹配 "${group.query[0]}" → 保留 ${filtered.length}/${results.length} 条`);
        return filtered;
      }
      // 如果过滤后为空，保留原始结果（可能知识库中该变体文档命名不规范）
      console.log(`[AI-Dialog] 变体过滤: "${group.query[0]}" 无匹配，保留全部结果`);
    }
  }

  return results;
}

// ============ 意图分析（LLM 自主决定）============

const INTENT_ANALYSIS_SYSTEM = `你是一个专业的 AI 任务分析助手。分析用户需求，决定需要生成什么内容。

分析维度：
1. 是否需要生成文案（营销文案、博客、产品描述、社交媒体等）
2. 是否需要生成图片（海报、配图、产品图、社交图片等）
3. 如果需要图片，数量是多少（最多5张）
4. 如果需要图片，比例偏好是什么（1:1、16:9、9:16 等）

重要规则：
- 如果用户问的是产品介绍、公司介绍、功能说明，即使没有明确说"生成文案"，也应生成文案
- 如果用户说"帮我看看这个产品"或"介绍一下"，理解为需要文案+配图
- 如果用户明确说"只是问问"、"不需要生成内容"，则不需要生成任何内容
- 如果只需要纯文字问答，不需要图片

以 JSON 格式返回分析结果，不要有任何解释文字：
{
  "needsText": true/false,
  "needsImages": true/false,
  "imageCount": 数字（最多5）,
  "imageAspectRatio": "1:1"/"16:9"/"9:16"/"4:3"/"3:4",
  "taskType": "blog_article"/"marketing_copy"/"product_desc"/"social_post"/"general",
  "language": "zh"/"en",
  "summary": 一句话描述你决定生成什么（仅用于日志）
}`;

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

  // 3. LLM 自主分析意图
  let intent;
  try {
    const intentResult = await llmService.complete(llmConfig, INTENT_ANALYSIS_SYSTEM,
      `请分析以下用户需求：\n${userMessage}\n\n知识库检索结果：\n${knowledgeResult.texts.length > 0 ? knowledgeResult.texts.join('\n---\n') : '（无相关知识库内容）'}`);
    const content = intentResult.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      intent = JSON.parse(jsonMatch[0]);
    } else {
      intent = { needsText: true, needsImages: false, imageCount: 0, imageAspectRatio: '1:1', taskType: 'general', language: 'zh' };
    }
  } catch (err) {
    console.error('[AI-Dialog] 意图分析失败，降级为默认策略:', err.message);
    intent = { needsText: true, needsImages: false, imageCount: 0, imageAspectRatio: '1:1', taskType: 'general', language: 'zh' };
  }

  const { needsText, needsImages, imageCount = 0, imageAspectRatio = '1:1', taskType = 'general', language = 'zh' } = intent;

  // 如果 LLM 判断不需要任何内容生成，直接用知识库内容回答
  if (!needsText && !needsImages) {
    const answerText = knowledgeResult.texts.length > 0
      ? knowledgeResult.texts.join('\n\n')
      : '抱歉，我暂时没有找到相关信息，请尝试其他问题或补充知识库内容。';

    const assistantMessage = await Message.create(conversationId, {
      role: 'assistant',
      content: answerText,
      attachments: [],
    });

    return {
      messageId: assistantMessage.id,
      content: answerText,
      images: [],
      knowledgeUsed: knowledgeResult.total,
    };
  }

  // 4. 构建上下文
  const contextSection = buildContextSection(knowledgeResult);

  // 5. 生成文案（如果需要）
  let generatedText = '';
  if (needsText) {
    const taskLabels = {
      blog_article: '博客文章',
      marketing_copy: '营销文案',
      product_desc: '产品描述',
      social_post: '社交媒体帖子',
      general: '内容',
    };
    const langLabel = language === 'en' ? '英文' : '中文';
    const typeLabel = taskLabels[taskType] || '内容';

    try {
      const textResult = await llmService.complete(llmConfig, SYSTEM_PROMPT,
        `## 任务类型\n请生成一篇${langLabel}${typeLabel}。\n\n## 用户需求\n${userMessage}\n\n## 知识库内容（注意：请只使用与用户指定产品型号精确匹配的内容，忽略其他型号）\n${knowledgeResult.texts.join('\n\n') || '（无相关知识库内容）'}${contextSection}\n\n⚠️ 重要：如果知识库中包含多个不同型号/变体的内容，请只采用用户明确指定的型号。例如用户要"R5任意弧"，就不要使用"R5直角锁"或"R5弧形锁"的内容。\n\n⚠️ 格式要求：纯文本输出，禁止 Markdown（无 ## ** - 等符号），标题用【】，可直接复制发布。\n\n请直接输出生成的内容，不要添加额外的说明。`);
      generatedText = textResult.content;
    } catch (err) {
      console.error('[AI-Dialog] 文案生成失败:', err.message);
      generatedText = `（文案生成失败：${err.message}）`;
    }
  }

  // 6. 生成图片（如果需要）
  let generatedImages = [];
  const actualImageCount = Math.min(imageCount, 5);
  if (needsImages && actualImageCount > 0) {
    const refImagesForGeneration = knowledgeResult.imageUrls.slice(0, 3);

    // 6a. 让 LLM 生成生图提示词
    let imagePrompts = [];
    try {
      const promptResult = await llmService.complete(llmConfig, IMAGE_PROMPT_SYSTEM,
        `## 用户需求\n${userMessage}\n\n## 知识库内容摘要\n${knowledgeResult.texts.slice(0, 3).join('\n\n') || '无'}\n\n## 参考图片URL（可选使用，其中可能包含logo等品牌素材）\n${refImagesForGeneration.join('\n') || '无'}\n\n⚠️ 如果用户要求加logo且参考图中有logo图片，请生成包含 "Enbon logo" 的 prompt，logo 放在产品屏幕或机身上。\n\n## 要求图片数量和比例\n数量：${actualImageCount} 张，比例：${imageAspectRatio}\n\n请生成 ${actualImageCount} 个生图提示词（JSON数组）：`);

      const content = promptResult.content.trim();
      let jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        imagePrompts = JSON.parse(jsonMatch[0]);
        // 如果 LLM 返回数量不足，补足
        if (imagePrompts.length < actualImageCount) {
          for (let i = imagePrompts.length; i < actualImageCount; i++) {
            imagePrompts.push({ index: i + 1, aspectRatio: imageAspectRatio, prompt: imagePrompts[0]?.prompt || userMessage });
          }
        }
      } else {
        imagePrompts = parseFlexiblePrompts(content, actualImageCount);
      }
    } catch (err) {
      console.error('[AI-Dialog] 生图提示词生成失败:', err.message);
    }

    // 6b. 批量生成图片
    if (imagePrompts.length > 0) {
      generatedImages = await generateImages(imagePrompts, refImagesForGeneration, userMessage);
    } else {
      generatedImages = await generateImages(
        Array.from({ length: actualImageCount }, (_, i) => ({
          index: i + 1,
          aspectRatio: imageAspectRatio,
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

// ============ SSE 流式对话处理 ============

/**
 * SSE 流式对话处理
 *
 * 每个步骤完成时通过 emit() 推送进度，前端可以实时展示：
 * - knowledge_result：知识库检索完成（带摘要）
 * - intent_result：LLM 意图分析完成
 * - text_result：文案生成完成（如果有）
 * - image_progress：单张图片生成进度
 * - done：全部完成
 *
 * @param {object} params
 * @param {string} params.conversationId
 * @param {string} params.userMessage
 * @param {Function} params.emit - SSE 发送函数 emit(event, data)
 * @param {object} params.signal - { aborted: boolean } 中断信号
 */
async function handleChatStream({ conversationId, userMessage, emit, signal }) {
  const emitSafe = (event, data) => {
    if (signal?.aborted) return;
    emit(event, data);
  };

  // 1. 保存用户消息
  await Message.create(conversationId, {
    role: 'user',
    content: userMessage,
    attachments: [],
  });

  // 2. 知识库检索
  let knowledgeResult;
  try {
    knowledgeResult = await searchKnowledge(userMessage);
    emitSafe('knowledge_result', {
      textCount: knowledgeResult.texts.length,
      imageCount: knowledgeResult.imageUrls.length,
      summary: knowledgeResult.texts.length > 0
        ? `找到 ${knowledgeResult.texts.length} 条相关文档，${knowledgeResult.imageUrls.length} 张相关图片`
        : '未在知识库中找到相关内容',
    });
  } catch (err) {
    console.error('[AI-Dialog] 知识库检索失败:', err.message);
    knowledgeResult = { texts: [], imageUrls: [], total: 0 };
    emitSafe('knowledge_result', { textCount: 0, imageCount: 0, summary: '知识库检索失败' });
  }

  if (signal?.aborted) return;

  const llmConfig = await getLLMConfig();

  // 3. LLM 意图分析
  let intent;
  try {
    const intentResult = await llmService.complete(llmConfig, INTENT_ANALYSIS_SYSTEM,
      `请分析以下用户需求：\n${userMessage}\n\n知识库检索结果：\n${knowledgeResult.texts.length > 0 ? knowledgeResult.texts.join('\n---\n') : '（无相关知识库内容）'}`);
    const content = intentResult.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      intent = JSON.parse(jsonMatch[0]);
    } else {
      intent = { needsText: true, needsImages: false, imageCount: 0, imageAspectRatio: '1:1', taskType: 'general', language: 'zh' };
    }
    emitSafe('intent_result', {
      needsText: intent.needsText,
      needsImages: intent.needsImages,
      imageCount: intent.imageCount,
      summary: intent.summary || `将生成${intent.needsText ? '文案' : ''}${intent.needsText && intent.needsImages ? '和' : ''}${intent.needsImages ? `${intent.imageCount}张图片` : ''}`,
    });
  } catch (err) {
    console.error('[AI-Dialog] 意图分析失败:', err.message);
    intent = { needsText: true, needsImages: false, imageCount: 0, imageAspectRatio: '1:1', taskType: 'general', language: 'zh' };
    emitSafe('intent_result', { needsText: true, needsImages: false, imageCount: 0, summary: '意图分析失败，默认生成文案' });
  }

  const { needsText, needsImages, imageCount = 0, imageAspectRatio = '1:1', taskType = 'general', language = 'zh' } = intent;

  // 无需生成内容，直接用知识库内容回答
  if (!needsText && !needsImages) {
    const answerText = knowledgeResult.texts.length > 0
      ? knowledgeResult.texts.join('\n\n')
      : '抱歉，我暂时没有找到相关信息，请尝试其他问题或补充知识库内容。';

    await Message.create(conversationId, { role: 'assistant', content: answerText, attachments: [] });
    return { content: answerText, images: [], knowledgeUsed: knowledgeResult.total };
  }

  if (signal?.aborted) return;

  // 4. 构建上下文
  const contextSection = buildContextSection(knowledgeResult);

  // 5. 生成文案（如果需要）
  let generatedText = '';
  if (needsText) {
    const taskLabels = {
      blog_article: '博客文章', marketing_copy: '营销文案',
      product_desc: '产品描述', social_post: '社交媒体帖子', general: '内容',
    };
    const langLabel = language === 'en' ? '英文' : '中文';
    const typeLabel = taskLabels[taskType] || '内容';

    emitSafe('status', { phase: 'text', message: `正在生成${langLabel}${typeLabel}...` });

    try {
      const textResult = await llmService.complete(llmConfig, SYSTEM_PROMPT,
        `## 任务类型\n请生成一篇${langLabel}${typeLabel}。\n\n## 用户需求\n${userMessage}\n\n## 知识库内容（注意：请只使用与用户指定产品型号精确匹配的内容）\n${knowledgeResult.texts.join('\n\n') || '（无相关知识库内容）'}${contextSection}\n\n⚠️ 重要：如果知识库中包含多个不同型号/变体的内容，请只采用用户明确指定的型号。\n\n⚠️ 格式要求：纯文本输出，禁止 Markdown（无 ## ** - 等符号），标题用【】，可直接复制发布。\n\n请直接输出生成的内容，不要添加额外的说明。`);
      generatedText = textResult.content;
      emitSafe('text_result', { content: generatedText });
    } catch (err) {
      console.error('[AI-Dialog] 文案生成失败:', err.message);
      generatedText = `（文案生成失败：${err.message}）`;
      emitSafe('text_result', { content: generatedText, error: err.message });
    }
  }

  if (signal?.aborted) return;

  // 6. 生成图片（如果需要）
  let generatedImages = [];
  const actualImageCount = Math.min(imageCount, 5);
  if (needsImages && actualImageCount > 0) {
    const refImagesForGeneration = knowledgeResult.imageUrls.slice(0, 3);

    // 6a. LLM 生成生图提示词
    emitSafe('status', { phase: 'prompt', message: '正在生成图片提示词...' });
    let imagePrompts = [];
    try {
      const promptResult = await llmService.complete(llmConfig, IMAGE_PROMPT_SYSTEM,
        `## 用户需求\n${userMessage}\n\n## 知识库内容摘要\n${knowledgeResult.texts.slice(0, 3).join('\n\n') || '无'}\n\n## 参考图片URL（可选使用，其中可能包含logo等品牌素材）\n${refImagesForGeneration.join('\n') || '无'}\n\n⚠️ 如果用户要求加logo且参考图中有logo图片，请生成包含 "Enbon logo" 的 prompt，logo 放在产品屏幕或机身上。\n\n## 要求图片数量和比例\n数量：${actualImageCount} 张，比例：${imageAspectRatio}\n\n请生成 ${actualImageCount} 个生图提示词（JSON数组）：`);
      const content = promptResult.content.trim();
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        imagePrompts = JSON.parse(jsonMatch[0]);
        if (imagePrompts.length < actualImageCount) {
          for (let i = imagePrompts.length; i < actualImageCount; i++) {
            imagePrompts.push({ index: i + 1, aspectRatio: imageAspectRatio, prompt: imagePrompts[0]?.prompt || userMessage });
          }
        }
      } else {
        imagePrompts = parseFlexiblePrompts(content, actualImageCount);
      }
      emitSafe('prompt_result', { prompts: imagePrompts.map(p => p.prompt || p) });
    } catch (err) {
      console.error('[AI-Dialog] 生图提示词生成失败:', err.message);
      imagePrompts = Array.from({ length: actualImageCount }, (_, i) => ({
        index: i + 1, aspectRatio: imageAspectRatio,
        prompt: `${userMessage} - image ${i + 1}, high quality, professional photography`,
      }));
    }

    if (signal?.aborted) return;

    // 6b. 逐张生成图片
    generatedImages = await generateImagesStream({
      imagePrompts,
      refImagesForGeneration,
      emitSafe,
      signal,
    });
  }

  if (signal?.aborted) return;

  // 7. 组合最终回复
  const assistantContent = buildFinalResponse(generatedText, generatedImages);

  // 8. 保存助手消息
  await Message.create(conversationId, {
    role: 'assistant',
    content: assistantContent,
    attachments: generatedImages.map((img) => ({
      type: 'image', url: img.imageUrl, prompt: img.prompt, index: img.index,
    })),
  });

  return { content: assistantContent, images: generatedImages, knowledgeUsed: knowledgeResult.total };
}

/**
 * SSE 流式批量生图，每生成完一张立即推送 progress
 */
async function generateImagesStream({ imagePrompts, refImagesForGeneration, emitSafe, signal }) {
  const results = [];

  for (let i = 0; i < imagePrompts.length; i++) {
    if (signal?.aborted) break;

    const item = imagePrompts[i];
    const prompt = typeof item === 'string' ? item : item.prompt;
    const aspectRatio = (item.aspectRatio || '1:1').replace(':', 'x');
    const model = 'gpt-image-2';

    emitSafe('image_progress', {
      index: i + 1,
      total: imagePrompts.length,
      status: 'generating',
      prompt: prompt.slice(0, 80),
    });

    try {
      const imageUrl = await generateSingleImage(prompt, model, aspectRatio, refImagesForGeneration);
      results.push({ index: item.index || (i + 1), prompt, imageUrl, aspectRatio: item.aspectRatio || '1:1' });
      emitSafe('image_progress', {
        index: i + 1,
        total: imagePrompts.length,
        status: 'done',
        imageUrl,
        prompt,
      });
    } catch (err) {
      console.error(`[AI-Dialog] 第 ${i + 1} 张图片生成失败:`, err.message);
      results.push({ index: item.index || (i + 1), prompt, imageUrl: null, error: err.message });
      emitSafe('image_progress', {
        index: i + 1,
        total: imagePrompts.length,
        status: 'error',
        error: err.message,
        prompt,
      });
    }
  }

  return results;
}

/** 构建知识库上下文 */
function buildContextSection(knowledgeResult) {
  let ctx = '';
  if (knowledgeResult.texts.length > 0) {
    ctx += `\n\n## 知识库参考资料\n${knowledgeResult.texts.join('\n\n')}`;
  }
  if (knowledgeResult.imageUrls.length > 0) {
    ctx += `\n\n## 知识库参考图片 URL（可在生图时作为风格参考）\n${knowledgeResult.imageUrls.join('\n')}`;
  }
  return ctx;
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
  handleChatStream,
  searchKnowledge,
  getLLMConfig,
};
