import { useState, useEffect, useCallback, useRef } from 'react'

const MODEL_OPTIONS = [
  { value: 'gpt-image-2', label: 'GPT Image 2' },
  { value: 'gpt-image-2-vip', label: 'GPT Image 2 VIP' },
  { value: 'nano-banana-2', label: 'Nano Banana 2' },
  { value: 'nano-banana-2-cl', label: 'Nano Banana 2-CL' },
  { value: 'nano-banana-2-4k-cl', label: 'Nano Banana 2-4K-CL' },
  { value: 'nano-banana-fast', label: 'Nano Banana Fast' },
  { value: 'nano-banana', label: 'Nano Banana' },
  { value: 'nano-banana-pro', label: 'Nano Banana Pro' },
  { value: 'nano-banana-pro-cl', label: 'Nano Banana Pro-CL' },
  { value: 'nano-banana-pro-vip', label: 'Nano Banana Pro-VIP (2K)' },
  { value: 'nano-banana-pro-4k-vip', label: 'Nano Banana Pro-4K-VIP' },
]

const ASPECT_OPTIONS = [
  { value: 'auto', label: '自动' },
  { value: '1:1', label: '1:1 方形' },
  { value: '16:9', label: '16:9 横版' },
  { value: '9:16', label: '9:16 竖版' },
  { value: '3:2', label: '3:2 横版' },
  { value: '2:3', label: '2:3 竖版' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4 竖版' },
  { value: '5:4', label: '5:4' },
  { value: '4:5', label: '4:5 竖版' },
  { value: '21:9', label: '21:9 宽屏' },
  { value: '9:21', label: '9:21 超竖' },
  { value: '2:1', label: '2:1 横超宽' },
  { value: '1:2', label: '1:2 竖超窄' },
]

const IMAGE_SIZE_OPTIONS = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
]

const POINT_COST_OPTIONS = [
  { value: 1, label: '1 分' },
  { value: 2, label: '2 分' },
  { value: 3, label: '3 分' },
  { value: 4, label: '4 分' },
  { value: 5, label: '5 分' },
]

const TYPE_OPTIONS = [
  { value: 'image', label: '🖼️ 图片' },
  { value: 'video', label: '🎬 视频' },
  { value: 'music', label: '🎵 音乐' },
]

const DEFAULT_FORM = {
  name: '',
  contentType: 'image',
  category: '',
  tags: [],
  coverImage: '',
  prompt: '',
  model: 'gpt-image-2',
  aspectRatio: 'auto',
  imageSize: '2K',
  pointsCost: 1,
}

export default function PromptTemplateModal({ template, onClose, onSave, noBackdrop }) {
  const isEdit = Boolean(template)
  const [form, setForm] = useState(() => {
    if (template) {
      return {
        name: template.name || '',
        contentType: template.contentType || 'image',
        category: template.category || '',
        tags: Array.isArray(template.tags) ? [...template.tags] : [],
        coverImage: template.coverImage || '',
        prompt: template.prompt || '',
        model: template.model || 'gpt-image-2',
        aspectRatio: template.aspectRatio || 'auto',
        imageSize: template.imageSize || '2K',
        pointsCost: template.pointsCost ?? 1,
      }
    }
    return { ...DEFAULT_FORM }
  })
  const [tagInput, setTagInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const coverInputRef = useRef(null)

  function set(key, val) {
    setForm((f) => ({ ...f, [key]: val }))
  }

  async function handleCoverUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const fd = new FormData()
    fd.append('files', file)
    const resp = await fetch('/api/upload', { method: 'POST', body: fd })
    const data = await resp.json()
    if (!data.success) { setError('封面上传失败'); return }
    const url = data.files?.[0]?.url || data.files?.[0]?.path || ''
    if (url) set('coverImage', url)
    e.target.value = ''
  }

  function addTag(raw) {
    const t = raw.trim()
    if (!t || form.tags.includes(t)) return
    set('tags', [...form.tags, t])
  }

  function removeTag(tag) {
    set('tags', form.tags.filter((t) => t !== tag))
  }

  function handleTagKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(tagInput)
      setTagInput('')
    } else if (e.key === 'Backspace' && !tagInput && form.tags.length > 0) {
      set('tags', form.tags.slice(0, -1))
    }
  }

  async function handleSubmit() {
    if (!form.name.trim()) { setError('请输入模板名称'); return }
    if (!form.prompt.trim()) { setError('请输入提示词'); return }
    setLoading(true)
    setError('')
    try {
      await onSave(form, template?.id)
    } catch (err) {
      setError(err.message || '保存失败')
      setLoading(false)
    }
  }

  const modalInner = (
    <div className={`modal-content prompt-template-modal${noBackdrop ? ' modal-content--floating' : ''}`}>
        <div className="modal-header">
          <span style={{ fontWeight: 600, fontSize: 15 }}>
            {isEdit ? '编辑模板' : '新建模板'}
          </span>
          <button className="btn-back" onClick={onClose} style={{ border: 'none', background: 'transparent' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="modal-body">
          {/* 内容类型 */}
          <div className="modal-form-group">
            <div className="modal-form-label">内容类型</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`pill-button ${form.contentType === opt.value ? 'active' : ''}`}
                  onClick={() => set('contentType', opt.value)}
                  style={{ fontSize: 12 }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 名称 */}
          <div className="modal-form-group">
            <div className="modal-form-label">模板名称 *</div>
            <input
              className="input-field"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="例如：产品白底图 · 商业摄影"
              autoFocus
            />
          </div>

          {/* 分类 */}
          <div className="modal-form-group">
            <div className="modal-form-label">分类</div>
            <input
              className="input-field"
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              placeholder="例如：产品展示、场景植入、营销海报"
            />
          </div>

          {/* 提示词 */}
          <div className="modal-form-group">
            <div className="modal-form-label">
              提示词 * <span style={{ fontWeight: 400, opacity: 0.6, fontSize: 11 }}>可用 @{'{'+'变量'+'}'} 占位，运行时自动替换</span>
            </div>
            <textarea
              className="prompt-box"
              value={form.prompt}
              onChange={(e) => set('prompt', e.target.value)}
              placeholder="将产品 @{image} 置于纯白背景，使用专业商业摄影灯光，高清 4K，适合电商主图使用"
            />
          </div>

          {/* 参数行：模型 + 比例 + 尺寸 */}
          <div className="form-row">
            <div className="modal-form-group">
              <div className="modal-form-label">模型</div>
              <select className="select-field" value={form.model} onChange={(e) => set('model', e.target.value)}>
                {MODEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="modal-form-group">
              <div className="modal-form-label">比例</div>
              <select className="select-field" value={form.aspectRatio} onChange={(e) => set('aspectRatio', e.target.value)}>
                {ASPECT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="modal-form-group">
              <div className="modal-form-label">尺寸</div>
              <select className="select-field" value={form.imageSize} onChange={(e) => set('imageSize', e.target.value)}>
                {IMAGE_SIZE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* 标签 + 积分 */}
          <div className="form-row-2">
            <div className="modal-form-group">
              <div className="modal-form-label">标签（回车添加）</div>
              <div className="tags-input-area" onClick={(e) => e.currentTarget.querySelector('input')?.focus()}>
                {form.tags.map((tag) => (
                  <span key={tag} className="tag-chip">
                    {tag}
                    <button className="tag-chip-remove" onClick={() => removeTag(tag)} type="button">×</button>
                  </span>
                ))}
                <input
                  className="tag-input"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  onBlur={() => { if (tagInput.trim()) { addTag(tagInput); setTagInput('') } }}
                  placeholder={form.tags.length === 0 ? '输入标签后回车' : ''}
                />
              </div>
            </div>
            <div className="modal-form-group">
              <div className="modal-form-label">积分消耗</div>
              <select className="select-field" value={form.pointsCost} onChange={(e) => set('pointsCost', Number(e.target.value))}>
                {POINT_COST_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* 封面图 */}
          <div className="modal-form-group">
            <div className="modal-form-label">封面图 <span style={{ fontWeight: 400, opacity: 0.6, fontSize: 11 }}>（选填，支持本地上传或粘贴 URL）</span></div>
            <div className="cover-image-row">
              {form.coverImage && (
                <img
                  className="cover-image-preview"
                  src={form.coverImage}
                  alt="封面预览"
                  onError={(e) => { e.target.style.display = 'none' }}
                />
              )}
              <div className="cover-image-actions">
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleCoverUpload}
                />
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => coverInputRef.current?.click()}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="16,16 12,12 8,16"/><line x1="12" y1="12" x2="12" y2="21"/>
                    <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
                  </svg>
                  本地上传
                </button>
                <input
                  className="input-field"
                  value={form.coverImage}
                  onChange={(e) => set('coverImage', e.target.value)}
                  placeholder="或粘贴图片 URL"
                  style={{ flex: 1 }}
                />
              </div>
            </div>
          </div>

          {error && <p className="error-text">{error}</p>}
        </div>

        <div className="modal-footer">
          <button className="btn-outline" onClick={onClose} disabled={loading}>取消</button>
          <button className="generate-btn" onClick={handleSubmit} disabled={loading}>
            {loading ? '保存中…' : '保存模板'}
          </button>
        </div>
      </div>
  )

  return noBackdrop ? (
    <>
      <div className="modal-backdrop" style={{ pointerEvents: 'none' }} />
      {modalInner}
    </>
  ) : (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      {modalInner}
    </div>
  )
}
