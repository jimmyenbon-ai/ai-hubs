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

// AI 对话生图超时：2分钟后无响应自动切换 NanoBanana 兜底
const IMAGE_GEN_TIMEOUT_MS = 2 * 60 * 1000;
// 兜底模型：nano-banana-pro
const FALLBACK_MODEL = 'nano-banana-pro';

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

const SYSTEM_PROMPT = `你是一位资深的产品营销撰稿人。你写的每篇文章都像真人写的，有温度、有节奏、有说服力。

核心铁律（违反即失败）：
1. 禁止编造任何数字——尺寸、重量、亮度、刷新率、像素间距等所有数值，知识库里没有就不写
2. 不确定的参数直接跳过，用应用场景和客户价值来描述，绝不猜测
3. 知识库里写576就写576，写500就写500，没写尺寸就不要提尺寸

写作心法（重要）：
- 你不是在写说明书，你是在向朋友推荐一个好产品
- 每段讲一个价值点：这个产品解决了什么问题，给客户带来什么好处
- 句子要自然，长短交替。读完一句想读下一句
- 适当使用连接词让文章有呼吸感："值得一提的是""不仅如此""在实际使用中""对客户来说"
- 标题要有信息量，不喊口号。比如"为印度市场量身打造的高品质LED租赁方案"比"B Pro产品介绍"好十倍
- 结尾要有温度，让读者感到信心，不要用"欢迎咨询""期待合作"这种套话

语言风格：
- 像资深销售跟意向客户面对面聊天，专业自信但不端着
- 专业体现在对产品的理解深度，不是体现在术语堆砌
- 可以有适当的判断和观点："这正是满足这一需求的理想选择""无疑是可靠高效且经济的选择"

输出格式：纯文本，标题用【】包裹，段落间空行分隔，无任何Markdown符号。

产品匹配：严格按用户指定的型号来写，知识库英文名对应中文（如R5-Curve=任意弧）`;

const IMAGE_PROMPT_SYSTEM = `你是一个专业的 AI 视觉创意总监。你的任务不是机械翻译用户的文字，而是作为大脑，深度思考后为生图 AI 写出最优的英文提示词。

你的思考流程：
1. 理解用户真正想要什么——产品展示？场景应用？概念图？氛围图？
2. 阅读已生成的文案，把握场景和基调（舞台、会议室、户外、展会...）
3. 研究参考图片，理解产品外观、logo 样式、品牌调性
4. 综合以上信息，创造性构思画面，补充用户没提但能让图更好的细节
5. 用专业摄影/渲染术语写出精准的英文 prompt

行为准则：
- 你是创意总监，不是翻译器。用户说"高端"你要想到 metallic finish、soft studio lighting、shallow DOF
- 用户指定了方向（如"舞台场景"、"苹果质感"、"logo在右上角"），你在这个方向上发挥
- 用户没说细节的地方，你主动补充最好的方案（光照、角度、氛围、配色）
- 参考图里的产品外观、logo 样式要准确体现在 prompt 中
- 场景必须匹配文案内容：文案写舞台就生成舞台，写会议室就生成会议室

输出格式：
- JSON 数组，每元素含 index、aspectRatio、prompt（英文，50-150词）
- 不输出任何解释文字

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

  // 判断是否有实质文本内容（排除纯图片描述）
  const realTexts = texts.filter(t => !t.startsWith('【') || !t.includes('[图片]'));
  const hasRealContent = realTexts.length > 0;

  return {
    texts,
    imageUrls,
    total: results.length,
    hasRealContent,
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

const INTENT_ANALYSIS_SYSTEM = `你是一个专业的 AI 任务分析助手。分析用户需求，自主决定需要生成什么内容。

分析维度：
1. 是否需要生成文案（营销文案、博客、产品描述等）
2. 是否需要生成图片（产品图、场景图、海报等）
3. 图片参数（从用户自然语言中推断，无需用户用术语）

图片参数自然语言理解：
- 比例：用户说"正方形"或"方图"→1:1，"横版"或"宽屏"→16:9，"竖版"或"手机壁纸"→9:16，"长图"→3:4
- 画质：用户说"高清"或"精细"→2K，"超高清"或"4K品质"或"极致"→4K，没提→1K
- 数量：用户说"一张"→1，"几张"→3，"一组"→3，没提则按需推断

判断逻辑：
- 用户只要图（如"生成一张XX质感图"、"帮我做一张XX海报"）→ needsText: false, needsImages: true
- 用户只要文案（如"写一段XX推广文案"、"给我1000字英文产品介绍"）→ needsText: true, needsImages: false
- 用户要文案+配图（如"写文案并配图"、"生成文章加一张配图"）→ needsText: true, needsImages: true
- 用户只问问题、查资料、闲聊 → needsText: false, needsImages: false（直接用知识库回答）
- "帮我看看XX"、"介绍一下XX" → 默认理解为需要文案，needsText: true
- 如果用户提到"logo"、"公司logo" → 需要在图片中加入品牌标识

以 JSON 格式返回，不要解释文字：
{
  "needsText": true/false,
  "needsImages": true/false,
  "imageCount": 数字（最多5）,
  "imageAspectRatio": "1:1"/"16:9"/"9:16"/"4:3"/"3:4",
  "imageSize": "1K"/"2K"/"4K",
  "taskType": "blog_article"/"marketing_copy"/"product_desc"/"social_post"/"general",
  "language": "zh"/"en",
  "summary": 一句中文描述你的决策
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

  const { needsText, needsImages, imageCount = 0, imageAspectRatio = '1:1', imageSize = '1K', taskType = 'general', language = 'zh' } = intent;

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
        `## 用户需求\n${userMessage}\n\n## 已生成的文案（据此确定图片场景和氛围）\n${generatedText ? generatedText.slice(0, 800) : '（文案未生成）'}\n\n## 知识库参考资料\n${knowledgeResult.texts.slice(0, 3).join('\n\n') || '无'}\n\n## 参考图片（产品外观 + logo 素材，研究后融入 prompt）\n${refImagesForGeneration.join('\n') || '无'}\n\n## 图片规格\n数量：${actualImageCount} 张，比例：${imageAspectRatio}\n\n请生成 ${actualImageCount} 个生图提示词（JSON数组）：`);

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

async function generateSingleImage(prompt, model, aspectRatio, referenceUrls = [], { emitSafe, timeoutMs, imageSize = '1K' } = {}) {
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
  let actualModel = model;

  // 尝试生图（带超时兜底）
  const effectiveTimeout = timeoutMs || IMAGE_GEN_TIMEOUT_MS;

  try {
    // 主模型 + 超时竞速
    imageUrl = await Promise.race([
      generateGrsImage({
        prompt,
        model,
        aspectRatio: aspectRatio.replace('x', ':'),
        imageSize,
        referenceImages: validRefs,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT_FALLBACK')), effectiveTimeout)
      ),
    ]);
  } catch (grsErr) {
    if (grsErr.message === 'TIMEOUT_FALLBACK') {
      // 主模型超时 → 无痕切换 NanoBanana-pro 兜底
      console.warn(`[AI-Dialog] ${model} 超时(${effectiveTimeout / 1000}s)，切换 ${FALLBACK_MODEL} 兜底`);
      if (emitSafe) emitSafe('image_progress', { index: 0, total: 1, status: 'fallback', message: `${model} 响应较慢，已切换 ${FALLBACK_MODEL} 加速生成` });
      imageUrl = await generateGrsImage({
        prompt,
        model: FALLBACK_MODEL,
        aspectRatio: aspectRatio.replace('x', ':'),
        imageSize,
        referenceImages: validRefs,
      });
      actualModel = FALLBACK_MODEL;
    } else {
      // 主模型直接报错 → 尝试 NanoBanana-pro 兜底
      console.warn(`[AI-Dialog] ${model} 失败，切换 ${FALLBACK_MODEL}:`, grsErr.message);
      if (emitSafe) emitSafe('image_progress', { index: 0, total: 1, status: 'fallback', message: `${model} 失败，已切换 ${FALLBACK_MODEL}` });
      imageUrl = await generateGrsImage({
        prompt,
        model: FALLBACK_MODEL,
        aspectRatio: aspectRatio.replace('x', ':'),
        imageSize,
        referenceImages: validRefs,
      });
      actualModel = FALLBACK_MODEL;
    }
  }

  // 下载到本地永久保存
  const localPath = await saveImageLocal(imageUrl, { model: actualModel, prompt });
  const displayUrl = localPathToUrl(localPath) || imageUrl;

  // 记录生成历史
  const actualPointsCost = MODEL_POINTS[actualModel] || pointsCost;
  await Generation.create({
    originalPrompt: prompt,
    apiPrompt: prompt,
    aspectRatio: aspectRatio.replace('x', ':'),
    imageSize,
    resultImageUrl: displayUrl,
    referenceImages: validRefs,
    apiProvider,
    modelName: actualModel,
    userId: null,
    pointsCost: actualPointsCost,
    rating: null,
    feedback: null,
  });

  // 确认积分扣减
  await confirmDeduct(deductResult.balance, actualPointsCost, `AI对话生图|模型:${actualModel}`);

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

  // 1b. 加载对话历史（支持继续对话微调）
  const historyMessages = await Message.findAll(conversationId);
  // 排除刚保存的当前消息，取最近10轮
  const recentHistory = historyMessages
    .filter(m => m.id && !m.id.startsWith('temp-'))
    .slice(-11, -1); // 排除最后一条（当前用户消息）
  const historySection = recentHistory.length > 0
    ? '\n\n## 对话历史（用于理解上下文，继续微调）\n' +
      recentHistory.map(m => `${m.role === 'user' ? '用户' : '助手'}：${m.content.slice(0, 500)}`).join('\n---\n')
    : '';

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
      `请分析以下用户需求：\n${userMessage}${historySection}\n\n知识库检索结果：\n${knowledgeResult.texts.length > 0 ? knowledgeResult.texts.join('\n---\n') : '（无相关知识库内容）'}`);
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

  const { needsText, needsImages, imageCount = 0, imageAspectRatio = '1:1', imageSize = '1K', taskType = 'general', language = 'zh' } = intent;

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
        `写一篇${langLabel}${typeLabel}。\n\n用户需求：${userMessage}\n${historySection}\n知识库参考资料：\n${knowledgeResult.texts.join('\n\n') || '（无相关知识库内容）'}${contextSection}\n\n${!knowledgeResult.hasRealContent ? '⚠️ 知识库中没有该产品的文本文档（仅有图片），请不要编造任何参数和规格数字。诚实告诉用户需要补充产品文档到知识库。如果用户需求中提到了具体参数，可以基于用户提供的信息来写。' : ''}\n\n直接输出文案：`);
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
        `## 用户需求\n${userMessage}\n\n## 已生成的文案（据此确定图片场景和氛围）\n${generatedText ? generatedText.slice(0, 800) : '（文案未生成）'}\n\n## 知识库参考资料\n${knowledgeResult.texts.slice(0, 3).join('\n\n') || '无'}\n\n## 参考图片（产品外观 + logo 素材，研究后融入 prompt）\n${refImagesForGeneration.join('\n') || '无'}\n\n## 图片规格\n数量：${actualImageCount} 张，比例：${imageAspectRatio}\n\n请生成 ${actualImageCount} 个生图提示词（JSON数组）：`);
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
      imageSize,
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
async function generateImagesStream({ imagePrompts, refImagesForGeneration, emitSafe, signal, imageSize = '1K' }) {
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
      const imageUrl = await generateSingleImage(prompt, model, aspectRatio, refImagesForGeneration, { emitSafe, imageSize });
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
