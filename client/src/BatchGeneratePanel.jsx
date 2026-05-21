import { useState, useRef, useEffect, useCallback } from 'react'

const MODEL_OPTIONS = [
  { value: 'gpt-image-2', label: 'GPT-Image 2', category: 'gpt' },
  { value: 'gpt-image-2-vip', label: 'GPT-Image 2 VIP', category: 'gpt' },
  { value: 'nano-banana', label: 'Nano Banana', category: 'nano' },
  { value: 'nano-banana-fast', label: 'Nano Banana Fast', category: 'nano' },
  { value: 'nano-banana-2', label: 'Nano Banana 2', category: 'nano' },
  { value: 'nano-banana-2-cl', label: 'Nano Banana 2 CL (2K)', category: 'nano' },
  { value: 'nano-banana-2-4k-cl', label: 'Nano Banana 2 4K CL', category: 'nano' },
  { value: 'nano-banana-pro', label: 'Nano Banana Pro', category: 'nano' },
  { value: 'nano-banana-pro-cl', label: 'Nano Banana Pro CL (2K)', category: 'nano' },
  { value: 'nano-banana-pro-vip', label: 'Nano Banana Pro VIP (2K)', category: 'nano' },
  { value: 'nano-banana-pro-4k-vip', label: 'Nano Banana Pro 4K VIP', category: 'nano' },
]

const ASPECT_RATIOS = [
  { value: '1:1', label: '1:1 方形' },
  { value: '16:9', label: '16:9 横版' },
  { value: '9:16', label: '9:16 竖版' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4 竖版' },
  { value: '3:2', label: '3:2 横版' },
  { value: '2:3', label: '2:3 竖版' },
  { value: '21:9', label: '21:9 宽屏' },
  { value: '2:1', label: '2:1 横超宽' },
  { value: '3:1', label: '3:1 全景' },
]

const IMAGE_SIZES = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
]

function statusIcon(status) {
  switch (status) {
    case 'queued': return '⏳'
    case 'running': return '🔄'
    case 'completed': return '✅'
    case 'failed': return '❌'
    default: return '⏳'
  }
}

function statusLabel(status) {
  switch (status) {
    case 'queued': return '排队中'
    case 'running': return '生成中'
    case 'completed': return '已完成'
    case 'failed': return '失败'
    default: return '未知'
  }
}

function BatchGeneratePanel() {
  // Step state
  const [step, setStep] = useState('upload') // upload | preview | running | done
  const [items, setItems] = useState([])
  const [jobName, setJobName] = useState('')
  const [fileName, setFileName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  // Config
  const [defaultModel, setDefaultModel] = useState('gpt-image-2')
  const [defaultAspectRatio, setDefaultAspectRatio] = useState('1:1')
  const [defaultImageSize, setDefaultImageSize] = useState('1K')

  // Job
  const [jobId, setJobId] = useState(null)
  const [jobStatus, setJobStatus] = useState('queued')
  const pollingRef = useRef(null)
  const [downloadReady, setDownloadReady] = useState(false)

  // Editing
  const [editingIndex, setEditingIndex] = useState(null)
  const [editValue, setEditValue] = useState('')

  const fileInputRef = useRef(null)

  // cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [])

  // Handle file upload
  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return

    setFileName(file.name)
    setUploading(true)
    setUploadError('')

    try {
      const form = new FormData()
      form.append('file', file)

      const resp = await fetch('/api/batch/upload', {
        method: 'POST',
        body: form,
      })
      const data = await resp.json()

      if (!data.success) {
        setUploadError(data.message || '解析失败')
        setUploading(false)
        return
      }

      setJobName(data.data.name)
      setItems(data.data.items)
      setStep('preview')
    } catch (err) {
      setUploadError(err.message || '上传失败')
    }
    setUploading(false)
  }

  // Delete item
  function handleDeleteItem(index) {
    setItems((prev) => prev.filter((it) => it.index !== index))
  }

  // Start editing
  function startEdit(index, prompt) {
    setEditingIndex(index)
    setEditValue(prompt)
  }

  // Save edit
  function saveEdit() {
    if (editingIndex === null) return
    setItems((prev) =>
      prev.map((it) =>
        it.index === editingIndex ? { ...it, prompt: editValue.trim() || it.prompt } : it
      )
    )
    setEditingIndex(null)
    setEditValue('')
  }

  // Start batch generation
  async function handleStart() {
    if (items.length === 0) return

    try {
      const resp = await fetch('/api/batch/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: jobName || '批量生成',
          items: items.map((it) => ({
            prompt: it.prompt,
            model: it.model || null,
            aspectRatio: it.aspectRatio || null,
            imageSize: it.imageSize || null,
          })),
          defaultModel,
          defaultAspectRatio,
          defaultImageSize,
        }),
      })
      const data = await resp.json()

      if (!data.success) {
        alert(data.message || '启动失败')
        return
      }

      setJobId(data.data.jobId)
      setJobStatus('running')
      setStep('running')

      // Start polling
      pollingRef.current = setInterval(() => pollStatus(data.data.jobId), 2000)
    } catch (err) {
      alert('启动失败: ' + (err.message || '未知错误'))
    }
  }

  // Poll job status
  const pollStatus = useCallback(async (id) => {
    try {
      const resp = await fetch(`/api/batch/status/${id}`)
      const data = await resp.json()

      if (!data.success) return

      const job = data.data
      setItems(job.items)
      setJobStatus(job.status)

      if (job.status === 'completed' || job.status === 'failed') {
        clearInterval(pollingRef.current)
        pollingRef.current = null
        if (job.status === 'completed') {
          setDownloadReady(true)
          setStep('done')
        }
      }
    } catch (_) { /* ignore polling errors */ }
  }, [])

  // Abort
  async function handleAbort() {
    if (!jobId) return
    try {
      await fetch(`/api/batch/abort/${jobId}`, { method: 'POST' })
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
      setJobStatus('failed')
      setStep('done')
    } catch (_) { /* ignore */ }
  }

  // Retry single item
  async function handleRetry(itemIndex) {
    if (!jobId) return
    try {
      const resp = await fetch(`/api/batch/retry/${jobId}/${itemIndex}`, { method: 'POST' })
      const data = await resp.json()
      if (data.success) {
        setJobStatus('running')
        setStep('running')
        setDownloadReady(false)
        pollingRef.current = setInterval(() => pollStatus(jobId), 2000)
      }
    } catch (_) { /* ignore */ }
  }

  // Download zip
  function handleDownload() {
    if (!jobId) return
    window.open(`/api/batch/download/${jobId}`, '_blank')
  }

  // Download single image
  function handleDownloadSingle(url) {
    window.open(url, '_blank')
  }

  // Reset
  function handleReset() {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
    setStep('upload')
    setItems([])
    setJobName('')
    setFileName('')
    setUploadError('')
    setJobId(null)
    setJobStatus('queued')
    setDownloadReady(false)
    setEditingIndex(null)
  }

  const completedCount = items.filter((it) => it.status === 'completed').length
  const failedCount = items.filter((it) => it.status === 'failed').length
  const totalCount = items.length
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  // ---- RENDER ----

  return (
    <div className="batch-generate-panel">
      {/* Step indicator */}
      <div className="batch-steps">
        {['upload', 'preview', 'running', 'done'].map((s, i) => {
          const labels = ['上传文档', '预览编辑', '生成进度', '结果']
          const stepIndex = ['upload', 'preview', 'running', 'done'].indexOf(step)
          const isActive = i <= stepIndex
          return (
            <div key={s} className={`batch-step ${isActive ? 'active' : ''}`}>
              <span className="batch-step-num">{i + 1}</span>
              <span className="batch-step-label">{labels[i]}</span>
              {i < 3 && <span className="batch-step-line" />}
            </div>
          )
        })}
      </div>

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div className="batch-section">
          <h3 className="batch-section-title">上传提示词文档</h3>
          <p className="batch-hint">支持 .txt / .md / .csv / .xlsx 格式，系统将自动解析每条提示词</p>

          <div
            className="batch-upload-zone"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('dragover') }}
            onDragLeave={(e) => e.currentTarget.classList.remove('dragover')}
            onDrop={(e) => {
              e.preventDefault()
              e.currentTarget.classList.remove('dragover')
              const file = e.dataTransfer.files?.[0]
              if (file) {
                const fakeEvent = { target: { files: [file] } }
                handleFileChange(fakeEvent)
              }
            }}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.4 }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17,8 12,3 7,8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <p className="batch-upload-text">
              {uploading ? '解析中...' : '点击或拖拽文件到此处上传'}
            </p>
            {fileName && !uploading && <p className="batch-upload-filename">已选择: {fileName}</p>}
            {uploadError && <p className="batch-upload-error">{uploadError}</p>}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.csv,.xlsx,.xls"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />

          <div className="batch-format-hints">
            <h4>文档格式说明</h4>
            <div className="batch-format-cards">
              <div className="batch-format-card">
                <strong>.txt</strong>
                <p>空行分隔每条提示词，自动去除前导数字编号</p>
              </div>
              <div className="batch-format-card">
                <strong>.md</strong>
                <p>## 标题为分组名，下方为对应提示词</p>
              </div>
              <div className="batch-format-card">
                <strong>.csv</strong>
                <p>第1列提示词，第2列模型(可选)，第3列比例(可选)，第4列分辨率(可选)</p>
              </div>
              <div className="batch-format-card">
                <strong>.xlsx</strong>
                <p>同 CSV 格式，读取第一个 Sheet</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Preview & Edit */}
      {step === 'preview' && (
        <div className="batch-section">
          <div className="batch-preview-header">
            <div>
              <h3 className="batch-section-title">预览与编辑 — {jobName}</h3>
              <p className="batch-hint">共解析 {items.length} 条提示词，可删除不需要的条目或双击编辑</p>
            </div>
            <button className="btn-outline" onClick={handleReset}>返回重选</button>
          </div>

          {/* Config bar */}
          <div className="batch-config-bar">
            <div className="batch-config-item">
              <label>默认模型</label>
              <select value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)}>
                {MODEL_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div className="batch-config-item">
              <label>默认比例</label>
              <select value={defaultAspectRatio} onChange={(e) => setDefaultAspectRatio(e.target.value)}>
                {ASPECT_RATIOS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <div className="batch-config-item">
              <label>默认分辨率</label>
              <select value={defaultImageSize} onChange={(e) => setDefaultImageSize(e.target.value)}>
                {IMAGE_SIZES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Items table */}
          <div className="batch-items-table-wrap">
            <table className="batch-items-table">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>序号</th>
                  <th>提示词</th>
                  <th style={{ width: 80 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.index}>
                    <td className="batch-item-index">{item.index}</td>
                    <td
                      className="batch-item-prompt"
                      onDoubleClick={() => startEdit(item.index, item.prompt)}
                    >
                      {editingIndex === item.index ? (
                        <input
                          className="input-field"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={saveEdit}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingIndex(null) }}
                          autoFocus
                          style={{ width: '100%', margin: 0 }}
                        />
                      ) : (
                        item.prompt
                      )}
                    </td>
                    <td>
                      <button
                        className="btn-outline btn-sm"
                        onClick={() => handleDeleteItem(item.index)}
                        title="删除"
                        style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {items.length === 0 && (
            <p className="batch-empty-hint">所有条目已删除，请返回重新上传文件</p>
          )}

          <div className="batch-start-bar">
            <span className="batch-count-label">共 {items.length} 条待生成</span>
            <button
              className="generate-btn"
              onClick={handleStart}
              disabled={items.length === 0}
            >
              开始批量生成 ({items.length} 张)
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Running progress */}
      {(step === 'running' || step === 'done') && (
        <div className="batch-section">
          <div className="batch-progress-header">
            <h3 className="batch-section-title">
              批量生成 — {jobName}
            </h3>
            <span className={`batch-status-badge ${jobStatus}`}>
              {jobStatus === 'running' && '运行中'}
              {jobStatus === 'completed' && '已完成'}
              {jobStatus === 'failed' && '已中止'}
            </span>
          </div>

          {/* Progress bar */}
          <div className="batch-progress-bar-wrap">
            <div className="batch-progress-bar" style={{ width: `${progress}%` }} />
            <span className="batch-progress-text">
              {completedCount} / {totalCount} 完成
              {failedCount > 0 && ` (${failedCount} 失败)`}
              {progress > 0 && ` — ${progress}%`}
            </span>
          </div>

          {/* Abort button */}
          {jobStatus === 'running' && (
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <button className="btn-outline" onClick={handleAbort} style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>
                中止生成
              </button>
            </div>
          )}

          {/* Download button */}
          {downloadReady && (
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <button className="generate-btn" onClick={handleDownload}>
                打包下载全部结果 (ZIP)
              </button>
            </div>
          )}

          {/* Items list */}
          <div className="batch-items-table-wrap">
            <table className="batch-items-table">
              <thead>
                <tr>
                  <th style={{ width: 50 }}>#</th>
                  <th style={{ width: 60 }}>状态</th>
                  <th>提示词</th>
                  <th style={{ width: 120 }}>结果</th>
                  <th style={{ width: 80 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.index} className={`batch-row-${item.status}`}>
                    <td className="batch-item-index">{item.index}</td>
                    <td>
                      <span title={statusLabel(item.status)}>{statusIcon(item.status)}</span>
                    </td>
                    <td className="batch-item-prompt" title={item.prompt}>
                      {item.prompt.length > 80 ? item.prompt.slice(0, 80) + '...' : item.prompt}
                    </td>
                    <td>
                      {item.status === 'completed' && item.resultImageUrl && (
                        <img
                          src={item.resultImageUrl}
                          alt=""
                          className="batch-thumb"
                          onClick={() => handleDownloadSingle(item.resultImageUrl)}
                        />
                      )}
                      {item.status === 'failed' && (
                        <span className="batch-error-text" title={item.error}>{item.error?.slice(0, 40) || '未知错误'}</span>
                      )}
                    </td>
                    <td>
                      {item.status === 'completed' && item.resultImageUrl && (
                        <button
                          className="btn-outline btn-sm"
                          onClick={() => handleDownloadSingle(item.resultImageUrl)}
                          title="下载"
                        >
                          ⬇
                        </button>
                      )}
                      {item.status === 'failed' && (
                        <button
                          className="btn-outline btn-sm"
                          onClick={() => handleRetry(item.index)}
                          title="重试"
                        >
                          🔄
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Bottom actions */}
          <div className="batch-start-bar">
            {jobStatus !== 'running' && (
              <>
                <button className="btn-outline" onClick={handleReset}>开始新任务</button>
                {downloadReady && (
                  <button className="generate-btn" onClick={handleDownload}>打包下载 (ZIP)</button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default BatchGeneratePanel
