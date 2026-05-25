import { useEffect, useRef, useState } from 'react'
import PromptQuickLibrary from './components/PromptQuickLibrary'
import HistoryFilterBar from './HistoryFilterBar'

export const NANO_IMAGE_SIZES = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
]

const GPT_ASPECT_RATIOS = [
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
  { value: '3:1', label: '3:1 全景' },
  { value: '1:3', label: '1:3 超竖' },
]

const NANO_ASPECT_RATIOS = [
  { value: 'auto', label: '自动' },
  { value: '1:1', label: '1:1 方形' },
  { value: '16:9', label: '16:9 横版' },
  { value: '9:16', label: '9:16 竖版' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4 竖版' },
  { value: '3:2', label: '3:2 横版' },
  { value: '2:3', label: '2:3 竖版' },
  { value: '5:4', label: '5:4' },
  { value: '4:5', label: '4:5 竖版' },
  { value: '21:9', label: '21:9 宽屏' },
  { value: '1:4', label: '1:4 超竖' },
  { value: '4:1', label: '4:1 超横' },
  { value: '1:8', label: '1:8 极竖' },
  { value: '8:1', label: '8:1 极横' },
]

const DRAFT_STORAGE_KEY = 'aihub_image_free_draft'

// 风格标签
const STYLE_TAGS = [
  { label: '专业商务', value: 'professional business style, clean layout' },
  { label: '温暖亲切', value: 'warm and friendly atmosphere, soft lighting' },
  { label: '科技感', value: 'futuristic, high-tech, cyberpunk aesthetic' },
  { label: '国潮风', value: 'Chinese traditional style, oriental aesthetic, ink painting' },
  { label: '极简主义', value: 'minimalist, clean white space, simple design' },
  { label: '赛博朋克', value: 'neon lights, cyberpunk, dark city background' },
  { label: '水彩插画', value: 'watercolor illustration, soft brushstrokes' },
  { label: '3D渲染', value: '3D render, realistic lighting, octane render' },
]

// 质量增强标签
const QUALITY_TAGS = [
  { label: '8K', value: ', 8K ultra high definition' },
  { label: 'HDR', value: ', HDR rendering, high dynamic range' },
  { label: '4K', value: ', 4K high resolution' },
  { label: '精致细节', value: ', intricate details, highly detailed' },
  { label: '光影', value: ', cinematic lighting, volumetric lighting' },
  { label: '景深', value: ', depth of field, bokeh effect' },
  { label: '最佳质量', value: ', masterpiece, best quality, masterpiece' },
  { label: '辛烷渲染', value: ', octane render, unreal engine 5' },
]

const PAGE_SIZE = 30

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    return {
      prompt: typeof p.prompt === 'string' ? p.prompt : '',
      model: p.model || 'gpt-image-2',
      aspectRatio: p.aspectRatio || 'auto',
      imageSize: NANO_IMAGE_SIZES.find((s) => s.value === p.imageSize)?.value || '1K',
      quality: p.quality || 'auto',
    }
  } catch {
    return null
  }
}

function ImageFreePanel({ injectedTemplate, onInjectedConsumed, userId, currentRole }) {
  const [files, setFiles] = useState([])
  const [prompt, setPrompt] = useState(() => loadDraft()?.prompt ?? '')
  const [selectedModel, setSelectedModel] = useState(() => loadDraft()?.model ?? 'gpt-image-2')
  const [aspectRatio, setAspectRatio] = useState(() => loadDraft()?.aspectRatio ?? 'auto')
  const [imageSize, setImageSize] = useState(() => loadDraft()?.imageSize ?? '1K')
  const [quality, setQuality] = useState(() => loadDraft()?.quality ?? 'auto')
  const [loadingUpload, setLoadingUpload] = useState(false)
  const [error, setError] = useState('')
  const [resultImage, setResultImage] = useState('')
  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [selectedItem, setSelectedItem] = useState(null)
  const [activeTab, setActiveTab] = useState('mine')
  const [mentionState, setMentionState] = useState({ visible: false, startIndex: 0 })
  const [activeTasks, setActiveTasks] = useState([])
  const [nextTaskId, setNextTaskId] = useState(1)
  const promptRef = useRef(null)
  const uploadInputRef = useRef(null)
  const progressTimersRef = useRef({})
  const completedResultUrlsRef = useRef({})

  // 提示词优化状态
  const [activeStyleTags, setActiveStyleTags] = useState([])
  const [activeQualityTags, setActiveQualityTags] = useState([])
  const [showPromptLibrary, setShowPromptLibrary] = useState(false) // 提示词快捷库
  const [styleProfileId, setStyleProfileId] = useState('')
  const [styleProfiles, setStyleProfiles] = useState([])
  // 保存风格画像弹窗
  const [styleModal, setStyleModal] = useState({ show: false, item: null, name: '', tags: '' })

  // 历史记录状态
  const [historyPage, setHistoryPage] = useState(1)
  const [historyPageSize, setHistoryPageSize] = useState(20)
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyTotalPages, setHistoryTotalPages] = useState(0)
  const [historyView, setHistoryView] = useState('list') // 'list' | 'grid'
  const [historySearch, setHistorySearch] = useState('')
  const [historyDateFrom, setHistoryDateFrom] = useState('')
  const [historyDateTo, setHistoryDateTo] = useState('')
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false) // 只显示收藏

  useEffect(() => {
    fetchHistory(true)
    fetchStyleProfiles()
    if (userId) loadPreferences()
  }, [])

  async function fetchStyleProfiles() {
    try {
      const resp = await fetch('/api/style-profiles')
      const data = await resp.json()
      if (data.success) setStyleProfiles(data.data)
    } catch (_) {}
  }

  async function loadPreferences() {
    try {
      const resp = await fetch(`/api/prefs/${userId}`)
      const data = await resp.json()
      if (data.success && data.data) {
        const prefs = data.data
        if (prefs.defaultAspectRatio && prefs.defaultAspectRatio !== 'auto') setAspectRatio(prefs.defaultAspectRatio)
        if (prefs.defaultImageSize) setImageSize(prefs.defaultImageSize)
        if (prefs.recentModels && prefs.recentModels.length > 0) setSelectedModel(prefs.recentModels[0])
        if (prefs.recentStyleProfileIds && prefs.recentStyleProfileIds.length > 0) {
          setStyleProfileId(prefs.recentStyleProfileIds[0])
        }
      }
    } catch (_) {}
  }

  async function recordPreferences(model, aspect, size, styleId) {
    if (!userId) return
    try {
      await fetch(`/api/prefs/${userId}/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, aspectRatio: aspect, imageSize: size,
          styleProfileId: styleId,
          promptPattern: prompt.slice(0, 60),
        }),
      })
    } catch (_) {}
  }

  useEffect(() => {
    try {
      localStorage.setItem(
        DRAFT_STORAGE_KEY,
        JSON.stringify({ prompt, model: selectedModel, aspectRatio, imageSize, quality }),
      )
    } catch { /* ignore */ }
  }, [prompt, selectedModel, aspectRatio, imageSize])

  // 处理从模板库注入的模板
  useEffect(() => {
    if (!injectedTemplate) return
    const tpl = injectedTemplate
    if (tpl.prompt) setPrompt(tpl.prompt)
    if (tpl.model) setSelectedModel(tpl.model)
    if (tpl.aspectRatio) setAspectRatio(tpl.aspectRatio)
    if (tpl.imageSize) setImageSize(tpl.imageSize)
    if (onInjectedConsumed) onInjectedConsumed()
  }, [injectedTemplate])

  // Ctrl+Enter 触发生成
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        const active = document.activeElement
        const isInPrompt = active === promptRef.current || active.closest?.('.config-panel')
        if (isInPrompt) {
          e.preventDefault()
          handleGenerate()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [prompt, selectedModel, aspectRatio, imageSize, files])

  function handleRemoveFile(id) {
    setFiles((prev) => {
      const filtered = prev.filter((f) => f.id !== id)
      return filtered.map((f, idx) => ({ ...f, id: idx + 1 }))
    })
  }

  function handlePromptChange(e) {
    const value = e.target.value
    setPrompt(value)
    const caret = e.target.selectionStart ?? value.length
    const beforeCaret = value.slice(0, caret)
    const match = beforeCaret.match(/@(\d*)$/)
    if (match && files.length) {
      setMentionState({ visible: true, startIndex: caret - match[0].length })
    } else if (mentionState.visible) {
      setMentionState((prev) => ({ ...prev, visible: false }))
    }
  }

  function handleSelectMention(id) {
    const mention = `@${id}`
    const textarea = promptRef.current
    const start = mentionState.startIndex
    const before = prompt.slice(0, start)
    const after = prompt.slice(textarea.selectionStart)
    const newValue = before + mention + after
    setPrompt(newValue)
    setMentionState((prev) => ({ ...prev, visible: false }))
    setTimeout(() => {
      if (textarea) {
        const pos = start + mention.length
        textarea.focus()
        textarea.setSelectionRange(pos, pos)
      }
    }, 0)
  }

  function toggleStyleTag(tag) {
    setActiveStyleTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    )
  }

  function toggleQualityTag(tag) {
    setActiveQualityTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    )
  }

  // 从快捷库插入提示词
  function handleInsertPrompt(text) {
    const textarea = promptRef.current
    if (textarea) {
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const newValue = prompt.slice(0, start) + (prompt.slice(0, start) && !prompt.slice(start - 1).match(/[,\s]/) ? ', ' : '') + text + (prompt.slice(end) && !prompt.slice(end, end + 1).match(/[,\s]/) ? ', ' : '') + prompt.slice(end)
      setPrompt(newValue)
      setTimeout(() => {
        textarea.focus()
        const newPos = start + text.length + 2
        textarea.setSelectionRange(newPos, newPos)
      }, 0)
    } else {
      setPrompt(prev => prev + (prev && !prev.match(/[,\s]$/) ? ', ' : '') + text)
    }
  }

  // 获取带增强标签的完整提示词
  function getEnhancedPrompt(base) {
    let p = base
    activeStyleTags.forEach((tag) => {
      const found = STYLE_TAGS.find((t) => t.value === tag)
      if (found) p += '\nStyle: ' + found.value
    })
    activeQualityTags.forEach((tag) => {
      const found = QUALITY_TAGS.find((t) => t.value === tag)
      if (found) p += found.value
    })
    return p
  }

  async function handleFilesUpload(rawFiles) {
    if (!rawFiles || !rawFiles.length) return
    setLoadingUpload(true)
    setError('')
    try {
      const fd = new FormData()
      rawFiles.forEach((f) => fd.append('files', f))
      const resp = await fetch('/api/upload', { method: 'POST', body: fd })
      const data = await resp.json()
      if (!data.success) throw new Error(data.message || '上传失败')
      const uploaded = (data.files || []).map((f, idx) => ({
        id: (files.length || 0) + idx + 1,
        filename: f.originalname || f.filename,
        url: f.url,
        isImage: rawFiles[idx]?.type.startsWith('image/'),
        type: rawFiles[idx]?.type.startsWith('image/') ? 'image' : rawFiles[idx]?.type.startsWith('video/') ? 'video' : 'audio',
      }))
      setFiles((prev) => [...prev, ...uploaded])
    } catch (err) {
      setError(err.message || '上传失败，请重试')
    } finally {
      setLoadingUpload(false)
    }
  }

  function handleUploadClick() {
    uploadInputRef.current?.click()
  }

  function handleUploadChange(e) {
    const selected = Array.from(e.target.files || [])
    if (!selected.length) return
    handleFilesUpload(selected)
    e.target.value = ''
  }

  function buildApiPrompt() {
    const enhanced = getEnhancedPrompt(prompt)
    const imageFiles = files.filter((f) => f.isImage)
    const imageUrls = imageFiles.map((f) => f.url)
    return { apiPrompt: enhanced, referenceImages: imageUrls }
  }

  async function fetchHistory(reset = false) {
    if (reset) {
      setLoadingHistory(true)
      setHistoryPage(1)
    }
    try {
      const params = new URLSearchParams({
        page: reset ? 1 : historyPage,
        pageSize: historyPageSize,
      })
      if (showFavoritesOnly) params.set('favorite', 'true')
      if (historySearch) params.set('search', historySearch)
      if (historyDateFrom) params.set('dateFrom', historyDateFrom)
      if (historyDateTo) params.set('dateTo', historyDateTo)
      const resp = await fetch(`/api/history?${params}`)
      const data = await resp.json()
      if (data.success) {
        const newItems = data.data || []
        setHistory(newItems)
        setHistoryTotal(data.pagination?.total || 0)
        setHistoryTotalPages(data.pagination?.totalPages || 0)
        if (reset) setHistoryPage(1)
      }
    } catch (_) {}
    if (reset) setLoadingHistory(false)
  }

  // 监听筛选条件变化
  useEffect(() => {
    fetchHistory(true)
  }, [showFavoritesOnly, historySearch, historyDateFrom, historyDateTo, historyPageSize])

  // 翻页时重新加载
  useEffect(() => {
    if (historyPage > 1) fetchHistory(false)
  }, [historyPage])

  async function handleDeleteHistory(id) {
    if (!confirm('确定要删除这条记录吗？')) return
    try {
      const resp = await fetch(`/api/history/${id}`, { method: 'DELETE' })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      if (!data.success) throw new Error(data.message || '删除失败')
      setHistory((prev) => prev.filter((h) => h.id !== id))
    } catch (err) {
      setError(err.message || '删除失败')
    }
  }

  // 切换收藏状态
  async function handleToggleFavorite(id) {
    try {
      const resp = await fetch(`/api/history/${id}/favorite`, { method: 'PATCH' })
      const data = await resp.json()
      if (data.success) {
        setHistory((prev) =>
          prev.map((h) => h.id === id ? { ...h, favorite: data.data.favorite } : h)
        )
      }
    } catch (err) {
      console.error('收藏失败:', err)
    }
  }

  // 提交反馈
  async function handleFeedback(id, feedback) {
    try {
      const resp = await fetch(`/api/history/${id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback }),
      })
      const data = await resp.json()
      if (data.success) {
        setHistory((prev) =>
          prev.map((h) => h.id === id ? { ...h, feedback: data.data.feedback } : h)
        )
      }
    } catch (err) {
      console.error('反馈失败:', err)
    }
  }

  // 保存为风格画像 — 打开自定义弹窗
  function handleSaveAsStyle(item) {
    setStyleModal({
      show: true,
      item,
      name: item.originalPrompt?.slice(0, 30) || '未命名风格',
      tags: '',
    })
  }

  async function confirmSaveStyle() {
    const { item, name, tags } = styleModal
    if (!name.trim()) return
    try {
      const resp = await fetch('/api/style-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          historyId: item.id,
          name: name.trim(),
          description: `从 ${item.modelName || 'AI'} 生成记录创建`,
          tags: tags.split(/[,，]/).map(t => t.trim()).filter(Boolean),
        }),
      })
      const data = await resp.json()
      if (data.success) {
        setStyleModal({ show: false, item: null, name: '', tags: '' })
        fetchStyleProfiles()
      } else {
        alert('保存失败: ' + data.message)
      }
    } catch (err) {
      alert('保存失败: ' + err.message)
    }
  }

  function startProgress(taskId) {
    if (progressTimersRef.current[taskId]) clearInterval(progressTimersRef.current[taskId])
    setActiveTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, progress: 0 } : t))
    const ESTIMATED = 120000
    const startedAt = Date.now()
    progressTimersRef.current[taskId] = setInterval(() => {
      const elapsed = Date.now() - startedAt
      const estimated = Math.min(99, Math.round((elapsed / ESTIMATED) * 100))
      setActiveTasks((prev) => prev.map((t) => {
        if (t.id === taskId) return { ...t, progress: estimated > t.progress ? estimated : t.progress }
        return t
      }))
    }, 500)
  }

  function stopProgress(taskId, isSuccess = false) {
    if (progressTimersRef.current[taskId]) {
      clearInterval(progressTimersRef.current[taskId])
      delete progressTimersRef.current[taskId]
    }
    setActiveTasks((prev) => prev.map((t) => {
      if (t.id !== taskId) return t
      return { ...t, progress: isSuccess ? 100 : 0, status: isSuccess ? 'completed' : 'failed' }
    }))
  }

  function handleDownload(url) {
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = `aihub-${new Date().toISOString().replace(/[:.]/g, '-')}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  async function handleGenerate() {
    if (!prompt.trim()) { setError('请先输入提示词'); return }
    setError('')
    const { apiPrompt, referenceImages } = buildApiPrompt()
    const taskId = nextTaskId
    setNextTaskId((prev) => prev + 1)
    const newTask = { id: taskId, prompt, aspectRatio, model: selectedModel, progress: 0, status: 'generating', createdAt: new Date() }
    setActiveTasks((prev) => [...prev, newTask])
    startProgress(taskId)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 31 * 60 * 1000)
    try {
      const resp = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalPrompt: prompt, apiPrompt, model: selectedModel, aspectRatio, imageSize, images: referenceImages, styleProfileId: styleProfileId || undefined }),
        signal: controller.signal,
      })
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}))
        const msg = errData.message || `HTTP ${resp.status}`
        if (resp.status === 402) {
          setError('积分不足，无法生成图片')
        } else {
          setError(msg)
        }
        throw new Error(msg)
      }
      const data = await resp.json()
      if (!data.success) throw new Error(data.message || '生成失败')
      const imageUrl = data.data?.imageUrl || ''
      completedResultUrlsRef.current[taskId] = imageUrl
      setResultImage(imageUrl)
      stopProgress(taskId, true)
      recordPreferences(selectedModel, aspectRatio, imageSize, styleProfileId)
      // 生成成功后，从 activeTasks 移除（它已经在历史记录里了，避免重复显示）
      setActiveTasks((prev) => prev.filter((t) => t.id !== taskId))
      await fetchHistory(true)
    } catch (err) {
      let msg = err.message || '生成出错'
      if (err.name === 'AbortError') msg = '请求超时'
      setActiveTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: 'failed', error: msg } : t))
      setError(msg)
      stopProgress(taskId, false)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  useEffect(() => {
    return () => {
      Object.values(progressTimersRef.current).forEach((id) => clearInterval(id))
    }
  }, [])

  const isGptImage2 = selectedModel === 'gpt-image-2' || selectedModel === 'gpt-image-2-vip'
  const aspectRatios = isGptImage2 ? GPT_ASPECT_RATIOS : NANO_ASPECT_RATIOS

  return (
    <>
      <div className="config-panel">
        <div className="panel-title">AI 图片生成 · 自由创作</div>

        <div className="section-label">选择 API 提供商</div>
        <div className="provider-tabs">
          <button type="button" className="provider-tab active">GRSai</button>
        </div>

        <div className="section-label">选择模型</div>
        <div className="model-grid">
          <div className={`model-card ${selectedModel === 'gpt-image-2' ? 'active' : ''}`} onClick={() => { setSelectedModel('gpt-image-2'); setImageSize('1K'); }}>
            GPT-Image 2<br /><span className="model-sub">支持比例</span>
          </div>
          <div className={`model-card ${selectedModel === 'gpt-image-2-vip' ? 'active' : ''}`} onClick={() => { setSelectedModel('gpt-image-2-vip'); setImageSize('1K'); }}>
            GPT-Image 2 VIP<br /><span className="model-sub">支持 1K/2K/4K</span>
          </div>
          <div className={`model-card ${selectedModel === 'nano-banana-pro' ? 'active' : ''}`} onClick={() => { setSelectedModel('nano-banana-pro'); setImageSize('1K'); }}>
            Nano Banana Pro<br /><span className="model-sub">基础绘图</span>
          </div>
          <div className={`model-card ${selectedModel === 'nano-banana-2' ? 'active' : ''}`} onClick={() => { setSelectedModel('nano-banana-2'); setImageSize('1K'); }}>
            Nano Banana 2<br /><span className="model-sub">进阶绘图</span>
          </div>
        </div>

        {styleProfiles.length > 0 && (
          <>
            <div className="section-label">风格画像 (可选)</div>
            <select className="input-field" value={styleProfileId} onChange={e => setStyleProfileId(e.target.value)}>
              <option value="">不使用风格画像</option>
              {styleProfiles.map(sp => (
                <option key={sp.id} value={sp.id}>{sp.name} (使用 {sp.usageCount || 0} 次)</option>
              ))}
            </select>
          </>
        )}

        <div className="section-label">绘画描述 (Prompt)</div>

        {/* 提示词优化工具条 */}
        <div className="prompt-enhance-bar">
          <div className="prompt-enhance-tags">
            {STYLE_TAGS.map((tag) => (
              <button
                key={tag.value}
                type="button"
                className={`prompt-enhance-tag ${activeStyleTags.includes(tag.value) ? 'active' : ''}`}
                onClick={() => toggleStyleTag(tag.value)}
              >
                <span className="tag-prefix">#</span>{tag.label}
              </button>
            ))}
          </div>
          <div className="prompt-quality-tags">
            {QUALITY_TAGS.map((tag) => (
              <button
                key={tag.value}
                type="button"
                className={`prompt-quality-tag ${activeQualityTags.includes(tag.value) ? 'active' : ''}`}
                onClick={() => toggleQualityTag(tag.value)}
              >
                {tag.label}
              </button>
            ))}
          </div>
        </div>

        <div className="prompt-mention-wrapper">
          <textarea
            ref={promptRef}
            className="prompt-box"
            placeholder="输入绘画描述词，支持 Ctrl+Enter 快捷生成...&#10;使用 @1, @2 引用下方参考图"
            value={prompt}
            onChange={handlePromptChange}
            onBlur={() => setMentionState((prev) => ({ ...prev, visible: false }))}
          />
          {mentionState.visible && !!files.length && (
            <div className="mention-dropdown">
              {files.map((f) => (
                <button key={f.id} type="button" className="mention-item" onMouseDown={(e) => { e.preventDefault(); handleSelectMention(f.id) }}>
                  <div className="mention-thumb"><img src={f.url} alt={f.filename} /></div>
                  <div className="mention-text">
                    <div className="mention-title">@{f.id}</div>
                    <div className="mention-sub">{f.filename || '参考图'}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 提示词快捷库按钮 */}
        <button
          type="button"
          className="prompt-library-btn"
          onClick={() => setShowPromptLibrary(true)}
        >
          💡 提示词快捷库
        </button>

        {/* 提示词快捷库弹窗 */}
        {showPromptLibrary && (
          <PromptQuickLibrary
            onInsert={handleInsertPrompt}
            onClose={() => setShowPromptLibrary(false)}
          />
        )}

        <div className="section-label">上传参考图</div>
        <div
          className="upload-area"
          onClick={handleUploadClick}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add('drag-over') }}
          onDragLeave={(e) => {
            e.preventDefault(); e.stopPropagation()
            e.currentTarget.classList.remove('drag-over')
          }}
          onDrop={(e) => {
            e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('drag-over')
            if (loadingUpload) return
            const dropped = Array.from(e.dataTransfer.files || []).filter((f) => f.type.startsWith('image/'))
            if (!dropped.length) { setError('请拖拽图片文件'); return }
            handleFilesUpload(dropped)
          }}
        >
          点击或拖拽图片上传<br />
          <span className="upload-tip">支持 PNG、JPG，10MB 以内</span>
          {loadingUpload && <div className="upload-status">正在上传图片...</div>}
          <input ref={uploadInputRef} type="file" multiple accept="image/*" onChange={handleUploadChange} disabled={loadingUpload} style={{ display: 'none' }} />
        </div>

        {!!files.length && (
          <div className="thumb-list">
            {files.map((f) => (
              <div key={f.id} className="thumb-item">
                <div className="thumb-header">
                  <span>@{f.id}</span>
                  <button type="button" className="thumb-remove" onClick={(e) => { e.stopPropagation(); handleRemoveFile(f.id) }}>×</button>
                </div>
                <img src={f.url} alt={f.filename} />
              </div>
            ))}
          </div>
        )}
        <p className="hint">在描述中使用 <code>@1</code>, <code>@2</code> 来引用对应参考图</p>

        <div className="section-label">生成参数</div>
        <div className="controls-row">
          {(selectedModel === 'gpt-image-2-vip' || selectedModel === 'nano-banana-pro' || selectedModel === 'nano-banana-2') && (
            <div className="control-group">
              <span className="control-label">分辨率</span>
              <select className="select-field" value={imageSize} onChange={(e) => setImageSize(e.target.value)}>
                {NANO_IMAGE_SIZES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          )}
          <div className="control-group">
            <span className="control-label">画幅比例</span>
            <select className="select-field" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
              {aspectRatios.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          {(selectedModel === 'gpt-image-2' || selectedModel === 'gpt-image-2-vip') && (
            <div className="control-group">
              <span className="control-label">质量</span>
              <select className="select-field" value={quality} onChange={(e) => setQuality(e.target.value)}>
                <option value="auto">自动</option>
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
            </div>
          )}
        </div>

        {error && <p className="error-text">{error}</p>}
        <button className="generate-btn" onClick={handleGenerate} type="button">✦ 立即生成 (消耗积分)</button>
      </div>

      <div className="results-panel">
        <div className="tabs">
          <div className={activeTab === 'mine' ? 'tab active' : 'tab'} onClick={() => setActiveTab('mine')}>我的作品</div>
        </div>

        {/* 历史记录工具条 */}
        {activeTab === 'mine' && (
          <div className="history-toolbar">
            <HistoryFilterBar
              search={historySearch}
              onSearchChange={setHistorySearch}
              dateFrom={historyDateFrom}
              onDateFromChange={setHistoryDateFrom}
              dateTo={historyDateTo}
              onDateToChange={setHistoryDateTo}
              page={historyPage}
              totalPages={historyTotalPages}
              onPageChange={setHistoryPage}
              pageSize={historyPageSize}
              onPageSizeChange={(s) => { setHistoryPageSize(s); setHistoryPage(1); }}
              total={historyTotal}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button
                type="button"
                className={`history-view-btn ${showFavoritesOnly ? 'active' : ''}`}
                onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                title={showFavoritesOnly ? "显示全部" : "只看收藏"}
                style={showFavoritesOnly ? { background: 'var(--primary-glow)', color: 'var(--primary-color)' } : {}}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill={showFavoritesOnly ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
              </button>
              <div className="history-view-toggle">
                <button
                  type="button"
                  className={`history-view-btn ${historyView === 'list' ? 'active' : ''}`}
                  onClick={() => setHistoryView('list')}
                  title="列表视图"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                    <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
                  </svg>
                </button>
                <button
                  type="button"
                  className={`history-view-btn ${historyView === 'grid' ? 'active' : ''}`}
                  onClick={() => setHistoryView('grid')}
                  title="网格视图"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                    <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'mine' && (
          <>
            {/* 生成中任务（始终列表展示） */}
            {activeTasks.map((task) => (
              <div key={task.id} className={`result-card generating-card ${task.status === 'failed' ? 'failed-card' : ''}`}>
                <div className="card-header">
                  <span className="tag">{task.model || selectedModel}</span>
                  <div className="card-actions">
                    {task.status === 'generating' && <span className="generating-badge">生成中</span>}
                    {task.status === 'completed' && <span className="generating-badge" style={{ backgroundColor: '#10b981' }}>已完成</span>}
                    {task.status === 'failed' && <span className="generating-badge" style={{ backgroundColor: '#ef4444' }}>失败</span>}
                  </div>
                </div>
                <div className="prompt-text">{task.prompt || '正在生成图片...'}</div>
                <div className="card-meta-row">
                  <span className="meta-item">{task.aspectRatio}</span>
                  <span className="meta-time">{task.createdAt.toLocaleString()}</span>
                </div>
                {task.status === 'generating' && (
                  <div className="generating-progress-area">
                    <div className="generating-progress-wrapper">
                      <div className="generating-progress-circle">
                        <svg className="progress-svg" viewBox="0 0 36 36">
                          <circle className="progress-ring-bg" cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
                          <circle className="progress-ring" cx="18" cy="18" r="16" fill="none" stroke="var(--primary-color)" strokeWidth="2"
                            strokeDasharray={`${2 * Math.PI * 16}`}
                            strokeDashoffset={`${2 * Math.PI * 16 * (1 - task.progress / 100)}`}
                            strokeLinecap="round" transform="rotate(-90 18 18)" />
                        </svg>
                        <div className="progress-text">{task.progress}%</div>
                      </div>
                      <span className="generating-text">正在生成中，请耐心等待...</span>
                    </div>
                  </div>
                )}
                {task.status === 'completed' && (task.resultImageUrl || completedResultUrlsRef.current[task.id]) && (
                  <div className="image-preview-area">
                    <div className="img-placeholder result">
                      <img src={task.resultImageUrl || completedResultUrlsRef.current[task.id]} alt={task.prompt} />
                    </div>
                  </div>
                )}
                {task.status === 'failed' && task.error && <div className="error-text" style={{ marginTop: 10 }}>{task.error}</div>}
              </div>
            ))}

            {loadingHistory && <div className="result-card"><p className="prompt-text">正在加载历史作品...</p></div>}
            {!loadingHistory && !history.length && activeTasks.length === 0 && (
              <div className="result-card"><p className="prompt-text">暂无生成记录，试着先生成一张图像吧。</p></div>
            )}

            {/* 列表视图 */}
            {historyView === 'list' && !!history.length && history.map((item) => (
              <div className="result-card" key={item.id}>
                <div className="card-header">
                  <span className="tag">{item.modelName || 'GRSai'}</span>
                  <div className="card-actions">
                    <button
                      className="btn-outline"
                      type="button"
                      onClick={() => handleToggleFavorite(item.id)}
                      style={item.favorite ? { color: '#f97316', borderColor: '#f97316' } : {}}
                      title={item.favorite ? "取消收藏" : "收藏"}
                    >
                      {item.favorite ? '❤️' : '🤍'}
                    </button>
                    <button className="btn-outline" type="button" onClick={() => handleDownload(item.resultImageUrl)}>⬇ 下载</button>
                    <button className="btn-outline" type="button" onClick={() => { setSelectedItem(item); setResultImage(item.resultImageUrl || '') }}>查看大图</button>
                    <button className="btn-outline" type="button" onClick={() => handleSaveAsStyle(item)} title="保存为风格画像">🎨 存风格</button>
                    <button className="btn-outline" type="button" onClick={() => handleFeedback(item.id, 'like')}
                      style={item.feedback === 'like' ? { color: '#10b981', borderColor: '#10b981' } : {}}>👍</button>
                    <button className="btn-outline" type="button" onClick={() => handleFeedback(item.id, 'dislike')}
                      style={item.feedback === 'dislike' ? { color: '#ef4444', borderColor: '#ef4444' } : {}}>👎</button>
                    <button className="btn-outline" type="button" onClick={() => handleDeleteHistory(item.id)} style={{ color: '#ef4444', borderColor: '#ef4444' }}>🗑 删除</button>
                  </div>
                </div>
                <div className="prompt-text">{item.originalPrompt}</div>
                <div className="card-meta-row">
                  <span className="meta-item">{item.aspectRatio || item.imageSize || '-'}</span>
                  {item.createdAt && <span className="meta-time">{new Date(item.createdAt).toLocaleString()}</span>}
                </div>
                <div className="image-preview-area">
                  {item.resultImageUrl ? (
                    <div className="img-placeholder result"><img src={item.resultImageUrl} alt={item.originalPrompt} /></div>
                  ) : (
                    <div className="img-placeholder result">暂无生成结果</div>
                  )}
                </div>
              </div>
            ))}

            {/* 网格视图 */}
            {historyView === 'grid' && !!history.length && (
              <div className="history-grid">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="history-grid-item"
                    onClick={() => { setSelectedItem(item); setResultImage(item.resultImageUrl || '') }}
                  >
                    <div className="history-grid-thumb">
                      {item.resultImageUrl ? (
                        <img src={item.resultImageUrl} alt={item.originalPrompt} />
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 12 }}>暂无预览</div>
                      )}
                    </div>
                    <div className="history-grid-info">
                      <div className="history-grid-meta">
                        <span>{item.aspectRatio || item.imageSize || '-'}</span>
                        {item.createdAt && <span>{new Date(item.createdAt).toLocaleDateString()}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

          </>
        )}

        {/* 隐藏"最近一次生成"，因为历史记录第一条就是最新的
        {resultImage && (
          <div className="result-card" style={{ marginTop: 16 }}>
            <div className="card-header">
              <span className="tag">最近一次生成</span>
              <button className="btn-outline" type="button" onClick={() => handleDownload(resultImage)}>⬇ 下载当前图</button>
            </div>
            <div className="image-preview-area">
              <div className="img-placeholder result"><img src={resultImage} alt="最近一次生成" /></div>
            </div>
          </div>
        )}
        */}
      </div>

      {selectedItem && (
        <div className="modal-backdrop" onClick={() => setSelectedItem(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>作品详情</h3>
              <button className="btn-outline small" type="button" onClick={() => setSelectedItem(null)}>关闭</button>
            </div>
            <p className="modal-prompt">{selectedItem.originalPrompt}</p>
            <p className="modal-meta">
              {selectedItem.modelName && <span>模型：{selectedItem.modelName}　</span>}
              {selectedItem.aspectRatio || selectedItem.imageSize || '-'}
              {selectedItem.createdAt && <span className="modal-time">（{new Date(selectedItem.createdAt).toLocaleString()}）</span>}
            </p>
            {selectedItem.resultImageUrl && (
              <div className="modal-image"><img src={selectedItem.resultImageUrl} alt={selectedItem.originalPrompt} /></div>
            )}
          </div>
        </div>
      )}

      {styleModal.show && (
        <div className="modal-backdrop" onClick={() => setStyleModal({ show: false, item: null, name: '', tags: '' })}>
          <div className="modal-content save-style-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span style={{ fontWeight: 600, fontSize: 15 }}>保存为风格画像</span>
              <button
                className="btn-outline small"
                type="button"
                onClick={() => setStyleModal({ show: false, item: null, name: '', tags: '' })}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            {styleModal.item?.resultImageUrl && (
              <div style={{ marginBottom: 16, borderRadius: 8, overflow: 'hidden', maxHeight: 200 }}>
                <img
                  src={styleModal.item.resultImageUrl}
                  alt="风格参考"
                  style={{ width: '100%', height: 'auto', objectFit: 'cover', objectPosition: 'center' }}
                />
              </div>
            )}

            <div className="section-label">风格名称 *</div>
            <input
              className="input-field"
              value={styleModal.name}
              onChange={(e) => setStyleModal((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="例如：2025春季新品海报风"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') confirmSaveStyle() }}
            />

            <div className="section-label">标签（逗号分隔）</div>
            <input
              className="input-field"
              value={styleModal.tags}
              onChange={(e) => setStyleModal((prev) => ({ ...prev, tags: e.target.value }))}
              placeholder="例如：海报, 春季, 产品"
            />

            {styleModal.item && (
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-secondary)', padding: '8px 12px', borderRadius: 6, maxHeight: 80, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>原始 Prompt：</span>
                {styleModal.item.originalPrompt?.slice(0, 200) || '无'}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button
                className="btn-outline"
                style={{ flex: 1 }}
                onClick={() => setStyleModal({ show: false, item: null, name: '', tags: '' })}
              >
                取消
              </button>
              <button
                className="generate-btn"
                style={{ flex: 1 }}
                onClick={confirmSaveStyle}
              >
                保存风格
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default ImageFreePanel
