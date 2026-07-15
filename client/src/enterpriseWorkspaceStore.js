const STORAGE_KEY = 'aihub_enterprise_workspace_v1'
const SCHEMA_VERSION = 1

const DEFAULT_ROLES = [
  {
    id: 'role-operations',
    name: '运营策划 AI',
    department: '市场运营',
    description: '结合企业知识生成活动策略、内容日历和平台运营方案。',
    tools: ['企业知识库', 'AI智能对话', 'AI工作流'],
    modelPolicy: '企业默认模型',
    enabled: true,
  },
  {
    id: 'role-designer',
    name: '平面设计 AI',
    department: '品牌设计',
    description: '遵循品牌视觉规范完成海报、产品图和多尺寸社媒素材。',
    tools: ['AI图片生成', '产品图自动化', '风格管理'],
    modelPolicy: '视觉优先模型',
    enabled: true,
  },
  {
    id: 'role-video-director',
    name: '视频导演 AI',
    department: '视频内容',
    description: '从脚本、分镜、3D预演到AI视频交付组织完整生产链。',
    tools: ['AI视频自动化', '3D预演导演', 'AI视频生成'],
    modelPolicy: '长上下文导演模型',
    enabled: true,
  },
  {
    id: 'role-knowledge',
    name: '企业知识助手',
    department: '全员',
    description: '基于已授权企业资料回答问题、整理文档并输出标准内容。',
    tools: ['企业知识库', 'AI智能对话'],
    modelPolicy: '低成本快速模型',
    enabled: true,
  },
]

export const ENTERPRISE_TASKS = [
  {
    id: 'campaign',
    title: '创建新品推广项目',
    description: '建立项目并组织策略、文案、海报、视频和发布素材。',
    tool: 'project',
    category: '运营项目',
    accent: 'violet',
  },
  {
    id: 'design',
    title: '制作品牌视觉物料',
    description: '进入现有图片生成工作台，制作海报、主图和社媒配图。',
    tool: 'image',
    category: '平面设计',
    accent: 'cyan',
  },
  {
    id: 'product-image',
    title: '批量生成产品图',
    description: '调用产品图自动化能力，统一背景、构图和品牌风格。',
    tool: 'product-automation',
    category: '电商设计',
    accent: 'blue',
  },
  {
    id: 'video-campaign',
    title: '制作一条推广视频',
    description: '从脚本和分镜开始，衔接3D预演与AI视频生成。',
    tool: 'storyboard',
    category: '视频内容',
    accent: 'orange',
  },
  {
    id: 'previz',
    title: '设计3D镜头预演',
    description: '进入3D导演台，控制站位、道具、构图和电影化运镜。',
    tool: 'previz',
    category: '视频导演',
    accent: 'green',
  },
  {
    id: 'workflow',
    title: '搭建部门自动化流程',
    description: '把重复的运营和内容生产步骤配置成可复用工作流。',
    tool: 'workflow',
    category: '流程自动化',
    accent: 'pink',
  },
  {
    id: 'knowledge',
    title: '咨询企业知识助手',
    description: '使用企业角色和资料进行问答、提炼与内容撰写。',
    tool: 'ai-dialog',
    category: '知识协作',
    accent: 'slate',
  },
]

function buildDefaultWorkspace() {
  return {
    version: SCHEMA_VERSION,
    organization: {
      id: 'organization-default',
      name: '我的企业',
      industry: '待配置',
      slogan: '',
      workspaceName: '企业 AI 工作台',
    },
    brandProfile: {
      tone: '专业、清晰、可信',
      primaryColor: '#22e6b8',
      secondaryColor: '#7c6cff',
      keywords: ['专业', '可靠', '高效'],
      bannedWords: [],
    },
    activeProjectId: 'project-enterprise-v1',
    projects: [
      {
        id: 'project-enterprise-v1',
        name: '企业工作台 V1 建设',
        type: '内部建设',
        owner: '管理员',
        status: '进行中',
        progress: 25,
        objective: '完成企业知识、品牌、岗位AI和业务任务的基础配置。',
        updatedAt: 'V1 初始化',
      },
    ],
    knowledgeSources: [],
    aiRoles: DEFAULT_ROLES,
    taskHistory: [],
  }
}

function normalizeWorkspace(candidate) {
  const defaults = buildDefaultWorkspace()
  if (!candidate || typeof candidate !== 'object') return defaults
  return {
    ...defaults,
    ...candidate,
    version: SCHEMA_VERSION,
    organization: { ...defaults.organization, ...(candidate.organization || {}) },
    brandProfile: { ...defaults.brandProfile, ...(candidate.brandProfile || {}) },
    projects: Array.isArray(candidate.projects) ? candidate.projects : defaults.projects,
    knowledgeSources: Array.isArray(candidate.knowledgeSources) ? candidate.knowledgeSources : [],
    aiRoles: Array.isArray(candidate.aiRoles) && candidate.aiRoles.length ? candidate.aiRoles : defaults.aiRoles,
    taskHistory: Array.isArray(candidate.taskHistory) ? candidate.taskHistory.slice(0, 30) : [],
  }
}

export function loadEnterpriseWorkspace() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? normalizeWorkspace(JSON.parse(stored)) : buildDefaultWorkspace()
  } catch {
    return buildDefaultWorkspace()
  }
}

export function saveEnterpriseWorkspace(workspace) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeWorkspace(workspace)))
    return true
  } catch {
    return false
  }
}

export function createEnterpriseId(prefix) {
  const randomPart = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now().toString(36)}-${randomPart}`
}

export function calculateWorkspaceReadiness(workspace) {
  const checks = [
    workspace.organization?.name && workspace.organization.name !== '我的企业',
    workspace.organization?.industry && workspace.organization.industry !== '待配置',
    Boolean(workspace.organization?.slogan),
    Boolean(workspace.brandProfile?.tone),
    Boolean(workspace.brandProfile?.primaryColor),
    (workspace.brandProfile?.keywords || []).length >= 3,
    (workspace.knowledgeSources || []).length >= 2,
    (workspace.aiRoles || []).some((role) => role.enabled),
  ]
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}
