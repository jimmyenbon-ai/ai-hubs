const llmService = require('./llmService');
const { generateImage } = require('../utils/grsaiClient');
const { ProductAutomationJob } = require('../models/productAutomationModel');
const { Generation, LLMConfig } = require('../models');
const { deductPoints, confirmDeduct } = require('../utils/pointsService');
const { saveImage: saveImageLocal, localPathToUrl } = require('../utils/localStorage');
const { urlToBase64 } = require('../utils/imageUtils');
const { appConfig } = require('../utils/appConfig');
const logger = require('../utils/logger');
const { extractJsonFromLLMResponse } = require('./storyboardService');

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

const STYLE_LABELS = {
  premium_minimal: '高级简约电商风：干净背景、克制配色、产品主体清晰、留白充足、适合独立站和高端详情页。',
  ecommerce_pop: '电商爆款风：卖点直接、对比强、场景明确、视觉冲击更强，适合转化导向商品图。',
  tech: '科技感：冷色光影、精密材质、结构线条、适合电子/工业/智能产品。',
  lifestyle: '生活方式：真实使用场景、温暖自然光、人物或空间氛围辅助产品卖点。',
  luxury: '奢华质感：深色/金属/大理石/柔和高光，强调材质、价格感和品牌感。',
  custom: '',
};

const activeQueues = new Map();

async function getLLMConfig() {
  try {
    const dbConfig = await LLMConfig.findDefault();
    if (dbConfig?.api_key) {
      return {
        provider: dbConfig.provider || 'deepseek',
        api_url: dbConfig.api_url || 'https://api.deepseek.com',
        api_key: dbConfig.api_key,
        model: dbConfig.model || 'deepseek-chat',
      };
    }
  } catch (_) {}

  if (appConfig.deepseek_api_key) {
    return {
      provider: 'deepseek',
      api_url: appConfig.deepseek_api_url || 'https://api.deepseek.com',
      api_key: appConfig.deepseek_api_key,
      model: appConfig.deepseek_model || 'deepseek-chat',
    };
  }
  return null;
}

function toText(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.filter(Boolean).join('、');
  if (typeof value === 'object') return Object.entries(value)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}:${Array.isArray(v) ? v.join('、') : v}`)
    .join('；');
  return String(value);
}

function normalizePlanItem(item = {}, index = 0, includeText = false) {
  return ProductAutomationJob.normalizeImageItem({
    imageNumber: item.imageNumber || item.number || index + 1,
    title: item.title || item.name || `产品图 ${index + 1}`,
    imageType: item.imageType || item.type || '',
    objective: item.objective || item.goal || '',
    scene: item.scene || item.environment || '',
    composition: item.composition || '',
    lighting: item.lighting || '',
    copywriting: item.copywriting || item.text || '',
    prompt: item.prompt || item.imagePrompt || item.visualPrompt || '',
    negativePrompt: item.negativePrompt || '',
    includeText: item.includeText === undefined ? includeText : item.includeText === true,
    includeInGeneration: item.includeInGeneration !== false,
  }, index);
}

function pickFirstArray(...values) {
  return values.find((value) => Array.isArray(value)) || [];
}

function normalizeProductPlan(raw) {
  if (Array.isArray(raw)) {
    return { strategy: {}, items: raw };
  }
  if (!raw || typeof raw !== 'object') {
    return { strategy: {}, items: [] };
  }

  const strategy = raw.strategy || raw.analysis || raw.productStrategy || raw.visualStrategy || {};
  const items = pickFirstArray(
    raw.items,
    raw.images,
    raw.imagePlans,
    raw.productImages,
    raw.productImagePlans,
    raw.plan,
    raw.shots,
    raw.frames,
  );

  return { strategy, items };
}

function buildProductSystemPrompt(options = {}) {
  const styleDesc = options.visualStyle === 'custom'
    ? options.customStylePrompt
    : `${STYLE_LABELS[options.visualStyle] || STYLE_LABELS.premium_minimal}${options.customStylePrompt ? `\n额外风格要求：${options.customStylePrompt}` : ''}`;

  return `你是资深电商视觉策划、独立站转化专家和AI生图提示词专家。请根据产品资料，规划一组可直接批量生成的产品图片方案。

工作目标：
1. 从产品介绍、参数、卖点中提炼产品定位、目标用户、核心卖点和视觉策略。
2. 输出主图、详情页配图、场景图、卖点图、细节特写图等图片方案。
3. 每张图片必须给出可直接用于AI生图的高质量 prompt。
4. 如果用户选择不加文字，画面里不要出现文字、标语、参数表、UI字样；如果选择带文字，只写简短可信的营销/参数文案，不要虚构未提供的参数。
5. 产品参考图必须被视为产品外观约束：不能改变产品结构、颜色、比例、Logo位置和关键部件。

专家角色：${options.expertRole || '电商视觉专家'}
电商类型：${options.commerceType || '独立站/电商详情页'}
视觉风格：${styleDesc || STYLE_LABELS.premium_minimal}
计划张数：${options.imageCount || 6}
文字策略：${options.includeText ? '允许生成带短文案的电商图。' : '不在画面中添加任何文字。'}
语言：${options.language || 'zh-CN'}

输出要求：
1. 必须只输出一个合法 JSON 对象，不能有 markdown，不能有解释，不能有注释。
2. JSON 必须以 { 开头，以 } 结尾。
3. 必须包含 strategy 对象和 items 数组；items 不能为空。
4. 所有字符串必须使用英文双引号，不能使用中文引号或单引号。
5. 不确定的内容写空字符串或空数组，不要编造产品参数。

JSON 结构如下：
{
  "strategy": {
    "productPositioning": "...",
    "targetAudience": "...",
    "coreSellingPoints": ["..."],
    "visualDirection": "...",
    "riskNotes": ["不要虚构的内容", "产品外观约束"]
  },
  "items": [
    {
      "imageNumber": 1,
      "title": "高级简约主图",
      "imageType": "主图/详情页/场景图/卖点图/细节特写/参数说明/广告图/独立站Hero",
      "objective": "这张图解决什么转化目标",
      "scene": "画面场景",
      "composition": "构图和主体位置",
      "lighting": "光影和材质表现",
      "copywriting": "如带文字则给出短文案，否则空字符串",
      "prompt": "可直接给AI生图的完整中文提示词，必须包含产品外观约束、场景、构图、光影、材质、风格",
      "negativePrompt": "禁止项"
    }
  ]
}`;
}

async function analyzeProduct(options = {}) {
  const productBrief = String(options.productBrief || '').trim();
  if (!productBrief) {
    return { success: false, message: '请先输入或上传产品介绍、参数或卖点资料。' };
  }

  const config = await getLLMConfig();
  if (!config) {
    return {
      success: false,
      needConfig: true,
      message: '未配置 LLM API Key，无法分析产品资料。请先在系统设置中配置模型。',
    };
  }

  const systemPrompt = buildProductSystemPrompt(options);
  const userPrompt = [
    options.productName ? `产品名称：${options.productName}` : '',
    `产品资料：\n${productBrief.slice(0, 30000)}`,
    options.referenceSummary ? `参考图备注：${options.referenceSummary}` : '',
  ].filter(Boolean).join('\n\n');

  const result = await llmService.complete({ ...config, temperature: 0.2 }, systemPrompt, userPrompt);
  if (!result?.content?.trim()) {
    return { success: false, message: 'LLM 返回空内容，产品方案生成失败。' };
  }

  const parsed = extractJsonFromLLMResponse(result.content);
  const normalizedPlan = normalizeProductPlan(parsed);
  if (!parsed || typeof parsed !== 'object' || normalizedPlan.items.length === 0) {
    logger.warn('[productAutomation] LLM product plan parse failed', {
      productName: options.productName || '',
      contentPreview: result.content.slice(0, 2000),
      parsedType: parsed ? typeof parsed : 'null',
      parsedKeys: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed).slice(0, 20) : [],
    });
    return {
      success: false,
      message: parsed
        ? 'AI 返回内容已解析，但没有找到产品图方案 items 数组。请重试，或减少资料长度后再分析。'
        : 'AI 返回内容无法解析为产品图方案 JSON。请重试，或减少资料长度后再分析。',
      rawResponse: result.content,
    };
  }

  const items = normalizedPlan.items
    .slice(0, Math.max(1, Number(options.imageCount) || 6))
    .map((item, index) => normalizePlanItem(item, index, options.includeText));

  return {
    success: true,
    strategy: normalizedPlan.strategy || {},
    items,
    rawResponse: result.content,
  };
}

function composePrompt(item, job) {
  const refs = (job.referenceImages || [])
    .map((r) => [r.name, r.note].filter(Boolean).join('：'))
    .filter(Boolean)
    .join('；');
  const textRule = item.includeText || job.config.includeText
    ? `允许画面中出现简洁电商文案：${item.copywriting || '仅使用产品资料中可信卖点，不虚构参数。'}`
    : '画面中不要出现任何文字、字母、数字、参数表、水印或Logo之外的额外字样。';

  return [
    '生成一张高质量产品电商图片，必须严格保持参考图中的产品外观、结构、颜色、比例和关键部件一致。',
    job.strategy?.visualDirection ? `【视觉策略】${toText(job.strategy.visualDirection)}` : '',
    job.strategy?.coreSellingPoints ? `【核心卖点】${toText(job.strategy.coreSellingPoints)}` : '',
    refs ? `【产品参考图约束】${refs}` : '【产品参考图约束】以用户上传的产品图为准，不改变产品本体。',
    job.customStylePrompt ? `【风格补充】${job.customStylePrompt}` : '',
    job.config.qualityTags ? `【画质要求】${job.config.qualityTags}` : '',
    `【图片类型】${item.imageType || item.title}`,
    item.objective ? `【转化目标】${item.objective}` : '',
    item.scene ? `【场景】${item.scene}` : '',
    item.composition ? `【构图】${item.composition}` : '',
    item.lighting ? `【光影】${item.lighting}` : '',
    `【文字策略】${textRule}`,
    `【核心提示词】${item.prompt}`,
    `【禁止】${item.negativePrompt || '产品变形、颜色错误、结构改变、虚构功能、乱码文字、水印、低清晰度、过度杂乱、主体缺失'}`,
  ].filter(Boolean).join('\n');
}

async function refsToApiImages(referenceImages = []) {
  const urls = [];
  for (const ref of referenceImages.slice(0, 4)) {
    if (!ref.url) continue;
    if (ref.url.startsWith('/uploads/') || ref.url.startsWith('/local_storage/')) {
      try {
        const dataUri = await urlToBase64(ref.url);
        if (dataUri) urls.push(dataUri);
      } catch (err) {
        logger.warn('[productAutomation] reference to base64 failed', { url: ref.url, error: err.message });
      }
    } else if (/^https?:\/\//i.test(ref.url)) {
      urls.push(ref.url);
    }
  }
  return urls;
}

async function processJob(jobId) {
  const queueCtx = { abort: false };
  activeQueues.set(jobId, queueCtx);

  try {
    let job = await ProductAutomationJob.findByPk(jobId);
    if (!job || job.status === 'running') return;
    await ProductAutomationJob.updateById(jobId, { status: 'running', abortFlag: false });
    job = await ProductAutomationJob.findByPk(jobId);

    const activeItems = job.items.filter((item) => item.includeInGeneration !== false);
    const refUrlsForApi = await refsToApiImages(job.referenceImages);

    for (const item of activeItems) {
      if (queueCtx.abort) {
        await ProductAutomationJob.updateById(jobId, { status: 'failed', abortFlag: true });
        return;
      }

      await ProductAutomationJob.updateItem(jobId, item.imageNumber, { status: 'generating', error: null });
      const model = job.config.model;
      const pointsCost = MODEL_POINTS[model] || 2;
      const composedPrompt = composePrompt(item, job);

      try {
        const deductResult = await deductPoints(pointsCost, `产品图自动化|模型:${model}`);
        if (!deductResult.success) throw new Error(deductResult.message);

        const imageUrl = await generateImage({
          prompt: composedPrompt,
          model,
          aspectRatio: job.config.aspectRatio,
          imageSize: job.config.imageSize,
          referenceImages: refUrlsForApi,
        });

        const record = await Generation.create({
          originalPrompt: item.prompt,
          apiPrompt: composedPrompt,
          aspectRatio: job.config.aspectRatio,
          imageSize: job.config.imageSize,
          resultImageUrl: imageUrl,
          referenceImages: job.referenceImages,
          apiProvider: 'grsai',
          modelName: model,
          userId: null,
          pointsCost,
        });

        await confirmDeduct(deductResult.balance, pointsCost, `产品图自动化|模型:${model}`);

        const localPath = await saveImageLocal(imageUrl, {
          id: record.id,
          model,
          provider: 'grsai',
          prompt: item.prompt,
        });
        const finalUrl = localPath ? localPathToUrl(localPath) : imageUrl;
        if (localPath) await Generation.updateById(record.id, { resultImageUrl: finalUrl });

        await ProductAutomationJob.updateItem(jobId, item.imageNumber, {
          status: 'completed',
          resultImageUrl: finalUrl,
          generatedPrompt: composedPrompt,
          matchedReferences: job.referenceImages,
          recordId: record.id,
        });
      } catch (err) {
        logger.warn('[productAutomation] image generation failed', { jobId, imageNumber: item.imageNumber, error: err.message });
        await ProductAutomationJob.updateItem(jobId, item.imageNumber, {
          status: 'failed',
          error: err.message,
          generatedPrompt: composedPrompt,
        });
      }
    }

    const updated = await ProductAutomationJob.findByPk(jobId);
    const hasFailed = updated.items.some((item) => item.includeInGeneration !== false && item.status === 'failed');
    await ProductAutomationJob.updateById(jobId, { status: hasFailed ? 'failed' : 'completed' });
  } finally {
    activeQueues.delete(jobId);
  }
}

module.exports = {
  analyzeProduct,
  processJob,
  activeQueues,
  MODEL_POINTS,
  STYLE_LABELS,
  composePrompt,
};
