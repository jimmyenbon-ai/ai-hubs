import { useMemo, useState } from 'react'

const FOCAL_PRESETS = [
  { label: '18mm 超广角', fov: 90 },
  { label: '24mm 广角', fov: 74 },
  { label: '35mm 人文', fov: 54 },
  { label: '50mm 标准', fov: 40 },
  { label: '85mm 长焦', fov: 24 },
]

const PROP_CATS = {
  base: ['box', 'cylinder', 'platform', 'wall'],
  indoor: ['bed', 'table', 'desk', 'chair', 'sofa', 'cabinet', 'bookshelf', 'shelf', 'door', 'window', 'screen', 'carpet'],
  scifi: ['corridor', 'elevator', 'console', 'cockpit', 'hatch', 'med_bed', 'lab_table'],
  city: ['building', 'street', 'lamp', 'billboard', 'bridge'],
  product: ['led_screen', 'product_box', 'product_panel', 'hologram'],
  space: ['airplane', 'spacecraft', 'planet', 'asteroid', 'starfield'],
}

const CAT_LABELS = {
  base: '基础',
  indoor: '室内',
  scifi: '科幻',
  city: '城市',
  product: '产品',
  space: '空天',
}

const PROP_LABELS = {
  box: '方块',
  cylinder: '圆柱',
  platform: '平台',
  wall: '墙体',
  bed: '床',
  table: '桌子',
  desk: '书桌',
  chair: '椅子',
  sofa: '沙发',
  cabinet: '柜子',
  bookshelf: '书架',
  shelf: '置物架',
  door: '门',
  window: '窗户',
  screen: '屏幕',
  carpet: '地毯',
  corridor: '走廊',
  elevator: '电梯',
  console: '控制台',
  cockpit: '驾驶舱',
  hatch: '舱门',
  med_bed: '医疗床',
  lab_table: '实验台',
  building: '建筑',
  street: '街道',
  lamp: '路灯',
  billboard: '广告牌',
  bridge: '天桥',
  led_screen: 'LED屏',
  product_box: '产品盒',
  product_panel: '产品板',
  hologram: '全息板',
  airplane: '飞机',
  spacecraft: '飞船',
  planet: '星球',
  asteroid: '小行星',
  starfield: '星空',
}

const CAMERA_MODES = [
  { value: 'fixed', label: '固定' },
  { value: 'follow', label: '跟拍' },
  { value: 'orbit', label: '环绕' },
  { value: 'drone', label: '无人机' },
  { value: 'handheld', label: '手持' },
]

const ASPECTS = [
  { value: '16:9', label: '16:9' },
  { value: '2.35:1', label: '宽银幕' },
  { value: '9:16', label: '竖屏' },
  { value: '1:1', label: '方形' },
]

const POSE_PRESET_LIST = [
  { key: 'stand', label: '站立' },
  { key: 'sit', label: '坐下' },
  { key: 'lie', label: '躺下' },
  { key: 'wave', label: '挥手' },
  { key: 'point', label: '指向' },
  { key: 'bow', label: '低头' },
  { key: 'crouch', label: '蹲下' },
]

const TRANSFORM_MODES = [
  { key: 'translate', label: '移动 W' },
  { key: 'rotate', label: '旋转 E' },
  { key: 'scale', label: '缩放 R' },
]

const DIRECTOR_PROFILES = [
  { value: 'film_director', label: '电影导演' },
  { value: 'cinematographer', label: '电影摄影师' },
  { value: '3d_animator', label: '3D动画师' },
  { value: 'product_animator', label: '产品动画师' },
  { value: 'commercial_director', label: '广告导演' },
]

const MATERIAL_TYPES = [
  { value: 'prompt', label: '手动需求' },
  { value: 'script', label: '剧本脚本' },
  { value: 'novel', label: '小说段落' },
  { value: 'product', label: '产品动画' },
  { value: 'space_air', label: '空中/太空' },
]

const QUICK_TEMPLATES = [
  {
    label: 'LED屏产品动画',
    prompt: '12秒产品灰模动画：创建一个正方形LED显示屏模型，摄影机固定在正前方略低角度。LED屏从暗场中升起，轻微旋转展示厚度，然后屏幕像素网格依次点亮，最后推近到屏幕正面。自动添加产品道具关键帧、摄影机关键帧并录制参考片。',
  },
  {
    label: '太空飞行预演',
    prompt: '10秒太空灰模动画：创建星空、行星、小行星和一艘飞船。飞船从画面左下方悬空掠过，摄影机先广角跟随，再长焦压缩到飞船侧面，最后推到行星前景。不要地面依赖，所有物体可以悬空移动，自动录制参考片。',
  },
  {
    label: '客厅对话',
    prompt: '创建一个客厅场景，中间放一张桌子，两边各一把椅子，两名演员面对面坐着聊天，用中景镜头从正面拍摄，并保留清晰的地毯和桌椅参照物。',
  },
  {
    label: '一镜到底跟拍',
    prompt: '10秒一镜到底：两个人并列走动聊天，摄影机从两人后方开始，绕到侧面跟拍，再到前方倒退拍摄；要有推拉变焦，FOV从54逐渐变到40再到28。自动生成场景、人物、摄影机关键帧，并录制10秒摄影机参考片。',
  },
]

function statusLabel(status) {
  if (status === 'generated') return '已生成'
  if (status === 'generating') return '生成中'
  if (status === 'failed') return '失败'
  if (status === 'tuned') return '已微调'
  return '待审核'
}

export default function ControlPanel({
  actors,
  selectedActor,
  selectedJoint,
  onAddActor,
  onSelectActor,
  onDeleteActor,
  onRenameActor,
  onApplyPose,
  onStartPlacement,
  placementMode,
  onCancelPlacement,
  cameras,
  selectedCamera,
  activeCameraId,
  onSelectCamera,
  onSetActiveCamera,
  onFocusCamera,
  onResetCamera,
  cameraFov,
  setCameraFov,
  cameraMode,
  setCameraMode,
  aspectRatio,
  setAspectRatio,
  transformMode,
  setTransformMode,
  showGrid,
  setShowGrid,
  showGuides,
  setShowGuides,
  isPlaying,
  isRecording,
  loopMode,
  onPlay,
  onPause,
  onStop,
  onRecord,
  onLoop,
  onAddKeyframe,
  onScreenshot,
  onRecordVideo,
  onExportMode,
  onOpenProject,
  isVideoRecording,
  aiLoading,
  aiStatus,
  aiError,
  onAIDirect,
  onAIShotPlan,
  shotPlan,
  shotPlanLoading,
  selectedShotId,
  onSelectShot,
  onUpdateShot,
  onGenerateShotPreview,
  onUndoAI,
  hasAISnapshot,
  commandHistory,
  onClearAIError,
  backgroundImages,
  onBackgroundUpload,
  onClearBackground,
  onUpdateBackground,
  onRemoveBackground,
  onFitBackgroundToCamera,
}) {
  const [tab, setTab] = useState('ai')
  const [propCat, setPropCat] = useState('indoor')
  const [renameId, setRenameId] = useState(null)
  const [renameVal, setRenameVal] = useState('')
  const [aiPrompt, setAiPrompt] = useState('')
  const [directorProfile, setDirectorProfile] = useState('film_director')
  const [materialType, setMaterialType] = useState('prompt')
  const [scriptTitle, setScriptTitle] = useState('')
  const [scriptText, setScriptText] = useState('')
  const [tweakText, setTweakText] = useState('')

  const tabs = [
    { key: 'ai', label: 'AI分镜' },
    { key: 'actors', label: '角色' },
    { key: 'props', label: '场景' },
    { key: 'camera', label: '摄影机' },
    { key: 'export', label: '导出' },
  ]

  const selectedShot = useMemo(() => {
    if (!shotPlan?.shots?.length) return null
    return shotPlan.shots.find((shot) => shot.id === selectedShotId) || shotPlan.shots[0]
  }, [selectedShotId, shotPlan])

  const hasAIInput = Boolean(aiPrompt.trim() || scriptText.trim())
  const shouldPlanFirst = scriptText.trim() || aiPrompt.length > 1200 || materialType === 'script' || materialType === 'novel'

  const buildAIPayload = () => {
    const sourceBlock = scriptText.trim()
      ? `\n\n[上传文本/剧本：${scriptTitle || '未命名'}]\n${scriptText.trim()}`
      : ''
    return {
      prompt: `${aiPrompt.trim()}${sourceBlock}`,
      directorProfile,
      materialType,
      sourceTitle: scriptTitle,
    }
  }

  const handleGenerateShotPlan = () => {
    if (!hasAIInput || aiLoading || shotPlanLoading) return
    onAIShotPlan?.(buildAIPayload())
  }

  const handleSendAI = () => {
    if (!hasAIInput || aiLoading) return
    if (shouldPlanFirst && onAIShotPlan) {
      handleGenerateShotPlan()
      return
    }
    onAIDirect(buildAIPayload())
  }

  const handleScriptUpload = async (file) => {
    if (!file) return
    const text = await file.text()
    setScriptTitle(file.name)
    setScriptText(text.slice(0, 16000))
    setMaterialType('novel')
    if (!aiPrompt.trim()) {
      setAiPrompt('请解析我上传的文本，先智能拆分镜头，列出每个分镜的秒数、景别、机位、焦段、运镜、场景、角色动作和衔接方式，待我审核后再逐镜生成3D预演参考片。')
    }
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSendAI()
    }
  }

  const updateBackgroundPosition = (image, index, value) => {
    const position = [...(image.position || [0, 0, 0])]
    position[index] = Number(value) || 0
    onUpdateBackground?.(image.id, { position })
  }

  const updateSelectedShot = (patch) => {
    if (!selectedShot) return
    onUpdateShot?.(selectedShot.id, patch)
  }

  const generateSelectedShot = (mode = 'generate') => {
    if (!selectedShot) return
    const tweak = mode === 'tweak' ? tweakText.trim() : ''
    const extra = mode === 'regenerate'
      ? '\n[重新生成要求] 保留这个分镜的叙事目标，但换一版更准确、更有镜头动机的构图和运镜。'
      : tweak ? `\n[人工微调要求]\n${tweak}` : ''
    onGenerateShotPreview?.({
      ...selectedShot,
      status: mode === 'tweak' ? 'tuned' : selectedShot.status,
      previz_prompt: `${selectedShot.previz_prompt || ''}${extra}`,
    })
  }

  return (
    <aside className="previz-control-panel">
      <div className="previz-control-head">
        <div>
          <h3>3D 预演导演</h3>
          <small>分镜审核 · 灰模运镜 · 60fps导出</small>
        </div>
      </div>

      <div className={`previz-rec-bar ${isRecording ? 'active' : ''}`}>
        <button className={`previz-rec-btn ${isRecording ? 'active' : ''}`} onClick={isRecording ? onStop : onRecord}>
          {isRecording ? '停动作' : '录动作'}
        </button>
        <button className="previz-rec-btn" onClick={isPlaying ? onPause : onPlay}>{isPlaying ? '暂停' : '播放'}</button>
        <button className="previz-rec-btn" onClick={onStop}>停止</button>
        <button className={`previz-rec-btn ${loopMode ? 'active' : ''}`} onClick={onLoop}>循环</button>
        <button className="previz-rec-btn" onClick={onAddKeyframe}>关键帧</button>
        <button className={`previz-rec-btn ${isVideoRecording ? 'active' : ''}`} onClick={onRecordVideo}>
          {isVideoRecording ? '停MP4' : '录MP4'}
        </button>
      </div>

      <div className="control-group previz-mode-row">
        {TRANSFORM_MODES.map((mode) => (
          <button key={mode.key} className={`btn btn-sm ${transformMode === mode.key ? 'active' : ''}`} onClick={() => setTransformMode(mode.key)}>
            {mode.label}
          </button>
        ))}
      </div>

      <div className="previz-tabs">
        {tabs.map((item) => (
          <button key={item.key} className={`previz-tab ${tab === item.key ? 'active' : ''}`} onClick={() => setTab(item.key)}>
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'ai' && (
        <div className="previz-tab-content previz-ai-tab">
          <section className="previz-ai-compact">
            <div className="previz-step-title"><span>1</span><strong>输入需求 / 上传文本</strong></div>
            <div className="previz-ai-workflow">
              <label>
                LLM身份
                <select className="input-field" value={directorProfile} onChange={(event) => setDirectorProfile(event.target.value)} disabled={aiLoading}>
                  {DIRECTOR_PROFILES.map((profile) => <option key={profile.value} value={profile.value}>{profile.label}</option>)}
                </select>
              </label>
              <label>
                素材类型
                <select className="input-field" value={materialType} onChange={(event) => setMaterialType(event.target.value)} disabled={aiLoading}>
                  {MATERIAL_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                </select>
              </label>
            </div>

            <div className="previz-script-box">
              <div className="previz-wrap-row">
                <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                  上传脚本
                  <input
                    type="file"
                    accept=".txt,.md,.markdown,.csv,.json,.srt,.vtt,.text"
                    style={{ display: 'none' }}
                    onChange={(event) => {
                      handleScriptUpload(event.target.files?.[0])
                      event.target.value = ''
                    }}
                  />
                </label>
                {scriptText && <button className="btn btn-sm" onClick={() => { setScriptText(''); setScriptTitle('') }}>清除文本</button>}
                {scriptText && <span className="previz-script-chip">{scriptTitle || '已上传'} · {scriptText.length}字</span>}
              </div>
            </div>

            <textarea
              className="previz-ai-input"
              placeholder="例如：10秒一镜到底，两个人并列走动聊天，摄影机从后方绕到侧面再到前方，带变焦，对准人脸，地面参照清楚，最后导出MP4。"
              value={aiPrompt}
              onChange={(event) => setAiPrompt(event.target.value)}
              onKeyDown={handleKeyDown}
              rows={4}
              disabled={aiLoading}
            />

            <div className="previz-ai-actions">
              <button className="btn previz-ai-send" onClick={handleSendAI} disabled={aiLoading || !hasAIInput}>
                {aiLoading ? '执行中...' : shouldPlanFirst ? '生成分镜计划' : '直接执行'}
              </button>
              <button className="btn btn-sm" onClick={handleGenerateShotPlan} disabled={aiLoading || shotPlanLoading || !hasAIInput}>
                {shotPlanLoading ? '拆分中...' : '拆分镜'}
              </button>
              {hasAISnapshot?.() && <button className="btn btn-sm" onClick={onUndoAI}>撤销AI</button>}
            </div>
          </section>

          {shotPlan?.shots?.length > 0 && (
            <section className="previz-shot-plan">
              <div className="previz-step-title"><span>2</span><strong>审核分镜队列</strong></div>
              <div className="previz-shot-plan-head">
                <strong>{shotPlan.title || 'AI分镜计划'}</strong>
                <span>{shotPlan.shots.length}镜 · {shotPlan.total_duration}s</span>
              </div>
              {shotPlan.continuity && <p className="previz-shot-continuity">{shotPlan.continuity}</p>}

              <div className="previz-shot-queue">
                {shotPlan.shots.map((shot, index) => (
                  <button
                    key={shot.id}
                    type="button"
                    className={`previz-shot-row ${selectedShot?.id === shot.id ? 'active' : ''}`}
                    onClick={() => onSelectShot?.(shot.id)}
                  >
                    <span className="previz-shot-index">{String(index + 1).padStart(2, '0')}</span>
                    <span className="previz-shot-main">
                      <strong>{shot.title || shot.id}</strong>
                      <small>{shot.duration}s · {shot.shot_size || '景别'} · {shot.focal || '焦段'}</small>
                    </span>
                    <span className={`previz-shot-status ${shot.status || 'pending'}`}>{statusLabel(shot.status)}</span>
                  </button>
                ))}
              </div>

              {selectedShot && (
                <div className="previz-shot-detail">
                  <div className="previz-shot-detail-head">
                    <strong>{selectedShot.id} · {selectedShot.title}</strong>
                    <span>{statusLabel(selectedShot.status)}</span>
                  </div>
                  <div className="previz-shot-grid">
                    <label>秒数<input className="input-field small" type="number" min="1" max="20" value={selectedShot.duration} onChange={(event) => updateSelectedShot({ duration: Number(event.target.value) || selectedShot.duration })} /></label>
                    <label>景别<input className="input-field small" value={selectedShot.shot_size || ''} onChange={(event) => updateSelectedShot({ shot_size: event.target.value })} /></label>
                    <label>焦段<input className="input-field small" value={selectedShot.focal || ''} onChange={(event) => updateSelectedShot({ focal: event.target.value })} /></label>
                    <label>FOV<input className="input-field small" type="number" min="15" max="90" value={selectedShot.fov || ''} onChange={(event) => updateSelectedShot({ fov: Number(event.target.value) || undefined })} /></label>
                  </div>
                  <label className="previz-shot-field">机位角度<input className="input-field small" value={selectedShot.camera_angle || ''} onChange={(event) => updateSelectedShot({ camera_angle: event.target.value })} /></label>
                  <label className="previz-shot-field">运镜<input className="input-field small" value={selectedShot.camera_movement || ''} onChange={(event) => updateSelectedShot({ camera_movement: event.target.value })} /></label>
                  <label className="previz-shot-field">动作 / 画面目标<textarea className="input-field small" rows={2} value={selectedShot.visual_goal || selectedShot.action || ''} onChange={(event) => updateSelectedShot({ visual_goal: event.target.value })} /></label>
                  <label className="previz-shot-field">微调要求<textarea className="input-field small" rows={2} value={tweakText} onChange={(event) => setTweakText(event.target.value)} placeholder="例如：镜头再低一点，对准人脸，前景多一点，地面参照更明显。" /></label>

                  <div className="previz-shot-actions">
                    <button className="btn btn-sm" disabled={aiLoading || selectedShot.status === 'generating'} onClick={() => generateSelectedShot('generate')}>生成本镜</button>
                    <button className="btn btn-sm" disabled={aiLoading || selectedShot.status === 'generating'} onClick={() => generateSelectedShot('regenerate')}>重新生成</button>
                    <button className="btn btn-sm" disabled={aiLoading || selectedShot.status === 'generating' || !tweakText.trim()} onClick={() => generateSelectedShot('tweak')}>按微调生成</button>
                  </div>
                </div>
              )}
            </section>
          )}

          {aiLoading && aiStatus && (
            <div className="previz-ai-status">
              <div className="previz-ai-spinner" />
              <span>{aiStatus.message}</span>
            </div>
          )}

          {aiError && (
            <div className="previz-ai-error">
              <span>{aiError}</span>
              <button className="btn-back" onClick={onClearAIError}>X</button>
            </div>
          )}

          <details className="previz-details">
            <summary>快速模板</summary>
            <div className="previz-quick-templates compact">
              {QUICK_TEMPLATES.map((tpl) => (
                <button key={tpl.label} className="btn btn-sm previz-template-btn" onClick={() => { setAiPrompt(tpl.prompt) }} disabled={aiLoading} title={tpl.prompt}>
                  {tpl.label}
                </button>
              ))}
            </div>
          </details>

          {commandHistory.length > 0 && (
            <details className="previz-details">
              <summary>最近指令</summary>
              <div className="previz-history-list">
                {commandHistory.slice(0, 4).map((item, index) => (
                  <button key={`${item.timestamp}-${index}`} className="previz-history-item" onClick={() => { setAiPrompt(item.prompt) }} title={item.explanation || ''}>
                    <span className="history-prompt">{item.prompt.length > 34 ? `${item.prompt.slice(0, 34)}...` : item.prompt}</span>
                    <span className="history-meta">{item.applied}条</span>
                  </button>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {tab === 'actors' && (
        <div className="previz-tab-content">
          <button className="btn btn-sm previz-full-btn" onClick={onAddActor}>+ 添加演员</button>
          <div className="previz-actor-list">
            {actors.map((actor) => (
              <div key={actor.id} className={`previz-actor-item ${selectedActor === actor.id ? 'active' : ''}`} onClick={() => onSelectActor(actor.id)}>
                <span className="actor-color-dot" style={{ background: actor.color }} />
                {renameId === actor.id ? (
                  <input
                    className="input-field"
                    value={renameVal}
                    onChange={(event) => setRenameVal(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        onRenameActor(actor.id, renameVal || actor.name)
                        setRenameId(null)
                      }
                      if (event.key === 'Escape') setRenameId(null)
                    }}
                    onClick={(event) => event.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  <span className="actor-name" onDoubleClick={() => { setRenameId(actor.id); setRenameVal(actor.name) }}>{actor.name}</span>
                )}
                <button className="btn-back" onClick={(event) => { event.stopPropagation(); onDeleteActor(actor.id) }}>X</button>
              </div>
            ))}
          </div>
          {selectedActor && (
            <div className="previz-section">
              <div className="section-label">姿势预设</div>
              <div className="previz-pose-grid">
                {POSE_PRESET_LIST.map((pose) => <button key={pose.key} className="btn btn-sm" onClick={() => onApplyPose(pose.key)}>{pose.label}</button>)}
              </div>
              <p className="previz-help-text">选中演员：W/A/S/D 移动，Q/E 转向，Shift 加速。当前关节：{selectedJoint || '未选择'}</p>
            </div>
          )}
        </div>
      )}

      {tab === 'props' && (
        <div className="previz-tab-content">
          <div className="previz-section" style={{ marginBottom: 12 }}>
            <div className="section-label">参考图 / 背景图</div>
            <div className="previz-wrap-row">
              <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                上传背景
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(event) => {
                    Array.from(event.target.files || []).forEach((file) => onBackgroundUpload?.(file))
                    event.target.value = ''
                  }}
                />
              </label>
              {(backgroundImages || []).length > 0 && <button className="btn btn-sm" onClick={onClearBackground}>清空</button>}
            </div>
            {(backgroundImages || []).length === 0 && <p className="previz-help-text">上传后会按图片比例放进场景，支持平面背景或180度全景；AI 生成新镜头时会保留这些图片。</p>}
            {(backgroundImages || []).map((image) => (
              <div key={image.id} className="previz-bg-card">
                <div className="previz-bg-card-head">
                  <span title={image.name}>{image.name}</span>
                  <button className="btn-back" onClick={() => onRemoveBackground?.(image.id)}>X</button>
                </div>
                <div className="previz-bg-grid">
                  <label>宽<input type="number" className="input-field small" value={Number(image.width || 1).toFixed(1)} step="0.5" onChange={(event) => onUpdateBackground?.(image.id, { width: Number(event.target.value) || image.width })} /></label>
                  <label>高<input type="number" className="input-field small" value={Number(image.height || 1).toFixed(1)} step="0.5" onChange={(event) => onUpdateBackground?.(image.id, { height: Number(event.target.value) || image.height })} /></label>
                  <label>X<input type="number" className="input-field small" value={Number(image.position?.[0] || 0).toFixed(1)} step="0.5" onChange={(event) => updateBackgroundPosition(image, 0, event.target.value)} /></label>
                  <label>Y<input type="number" className="input-field small" value={Number(image.position?.[1] || 0).toFixed(1)} step="0.5" onChange={(event) => updateBackgroundPosition(image, 1, event.target.value)} /></label>
                  <label>Z<input type="number" className="input-field small" value={Number(image.position?.[2] || 0).toFixed(1)} step="0.5" onChange={(event) => updateBackgroundPosition(image, 2, event.target.value)} /></label>
                  <label>旋转<input type="number" className="input-field small" value={Math.round(((image.rotation?.[1] || 0) * 180) / Math.PI)} step="5" onChange={(event) => onUpdateBackground?.(image.id, { rotation: [image.rotation?.[0] || 0, (Number(event.target.value) * Math.PI) / 180, image.rotation?.[2] || 0] })} /></label>
                </div>
                <div className="previz-wrap-row">
                  <button className="btn btn-sm" onClick={() => onFitBackgroundToCamera?.(image.id)}>适配机位</button>
                  <button className="btn btn-sm" onClick={() => onUpdateBackground?.(image.id, { arc: image.arc ? 0 : Math.PI })}>{image.arc ? '平面图' : '180全景'}</button>
                </div>
              </div>
            ))}
          </div>

          {placementMode ? (
            <div className="previz-placement-card">正在放置：{PROP_LABELS[placementMode] || placementMode}<button className="btn btn-sm" onClick={onCancelPlacement}>取消</button></div>
          ) : (
            <p className="previz-help-text">选择道具后在地面点击放置。地面镜头建议加地毯、路面、桌椅或标记物，走动时更有参照。</p>
          )}
          <div className="previz-category-row">
            {Object.keys(PROP_CATS).map((cat) => <button key={cat} className={`btn btn-sm ${propCat === cat ? 'active' : ''}`} onClick={() => setPropCat(cat)}>{CAT_LABELS[cat]}</button>)}
          </div>
          <div className="previz-prop-grid">
            {(PROP_CATS[propCat] || []).map((type) => (
              <button key={type} className={`previz-prop-btn ${placementMode === type ? 'active' : ''}`} onClick={() => placementMode === type ? onCancelPlacement() : onStartPlacement(type)}>
                {PROP_LABELS[type] || type}
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'camera' && (
        <div className="previz-tab-content">
          <div className="control-group">
            <label>摄影机</label>
            <div className="previz-wrap-row">
              {cameras.map((camera) => <button key={camera.id} className={`btn btn-sm ${selectedCamera === camera.id ? 'active' : ''}`} onClick={() => onSelectCamera(camera.id)}>{camera.name}</button>)}
            </div>
            <label>当前录制机位</label>
            <select className="input-field" value={activeCameraId} onChange={(event) => onSetActiveCamera(event.target.value)}>
              {cameras.map((camera) => <option key={camera.id} value={camera.id}>{camera.name}</option>)}
            </select>
            <div className="previz-wrap-row" style={{ marginTop: 8 }}>
              <button className="btn btn-sm" onClick={onFocusCamera}>对准人脸</button>
              <button className="btn btn-sm" onClick={onResetCamera}>重置机位</button>
            </div>
            <p className="previz-help-text">选中摄影机：W/A/S/D 推拉横移，R/F 升降，Q/E 转向，Shift 加速。</p>
          </div>
          <div className="control-group">
            <label>焦距 / FOV：{cameraFov}</label>
            <input type="range" min="15" max="90" value={cameraFov} onChange={(event) => setCameraFov(Number(event.target.value))} />
            <div className="previz-focal-presets">
              {FOCAL_PRESETS.map((preset) => <button key={preset.fov} className={`btn btn-sm ${cameraFov === preset.fov ? 'active' : ''}`} onClick={() => setCameraFov(preset.fov)}>{preset.label}</button>)}
            </div>
          </div>
          <div className="control-group">
            <label>运镜模式</label>
            <div className="previz-wrap-row">
              {CAMERA_MODES.map((mode) => <button key={mode.value} className={`btn btn-sm ${cameraMode === mode.value ? 'active' : ''}`} onClick={() => setCameraMode(mode.value)}>{mode.label}</button>)}
            </div>
          </div>
          <div className="control-group">
            <label>画幅</label>
            <select className="input-field" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>
              {ASPECTS.map((aspect) => <option key={aspect.value} value={aspect.value}>{aspect.label}</option>)}
            </select>
          </div>
          <div className="previz-check-row">
            <label><input type="checkbox" checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} /> 网格</label>
            <label><input type="checkbox" checked={showGuides} onChange={(event) => setShowGuides(event.target.checked)} /> 三分线</label>
          </div>
        </div>
      )}

      {tab === 'export' && (
        <div className="previz-tab-content">
          <button className="btn previz-full-btn" onClick={onScreenshot}>截图 PNG</button>
          <button className="btn previz-full-btn" onClick={onRecordVideo}>{isVideoRecording ? '停止摄影机录制' : '录制摄影机 MP4/WebM'}</button>
          <button className="btn previz-full-btn" onClick={() => onExportMode('depth')}>深度图</button>
          <button className="btn previz-full-btn" onClick={() => onExportMode('skeleton')}>骨架线</button>
          <button className="btn previz-full-btn" onClick={() => onExportMode('mask')}>角色遮罩</button>
          <button className="btn previz-full-btn" onClick={onOpenProject}>保存 / 加载项目</button>
        </div>
      )}
    </aside>
  )
}
