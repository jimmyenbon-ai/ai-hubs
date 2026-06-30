import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './components/Icons'

const EXPERT_ROLES = [
  { value: 'ecommerce', label: '电商视觉专家' },
  { value: 'independent_site', label: '独立站转化专家' },
  { value: 'amazon', label: '平台主图专家' },
  { value: 'brand', label: '高端品牌设计师' },
  { value: 'detail_page', label: '详情页策划专家' },
]

const COMMERCE_TYPES = [
  { value: 'independent_site', label: '独立站' },
  { value: 'amazon', label: '亚马逊' },
  { value: 'shopify', label: 'Shopify' },
  { value: 'taobao', label: '淘宝/天猫' },
  { value: 'social_ads', label: '社媒广告' },
]

const VISUAL_STYLES = [
  { value: 'premium_minimal', label: '高级简约' },
  { value: 'ecommerce_pop', label: '电商爆款' },
  { value: 'tech', label: '科技感' },
  { value: 'lifestyle', label: '生活方式' },
  { value: 'luxury', label: '奢华质感' },
  { value: 'custom', label: '自定义' },
]

const IMAGE_TYPES = ['主图', '详情页', '场景图', '卖点图', '细节特写', '参数说明', '广告图', '独立站 Hero']
const MODELS = ['gpt-image-2', 'gpt-image-2-vip', 'nano-banana', 'nano-banana-pro', 'nano-banana-pro-vip']
const ASPECTS = ['1:1', '4:3', '3:4', '16:9', '9:16', '2.35:1']
const IMAGE_SIZES = ['1K', '2K', '4K']

const STEPS = [
  { key: 'input', label: '资料', desc: '产品与目标' },
  { key: 'plan', label: '方案', desc: '图片清单' },
  { key: 'refs', label: '素材', desc: '参考图' },
  { key: 'config', label: '生成', desc: '模型参数' },
]

const EMPTY_STRATEGY = {
  productPositioning: '',
  targetAudience: '',
  coreSellingPoints: [],
  visualDirection: '',
  riskNotes: [],
}

function Field({ label, hint, children }) {
  return (
    <label className="product-field">
      <span>{label}</span>
      {hint && <small>{hint}</small>}
      {children}
    </label>
  )
}

function normalizeItem(item = {}, index = 0, includeText = false) {
  return {
    imageNumber: Number(item.imageNumber || index + 1),
    title: item.title || `产品图 ${index + 1}`,
    imageType: item.imageType || IMAGE_TYPES[index % IMAGE_TYPES.length],
    objective: item.objective || '',
    scene: item.scene || '',
    composition: item.composition || '',
    lighting: item.lighting || '',
    copywriting: item.copywriting || '',
    prompt: item.prompt || '',
    negativePrompt: item.negativePrompt || '',
    includeText: item.includeText === undefined ? includeText : item.includeText === true,
    includeInGeneration: item.includeInGeneration !== false,
    status: item.status || 'pending',
    resultImageUrl: item.resultImageUrl || null,
    generatedPrompt: item.generatedPrompt || null,
    error: item.error || null,
  }
}

function statusLabel(status) {
  const map = {
    pending: '等待',
    generating: '生成中',
    completed: '完成',
    failed: '失败',
    skipped: '跳过',
  }
  return map[status] || status || '等待'
}

function ProductSteps({ step, onStep }) {
  const currentIndex = STEPS.findIndex((item) => item.key === step)
  return (
    <div className="product-steps">
      {STEPS.map((item, index) => {
        const active = item.key === step
        const done = currentIndex > index
        return (
          <button
            key={item.key}
            type="button"
            className={`product-step ${active ? 'active' : ''} ${done ? 'done' : ''}`}
            onClick={() => done && onStep(item.key)}
            disabled={!done && !active}
          >
            <span className="product-step-index">{done ? <Icon.Check size={12} /> : index + 1}</span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.desc}</small>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function StatCard({ icon, label, value }) {
  const IconComp = icon
  return (
    <div className="product-stat">
      <IconComp size={16} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function StrategyBoard({ strategy, items, referenceImages, activeCount }) {
  const points = Array.isArray(strategy.coreSellingPoints) ? strategy.coreSellingPoints : []
  return (
    <div className="product-board">
      <div className="product-board-hero">
        <div>
          <span className="product-kicker">AI 商品视觉规划</span>
          <h3>把产品资料变成可执行的出图清单</h3>
          <p>先锁定卖点、场景、构图和文案策略，再用参考图约束产品外观，减少随机抽卡。</p>
        </div>
        <div className="product-board-icon"><Icon.Package size={34} /></div>
      </div>

      <div className="product-stat-grid">
        <StatCard icon={Icon.Image} label="图片方案" value={`${items.length || 0} 张`} />
        <StatCard icon={Icon.CheckCircle} label="参与生成" value={`${activeCount || 0} 张`} />
        <StatCard icon={Icon.FileImage} label="参考素材" value={`${referenceImages.length || 0} 张`} />
      </div>

      <div className="product-insight-grid">
        <section>
          <span>产品定位</span>
          <p>{strategy.productPositioning || '等待 AI 分析产品定位、价格带、差异化卖点。'}</p>
        </section>
        <section>
          <span>目标客户</span>
          <p>{strategy.targetAudience || '根据产品资料自动提炼购买人群和使用场景。'}</p>
        </section>
        <section className="wide">
          <span>视觉方向</span>
          <p>{strategy.visualDirection || '会生成主图、详情页、场景图、卖点图等统一视觉方向。'}</p>
        </section>
      </div>

      <div className="product-chip-panel">
        <span>核心卖点</span>
        <div>
          {(points.length ? points : ['外观一致性', '卖点可视化', '电商转化', '场景还原']).map((point) => (
            <em key={point}>{point}</em>
          ))}
        </div>
      </div>
    </div>
  )
}

function ProductItemEditor({ item, onChange, onRemove }) {
  return (
    <article className={`product-plan-card ${item.includeInGeneration === false ? 'muted' : ''}`}>
      <div className="product-plan-head">
        <span className="product-number">#{item.imageNumber}</span>
        <input className="input-field" value={item.title} onChange={(e) => onChange({ title: e.target.value })} />
        <label className="product-switch">
          <input type="checkbox" checked={item.includeInGeneration !== false} onChange={(e) => onChange({ includeInGeneration: e.target.checked })} />
          生成
        </label>
      </div>

      <div className="product-plan-grid">
        <Field label="图片类型">
          <select className="input-field" value={item.imageType} onChange={(e) => onChange({ imageType: e.target.value })}>
            {IMAGE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </Field>
        <Field label="画面文字">
          <label className="product-toggle-line">
            <input type="checkbox" checked={item.includeText} onChange={(e) => onChange({ includeText: e.target.checked })} />
            允许带介绍文字
          </label>
        </Field>
        <Field label="转化目标">
          <textarea className="input-field" rows={2} value={item.objective} onChange={(e) => onChange({ objective: e.target.value })} />
        </Field>
        <Field label="场景设定">
          <textarea className="input-field" rows={2} value={item.scene} onChange={(e) => onChange({ scene: e.target.value })} />
        </Field>
        <Field label="构图">
          <textarea className="input-field" rows={2} value={item.composition} onChange={(e) => onChange({ composition: e.target.value })} />
        </Field>
        <Field label="灯光">
          <textarea className="input-field" rows={2} value={item.lighting} onChange={(e) => onChange({ lighting: e.target.value })} />
        </Field>
      </div>

      <Field label="画面文案">
        <textarea className="input-field" rows={2} value={item.copywriting} onChange={(e) => onChange({ copywriting: e.target.value })} placeholder="不需要文字可以留空" />
      </Field>
      <Field label="生图提示词">
        <textarea className="input-field product-prompt-box" rows={4} value={item.prompt} onChange={(e) => onChange({ prompt: e.target.value })} />
      </Field>
      <Field label="负向提示词">
        <textarea className="input-field" rows={2} value={item.negativePrompt} onChange={(e) => onChange({ negativePrompt: e.target.value })} />
      </Field>
      <div className="product-card-actions">
        <button className="btn-outline" onClick={onRemove}><Icon.Trash size={14} /> 删除</button>
      </div>
    </article>
  )
}

function PlanGallery({ items }) {
  if (!items.length) {
    return (
      <div className="product-empty-large">
        <Icon.LayoutList size={40} />
        <h3>等待生成产品图方案</h3>
        <p>左侧输入产品资料后，AI 会在这里拆出主图、详情页、场景图、卖点图、广告图等清单。</p>
      </div>
    )
  }

  return (
    <div className="product-mini-grid">
      {items.map((item) => (
        <div className="product-mini-card" key={`${item.imageNumber}-${item.title}`}>
          <div>
            <span>#{item.imageNumber}</span>
            <strong>{item.imageType}</strong>
          </div>
          <h4>{item.title}</h4>
          <p>{item.objective || item.scene || '等待补充画面目标'}</p>
        </div>
      ))}
    </div>
  )
}

function ResultCard({ item, onPreview }) {
  return (
    <div className={`product-result-card status-${item.status}`}>
      {item.resultImageUrl ? (
        <img src={item.resultImageUrl} alt={item.title} onClick={() => onPreview(item.resultImageUrl)} />
      ) : (
        <div className="product-result-placeholder">
          {item.status === 'generating' ? <Icon.Loader size={24} /> : <Icon.Image size={24} />}
          <span>{statusLabel(item.status)}</span>
        </div>
      )}
      <div className="product-result-meta">
        <strong>#{item.imageNumber} {item.title}</strong>
        <span>{statusLabel(item.status)}{item.error ? ` · ${item.error}` : ''}</span>
      </div>
    </div>
  )
}

export default function ProductAutomationPanel({ onBack }) {
  const [step, setStep] = useState('input')
  const [productName, setProductName] = useState('')
  const [productBrief, setProductBrief] = useState('')
  const [expertRole, setExpertRole] = useState('ecommerce')
  const [commerceType, setCommerceType] = useState('independent_site')
  const [visualStyle, setVisualStyle] = useState('premium_minimal')
  const [customStylePrompt, setCustomStylePrompt] = useState('')
  const [imageCount, setImageCount] = useState(8)
  const [includeText, setIncludeText] = useState(false)
  const [language, setLanguage] = useState('zh-CN')
  const [strategy, setStrategy] = useState(EMPTY_STRATEGY)
  const [items, setItems] = useState([])
  const [referenceImages, setReferenceImages] = useState([])
  const [refNote, setRefNote] = useState('')
  const [selectedModel, setSelectedModel] = useState('gpt-image-2')
  const [selectedAspectRatio, setSelectedAspectRatio] = useState('1:1')
  const [selectedImageSize, setSelectedImageSize] = useState('1K')
  const [qualityTags, setQualityTags] = useState('commercial product photography, ecommerce detail image, high clarity, accurate product shape')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [jobId, setJobId] = useState(null)
  const [jobItems, setJobItems] = useState([])
  const [enlargedImage, setEnlargedImage] = useState(null)
  const [downloading, setDownloading] = useState(false)

  const docInputRef = useRef(null)
  const refInputRef = useRef(null)
  const pollingRef = useRef(null)

  useEffect(() => () => {
    if (pollingRef.current) clearInterval(pollingRef.current)
  }, [])

  const activeCount = items.filter((item) => item.includeInGeneration !== false).length
  const completedCount = jobItems.filter((item) => item.status === 'completed').length
  const failedCount = jobItems.filter((item) => item.status === 'failed').length
  const progressPct = jobItems.length ? Math.round(((completedCount + failedCount) / jobItems.length) * 100) : 0
  const selectedStyleLabel = useMemo(() => VISUAL_STYLES.find((item) => item.value === visualStyle)?.label || '自定义', [visualStyle])

  async function handleDocUpload(event) {
    const file = event.target.files?.[0]
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    setError('')
    try {
      const resp = await fetch('/api/product-automation/analyze-upload', { method: 'POST', body: form })
      const data = await resp.json()
      if (!data.success) throw new Error(data.message || '资料读取失败')
      setProductBrief((prev) => [prev, `\n\n【${data.data.fileName}】\n${data.data.text}`].filter(Boolean).join(''))
    } catch (err) {
      setError(err.message || '资料读取失败')
    } finally {
      event.target.value = ''
    }
  }

  async function handleAnalyze() {
    if (!productBrief.trim()) {
      setError('请先输入或上传产品介绍、参数、卖点资料。')
      return
    }
    setLoading(true)
    setError('')
    try {
      const resp = await fetch('/api/product-automation/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName,
          productBrief,
          expertRole,
          commerceType,
          visualStyle,
          customStylePrompt,
          imageCount: Number(imageCount) || 8,
          includeText,
          language,
          referenceSummary: referenceImages.map((ref) => [ref.name, ref.note].filter(Boolean).join('：')).join('；'),
        }),
      })
      const data = await resp.json()
      if (!data.success || data.data?.success === false) throw new Error(data.message || data.data?.message || '产品图方案生成失败')
      setStrategy(data.data.strategy || EMPTY_STRATEGY)
      setItems((data.data.items || []).map((item, index) => normalizeItem(item, index, includeText)))
      setStep('plan')
    } catch (err) {
      setError(err.message || '产品图方案生成失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleRefUpload(event) {
    const files = Array.from(event.target.files || [])
    if (!files.length) return
    setLoading(true)
    setError('')
    try {
      const uploaded = []
      for (const file of files) {
        const form = new FormData()
        form.append('file', file)
        form.append('note', refNote)
        const resp = await fetch('/api/product-automation/upload-ref-image', { method: 'POST', body: form })
        const data = await resp.json()
        if (!data.success) throw new Error(data.message || '参考图上传失败')
        uploaded.push(data.data)
      }
      setReferenceImages((prev) => [...prev, ...uploaded])
      setRefNote('')
    } catch (err) {
      setError(err.message || '参考图上传失败')
    } finally {
      setLoading(false)
      event.target.value = ''
    }
  }

  function updateItem(index, patch) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  function addItem() {
    setItems((prev) => [...prev, normalizeItem({ imageNumber: prev.length + 1, title: `自定义产品图 ${prev.length + 1}` }, prev.length, includeText)])
  }

  async function handleStart() {
    if (referenceImages.length === 0) {
      setError('请至少上传一张产品参考图，避免模型把产品外观画偏。')
      setStep('refs')
      return
    }
    if (activeCount === 0) {
      setError('至少保留一张产品图参与生成。')
      return
    }
    setLoading(true)
    setError('')
    try {
      const resp = await fetch('/api/product-automation/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName,
          productBrief,
          expertRole,
          commerceType,
          visualStyle,
          customStylePrompt,
          strategy,
          referenceImages,
          items,
          config: {
            model: selectedModel,
            imageSize: selectedImageSize,
            aspectRatio: selectedAspectRatio,
            qualityTags,
            imageCount,
            includeText,
            language,
          },
        }),
      })
      const data = await resp.json()
      if (!data.success) throw new Error(data.message || '创建生成任务失败')
      setJobId(data.data.jobId)
      setJobItems(items.filter((item) => item.includeInGeneration !== false).map((item) => ({ ...item, status: 'pending' })))
      setStep('running')
      startPolling(data.data.jobId)
    } catch (err) {
      setError(err.message || '创建生成任务失败')
    } finally {
      setLoading(false)
    }
  }

  function startPolling(id) {
    if (pollingRef.current) clearInterval(pollingRef.current)
    pollingRef.current = setInterval(async () => {
      try {
        const resp = await fetch(`/api/product-automation/status/${id}`)
        const data = await resp.json()
        if (!data.success) return
        const active = (data.data.items || []).filter((item) => item.includeInGeneration !== false)
        setJobItems(active)
        if (data.data.status === 'completed' || data.data.status === 'failed') {
          clearInterval(pollingRef.current)
          pollingRef.current = null
          setStep('done')
        }
      } catch {
        // 轮询中的短暂网络错误不打断任务。
      }
    }, 2000)
  }

  async function handleAbort() {
    if (!jobId) return
    await fetch(`/api/product-automation/abort/${jobId}`, { method: 'POST' })
  }

  async function handleDownload() {
    if (!jobId) return
    setDownloading(true)
    try {
      window.location.href = `/api/product-automation/download/${jobId}`
    } finally {
      setTimeout(() => setDownloading(false), 1200)
    }
  }

  function renderWorkspace() {
    if (step === 'input') {
      return (
        <div className="product-right-scroll">
          <StrategyBoard strategy={strategy} items={items} referenceImages={referenceImages} activeCount={activeCount} />
          <PlanGallery items={items} />
        </div>
      )
    }

    if (step === 'plan') {
      return (
        <div className="product-editor-area">
          <div className="product-editor-toolbar">
            <div>
              <h3>产品图方案</h3>
              <p>{items.length} 张图，{activeCount} 张参与生成。可以先修提示词，再进入参考图步骤。</p>
            </div>
            <button className="btn-outline" onClick={addItem}><Icon.Plus size={14} /> 添加图片</button>
          </div>
          <div className="product-plan-list">
            {items.map((item, index) => (
              <ProductItemEditor
                key={`${item.imageNumber}-${index}`}
                item={item}
                onChange={(patch) => updateItem(index, patch)}
                onRemove={() => setItems((prev) => prev.filter((_, i) => i !== index).map((next, i) => ({ ...next, imageNumber: i + 1 })))}
              />
            ))}
            {items.length === 0 && <div className="product-empty-large">暂无方案</div>}
          </div>
        </div>
      )
    }

    if (step === 'refs') {
      return (
        <div className="product-reference-stage">
          <div className="product-reference-board">
            <Icon.FileImage size={34} />
            <h3>产品参考图会决定外观一致性</h3>
            <p>建议上传正面、侧面、细节、包装或使用场景图，并用备注说明颜色、材质、结构、必须保留的区域。</p>
          </div>
          <div className="product-ref-grid">
            {referenceImages.map((img, idx) => (
              <article className="product-ref-card" key={`${img.url}-${idx}`}>
                <img src={img.url} alt={img.name} />
                <input className="input-field" value={img.note || ''} onChange={(e) => setReferenceImages((prev) => prev.map((ref, i) => (i === idx ? { ...ref, note: e.target.value } : ref)))} placeholder="参考图备注" />
                <button className="btn-outline" onClick={() => setReferenceImages((prev) => prev.filter((_, i) => i !== idx))}><Icon.X size={14} /> 移除</button>
              </article>
            ))}
            <button className="product-ref-add" onClick={() => refInputRef.current?.click()} disabled={loading}>
              <Icon.ImagePlus size={26} />
              <strong>上传参考图</strong>
              <span>支持多张产品照</span>
            </button>
          </div>
        </div>
      )
    }

    if (step === 'config') {
      return (
        <div className="product-final-preview">
          <StrategyBoard strategy={strategy} items={items} referenceImages={referenceImages} activeCount={activeCount} />
          <div className="product-summary-list">
            <h3>即将生成</h3>
            {items.filter((item) => item.includeInGeneration !== false).map((item) => (
              <div key={item.imageNumber}>
                <span className="product-number">#{item.imageNumber}</span>
                <strong>{item.title}</strong>
                <em>{item.imageType}</em>
              </div>
            ))}
          </div>
        </div>
      )
    }

    return null
  }

  if (step === 'running' || step === 'done') {
    return (
      <div className="product-automation product-automation-results">
        <header className="product-result-header">
          <div>
            <span className="product-kicker">{step === 'done' ? '生成完成' : '任务运行中'}</span>
            <h2>{step === 'done' ? '产品图生成完成' : '产品图正在生成'}</h2>
            <p>{completedCount}/{jobItems.length} 完成{failedCount ? `，失败 ${failedCount}` : ''}</p>
          </div>
          <div className="product-result-actions">
            {step === 'done' && <button className="btn-outline" onClick={handleDownload} disabled={downloading}><Icon.Download size={14} /> {downloading ? '打包中' : '下载 ZIP'}</button>}
            {step === 'running' && <button className="btn-outline danger" onClick={handleAbort}>中止任务</button>}
            <button className="btn-outline" onClick={() => setStep('input')}>新任务</button>
          </div>
        </header>
        <div className="product-progress">
          <div style={{ width: `${progressPct}%` }} />
        </div>
        <div className="product-result-grid">
          {jobItems.map((item) => <ResultCard key={item.imageNumber} item={item} onPreview={setEnlargedImage} />)}
        </div>
        {enlargedImage && (
          <div className="modal-backdrop" onClick={() => setEnlargedImage(null)}>
            <div className="storyboard-modal">
              <img src={enlargedImage} alt="产品图预览" />
              <button className="modal-close" onClick={() => setEnlargedImage(null)}><Icon.X size={16} /></button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="product-automation">
      <aside className="product-control">
        <div className="product-title-row">
          {onBack && <button className="btn-back" onClick={onBack}><Icon.ChevronLeft size={18} /></button>}
          <div>
            <span className="product-kicker">Product Automation</span>
            <h2>产品图自动化</h2>
          </div>
        </div>

        <ProductSteps step={step} onStep={setStep} />

        {step === 'input' && (
          <div className="product-form">
            <Field label="产品名称">
              <input className="input-field" value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="例如：Enbon 智能会议屏" />
            </Field>
            <Field label="产品介绍 / 参数 / 卖点" hint="粘贴产品资料、适用场景、材质、尺寸、目标客户等。">
              <textarea className="input-field product-main-textarea" rows={10} value={productBrief} onChange={(e) => setProductBrief(e.target.value)} placeholder="例如：这是一款面向会议室和教育场景的智能会议屏，支持 4K 显示、无线投屏、远程协作..." />
            </Field>
            <input ref={docInputRef} type="file" accept=".txt,.md,.csv,.json" onChange={handleDocUpload} style={{ display: 'none' }} />
            <button className="product-upload-btn" onClick={() => docInputRef.current?.click()}><Icon.Upload size={15} /> 上传资料文件</button>

            <div className="product-form-grid">
              <Field label="专家角色">
                <select className="input-field" value={expertRole} onChange={(e) => setExpertRole(e.target.value)}>
                  {EXPERT_ROLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </Field>
              <Field label="电商类型">
                <select className="input-field" value={commerceType} onChange={(e) => setCommerceType(e.target.value)}>
                  {COMMERCE_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </Field>
              <Field label="视觉风格">
                <select className="input-field" value={visualStyle} onChange={(e) => setVisualStyle(e.target.value)}>
                  {VISUAL_STYLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </Field>
              <Field label="生成张数">
                <input className="input-field" type="number" min="1" max="30" value={imageCount} onChange={(e) => setImageCount(Number(e.target.value))} />
              </Field>
            </div>

            {visualStyle === 'custom' && (
              <Field label="自定义风格">
                <textarea className="input-field" rows={3} value={customStylePrompt} onChange={(e) => setCustomStylePrompt(e.target.value)} placeholder="例如：黑金高端质感、玻璃反射、低饱和高级灰、独立站首屏风格。" />
              </Field>
            )}

            <div className="product-option-row">
              <label><input type="checkbox" checked={includeText} onChange={(e) => setIncludeText(e.target.checked)} /> 允许画面带介绍文字</label>
              <label><input type="checkbox" checked={language === 'en'} onChange={(e) => setLanguage(e.target.checked ? 'en' : 'zh-CN')} /> 英文文案</label>
            </div>
            {error && <div className="error-box product-error">{error}</div>}
            <button className="generate-btn product-primary" onClick={handleAnalyze} disabled={loading || !productBrief.trim()}>
              {loading ? <><Icon.Loader size={15} /> AI 正在策划</> : <><Icon.Brain size={15} /> 生成产品图方案</>}
            </button>
          </div>
        )}

        {step === 'plan' && (
          <div className="product-form">
            <Field label="产品定位">
              <textarea className="input-field" rows={3} value={strategy.productPositioning || ''} onChange={(e) => setStrategy((prev) => ({ ...prev, productPositioning: e.target.value }))} />
            </Field>
            <Field label="目标客户">
              <textarea className="input-field" rows={3} value={strategy.targetAudience || ''} onChange={(e) => setStrategy((prev) => ({ ...prev, targetAudience: e.target.value }))} />
            </Field>
            <Field label="视觉方向">
              <textarea className="input-field" rows={4} value={strategy.visualDirection || ''} onChange={(e) => setStrategy((prev) => ({ ...prev, visualDirection: e.target.value }))} />
            </Field>
            {error && <div className="error-box product-error">{error}</div>}
            <button className="generate-btn product-primary" onClick={() => setStep('refs')}><Icon.ChevronRight size={15} /> 下一步：产品参考图</button>
          </div>
        )}

        {step === 'refs' && (
          <div className="product-form">
            <Field label="参考图备注" hint="先写备注，再上传，可帮助后端绑定产品外观。">
              <input className="input-field" value={refNote} onChange={(e) => setRefNote(e.target.value)} placeholder="例如：正面主图，银色款，保留屏幕边框和底座结构" />
            </Field>
            <input ref={refInputRef} type="file" accept="image/*" multiple onChange={handleRefUpload} style={{ display: 'none' }} />
            <button className="generate-btn product-primary" onClick={() => refInputRef.current?.click()} disabled={loading}>
              <Icon.ImagePlus size={15} /> 上传产品参考图
            </button>
            <div className="product-ref-count">{referenceImages.length} 张参考图已上传</div>
            {error && <div className="error-box product-error">{error}</div>}
            <button className="btn-outline product-next" onClick={() => setStep('config')} disabled={referenceImages.length === 0}>
              下一步：生成参数
            </button>
          </div>
        )}

        {step === 'config' && (
          <div className="product-form">
            <div className="product-config-summary">
              <strong>{activeCount}</strong>
              <span>张产品图将生成</span>
              <small>{selectedStyleLabel} · {selectedAspectRatio} · {selectedImageSize}</small>
            </div>
            <Field label="模型">
              <select className="input-field" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
                {MODELS.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            </Field>
            <div className="product-form-grid">
              <Field label="画幅">
                <select className="input-field" value={selectedAspectRatio} onChange={(e) => setSelectedAspectRatio(e.target.value)}>
                  {ASPECTS.map((aspect) => <option key={aspect} value={aspect}>{aspect}</option>)}
                </select>
              </Field>
              <Field label="清晰度">
                <select className="input-field" value={selectedImageSize} onChange={(e) => setSelectedImageSize(e.target.value)}>
                  {IMAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
                </select>
              </Field>
            </div>
            <Field label="画质补充">
              <textarea className="input-field" rows={4} value={qualityTags} onChange={(e) => setQualityTags(e.target.value)} />
            </Field>
            {error && <div className="error-box product-error">{error}</div>}
            <button className="generate-btn product-primary" onClick={handleStart} disabled={loading}>
              <Icon.Sparkles size={15} /> 开始生成产品图
            </button>
          </div>
        )}
      </aside>

      <main className="product-workspace">
        {renderWorkspace()}
      </main>
    </div>
  )
}
