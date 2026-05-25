const { StyleProfile } = require('../models/styleProfileModel');

/**
 * 基于用户输入和已有风格画像，构建风格感知的 Prompt
 * 核心原理：RAG + Prompt 注入，模拟风格记忆（非模型微调）
 */

async function extractStyleIntent(userInput) {
  const input = (userInput || '').trim();
  if (!input) return { styleName: null, productName: null, modifications: [] };

  // 规则提取 + 关键词匹配（轻量级，不依赖 LLM）
  const result = { styleName: null, productName: null, modifications: [] };

  // 检测风格引用："按上次X风格" / "用X的风格" / "参照X"
  const stylePatterns = [
    /按[上次的]*[「"](.+?)["」]的?风格/,
    /用[「"](.+?)["」]的?风格/,
    /参照[「"](.+?)["」]/,
    /按(.+?)的?风格做/,
    /用(.+?)风格/,
  ];
  for (const pattern of stylePatterns) {
    const match = input.match(pattern);
    if (match) { result.styleName = match[1].trim(); break; }
  }

  // 检测产品名："做一张X的图" / "B产品的海报"
  const productPatterns = [
    /做一张[「"](.+?)["」]的图/,
    /做(.+?)的?[图海报]/,
    /生成[「"](.+?)["」]/,
    /给(.+?)做/,
  ];
  for (const pattern of productPatterns) {
    const match = input.match(pattern);
    if (match) { result.productName = match[1].trim(); break; }
  }

  // 检测微调指令
  const modPatterns = [
    /(字再?[大小]一点)/,
    /(色调再?[暖冷暖]?一[些点])/,
    /(往[左右]移)/,
    /(亮一点|暗一点)/,
    /(对比度[高低]一点)/,
  ];
  for (const pattern of modPatterns) {
    const match = input.match(pattern);
    if (match) { result.modifications.push(match[1]); break; }
  }

  return result;
}

async function matchStyleProfile(intent, allProfiles) {
  if (!intent.styleName) return null;

  const query = intent.styleName.toLowerCase();

  // 精确名称匹配
  let best = allProfiles.find((p) => (p.name || '').toLowerCase() === query);
  if (best) return best;

  // 部分名称匹配
  best = allProfiles.find((p) => (p.name || '').toLowerCase().includes(query));
  if (best) return best;

  // 标签匹配
  best = allProfiles.find(
    (p) => Array.isArray(p.tags) && p.tags.some((t) => (t || '').toLowerCase().includes(query))
  );
  if (best) return best;

  // 模糊匹配：描述中包含查询词
  best = allProfiles.find(
    (p) => (p.description || '').toLowerCase().includes(query)
  );
  return best || null;
}

function buildStyleAwarePrompt(intent, matchedProfile, userInput, basePrompt) {
  if (!matchedProfile) return basePrompt;

  const parts = [];

  // 注入风格约束
  parts.push(`[风格约束 - 自动注入]`);
  parts.push(`参考风格: ${matchedProfile.name}`);
  if (matchedProfile.description) {
    parts.push(`风格描述: ${matchedProfile.description}`);
  }
  if (matchedProfile.promptTemplate) {
    parts.push(`风格Prompt模板: ${matchedProfile.promptTemplate}`);
  }

  // 注入参数约束
  const params = matchedProfile.parameters || {};
  if (params.negativePrompt) {
    parts.push(`负向Prompt: ${params.negativePrompt}`);
  }

  // 处理微调指令
  if (intent.modifications.length > 0) {
    parts.push(`微调指令: ${intent.modifications.join(', ')}`);
  }

  // 产品替换
  if (intent.productName) {
    parts.push(`目标产品: ${intent.productName}`);
  }

  parts.push('');
  parts.push(`[原始请求]`);
  parts.push(userInput);
  parts.push('');
  parts.push(`[基础Prompt]`);
  parts.push(basePrompt);

  return parts.join('\n');
}

module.exports = { extractStyleIntent, matchStyleProfile, buildStyleAwarePrompt };
