const { WorkflowTemplate } = require('./models/workflowModel');

const PRESET_WORKFLOWS = [
  // ===== 平面设计 =====
  {
    name: '商品海报生成',
    description: '输入产品信息和风格偏好，自动生成专业商品海报',
    category: 'image',
    roleId: 'role-graphic-design',
    isPreset: true,
    tags: ['海报', '电商', '商品'],
    nodes: [
      { id: '1', type: 'llmAnalyze', position: { x: 100, y: 200 }, data: { label: '分析需求' } },
      { id: '2', type: 'llmGenerate', position: { x: 400, y: 200 }, data: { label: '生成海报Prompt', outputType: 'prompt' } },
      { id: '3', type: 'imageGenerate', position: { x: 700, y: 200 }, data: { label: '生成海报', model: 'gpt-image-2' } },
    ],
    edges: [
      { id: 'e1-2', source: '1', target: '2' },
      { id: 'e2-3', source: '2', target: '3' },
    ],
    variables: [
      { name: 'product', label: '产品名称', type: 'text', required: true },
      { name: 'style', label: '风格偏好', type: 'text', required: false },
    ],
  },
  {
    name: '电商Banner生成',
    description: '快速生成促销Banner，支持多尺寸输出',
    category: 'image',
    roleId: 'role-graphic-design',
    isPreset: true,
    tags: ['Banner', '电商', '促销'],
    nodes: [
      { id: '1', type: 'llmAnalyze', position: { x: 100, y: 200 }, data: { label: '分析活动信息' } },
      { id: '2', type: 'llmGenerate', position: { x: 400, y: 200 }, data: { label: '生成Banner文案', outputType: 'copy' } },
      { id: '3', type: 'llmGenerate', position: { x: 700, y: 200 }, data: { label: '生成视觉Prompt', outputType: 'prompt' } },
      { id: '4', type: 'imageGenerate', position: { x: 1000, y: 200 }, data: { label: '生成Banner', model: 'gpt-image-2' } },
    ],
    edges: [
      { id: 'e1-2', source: '1', target: '2' },
      { id: 'e2-3', source: '2', target: '3' },
      { id: 'e3-4', source: '3', target: '4' },
    ],
    variables: [
      { name: 'event', label: '活动主题', type: 'text', required: true },
      { name: 'brand', label: '品牌名称', type: 'text', required: false },
    ],
  },
  {
    name: '社交媒体配图',
    description: '为社交媒体帖子生成配图，支持多种平台尺寸',
    category: 'image',
    roleId: 'role-graphic-design',
    isPreset: true,
    tags: ['社交媒体', '配图', '多尺寸'],
    nodes: [
      { id: '1', type: 'llmAnalyze', position: { x: 100, y: 200 }, data: { label: '分析帖子内容' } },
      { id: '2', type: 'llmGenerate', position: { x: 400, y: 200 }, data: { label: '生成图片Prompt', outputType: 'prompt' } },
      { id: '3', type: 'imageGenerate', position: { x: 700, y: 200 }, data: { label: '生成配图', model: 'gpt-image-2' } },
    ],
    edges: [
      { id: 'e1-2', source: '1', target: '2' },
      { id: 'e2-3', source: '2', target: '3' },
    ],
    variables: [
      { name: 'content', label: '帖子内容', type: 'text', required: true },
      { name: 'platform', label: '发布平台', type: 'text', required: false },
    ],
  },
  // ===== 文案策划 =====
  {
    name: '多语言翻译助手',
    description: '输入产品文案，自动翻译为多种目标语言并优化本地化表达',
    category: 'text',
    roleId: 'role-copywriting',
    isPreset: true,
    tags: ['翻译', '多语言', '本地化'],
    nodes: [
      { id: '1', type: 'llmAnalyze', position: { x: 100, y: 200 }, data: { label: '分析原文' } },
      { id: '2', type: 'knowledgeQuery', position: { x: 350, y: 200 }, data: { label: '查询术语库', category: 'product' } },
      { id: '3', type: 'llmGenerate', position: { x: 600, y: 200 }, data: { label: '翻译输出', outputType: 'copy' } },
    ],
    edges: [
      { id: 'e1-2', source: '1', target: '2' },
      { id: 'e2-3', source: '2', target: '3' },
    ],
    variables: [
      { name: 'text', label: '待翻译文案', type: 'text', required: true },
      { name: 'targetLang', label: '目标语言', type: 'text', required: true },
    ],
  },
  {
    name: 'SEO产品文案',
    description: '生成带关键词优化的产品标题、描述和卖点文案',
    category: 'text',
    roleId: 'role-copywriting',
    isPreset: true,
    tags: ['SEO', '产品', '文案'],
    nodes: [
      { id: '1', type: 'llmAnalyze', position: { x: 100, y: 200 }, data: { label: '提取产品卖点' } },
      { id: '2', type: 'llmGenerate', position: { x: 400, y: 100 }, data: { label: '生成标题', outputType: 'copy' } },
      { id: '3', type: 'llmGenerate', position: { x: 400, y: 300 }, data: { label: '生成描述', outputType: 'copy' } },
    ],
    edges: [
      { id: 'e1-2', source: '1', target: '2' },
      { id: 'e1-3', source: '1', target: '3' },
    ],
    variables: [
      { name: 'product', label: '产品名称', type: 'text', required: true },
      { name: 'keywords', label: '目标关键词', type: 'text', required: true },
    ],
  },
  {
    name: '广告语生成器',
    description: '为产品生成多条营销广告语/标语，支持A/B测试',
    category: 'text',
    roleId: 'role-copywriting',
    isPreset: true,
    tags: ['广告语', '营销', '标语'],
    nodes: [
      { id: '1', type: 'llmAnalyze', position: { x: 100, y: 200 }, data: { label: '分析产品定位' } },
      { id: '2', type: 'llmGenerate', position: { x: 400, y: 200 }, data: { label: '生成广告语', outputType: 'copy' } },
    ],
    edges: [{ id: 'e1-2', source: '1', target: '2' }],
    variables: [
      { name: 'product', label: '产品名称', type: 'text', required: true },
      { name: 'tone', label: '语气风格', type: 'text', required: false },
    ],
  },
  // ===== 视频制作 =====
  {
    name: '短视频脚本生成',
    description: '输入创意主题，自动生成视频脚本、分镜和AI视频',
    category: 'video',
    roleId: 'role-video',
    isPreset: true,
    tags: ['视频', '脚本', '分镜'],
    nodes: [
      { id: '1', type: 'llmAnalyze', position: { x: 100, y: 200 }, data: { label: '分析主题' } },
      { id: '2', type: 'llmGenerate', position: { x: 400, y: 200 }, data: { label: '生成脚本', outputType: 'copy' } },
      { id: '3', type: 'llmGenerate', position: { x: 700, y: 200 }, data: { label: '生成分镜Prompt', outputType: 'prompt' } },
      { id: '4', type: 'videoGenerate', position: { x: 1000, y: 200 }, data: { label: '生成视频', model: 'seedance2.0' } },
    ],
    edges: [
      { id: 'e1-2', source: '1', target: '2' },
      { id: 'e2-3', source: '2', target: '3' },
      { id: 'e3-4', source: '3', target: '4' },
    ],
    variables: [
      { name: 'theme', label: '视频主题', type: 'text', required: true },
      { name: 'duration', label: '视频时长(秒)', type: 'text', required: false },
    ],
  },
  // ===== 3D建模 =====
  {
    name: '3D Prompt优化',
    description: '将简单描述转化为专业3D渲染Prompt，生成多角度视图',
    category: 'image',
    roleId: 'role-3d',
    isPreset: true,
    tags: ['3D', '渲染', '多角度'],
    nodes: [
      { id: '1', type: 'llmAnalyze', position: { x: 100, y: 200 }, data: { label: '分析产品形态' } },
      { id: '2', type: 'llmGenerate', position: { x: 400, y: 100 }, data: { label: '生成3D Prompt', outputType: 'prompt' } },
      { id: '3', type: 'llmGenerate', position: { x: 400, y: 300 }, data: { label: '材质灯光描述', outputType: 'copy' } },
      { id: '4', type: 'imageGenerate', position: { x: 700, y: 200 }, data: { label: '生成3D渲染', model: 'gpt-image-2' } },
    ],
    edges: [
      { id: 'e1-2', source: '1', target: '2' },
      { id: 'e1-3', source: '1', target: '3' },
      { id: 'e2-4', source: '2', target: '4' },
    ],
    variables: [
      { name: 'product', label: '产品描述', type: 'text', required: true },
      { name: 'angle', label: '渲染角度', type: 'text', required: false },
    ],
  },
  {
    name: '多角度产品图',
    description: '一键生成产品正面/侧面/背面/细节多角度展示图',
    category: 'image',
    roleId: 'role-3d',
    isPreset: true,
    tags: ['3D', '产品', '多角度', '展示'],
    nodes: [
      { id: '1', type: 'llmAnalyze', position: { x: 100, y: 200 }, data: { label: '分析产品特征' } },
      { id: '2', type: 'llmGenerate', position: { x: 400, y: 100 }, data: { label: '正面Prompt', outputType: 'prompt' } },
      { id: '3', type: 'llmGenerate', position: { x: 400, y: 300 }, data: { label: '侧面Prompt', outputType: 'prompt' } },
      { id: '4', type: 'imageGenerate', position: { x: 700, y: 100 }, data: { label: '正面图', model: 'gpt-image-2' } },
      { id: '5', type: 'imageGenerate', position: { x: 700, y: 300 }, data: { label: '侧面图', model: 'gpt-image-2' } },
    ],
    edges: [
      { id: 'e1-2', source: '1', target: '2' },
      { id: 'e1-3', source: '1', target: '3' },
      { id: 'e2-4', source: '2', target: '4' },
      { id: 'e3-5', source: '3', target: '5' },
    ],
    variables: [
      { name: 'product', label: '产品名称/描述', type: 'text', required: true },
    ],
  },
  // ===== 通用 =====
  {
    name: '智能生图助手',
    description: '输入想法，自动生成专业提示词并生图',
    category: 'image',
    roleId: 'role-general',
    isPreset: true,
    tags: ['通用', '生图', '入门'],
    nodes: [
      { id: '1', type: 'llmAnalyze', position: { x: 100, y: 200 }, data: { label: '分析想法' } },
      { id: '2', type: 'llmGenerate', position: { x: 400, y: 200 }, data: { label: '生成提示词', outputType: 'prompt' } },
      { id: '3', type: 'imageGenerate', position: { x: 700, y: 200 }, data: { label: '生成图片', model: 'gpt-image-2' } },
    ],
    edges: [
      { id: 'e1-2', source: '1', target: '2' },
      { id: 'e2-3', source: '2', target: '3' },
    ],
    variables: [
      { name: 'idea', label: '你的想法', type: 'text', required: true },
      { name: 'style', label: '风格偏好', type: 'text', required: false },
    ],
  },
  {
    name: '产品宣传物料',
    description: '结合公司产品信息，生成营销文案+配图',
    category: 'marketing',
    roleId: 'role-general',
    isPreset: true,
    tags: ['营销', '产品', '综合'],
    nodes: [
      { id: '1', type: 'llmAnalyze', position: { x: 100, y: 200 }, data: { label: '分析需求' } },
      { id: '2', type: 'knowledgeQuery', position: { x: 350, y: 200 }, data: { label: '查询产品', category: 'product' } },
      { id: '3', type: 'llmGenerate', position: { x: 600, y: 100 }, data: { label: '生成文案', outputType: 'copy' } },
      { id: '4', type: 'llmGenerate', position: { x: 600, y: 300 }, data: { label: '生成提示词', outputType: 'prompt' } },
      { id: '5', type: 'imageGenerate', position: { x: 900, y: 300 }, data: { label: '生成配图', model: 'gpt-image-2' } },
    ],
    edges: [
      { id: 'e1-2', source: '1', target: '2' },
      { id: 'e2-3', source: '2', target: '3' },
      { id: 'e2-4', source: '2', target: '4' },
      { id: 'e4-5', source: '4', target: '5' },
    ],
    variables: [
      { name: 'idea', label: '营销主题', type: 'text', required: true },
      { name: 'product', label: '产品名称', type: 'text', required: false },
    ],
  },
  {
    name: '创意视频脚本',
    description: '输入创意主题，生成视频脚本和分镜提示词',
    category: 'video',
    roleId: 'role-general',
    isPreset: true,
    tags: ['视频', '脚本', '通用'],
    nodes: [
      { id: '1', type: 'llmAnalyze', position: { x: 100, y: 200 }, data: { label: '分析主题' } },
      { id: '2', type: 'llmGenerate', position: { x: 400, y: 200 }, data: { label: '生成脚本', outputType: 'copy' } },
      { id: '3', type: 'llmGenerate', position: { x: 700, y: 200 }, data: { label: '生成提示词', outputType: 'prompt' } },
      { id: '4', type: 'videoGenerate', position: { x: 1000, y: 200 }, data: { label: '生成视频', model: 'seedance2.0' } },
    ],
    edges: [
      { id: 'e1-2', source: '1', target: '2' },
      { id: 'e2-3', source: '2', target: '3' },
      { id: 'e3-4', source: '3', target: '4' },
    ],
    variables: [
      { name: 'idea', label: '视频主题', type: 'text', required: true },
    ],
  },
  {
    name: '背景音乐创作',
    description: '输入场景描述，生成匹配的背景音乐',
    category: 'music',
    roleId: 'role-general',
    isPreset: true,
    tags: ['音乐', '背景', '通用'],
    nodes: [
      { id: '1', type: 'llmAnalyze', position: { x: 100, y: 200 }, data: { label: '分析场景' } },
      { id: '2', type: 'llmGenerate', position: { x: 400, y: 200 }, data: { label: '生成音乐提示词', outputType: 'prompt' } },
      { id: '3', type: 'musicGenerate', position: { x: 700, y: 200 }, data: { label: '生成音乐' } },
    ],
    edges: [
      { id: 'e1-2', source: '1', target: '2' },
      { id: 'e2-3', source: '2', target: '3' },
    ],
    variables: [
      { name: 'idea', label: '场景描述', type: 'text', required: true },
      { name: 'mood', label: '音乐风格', type: 'text', required: false },
    ],
  },
];

async function initPresetWorkflows() {
  try {
    const existing = await WorkflowTemplate.findAll();
    if (existing.length > 0) {
      // 只补充缺失的预设工作流，不影响用户自定义的
      const presetNames = new Set(PRESET_WORKFLOWS.map((w) => w.name));
      const existingNames = new Set(existing.map((w) => w.name));
      const missing = PRESET_WORKFLOWS.filter((w) => !existingNames.has(w.name));
      if (missing.length === 0) {
        console.log('[Workflow] All preset workflows already exist, skipping');
        return;
      }
      for (const wf of missing) {
        await WorkflowTemplate.create(wf);
      }
      console.log(`[Workflow] ${missing.length} new preset workflows added`);
      return;
    }

    for (const wf of PRESET_WORKFLOWS) {
      await WorkflowTemplate.create(wf);
    }

    console.log(`[Workflow] ${PRESET_WORKFLOWS.length} preset workflows initialized`);
  } catch (err) {
    console.error('[Workflow] Init preset workflows error:', err);
  }
}

module.exports = { initPresetWorkflows };
