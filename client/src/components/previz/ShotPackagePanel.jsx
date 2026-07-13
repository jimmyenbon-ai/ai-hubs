import { useMemo, useRef, useState } from 'react'
import { REFERENCE_CATEGORIES, analyzeShotReadiness } from './ShotPackageTools'

const FRAME_LABELS = {
  first: '首帧',
  last: '尾帧',
}

function AssetThumb({ asset, label, onRemove }) {
  if (!asset?.url) {
    return (
      <div className="previz-package-empty">
        <span>{label}</span>
        <small>尚未准备</small>
      </div>
    )
  }

  return (
    <div className="previz-package-thumb">
      {asset.kind === 'video' ? (
        <video src={asset.url} muted preload="metadata" />
      ) : (
        <img src={asset.url} alt={label} />
      )}
      <span>{label}</span>
      {onRemove ? <button type="button" onClick={onRemove} aria-label={`移除${label}`}>×</button> : null}
    </div>
  )
}

export default function ShotPackagePanel({
  shot,
  shotPackage,
  references,
  sceneContext,
  isRecording,
  busy,
  error,
  onAddReferences,
  onRemoveReference,
  onUpdateReference,
  onCaptureFrame,
  onGenerateStyledFrame,
  onRecordPreviz,
  onUpdatePackage,
  onSendToVideo,
}) {
  const inputRef = useRef(null)
  const [referenceCategory, setReferenceCategory] = useState('character')
  const [referenceLabel, setReferenceLabel] = useState('')
  const readiness = useMemo(
    () => analyzeShotReadiness({ ...sceneContext, shotPackage, references }),
    [references, sceneContext, shotPackage],
  )

  const handleFiles = async (files) => {
    const list = Array.from(files || [])
    if (!list.length) return
    await onAddReferences?.(list, { category: referenceCategory, label: referenceLabel.trim() })
    setReferenceLabel('')
  }

  const canStyleFirst = Boolean(shotPackage?.previzFrames?.first?.url)
  const canStyleLast = Boolean(shotPackage?.previzFrames?.last?.url)
  const readyAssets = Boolean(
    (shotPackage?.styledFrames?.first?.url || shotPackage?.previzFrames?.first?.url)
      && (shotPackage?.styledFrames?.last?.url || shotPackage?.previzFrames?.last?.url),
  )

  return (
    <div className="previz-tab-content previz-package-tab">
      <section className="previz-package-hero">
        <div>
          <span className="previz-package-kicker">SHOT PACKAGE</span>
          <strong>{shot?.id || '自由镜头'} · {shot?.title || shotPackage?.title || '当前预演'}</strong>
          <small>把空间关系、身份参考、首尾帧和运镜一次性交给视频模型</small>
        </div>
        <div className={`previz-package-score ${readiness.score >= 75 ? 'good' : ''}`}>
          <strong>{readiness.score}</strong><span>/100</span>
        </div>
      </section>

      <section className="previz-package-section">
        <div className="previz-step-title"><span>1</span><strong>镜头质检</strong></div>
        <div className="previz-package-stats">
          <span>{sceneContext.actors.length} 角色</span>
          <span>{sceneContext.props.length} 道具</span>
          <span>{readiness.stats.cameraKeyCount} 机位帧</span>
          <span>{sceneContext.duration}s</span>
        </div>
        <div className="previz-quality-list">
          {readiness.checks.map((check) => (
            <div key={check.id} className={`previz-quality-item ${check.pass ? 'pass' : ''}`} title={check.hint}>
              <span>{check.pass ? '✓' : '!'}</span>
              <div><strong>{check.label}</strong>{check.pass ? null : <small>{check.hint}</small>}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="previz-package-section">
        <div className="previz-step-title"><span>2</span><strong>身份与美术参考库</strong></div>
        <p className="previz-help-text">角色定妆建议正面半身 + 全身；场景图用于美术和光影，不要覆盖3D构图。</p>
        <div className="previz-reference-controls">
          <select className="input-field small" value={referenceCategory} onChange={(event) => setReferenceCategory(event.target.value)}>
            {REFERENCE_CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
          </select>
          <input className="input-field small" value={referenceLabel} onChange={(event) => setReferenceLabel(event.target.value)} placeholder="例：女主定妆 / 客厅夜景" />
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => inputRef.current?.click()}>上传参考</button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              handleFiles(event.target.files)
              event.target.value = ''
            }}
          />
        </div>
        <div className="previz-reference-grid">
          {references.length ? references.map((reference) => (
            <div className="previz-reference-card" key={reference.id}>
              <img src={reference.url} alt={reference.label || reference.name} />
              <select value={reference.category} onChange={(event) => onUpdateReference?.(reference.id, { category: event.target.value })}>
                {REFERENCE_CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
              </select>
              <input value={reference.label || ''} onChange={(event) => onUpdateReference?.(reference.id, { label: event.target.value })} placeholder={reference.name} />
              <button type="button" onClick={() => onRemoveReference?.(reference.id)} aria-label="删除参考">×</button>
            </div>
          )) : <div className="previz-package-empty wide"><span>暂无参考图</span><small>参考库会跨分镜复用</small></div>}
        </div>
      </section>

      <section className="previz-package-section">
        <div className="previz-step-title"><span>3</span><strong>锁定灰模首尾帧</strong></div>
        <div className="previz-frame-pair">
          {['first', 'last'].map((kind) => (
            <div className="previz-frame-column" key={kind}>
              <AssetThumb asset={shotPackage?.previzFrames?.[kind]} label={`3D ${FRAME_LABELS[kind]}`} />
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => onCaptureFrame?.(kind)}>
                {busy === `capture-${kind}` ? '捕获中...' : `捕获${FRAME_LABELS[kind]}`}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="previz-package-section">
        <div className="previz-step-title"><span>4</span><strong>GPT-Image 2 成片化</strong></div>
        <p className="previz-help-text">灰模帧锁定构图，参考库只负责身份、美术、材质和光影。首尾帧分开生成，便于人工审核。</p>
        <div className="previz-frame-pair">
          {['first', 'last'].map((kind) => (
            <div className="previz-frame-column" key={kind}>
              <AssetThumb
                asset={shotPackage?.styledFrames?.[kind]}
                label={`成片${FRAME_LABELS[kind]}`}
                onRemove={shotPackage?.styledFrames?.[kind] ? () => onUpdatePackage?.({
                  styledFrames: { ...shotPackage.styledFrames, [kind]: null },
                }) : null}
              />
              <button
                type="button"
                className="btn btn-sm previz-ai-send"
                disabled={busy || (kind === 'first' ? !canStyleFirst : !canStyleLast)}
                onClick={() => onGenerateStyledFrame?.(kind)}
              >
                {busy === `style-${kind}` ? '生成中...' : `生成成片${FRAME_LABELS[kind]}`}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="previz-package-section">
        <div className="previz-step-title"><span>5</span><strong>运镜参考片</strong></div>
        <div className="previz-video-package-row">
          <AssetThumb
            asset={shotPackage?.previzVideo}
            label="3D 预演视频"
            onRemove={shotPackage?.previzVideo ? () => onUpdatePackage?.({ previzVideo: null }) : null}
          />
          <div>
            <strong>{shotPackage?.previzVideo?.url ? '已进入资产包' : '尚未录制'}</strong>
            <small>低比特率仅用于传递摄影机路径、人物动作和道具交互。</small>
            <button type="button" className="btn btn-sm" disabled={Boolean(busy && !isRecording)} onClick={onRecordPreviz}>
              {isRecording ? '停止录制' : '录制当前镜头'}
            </button>
          </div>
        </div>
      </section>

      <section className="previz-package-section previz-handoff-section">
        <div className="previz-step-title"><span>6</span><strong>交给 AI 视频</strong></div>
        <label className="previz-shot-field">
          额外运动约束
          <textarea
            className="input-field small"
            rows={3}
            value={shotPackage?.handoffPrompt || ''}
            onChange={(event) => onUpdatePackage?.({ handoffPrompt: event.target.value })}
            placeholder="例：人物的右手始终握住道具，摄影机不要绕到轴线另一侧。"
          />
        </label>
        {error ? <div className="previz-ai-error">{error}</div> : null}
        <button
          type="button"
          className="btn previz-package-send"
          disabled={!readyAssets || Boolean(busy)}
          onClick={() => onSendToVideo?.(readiness)}
        >
          一键打包到 Seedance
        </button>
        <p className="previz-help-text">默认使用多模态模式：成片首帧 + 成片尾帧 + 角色/场景/道具参考 + 3D预演视频。</p>
      </section>
    </div>
  )
}

