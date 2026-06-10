/**
 * 智能知识库搜索服务
 * 支持：中英文混合、模糊匹配、关键词提取、相关性排序、多模态内容
 */

// ============== 同义词/关联词映射表 ==============
// 可扩展：添加更多产品名、关键词的关联映射
const SYNONYMS_MAP = {
  // 产品名变体
  'bpro': ['enbon', 'b pro', 'b-pro', '恩邦', '恩 bon'],
  'enbon': ['bpro', 'b pro', 'b-pro'],
  'led': ['显示屏', '屏幕', 'led屏幕', 'led display', 'display'],
  '显示屏': ['led', '屏幕', 'led屏幕'],
  '屏幕': ['led', '显示屏', 'display'],
  
  // 品类词
  '产品': ['product', 'spec', 'specs', '参数', '规格'],
  '营销': ['marketing', '推广', '宣传', '广告', '文案', 'copy'],
  '技术': ['technical', 'tech', '技术参数', '参数'],
  '方案': ['solution', '解决方案', '应用', '场景'],
  '手册': ['manual', '指南', '使用说明', '文档'],
  
  // R5 系列产品变体（中文 ↔ 英文文档名映射）
  // 产品文档为英文名（如 R5-Curve-rental），搜索时需支持中文查询
  '任意弧': ['curve', 'curved', 'flexible', 'r5-curve', 'r5 curve'],
  'curve': ['任意弧', 'curved', 'flexible', 'r5-curve', 'r5 curve'],
  '直角锁': ['straight', 'right angle', 'r5-straight', 'r5 straight'],
  'straight': ['直角锁', 'right angle', '直角', 'r5-straight', 'r5 straight'],
  '弧形锁': ['arc', 'arched', 'r5-arc', 'r5 arc'],
  'arc': ['弧形锁', 'arched', '弧形', 'r5-arc', 'r5 arc'],
  '90°': ['90-degree', '90 degree', 'right angle', '90°直角', '直角', 'r5-90'],
  '90-degree': ['90°', '直角', 'right angle', 'r5-90'],
  'r5': ['r5系列', 'R5'],
  'r5系列': ['r5', 'r5 series'],

  // 功能词
  '规格': ['spec', 'specs', '参数', 'parameter', 'specifications'],
  '特点': ['feature', 'features', '特性', '优势'],
  '优势': ['advantage', 'advantages', '卖点', 'usp', '特点'],
  '应用': ['application', 'use case', '场景', '场景应用'],
  '安装': ['installation', 'install', 'setup', '搭建'],
  '维护': ['maintenance', 'maintain', '维修'],
  
  // 关键词（从知识库内容提取）
  'novastar': ['诺瓦', '控制卡', '接收卡'],
  '3840': ['高刷新', '刷新率', '刷新'],
  'ip65': ['防水', '防尘', '户外', '室外'],
  '576': ['尺寸', '箱体尺寸', ' cabinet'],
  'refresh': ['刷新率', 'hz', '刷新'],
  'pixel': ['像素', '点间距', '间距'],
};

// ============== 停用词表 ==============
const STOP_WORDS = new Set([
  '的', '了', '和', '是', '在', '有', '我', '你', '他', '她', '它',
  '这', '那', '个', '一', '上', '下', '中', '大', '小', '多', '少',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'to', 'of', 'in', 'for', 'on', 'with',
  'at', 'by', 'from', 'as', 'or', 'and', 'but', 'not', 'no', 'yes',
  'please', '帮我', '生成', '需要', '要求', '一下', '一个', '什么',
  '怎么', '如何', '吗', '呢', '吧', '啊', '哦', '嗯', '好的',
  '帮我生成', '请', '需要生成',
]);

// ============== 工具函数 ==============

/**
 * 分词：支持中英文混合分词
 */
function tokenize(text) {
  if (!text) return [];
  
  // 移除特殊字符，保留中英文和数字
  const cleaned = text.replace(/[^\w\s\u4e00-\u9fa5]/g, ' ');
  
  // 分割
  const tokens = cleaned.split(/\s+/).filter(t => t.length > 0);
  
  // 进一步分割混合字符串（如 "BPro产品" → ["BPro", "产品"]）
  const result = [];
  const mixedPattern = /([a-zA-Z]+)|(\d+(?:\.\d+)?)|([\u4e00-\u9fa5]+)/g;
  
  for (const token of tokens) {
    if (token.length <= 3) {
      // 短词直接保留
      result.push(token.toLowerCase());
    } else {
      // 长词尝试再分割
      const parts = token.match(mixedPattern);
      if (parts) {
        result.push(...parts.map(p => p.toLowerCase()));
      } else {
        result.push(token.toLowerCase());
      }
    }
  }
  
  return [...new Set(result.filter(t => t.length > 0))];
}

/**
 * 判断是否为停用词
 */
function isStopWord(token) {
  return STOP_WORDS.has(token.toLowerCase());
}

/**
 * 获取有效关键词（去除停用词）
 */
function extractKeywords(text) {
  const tokens = tokenize(text);
  return tokens.filter(t => !isStopWord(t) && t.length > 1);
}

/**
 * 扩展关键词：加入同义词和关联词
 */
function expandKeywords(keywords) {
  const expanded = new Set(keywords);
  
  for (const keyword of keywords) {
    const lower = keyword.toLowerCase();
    
    // 添加同义词
    const synonyms = SYNONYMS_MAP[lower];
    if (synonyms) {
      synonyms.forEach(s => expanded.add(s.toLowerCase()));
    }
    
    // 添加包含关系（如 "bpro" 包含在 "bpro产品" 中）
    // 反向：搜索更短的变体
    for (const [key, values] of Object.entries(SYNONYMS_MAP)) {
      if (lower.includes(key) || key.includes(lower)) {
        values.forEach(v => expanded.add(v.toLowerCase()));
        expanded.add(key);
      }
    }
  }
  
  return [...expanded];
}

/**
 * 计算两个文本的相似度（基于关键词重叠）
 * 返回 0-1 的分数
 */
function calculateSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;
  
  const tokens1 = new Set(extractKeywords(text1));
  const tokens2 = new Set(extractKeywords(text2));
  
  if (tokens1.size === 0 || tokens2.size === 0) return 0;
  
  // Jaccard 相似度
  const intersection = [...tokens1].filter(t => tokens2.has(t)).length;
  const union = new Set([...tokens1, ...tokens2]).size;
  
  // 额外加分：精确匹配
  const text1Lower = text1.toLowerCase();
  const text2Lower = text2.toLowerCase();
  const exactBonus = text1Lower.includes(text2Lower) || text2Lower.includes(text1Lower) ? 0.3 : 0;
  
  const jaccard = intersection / union;
  return Math.min(1, jaccard + exactBonus);
}

/**
 * 检查关键词是否作为独立 token 出现在文本中（非更长英文/数字 token 的子串）
 * 中文关键词天然有边界（汉字不是 [a-z0-9]），无需额外检查
 * "R5" 在 "R5 直角锁" → 独立token ✓
 * "R5" 在 "R5Plus 直角锁" → 被吞入 "R5Plus" 这个更长token ✗
 */
function isBoundaryMatch(kw, text) {
  const lowerText = text.toLowerCase();
  const lowerKw = kw.toLowerCase();
  const idx = lowerText.indexOf(lowerKw);
  if (idx === -1) return false;

  // 只有纯英文/数字关键词才需要边界检查（如产品型号 R5, BPro, RS40）
  // 中文关键词自带边界，includes 即有效匹配
  if (!/^[a-z0-9\s\-]+$/i.test(lowerKw)) return true;

  const before = idx > 0 ? lowerText[idx - 1] : ' ';
  const after = idx + lowerKw.length < lowerText.length ? lowerText[idx + lowerKw.length] : ' ';
  return !/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after);
}

/**
 * 关键词匹配得分：完整 token 匹配得全分，子串匹配仅得 20%
 */
function keywordMatchScore(kw, text, fullPoints) {
  if (!text || !kw) return 0;
  const lowerText = text.toLowerCase();
  const lowerKw = kw.toLowerCase();
  if (!lowerText.includes(lowerKw)) return 0;

  if (isBoundaryMatch(kw, text)) return fullPoints;
  // 子串匹配（如 R5 匹配到 R5Plus）→ 降分至 5%，几乎不计入
  return fullPoints * 0.05;
}

/**
 * 计算单条知识与查询的相关性分数
 */
function scoreItem(item, queryKeywords, expandedKeywords) {
  let score = 0;

  // 1. 文件夹路径匹配（新增：文件夹名直接命中时高权重）
  const folderLower = ((item.folder || item.category || '')).toLowerCase();
  const folderParts = folderLower.split('/').filter(Boolean);
  for (const kw of queryKeywords) {
    for (const fp of folderParts) {
      if (fp.includes(kw) || kw.includes(fp)) {
        score += 12; // 文件夹名匹配 — 高权重
      }
    }
  }
  for (const kw of expandedKeywords) {
    for (const fp of folderParts) {
      if ((fp.includes(kw) || kw.includes(fp)) && !queryKeywords.some(qk => fp.includes(qk) || qk.includes(fp))) {
        score += 6;
      }
    }
  }

  // 2. 文件名/原始文件名匹配（支持产品型号 token 边界）
  if (item.originalName) {
    const origLower = item.originalName.toLowerCase();
    for (const kw of queryKeywords) {
      const pts = keywordMatchScore(kw, origLower, 11);
      if (pts > 0) score += pts;
    }
    for (const kw of expandedKeywords) {
      if (origLower.includes(kw) && !queryKeywords.some(qk => origLower.includes(qk))) {
        score += 5;
      }
    }
  }

  // 3. 标题匹配
  if (item.title) {
    const titleLower = item.title.toLowerCase();
    for (const kw of queryKeywords) {
      const pts = keywordMatchScore(kw, titleLower, 10);
      if (pts > 0) score += pts;
    }
    for (const kw of expandedKeywords) {
      if (titleLower.includes(kw) && !queryKeywords.some(qk => titleLower.includes(qk))) {
        score += 5;
      }
    }
  }

  // 4. 内容匹配
  if (item.content) {
    const contentLower = item.content.toLowerCase();
    for (const kw of queryKeywords) {
      const pts = keywordMatchScore(kw, contentLower, 3);
      if (pts > 0) score += pts;
    }
    for (const kw of expandedKeywords) {
      if (contentLower.includes(kw) && !queryKeywords.some(qk => contentLower.includes(qk))) {
        score += 1;
      }
    }
  }

  // 5. 元数据匹配
  if (item.metadata) {
    const metaStr = JSON.stringify(item.metadata).toLowerCase();
    for (const kw of queryKeywords) {
      if (metaStr.includes(kw)) {
        score += 2;
      }
    }
  }

  // 6. 模糊匹配：计算文本相似度
  const combinedText = `${item.folder || ''} ${item.originalName || ''} ${item.title || ''} ${item.content || ''} ${JSON.stringify(item.metadata || {})}`;
  for (const kw of expandedKeywords) {
    const sim = calculateSimilarity(kw, combinedText);
    if (sim > 0.3) {
      score += sim * 5;
    }
  }

  // 7. 类别匹配加分
  if (item.category) {
    for (const kw of [...queryKeywords, ...expandedKeywords]) {
      if (item.category.toLowerCase().includes(kw)) {
        score += 2;
      }
    }
  }

  // 8. 精确产品名匹配（最高优先级）
  const productNames = ['bpro', 'enbon', 'enbon bpro'];
  for (const pn of productNames) {
    const fullText = `${item.title || ''} ${item.content || ''} ${item.folder || ''}`.toLowerCase();
    if (fullText.includes(pn)) {
      for (const kw of queryKeywords) {
        if (kw.includes(pn) || pn.includes(kw)) {
          score += 20;
        }
      }
    }
  }

  return score;
}

/**
 * 判断知识库内容是否为图片/多媒体
 */
function isMultimedia(item) {
  if (!item) return false;

  // 优先用 type 字段判断
  if (item.type === 'image' || item.type === 'video' || item.type === 'audio') return true;

  const url = item.fileUrl || item.content || item.metadata?.url || item.metadata?.imageUrl || '';
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
  const videoExtensions = ['.mp4', '.avi', '.mov', '.wmv', '.webm'];
  const audioExtensions = ['.mp3', '.wav', '.ogg', '.aac', '.flac'];

  const lowerUrl = url.toLowerCase();

  return (
    imageExtensions.some(ext => lowerUrl.endsWith(ext)) ||
    imageExtensions.some(ext => lowerUrl.includes(ext + '?')) ||
    videoExtensions.some(ext => lowerUrl.endsWith(ext)) ||
    audioExtensions.some(ext => lowerUrl.endsWith(ext)) ||
    item.metadata?.type === 'image' ||
    item.metadata?.type === 'video' ||
    item.metadata?.type === 'audio' ||
    item.metadata?.isImage === true ||
    item.metadata?.isVideo === true ||
    item.metadata?.isAudio === true
  );
}

/**
 * 判断是否为图片内容
 */
function isImageContent(item) {
  if (item.type === 'image') return true;
  if (!isMultimedia(item)) return false;
  const url = (item.fileUrl || item.content || item.metadata?.url || item.metadata?.imageUrl || '').toLowerCase();
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'];
  return (
    imageExtensions.some(ext => url.endsWith(ext)) ||
    imageExtensions.some(ext => url.includes(ext + '?')) ||
    item.metadata?.type === 'image' ||
    item.metadata?.isImage === true
  );
}

/**
 * 判断是否为视频内容
 */
function isVideoContent(item) {
  if (!isMultimedia(item)) return false;
  const url = (item.content || item.metadata?.url || '').toLowerCase();
  const videoExtensions = ['.mp4', '.avi', '.mov', '.wmv', '.webm'];
  return (
    videoExtensions.some(ext => url.endsWith(ext)) ||
    item.metadata?.type === 'video' ||
    item.metadata?.isVideo === true
  );
}

/**
 * 判断是否为音频内容
 */
function isAudioContent(item) {
  if (!isMultimedia(item)) return false;
  const url = (item.content || item.metadata?.url || '').toLowerCase();
  const audioExtensions = ['.mp3', '.wav', '.ogg', '.aac', '.flac'];
  return (
    audioExtensions.some(ext => url.endsWith(ext)) ||
    item.metadata?.type === 'audio' ||
    item.metadata?.isAudio === true
  );
}

/**
 * 提取文本内容
 */
function getTextContent(item) {
  if (isMultimedia(item)) {
    // 多媒体内容返回描述性文本
    let desc = '';
    if (isImageContent(item)) desc += '[图片]';
    if (isVideoContent(item)) desc += '[视频]';
    if (isAudioContent(item)) desc += '[音频]';
    desc += ` 文件名: ${item.title || '未命名'}`;
    if (item.metadata?.description) desc += ` 描述: ${item.metadata.description}`;
    if (item.metadata?.alt) desc += ` alt: ${item.metadata.alt}`;
    if (item.content && !item.content.startsWith('http')) {
      desc += ` ${item.content}`;
    }
    return desc;
  }
  return item.content || '';
}

/**
 * 提取图片URL
 */
function getImageUrl(item) {
  if (!isImageContent(item)) return null;
  return item.fileUrl || item.metadata?.url || item.metadata?.imageUrl || item.content || null;
}

/**
 * 提取视频URL
 */
function getVideoUrl(item) {
  if (!isVideoContent(item)) return null;
  return item.metadata?.url || item.content || null;
}

/**
 * 提取音频URL
 */
function getAudioUrl(item) {
  if (!isAudioContent(item)) return null;
  return item.metadata?.url || item.content || null;
}

// ============== 主搜索函数 ==============

/**
 * 智能知识库搜索（增强版：支持文件夹语义、文件名匹配、LLM路由指令）
 * @param {Array} knowledgeList - 知识库列表
 * @param {Object} options - 搜索选项
 * @param {string} options.query - 搜索关键词（支持中文、英文、混合）
 * @param {string} options.category - 分类筛选（可选）
 * @param {string} options.folder - 文件夹路径筛选（可选，支持层级匹配）
 * @param {string[]} options.folders - LLM指定的多个文件夹（优先搜索）
 * @param {string} options.type - 内容类型筛选：'all'|'text'|'image'|'video'|'audio'（默认'all'）
 * @param {number} options.limit - 返回数量限制（默认10）
 * @param {number} options.minScore - 最低相关性分数阈值（默认0.1）
 * @param {boolean} options.preferImages - LLM标记：优先返回图片（用于生图/生视频场景）
 * @returns {Array} 排序后的知识库条目
 */
function intelligentSearch(knowledgeList, options = {}) {
  const {
    query = '',
    category = null,
    folder = null,
    folders = null,       // LLM 指定的多个文件夹
    type = 'all',
    limit = 10,
    minScore = 0.1,
    preferImages = false,
  } = options;

  // 1. 提取关键词
  const keywords = extractKeywords(query);
  // 从文件夹路径提取额外关键词
  const folderKeywords = [];
  if (folder) {
    folderKeywords.push(...folder.split('/').filter(Boolean));
  }
  if (Array.isArray(folders)) {
    for (const f of folders) {
      if (typeof f === 'string') folderKeywords.push(...f.split('/').filter(Boolean));
    }
  }
  const allKeywords = [...new Set([...keywords, ...folderKeywords])];
  const expandedKeywords = expandKeywords(allKeywords);

  console.log(`[知识库搜索] 原始查询: "${query}"`);
  console.log(`[知识库搜索] 文件夹: ${folder || '无'}, LLM指定: ${JSON.stringify(folders || [])}`);
  console.log(`[知识库搜索] 关键词: [${allKeywords.join(', ')}]`);
  console.log(`[知识库搜索] 扩展关键词: [${expandedKeywords.join(', ')}]`);

  // 2. 过滤和评分
  let candidates = [...knowledgeList];

  // 按文件夹过滤（支持层级匹配）
  if (folder || (Array.isArray(folders) && folders.length > 0)) {
    const targetFolders = new Set();
    if (folder) targetFolders.add(folder.replace(/\/$/, ''));
    if (Array.isArray(folders)) {
      for (const f of folders) {
        if (typeof f === 'string') targetFolders.add(f.replace(/\/$/, ''));
      }
    }
    const beforeFolder = candidates.length;
    candidates = candidates.filter(k => {
      const kf = (k.folder || k.category || '').replace(/\/$/, '');
      // 精确匹配或子文件夹匹配
      for (const tf of targetFolders) {
        if (kf === tf || kf.startsWith(tf + '/') || tf.startsWith(kf + '/')) return true;
      }
      return false;
    });
    console.log(`[知识库搜索] 文件夹过滤: [${[...targetFolders].join(', ')}], 剩余 ${candidates.length} 条 (从 ${beforeFolder})`);
  } else if (category) {
    // 兼容旧的 category 过滤
    candidates = candidates.filter(k => k.category === category);
    console.log(`[知识库搜索] 类别过滤: ${category}, 剩余 ${candidates.length} 条`);
  }

  // 按类型过滤
  if (type !== 'all') {
    const beforeCount = candidates.length;
    if (type === 'image') {
      candidates = candidates.filter(k => isImageContent(k));
    } else if (type === 'video') {
      candidates = candidates.filter(k => isVideoContent(k));
    } else if (type === 'audio') {
      candidates = candidates.filter(k => isAudioContent(k));
    } else if (type === 'text') {
      candidates = candidates.filter(k => !isMultimedia(k));
    }
    console.log(`[知识库搜索] 类型过滤: ${type}, 剩余 ${candidates.length} 条 (从 ${beforeCount})`);
  }

  // 产品型号精确过滤：查询中含英文/数字型号关键词时，排除不包含该型号的文件
  // 如搜 "R5" 排除 "R5Plus"，搜 "FC Pro" 排除 "BPro"
  const modelKeywords = allKeywords.filter(k => /^[a-z0-9\s]+$/i.test(k) && k.length >= 2);
  if (modelKeywords.length > 0) {
    const beforeModel = candidates.length;
    candidates = candidates.filter(item => {
      const text = `${item.title || ''} ${item.originalName || ''} ${item.folder || ''}`;
      return modelKeywords.some(k => isBoundaryMatch(k, text));
    });
    if (candidates.length < beforeModel) {
      console.log(`[知识库搜索] 型号过滤: [${modelKeywords.join(', ')}] 排除 ${beforeModel - candidates.length} 条不同型号的记录`);
    }
  }
  
  // 如果没有查询词，按创建时间和类型偏好排序
  if (!query.trim()) {
    let sorted = [...candidates];
    // 偏好图片优先
    if (preferImages) {
      sorted.sort((a, b) => {
        const aImg = isImageContent(a) ? 1 : 0;
        const bImg = isImageContent(b) ? 1 : 0;
        return bImg - aImg || new Date(b.created_at || 0) - new Date(a.created_at || 0);
      });
    } else {
      sorted.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }
    const result = sorted
      .slice(0, limit)
      .map(item => ({
        ...item,
        _relevanceScore: 1,
        _isText: !isMultimedia(item),
        _isImage: isImageContent(item),
        _isVideo: isVideoContent(item),
        _isAudio: isAudioContent(item),
        _textContent: getTextContent(item),
        _imageUrl: getImageUrl(item),
        _videoUrl: getVideoUrl(item),
        _audioUrl: getAudioUrl(item),
      }));
    console.log(`[知识库搜索] 无查询词，返回 ${result.length} 条${preferImages ? ' (图片优先)' : ''}`);
    return result;
  }
  
  // 评分
  const scored = candidates.map(item => {
    const score = scoreItem(item, keywords, expandedKeywords);
    return {
      ...item,
      _relevanceScore: score,
      _isText: !isMultimedia(item),
      _isImage: isImageContent(item),
      _isVideo: isVideoContent(item),
      _isAudio: isAudioContent(item),
      _textContent: getTextContent(item),
      _imageUrl: getImageUrl(item),
      _videoUrl: getVideoUrl(item),
      _audioUrl: getAudioUrl(item),
    };
  });
  
  // 过滤低于阈值的
  const filtered = scored.filter(item => item._relevanceScore >= minScore);
  
  // 排序（分数高的在前）
  filtered.sort((a, b) => b._relevanceScore - a._relevanceScore);
  
  // 限制数量
  const result = filtered.slice(0, limit);
  
  console.log(`[知识库搜索] 找到 ${result.length} 条相关结果`);
  for (let i = 0; i < Math.min(3, result.length); i++) {
    const item = result[i];
    console.log(`[知识库搜索]   #${i + 1}: "${item.title}" (分数: ${item._relevanceScore.toFixed(2)})`);
  }
  
  return result;
}

module.exports = {
  intelligentSearch,
  extractKeywords,
  expandKeywords,
  calculateSimilarity,
  isMultimedia,
  isImageContent,
  isVideoContent,
  isAudioContent,
  getTextContent,
  getImageUrl,
  getVideoUrl,
  getAudioUrl,
  tokenize,
};
