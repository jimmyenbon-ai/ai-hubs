import { useEffect, useRef, useState } from 'react'
import './App.css'
import HistoryFilterBar from './HistoryFilterBar'

// 生成模式常量
const GENERATION_MODE = {
  TEXT_TO_VIDEO: 'text_to_video',
  IMAGE_TO_VIDEO_FIRST: 'image_to_video_first',
  IMAGE_TO_VIDEO_FIRST_LAST: 'image_to_video_first_last',
  MULTIMODAL_REFERENCE: 'multimodal_reference',
}

const MODE_LABELS = {
  [GENERATION_MODE.TEXT_TO_VIDEO]: '文生视频',
  [GENERATION_MODE.IMAGE_TO_VIDEO_FIRST]: '图生视频-首帧',
  [GENERATION_MODE.IMAGE_TO_VIDEO_FIRST_LAST]: '图生视频-首尾帧',
  [GENERATION_MODE.MULTIMODAL_REFERENCE]: '多模态参考',
}

const MODE_DESCRIPTIONS = {
  [GENERATION_MODE.TEXT_TO_VIDEO]: '仅输入文本提示词生成视频',
  [GENERATION_MODE.IMAGE_TO_VIDEO_FIRST]: '上传首帧图片，AI 延展生成视频',
  [GENERATION_MODE.IMAGE_TO_VIDEO_FIRST_LAST]: '上传首帧和尾帧图片，AI 生成过渡视频',
  [GENERATION_MODE.MULTIMODAL_REFERENCE]: '上传图片/视频/音频素材，在提示词中用 @1 @2 引用',
}

// 素材类型
const MEDIA_TYPE = {
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'audio',
}

const MEDIA_TYPE_LABELS = {
  [MEDIA_TYPE.IMAGE]: '图',
  [MEDIA_TYPE.VIDEO]: '视频',
  [MEDIA_TYPE.AUDIO]: '音频',
}

function VideoGenerate() {
  const [generationMode, setGenerationMode] = useState(GENERATION_MODE.TEXT_TO_VIDEO)
  const [selectedModel, setSelectedModel] = useState('doubao-seedance-2-0-260128')
  const [prompt, setPrompt] = useState('')
  const [resolution, setResolution] = useState('720p')
  const [ratio, setRatio] = useState('16:9')
  const [duration, setDuration] = useState(5)
  const [seed, setSeed] = useState(-1)
  const [generateAudio, setGenerateAudio] = useState(true)
  const [watermark, setWatermark] = useState(false)

  // 统一素材列表
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [loadingUpload, setLoadingUpload] = useState(false)
  const uploadInputRef = useRef(null)
  const promptRef = useRef(null)

  const [error, setError] = useState('')
  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyPageSize, setHistoryPageSize] = useState(20)
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyTotalPages, setHistoryTotalPages] = useState(0)
  const [historySearch, setHistorySearch] = useState('')
  const [historyDateFrom, setHistoryDateFrom] = useState('')
  const [historyDateTo, setHistoryDateTo] = useState('')
  const [activeTasks, setActiveTasks] = useState([])
  const [nextTaskId, setNextTaskId] = useState(1)
  const [playingVideo, setPlayingVideo] = useState(null)
  const videoRef = useRef(null)

  // @ 引用下拉提示
  const [mentionState, setMentionState] = useState({
    visible: false,
    startIndex: 0,
  })

  // 上传进度相关状态
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadProgressText, setUploadProgressText] = useState('')
  const pollQueueRef = useRef(new Set())
  const pollHandlersRef = useRef({})
  const pollInFlightRef = useRef(new Set())
  const pollTimerRef = useRef(null)
  const pollBackoffMsRef = useRef(5000)
  const pollDeadlineRef = useRef({})
  const historyFetchDebounceRef = useRef(null)

  useEffect(() => {
    fetchVideoHistory()
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
      if (historyFetchDebounceRef.current) clearTimeout(historyFetchDebounceRef.current)
      if (videoRef.current) {
        videoRef.current.pause()
        videoRef.current = null
      }
    }
  }, [])

  function debounceFetchVideoHistory(pageOverride) {
    if (historyFetchDebounceRef.current) clearTimeout(historyFetchDebounceRef.current)
    historyFetchDebounceRef.current = setTimeout(() => {
      fetchVideoHistory(pageOverride)
    }, 800)
  }

  // 筛选条件变化时重新加载
  useEffect(() => {
    fetchVideoHistory(1)
  }, [historySearch, historyDateFrom, historyDateTo, historyPageSize])

  useEffect(() => {
    if (historyPage > 1) fetchVideoHistory(historyPage)
  }, [historyPage])

  async function queryVideoTaskOnce(taskId) {
    const resp = await fetch(`/api/video/query/${taskId}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    })
    if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({ message: `HTTP错误: ${resp.status}` }))
      throw new Error(errorData.message || `请求失败: ${resp.status}`)
    }
    const data = await resp.json()
    if (!data.success) throw new Error(data.message || '查询失败')
    return data.data || {}
  }

  function schedulePollTick() {
    if (pollTimerRef.current) return
    const delay = Math.max(1500, pollBackoffMsRef.current || 5000)
    pollTimerRef.current = setTimeout(async () => {
      pollTimerRef.current = null

      if (typeof document !== 'undefined' && document.hidden) {
        schedulePollTick()
        return
      }

      const now = Date.now()
      const pending = Array.from(pollQueueRef.current)
        .filter((id) => !pollInFlightRef.current.has(id))
        .filter((id) => {
          const deadlineAt = pollDeadlineRef.current[id]
          if (deadlineAt && now > deadlineAt) {
            pollQueueRef.current.delete(id)
            delete pollHandlersRef.current[id]
            delete pollDeadlineRef.current[id]
            return false
          }
          return true
        })

      const batch = pending.slice(0, 2)
      if (batch.length === 0) {
        return
      }

      await Promise.all(
        batch.map(async (taskId) => {
          pollInFlightRef.current.add(taskId)
          try {
            const result = await queryVideoTaskOnce(taskId)
            if (result.status === 'succeeded' && result.videoUrl) {
              const handlers = pollHandlersRef.current[taskId] || []
              handlers.forEach((fn) => {
                try {
                  fn({ taskId, result })
                } catch (_) {
                  // ignore
                }
              })
              pollQueueRef.current.delete(taskId)
              delete pollHandlersRef.current[taskId]
              delete pollDeadlineRef.current[taskId]
              pollBackoffMsRef.current = 5000
            } else if (result.status === 'failed') {
              const handlers = pollHandlersRef.current[taskId] || []
              handlers.forEach((fn) => {
                try {
                  fn({ taskId, result, failed: true })
                } catch (_) {
                  // ignore
                }
              })
              pollQueueRef.current.delete(taskId)
              delete pollHandlersRef.current[taskId]
              delete pollDeadlineRef.current[taskId]
            }
          } catch (err) {
            const msg = err?.message || ''
            if (/429|Too Many Requests/i.test(msg)) {
              pollBackoffMsRef.current = Math.min(60000, (pollBackoffMsRef.current || 5000) * 2)
            }
          } finally {
            pollInFlightRef.current.delete(taskId)
          }
        })
      )

      schedulePollTick()
    }, delay)
  }

  function enqueuePolling(taskId, { deadlineAt, onReady, onFailed }) {
    if (!taskId) return

    pollQueueRef.current.add(taskId)
    pollDeadlineRef.current[taskId] = deadlineAt
    if (!pollHandlersRef.current[taskId]) pollHandlersRef.current[taskId] = []
    if (typeof onReady === 'function') pollHandlersRef.current[taskId].push(onReady)
    if (typeof onFailed === 'function') pollHandlersRef.current[taskId].push((data) => onFailed(data))

    schedulePollTick()
  }

  function startQueryForTaskId(localTaskId, taskId) {
    if (!taskId) return

    const deadlineAt = Date.now() + 15 * 60 * 1000
    enqueuePolling(taskId, {
      deadlineAt,
      onReady: ({ result }) => {
        setActiveTasks((prev) =>
          prev.map((t) => {
            if (t.id !== localTaskId) return t
            return {
              ...t,
              status: 'ready',
              videoUrl: result.videoUrl,
              lastFrameUrl: result.lastFrameUrl,
              progress: 100,
            }
          })
        )
        debounceFetchVideoHistory()
      },
      onFailed: ({ result }) => {
        setActiveTasks((prev) =>
          prev.map((t) => {
            if (t.id !== localTaskId) return t
            return {
              ...t,
              status: 'failed',
              error: result.error?.message || '视频生成失败',
            }
          })
        )
        debounceFetchVideoHistory()
      },
    })

    setTimeout(() => {
      setActiveTasks((prev) =>
        prev.map((t) =>
          t.id === localTaskId && t.status !== 'ready'
            ? { ...t, status: 'failed', error: '查询超时，请稍后在历史记录里查看' }
            : t
        )
      )
    }, 15 * 60 * 1000 + 1000)
  }

  // 处理文件上传
  // 处理文件上传（带进度条）
  function handleFilesUpload(selectedFiles) {
    if (!selectedFiles || selectedFiles.length === 0) return
    setError('')
    setLoadingUpload(true)
    setUploadProgress(0)
    setUploadProgressText('准备上传...')

    const totalFiles = selectedFiles.length
    let completedFiles = 0

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      const formData = new FormData()
      selectedFiles.forEach((file) => formData.append('files', file))

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const filePercent = Math.round((e.loaded / e.total) * 100)
          const overallPercent = Math.round(
            ((completedFiles / totalFiles) * 100 + filePercent / totalFiles),
          )
          setUploadProgress(overallPercent)
          const sizeMb = (e.loaded / 1024 / 1024).toFixed(1)
          const totalMb = (e.total / 1024 / 1024).toFixed(1)
          setUploadProgressText(`正在上传 ${completedFiles + 1}/${totalFiles} 个文件 ${sizeMb}/${totalMb} MB (${filePercent}%)`)
        }
      }

      xhr.upload.onload = () => {
        completedFiles++
        if (completedFiles < totalFiles) {
          setUploadProgress(0)
          setUploadProgressText(`已上传 ${completedFiles}/${totalFiles}，继续下一个...`)
        }
      }

      xhr.onloadend = () => {
        setUploadProgress(100)
      }

      xhr.onerror = () => {
        setLoadingUpload(false)
        setUploadProgress(0)
        setUploadProgressText('')
        setError('上传失败，请检查网络')
        reject(new Error('上传失败'))
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText)
            if (!data.success) throw new Error(data.message || '上传失败')

            const newFiles = (data.files || []).map((file, idx) => {
              const ext = file.filename?.toLowerCase() || ''
              let type = MEDIA_TYPE.IMAGE
              if (ext.match(/\.(mp4|webm|mov|avi|mkv)$/)) {
                type = MEDIA_TYPE.VIDEO
              } else if (ext.match(/\.(mp3|wav|ogg|aac|m4a|flac)$/)) {
                type = MEDIA_TYPE.AUDIO
              }
              return {
                id: uploadedFiles.length + idx + 1,
                url: file.url,
                filename: file.filename,
                type,
              }
            })

            setUploadedFiles((prev) => [...prev, ...newFiles])
            setLoadingUpload(false)
            setUploadProgress(100)
            setUploadProgressText('上传完成')
            setTimeout(() => {
              setUploadProgress(0)
              setUploadProgressText('')
            }, 2000)
            resolve(data)
          } catch (e) {
            setLoadingUpload(false)
            setUploadProgress(0)
            setUploadProgressText('')
            setError(e.message || '解析响应失败')
            reject(e)
          }
        } else {
          let msg = `上传失败: HTTP ${xhr.status}`
          try {
            const data = JSON.parse(xhr.responseText)
            if (data.message) msg = data.message
          } catch (_) {}
          setLoadingUpload(false)
          setUploadProgress(0)
          setUploadProgressText('')
          setError(msg)
          reject(new Error(msg))
        }
      }

      xhr.open('POST', '/api/upload')
      xhr.send(formData)
    })
  }

  async function handleUploadChange(e) {
    const selected = Array.from(e.target.files || [])
    if (!selected.length) return
    try {
      await handleFilesUpload(selected)
    } catch (_) {}
    e.target.value = ''
  }

  function handleUploadClick() {
    if (loadingUpload) return
    uploadInputRef.current?.click()
  }

  function handleRemoveFile(fileId) {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== fileId))
  }

  // 处理提示词中的 @ 引用
  function handlePromptChange(e) {
    const value = e.target.value
    setPrompt(value)

    const caret = e.target.selectionStart ?? value.length
    const beforeCaret = value.slice(0, caret)
    const match = beforeCaret.match(/@(\d*)$/)

    if (match && uploadedFiles.length) {
      setMentionState({
        visible: true,
        startIndex: caret - match[0].length,
      })
    } else if (mentionState.visible) {
      setMentionState((prev) => ({ ...prev, visible: false }))
    }
  }

  function handleSelectMention(fileId) {
    const replacement = `@${fileId} `
    setPrompt((prev) => {
      const { startIndex } = mentionState
      if (startIndex == null) return prev
      const next = prev.slice(0, startIndex) + replacement + prev.slice(startIndex + replacement.length - 1)
      return next
    })
    setMentionState((prev) => ({ ...prev, visible: false }))
    promptRef.current?.focus()
  }

  // 解析提示词中的 @ 引用，构建 API 请求
  function buildApiContent() {
    const refsMap = new Map(uploadedFiles.map((f) => [String(f.id), f]))
    const content = []

    // 先添加 @ 引用的素材
    const usedRefs = new Set()
    const promptWithRefs = prompt.replace(/@(\d+)/g, (match, p1) => {
      if (refsMap.has(p1)) {
        usedRefs.add(p1)
      }
      return match
    })

    // 按顺序添加引用的素材
    const refOrder = []
    prompt.replace(/@(\d+)/g, (match, p1) => {
      if (refsMap.has(p1) && !refOrder.includes(p1)) {
        refOrder.push(p1)
      }
      return match
    })

    refOrder.forEach((id) => {
      const file = refsMap.get(id)
      if (!file) return

      if (file.type === MEDIA_TYPE.IMAGE) {
        content.push({
          type: 'image_url',
          image_url: { url: file.url },
          role: 'reference_image',
        })
      } else if (file.type === MEDIA_TYPE.VIDEO) {
        content.push({
          type: 'video_url',
          video_url: { url: file.url },
          role: 'reference_video',
        })
      } else if (file.type === MEDIA_TYPE.AUDIO) {
        content.push({
          type: 'audio_url',
          audio_url: { url: file.url },
          role: 'reference_audio',
        })
      }
    })

    // 添加纯文本（去掉 @ 引用标记）
    const cleanPrompt = prompt.replace(/@(\d+)/g, '').trim()
    if (cleanPrompt) {
      content.push({
        type: 'text',
        text: cleanPrompt,
      })
    }

    return content
  }

  async function fetchVideoHistory(pageOverride) {
    setLoadingHistory(true)
    try {
      const p = pageOverride || historyPage
      const params = new URLSearchParams({
        page: String(p),
        pageSize: String(historyPageSize),
      })
      if (historySearch) params.set('search', historySearch)
      if (historyDateFrom) params.set('dateFrom', historyDateFrom)
      if (historyDateTo) params.set('dateTo', historyDateTo)
      const resp = await fetch(`/api/video/history?${params}`)
      const data = await resp.json()
      if (!data.success) {
        throw new Error(data.message || '获取历史记录失败')
      }
      const historyItems = data.data || []
      setHistory(historyItems)
      setHistoryTotal(data.pagination?.total || 0)
      setHistoryTotalPages(data.pagination?.totalPages || 0)

      historyItems.forEach((item) => {
        if (item.task_id && (item.status === 'queued' || item.status === 'running')) {
          const deadlineAt = Date.now() + 15 * 60 * 1000
          enqueuePolling(item.task_id, {
            deadlineAt,
            onReady: () => debounceFetchVideoHistory(),
            onFailed: () => debounceFetchVideoHistory(),
          })
        }
      })
    } catch (err) {
      console.error('加载历史记录失败:', err)
    } finally {
      setLoadingHistory(false)
    }
  }

  async function handleDeleteHistory(id) {
    if (!confirm('确定要删除这条记录吗？')) return
    try {
      await fetch(`/api/video/history/${id}`, { method: 'DELETE' })
      await fetchVideoHistory()
    } catch (err) {
      setError(err.message || '删除失败')
    }
  }

  function handlePlayVideo(url, taskId) {
    if (playingVideo === url) {
      if (videoRef.current) {
        videoRef.current.pause()
        videoRef.current = null
      }
      setPlayingVideo(null)
      return
    }

    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current = null
    }

    const video = document.createElement('video')
    video.src = url
    video.controls = true
    video.style.maxWidth = '100%'
    videoRef.current = video
    setPlayingVideo(url)

    const container = document.getElementById(`video-player-${taskId}`)
    if (container) {
      container.innerHTML = ''
      container.appendChild(video)
    }
  }

  function handleDownload(url, filename = 'video') {
    if (!url) return
    try {
      const a = document.createElement('a')
      a.href = url
      a.download = `${filename}.mp4`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch (e) {
      console.error('下载失败', e)
    }
  }

  async function handleGenerate() {
    if (generationMode === GENERATION_MODE.TEXT_TO_VIDEO && !prompt.trim()) {
      setError('请输入视频描述词')
      return
    }

    // 多模态模式至少需要一个素材或提示词
    if (generationMode === GENERATION_MODE.MULTIMODAL_REFERENCE && !prompt.trim() && uploadedFiles.length === 0) {
      setError('请上传素材或输入提示词')
      return
    }

    setError('')

    const taskId = nextTaskId
    setNextTaskId((prev) => prev + 1)

    const newTask = {
      id: taskId,
      mode: generationMode,
      model: selectedModel,
      prompt,
      progress: 0,
      status: 'generating',
      createdAt: new Date(),
    }

    setActiveTasks((prev) => [...prev, newTask])

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 6 * 60 * 1000)

    try {
      let body = {
        mode: generationMode,
        model: selectedModel,
        resolution,
        ratio,
        duration: parseInt(duration, 10),
        seed: seed === -1 ? undefined : parseInt(seed, 10),
        generate_audio: generateAudio,
        watermark,
      }

      // 根据模式构建内容
      if (generationMode === GENERATION_MODE.MULTIMODAL_REFERENCE) {
        // 多模态模式：使用 @ 引用解析
        body.content = buildApiContent()
        body.prompt = prompt // 同时传递原始提示词
      } else if (generationMode === GENERATION_MODE.TEXT_TO_VIDEO) {
        // 文生视频
        body.content = [{ type: 'text', text: prompt }]
      } else {
        // 图生视频模式
        body.content = []
        if (prompt.trim()) {
          body.content.push({ type: 'text', text: prompt })
        }
      }

      const resp = await fetch('/api/video/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({ message: `HTTP错误: ${resp.status}` }))
        throw new Error(errorData.message || `请求失败: ${resp.status}`)
      }

      const data = await resp.json()
      if (!data.success) {
        throw new Error(data.message || '生成失败')
      }

      const taskIdFromServer = data.data?.taskId

      setActiveTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, status: 'submitted', taskId: taskIdFromServer, progress: 10 }
            : t
        )
      )

      if (taskIdFromServer) {
        startQueryForTaskId(taskId, taskIdFromServer)
      }

      await fetchVideoHistory()
    } catch (err) {
      let errorMessage = err.message || '生成出错'
      if (err.name === 'AbortError') {
        errorMessage = '请求超时，请检查网络连接或稍后重试'
      }

      setActiveTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, status: 'failed', error: errorMessage } : t
        )
      )
      setError(errorMessage)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  const isMultimodalMode = generationMode === GENERATION_MODE.MULTIMODAL_REFERENCE
  const isImageMode = generationMode === GENERATION_MODE.IMAGE_TO_VIDEO_FIRST ||
                     generationMode === GENERATION_MODE.IMAGE_TO_VIDEO_FIRST_LAST
  const [activeParamTab, setActiveParamTab] = useState('basic')

  function resetFiles() {
    setUploadedFiles([])
    setPrompt('')
  }

  return (
    <div className="workspace">
      <div className="config-panel">
        <div className="panel-title">
          <span style={{ cursor: 'pointer' }}>&larr;</span> 工具箱 - Seedance 2.0 视频生成
        </div>

        {/* 生成模式选择 */}
        <div className="section-label">生成模式</div>
        <div className="mode-tabs">
          <button
            type="button"
            className={`mode-tab ${generationMode === GENERATION_MODE.TEXT_TO_VIDEO ? 'active' : ''}`}
            onClick={() => { setGenerationMode(GENERATION_MODE.TEXT_TO_VIDEO); resetFiles(); }}
          >
            文生视频
          </button>
          <button
            type="button"
            className={`mode-tab ${generationMode === GENERATION_MODE.IMAGE_TO_VIDEO_FIRST ? 'active' : ''}`}
            onClick={() => { setGenerationMode(GENERATION_MODE.IMAGE_TO_VIDEO_FIRST); resetFiles(); }}
          >
            首帧
          </button>
          <button
            type="button"
            className={`mode-tab ${generationMode === GENERATION_MODE.IMAGE_TO_VIDEO_FIRST_LAST ? 'active' : ''}`}
            onClick={() => { setGenerationMode(GENERATION_MODE.IMAGE_TO_VIDEO_FIRST_LAST); resetFiles(); }}
          >
            首尾帧
          </button>
          <button
            type="button"
            className={`mode-tab ${generationMode === GENERATION_MODE.MULTIMODAL_REFERENCE ? 'active' : ''}`}
            onClick={() => { setGenerationMode(GENERATION_MODE.MULTIMODAL_REFERENCE); resetFiles(); }}
          >
            多模态
          </button>
        </div>
        <p className="hint">{MODE_DESCRIPTIONS[generationMode]}</p>

        {/* 模型选择 */}
        <div className="section-label">视频模型</div>
        <div className="model-tabs">
          <button
            type="button"
            className={`model-tab ${selectedModel === 'doubao-seedance-2-0-260128' ? 'active' : ''}`}
            onClick={() => setSelectedModel('doubao-seedance-2-0-260128')}
          >
            Seedance 2.0
          </button>
          <button
            type="button"
            className={`model-tab ${selectedModel === 'doubao-seedance-2-0-fast-260128' ? 'active' : ''}`}
            onClick={() => setSelectedModel('doubao-seedance-2-0-fast-260128')}
          >
            2.0 fast
          </button>
          <button
            type="button"
            className={`model-tab ${selectedModel === 'doubao-seedance-1-5-pro-251215' ? 'active' : ''}`}
            onClick={() => setSelectedModel('doubao-seedance-1-5-pro-251215')}
          >
            1.5 pro
          </button>
          <button
            type="button"
            className={`model-tab ${selectedModel === 'doubao-seedance-1-0-pro-250123' ? 'active' : ''}`}
            onClick={() => setSelectedModel('doubao-seedance-1-0-pro-250123')}
          >
            1.0 pro
          </button>
        </div>

        {/* 统一上传区域 */}
        {(isImageMode || isMultimodalMode) && (
          <>
            <div className="section-label">
              上传素材 {isMultimodalMode && <span style={{ color: '#a4b0be', fontWeight: 'normal' }}>（图片/视频/音频，在提示词中用 @1 @2 引用）</span>}
            </div>
            <div
              className="upload-area"
              onClick={handleUploadClick}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over') }}
              onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('drag-over') }}
              onDrop={(e) => {
                e.preventDefault()
                e.currentTarget.classList.remove('drag-over')
                const files = Array.from(e.dataTransfer.files)
                if (files.length > 0) handleFilesUpload(files)
              }}
            >
              点击或拖拽上传素材
              <br />
              <span className="upload-tip">支持图片、视频、音频</span>
              {loadingUpload && <div className="upload-status">正在上传...</div>}
              {uploadProgress > 0 && (
                <>
                  <div className="upload-progress-bar">
                    <div className="upload-progress-fill" style={{ width: `${uploadProgress}%` }} />
                  </div>
                  <div className="upload-progress-text">
                    <span>{uploadProgressText}</span>
                    <span>{uploadProgress}%</span>
                  </div>
                </>
              )}
              <input
                ref={uploadInputRef}
                type="file"
                multiple
                accept="image/*,video/*,audio/*"
                onChange={handleUploadChange}
                style={{ display: 'none' }}
              />
            </div>

            {/* 素材列表 */}
            {uploadedFiles.length > 0 && (
              <div className="media-files-grid">
                {uploadedFiles.map((file) => (
                  <div key={file.id} className="media-file-item">
                    <div className="media-file-badge" style={{
                      background: file.type === MEDIA_TYPE.VIDEO ? '#ef4444' :
                                  file.type === MEDIA_TYPE.AUDIO ? '#f59e0b' : '#6c5ce7'
                    }}>
                      @{file.id} {MEDIA_TYPE_LABELS[file.type]}
                    </div>
                    {file.type === MEDIA_TYPE.IMAGE ? (
                      <img src={file.url} alt={file.filename} />
                    ) : (
                      <div className="media-file-placeholder">
                        {file.type === MEDIA_TYPE.VIDEO ? '🎬' : '🎵'}
                        <span>{file.filename}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      className="thumb-remove"
                      onClick={() => handleRemoveFile(file.id)}
                    >×</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* 提示词输入 */}
        <div className="section-label">
          {isMultimodalMode ? '视频描述词' : '视频描述词'}
          {uploadedFiles.length > 0 && (
            <span style={{ color: '#a4b0be', fontWeight: 'normal' }}>（可用 @1 @2 引用素材）</span>
          )}
        </div>
        <div className="prompt-mention-wrapper">
          <textarea
            ref={promptRef}
            className="prompt-box"
            placeholder={
              isMultimodalMode
                ? '描述期望生成的视频，例如：结合@1和@2的风格，生成一段...'
                : '描述期望生成的视频内容，支持中英文'
            }
            value={prompt}
            onChange={handlePromptChange}
            rows={6}
          />
          {mentionState.visible && uploadedFiles.length > 0 && (
            <div className="mention-dropdown">
              {uploadedFiles.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="mention-item"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    handleSelectMention(f.id)
                  }}
                >
                  <div className="mention-thumb" style={{
                    background: f.type === MEDIA_TYPE.VIDEO ? '#ef4444' :
                                f.type === MEDIA_TYPE.AUDIO ? '#f59e0b' : '#6c5ce7'
                  }}>
                    {f.type === MEDIA_TYPE.IMAGE ? (
                      <img src={f.url} alt={f.filename} />
                    ) : (
                      <span style={{ fontSize: '16px' }}>{f.type === MEDIA_TYPE.VIDEO ? '🎬' : '🎵'}</span>
                    )}
                  </div>
                  <div className="mention-text">
                    <div className="mention-title">@{f.id}</div>
                    <div className="mention-sub">{MEDIA_TYPE_LABELS[f.type]} · {f.filename}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 生成参数 */}
        <div className="section-label">生成参数</div>
        <div className="params-tabs">
          <button
            type="button"
            className={`params-tab ${activeParamTab === 'basic' ? 'active' : ''}`}
            onClick={() => setActiveParamTab('basic')}
          >
            基础参数
          </button>
          <button
            type="button"
            className={`params-tab ${activeParamTab === 'video' ? 'active' : ''}`}
            onClick={() => setActiveParamTab('video')}
          >
            视频参数
          </button>
        </div>

        <div className="params-panel">
          {activeParamTab === 'basic' && (
            <div className="params-row">
              <div className="param-item">
                <label>分辨率</label>
                <select value={resolution} onChange={(e) => setResolution(e.target.value)}>
                  <option value="480p">480p</option>
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                </select>
              </div>
              <div className="param-item">
                <label>画幅比例</label>
                <select value={ratio} onChange={(e) => setRatio(e.target.value)}>
                  <option value="16:9">16:9 横版</option>
                  <option value="4:3">4:3</option>
                  <option value="1:1">1:1 方形</option>
                  <option value="3:4">3:4 竖版</option>
                  <option value="9:16">9:16 竖版</option>
                  <option value="21:9">21:9 宽屏</option>
                  <option value="adaptive">自适应</option>
                </select>
              </div>
            </div>
          )}

          {activeParamTab === 'video' && (
            <div className="params-row">
              <div className="param-item">
                <label>时长（秒）</label>
                <input
                  type="number"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  min="2"
                  max="15"
                  placeholder="2-15秒"
                />
              </div>
              <div className="param-item">
                <label>种子值</label>
                <input
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  placeholder="-1 随机"
                />
              </div>
              <div className="param-item">
                <label>生成音频</label>
                <select value={generateAudio ? 'true' : 'false'} onChange={(e) => setGenerateAudio(e.target.value === 'true')}>
                  <option value="true">有音频</option>
                  <option value="false">无音频</option>
                </select>
              </div>
              <div className="param-item">
                <label>水印</label>
                <select value={watermark ? 'true' : 'false'} onChange={(e) => setWatermark(e.target.value === 'true')}>
                  <option value="false">无水印</option>
                  <option value="true">有水印</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {error && <p className="error-text">{error}</p>}

        <button className="generate-btn" onClick={handleGenerate} type="button">
          ✦ 立即生成视频
        </button>
      </div>

      <div className="results-panel">
        <div className="tabs">
          <div className="tab active">我的作品</div>
        </div>

        <HistoryFilterBar
          search={historySearch}
          onSearchChange={(v) => { setHistorySearch(v); setHistoryPage(1); }}
          dateFrom={historyDateFrom}
          onDateFromChange={(v) => { setHistoryDateFrom(v); setHistoryPage(1); }}
          dateTo={historyDateTo}
          onDateToChange={(v) => { setHistoryDateTo(v); setHistoryPage(1); }}
          page={historyPage}
          totalPages={historyTotalPages}
          onPageChange={(p) => { setHistoryPage(p); }}
          pageSize={historyPageSize}
          onPageSizeChange={(s) => { setHistoryPageSize(s); setHistoryPage(1); }}
          total={historyTotal}
        />

        {activeTasks.map((task) => (
          <div
            key={task.id}
            className={`result-card generating-card ${task.status === 'failed' ? 'failed-card' : ''}`}
          >
            <div className="card-header">
              <span className="tag">Seedance 2.0</span>
              <div className="card-actions">
                {task.status === 'generating' && <span className="generating-badge">生成中</span>}
                {task.status === 'submitted' && <span className="generating-badge" style={{ backgroundColor: '#6366f1' }}>已提交</span>}
                {task.status === 'ready' && <span className="generating-badge" style={{ backgroundColor: '#10b981' }}>已完成</span>}
                {task.status === 'failed' && <span className="generating-badge" style={{ backgroundColor: '#ef4444' }}>失败</span>}
              </div>
            </div>
            <div className="prompt-text">[{MODE_LABELS[task.mode]}] {task.prompt || '正在生成视频...'}</div>
            <div className="card-meta-row">
              <span className="meta-item">{task.model}</span>
              <span className="meta-time">{task.createdAt.toLocaleString()}</span>
            </div>

            {(task.status === 'generating' || task.status === 'submitted') && (
              <div className="generating-progress-area">
                <div className="generating-progress-wrapper">
                  <div className="generating-progress-circle">
                    <svg className="progress-svg" viewBox="0 0 36 36">
                      <circle className="progress-ring-bg" cx="18" cy="18" r="16" fill="none" stroke="rgba(255, 255, 255, 0.1)" strokeWidth="2" />
                      <circle
                        className="progress-ring"
                        cx="18" cy="18" r="16"
                        fill="none"
                        stroke="var(--primary-color)"
                        strokeWidth="2"
                        strokeDasharray={`${2 * Math.PI * 16}`}
                        strokeDashoffset={`${2 * Math.PI * 16 * (1 - (task.progress || 0) / 100)}`}
                        strokeLinecap="round"
                        transform="rotate(-90 18 18)"
                      />
                    </svg>
                    <div className="progress-text">{task.progress || 0}%</div>
                  </div>
                  <span className="generating-text">
                    {task.status === 'submitted' ? '已提交，视频生成中，请耐心等待...' : '正在生成中，请耐心等待...'}
                  </span>
                </div>
              </div>
            )}

            {task.status === 'failed' && task.error && (
              <div className="error-text" style={{ marginTop: '10px' }}>{task.error}</div>
            )}

            {task.status === 'ready' && task.videoUrl && (
              <div style={{ marginTop: '10px' }}>
                <div id={`video-player-${task.id}`}></div>
                <button className="btn-outline" type="button" onClick={() => handlePlayVideo(task.videoUrl, task.id)} style={{ marginRight: '8px' }}>
                  {playingVideo === task.videoUrl ? '⏸ 暂停' : '▶ 播放'}
                </button>
                <button className="btn-outline" type="button" onClick={() => handleDownload(task.videoUrl, 'seedance-video')} style={{ marginRight: '8px' }}>
                  ⬇ 下载
                </button>
              </div>
            )}
          </div>
        ))}

        {loadingHistory && (
          <div className="result-card">
            <p className="prompt-text">正在加载历史作品...</p>
          </div>
        )}

        {!loadingHistory && !history.length && activeTasks.length === 0 && (
          <div className="result-card">
            <p className="prompt-text">暂无生成记录，试着先生成一个视频吧。</p>
          </div>
        )}

        {history.map((item) => (
          <div className="result-card" key={item.id}>
            <div className="card-header">
              <span className="tag">Seedance 2.0</span>
              <div className="card-actions">
                {item.videoUrl && (
                  <button className="btn-outline" type="button" onClick={() => handlePlayVideo(item.videoUrl, `history-${item.id}`)} style={{ marginRight: '8px' }}>
                    {playingVideo === item.videoUrl ? '⏸ 暂停' : '▶ 播放'}
                  </button>
                )}
                {item.videoUrl && (
                  <button className="btn-outline" type="button" onClick={() => handleDownload(item.videoUrl, 'seedance-video')} style={{ marginRight: '8px' }}>
                    ⬇ 下载
                  </button>
                )}
                <button className="btn-outline" type="button" onClick={() => handleDeleteHistory(item.id)} style={{ color: '#ef4444', borderColor: '#ef4444' }}>
                  🗑 删除
                </button>
              </div>
            </div>
            <div className="prompt-text">[{MODE_LABELS[item.mode] || item.mode}] {item.prompt || '无描述'}</div>
            <div className="card-meta-row">
              <span className="meta-item">{item.model}</span>
              {item.resolution && <span className="meta-item">{item.resolution} · {item.ratio}</span>}
              <span className="meta-time">{new Date(item.createdAt).toLocaleString()}</span>
            </div>
            {item.status === 'failed' && item.error && (
              <div className="error-text" style={{ marginTop: '10px' }}>
                失败: {typeof item.error === 'object' ? item.error.message : item.error}
              </div>
            )}
            {item.status === 'queued' && <div style={{ marginTop: '10px', color: '#6366f1' }}>排队中...</div>}
            {item.status === 'running' && <div style={{ marginTop: '10px', color: '#6366f1' }}>生成中...</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

export default VideoGenerate
