/**
 * StoryboardService — AI视频自动化核心业务逻辑
 * - LLM 剧本分镜分析
 * - Prompt 组合
 * - 逐帧关键帧生成
 */

const llmService = require('./llmService');
const { generateImage } = require('../utils/grsaiClient');
const { StoryboardJob } = require('../models/storyboardModel');
const { Generation, LLMConfig } = require('../models');
const { deductPoints, confirmDeduct } = require('../utils/pointsService');
const { saveImage: saveImageLocal, localPathToUrl } = require('../utils/localStorage');
const { appConfig } = require('../utils/appConfig');
const logger = require('../utils/logger');

// 模型积分映射
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

/**
 * 降级策略：用正则从 LLM 原始文本中提取分镜信息
 * 匹配模式：编号 + 标题 + 描述 的组合
 */
function extractShotsFromText(text) {
  if (!text) return null;

  // 尝试多种正则模式匹配分镜
  const patterns = [
    // 模式1: "第X镜" 或 "镜头X" 或 "Shot X" 格式
    /(?:第\s*(\d+)\s*镜|镜头\s*(\d+)|Shot\s*(\d+)|分镜\s*(\d+))\s*[:：]?\s*(.*?)(?=(?:第\s*\d+\s*镜|镜头\s*\d+|Shot\s*\d+|分镜\s*\d+)|$)/gs,
    // 模式2: "shotNumber": X 格式（JSON片段）
    /"shotNumber"\s*:\s*(\d+)[^}]*?"sceneTitle"\s*:\s*"([^"]*)"[^}]*?"description"\s*:\s*"([^"]*)"/gs,
    // 模式3: 数字编号 + 标题
    /(?:^|\n)\s*(\d+)[\.、．)]\s*(.{2,40}?)(?:\n|$)/gm,
  ];

  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length >= 2) {
      // 至少要有2个匹配才认为是有效的分镜列表
      const shots = matches.map((m, idx) => {
        if (m.length >= 3 && m[1] && m[2] && m[3]) {
          // JSON 片段模式
          return {
            shotNumber: Number(m[1]) || (idx + 1),
            sceneTitle: m[2] || `第${idx + 1}镜`,
            description: m[3] || '',
            characters: [],
            cameraAngle: '',
            lighting: '',
            mood: '',
            keyElements: [],
            estimatedDuration: '',
            status: 'pending',
            resultImageUrl: null,
            generatedPrompt: null,
            error: null,
            recordId: null,
            includeInGeneration: true,
          };
        }
        // 文本模式
        const num = Number(m[1] || m[2] || m[3] || m[4] || (idx + 1));
        const title = (m[5] || m[8] || `第${idx + 1}镜`).trim();
        return {
          shotNumber: num || (idx + 1),
          sceneTitle: title.length > 60 ? title.slice(0, 60) : title,
          description: title,
          characters: [],
          cameraAngle: '',
          lighting: '',
          mood: '',
          keyElements: [],
          estimatedDuration: '',
          status: 'pending',
          resultImageUrl: null,
          generatedPrompt: null,
          error: null,
          recordId: null,
          includeInGeneration: true,
        };
      });
      if (shots.length >= 2) return shots;
    }
  }

  return null;
}

// 活跃队列：jobId → { abort: boolean }
const activeQueues = new Map();

// 每次生图最多传的参考图数量（考虑 base64 编码后请求体积，限制 3 张）
const MAX_REF_IMAGES_PER_SHOT = 3;
// base64 图片最大大小（2MB，防止请求过大）
const MAX_BASE64_SIZE = 2 * 1024 * 1024;

// 风格预设 — 专业导演级风格指导
const STYLE_LABELS = {
  film: '写实电影风格：自然光效为主，电影级调色（柯达2383/富士3513 LUT），35mm胶片颗粒感。构图像经典电影海报，三分法/黄金分割。景深控制精准，前景中景远景层次分明。色调柔和自然，不刻意夸张。参考：科恩兄弟、维伦纽瓦的视觉美学。',
  disney: '迪士尼3D动画电影风格：Pixar/Disney品质的3D渲染。色彩鲜艳饱满但不刺眼，角色造型圆润可爱富有表现力。光线柔和梦幻，常带有God Ray（上帝光）和镜头光晕。构图像动画电影的关键帧，充满叙事感和情绪。材质表现：皮肤次表面散射、布料物理质感、金属反射。参考：冰雪奇缘、疯狂动物城。',
  promotional: '企业宣传片风格：画面干净利落，构图严谨对称或黄金分割。色彩明快但不花哨，以品牌色系为主调。光线均匀专业，避免极端阴影。突出专业感、科技感和品牌调性。适合B2B/B2C品牌视觉传达。镜头语言克制，以中景和特写为主。',
  hollywood: '好莱坞史诗大片风格：强烈的戏剧性光影（chiaroscuro），大景深广角构图。色调以橙青对比（teal-orange）为基调。镜头带有变形宽银幕特有的横向拉丝光晕。画面对比度强烈，高光溢出不刺眼，暗部有细节。构图宏大，人物和场景的体量感强。参考：诺兰、维伦纽瓦的史诗镜头语言。',
  anime: '日式动画剧场版风格：新海诚/宫崎骏级别的手绘感画面。精致的线条、柔和的水彩般色彩过渡、富有表现力的光影。天空和光线是重点表现元素。构图像动画关键帧，带有速度线和动态模糊。色调温暖治愈或清冷淡雅。',
  documentary: '纪录片风格：真实自然的光线，手持摄影的临场感。构图不刻意完美，允许轻微倾斜和失焦。色调以真实还原为主，不过度调色。光线以现场光/自然光优先，少用人工补光。整体呈现真实世界的质感。',
  custom: '',
};

/**
 * 获取 LLM 配置（优先数据库配置 → 设置面板 → 环境变量）
 * 与 aiDialogService 保持一致
 */
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
  } catch (_) { /* ignore */ }

  const dsKey = appConfig.deepseek_api_key;
  if (dsKey) {
    return {
      provider: 'deepseek',
      api_url: appConfig.deepseek_api_url || 'https://api.deepseek.com',
      api_key: dsKey,
      model: appConfig.deepseek_model || 'deepseek-chat',
    };
  }

  return null; // 无可用 LLM 配置
}

/**
 * 构建导演系统提示词
 */
function buildDirectorSystemPrompt(style, customStylePrompt) {
  const styleLabel = STYLE_LABELS[style] || '';
  const styleDesc = style === 'custom'
    ? customStylePrompt
    : `${styleLabel}${customStylePrompt ? '。额外要求：' + customStylePrompt : ''}`;

  return `你是一位世界级电影导演和视觉叙事大师。你的任务是将剧本拆分为专业电影分镜表。

## 你的专业身份
你执导过奥斯卡获奖影片，精通各种风格的视觉语言。你对剧本的改编不是简单拆分，而是进行专业级别的二次创作——该精简的果断舍弃，该突出的着力渲染，用电影的视觉语法重新诠释文字。

## 风格要求
${styleDesc || '根据剧本内容自动判断最佳视觉风格'}

## 分镜创作铁律
1. **叙事提炼**：剧本≠分镜。你要像一个真正的导演那样，识别哪些内容值得用画面呈现，哪些是过渡性的、可以一笔带过。无关紧要的细节大胆舍弃。
2. **视觉冲击**：每个分镜必须是一张可以单独作为电影海报的画面。构图要有"电影感"——三分法、引导线、前景框架、深度层次。
3. **节奏控制**：重要情节点给更多镜头的停留时间，过渡部分快速切换。分镜要有呼吸感，不能均匀用力。
4. **风格一致**：所有分镜的视觉语言必须严格遵循指定的风格要求。构图、光线、色调、景深都要统一在该风格体系内。
5. **AI生图优化**：每个分镜的描述必须写出可以直接输入AI生图模型的高质量视觉描述。用具体的视觉词汇，避免抽象的心理描述。

## 视觉描述规范
- description 字段：200-400字的纯视觉描述。包含构图（前景/中景/远景）、色彩方案、光线方向和质量、材质表现、空间关系。用AI生图能理解的"视觉词汇"，不要写角色内心活动。
- cameraAngle 字段：必须写清楚机位+景别+镜头焦距，例如"35mm广角，中景仰拍"，"85mm长焦，面部特写，浅景深"
- lighting 字段：写清楚光源方向、光质（硬/柔）、色温、光比，例如"左侧45度硬光主光，暖色温3200K，右侧柔光补光减少阴影"
- mood 字段：写画面的情绪基调，用可视化词汇，例如"安静忧郁的蓝色时刻，孤独感通过大面积的负空间表达"
- keyElements 字段：列出画面中必须出现的关键视觉元素，5-10个具体物体/材质/效果

## 分镜数量
- 短剧本（<500字）：5-10个分镜
- 中剧本（500-2000字）：10-20个分镜
- 长剧本（2000-5000字）：20-35个分镜
- 超长剧本（>5000字）：30-50个分镜，但只需要覆盖最核心的情节段落

## 输出格式
严格JSON，不要任何其他文字。如果剧本中出现不适合视觉化的内容（大量心理描写、抽象议论），直接跳过，不用解释：

{"shots":[{"shotNumber":1,"sceneTitle":"...","description":"...","characters":["..."],"cameraAngle":"...","lighting":"...","mood":"...","keyElements":["...","..."],"estimatedDuration":"N秒"}]}

开始分析剧本：`;
}

/**
 * 从 LLM 响应中提取 JSON
 * 支持多种格式：纯JSON、markdown代码块、混有中文说明的JSON
 */
function extractJsonFromLLMResponse(content) {
  if (!content) return null;
  let text = content.trim();
  const originalText = text;

  // 1. 优先匹配 markdown 代码块（支持多个代码块，取最后一个完整的JSON）
  const codeBlocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  if (codeBlocks.length > 0) {
    // 取最后一个（通常是最终结果），或尝试解析所有
    for (let i = codeBlocks.length - 1; i >= 0; i--) {
      const blockText = codeBlocks[i][1].trim();
      const parsed = tryParseJson(blockText);
      if (parsed) return parsed;
    }
    // 如果所有代码块都解析失败，用第一个尝试
    text = codeBlocks[codeBlocks.length - 1][1].trim();
  }

  return tryParseJson(text) || tryExtractAndParse(text);
}

/**
 * 智能提取并解析 JSON
 */
function tryExtractAndParse(text) {
  // 方法1: 找 { ... }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const result = tryParseJson(text.slice(firstBrace, lastBrace + 1));
    if (result) return result;
  }

  // 方法2: 找 [ ... ]
  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const result = tryParseJson(text.slice(firstBracket, lastBracket + 1));
    if (result) return result;
  }

  return null;
}

/**
 * 尝试解析 JSON，失败时尝试修复再解析
 */
function tryParseJson(text) {
  if (!text || !text.trim()) return null;

  // 直接解析
  try {
    const result = JSON.parse(text);
    return result;
  } catch (_) { /* continue */ }

  // 修复常见问题后重试
  try {
    const cleaned = text
      .replace(/,\s*}/g, '}')              // 移除对象尾部逗号
      .replace(/,\s*]/g, ']')              // 移除数组尾部逗号
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // 移除控制字符（保留 \n \t \r）
      .replace(/\t/g, ' ')                 // tab 转空格
      .replace(/\r\n/g, '\n')              // 统一换行
      .replace(/\r/g, '\n');               // 统一换行
    const result = JSON.parse(cleaned);
    return result;
  } catch (_) { /* continue */ }

  return null;
}

function toText(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.filter(Boolean).join('、');
  if (typeof value === 'object') return Object.entries(value)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}:${Array.isArray(v) ? v.join('、') : v}`)
    .join('，');
  return String(value);
}

function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => toText(item)).filter(Boolean);
  return String(value).split(/[、,，;；\n]/).map((item) => item.trim()).filter(Boolean);
}

function normalizeShotForKeyframe(shot = {}, idx = 0) {
  const camera = shot.camera && typeof shot.camera === 'object' ? shot.camera : {};
  const lighting = shot.lighting && typeof shot.lighting === 'object' ? shot.lighting : {};

  // Helper: 如果 lighting 是旧版字符串，升级为对象
  const lightingObj = typeof shot.lighting === 'string'
    ? { style: shot.lighting } // 旧数据兼容
    : {
        style: toText(lighting.style || shot.lighting),
        keyDirection: toText(lighting.keyDirection),
        fillRatio: toText(lighting.fillRatio),
        quality: toText(lighting.quality),
        colorTemp: toText(lighting.colorTemp),
      };

  return {
    shotNumber: Number(shot.shotNumber || shot.number || idx + 1),
    sceneTitle: toText(shot.sceneTitle || shot.title || `镜头${idx + 1}`),
    narrativeBeat: toText(shot.narrativeBeat || shot.beat),
    visualGoal: toText(shot.visualGoal || shot.goal),
    description: toText(shot.description || shot.desc || shot.imagePrompt || ''),
    characters: toArray(shot.characters),
    location: toText(shot.location || shot.scene || shot.place),
    sceneDescription: toText(shot.sceneDescription || shot.environment),
    props: toArray(shot.props || shot.products || shot.objects),
    camera: {
      shotSize: toText(camera.shotSize || shot.shotSize),
      angle: toText(camera.angle || shot.cameraAngle || shot.angle),
      focalLength: toText(camera.focalLength || shot.focalLength),       // 🆕 焦段 mm
      aperture: toText(camera.aperture || shot.aperture),                // 🆕 光圈
      lens: toText(camera.lens || shot.lens),
      composition: toText(camera.composition || shot.composition),       // 🆕 构图法则（结构化）
      position: toText(camera.position || shot.cameraPosition),          // 🆕 摄影机站位
      movement: toText(camera.movement || shot.cameraMovement),
      depthOfField: toText(camera.depthOfField),                         // 🆕 景深
    },
    cameraAngle: toText(shot.cameraAngle || camera.angle || shot.angle),
    lighting: lightingObj,                                               // 🆕 结构化光影
    colorPalette: toText(shot.colorPalette || shot.color),
    mood: toText(shot.mood),
    keyElements: toArray(shot.keyElements || shot.elements),
    continuityNotes: toText(shot.continuityNotes || shot.continuity),
    imagePrompt: toText(shot.imagePrompt || shot.prompt),
    negativePrompt: toText(shot.negativePrompt),
    estimatedDuration: toText(shot.estimatedDuration || shot.duration),
    status: 'pending',
    resultImageUrl: null,
    generatedPrompt: null,
    matchedReferences: [],
    error: null,
    recordId: null,
    includeInGeneration: shot.includeInGeneration !== false,
  };
}

function normalizeProjectAssets(raw = {}) {
  const normalizeAssetGroup = (items) => (Array.isArray(items) ? items : []).map((item, index) => ({
    id: toText(item.id || item.name || `asset-${index + 1}`),
    name: toText(item.name || item.id || `资产${index + 1}`),
    aliases: toArray(item.aliases),
    description: toText(item.description),
    visualPrompt: toText(item.visualPrompt || item.prompt),
    negativePrompt: toText(item.negativePrompt),
    continuityRules: toText(item.continuityRules || item.rules),
    sourceEvidence: toText(item.sourceEvidence || item.evidence),
    importance: toText(item.importance || 'normal'),
  }));

  return {
    characters: normalizeAssetGroup(raw.characters),
    locations: normalizeAssetGroup(raw.locations || raw.scenes),
    props: normalizeAssetGroup(raw.props || raw.products || raw.objects),
    visualRules: toText(raw.visualRules),
    styleNotes: toText(raw.styleNotes),
  };
}

function buildDirectorSystemPromptV2(style, customStylePrompt) {
  const styleLabel = STYLE_LABELS[style] || '';
  const styleDesc = style === 'custom'
    ? customStylePrompt
    : `${styleLabel}${customStylePrompt ? `。额外要求：${customStylePrompt}` : ''}`;

  return `你是电影分镜导演和 AI 关键帧提示词专家。请把用户剧本拆成可直接用于 AI 生图的分镜关键帧表。每个镜头必须包含专业的摄影和灯光参数。

目标：
1. 只保留真正需要画面的关键叙事节点，不要流水账。
2. 每个镜头必须是一张清晰、可生成、可检查的单帧画面。
3. 同一角色、同一场景、同一道具的称呼必须前后一致，方便匹配参考图。
4. description 和 imagePrompt 必须描述可见画面，不写抽象心理活动。
5. 摄影参数（焦段、光圈、构图、机位）必须根据场景内容精确选择，不能随意填写。

🔴 场景连续性铁律（最高优先级，违反将导致整组分镜作废）：

【光影连续性】
1. **同一场景 = 同一光影体系**：location相同或同属一个空间（如"办公室"和"办公室-窗边"），则 lighting.style、lighting.keyDirection、lighting.quality、lighting.colorTemp 必须完全一致。不允许"第一镜是午后阳光，第二镜突然变成冷调荧光灯"。
2. **同一场景 = 同一色彩方案**：同一location的所有镜头，colorPalette 必须一致或高度相关（如"暖金+冷灰蓝"→"暖金为主"可以，但"暖金+冷灰蓝"→"蓝紫霓虹"绝对不行）。
3. **光变必须有叙事动机**：如果同一场景内光影必须变化（如时间流逝、灯被关了、窗帘拉上），必须在 continuityNotes 中明确写出变化原因和时间线。

【人物衣着连续性】
4. **同一场景 = 同一着装**：同一角色在同一场景（连续时间）内的服装、发型、配饰必须完全一致。description 和 imagePrompt 中对角色的视觉描述（服装颜色、款式、面料）必须跨镜头锁定。不允许"第一镜穿蓝色西装，第三镜变成灰色毛衣"。
5. **跨场换装要有交代**：如果角色从场景A换到场景B需要换装（如从办公室正装换成雨衣），必须在第一个新场景镜头的 continuityNotes 中注明"角色从XX服装更换为YY服装"。如无注明，视为穿同一套衣服。
6. **角色外观特征锁定**：每个角色第一次出场时，在 description 中写清其核心外观特征（如"李明：35岁，短发，戴黑框眼镜，深蓝色西装，白衬衫，无领带"），后续所有该角色的镜头复用这些特征。

【环境/道具连续性】
7. **同一场景的 sceneDescription 完全复用**：同一 location 的所有镜头，sceneDescription 必须字面相同或仅增加视角说明（如"同一办公室，从另一个角度拍摄"）。场景内的家具布局、窗户位置、房间大小等不能在不同镜头中变化。
8. **道具跨镜锁定**：同一道具在不同镜头中，颜色、尺寸、材质描述必须一致。如果"红色文件夹"在镜头1出现，镜头3中它仍然是"红色文件夹"，不能变成"蓝色文件夹"或"黄色信封"。
9. **天气/时间在同一场景内锁定**：如果场景是"午后阳光充沛的办公室"，该场景所有镜头都必须符合这个设定。不能某些镜头窗外是晴天、另一些是阴天。

【跨场景规则】
10. **不同场景 = 主动切换**：当镜头切换到新 location，光影体系、色彩方案、环境描述必须明确切换为新场景的设定，且在新场景内保持新的一致。
11. **跨场切回时恢复**：如果镜头从场景A→场景B→场景A，场景A的所有参数（光影、色彩、环境描述）必须和之前在该场景的镜头完全一致（除非 continuityNotes 中明确写了叙事时间推进）。

视觉风格：
${styleDesc || '根据剧本自动选择统一、克制、电影感的视觉风格。'}

⚡ 生成全部分镜后的自检清单（在脑中逐条过）：
□ 同一 location 的 lighting.style / colorTemp / quality 是否完全一致？
□ 同一 location 的 colorPalette 是否一致或高度相关？
□ 同一角色的服装描述是否跨镜头锁定？（回读每个 shot 的 description 中对该角色的描述）
□ 同一道具的颜色/材质是否跨镜头一致？
□ 同一 location 的 sceneDescription 是否复用而非重写？
□ 如有任何不一致，立即修正后再输出。

每个 shot 必须包含这些字段：
shotNumber, sceneTitle, narrativeBeat, visualGoal, description, characters, location, sceneDescription, props,
camera{shotSize, angle, focalLength, aperture, composition, position, movement, depthOfField, lens}, lighting{style, keyDirection, fillRatio, quality, colorTemp}, colorPalette, mood,
keyElements, continuityNotes, imagePrompt, negativePrompt, estimatedDuration。

字段详细要求：

【camera 摄影参数 — 结构化】
- shotSize: 景别，从以下选择：大远景/远景/全景/中景/中近景/近景/特写/大特写
- angle: 机位高度角度，从以下选择：平视/俯拍(45°)/俯拍(90°鸟瞰)/仰拍(低角度)/荷兰角(倾斜)/过肩
- focalLength: 焦段数值(mm)，从以下选择：14/18/24/28/35/50/85/105/135/200。根据shotSize和场景需要选择：
  · 大远景/全景 → 14-28mm 广角
  · 中景/中近景 → 35-50mm 标准
  · 近景/特写 → 85-135mm 长焦
  · 大特写 → 135-200mm 超长焦
- aperture: 光圈值，从以下选择：f/1.4(极浅景深)/f/2(浅景深)/f/2.8(浅景深)/f/4(中等)/f/5.6(中等)/f/8(深景深)/f/11(深景深)/f/16(极深)
  · 人物特写/需要虚化背景 → f/1.4~f/2.8
  · 双人对话 → f/2.8~f/4
  · 多人场景/需要看清环境 → f/5.6~f/8
  · 大场景全景 → f/8~f/16
- composition: 构图法则，从以下选择：三分法/中心对称/引导线/框架构图/对角线/负空间/黄金分割/前景遮挡/镜面反射
  · 默认大部分镜头用”三分法”
  · 庄严/正式场景用”中心对称”
  · 纵深感强的场景用”引导线”
- position: 摄影机站位，从以下选择：正面/正侧/前侧45°/后侧45°/背后/过肩/POV主观/俯视/低角度仰拍/远景俯拍
  · 对话场景通常用”前侧45°”或”过肩”
  · 主观感受用”POV主观”
  · 建筑/城市用”远景俯拍”
- movement: 运镜方式，如果该镜头有运镜计划就写，否则写”静止”：静止/推镜/拉镜/摇镜/移镜/跟拍/升降/旋转
- depthOfField: 景深描述，根据aperture推导：浅景深/中等景深/深景深
- lens: 镜头类型描述（保留兼容），如”广角变焦”、”标准定焦”、”长焦远摄”

【lighting 光影参数 — 结构化】
- style: 主光风格，从以下选择：高调光/低调光/自然光/戏剧光/逆光剪影/霓虹/金色时刻(黄昏)/蓝色时刻(黎明)/阴天柔光
- keyDirection: 主光方向，从以下选择：正面光/前侧45°(左)/前侧45°(右)/正侧光(左)/正侧光(右)/侧逆光/正逆光/顶光/底光/伦勃朗光/蝴蝶光/环形光
- fillRatio: 光比(主光:辅光)，从以下选择：1:1(平光)/2:1(柔和立体)/4:1(戏剧性)/8:1(强烈对比)/仅主光(无补光)
- quality: 光质，从以下选择：硬光(清晰阴影)/柔光(柔和阴影)/漫反射(几乎无影)/混合
- colorTemp: 色温，从以下选择：暖调3200K/中性白4300K/中性5600K/冷调7000K/极冷9000K/金色暖调2800K/荧光绿偏/霓虹混色

【characters 角色 — 锁定外观】
- 数组格式，角色名称必须跨镜头一致，例如["李明", "王岚"]。
- 每个角色第一次出场时，description 中必须包含其核心外观特征：年龄、发型/发色、服装颜色和款式、配饰（眼镜/手表/项链等）。
- 后续所有镜头复用同一外观描述，只补充分镜特有的动作/表情/姿态。

【props 道具 — 锁定属性】
- 数组格式，道具名称、颜色、材质必须跨镜头一致。
- 关键道具第一次出现时确定其视觉属性（如"银色金属外壳的智能手表"、"正红色硬皮文件夹A4"），后续完全复用。

【location + sceneDescription — 锁定环境】
- location: 简洁场景名，同一物理空间用同一名称。
- sceneDescription: 同一 location 的所有镜头必须共享同一段环境描述（字面复制）。只允许在末尾追加视角说明如"（从另一个角度）"。

【其他字段】
- imagePrompt: 120-250 字，直接给 AI 生图。整合上述所有摄影和灯光参数，必须包含角色、场景、动作、构图、镜头焦段、机位、光线方向、光质、色温、色彩、材质。
- negativePrompt: 写明禁止项，例如”多余手指、文字水印、角色脸变形、风格不一致”。

输出格式（严格 JSON，不要 markdown）：
{
  “shots”: [
    {
      “shotNumber”: 1,
      “sceneTitle”: “办公室初遇”,
      “narrativeBeat”: “李明进入办公室，第一次见到坐在窗边的王岚”,
      “visualGoal”: “通过窗边逆光塑造王岚的神秘感”,
      “description”: “李明推开玻璃门走进现代化办公室，午后的阳光从王岚身后的落地窗斜射进来，在她身上形成柔和的逆光轮廓。王岚坐在窗边的转椅上，手里拿着一份红色文件夹，微微抬头看向门口。”,
      “characters”: [“李明”, “王岚”],
      “location”: “现代化办公室”,
      “sceneDescription”: “宽敞的开放式办公室，落地窗朝西，午后阳光充沛。灰色地毯、白色办公桌、墙上有抽象画。”,
      “props”: [“红色文件夹”, “玻璃门”, “转椅”],
      “camera”: {
        “shotSize”: “中景”,
        “angle”: “平视”,
        “focalLength”: 50,
        “aperture”: “f/2.8”,
        “composition”: “三分法”,
        “position”: “前侧45°”,
        “movement”: “静止”,
        “depthOfField”: “浅景深”,
        “lens”: “标准定焦”
      },
      “lighting”: {
        “style”: “逆光剪影”,
        “keyDirection”: “正逆光”,
        “fillRatio”: “4:1”,
        “quality”: “柔光”,
        “colorTemp”: “暖调3200K”
      },
      “colorPalette”: “暖金色 + 冷灰蓝”,
      “mood”: “温暖中带一丝神秘”,
      “keyElements”: [“李明推门动作”, “王岚逆光轮廓”, “红色文件夹”, “落地窗阳光”],
      “continuityNotes”: “王岚的红色文件夹是全片关键道具，此镜必须清晰可见”,
      “imagePrompt”: “电影分镜关键帧：中景镜头，50mm焦段，f/2.8浅景深。现代化办公室内，午后暖金色阳光从落地窗照入形成柔和的逆光。王岚坐在窗边转椅上，暖调逆光勾勒出她的侧影轮廓，手里拿着红色文件夹。李明推开玻璃门走进，位于画面左侧三分线处。暖金色与冷灰蓝的色调对比，柔光质感，营造温暖神秘的氛围。皮革转椅质感、玻璃门反射柔和光线。”,
      “negativePrompt”: “多余手指、人物变形、文字水印、logo、完全正面光、硬阴影、冷色调、低画质”,
      “estimatedDuration”: “4秒”
    },
    {
      “shotNumber”: 2,
      “sceneTitle”: “王岚近景反应”,
      “narrativeBeat”: “王岚抬头微笑，回应李明的到来”,
      “visualGoal”: “近景捕捉王岚的表情变化，维持逆光氛围”,
      “description”: “同一办公室。王岚坐在窗边转椅上，逆光中她抬头露出浅浅的微笑——与镜头1相同的深蓝色西装裙、珍珠耳钉。她手中的红色文件夹微微合上。窗外的午后阳光依旧从落地窗斜射进来。”,
      “characters”: [“王岚”],
      “location”: “现代化办公室”,
      “sceneDescription”: “宽敞的开放式办公室，落地窗朝西，午后阳光充沛。灰色地毯、白色办公桌、墙上有抽象画。（近景角度）”,
      “props”: [“红色文件夹”, “转椅”],
      “camera”: {
        “shotSize”: “近景”,
        “angle”: “平视”,
        “focalLength”: 85,
        “aperture”: “f/2”,
        “composition”: “三分法”,
        “position”: “前侧45°”,
        “movement”: “静止”,
        “depthOfField”: “浅景深”,
        “lens”: “长焦远摄”
      },
      “lighting”: {
        “style”: “逆光剪影”,
        “keyDirection”: “正逆光”,
        “fillRatio”: “4:1”,
        “quality”: “柔光”,
        “colorTemp”: “暖调3200K”
      },
      “colorPalette”: “暖金色 + 冷灰蓝”,
      “mood”: “温暖中带一丝神秘”,
      “keyElements”: [“王岚微笑表情”, “逆光轮廓”, “红色文件夹”, “珍珠耳钉”],
      “continuityNotes”: “与镜1同一办公室同一时刻，光线/服装/道具保持完全一致。王岚服装：深蓝色西装裙+珍珠耳钉——已在镜1锁定”,
      “imagePrompt”: “电影分镜关键帧：近景镜头，85mm长焦，f/2极浅景深。同一现代化办公室，午后暖金色逆光。王岚近景侧脸，柔和的逆光勾勒出她的轮廓，深蓝色西装裙的衣领细节清晰，珍珠耳钉微微反光。她露出浅浅的微笑，手中红色文件夹的质感在侧光中呈现。背景虚化可见落地窗和暖金色阳光。”,
      “negativePrompt”: “服装变化、场景不一致、珍珠耳钉消失、光线方向改变、冷色调、低画质”,
      “estimatedDuration”: “3秒”
    }
  ]
}

注意镜2如何复用镜1的：
- location / sceneDescription（尾部追加视角说明）
- lighting 参数（完全字面相同）
- colorPalette / mood（完全相同）
- 角色服装描述（深蓝色西装裙、珍珠耳钉——镜1锁定，镜2照写）
- 道具属性（红色文件夹——跨镜一致）
- 只有 camera 参数根据景别需要变化（中景→近景，50mm→85mm，f/2.8→f/2）

开始分析剧本：`;
}

function buildAssetSystemPrompt(style, customStylePrompt) {
  const styleLabel = STYLE_LABELS[style] || '';
  const styleDesc = style === 'custom'
    ? customStylePrompt
    : `${styleLabel}${customStylePrompt ? `。额外要求：${customStylePrompt}` : ''}`;

  return `你是影视美术指导和 AI 资产设定师。请先从剧本/小说中提取可复用资产圣经，用于后续分镜和关键帧生成。

目标：
1. 不要生成分镜，只提取“会反复出现或影响画面一致性”的资产。
2. 资产名称必须稳定，后续分镜会按这些名称引用。
3. 场景资产要特别详细，包含空间布局、材质、灯光、时代、科技水平和不可偏离项。
4. 对于小说里没有明说但画面必须确定的细节，可以做合理补全，但要写入 continuityRules。

视觉风格：
${styleDesc || '根据剧本文体自动确定统一视觉方向。'}

输出严格 JSON，不要 markdown，不要解释：
{
  "characters":[{"id":"achen","name":"阿辰","aliases":["男主"],"description":"...","visualPrompt":"...","negativePrompt":"...","continuityRules":"...","sourceEvidence":"...","importance":"hero"}],
  "locations":[{"id":"achen-bedroom","name":"阿辰卧室","aliases":["卧室","床边"],"description":"...","visualPrompt":"...","negativePrompt":"...","continuityRules":"...","sourceEvidence":"...","importance":"hero"}],
  "props":[{"id":"hologram-butler","name":"老姜全息投影","aliases":["AI管家","老姜"],"description":"...","visualPrompt":"...","negativePrompt":"...","continuityRules":"...","sourceEvidence":"...","importance":"hero"}],
  "visualRules":"全片统一规则...",
  "styleNotes":"美术和摄影补充..."
}

开始提取资产：`;
}

/**
 * 分析剧本，返回分镜列表
 */
async function analyzeScript({ script, style, customStylePrompt }) {
  const systemPrompt = buildDirectorSystemPromptV2(style, customStylePrompt);

  // 剧本长度限制（DeepSeek 上下文约 64K tokens，预估中文每字约 1.5 tokens）
  const MAX_SCRIPT_LENGTH = 30000; // 约 3万字，预留足够空间给 system prompt + 输出
  let truncatedScript = script;
  let wasTruncated = false;

  if (script.length > MAX_SCRIPT_LENGTH) {
    truncatedScript = script.slice(0, MAX_SCRIPT_LENGTH);
    wasTruncated = true;
    logger.warn('剧本过长，已截断', { originalLength: script.length, truncatedLength: MAX_SCRIPT_LENGTH });
  }

  logger.info('开始LLM分镜分析', { style, scriptLength: truncatedScript.length, wasTruncated });

  // 1. 获取 LLM 配置
  const config = await getLLMConfig();
  if (!config) {
    return {
      success: false,
      message: '未配置 LLM（大模型）API Key。请在「系统设置」中配置 DeepSeek API 密钥，或在「LLM 配置」中添加一个 LLM 提供商。LLM 大脑需要 API Key 才能分析剧本。',
      rawResponse: null,
      needConfig: true,
    };
  }

  try {
    const result = await llmService.complete(config, systemPrompt, truncatedScript);

    logger.info('LLM分镜分析完成', {
      contentLength: result?.content?.length,
      model: result?.model,
      wasTruncated,
    });

    // 检查是否返回了空内容
    if (!result || !result.content || !result.content.trim()) {
      return {
        success: false,
        message: 'LLM 返回了空内容。可能是 API Key 无效、模型不可用或请求被拒绝。请检查 LLM 配置。',
        rawResponse: JSON.stringify(result || {}),
      };
    }

    const parsed = extractJsonFromLLMResponse(result.content);

    if (parsed && parsed.shots && Array.isArray(parsed.shots)) {
      // 标准化分镜数据
      const shots = parsed.shots.map((shot, idx) => ({
        shotNumber: shot.shotNumber || idx + 1,
        sceneTitle: shot.sceneTitle || `第${idx + 1}镜`,
        description: shot.description || '',
        characters: Array.isArray(shot.characters) ? shot.characters : [],
        cameraAngle: shot.cameraAngle || '',
        lighting: shot.lighting || '',
        mood: shot.mood || '',
        keyElements: Array.isArray(shot.keyElements) ? shot.keyElements : [],
        estimatedDuration: shot.estimatedDuration || '',
        status: 'pending',
        resultImageUrl: null,
        generatedPrompt: null,
        error: null,
        recordId: null,
        includeInGeneration: true,
      }));
      return { success: true, shots: parsed.shots.map(normalizeShotForKeyframe), rawResponse: result.content, wasTruncated };
    }

    // 尝试从 content 中直接找 shots 数组
    if (parsed && Array.isArray(parsed)) {
      const shots = parsed.map((shot, idx) => ({
        shotNumber: shot.shotNumber || shot.number || idx + 1,
        sceneTitle: shot.sceneTitle || shot.title || `第${idx + 1}镜`,
        description: shot.description || shot.desc || '',
        characters: Array.isArray(shot.characters) ? shot.characters : [],
        cameraAngle: shot.cameraAngle || shot.angle || '',
        lighting: shot.lighting || '',
        mood: shot.mood || '',
        keyElements: Array.isArray(shot.keyElements) ? shot.keyElements : [],
        estimatedDuration: shot.estimatedDuration || shot.duration || '',
        status: 'pending',
        resultImageUrl: null,
        generatedPrompt: null,
        error: null,
        recordId: null,
        includeInGeneration: true,
      }));
      return { success: true, shots: parsed.map(normalizeShotForKeyframe), rawResponse: result.content };
    }

    // === JSON 解析失败时的降级策略 ===

    // 策略1: 用正则从原始文本中提取分镜信息
    const fallbackShots = extractShotsFromText(result.content);
    if (fallbackShots && fallbackShots.length > 0) {
      logger.info('LLM分镜：使用正则降级提取成功', { shotCount: fallbackShots.length });
      return { success: true, shots: fallbackShots.map(normalizeShotForKeyframe), rawResponse: result.content, extractedByFallback: true };
    }

    // 策略2: 完整失败，返回原始响应供用户参考
    logger.warn('LLM分镜JSON解析失败，返回原始文本', { contentPreview: result.content?.slice(0, 500) });
    return {
      success: false,
      message: 'AI 返回了内容，但格式无法自动解析。原始响应已在右侧面板展示。您可以点击「重新分镜」重试，或参考原始内容手动创建分镜。提示：脚本过长可能导致 JSON 被截断，建议分段提交。',
      rawResponse: result.content,
    };
  } catch (err) {
    logger.error('LLM分镜分析异常', { error: err.message });
    // 提供更友好的错误信息
    if (err.message.includes('401') || err.message.includes('Unauthorized') || err.message.includes('auth')) {
      return {
        success: false,
        message: `LLM API 认证失败：${err.message}。请检查「系统设置」中的 DeepSeek API Key 是否正确。`,
        rawResponse: null,
      };
    }
    if (err.message.includes('timeout') || err.message.includes('超时')) {
      return {
        success: false,
        message: `LLM API 请求超时：${err.message}。请在设置中检查 API 地址和模型名是否正确。`,
        rawResponse: null,
      };
    }
    throw new Error(`AI 分镜分析失败：${err.message}`);
  }
}

async function analyzeAssets({ script, style, customStylePrompt }) {
  const systemPrompt = buildAssetSystemPrompt(style, customStylePrompt);
  const MAX_SCRIPT_LENGTH = 30000;
  const truncatedScript = script.length > MAX_SCRIPT_LENGTH ? script.slice(0, MAX_SCRIPT_LENGTH) : script;
  const wasTruncated = script.length > MAX_SCRIPT_LENGTH;

  const config = await getLLMConfig();
  if (!config) {
    return {
      success: false,
      message: '未配置 LLM API Key，无法提取资产圣经。',
      needConfig: true,
    };
  }

  const result = await llmService.complete(config, systemPrompt, truncatedScript);
  if (!result?.content?.trim()) {
    return {
      success: false,
      message: 'LLM 返回空内容，资产提取失败。',
      rawResponse: JSON.stringify(result || {}),
    };
  }

  const parsed = extractJsonFromLLMResponse(result.content);
  if (!parsed || typeof parsed !== 'object') {
    return {
      success: false,
      message: 'AI 返回了内容，但资产 JSON 无法解析。',
      rawResponse: result.content,
    };
  }

  return {
    success: true,
    assets: normalizeProjectAssets(parsed),
    rawResponse: result.content,
    wasTruncated,
  };
}

/**
 * 组合最终生图 Prompt（包含参考图引用）
 * 控制总长度，避免超过 GRSai API 限制
 */
function composePrompt(shot, globalStylePrompt, qualityTags, matchedRefs, allRefs) {
  const parts = [];

  // 风格提示词（截断防止过长）
  if (globalStylePrompt) {
    const truncated = globalStylePrompt.length > 200
      ? globalStylePrompt.slice(0, 200)
      : globalStylePrompt;
    parts.push(truncated);
  }
  if (qualityTags) parts.push(qualityTags);

  // 注入匹配的参考图描述（仅匹配的）
  const charRefs = matchedRefs.filter((r) => r.category === '人物' && r.name);
  const sceneRefs = matchedRefs.filter((r) => r.category === '场景' && r.name);
  const productRefs = matchedRefs.filter((r) => r.category === '产品' && r.name);

  if (charRefs.length > 0) {
    parts.push(`参考人物：${charRefs.map((r) => r.name).join('、')}`);
  }
  if (sceneRefs.length > 0) {
    parts.push(`参考场景：${sceneRefs.map((r) => r.name).join('、')}`);
  }
  if (productRefs.length > 0) {
    parts.push(`参考道具：${productRefs.map((r) => r.name).join('、')}`);
  }

  // 核心画面描述（这是最重要的部分）
  parts.push(shot.description || '');

  // 辅助信息
  if (shot.cameraAngle) parts.push(`机位：${shot.cameraAngle}`);
  if (shot.lighting) parts.push(`光线：${shot.lighting}`);
  if (shot.mood) parts.push(`氛围：${shot.mood}`);

  return parts.filter(Boolean).join('。');
}

/**
 * 收集所有参考图 URL
 */
function collectReferenceUrls(referenceImages) {
  const urls = [];
  const groups = ['characters', 'scenes', 'products'];
  for (const group of groups) {
    const refs = referenceImages[group] || [];
    for (const ref of refs) {
      if (ref.url) urls.push({ url: ref.url, name: ref.note || ref.name || '' });
    }
  }
  return urls;
}

/**
 * 智能匹配：根据分镜的角色/场景/关键元素，找出相关的参考图
 * 返回 { matched: [...], unmatched: [...] }
 */
function matchRefImagesToShot(shot, referenceImages) {
  const shotChars = (shot.characters || []).map((c) => c.toLowerCase());
  const shotTitle = (shot.sceneTitle || '').toLowerCase();
  const shotDesc = (shot.description || '').toLowerCase();
  const shotElements = (shot.keyElements || []).map((e) => e.toLowerCase());
  const shotText = [shotTitle, shotDesc, ...shotElements, ...shotChars].join(' ');

  const result = { matched: [], unmatched: [] };
  const groups = [
    { key: 'characters', label: '人物' },
    { key: 'scenes', label: '场景' },
    { key: 'products', label: '产品' },
  ];

  for (const { key, label } of groups) {
    const refs = referenceImages[key] || [];
    for (const ref of refs) {
      if (!ref.url) continue;
      const refNote = (ref.note || ref.name || '').toLowerCase();
      const refName = (ref.name || '').toLowerCase();

      // 匹配逻辑（双向模糊匹配）：
      // 1. 备注关键词精确出现在分镜文本中
      // 2. 分镜关键词包含在备注中（如"办公室"匹配"现代办公室"）
      // 3. 备注关键词包含在分镜文本中（如"智能手表"匹配"智能手表X1"）
      // 4. 角色名匹配（如"李明"匹配"男主角李明，30岁"）
      let isMatch = false;

      if (refNote) {
        // 提取备注中的关键词（按空格/逗号/句号/顿号分词）
        const keywords = refNote.split(/[\s,，。、]+/).filter((k) => k.length >= 2);
        for (const kw of keywords) {
          // 精确匹配
          if (shotText.includes(kw)) {
            isMatch = true;
            break;
          }
          // 模糊匹配：关键词中任意>=2字的子串出现在分镜文本中
          for (let len = kw.length; len >= 2; len--) {
            for (let i = 0; i <= kw.length - len; i++) {
              const sub = kw.slice(i, i + len);
              if (shotText.includes(sub)) {
                isMatch = true;
                break;
              }
            }
            if (isMatch) break;
          }
        }

        // 反向匹配：分镜中的核心词是否包含在备注中
        if (!isMatch) {
          const shotKeywords = shotText.split(/[\s,，。、]+/).filter((k) => k.length >= 2);
          for (const sk of shotKeywords) {
            if (refNote.includes(sk)) {
              isMatch = true;
              break;
            }
          }
        }

        // 角色特别匹配
        if (!isMatch && key === 'characters') {
          for (const ch of shotChars) {
            if (ch.length > 0 && refNote.includes(ch)) {
              isMatch = true;
              break;
            }
          }
        }
      }

      // 如果没备注或没匹配上，用文件名尝试
      if (!isMatch && refName && refName !== refNote) {
        const nameKeywords = refName.split(/[\s,，。、._-]+/).filter((k) => k.length >= 2);
        for (const kw of nameKeywords) {
          if (shotText.includes(kw)) {
            isMatch = true;
            break;
          }
        }
      }

      const item = { url: ref.url, name: ref.note || ref.name || '', category: label };
      if (isMatch) {
        result.matched.push(item);
      } else {
        result.unmatched.push(item);
      }
    }
  }

  // 如果什么都没匹配上，把有备注的全部作为 matched（至少是有描述的参考图）
  if (result.matched.length === 0 && result.unmatched.length > 0) {
    const withNotes = result.unmatched.filter((r) => r.name);
    if (withNotes.length > 0) {
      result.matched = withNotes;
      result.unmatched = result.unmatched.filter((r) => !r.name);
    }
  }

  return result;
}

function tokenizeText(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[\s,，.。;；:：、|/\\()[\]{}"'“”‘’_-]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function shotTextForMatch(shot) {
  const camera = shot.camera || {};
  return [
    shot.sceneTitle,
    shot.narrativeBeat,
    shot.visualGoal,
    shot.description,
    shot.imagePrompt,
    shot.location,
    shot.sceneDescription,
    shot.cameraAngle,
    camera.shotSize,
    camera.angle,
    camera.lens,
    camera.composition,
    ...(shot.characters || []),
    ...(shot.props || []),
    ...(shot.keyElements || []),
  ].map(toText).join(' ').toLowerCase();
}

function matchRefImagesToShotV2(shot, referenceImages = {}) {
  const result = { matched: [], unmatched: [] };
  const shotText = shotTextForMatch(shot);
  const groups = [
    { key: 'characters', categoryKey: 'character', category: '人物参考' },
    { key: 'scenes', categoryKey: 'scene', category: '场景参考' },
    { key: 'products', categoryKey: 'prop', category: '道具/产品参考' },
  ];

  for (const group of groups) {
    const refs = Array.isArray(referenceImages[group.key]) ? referenceImages[group.key] : [];
    for (const ref of refs) {
      if (!ref?.url) continue;
      const refName = toText(ref.note || ref.name);
      const keywords = [
        ...tokenizeText(refName),
        ...tokenizeText(ref.bindTo),
      ];
      let score = 0;
      for (const keyword of keywords) {
        if (shotText.includes(keyword)) score += keyword.length >= 4 ? 3 : 2;
        if (group.key === 'characters' && (shot.characters || []).some((c) => toText(c).toLowerCase().includes(keyword))) score += 3;
        if (group.key === 'scenes' && toText(shot.location).toLowerCase().includes(keyword)) score += 3;
        if (group.key === 'products' && (shot.props || []).some((p) => toText(p).toLowerCase().includes(keyword))) score += 3;
      }

      const item = {
        url: ref.url,
        localUrl: ref.localUrl || '',
        name: refName || ref.name || '',
        note: ref.note || '',
        category: group.category,
        categoryKey: group.categoryKey,
        score,
      };

      if (score > 0) result.matched.push(item);
      else result.unmatched.push(item);
    }
  }

  result.matched.sort((a, b) => b.score - a.score);
  result.unmatched.sort((a, b) => (b.note || b.name || '').length - (a.note || a.name || '').length);

  return result;
}

function describeRefs(refs, categoryKey) {
  return refs
    .filter((ref) => ref.categoryKey === categoryKey)
    .map((ref) => `${ref.name || ref.note || ref.url}（必须保持外观一致）`)
    .join('；');
}

function matchAssetsToShot(shot, projectAssets = {}) {
  const text = shotTextForMatch(shot);
  const groups = [
    { key: 'characters', label: '角色资产' },
    { key: 'locations', label: '场景资产' },
    { key: 'props', label: '道具资产' },
  ];
  const matched = [];

  for (const group of groups) {
    const assets = Array.isArray(projectAssets[group.key]) ? projectAssets[group.key] : [];
    for (const asset of assets) {
      const names = [asset.name, asset.id, ...(asset.aliases || [])].map((item) => toText(item).toLowerCase()).filter(Boolean);
      const score = names.reduce((sum, name) => sum + (text.includes(name) ? Math.max(2, name.length) : 0), 0);
      if (score > 0) matched.push({ ...asset, type: group.key, label: group.label, score });
    }
  }

  return matched.sort((a, b) => b.score - a.score).slice(0, 8);
}

function describeAsset(asset) {
  return [
    `${asset.label}：${asset.name}`,
    asset.description,
    asset.visualPrompt ? `视觉固定：${asset.visualPrompt}` : '',
    asset.continuityRules ? `连续性：${asset.continuityRules}` : '',
    asset.negativePrompt ? `禁止偏离：${asset.negativePrompt}` : '',
  ].filter(Boolean).join('；');
}

function composePromptV2(shot, globalStylePrompt, qualityTags, matchedRefs = [], allRefs = [], projectAssets = {}, projectConfig = {}) {
  const camera = shot.camera || {};
  const lighting = shot.lighting || {};

  // 向前兼容：lighting 可能是旧版字符串
  const lightingStyle = typeof lighting === 'string' ? lighting : (lighting.style || '');
  const lightingDirection = lighting.keyDirection || '';
  const lightingRatio = lighting.fillRatio || '';
  const lightingQuality = lighting.quality || '';
  const lightingTemp = lighting.colorTemp || '';

  const charRefs = describeRefs(matchedRefs, 'character');
  const sceneRefs = describeRefs(matchedRefs, 'scene');
  const propRefs = describeRefs(matchedRefs, 'prop');
  const matchedAssets = matchAssetsToShot(shot, projectAssets);

  // 摄影参数行（结构化）
  const cameraParams = [
    camera.shotSize,
    camera.focalLength ? `${camera.focalLength}mm` : '',
    camera.aperture,
    camera.angle || shot.cameraAngle,
    camera.composition,
    camera.position,
    camera.depthOfField,
    camera.lens,
    camera.movement && camera.movement !== '静止' ? `运镜:${camera.movement}` : '',
  ].filter(Boolean).join('，');

  // 灯光参数行（结构化）
  const lightingParams = [
    lightingStyle,
    lightingDirection ? `主光:${lightingDirection}` : '',
    lightingRatio ? `光比${lightingRatio}` : '',
    lightingQuality,
    lightingTemp,
  ].filter(Boolean).join('，');

  const promptParts = [
    '生成一张电影分镜关键帧图，只输出单帧画面，不要拼图，不要文字，不要水印。',
    projectAssets.visualRules ? `【项目视觉规则】${projectAssets.visualRules}` : '',
    projectAssets.styleNotes ? `【项目美术补充】${projectAssets.styleNotes}` : '',
    projectConfig.directorGrammar ? `【项目导演语法】${projectConfig.directorGrammar}` : '',
    matchedAssets.length ? `【必须遵守的资产设定】\n${matchedAssets.map(describeAsset).join('\n')}` : '',
    globalStylePrompt ? `【全局风格】${toText(globalStylePrompt).slice(0, 400)}` : '',
    qualityTags ? `【画质要求】${toText(qualityTags)}` : '【画质要求】cinematic storyboard keyframe, consistent character, accurate composition, high detail',
    `【镜头编号】${shot.shotNumber || ''} ${shot.sceneTitle || ''}`,
    shot.visualGoal || shot.narrativeBeat ? `【画面目标】${toText(shot.visualGoal || shot.narrativeBeat)}` : '',
    `【核心画面】${toText(shot.imagePrompt || shot.description)}`,
    shot.characters?.length ? `【角色】${shot.characters.join('、')}` : '',
    shot.location || shot.sceneDescription ? `【场景】${[shot.location, shot.sceneDescription].filter(Boolean).join('，')}` : '',
    shot.props?.length ? `【关键道具】${shot.props.join('、')}` : '',
    cameraParams ? `【镜头参数】${cameraParams}` : '',
    lightingParams || shot.colorPalette || shot.mood
      ? `【光影色彩】${[lightingParams, shot.colorPalette, shot.mood].filter(Boolean).join(' | ')}`
      : '',
    shot.keyElements?.length ? `【必须出现】${shot.keyElements.join('、')}` : '',
    shot.continuityNotes ? `【连续性】${shot.continuityNotes}` : '',
    charRefs ? `【人物参考图绑定】${charRefs}` : '',
    sceneRefs ? `【场景参考图绑定】${sceneRefs}` : '',
    propRefs ? `【道具参考图绑定】${propRefs}` : '',
    `【禁止】${shot.negativePrompt || '多余手指、脸部变形、肢体错位、文字、水印、logo、低清晰度、风格漂移、角色服装不一致、参考图主体缺失'}`,
  ];

  return promptParts.filter(Boolean).join('\n');
}

/**
 * 核心队列处理：逐帧生成关键帧图
 */
async function processJob(jobId) {
  const queueCtx = { abort: false };
  activeQueues.set(jobId, queueCtx);

  try {
    let job = await StoryboardJob.findByPk(jobId);
    if (!job || job.status === 'running') return;

    await StoryboardJob.updateById(jobId, { status: 'running', abortFlag: false });
    job = await StoryboardJob.findByPk(jobId);

    const activeShots = job.shots.filter((s) => s.includeInGeneration !== false);
    const frameInterval = job.config.frameInterval || 1;
    const maxFrames = job.config.maxFrames || 0;

    // 根据帧间隔和最大帧数筛选要生成的镜头
    let shotsToGenerate = [];
    let count = 0;
    for (const shot of activeShots) {
      if (shot.shotNumber % frameInterval === 1 || frameInterval === 1) {
        shotsToGenerate.push(shot);
        count++;
        if (maxFrames > 0 && count >= maxFrames) break;
      }
    }

    const totalRefCount = Object.values(job.referenceImages).reduce((sum, arr) => sum + arr.length, 0);
    logger.info('开始处理AI视频自动化任务', {
      jobId,
      totalActiveShots: activeShots.length,
      shotsToGenerate: shotsToGenerate.length,
      totalRefImageCount: totalRefCount,
    });

    for (const shot of shotsToGenerate) {
      if (queueCtx.abort) {
        logger.info('AI视频自动化任务被中止', { jobId });
        await StoryboardJob.updateById(jobId, { status: 'failed' });
        return;
      }

      // 标记为生成中
      await StoryboardJob.updateShot(jobId, shot.shotNumber, { status: 'generating' });

      const model = job.config.model;
      const aspectRatio = job.config.aspectRatio;
      const imageSize = job.config.imageSize;
      const pointsCost = MODEL_POINTS[model] || 2;

      // 智能匹配参考图，并限制数量（GRSai 对参考图数量有限制）
      const matchResult = matchRefImagesToShotV2(shot, job.referenceImages);
      const refsForGeneration = matchResult.matched.slice(0, MAX_REF_IMAGES_PER_SHOT);
      const matchedRefs = refsForGeneration;

      // GRSai API 的 images 参数：支持 URL 和 base64。本地路径需转 base64
      const refUrlsForApi = [];
      for (const ref of refsForGeneration) {
        if (!ref.url) continue;
        if (ref.url.startsWith('/uploads/') || ref.url.startsWith('/local_storage/')) {
          // 本地路径 → 转 base64
          try {
            const { urlToBase64 } = require('../utils/imageUtils');
            const dataUri = await urlToBase64(ref.url);
            if (dataUri) {
              refUrlsForApi.push(dataUri);
              continue;
            }
          } catch (e) {
            logger.warn('参考图转base64失败，跳过', { url: ref.url, error: e.message });
          }
        }
        // 已经是公网 URL，直接使用
        if (ref.url.startsWith('http://') || ref.url.startsWith('https://')) {
          refUrlsForApi.push(ref.url);
        }
        // 其他路径跳过（GRSai 无法访问）
      }

      // 组合 Prompt（包含参考图描述信息）
      const composedPrompt = composePromptV2(
        shot,
        job.globalStylePrompt,
        job.config.qualityTags,
        matchedRefs,
        refsForGeneration,
        job.assets || {},
        job.config || {},
      );

      try {
        // 积分预扣
        const deductResult = await deductPoints(pointsCost, `AI视频自动化|模型:${model}`);
        if (!deductResult.success) {
          throw new Error(deductResult.message);
        }

        logger.info('AI视频自动化：生成关键帧', {
          jobId,
          shotNumber: shot.shotNumber,
          sceneTitle: shot.sceneTitle,
          model,
          matchedRefCount: matchedRefs.length,
          totalRefCount: refsForGeneration.length,
          apiRefUrlCount: refUrlsForApi.length,
          matchedRefNotes: matchedRefs.map((r) => r.name).filter(Boolean),
        });

        const imageUrl = await generateImage({
          prompt: composedPrompt,
          model,
          aspectRatio,
          imageSize,
          referenceImages: refUrlsForApi, // 现在传的是字符串数组 ["url1", "url2", ...]
        });

        // 保存到历史记录
        const record = await Generation.create({
          originalPrompt: shot.description,
          apiPrompt: composedPrompt,
          aspectRatio,
          imageSize,
          resultImageUrl: imageUrl,
          referenceImages: refsForGeneration.map((r) => ({
            url: r.url,
            name: r.name,
            note: r.note || '',
            category: r.category,
            categoryKey: r.categoryKey,
            score: r.score || 0,
          })),
          apiProvider: 'grsai',
          modelName: model,
          userId: null,
          pointsCost,
        });

        // 确认积分
        await confirmDeduct(deductResult.balance, pointsCost, `AI视频自动化|模型:${model}`);

        // 本地存档
        const localPath = await saveImageLocal(imageUrl, {
          id: record.id,
          model,
          provider: 'grsai',
          prompt: shot.description,
        });

        const finalUrl = localPath ? localPathToUrl(localPath) : imageUrl;
        if (localPath) {
          await Generation.updateById(record.id, { resultImageUrl: finalUrl });
        }

        await StoryboardJob.updateShot(jobId, shot.shotNumber, {
          status: 'completed',
          resultImageUrl: finalUrl,
          generatedPrompt: composedPrompt,
          matchedReferences: refsForGeneration.map((r) => ({
            url: r.url,
            name: r.name,
            note: r.note || '',
            category: r.category,
            categoryKey: r.categoryKey,
            score: r.score || 0,
          })),
          recordId: record.id,
        });

        logger.info('AI视频自动化：关键帧完成', { jobId, shotNumber: shot.shotNumber });
      } catch (err) {
        logger.warn('AI视频自动化：关键帧失败', {
          jobId,
          shotNumber: shot.shotNumber,
          error: err.message,
        });

        await StoryboardJob.updateShot(jobId, shot.shotNumber, {
          status: 'failed',
          error: err.message,
        });
      }
    }

    // 所有分镜处理完毕
    job = await StoryboardJob.findByPk(jobId);
    const hasPending = job.shots.some((s) =>
      s.includeInGeneration !== false && (s.status === 'pending' || s.status === 'generating')
    );

    if (!hasPending && !queueCtx.abort) {
      await StoryboardJob.updateById(jobId, { status: 'completed' });
      logger.info('AI视频自动化任务完成', {
        jobId,
        completed: job.completedShots,
        failed: job.failedShots,
      });
    }
  } catch (err) {
    logger.error('AI视频自动化任务异常', { jobId, error: err.message });
    await StoryboardJob.updateById(jobId, { status: 'failed' });
  } finally {
    activeQueues.delete(jobId);
  }
}

module.exports = {
  analyzeAssets,
  analyzeScript,
  buildDirectorSystemPrompt: buildDirectorSystemPromptV2,
  composePrompt: composePromptV2,
  collectReferenceUrls,
  matchRefImagesToShot: matchRefImagesToShotV2,
  matchAssetsToShot,
  processJob,
  activeQueues,
  STYLE_LABELS,
  MODEL_POINTS,
  // JSON extraction utilities (also used by previzDirectorService)
  extractJsonFromLLMResponse,
  tryParseJson,
  tryExtractAndParse,
};
