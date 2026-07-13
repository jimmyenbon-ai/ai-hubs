const VERSION = 1

export const REFERENCE_CATEGORIES = [
  { value: 'character', label: '角色定妆' },
  { value: 'scene', label: '场景氛围' },
  { value: 'prop', label: '道具产品' },
  { value: 'style', label: '成片风格' },
]

export const EMPTY_FRAME_SET = Object.freeze({ first: null, last: null })

export function createShotPackage(shot = null) {
  return {
    version: VERSION,
    id: `${shot?.id || 'free'}-${Date.now()}`,
    shotId: shot?.id || 'free',
    title: shot?.title || '当前镜头',
    duration: Number(shot?.duration) || 5,
    visualGoal: shot?.visual_goal || shot?.action || '',
    cameraMovement: shot?.camera_movement || '',
    previzFrames: { ...EMPTY_FRAME_SET },
    styledFrames: { ...EMPTY_FRAME_SET },
    previzVideo: null,
    handoffPrompt: '',
    updatedAt: new Date().toISOString(),
  }
}

export function mergeShotPackage(value, shot = null) {
  const base = createShotPackage(shot)
  if (!value || typeof value !== 'object') return base
  return {
    ...base,
    ...value,
    version: VERSION,
    previzFrames: { ...base.previzFrames, ...(value.previzFrames || {}) },
    styledFrames: { ...base.styledFrames, ...(value.styledFrames || {}) },
  }
}

function hasTime(keyframes, target, tolerance = 0.08) {
  return keyframes.some((keyframe) => Math.abs(Number(keyframe.time) - target) <= tolerance)
}

function distance(a = [], b = []) {
  return Math.hypot(
    Number(a[0] || 0) - Number(b[0] || 0),
    Number(a[1] || 0) - Number(b[1] || 0),
    Number(a[2] || 0) - Number(b[2] || 0),
  )
}

export function analyzeShotReadiness({
  actors = [],
  props = [],
  cameras = [],
  tracks = [],
  duration = 5,
  activeCameraId,
  shotPackage,
  references = [],
}) {
  const camera = cameras.find((item) => item.id === activeCameraId) || cameras[0]
  const cameraTrack = tracks.find((track) => track.targetType === 'camera' && track.targetId === camera?.id)
  const cameraKeys = cameraTrack?.keyframes || []
  const movingTracks = tracks.filter((track) => (track.keyframes || []).length >= 2)
  const subjectPosition = actors[0]?.position || props[0]?.position || [0, 1, 0]
  const cameraDistance = camera ? distance(camera.position, subjectPosition) : 0

  const checks = [
    {
      id: 'camera',
      label: '已设置活动机位和对焦目标',
      pass: Boolean(camera && (camera.lookAt || camera.rotation)),
      hint: '先选择活动摄影机，并让 lookAt 指向主体头胸或产品中心。',
    },
    {
      id: 'subject',
      label: '镜头中有可识别主体和空间参照',
      pass: actors.length > 0 || props.length > 0,
      hint: '至少放入一个演员、产品或关键道具。',
    },
    {
      id: 'coverage',
      label: '摄影机起点、中段、终点关键帧完整',
      pass: cameraKeys.length >= 3 && hasTime(cameraKeys, 0) && hasTime(cameraKeys, Number(duration)),
      hint: '在 0 秒、中段和结束时间各打一个关键帧。',
    },
    {
      id: 'motion',
      label: '主体或摄影机具有可读的时序变化',
      pass: movingTracks.length > 0,
      hint: '至少一条轨道需要两个不同时间的关键帧。',
    },
    {
      id: 'distance',
      label: '机位与主体保持安全距离',
      pass: !camera || cameraDistance >= 0.8,
      hint: '摄影机距主体小于 0.8m，成片容易穿模或构图失控。',
    },
    {
      id: 'references',
      label: '已准备身份 / 场景 / 道具参考',
      pass: references.length > 0,
      hint: '上传至少一张角色定妆或主场景参考。',
    },
    {
      id: 'previz-frames',
      label: '已锁定首尾灰模构图',
      pass: Boolean(shotPackage?.previzFrames?.first?.url && shotPackage?.previzFrames?.last?.url),
      hint: '分别捕获 0 秒和结束时间的活动机位画面。',
    },
    {
      id: 'styled-frames',
      label: '已生成成片化首尾帧',
      pass: Boolean(shotPackage?.styledFrames?.first?.url && shotPackage?.styledFrames?.last?.url),
      hint: '用 GPT-Image 2 将灰模构图与参考图融合成成片风格。',
    },
    {
      id: 'previz-video',
      label: '已录制并上传 3D 运镜参考片',
      pass: Boolean(shotPackage?.previzVideo?.url),
      hint: '录制当前活动机位，结束后会自动加入镜头资产包。',
    },
  ]

  const required = checks.slice(0, 7)
  const score = Math.round((checks.filter((item) => item.pass).length / checks.length) * 100)
  return {
    checks,
    score,
    readyForFrameSynthesis: checks.slice(0, 7).every((item) => item.pass),
    readyForVideo: required.every((item) => item.pass) && checks[7].pass,
    stats: {
      actorCount: actors.length,
      propCount: props.length,
      trackCount: tracks.length,
      cameraKeyCount: cameraKeys.length,
      cameraDistance,
    },
  }
}

export function buildFrameSynthesisPrompt({ kind, shot, shotPackage, references = [], aspectRatio = '16:9' }) {
  const isFirst = kind === 'first'
  const referenceSummary = references
    .map((item, index) => `参考图${index + 2}：${item.label || item.name || item.category}`)
    .join('；')
  return `你是电影美术指导与虚拟制片摄影师。
任务：把参考图1的3D灰模预演画面转换为可直接用于AI视频的高质量电影成片${isFirst ? '首帧' : '尾帧'}。
镜头：${shot?.id || shotPackage?.shotId || '当前镜头'} ${shot?.title || shotPackage?.title || ''}
画面目标：${shot?.visual_goal || shotPackage?.visualGoal || '保持当前叙事意图'}
运镜阶段：${isFirst ? '动作起势，保留后续运动空间' : '动作落点，与首帧保持严格身份和空间连续'}
画幅：${aspectRatio}
${referenceSummary ? `其他参考的用途：${referenceSummary}` : ''}

强制约束：
1. 严格保留参考图1的摄影机位置、透视、景别、主体站位、朝向、道具位置和负空间，不得自由重构。
2. 用其他参考图仅替换角色身份、服装、场景美术、道具细节和光影材质，不改变3D构图。
3. 角色脸型、发型、服饰和主要道具必须与参考一致，禁止多人融合、突然换装、增减角色或道具。
4. 真实电影布光、自然材质、层次清晰，不保留灰模、骨架、网格、坐标轴、标签或编辑器UI。
5. 只输出单张无字成片图，不要分镜表、不要画中画、不要水印。`
}

export function buildVideoHandoffPrompt({ shot, shotPackage, assets = [] }) {
  const assetLines = assets.map((item) => `@${item.id} 是${item.label}`).join('；')
  const duration = Number(shot?.duration || shotPackage?.duration || 5)
  return `${assetLines}。
生成一条 ${duration} 秒的电影成片镜头。${shot?.visual_goal || shotPackage?.visualGoal || ''}
摄影机运动：${shot?.camera_movement || shotPackage?.cameraMovement || '严格跟随3D预演参考视频'}。
严格要求：首帧构图从成片化首帧开始，尾帧构图在成片化尾帧结束；中间的摄影机路径、主体位移、朝向、动作时序和道具交互严格参考3D预演视频。所有角色身份、服装、场景、道具、光线和色调全程一致。禁止新增物体、穿模、闪烁、肢体变形、身份漂移、摄影机跳变和无动机运镜。`
}

