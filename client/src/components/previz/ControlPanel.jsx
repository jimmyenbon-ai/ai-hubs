import { useState } from 'react'

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
}

const CAT_LABELS = {
  base: '基础',
  indoor: '室内',
  scifi: '科幻',
  city: '城市',
}

const PROP_LABELS = {
  box: '方块',
  cylinder: '圆柱',
  platform: '圆台',
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
  const [tab, setTab] = useState('actors')
  const [propCat, setPropCat] = useState('indoor')
  const [renameId, setRenameId] = useState(null)
  const [renameVal, setRenameVal] = useState('')
  const [aiPrompt, setAiPrompt] = useState('')

  const tabs = [
    { key: 'actors', label: '角色' },
    { key: 'props', label: '道具' },
    { key: 'camera', label: '摄影机' },
    { key: 'ai', label: 'AI' },
    { key: 'export', label: '导出' },
  ]

  const QUICK_TEMPLATES = [
    { label: '🛋️ 客厅对话', prompt: '创建一个客厅场景，中间放一张桌子，两边各一把椅子，两个演员面对面坐着聊天，用中景镜头从正面拍摄' },
    { label: '🎭 舞台演出', prompt: '创建一个舞台，中间放一个圆台，三个演员站在上面，一个演员指向观众，设置一个正面观众视角镜头' },
    { label: '🏢 办公室会议', prompt: '创建一间办公室，放一张桌子，四把椅子围在桌子四周，两个演员坐在桌子对面，用全景镜头' },
    { label: '🚀 科幻走廊', prompt: '创建一条科幻走廊，放几个走廊模块排列成通道，一个演员站在走廊中间，用长焦镜头从通道一端拍摄' },
    { label: '🛏️ 卧室场景', prompt: '创建一间卧室，靠墙放一张床，一个演员躺在上面，一个演员站在床边，设置一个中景镜头' },
    { label: '🎬 产品展示', prompt: '放一个圆台展示台在中间，一个演员站在展示台旁边做指向姿势，用特写镜头对准展示台' },
    { label: '🎥 自动运镜录制', prompt: '10秒一镜到底：两个人并列走动聊天，摄影机从两人后方开始，绕到侧面跟拍，再到前方倒退拍摄；不要平淡，要有推拉变焦，FOV从54逐渐变到40再到28。自动生成场景、人物、摄影机关键帧，并录制10秒摄影机参考片，结束后我查看回放并下载导出。' },
  ]

  const handleSendAI = () => {
    if (!aiPrompt.trim() || aiLoading) return
    onAIDirect(aiPrompt)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendAI()
    }
  }

  return (
    <aside className="previz-control-panel">
      <h3>导演控制台</h3>

      <div className={`previz-rec-bar ${isRecording ? 'active' : ''}`}>
        <button className={`previz-rec-btn ${isRecording ? 'active' : ''}`} onClick={isRecording ? onStop : onRecord}>
          {isRecording ? '停止动作' : '录动作'}
        </button>
        <button className="previz-rec-btn" onClick={isPlaying ? onPause : onPlay}>
          {isPlaying ? '暂停' : '播放'}
        </button>
        <button className="previz-rec-btn" onClick={onStop}>停止</button>
        <button className={`previz-rec-btn ${loopMode ? 'active' : ''}`} onClick={onLoop}>循环</button>
        <button className="previz-rec-btn" onClick={onAddKeyframe}>关键帧</button>
        <button className={`previz-rec-btn ${isVideoRecording ? 'active' : ''}`} onClick={onRecordVideo}>
          {isVideoRecording ? '停止拍摄' : '摄影机录制'}
        </button>
      </div>

      <div className="control-group previz-mode-row">
        {TRANSFORM_MODES.map((mode) => (
          <button
            key={mode.key}
            className={`btn btn-sm ${transformMode === mode.key ? 'active' : ''}`}
            onClick={() => setTransformMode(mode.key)}
          >
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
                {POSE_PRESET_LIST.map((pose) => (
                  <button key={pose.key} className="btn btn-sm" onClick={() => onApplyPose(pose.key)}>{pose.label}</button>
                ))}
              </div>
              <p className="previz-help-text">
                选中演员：W/A/S/D 移动，Q/E 转向，Shift 加速。点击身体部位后可旋转关节。当前关节：{selectedJoint || '未选择'}
              </p>
            </div>
          )}
        </div>
      )}

      {tab === 'props' && (
        <div className="previz-tab-content">
          <div className="previz-section" style={{ marginBottom: 12 }}>
            <div className="section-label">场景背景图</div>
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
            {(backgroundImages || []).length === 0 && <p className="previz-help-text">上传后自动按图片比例放进场景，可做平面背景或180度全景。</p>}
            {(backgroundImages || []).map((image) => (
              <div key={image.id} className="previz-bg-card">
                <div className="previz-bg-card-head">
                  <span title={image.name}>{image.name}</span>
                  <button className="btn-back" onClick={() => onRemoveBackground?.(image.id)}>X</button>
                </div>
                <div className="previz-bg-grid">
                  <label>宽<input type="number" className="input-field small" value={Number(image.width || 1).toFixed(1)} step="0.5" onChange={(event) => onUpdateBackground?.(image.id, { width: Number(event.target.value) || image.width })} /></label>
                  <label>高<input type="number" className="input-field small" value={Number(image.height || 1).toFixed(1)} step="0.5" onChange={(event) => onUpdateBackground?.(image.id, { height: Number(event.target.value) || image.height })} /></label>
                  <label>X<input type="number" className="input-field small" value={Number(image.position?.[0] || 0).toFixed(1)} step="0.5" onChange={(event) => onUpdateBackground?.(image.id, { position: [Number(event.target.value) || 0, image.position?.[1] || 0, image.position?.[2] || 0] })} /></label>
                  <label>Y<input type="number" className="input-field small" value={Number(image.position?.[1] || 0).toFixed(1)} step="0.5" onChange={(event) => onUpdateBackground?.(image.id, { position: [image.position?.[0] || 0, Number(event.target.value) || 0, image.position?.[2] || 0] })} /></label>
                  <label>Z<input type="number" className="input-field small" value={Number(image.position?.[2] || 0).toFixed(1)} step="0.5" onChange={(event) => onUpdateBackground?.(image.id, { position: [image.position?.[0] || 0, image.position?.[1] || 0, Number(event.target.value) || 0] })} /></label>
                  <label>转<input type="number" className="input-field small" value={Math.round(((image.rotation?.[1] || 0) * 180) / Math.PI)} step="5" onChange={(event) => onUpdateBackground?.(image.id, { rotation: [image.rotation?.[0] || 0, (Number(event.target.value) * Math.PI) / 180, image.rotation?.[2] || 0] })} /></label>
                </div>
                <div className="previz-wrap-row">
                  <button className="btn btn-sm" onClick={() => onFitBackgroundToCamera?.(image.id)}>适配机位</button>
                  <button className="btn btn-sm" onClick={() => onUpdateBackground?.(image.id, { arc: image.arc ? 0 : Math.PI })}>{image.arc ? '平面图' : '180全景'}</button>
                </div>
              </div>
            ))}
          </div>
          {placementMode ? (
            <div className="previz-placement-card">
              正在放置：{PROP_LABELS[placementMode] || placementMode}
              <button className="btn btn-sm" onClick={onCancelPlacement}>取消</button>
            </div>
          ) : (
            <p className="previz-help-text">选择分类和道具，然后在地面点击放置。所有道具默认吸附地面。</p>
          )}
          <div className="previz-category-row">
            {Object.keys(PROP_CATS).map((cat) => (
              <button key={cat} className={`btn btn-sm ${propCat === cat ? 'active' : ''}`} onClick={() => setPropCat(cat)}>
                {CAT_LABELS[cat]}
              </button>
            ))}
          </div>
          <div className="previz-prop-grid">
            {(PROP_CATS[propCat] || []).map((type) => (
              <button
                key={type}
                className={`previz-prop-btn ${placementMode === type ? 'active' : ''}`}
                onClick={() => placementMode === type ? onCancelPlacement() : onStartPlacement(type)}
              >
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
              {cameras.map((camera) => (
                <button key={camera.id} className={`btn btn-sm ${selectedCamera === camera.id ? 'active' : ''}`} onClick={() => onSelectCamera(camera.id)}>
                  {camera.name}
                </button>
              ))}
            </div>
            <label>监看机位</label>
            <select className="input-field" value={activeCameraId} onChange={(event) => onSetActiveCamera(event.target.value)}>
              {cameras.map((camera) => <option key={camera.id} value={camera.id}>{camera.name}</option>)}
            </select>
            <div className="previz-wrap-row" style={{ marginTop: 8 }}>
              <button className="btn btn-sm" onClick={onFocusCamera}>看向演员</button>
              <button className="btn btn-sm" onClick={onResetCamera}>重置机位</button>
            </div>
            <p className="previz-help-text">选中摄影机：W/A/S/D 推拉横移，R/F 升降，Q/E 转向，Shift 加速。</p>
          </div>
          <div className="control-group">
            <label>焦距 / FOV：{cameraFov}</label>
            <input type="range" min="15" max="90" value={cameraFov} onChange={(event) => setCameraFov(Number(event.target.value))} />
            <div className="previz-focal-presets">
              {FOCAL_PRESETS.map((preset) => (
                <button key={preset.fov} className={`btn btn-sm ${cameraFov === preset.fov ? 'active' : ''}`} onClick={() => setCameraFov(preset.fov)}>
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          <div className="control-group">
            <label>运镜模式</label>
            <div className="previz-wrap-row">
              {CAMERA_MODES.map((mode) => (
                <button key={mode.value} className={`btn btn-sm ${cameraMode === mode.value ? 'active' : ''}`} onClick={() => setCameraMode(mode.value)}>
                  {mode.label}
                </button>
              ))}
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

      {tab === 'ai' && (
        <div className="previz-tab-content">
          <p className="previz-help-text" style={{ marginBottom: 8 }}>
            💡 用自然语言描述你想要的场景，AI 导演自动搭建。例如：<em>"创建一个客厅，放桌子、两把椅子，两个演员面对面坐着聊天，中景镜头"</em>
          </p>
          <p className="previz-help-text" style={{ marginBottom: 8 }}>
            可写：两个人边走边对话，摄影机侧面跟拍，书架和桌子在摄影机与人物之间形成前景遮挡，并添加0秒和5秒关键帧。
          </p>
          <p className="previz-help-text" style={{ marginBottom: 8 }}>
            也可以直接写：搭好场景后自动录制6秒摄影机参考片。
          </p>

          <textarea
            className="previz-ai-input"
            placeholder="描述你想要的场景..."
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            disabled={aiLoading}
          />

          <div className="previz-ai-actions">
            <button
              className="btn previz-full-btn previz-ai-send"
              onClick={handleSendAI}
              disabled={aiLoading || !aiPrompt.trim()}
              style={{ background: aiLoading ? '#555' : '#00aa66' }}
            >
              {aiLoading ? 'AI 思考中...' : '🚀 发送指令'}
            </button>
            {hasAISnapshot && hasAISnapshot() && (
              <button className="btn btn-sm" onClick={onUndoAI} style={{ marginLeft: 4 }}>
                ↩ 撤销 AI
              </button>
            )}
          </div>

          {aiLoading && aiStatus && (
            <div className="previz-ai-status">
              <div className="previz-ai-spinner" />
              <span>{aiStatus.message}</span>
            </div>
          )}

          {aiError && (
            <div className="previz-ai-error">
              <span>❌ {aiError}</span>
              <button className="btn-back" onClick={onClearAIError}>✕</button>
            </div>
          )}

          <div className="previz-section">
            <div className="section-label">快速模板</div>
            <div className="previz-quick-templates">
              {QUICK_TEMPLATES.map((tpl, i) => (
                <button
                  key={i}
                  className="btn btn-sm previz-template-btn"
                  onClick={() => { setAiPrompt(tpl.prompt) }}
                  disabled={aiLoading}
                  title={tpl.prompt}
                >
                  {tpl.label}
                </button>
              ))}
            </div>
          </div>

          {commandHistory.length > 0 && (
            <div className="previz-section">
              <div className="section-label">最近指令</div>
              <div className="previz-history-list">
                {commandHistory.slice(0, 5).map((item, i) => (
                  <div
                    key={i}
                    className="previz-history-item"
                    onClick={() => { setAiPrompt(item.prompt) }}
                    title={item.explanation || ''}
                  >
                    <span className="history-prompt">{item.prompt.length > 28 ? item.prompt.slice(0, 28) + '...' : item.prompt}</span>
                    <span className="history-meta">{item.applied}条命令</span>
                    {item.errors && item.errors.length > 0 && (
                      <span className="history-err" title={item.errors.join('; ')}>⚠</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'export' && (
        <div className="previz-tab-content">
          <button className="btn previz-full-btn" onClick={onScreenshot}>截图 PNG</button>
          <button className="btn previz-full-btn" onClick={onRecordVideo}>{isVideoRecording ? '停止摄影机录制' : '录制摄影机 MP4'}</button>
          <button className="btn previz-full-btn" onClick={() => onExportMode('depth')}>深度图</button>
          <button className="btn previz-full-btn" onClick={() => onExportMode('skeleton')}>骨骼线</button>
          <button className="btn previz-full-btn" onClick={() => onExportMode('mask')}>角色遮罩</button>
          <button className="btn previz-full-btn" onClick={onOpenProject}>保存 / 加载项目</button>
        </div>
      )}
    </aside>
  )
}
