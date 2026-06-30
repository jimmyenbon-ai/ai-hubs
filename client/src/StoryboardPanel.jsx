import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './components/Icons'

const MODEL_OPTIONS = [
  { value: 'gpt-image-2', label: 'GPT-Image 2' },
  { value: 'gpt-image-2-vip', label: 'GPT-Image 2 VIP' },
  { value: 'nano-banana', label: 'Nano Banana' },
  { value: 'nano-banana-fast', label: 'Nano Banana Fast' },
  { value: 'nano-banana-2', label: 'Nano Banana 2' },
  { value: 'nano-banana-2-cl', label: 'Nano Banana 2 CL (2K)' },
  { value: 'nano-banana-2-4k-cl', label: 'Nano Banana 2 4K CL' },
  { value: 'nano-banana-pro', label: 'Nano Banana Pro' },
  { value: 'nano-banana-pro-cl', label: 'Nano Banana Pro CL (2K)' },
  { value: 'nano-banana-pro-vip', label: 'Nano Banana Pro VIP (2K)' },
  { value: 'nano-banana-pro-4k-vip', label: 'Nano Banana Pro 4K VIP' },
]

const ASPECT_RATIOS = [
  { value: '16:9', label: '16:9 横版' },
  { value: '9:16', label: '9:16 竖版' },
  { value: '1:1', label: '1:1 方图' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4 竖图' },
  { value: '21:9', label: '21:9 宽银幕' },
  { value: '2:1', label: '2:1 横向' },
]

const IMAGE_SIZES = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
]

const STYLE_PRESETS = [
  { value: 'film', label: '写实电影', desc: '自然光、电影级调色、真实材质' },
  { value: 'hollywood', label: '好莱坞大片', desc: '强戏剧光、宽银幕、史诗构图' },
  { value: 'promotional', label: '商业宣传片', desc: '干净、专业、品牌感明确' },
  { value: 'documentary', label: '纪录片', desc: '真实现场感、克制镜头语言' },
  { value: 'anime', label: '动画分镜', desc: '剧场版动画关键帧质感' },
  { value: 'disney', label: '3D 动画电影', desc: '明亮、圆润、角色表现力强' },
  { value: 'custom', label: '自定义', desc: '手动指定视觉风格' },
]

const PRODUCTION_TYPES = [
  { value: 'short_drama', label: '短剧', desc: '节奏更快，情绪钩子明确，近景/中近景占比更高。' },
  { value: 'film', label: '电影', desc: '镜头呼吸更完整，强调叙事层次、景深和空间关系。' },
  { value: 'advertising', label: '广告', desc: '产品/品牌主体清晰，构图更干净，关键卖点可视化。' },
  { value: 'promo', label: '宣传片', desc: '信息传达明确，稳重专业，空间和人物关系易读。' },
  { value: 'documentary', label: '纪实', desc: '现场感、自然光、手持或观察式镜头语言。' },
]

const CAMERA_GRAMMARS = [
  { value: 'balanced', label: '均衡镜头', desc: '静态、推拉、跟拍按剧情需要自动分配。' },
  { value: 'side_follow', label: '侧面跟拍', desc: '适合边走边说、空间穿行，强调横向运动和前景遮挡。' },
  { value: 'handheld_close', label: '手持近景', desc: '更强临场感，适合紧张、纪录、短剧对白。' },
  { value: 'dolly_precise', label: '轨道推拉', desc: '机位稳定，适合电影感、广告、宣传片。' },
  { value: 'product_macro', label: '产品特写', desc: '强调产品、道具、材质、标识和手部动作。' },
]

const COMPOSITION_GRAMMARS = [
  { value: 'classic', label: '经典电影', desc: '三分法、引导线、前中后景层次。' },
  { value: 'foreground', label: '前景遮挡', desc: '用门框、桌子、书架、玻璃等压出纵深和偷拍感。' },
  { value: 'symmetry', label: '对称秩序', desc: '适合科技、权力、品牌展示、严肃空间。' },
  { value: 'negative_space', label: '留白压迫', desc: '用负空间表达孤独、悬疑、弱势人物状态。' },
  { value: 'hero_subject', label: '主体英雄化', desc: '主体更醒目，适合广告、宣传片、角色登场。' },
]

const STEPS = [
  { key: 'input', label: '剧本' },
  { key: 'assets', label: '资产' },
  { key: 'storyboard', label: '分镜' },
  { key: 'config', label: '生成' },
  { key: 'running', label: '进度' },
  { key: 'done', label: '结果' },
]

const REF_CATEGORIES = [
  {
    key: 'characters',
    label: '人物参考',
    icon: Icon.User,
    hint: '备注写角色名和稳定外观，例如：李明，30岁，短发，深蓝西装。',
  },
  {
    key: 'scenes',
    label: '场景参考',
    icon: Icon.Building,
    hint: '备注写地点名和空间特征，例如：现代办公室，落地窗，冷白灯。',
  },
  {
    key: 'products',
    label: '道具/产品参考',
    icon: Icon.Package,
    hint: '备注写道具名和材质，例如：银色智能手表，黑色屏幕，金属表带。',
  },
]

function statusLabel(status) {
  const map = {
    pending: '等待',
    generating: '生成中',
    completed: '完成',
    failed: '失败',
    skipped: '跳过',
  }
  return map[status] || '未知'
}

function StatusIcon({ status }) {
  if (status === 'completed') return <Icon.Check size={14} color="#10b981" />
  if (status === 'failed') return <Icon.X size={14} color="#ef4444" />
  if (status === 'generating') return <Icon.Loader size={14} />
  return <Icon.Clock size={14} />
}

function normalizeShotForEdit(shot, index) {
  const camera = shot.camera || {};
  const lighting = shot.lighting || {};
  // 向前兼容：lighting 可能是旧版字符串
  const lightingObj = typeof lighting === 'string'
    ? { style: lighting, keyDirection: '', fillRatio: '', quality: '', colorTemp: '' }
    : lighting;

  return {
    shotNumber: Number(shot.shotNumber || index + 1),
    sceneTitle: shot.sceneTitle || `镜头${index + 1}`,
    narrativeBeat: shot.narrativeBeat || '',
    visualGoal: shot.visualGoal || '',
    description: shot.description || '',
    characters: Array.isArray(shot.characters) ? shot.characters : [],
    location: shot.location || '',
    sceneDescription: shot.sceneDescription || '',
    props: Array.isArray(shot.props) ? shot.props : [],
    // 🆕 结构化摄影参数
    shotSize: camera.shotSize || '',
    angle: camera.angle || '',
    focalLength: camera.focalLength || '',
    aperture: camera.aperture || '',
    composition: camera.composition || '',
    position: camera.position || '',
    movement: camera.movement || '',
    depthOfField: camera.depthOfField || '',
    lens: camera.lens || '',
    // 🆕 结构化灯光参数
    lightingStyle: lightingObj.style || '',
    lightingDirection: lightingObj.keyDirection || '',
    lightingRatio: lightingObj.fillRatio || '',
    lightingQuality: lightingObj.quality || '',
    lightingTemp: lightingObj.colorTemp || '',
    // 保留兼容字段
    cameraAngle: shot.cameraAngle || camera.angle || '',
    lighting: typeof shot.lighting === 'string' ? shot.lighting : (lightingObj.style || ''),
    colorPalette: shot.colorPalette || '',
    mood: shot.mood || '',
    keyElements: Array.isArray(shot.keyElements) ? shot.keyElements : [],
    continuityNotes: shot.continuityNotes || '',
    imagePrompt: shot.imagePrompt || '',
    negativePrompt: shot.negativePrompt || '',
    estimatedDuration: shot.estimatedDuration || '',
    includeInGeneration: shot.includeInGeneration !== false,
    status: shot.status || 'pending',
    resultImageUrl: shot.resultImageUrl || null,
    generatedPrompt: shot.generatedPrompt || null,
    matchedReferences: shot.matchedReferences || [],
    error: shot.error || null,
  }
}

function splitList(value) {
  return String(value || '')
    .split(/[、,，;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function joinList(value) {
  return Array.isArray(value) ? value.join('、') : ''
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <span className="section-label" style={{ display: 'block', marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  )
}

function ShotCard({ shot, editing, draft, onEdit, onSave, onCancel, onDraft, onToggle }) {
  if (editing) {
    return (
      <div className="storyboard-shot-card">
        <div className="shot-header">
          <span className="shot-number">#{shot.shotNumber}</span>
          <input
            className="input-field"
            value={draft.sceneTitle || ''}
            onChange={(e) => onDraft({ sceneTitle: e.target.value })}
            placeholder="镜头标题"
          />
        </div>
        <Field label="关键帧画面描述">
          <textarea
            className="input-field"
            rows={4}
            value={draft.description || ''}
            onChange={(e) => onDraft({ description: e.target.value })}
            placeholder="写清角色、动作、场景、构图、光线。"
          />
        </Field>
        <Field label="AI 生图 Prompt">
          <textarea
            className="input-field"
            rows={4}
            value={draft.imagePrompt || ''}
            onChange={(e) => onDraft({ imagePrompt: e.target.value })}
            placeholder="可为空；为空时使用画面描述。"
          />
        </Field>
        {/* 🆕 摄影参数网格 */}
        <div className="section-label" style={{ marginTop: 10 }}>🎥 摄影参数</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
          <select className="input-field" value={draft.shotSize || ''} onChange={(e) => onDraft({ shotSize: e.target.value })}>
            <option value="">景别</option>
            {['大远景','远景','全景','中景','中近景','近景','特写','大特写'].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className="input-field" value={draft.angle || ''} onChange={(e) => onDraft({ angle: e.target.value })}>
            <option value="">机位角度</option>
            {['平视','俯拍(45°)','俯拍(90°鸟瞰)','仰拍(低角度)','荷兰角(倾斜)','过肩'].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className="input-field" value={draft.focalLength || ''} onChange={(e) => onDraft({ focalLength: e.target.value })}>
            <option value="">焦段mm</option>
            {['14','18','24','28','35','50','85','105','135','200'].map(v => <option key={v} value={v}>{v}mm</option>)}
          </select>
          <select className="input-field" value={draft.aperture || ''} onChange={(e) => onDraft({ aperture: e.target.value })}>
            <option value="">光圈</option>
            {['f/1.4','f/2','f/2.8','f/4','f/5.6','f/8','f/11','f/16'].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className="input-field" value={draft.composition || ''} onChange={(e) => onDraft({ composition: e.target.value })}>
            <option value="">构图</option>
            {['三分法','中心对称','引导线','框架构图','对角线','负空间','黄金分割','前景遮挡','镜面反射'].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className="input-field" value={draft.position || ''} onChange={(e) => onDraft({ position: e.target.value })}>
            <option value="">站位</option>
            {['正面','正侧','前侧45°','后侧45°','背后','过肩','POV主观','俯视','低角度仰拍','远景俯拍'].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className="input-field" value={draft.depthOfField || ''} onChange={(e) => onDraft({ depthOfField: e.target.value })}>
            <option value="">景深</option>
            {['浅景深','中等景深','深景深'].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className="input-field" value={draft.movement || ''} onChange={(e) => onDraft({ movement: e.target.value })}>
            <option value="">运镜</option>
            {['静止','推镜','拉镜','摇镜','移镜','跟拍','升降','旋转'].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <input className="input-field" value={draft.lens || ''} onChange={(e) => onDraft({ lens: e.target.value })} placeholder="镜头类型: 标准定焦" />
        </div>
        {/* 🆕 灯光参数网格 */}
        <div className="section-label" style={{ marginTop: 10 }}>💡 灯光参数</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
          <select className="input-field" value={draft.lightingStyle || ''} onChange={(e) => onDraft({ lightingStyle: e.target.value })}>
            <option value="">主光风格</option>
            {['高调光','低调光','自然光','戏剧光','逆光剪影','霓虹','金色时刻(黄昏)','蓝色时刻(黎明)','阴天柔光'].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className="input-field" value={draft.lightingDirection || ''} onChange={(e) => onDraft({ lightingDirection: e.target.value })}>
            <option value="">主光方向</option>
            {['正面光','前侧45°(左)','前侧45°(右)','正侧光(左)','正侧光(右)','侧逆光','正逆光','顶光','底光','伦勃朗光','蝴蝶光','环形光'].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className="input-field" value={draft.lightingRatio || ''} onChange={(e) => onDraft({ lightingRatio: e.target.value })}>
            <option value="">光比</option>
            {['1:1(平光)','2:1(柔和立体)','4:1(戏剧性)','8:1(强烈对比)','仅主光(无补光)'].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className="input-field" value={draft.lightingQuality || ''} onChange={(e) => onDraft({ lightingQuality: e.target.value })}>
            <option value="">光质</option>
            {['硬光(清晰阴影)','柔光(柔和阴影)','漫反射(几乎无影)','混合'].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className="input-field" value={draft.lightingTemp || ''} onChange={(e) => onDraft({ lightingTemp: e.target.value })}>
            <option value="">色温</option>
            {['暖调3200K','中性白4300K','中性5600K','冷调7000K','极冷9000K','金色暖调2800K','荧光绿偏','霓虹混色'].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        {/* 传统字段 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginTop: 10 }}>
          <input className="input-field" value={draft.charactersText || ''} onChange={(e) => onDraft({ charactersText: e.target.value })} placeholder="角色：李明、王岚" />
          <input className="input-field" value={draft.propsText || ''} onChange={(e) => onDraft({ propsText: e.target.value })} placeholder="道具：手机、文件夹" />
          <input className="input-field" value={draft.location || ''} onChange={(e) => onDraft({ location: e.target.value })} placeholder="地点/场景" />
          <input className="input-field" value={draft.mood || ''} onChange={(e) => onDraft({ mood: e.target.value })} placeholder="氛围" />
          <input className="input-field" value={draft.colorPalette || ''} onChange={(e) => onDraft({ colorPalette: e.target.value })} placeholder="色彩方案：暖金色" />
          <input className="input-field" value={draft.continuityNotes || ''} onChange={(e) => onDraft({ continuityNotes: e.target.value })} placeholder="连续性备注" />
        </div>
        <Field label="负面词">
          <input
            className="input-field"
            value={draft.negativePrompt || ''}
            onChange={(e) => onDraft({ negativePrompt: e.target.value })}
            placeholder="多余手指、脸部变形、文字水印、风格不一致"
          />
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn-outline" onClick={onCancel}><Icon.X size={14} /> 取消</button>
          <button className="generate-btn" onClick={onSave}><Icon.Save size={14} /> 保存</button>
        </div>
      </div>
    )
  }

  // 展示模式
  const cameraParamsArr = [
    shot.camera?.shotSize,
    shot.camera?.focalLength && `${shot.camera.focalLength}mm`,
    shot.camera?.aperture,
    shot.camera?.angle,
  ].filter(Boolean);
  const lightingSummary = typeof shot.lighting === 'object'
    ? [shot.lighting.style, shot.lighting.keyDirection, shot.lighting.colorTemp].filter(Boolean).join(' · ')
    : (shot.lighting || '');

  return (
    <div className={`storyboard-shot-card ${shot.includeInGeneration === false ? 'excluded' : ''}`}>
      <div className="shot-header">
        <span className="shot-number">#{shot.shotNumber}</span>
        <strong className="shot-title">{shot.sceneTitle}</strong>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', fontSize: 12 }}>
          <input type="checkbox" checked={shot.includeInGeneration !== false} onChange={onToggle} />
          生成
        </label>
      </div>
      <p className="shot-description">{shot.imagePrompt || shot.description}</p>
      {/* 🆕 摄影参数徽章行 */}
      {cameraParamsArr.length > 0 && (
        <div className="shot-meta" style={{ marginTop: 4 }}>
          {cameraParamsArr.map((p, i) => <span className="tag tag-camera" key={`cam-${i}`}>🎬 {p}</span>)}
          {shot.camera?.composition && <span className="tag tag-camera">📐 {shot.camera.composition}</span>}
          {shot.camera?.position && <span className="tag tag-camera">📍 {shot.camera.position}</span>}
          {shot.camera?.depthOfField && <span className="tag tag-camera">🔍 {shot.camera.depthOfField}</span>}
        </div>
      )}
      {/* 🆕 灯光参数徽章行 */}
      {lightingSummary && (
        <div className="shot-meta" style={{ marginTop: 2 }}>
          <span className="tag tag-lighting">💡 {lightingSummary}</span>
          {shot.lighting?.quality && <span className="tag tag-lighting">✨ {shot.lighting.quality}</span>}
          {shot.lighting?.fillRatio && <span className="tag tag-lighting">⚖ {shot.lighting.fillRatio}</span>}
        </div>
      )}
      <div className="shot-meta">
        {shot.characters.map((item) => <span className="tag tag-character" key={`c-${item}`}>{item}</span>)}
        {shot.location && <span className="tag">{shot.location}</span>}
        {shot.mood && <span className="tag">{shot.mood}</span>}
      </div>
      {shot.keyElements?.length > 0 && (
        <div className="shot-tags">
          {shot.keyElements.map((item) => <span className="tag tag-element" key={`k-${item}`}>{item}</span>)}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {shot.estimatedDuration || '关键帧'}{shot.continuityNotes ? ` · ${shot.continuityNotes}` : ''}
        </span>
        <button className="btn-outline" onClick={onEdit}><Icon.Edit size={14} /> 编辑</button>
      </div>
    </div>
  )
}

function StoryboardPanel({ onBack, onNavigateToVideo }) {
  const [step, setStep] = useState('input')
  const [scriptMode, setScriptMode] = useState('manual')
  const [scriptText, setScriptText] = useState('')
  const [fileName, setFileName] = useState('')
  const [selectedStyle, setSelectedStyle] = useState('film')
  const [customStylePrompt, setCustomStylePrompt] = useState('')
  const [globalStylePrompt, setGlobalStylePrompt] = useState('')
  const [productionType, setProductionType] = useState('short_drama')
  const [cameraGrammar, setCameraGrammar] = useState('balanced')
  const [compositionGrammar, setCompositionGrammar] = useState('classic')
  const [qualityTags, setQualityTags] = useState('cinematic storyboard keyframe, consistent character, accurate composition, high detail')
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState('')
  const [rawResponse, setRawResponse] = useState('')
  const [assets, setAssets] = useState({ characters: [], locations: [], props: [], visualRules: '', styleNotes: '' })
  const [assetGenerating, setAssetGenerating] = useState('')
  const [shots, setShots] = useState([])
  const [editingShot, setEditingShot] = useState(null)
  const [editDraft, setEditDraft] = useState({})
  const [referenceImages, setReferenceImages] = useState({ characters: [], scenes: [], products: [] })
  const [refNotes, setRefNotes] = useState({ characters: '', scenes: '', products: '' })
  const [refUploading, setRefUploading] = useState('')
  const [selectedModel, setSelectedModel] = useState('gpt-image-2')
  const [selectedAspectRatio, setSelectedAspectRatio] = useState('16:9')
  const [selectedImageSize, setSelectedImageSize] = useState('1K')
  const [frameInterval, setFrameInterval] = useState(1)
  const [maxFrames, setMaxFrames] = useState(0)
  const [jobId, setJobId] = useState(null)
  const [jobShots, setJobShots] = useState([])
  const [enlargedImage, setEnlargedImage] = useState(null)
  const [downloading, setDownloading] = useState(false)

  const fileInputRef = useRef(null)
  const refFileRefs = {
    characters: useRef(null),
    scenes: useRef(null),
    products: useRef(null),
  }
  const pollingRef = useRef(null)

  useEffect(() => () => {
    if (pollingRef.current) clearInterval(pollingRef.current)
  }, [])

  const activeShotCount = shots.filter((shot) => shot.includeInGeneration !== false).length
  const estimatedTotal = useMemo(() => {
    const interval = Math.max(1, Number(frameInterval) || 1)
    const count = Math.ceil(activeShotCount / interval)
    return maxFrames > 0 ? Math.min(count, Number(maxFrames)) : count
  }, [activeShotCount, frameInterval, maxFrames])

  function buildDirectorGrammarPrompt() {
    const production = PRODUCTION_TYPES.find((item) => item.value === productionType)
    const camera = CAMERA_GRAMMARS.find((item) => item.value === cameraGrammar)
    const composition = COMPOSITION_GRAMMARS.find((item) => item.value === compositionGrammar)
    return [
      production ? `制作类型：${production.label}。${production.desc}` : '',
      camera ? `运镜偏好：${camera.label}。${camera.desc}` : '',
      composition ? `构图偏好：${composition.label}。${composition.desc}` : '',
      '每个分镜必须明确镜头运动、景别、焦段、机位、构图层次、前景/中景/远景关系；同一场景的角色、道具、光线和空间布局必须连续一致。',
    ].filter(Boolean).join('\n')
  }

  function buildAnalyzeStylePrompt() {
    return [
      selectedStyle === 'custom' ? customStylePrompt : '',
      buildDirectorGrammarPrompt(),
      globalStylePrompt ? `全局补充：${globalStylePrompt}` : '',
    ].filter(Boolean).join('\n')
  }

  const completedCount = jobShots.filter((shot) => shot.status === 'completed').length
  const failedCount = jobShots.filter((shot) => shot.status === 'failed').length
  const totalToGenerate = jobShots.filter((shot) => shot.includeInGeneration !== false && shot.status !== 'skipped').length
  const progressPct = totalToGenerate ? Math.round((completedCount / totalToGenerate) * 100) : 0
  const assetCount = (assets.characters?.length || 0) + (assets.locations?.length || 0) + (assets.props?.length || 0)

  function readScriptFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (event) => setScriptText(String(event.target?.result || ''))
    reader.readAsText(file)
  }

  async function handleAnalyze(includeAssets = true) {
    if (!scriptText.trim()) {
      setAnalyzeError('请先输入或上传剧本。')
      return
    }
    setAnalyzing(true)
    setAnalyzeError('')
    setRawResponse('')
    try {
      const resp = await fetch('/api/storyboard/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script: scriptText.trim(),
          style: selectedStyle,
          customStylePrompt: buildAnalyzeStylePrompt(),
          includeAssets,
        }),
      })
      const data = await resp.json()
      const payload = data.data || {}
      if (!data.success || payload.success === false) {
        setAnalyzeError(payload.message || data.message || 'AI 分镜解析失败。')
        if (payload.rawResponse) setRawResponse(payload.rawResponse)
        return
      }
      const nextShots = (payload.shots || []).map(normalizeShotForEdit)
      if (nextShots.length === 0) {
        setAnalyzeError('没有解析出可生成的分镜，请补充剧本中的画面信息后重试。')
        if (payload.rawResponse) setRawResponse(payload.rawResponse)
        return
      }
      setShots(nextShots)
      setAssets(payload.assets || { characters: [], locations: [], props: [], visualRules: '', styleNotes: '' })
      if (payload.wasTruncated) setAnalyzeError('剧本较长，已截取前 30000 字分析，请检查是否遗漏后半段。')
      if (payload.extractedByFallback) setAnalyzeError('AI 返回格式不标准，系统已尽量恢复分镜，请重点检查每个镜头。')
      if (payload.assetError) setAnalyzeError(`分镜已完成，但资产分析失败：${payload.assetError}`)
      setStep(includeAssets ? 'assets' : 'storyboard')
    } catch (err) {
      setAnalyzeError(err.message || '网络请求失败。')
    } finally {
      setAnalyzing(false)
    }
  }

  function updateAsset(groupKey, index, patch) {
    setAssets((prev) => ({
      ...prev,
      [groupKey]: (prev[groupKey] || []).map((asset, i) => (i === index ? { ...asset, ...patch } : asset)),
    }))
  }

  function assetGroupToRefCategory(groupKey) {
    if (groupKey === 'characters') return 'characters'
    if (groupKey === 'locations') return 'scenes'
    return 'products'
  }

  async function generateAssetReference(groupKey, index) {
    const asset = assets[groupKey]?.[index]
    if (!asset) return
    const prompt = [
      asset.visualPrompt || asset.description,
      asset.continuityRules ? `连续性要求：${asset.continuityRules}` : '',
      globalStylePrompt,
      '单一资产设定图，主体清晰，便于后续作为参考图使用，不要文字，不要水印。',
    ].filter(Boolean).join('\n')
    const key = `${groupKey}-${index}`
    setAssetGenerating(key)
    try {
      const resp = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalPrompt: asset.name,
          apiPrompt: prompt,
          model: selectedModel,
          aspectRatio: selectedAspectRatio,
          imageSize: selectedImageSize,
          referenceImages: [],
        }),
      })
      const data = await resp.json()
      if (!data.success) {
        alert(data.message || '资产参考图生成失败。')
        return
      }
      const imageUrl = data.data?.imageUrl
      updateAsset(groupKey, index, { imageUrl })
      const category = assetGroupToRefCategory(groupKey)
      setReferenceImages((prev) => ({
        ...prev,
        [category]: [
          ...prev[category],
          { url: imageUrl, localUrl: imageUrl, name: asset.name, note: asset.name },
        ].slice(0, 5),
      }))
    } catch (err) {
      alert(`资产参考图生成失败：${err.message || '网络错误'}`)
    } finally {
      setAssetGenerating('')
    }
  }

  function startEditShot(shot) {
    setEditingShot(shot.shotNumber)
    setEditDraft({
      ...shot,
      charactersText: joinList(shot.characters),
      propsText: joinList(shot.props),
    })
  }

  function saveEditShot() {
    setShots((prev) => prev.map((shot) => {
      if (shot.shotNumber !== editingShot) return shot
      // 从扁平 draft 字段重建嵌套 camera 和 lighting 对象
      const d = editDraft;
      const updated = {
        ...shot,
        sceneTitle: d.sceneTitle ?? shot.sceneTitle,
        description: d.description ?? shot.description,
        imagePrompt: d.imagePrompt ?? shot.imagePrompt,
        location: d.location ?? shot.location,
        sceneDescription: d.sceneDescription ?? shot.sceneDescription,
        mood: d.mood ?? shot.mood,
        colorPalette: d.colorPalette ?? shot.colorPalette,
        continuityNotes: d.continuityNotes ?? shot.continuityNotes,
        negativePrompt: d.negativePrompt ?? shot.negativePrompt,
        estimatedDuration: d.estimatedDuration ?? shot.estimatedDuration,
        cameraAngle: d.angle ?? d.cameraAngle ?? shot.cameraAngle,
        // 🆕 结构化 camera
        camera: {
          shotSize: d.shotSize ?? shot.camera?.shotSize ?? '',
          angle: d.angle ?? shot.camera?.angle ?? '',
          focalLength: d.focalLength ?? shot.camera?.focalLength ?? '',
          aperture: d.aperture ?? shot.camera?.aperture ?? '',
          composition: d.composition ?? shot.camera?.composition ?? '',
          position: d.position ?? shot.camera?.position ?? '',
          movement: d.movement ?? shot.camera?.movement ?? '',
          depthOfField: d.depthOfField ?? shot.camera?.depthOfField ?? '',
          lens: d.lens ?? shot.camera?.lens ?? '',
        },
        // 🆕 结构化 lighting
        lighting: {
          style: d.lightingStyle ?? (typeof shot.lighting === 'object' ? shot.lighting?.style : shot.lighting) ?? '',
          keyDirection: d.lightingDirection ?? (typeof shot.lighting === 'object' ? shot.lighting?.keyDirection : '') ?? '',
          fillRatio: d.lightingRatio ?? (typeof shot.lighting === 'object' ? shot.lighting?.fillRatio : '') ?? '',
          quality: d.lightingQuality ?? (typeof shot.lighting === 'object' ? shot.lighting?.quality : '') ?? '',
          colorTemp: d.lightingTemp ?? (typeof shot.lighting === 'object' ? shot.lighting?.colorTemp : '') ?? '',
        },
        characters: splitList(d.charactersText),
        props: splitList(d.propsText),
        keyElements: d.keyElements ?? shot.keyElements,
      };
      return normalizeShotForEdit(updated, shot.shotNumber - 1);
    }))
    setEditingShot(null)
    setEditDraft({})
  }

  function toggleShotInclude(shotNumber) {
    setShots((prev) => prev.map((shot) => (
      shot.shotNumber === shotNumber
        ? { ...shot, includeInGeneration: shot.includeInGeneration === false }
        : shot
    )))
  }

  async function uploadRefImage(file, category, note) {
    const form = new FormData()
    form.append('file', file)
    form.append('note', note || '')
    const resp = await fetch('/api/storyboard/upload-ref-image', { method: 'POST', body: form })
    const data = await resp.json()
    if (!data.success) throw new Error(data.message || '上传失败')
    return { ...data.data, note: note || data.data.note || '', category }
  }

  async function handleRefUpload(e, category) {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    const currentCount = referenceImages[category]?.length || 0
    if (currentCount + files.length > 5) {
      alert('每类参考图最多上传 5 张。')
      e.target.value = ''
      return
    }
    setRefUploading(category)
    try {
      const note = refNotes[category] || ''
      const uploaded = []
      for (const file of files) uploaded.push(await uploadRefImage(file, category, note))
      setReferenceImages((prev) => ({ ...prev, [category]: [...prev[category], ...uploaded] }))
      setRefNotes((prev) => ({ ...prev, [category]: '' }))
    } catch (err) {
      alert(`参考图上传失败：${err.message || '未知错误'}`)
    } finally {
      setRefUploading('')
      e.target.value = ''
    }
  }

  function updateRefNote(category, index, note) {
    setReferenceImages((prev) => ({
      ...prev,
      [category]: prev[category].map((item, i) => (i === index ? { ...item, note } : item)),
    }))
  }

  function removeRef(category, index) {
    setReferenceImages((prev) => ({
      ...prev,
      [category]: prev[category].filter((_, i) => i !== index),
    }))
  }

  function startPolling(id) {
    if (pollingRef.current) clearInterval(pollingRef.current)
    pollingRef.current = setInterval(async () => {
      try {
        const resp = await fetch(`/api/storyboard/status/${id}`)
        const data = await resp.json()
        if (!data.success || !data.data) return
        setJobShots((data.data.shots || []).map(normalizeShotForEdit))
        if (data.data.status === 'completed' || data.data.status === 'failed') {
          clearInterval(pollingRef.current)
          pollingRef.current = null
          if (data.data.status === 'completed') setStep('done')
        }
      } catch {
        // keep polling; transient network errors should not stop a long job
      }
    }, 2000)
  }

  async function handleStartGeneration() {
    if (activeShotCount === 0) {
      alert('至少保留一个分镜参与生成。')
      return
    }
    try {
      const resp = await fetch('/api/storyboard/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script: scriptText,
          scriptSource: scriptMode,
          style: selectedStyle,
          customStylePrompt: buildAnalyzeStylePrompt(),
          globalStylePrompt,
          assets,
          shots,
          referenceImages,
          config: {
            model: selectedModel,
            imageSize: selectedImageSize,
            aspectRatio: selectedAspectRatio,
            frameInterval,
            maxFrames,
            qualityTags,
            productionType,
            cameraGrammar,
            compositionGrammar,
            directorGrammar: buildDirectorGrammarPrompt(),
          },
        }),
      })
      const data = await resp.json()
      if (!data.success) {
        alert(data.message || '创建生成任务失败。')
        return
      }
      setJobId(data.data.jobId)
      setJobShots(shots.map((shot) => ({ ...shot, status: shot.includeInGeneration === false ? 'skipped' : 'pending' })))
      setStep('running')
      startPolling(data.data.jobId)
    } catch (err) {
      alert(`启动失败：${err.message || '网络错误'}`)
    }
  }

  async function handleAbort() {
    if (!jobId) return
    if (pollingRef.current) clearInterval(pollingRef.current)
    pollingRef.current = null
    try {
      await fetch(`/api/storyboard/abort/${jobId}`, { method: 'POST' })
    } catch {
      // ignore
    }
    setStep('config')
  }

  async function handleRetry(shotNumber) {
    if (!jobId) return
    const resp = await fetch(`/api/storyboard/retry/${jobId}/${shotNumber}`, { method: 'POST' })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok || data.success === false) {
      alert(data.message || '重试失败。')
      return
    }
    setJobShots((prev) => prev.map((shot) => (
      shot.shotNumber === shotNumber ? { ...shot, status: 'generating', error: null } : shot
    )))
    if (!pollingRef.current) startPolling(jobId)
  }

  function handleDownload() {
    if (!jobId) return
    setDownloading(true)
    const a = document.createElement('a')
    a.href = `/api/storyboard/download/${jobId}`
    a.download = `storyboard-${jobId}.zip`
    a.click()
    setTimeout(() => setDownloading(false), 1000)
  }

  function renderHeader(title, subtitle) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        {onBack && step === 'input' && (
          <button className="btn-back" onClick={onBack} title="返回">
            <Icon.ChevronLeft size={18} />
          </button>
        )}
        {step !== 'input' && step !== 'running' && step !== 'done' && (
          <button className="btn-back" onClick={() => setStep(step === 'storyboard' ? 'input' : 'storyboard')} title="上一步">
            <Icon.ChevronLeft size={18} />
          </button>
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{subtitle}</div>}
        </div>
      </div>
    )
  }

  function renderSteps() {
    return (
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {STEPS.map((item) => (
          <span
            key={item.key}
            style={{
              flex: 1,
              textAlign: 'center',
              padding: '6px 4px',
              borderRadius: 6,
              fontSize: 12,
              background: step === item.key ? 'var(--accent-color)' : 'var(--card-bg)',
              color: step === item.key ? '#04120f' : 'var(--text-muted)',
              fontWeight: step === item.key ? 700 : 500,
            }}
          >
            {item.label}
          </span>
        ))}
      </div>
    )
  }

  if (step === 'input') {
    return (
      <div className="storyboard-panel">
        <div className="config-panel">
          {renderHeader('AI 视频自动化', '先把剧本拆成可生成的电影分镜关键帧。')}
          {renderSteps()}

          <div className="tabs-row" style={{ marginBottom: 12 }}>
            <button className={`tab-btn ${scriptMode === 'manual' ? 'active' : ''}`} onClick={() => setScriptMode('manual')}>手动输入</button>
            <button className={`tab-btn ${scriptMode === 'upload' ? 'active' : ''}`} onClick={() => setScriptMode('upload')}>上传剧本</button>
          </div>

          {scriptMode === 'upload' ? (
            <div className="upload-area" style={{ padding: 16, border: '1px dashed var(--border-color)', borderRadius: 8, marginBottom: 12 }}>
              <input ref={fileInputRef} type="file" accept=".txt,.md" onChange={readScriptFile} style={{ display: 'none' }} />
              <button className="btn-outline" style={{ width: '100%' }} onClick={() => fileInputRef.current?.click()}>
                <Icon.Upload size={14} /> {fileName || '选择 .txt / .md 剧本文件'}
              </button>
            </div>
          ) : (
            <textarea
              className="input-field"
              rows={12}
              style={{ resize: 'vertical', minHeight: 180, fontFamily: 'inherit', marginBottom: 12 }}
              placeholder="输入脚本、短片文案、小说片段或广告脚本。越明确角色、场景、动作，分镜越准。"
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
            />
          )}

          <div className="section-label">视觉风格</div>
          <div className="storyboard-style-grid">
            {STYLE_PRESETS.map((preset) => (
              <button
                key={preset.value}
                className={`storyboard-style-card ${selectedStyle === preset.value ? 'active' : ''}`}
                onClick={() => setSelectedStyle(preset.value)}
                title={preset.desc}
              >
                <span className="style-card-label">{preset.label}</span>
              </button>
            ))}
          </div>

          {selectedStyle === 'custom' && (
            <Field label="自定义风格">
              <textarea className="input-field" rows={3} value={customStylePrompt} onChange={(e) => setCustomStylePrompt(e.target.value)} placeholder="例如：冷峻赛博朋克，蓝紫霓虹，雨夜反光地面。" />
            </Field>
          )}

          <div className="section-label">导演语法</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginBottom: 10 }}>
            <select className="input-field" value={productionType} onChange={(e) => setProductionType(e.target.value)}>
              {PRODUCTION_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <select className="input-field" value={cameraGrammar} onChange={(e) => setCameraGrammar(e.target.value)}>
              {CAMERA_GRAMMARS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <select className="input-field" value={compositionGrammar} onChange={(e) => setCompositionGrammar(e.target.value)}>
              {COMPOSITION_GRAMMARS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </div>

          <Field label="全局风格补充">
            <textarea className="input-field" rows={3} value={globalStylePrompt} onChange={(e) => setGlobalStylePrompt(e.target.value)} placeholder="例如：真实电影光影，35mm 镜头，统一角色服装，低饱和高对比。" />
          </Field>

          {analyzeError && <div className="error-box" style={{ whiteSpace: 'pre-wrap', marginBottom: 12 }}>{analyzeError}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          <button className="btn-outline" style={{ width: '100%' }} onClick={() => handleAnalyze(false)} disabled={analyzing || !scriptText.trim()}>
            <Icon.ChevronRight size={14} /> 跳过资产
          </button>
          <button className="generate-btn" style={{ width: '100%' }} onClick={() => handleAnalyze(true)} disabled={analyzing || !scriptText.trim()}>
            {analyzing ? <><Icon.Loader size={14} /> AI 正在分析</> : <><Icon.Brain size={14} /> AI 分析剧本</>}
          </button>
          </div>
        </div>

        <div className="results-panel">
          <div className="storyboard-empty">
            <Icon.Film size={42} />
            <h3>分镜预览</h3>
            <p>分析完成后，这里会出现镜头列表。你可以逐条修正角色、场景、机位和关键帧提示词，再开始生成图片。</p>
          </div>
          {rawResponse && (
            <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto', marginTop: 16, color: 'var(--text-muted)' }}>{rawResponse}</pre>
          )}
        </div>
      </div>
    )
  }

  if (step === 'assets') {
    const groups = [
      { key: 'characters', label: '角色资产', icon: Icon.User },
      { key: 'locations', label: '场景资产', icon: Icon.Building },
      { key: 'props', label: '道具资产', icon: Icon.Package },
    ]
    return (
      <div className="storyboard-panel">
        <div className="config-panel">
          {renderHeader('资产圣经', `${assetCount} 个资产会被用于后续分镜和关键帧一致性约束。`)}
          {renderSteps()}
          <div className="info-card" style={{ padding: 12, background: 'var(--card-bg)', borderRadius: 8, marginBottom: 12 }}>
            <strong>为什么要先做资产？</strong>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0' }}>
              小说里的卧室、走廊、AI 管家、制服这些如果不先固定，生图模型每张都会自由发挥。资产圣经会把它们变成可复用的美术设定。
            </p>
          </div>
          <Field label="全片视觉规则">
            <textarea className="input-field" rows={4} value={assets.visualRules || ''} onChange={(e) => setAssets((prev) => ({ ...prev, visualRules: e.target.value }))} />
          </Field>
          <Field label="美术补充">
            <textarea className="input-field" rows={3} value={assets.styleNotes || ''} onChange={(e) => setAssets((prev) => ({ ...prev, styleNotes: e.target.value }))} />
          </Field>
          <button className="generate-btn" style={{ width: '100%' }} onClick={() => setStep('storyboard')} disabled={analyzing}>
            <Icon.ChevronRight size={14} /> 下一步：检查分镜
          </button>
          <button className="btn-outline" style={{ width: '100%', marginTop: 8 }} onClick={() => setStep('input')}>返回剧本</button>
        </div>
        <div className="results-panel">
          {groups.map((group) => {
            const GroupIcon = group.icon
            return (
              <div key={group.key} style={{ marginBottom: 18 }}>
                <div className="section-label" style={{ fontSize: 15 }}><GroupIcon size={15} /> {group.label}</div>
                <div className="storyboard-shot-list">
                  {(assets[group.key] || []).map((asset, index) => (
                    <div key={`${group.key}-${asset.id || index}`} className="storyboard-shot-card">
                      <div className="shot-header">
                        <span className="shot-number">#{index + 1}</span>
                        <strong className="shot-title">{asset.name}</strong>
                        {asset.importance && <span className="tag" style={{ marginLeft: 'auto' }}>{asset.importance}</span>}
                      </div>
                      {asset.imageUrl && (
                        <img
                          src={asset.imageUrl}
                          alt={asset.name}
                          style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: 8, marginBottom: 10 }}
                        />
                      )}
                      <p className="shot-description">{asset.description || asset.visualPrompt}</p>
                      {asset.aliases?.length > 0 && (
                        <div className="shot-meta">
                          {asset.aliases.map((alias) => <span className="tag" key={alias}>{alias}</span>)}
                        </div>
                      )}
                      <Field label="资产提示词">
                        <textarea
                          className="input-field"
                          rows={4}
                          value={asset.visualPrompt || ''}
                          onChange={(e) => updateAsset(group.key, index, { visualPrompt: e.target.value })}
                          placeholder="用于生成角色/场景/道具参考图，也会约束后续关键帧。"
                        />
                      </Field>
                      {asset.continuityRules && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>连续性：{asset.continuityRules}</p>}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                        <button
                          className="btn-outline"
                          onClick={() => generateAssetReference(group.key, index)}
                          disabled={assetGenerating === `${group.key}-${index}`}
                        >
                          {assetGenerating === `${group.key}-${index}` ? <Icon.Loader size={14} /> : <Icon.Image size={14} />}
                          {asset.imageUrl ? '重新生成参考图' : '生成参考图'}
                        </button>
                      </div>
                    </div>
                  ))}
                  {(assets[group.key] || []).length === 0 && (
                    <div className="storyboard-empty" style={{ padding: 20 }}>暂无{group.label}</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (step === 'storyboard') {
    return (
      <div className="storyboard-panel">
        <div className="config-panel">
          {renderHeader('分镜审稿', `${shots.length} 个镜头，${activeShotCount} 个参与生成。`)}
          {renderSteps()}
          <div className="info-card" style={{ padding: 12, background: 'var(--card-bg)', borderRadius: 8, marginBottom: 12 }}>
            <strong>检查重点</strong>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0' }}>角色名、地点名、道具名要和参考图备注一致。每张图只描述一个清楚的画面，不要把多个动作塞进同一帧。</p>
          </div>
          <button className="generate-btn" style={{ width: '100%' }} onClick={() => setStep('config')}>
            <Icon.ChevronRight size={14} /> 下一步：参考图与生成参数
          </button>
        </div>
        <div className="results-panel">
          <div className="storyboard-shot-list">
            {shots.map((shot) => (
              <ShotCard
                key={shot.shotNumber}
                shot={shot}
                editing={editingShot === shot.shotNumber}
                draft={editDraft}
                onEdit={() => startEditShot(shot)}
                onDraft={(patch) => setEditDraft((prev) => ({ ...prev, ...patch }))}
                onSave={saveEditShot}
                onCancel={() => setEditingShot(null)}
                onToggle={() => toggleShotInclude(shot.shotNumber)}
              />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (step === 'config') {
    return (
      <div className="storyboard-panel">
        <div className="config-panel">
          {renderHeader('参考图与参数', '上传参考图后，系统会按角色/场景/道具自动匹配到镜头。')}
          {renderSteps()}

          {REF_CATEGORIES.map((cat) => {
            const CatIcon = cat.icon
            return (
              <div key={cat.key} className="storyboard-ref-section">
                <div className="section-label"><CatIcon size={14} /> {cat.label}</div>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 8px' }}>{cat.hint}</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="input-field" value={refNotes[cat.key]} onChange={(e) => setRefNotes((prev) => ({ ...prev, [cat.key]: e.target.value }))} placeholder="先写备注，再上传图片" />
                  <button className="generate-btn" disabled={refUploading === cat.key} onClick={() => refFileRefs[cat.key].current?.click()}>
                    {refUploading === cat.key ? <Icon.Loader size={14} /> : <Icon.Upload size={14} />} 上传
                  </button>
                </div>
                <input ref={refFileRefs[cat.key]} type="file" accept="image/*" multiple onChange={(e) => handleRefUpload(e, cat.key)} style={{ display: 'none' }} />
                <div className="storyboard-ref-thumbs">
                  {referenceImages[cat.key].map((img, idx) => (
                    <div className="storyboard-ref-thumb-wrapper" key={`${img.url}-${idx}`}>
                      <div className="storyboard-ref-thumb">
                        <img src={img.localUrl || img.url} alt={img.note || img.name} />
                        <button className="ref-remove-btn" onClick={() => removeRef(cat.key, idx)} title="移除"><Icon.X size={12} /></button>
                      </div>
                      <input
                        className="input-field"
                        style={{ fontSize: 11, padding: '4px 6px' }}
                        value={img.note || ''}
                        onChange={(e) => updateRefNote(cat.key, idx, e.target.value)}
                        placeholder="参考图备注"
                      />
                    </div>
                  ))}
                  {referenceImages[cat.key].length < 5 && (
                    <button className="storyboard-ref-add" onClick={() => refFileRefs[cat.key].current?.click()} disabled={!!refUploading}>
                      <Icon.Plus size={18} />
                    </button>
                  )}
                </div>
              </div>
            )
          })}

          <Field label="生成模型">
            <select className="input-field" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
              {MODEL_OPTIONS.map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
            </select>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            <Field label="清晰度">
              <select className="input-field" value={selectedImageSize} onChange={(e) => setSelectedImageSize(e.target.value)}>
                {IMAGE_SIZES.map((size) => <option key={size.value} value={size.value}>{size.label}</option>)}
              </select>
            </Field>
            <Field label="画幅">
              <select className="input-field" value={selectedAspectRatio} onChange={(e) => setSelectedAspectRatio(e.target.value)}>
                {ASPECT_RATIOS.map((ratio) => <option key={ratio.value} value={ratio.value}>{ratio.label}</option>)}
              </select>
            </Field>
            <Field label="间隔">
              <input className="input-field" type="number" min="1" max="10" value={frameInterval} onChange={(e) => setFrameInterval(Math.max(1, Number(e.target.value) || 1))} />
            </Field>
            <Field label="最多张数">
              <input className="input-field" type="number" min="0" max="100" value={maxFrames} onChange={(e) => setMaxFrames(Math.max(0, Number(e.target.value) || 0))} />
            </Field>
          </div>
          <Field label="画质标签">
            <textarea className="input-field" rows={3} value={qualityTags} onChange={(e) => setQualityTags(e.target.value)} />
          </Field>

          <div className="info-card" style={{ padding: 12, background: 'var(--card-bg)', borderRadius: 8, textAlign: 'center', marginBottom: 12 }}>
            <strong style={{ fontSize: 24, color: 'var(--accent-color)' }}>{estimatedTotal}</strong>
            <span style={{ color: 'var(--text-muted)' }}> 张关键帧将被生成</span>
          </div>
          <button className="generate-btn" style={{ width: '100%' }} onClick={handleStartGeneration}>
            <Icon.Sparkles size={14} /> 开始生成关键帧
          </button>
        </div>

        <div className="results-panel">
          <div className="section-label">生成清单</div>
          <div className="storyboard-summary-list">
            {shots.filter((shot) => shot.includeInGeneration !== false).map((shot) => (
              <div key={shot.shotNumber} className="storyboard-summary-item">
                <span className="shot-number">#{shot.shotNumber}</span>
                <span className="shot-title">{shot.sceneTitle}</span>
                <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{shot.location || shot.cameraAngle}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (step === 'running') {
    return (
      <div className="storyboard-panel" style={{ flexDirection: 'column' }}>
        <div className="storyboard-progress-header">
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>关键帧生成中</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{completedCount}/{totalToGenerate} 完成{failedCount > 0 ? `，${failedCount} 失败` : ''}</div>
          </div>
          <button className="btn-outline" style={{ color: '#ef4444', borderColor: '#ef4444' }} onClick={handleAbort}>中止</button>
        </div>
        <div className="progress-bar-container" style={{ margin: '8px 0 16px' }}>
          <div className="progress-bar" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="storyboard-results-grid" style={{ overflowY: 'auto', flex: 1 }}>
          {jobShots.filter((shot) => shot.includeInGeneration !== false).map((shot) => (
            <div key={shot.shotNumber} className={`storyboard-result-card status-${shot.status}`}>
              {shot.status === 'completed' && shot.resultImageUrl ? (
                <img className="storyboard-result-thumb" src={shot.resultImageUrl} alt={shot.sceneTitle} onClick={() => setEnlargedImage(shot.resultImageUrl)} />
              ) : (
                <div className="storyboard-result-placeholder">
                  <StatusIcon status={shot.status} />
                  <span>{statusLabel(shot.status)}</span>
                </div>
              )}
              <div className="storyboard-result-info">
                <span className="shot-number">#{shot.shotNumber}</span>
                <span className="shot-title">{shot.sceneTitle}</span>
                {shot.status === 'failed' && <button className="btn-outline" onClick={() => handleRetry(shot.shotNumber)}>重试</button>}
              </div>
              {shot.error && <div className="shot-error-tooltip">{shot.error}</div>}
            </div>
          ))}
        </div>
        {enlargedImage && (
          <div className="modal-backdrop" onClick={() => setEnlargedImage(null)}>
            <div className="storyboard-modal">
              <img src={enlargedImage} alt="关键帧预览" />
              <button className="modal-close" onClick={() => setEnlargedImage(null)}><Icon.X size={16} /></button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="storyboard-panel" style={{ flexDirection: 'column' }}>
      <div className="storyboard-done-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 700 }}><Icon.Check size={22} color="#10b981" /> 关键帧生成完成</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>成功 {completedCount} 张{failedCount > 0 ? `，失败 ${failedCount} 张` : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-outline" onClick={handleDownload} disabled={downloading}><Icon.Download size={14} /> {downloading ? '打包中' : '下载 ZIP'}</button>
          {onNavigateToVideo && <button className="generate-btn" onClick={onNavigateToVideo}><Icon.Video size={14} /> 去生成视频</button>}
          <button className="btn-outline" onClick={() => setStep('input')}>新任务</button>
        </div>
      </div>
      <div className="storyboard-results-grid" style={{ overflowY: 'auto', flex: 1 }}>
        {jobShots.map((shot) => (
          <div key={shot.shotNumber} className={`storyboard-result-card status-${shot.status}`}>
            {shot.resultImageUrl ? (
              <img className="storyboard-result-thumb" src={shot.resultImageUrl} alt={shot.sceneTitle} onClick={() => setEnlargedImage(shot.resultImageUrl)} />
            ) : (
              <div className="storyboard-result-placeholder">
                <StatusIcon status={shot.status} />
                <span>{statusLabel(shot.status)}</span>
              </div>
            )}
            <div className="storyboard-result-info">
              <span className="shot-number">#{shot.shotNumber}</span>
              <span className="shot-title">{shot.sceneTitle}</span>
              {shot.status === 'failed' && <button className="btn-outline" onClick={() => handleRetry(shot.shotNumber)}>重试</button>}
            </div>
          </div>
        ))}
      </div>
      {enlargedImage && (
        <div className="modal-backdrop" onClick={() => setEnlargedImage(null)}>
          <div className="storyboard-modal">
            <img src={enlargedImage} alt="关键帧预览" />
            <button className="modal-close" onClick={() => setEnlargedImage(null)}><Icon.X size={16} /></button>
          </div>
        </div>
      )}
    </div>
  )
}

export default StoryboardPanel
