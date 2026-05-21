const { WorkflowTemplate } = require('./models/workflowModel');

const PRESET_WORKFLOWS = [
  {
    name: '智能生图助手',
    description: '输入想法，自动生成专业提示词并生图',
    category: 'image',
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
      console.log('[Workflow] Preset workflows already exist, skipping init');
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
