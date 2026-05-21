import { useState, useEffect, useRef } from 'react'
import { NANO_IMAGE_SIZES } from './ImageFreePanel'
import { renderCanvas, downloadCanvas } from './components/CanvasRenderer'

// 占位符识别正则
const VAR_REGEX = /\{([^}]+)\}/g

// 固定参考图提示词前缀（不可修改）
const FIXED_IMAGE_PROMPT = '\n\n[IMPORTANT - Reference Image Instruction]\nYou MUST use the first reference image as the ONLY visual template/base design. Strictly follow its layout, composition, color palette, design style, typography, and all decorative elements. Only replace: personal names, portrait photos, phone numbers, department names, job titles, and contact information. DO NOT alter any other design elements, decorative patterns, layout structure, background, or brand visuals from the template.'

function TemplatePanel({ template, templates, onSave, onGenerate, onBack }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({})
  const [filePreviews, setFilePreviews] = useState({})
  const [activeTab, setActiveTab] = useState('variables')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resultImage, setResultImage] = useState('')
  const [generating, setGenerating] = useState(false)
  const [canvasPreviewUrl, setCanvasPreviewUrl] = useState('')
  const fileInputRefs = useRef({})
  const [history, setHistory] = useState([])

  // 参考图相关状态
  const [refImages, setRefImages] = useState([]) // [{url, localFile, uploading}]
  const [refImageInputKey, setRefImageInputKey] = useState(0)
  const refImageInputRef = useRef(null)

  // 模板底图上传
  const [templateImageUploading, setTemplateImageUploading] = useState(false)
  const templateImageInputRef = useRef(null)

  // 当前正在使用的模板对象（编辑后用本地副本）
  const [localTemplate, setLocalTemplate] = useState({
    name: template.name,
    description: template.description || '',
    icon: template.icon || '',
    category: template.category || '',
    promptTemplate: template.promptTemplate || '',
    model: template.model || 'gpt-image-2',
    aspectRatio: template.aspectRatio || 'auto',
    imageSize: template.imageSize || '1K',
    formFields: template.formFields || [],
    referenceImages: template.referenceImages || [],
    templateImage: template.templateImage || '',
    pointsCost: template.pointsCost || 1,
    renderType: template.renderType || 'ai',
    canvasConfig: template.canvasConfig || null,
  })

  // 初始化参考图
  useEffect(() => {
    const initial = (template.referenceImages || []).map((url) => ({
      url,
      localFile: null,
      uploading: false,
    }))
    setRefImages(initial)
  }, [template.id, template.referenceImages])

  // 当模板切换时重置表单
  useEffect(() => {
    setForm({})
    setFilePreviews({})
    setError('')
    setResultImage('')
    setGenerating(false)
    setCanvasPreviewUrl('')
    setLocalTemplate({
      name: template.name,
      description: template.description || '',
      icon: template.icon || '',
      category: template.category || '',
      promptTemplate: template.promptTemplate || '',
      model: template.model || 'gpt-image-2',
      aspectRatio: template.aspectRatio || 'auto',
      imageSize: template.imageSize || '1K',
      formFields: template.formFields || [],
      referenceImages: template.referenceImages || [],
      templateImage: template.templateImage || '',
      pointsCost: template.pointsCost || 1,
      renderType: template.renderType || 'ai',
      canvasConfig: template.canvasConfig || null,
    })
  }, [template.id])

  // 加载该模板的使用历史
  useEffect(() => {
    fetchHistory()
  }, [template.id])

  // Canvas 模板：表单变化时实时渲染预览
  useEffect(() => {
    if (localTemplate.renderType !== 'canvas' || !localTemplate.canvasConfig) return

    const cfg = localTemplate.canvasConfig
    const hasAllRequired = (cfg.textLayers || []).every(
      (l) => !l.required || (form[l.key] && form[l.key].trim()),
    )
    if (!hasAllRequired) return

    let cancelled = false
    ;(async () => {
      try {
        const dataUrl = await renderCanvas(cfg, form, {})
        if (!cancelled) setCanvasPreviewUrl(dataUrl)
      } catch (err) {
        console.warn('[CanvasRenderer] preview error:', err)
      }
    })()

    return () => { cancelled = true }
  }, [form, localTemplate.renderType, localTemplate.canvasConfig])

  async function fetchHistory() {
    try {
      const resp = await fetch(`/api/history?templateId=${template.id}&limit=30`)
      const data = await resp.json()
      if (data.success) {
        setHistory(data.data || [])
      }
    } catch (_) {}
  }

  // 解析提示词模板中的 {变量名}，生成字段配置
  function detectFields() {
    const vars = []
    let match
    const seen = new Set()
    VAR_REGEX.lastIndex = 0
    while ((match = VAR_REGEX.exec(localTemplate.promptTemplate)) !== null) {
      const key = match[1].trim()
      if (!seen.has(key)) {
        seen.add(key)
        vars.push({ key, label: key, type: 'text', required: true, placeholder: `请输入${key}` })
      }
    }
    return vars
  }

  // 上传参考图到服务器
  async function uploadRefImage(file) {
    const fd = new FormData()
    fd.append('files', file)
    const resp = await fetch('/api/upload', { method: 'POST', body: fd })
    const data = await resp.json()
    if (!data.success) throw new Error(data.message || '上传失败')
    return data.files?.[0]?.url || ''
  }

  // 上传模板底图
  async function handleTemplateImageUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setTemplateImageUploading(true)
    try {
      const url = await uploadRefImage(file)
      setLocalTemplate((p) => ({ ...p, templateImage: url }))
    } catch (err) {
      setError('模板底图上传失败: ' + (err.message || '未知错误'))
    } finally {
      setTemplateImageUploading(false)
    }
  }

  // 移除模板底图
  function removeTemplateImage() {
    setLocalTemplate((p) => ({ ...p, templateImage: '' }))
  }

  // 处理参考图上传
  async function handleRefImageChange(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return

    for (const file of files) {
      const tempId = Date.now() + Math.random()
      // 先显示本地预览
      const localUrl = URL.createObjectURL(file)
      setRefImages((prev) => [...prev, { url: localUrl, localFile: file, uploading: true, tempId }])

      try {
        const uploadedUrl = await uploadRefImage(file)
        setRefImages((prev) =>
          prev.map((img) =>
            img.tempId === tempId
              ? { url: uploadedUrl, localFile: null, uploading: false, tempId: null }
              : img,
          ),
        )
      } catch (err) {
        // 上传失败，标记失败状态
        setRefImages((prev) =>
          prev.map((img) =>
            img.tempId === tempId ? { ...img, uploading: false, error: true } : img,
          ),
        )
      }
    }

    // 清空 input，允许重复选择同一文件
    setRefImageInputKey((k) => k + 1)
  }

  // 删除参考图
  function handleDeleteRefImage(index) {
    setRefImages((prev) => prev.filter((_, i) => i !== index))
  }

  // 编辑模式：保存模板配置
  async function handleSave() {
    setLoading(true)
    setError('')
    try {
      // 收集所有参考图URL（只存服务器URL，排除本地文件）
      const refUrls = refImages
        .filter((img) => !img.localFile && !img.uploading)
        .map((img) => img.url)

      const updated = await onSave(template.id, {
        ...localTemplate,
        referenceImages: refUrls,
      })
      setEditing(false)
      if (updated) {
        setLocalTemplate(updated)
        // 同步参考图
        const initial = (updated.referenceImages || []).map((url) => ({
          url,
          localFile: null,
          uploading: false,
        }))
        setRefImages(initial)
      }
    } catch (err) {
      setError(err.message || '保存失败')
    } finally {
      setLoading(false)
    }
  }

  // 一键生成
  async function handleGenerate() {
    const fields = localTemplate.formFields.length ? localTemplate.formFields : detectFields()
    for (const f of fields) {
      if (f.required && f.type === 'text' && !form[f.key]?.trim()) {
        setError(`请填写"${f.label}"`)
        return
      }
      if (f.required && f.type === 'image' && !form[f.key]) {
        setError(`请上传"${f.label}"`)
        return
      }
    }

    setError('')
    setGenerating(true)

    try {
      // ====== Canvas 渲染路径 ======
      if (localTemplate.renderType === 'canvas' && localTemplate.canvasConfig) {
        const dataUrl = await renderCanvas(localTemplate.canvasConfig, form, {})
        setResultImage(dataUrl)
        setCanvasPreviewUrl(dataUrl)
        setGenerating(false)
        return
      }

      // ====== AI 渲染路径（原逻辑）======
      const fd = new FormData()
      fd.append('templateId', String(template.id))
      fd.append('variables', JSON.stringify(form))

      // 附件图片字段
      const imageFields = fields.filter((f) => f.type === 'image')
      imageFields.forEach((f) => {
        const file = form[f.key]
        if (file) fd.append(f.key, file)
      })

      // 参考图URL（固定模板图）
      const fixedRefUrls = refImages
        .filter((img) => !img.localFile && !img.uploading && !img.error)
        .map((img) => img.url)
      if (fixedRefUrls.length > 0) {
        fd.append('fixedReferenceImages', JSON.stringify(fixedRefUrls))
      }

      const resp = await fetch('/api/templates/generate', { method: 'POST', body: fd })
      const data = await resp.json()
      if (!data.success) throw new Error(data.message || '生成失败')
      setResultImage(data.data?.imageUrl || '')
      await fetchHistory()
    } catch (err) {
      setError(err.message || '生成出错')
    } finally {
      setGenerating(false)
    }
  }

  function handleDownload(url) {
    if (!url) return
    // Canvas DataURL 直接下载，否则走链接下载
    if (url.startsWith('data:')) {
      downloadCanvas(url, `${localTemplate.name}-${Date.now()}.png`)
    } else {
      const a = document.createElement('a')
      a.href = url
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      a.download = `${localTemplate.name}-${ts}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
  }

  function handleTextChange(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function handleImageChange(key, file) {
    if (!file) return
    setForm((prev) => ({ ...prev, [key]: file }))
    const url = URL.createObjectURL(file)
    setFilePreviews((prev) => ({ ...prev, [key]: url }))
  }

  function openFileDialog(key) {
    fileInputRefs.current[key]?.click()
  }

  const fields = localTemplate.formFields.length ? localTemplate.formFields : detectFields()

  // 预览最终提示词（将变量替换为实际值）
  function getPreviewPrompt() {
    let p = localTemplate.promptTemplate || ''
    for (const [key, val] of Object.entries(form)) {
      if (typeof val === 'string') {
        p = p.replace(new RegExp(`\\{${key}\\}`, 'g'), val)
      }
    }
    // 追加固定参考图提示词（有底图或参考图时）
    const hasRef = refImages.some((img) => !img.localFile && !img.uploading && !img.error)
    if (hasRef || localTemplate.templateImage) {
      p = p + FIXED_IMAGE_PROMPT
    }
    return p
  }

  const ASPECT_RATIOS = [
    { value: 'auto', label: '自动' },
    { value: '1:1', label: '1:1 方形' },
    { value: '16:9', label: '16:9 横版' },
    { value: '9:16', label: '9:16 竖版' },
    { value: '3:2', label: '3:2 横版' },
    { value: '2:3', label: '2:3 竖版' },
    { value: '4:3', label: '4:3' },
    { value: '3:4', label: '3:4 竖版' },
    { value: '21:9', label: '21:9 宽屏' },
    { value: '3:1', label: '3:1 全景' },
  ]

  // 参考图数量（用于判断是否有固定模板图）
  const validRefCount = refImages.filter((img) => !img.localFile && !img.uploading && !img.error).length

  return (
    <div className="template-panel">
      {/* 顶部标题栏 */}
      <div className="template-header">
        <div className="template-header-left">
          <button className="btn-back" onClick={onBack}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15,18 9,12 15,6"/>
            </svg>
          </button>
          <div className="template-title-area">
            <h2 className="template-name">{localTemplate.icon} {localTemplate.name}</h2>
            {localTemplate.description && (
              <p className="template-desc">{localTemplate.description}</p>
            )}
          </div>
        </div>
        <button className="btn-outline small" onClick={() => setEditing(!editing)}>
          {editing ? '取消编辑' : '编辑模板'}
        </button>
      </div>

      <div className="template-tabs">
        <div className={`tab ${activeTab === 'variables' ? 'active' : ''}`} onClick={() => setActiveTab('variables')}>
          填写信息
        </div>
        <div className={`tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
          生成记录
        </div>
      </div>

      {activeTab === 'variables' && (
        <>
          {/* 编辑模式：展示内核配置 */}
          {editing && (
            <div className="template-edit-area">
              <div className="section-label">模板名称</div>
              <input
                className="input-field"
                value={localTemplate.name}
                onChange={(e) => setLocalTemplate((p) => ({ ...p, name: e.target.value }))}
              />

              <div className="section-label">简介描述</div>
              <input
                className="input-field"
                value={localTemplate.description}
                onChange={(e) => setLocalTemplate((p) => ({ ...p, description: e.target.value }))}
                placeholder="简短描述模板用途"
              />

              <div className="section-label" style={{ marginTop: 16 }}>模板底图</div>
              <div className="hint" style={{ marginBottom: 8 }}>上传头像模板底图，AI 会在此底图基础上替换变量信息（布局/配色/字体不变）</div>
              <input
                ref={templateImageInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleTemplateImageUpload}
              />
              {localTemplate.templateImage ? (
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <img
                    src={localTemplate.templateImage}
                    alt="模板底图"
                    style={{ width: 200, maxHeight: 160, objectFit: 'contain', borderRadius: 8, border: '2px solid var(--border-color)', cursor: 'pointer' }}
                    onClick={() => templateImageInputRef.current?.click()}
                  />
                  <button
                    className="ref-image-delete"
                    onClick={removeTemplateImage}
                    title="移除底图"
                    style={{ position: 'absolute', top: 4, right: 4 }}
                  >
                    ×
                  </button>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>点击图片可更换</div>
                </div>
              ) : (
                <div
                  className="upload-area"
                  onClick={() => templateImageInputRef.current?.click()}
                  style={{ padding: 24, textAlign: 'center', cursor: 'pointer' }}
                >
                  {templateImageUploading ? (
                    <span>上传中...</span>
                  ) : (
                    <>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21,15 16,10 5,21"/>
                      </svg>
                      <span style={{ display: 'block', marginTop: 8 }}>点击上传模板底图</span>
                    </>
                  )}
                </div>
              )}

              {/* 参考图上传区域 */}
              <div className="section-label" style={{ marginTop: 16 }}>
                固定参考图 <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 12 }}>（上传后永久保存，生成时强制以此图为模板）</span>
              </div>
              <div className="ref-images-edit-area">
                {refImages.map((img, idx) => (
                  <div key={idx} className={`ref-image-thumb ${img.uploading ? 'uploading' : ''} ${img.error ? 'error' : ''}`}>
                    <img src={img.url} alt={`参考图${idx + 1}`} />
                    {img.uploading && (
                      <div className="ref-image-overlay uploading">
                        <div className="spinner" />
                        <span>上传中</span>
                      </div>
                    )}
                    {img.error && (
                      <div className="ref-image-overlay error-overlay">
                        <span>上传失败</span>
                      </div>
                    )}
                    {!img.uploading && !img.error && (
                      <button
                        className="ref-image-delete"
                        onClick={() => handleDeleteRefImage(idx)}
                        title="删除"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}

                {/* 上传按钮 */}
                {refImages.length < 5 && (
                  <div
                    className="ref-image-add-btn"
                    onClick={() => refImageInputRef.current?.click()}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="5" x2="12" y2="19"/>
                      <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    <span>添加参考图</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>最多5张</span>
                  </div>
                )}
              </div>
              <input
                key={refImageInputKey}
                ref={refImageInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={handleRefImageChange}
              />

              <div className="section-label" style={{ marginTop: 16 }}>AI 提示词模板（内核）</div>
              <div className="hint" style={{ marginBottom: 8 }}>
                用 <code>{`{变量名}`}</code> 作为占位符，生成时会自动替换为用户填写的内容
              </div>
              <textarea
                className="prompt-box template-prompt-box"
                value={localTemplate.promptTemplate}
                onChange={(e) => setLocalTemplate((p) => ({ ...p, promptTemplate: e.target.value }))}
                placeholder="例如：为{姓名}制作一张入职宣传海报，岗位是{岗位}，使用照片@{头像}..."
                rows={6}
              />

              <div className="section-label">自动检测的变量</div>
              {fields.length === 0 && (
                <p className="hint">在提示词中使用 {"{变量名}"} 来定义表单字段</p>
              )}
              <div className="detected-fields">
                {fields.map((f) => (
                  <div key={f.key} className="detected-field-chip">
                    <span className="field-type-badge">{f.type}</span>
                    <span className="field-key">{`{${f.key}}`}</span>
                    <input
                      className="input-field small"
                      value={f.label}
                      onChange={(e) => {
                        const updated = fields.map((x) => x.key === f.key ? { ...x, label: e.target.value } : x)
                        setLocalTemplate((p) => ({ ...p, formFields: updated }))
                      }}
                      placeholder="显示名称"
                    />
                  </div>
                ))}
              </div>

              <div className="params-row">
                <div className="param-item">
                  <label>AI 模型</label>
                  <select
                    value={localTemplate.model}
                    onChange={(e) => setLocalTemplate((p) => ({ ...p, model: e.target.value }))}
                  >
                    <option value="gpt-image-2">GPT-Image 2</option>
                    <option value="nano-banana-pro">Nano Banana Pro</option>
                  </select>
                </div>
                <div className="param-item">
                  <label>画幅比例</label>
                  <select
                    value={localTemplate.aspectRatio}
                    onChange={(e) => setLocalTemplate((p) => ({ ...p, aspectRatio: e.target.value }))}
                  >
                    {ASPECT_RATIOS.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
                {localTemplate.model !== 'gpt-image-2' && (
                  <div className="param-item">
                    <label>分辨率</label>
                    <select
                      value={localTemplate.imageSize}
                      onChange={(e) => setLocalTemplate((p) => ({ ...p, imageSize: e.target.value }))}
                    >
                      {NANO_IMAGE_SIZES.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="param-item">
                  <label>消耗积分</label>
                  <input
                    type="number"
                    className="input-field"
                    value={localTemplate.pointsCost}
                    min={1}
                    onChange={(e) => setLocalTemplate((p) => ({ ...p, pointsCost: Number(e.target.value) || 1 }))}
                  />
                </div>
              </div>

              {error && <p className="error-text">{error}</p>}

              <button className="generate-btn" onClick={handleSave} disabled={loading}>
                {loading ? '保存中...' : '保存模板配置'}
              </button>
            </div>
            )}
            {!editing && (
              <div className={`template-form-area ${localTemplate.renderType === 'canvas' && localTemplate.canvasConfig ? 'canvas-mode' : ''}`}>
            {/* ====== Canvas 模板：左右分栏预览 ====== */}
            {localTemplate.renderType === 'canvas' && localTemplate.canvasConfig && (
              <div className="canvas-left-panel">
                <div className="section-label">实时预览</div>
                <div className="phone-shell">
                  <div className="phone-notch" />
                  <div className="phone-screen">
                    {canvasPreviewUrl ? (
                      <img
                        src={canvasPreviewUrl}
                        alt="海报预览"
                        className="canvas-preview-img"
                      />
                    ) : (
                      <div className="canvas-preview-placeholder">
                        <span>填写右侧表单</span>
                        <span>预览将实时生成</span>
                      </div>
                    )}
                  </div>
                  <div className="phone-home-indicator" />
                </div>
              </div>
            )}

            {localTemplate.renderType === 'canvas' && localTemplate.canvasConfig ? (
              <div className="canvas-right-panel">
                {/* 填写表单（右侧） */}
                <div className="section-label">填写信息（* 为必填）</div>
                {fields.map((f) => (
                  <div key={f.key} className="template-field-item">
                    <div className="section-label" style={{ marginTop: 0 }}>
                      {f.label}{f.required && <span style={{ color: '#f97373' }}> *</span>}
                    </div>
                    {f.type === 'text' || !f.type ? (
                      <input
                        className="input-field"
                        value={form[f.key] || ''}
                        onChange={(e) => handleTextChange(f.key, e.target.value)}
                        placeholder={f.placeholder || `请输入${f.label}`}
                      />
                    ) : f.type === 'image' ? (
                      <div className="template-image-field">
                        <input
                          ref={(el) => (fileInputRefs.current[f.key] = el)}
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={(e) => handleImageChange(f.key, e.target.files?.[0])}
                        />
                        {filePreviews[f.key] ? (
                          <div className="template-image-preview" onClick={() => openFileDialog(f.key)}>
                            <img src={filePreviews[f.key]} alt={f.label} />
                            <div className="template-image-overlay">点击更换</div>
                          </div>
                        ) : (
                          <div className="upload-area" onClick={() => openFileDialog(f.key)}>
                            点击上传 {f.label}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                ))}
                {error && <p className="error-text">{error}</p>}
                <button
                  className="generate-btn"
                  onClick={handleGenerate}
                  disabled={generating}
                >
                  {generating ? '生成中...' : '✦ 免费生成海报'}
                </button>
              </div>
            ) : (
              <>
                {/* 固定参考图展示（仅 AI 模板）*/}
                {localTemplate.renderType !== 'canvas' && validRefCount > 0 && (
                  <div className="fixed-ref-images-area">
                    <div className="section-label" style={{ marginBottom: 8 }}>
                      固定模板参考图
                      <span className="fixed-ref-badge">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                          <path d="M7,11V7a5,5,0,0,1,10,0v4"/>
                        </svg>
                        不可修改
                      </span>
                    </div>
                    <div className="fixed-ref-images-grid">
                      {refImages
                        .filter((img) => !img.localFile && !img.uploading && !img.error)
                        .map((img, idx) => (
                          <div key={idx} className="fixed-ref-thumb">
                            <img src={img.url} alt={`模板参考图${idx + 1}`} />
                          </div>
                        ))}
                    </div>
                    <div className="fixed-ref-hint">
                      {FIXED_IMAGE_PROMPT.trim()}
                    </div>
                  </div>
                )}

                {/* 模板底图展示（仅 AI 模板） */}
                {localTemplate.renderType !== 'canvas' && localTemplate.templateImage && (
                  <div className="fixed-ref-images-area" style={{ borderColor: 'var(--accent-color)', borderWidth: 2 }}>
                    <div className="section-label" style={{ marginBottom: 8 }}>
                      模板底图
                      <span className="fixed-ref-badge" style={{ background: 'var(--accent-color)' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                          <path d="M7,11V7a5,5,0,0,1,10,0v4"/>
                        </svg>
                        AI 将在此底图上修改
                      </span>
                    </div>
                    <div style={{ borderRadius: 8, overflow: 'hidden', border: '2px solid var(--border-color)' }}>
                      <img
                        src={localTemplate.templateImage}
                        alt="模板底图"
                        style={{ width: '100%', maxHeight: 300, objectFit: 'contain', background: '#f5f5f5' }}
                      />
                    </div>
                    <div className="fixed-ref-hint" style={{ marginTop: 8 }}>
                      AI 只替换：姓名、部门、职位、联系方式、人物照片。布局、配色、字体、装饰元素保持不变。
                    </div>
                  </div>
                )}

                <div className="section-label" style={{ marginTop: validRefCount > 0 ? 0 : 0 }}>
                  填写信息（* 为必填）
                </div>
                {fields.map((f) => (
                  <div key={f.key} className="template-field-item">
                    <div className="section-label" style={{ marginTop: 0 }}>
                      {f.label}{f.required && <span style={{ color: '#f97373' }}> *</span>}
                    </div>
                    {f.type === 'text' || !f.type ? (
                      <input
                        className="input-field"
                        value={form[f.key] || ''}
                        onChange={(e) => handleTextChange(f.key, e.target.value)}
                        placeholder={f.placeholder || `请输入${f.label}`}
                      />
                    ) : f.type === 'image' ? (
                      <div className="template-image-field">
                        <input
                          ref={(el) => (fileInputRefs.current[f.key] = el)}
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={(e) => handleImageChange(f.key, e.target.files?.[0])}
                        />
                        {filePreviews[f.key] ? (
                          <div className="template-image-preview" onClick={() => openFileDialog(f.key)}>
                            <img src={filePreviews[f.key]} alt={f.label} />
                            <div className="template-image-overlay">点击更换</div>
                          </div>
                        ) : (
                          <div className="upload-area" onClick={() => openFileDialog(f.key)}>
                            点击上传 {f.label}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                ))}

                {/* 提示词预览（仅 AI 模板） */}
                {localTemplate.promptTemplate && localTemplate.renderType !== 'canvas' && (
                  <div className="prompt-preview-box">
                    <div className="section-label">提示词预览</div>
                    <p className="prompt-preview-text">{getPreviewPrompt() || '（填写上方表单后自动生成）'}</p>
                  </div>
                )}

                {error && <p className="error-text">{error}</p>}

                <button
                  className="generate-btn"
                  onClick={handleGenerate}
                  disabled={generating}
                >
                  {generating ? '生成中...' : `✦ 一键生成${localTemplate.name}`}
                </button>
              </>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="template-history-area">
          {!history.length ? (
            <div className="empty-hint">暂无生成记录</div>
          ) : (
            history.map((item) => (
              <div className="result-card" key={item.id}>
                <div className="card-header">
                  <span className="tag">{localTemplate.name}</span>
                  <div className="card-actions">
                    <button className="btn-outline small" onClick={() => handleDownload(item.resultImageUrl)}>
                      ⬇ 下载
                    </button>
                  </div>
                </div>
                <div className="prompt-text">{item.originalPrompt}</div>
                <div className="card-meta-row">
                  <span className="meta-item">{item.aspectRatio || item.imageSize || '-'}</span>
                  <span className="meta-time">
                    {new Date(item.createdAt).toLocaleString()}
                  </span>
                </div>
                {item.resultImageUrl && (
                  <div className="image-preview-area">
                    <div className="img-placeholder result">
                      <img src={item.resultImageUrl} alt={item.originalPrompt} />
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        )}

        {/* 生成结果展示 */}
        {resultImage && (
          <div className="result-card" style={{ marginTop: 16 }}>
            <div className="card-header">
              <span className="tag" style={{ background: '#10b981' }}>生成成功</span>
              <button className="btn-outline small" onClick={() => handleDownload(resultImage)}>
                ⬇ 下载
              </button>
            </div>
            <div className="image-preview-area">
              <div className="img-placeholder result">
                <img src={resultImage} alt="生成结果" />
              </div>
            </div>
          </div>
        )}
        </>
      )}

    </div>
  )
}

export default TemplatePanel
