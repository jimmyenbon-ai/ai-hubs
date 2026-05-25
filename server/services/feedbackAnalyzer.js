const fs = require('fs/promises');
const path = require('path');
const { PromptTemplate } = require('../models/promptTemplateModel');
const { Generation } = require('../models');

const CACHE_DIR = path.join(__dirname, '..', 'cache');
const STATS_FILE = path.join(CACHE_DIR, 'feedback_stats.json');

let stats = { promptPatterns: {}, modelStats: {}, aspectRatioStats: {} };
let loaded = false;

async function loadStats() {
  try {
    const text = await fs.readFile(STATS_FILE, 'utf8');
    if (text.trim()) stats = JSON.parse(text);
  } catch (_) {}
  loaded = true;
}

async function saveStats() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(STATS_FILE, JSON.stringify(stats, null, 2));
}

async function ensureLoaded() {
  if (!loaded) await loadStats();
}

/**
 * 记录反馈，更新统计数据
 */
async function recordFeedback(historyId, feedback, comment) {
  await ensureLoaded();

  const item = await Generation.findByPk(historyId);
  if (!item) return null;

  // 更新历史记录
  await Generation.updateById(historyId, {
    feedback,
    feedbackComment: comment || null,
    feedbackAt: new Date().toISOString(),
  });

  // 更新统计
  if (feedback === 'like') {
    const prompt = item.originalPrompt || '';
    const keywords = extractKeywords(prompt);
    keywords.forEach((kw) => {
      stats.promptPatterns[kw] = (stats.promptPatterns[kw] || 0) + 1;
    });

    const model = item.modelName || 'unknown';
    if (!stats.modelStats[model]) stats.modelStats[model] = { likes: 0, dislikes: 0, total: 0 };
    stats.modelStats[model].likes++;
    stats.modelStats[model].total++;

    const ratio = item.aspectRatio || 'unknown';
    stats.aspectRatioStats[ratio] = (stats.aspectRatioStats[ratio] || 0) + 1;
  } else if (feedback === 'dislike') {
    const model = item.modelName || 'unknown';
    if (!stats.modelStats[model]) stats.modelStats[model] = { likes: 0, dislikes: 0, total: 0 };
    stats.modelStats[model].dislikes++;
    stats.modelStats[model].total++;
  }

  await saveStats();
  return item;
}

/**
 * 获取反馈统计
 */
async function getStats() {
  await ensureLoaded();
  // 按使用次数降序排列的 prompt 模式
  const topPatterns = Object.entries(stats.promptPatterns)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([pattern, count]) => ({ pattern, count }));
  return { promptPatterns: topPatterns, modelStats: stats.modelStats, aspectRatioStats: stats.aspectRatioStats };
}

/**
 * 获取自动推荐：高分 Prompt 模式推荐为提示词模板
 * 条件：同模式被赞 >= 3 次
 */
async function getSuggestions() {
  await ensureLoaded();
  const suggestions = [];

  for (const [pattern, count] of Object.entries(stats.promptPatterns)) {
    if (count >= 3) {
      // 检查是否已存在同名模板
      const existing = await PromptTemplate.findAll({ search: pattern });
      if (existing.length === 0) {
        suggestions.push({ pattern, likeCount: count, suggestedName: `自动推荐: ${pattern}` });
      }
    }
  }

  return suggestions.slice(0, 10);
}

/**
 * 将推荐转为提示词模板
 */
async function convertToTemplate(pattern) {
  const template = await PromptTemplate.create({
    name: `推荐模板: ${pattern}`,
    prompt: pattern,
    contentType: 'image',
    category: '推荐',
    tags: ['自动推荐', '高赞'],
  });
  return template;
}

function extractKeywords(text) {
  if (!text) return [];
  // 提取有意义的词组（2-4 个连续中文字符 或 英文字母组合）
  const keywords = [];
  // 提取中文词组
  const chineseWords = text.match(/[一-鿿]{2,4}/g) || [];
  keywords.push(...chineseWords);
  // 提取英文单词（长度 >= 3）
  const englishWords = text.match(/[a-zA-Z]{3,}/g) || [];
  keywords.push(...englishWords);
  return [...new Set(keywords)].slice(0, 10);
}

module.exports = { recordFeedback, getStats, getSuggestions, convertToTemplate };
