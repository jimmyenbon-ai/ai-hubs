import { useEffect, useRef, useState } from 'react'
import './App.css'
import HistoryFilterBar from './HistoryFilterBar'
import { Icon } from './components/Icons'

// 视频提供商常量
const VIDEO_PROVIDER = {
  SEEDANCE: 'seedance',
  AGNES: 'agnes',
}

// 生成模式常量
const GENERATION_MODE = {
  TEXT_TO_VIDEO: 'text_to_video',
  IMAGE_TO_VIDEO_FIRST: 'image_to_video_first',
  IMAGE_TO_VIDEO_FIRST_LAST: 'image_to_video_first_last',
  MULTIMODAL_REFERENCE: 'multimodal_reference',
}

// Agnes 视频生成模式（与 Seedance 不同）
const AGNES_GENERATION_MODE = {
  TEXT_TO_VIDEO: 'text_to_video',
  IMAGE_TO_VIDEO: 'ti2vid',
  MULTI_IMAGE_VIDEO: 'multi_image',
  KEYFRAME_ANIMATION: 'keyframes',
}

const MODE_LABELS = {
  [GENERATION_MODE.TEXT_TO_VIDEO]: '文生视频',
  [GENERATION_MODE.IMAGE_TO_VIDEO_FIRST]: '图生视频-首帧',
  [GENERATION_MODE.IMAGE_TO_VIDEO_FIRST_LAST]: '图生视频-首尾帧',
  [GENERATION_MODE.MULTIMODAL_REFERENCE]: '多模态参考',
}

const AGNES_MODE_LABELS = {
  [AGNES_GENERATION_MODE.TEXT_TO_VIDEO]: '文生视频',
  [AGNES_GENERATION_MODE.IMAGE_TO_VIDEO]: '图生视频',
  [AGNES_GENERATION_MODE.MULTI_IMAGE_VIDEO]: '多图视频',
  [AGNES_GENERATION_MODE.KEYFRAME_ANIMATION]: '关键帧动画',
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
  // 视频提供商状态
  const [videoProvider, setVideoProvider] = useState(VIDEO_PROVIDER.SEEDANCE)
  
  const [generationMode, setGenerationMode] = useState(GENERATION_MODE.TEXT_TO_VIDEO)
  const [agnesMode, setAgnesMode] = useState(AGNES_GENERATION_MODE.TEXT_TO_VIDEO)
  const [selectedModel, setSelectedModel] = useState('doubao-seedance-2-0-260128')
  const [provider, setProvider] = useState('seedance')
  const [prompt, setPrompt] = useState('')
  const [resolution, setResolution] = useState('720p')
  const [ratio, setRatio] = useState('16:9')
  const [duration, setDuration] = useState(5)
  const [seed, setSeed] = useState(-1)
  const [generateAudio, setGenerateAudio] = useState(true)
  const [watermark, setWatermark] = useState(false)
  
  // Agnes 专用参数
  const [agnesHeight, setAgnesHeight] = useState(768)
  const [agnesWidth, setAgnesWidth] = useState(1152)
  const [agnesNumFrames, setAgnesNumFrames] = useState(121)
  const [agnesFrameRate, setAgnesFrameRate] = useState(24)
  const [agnesNegativePrompt, setAgnesNegativePrompt] = useState('')
  
  // 多图上传（Agnes 多图/关键帧模式）
  const [multiImages, setMultiImages] = useState([])
  const multiImageInputRef = useRef(null)

  // 统一素材列表
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [loadingUpload, setLoadingUpload] = useState(false)
  const uploadInputRef = useRef(null)

  // 首帧/尾帧（图生视频模式）
  const [firstFrameUrl, setFirstFrameUrl] = useState('')
  const [lastFrameUrl, setLastFrameUrl] = useState('')
  const [firstFrameName, setFirstFrameName] = useState('')
  const [lastFrameName, setLastFrameName] = useState('')
  const firstFrameInputRef = useRef(null)
  const lastFrameInputRef = useRef(null)
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
            const handlers = pollHandlersRef.current[id] || []
            handlers.filter(h => h.type === 'failed').forEach((h) => {
              try { h.fn({ taskId: id, result: { status: 'failed', error: { message: '轮询超时' } }, failed: true }) } catch (_) { /* ignore */ }
            })
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
              handlers.filter(h => h.type === 'ready').forEach((h) => {
                try {
                  h.fn({ taskId, result })
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
              handlers.filter(h => h.type === 'failed').forEach((h) => {
                try {
                  h.fn({ taskId, result, failed: true })
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
            } else {
              console.error('[视频轮询] 查询失败:', taskId, msg)
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
    if (typeof onReady === 'function') pollHandlersRef.current[taskId].push({ type: 'ready', fn: onReady })
    if (typeof onFailed === 'function') pollHandlersRef.current[taskId].push({ type: 'failed', fn: (data) => onFailed(data) })

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

  // 上传首帧/尾帧图片（单文件，存储URL）
  async function handleFrameUpload(file, target) {
    if (!file) return
    setLoadingUpload(true)
    setError('')
    const formData = new FormData()
    formData.append('files', file)
    try {
      const resp = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await resp.json()
      if (data.success && data.files?.length > 0) {
        const url = data.files[0].url
        const name = data.files[0].filename || file.name
        if (target === 'first') {
          setFirstFrameUrl(url)
          setFirstFrameName(name)
        } else {
          setLastFrameUrl(url)
          setLastFrameName(name)
        }
      } else {
        setError(data.message || '上传失败')
      }
    } catch (err) {
      setError('上传失败: ' + err.message)
    } finally {
      setLoadingUpload(false)
    }
  }

  function handleFrameChange(e, target) {
    const file = e.target.files?.[0]
    if (file) handleFrameUpload(file, target)
    e.target.value = ''
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
      }
      setPlayingVideo(null)
      return
    }

    if (videoRef.current) {
      videoRef.current.pause()
    }

    setPlayingVideo(url)
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
    // 验证提示词
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
      agnesMode: agnesMode,
      model: selectedModel,
      provider: videoProvider,
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
        model: selectedModel,
        resolution,
        ratio,
        duration: parseInt(duration, 10),
        seed: seed === -1 ? undefined : parseInt(seed, 10),
        generate_audio: generateAudio,
        watermark,
      }

      // 根据不同的提供商构建请求体
      if (videoProvider === VIDEO_PROVIDER.AGNES) {
        // Agnes Video V2.0 专用逻辑
        body.mode = agnesMode
        body.prompt = prompt
        body.height = agnesHeight
        body.width = agnesWidth
        body.num_frames = agnesNumFrames
        body.frame_rate = agnesFrameRate
        if (agnesNegativePrompt.trim()) body.negative_prompt = agnesNegativePrompt.trim()
        
        // 根据模式添加图片参数
        if (agnesMode === AGNES_GENERATION_MODE.IMAGE_TO_VIDEO && firstFrameUrl) {
          body.image = firstFrameUrl
        } else if ((agnesMode === AGNES_GENERATION_MODE.MULTI_IMAGE_VIDEO || agnesMode === AGNES_GENERATION_MODE.KEYFRAME_ANIMATION) && multiImages.length > 0) {
          body.extra_body = { image: multiImages.map(img => img.url) }
          if (agnesMode === AGNES_GENERATION_MODE.KEYFRAME_ANIMATION) {
            body.extra_body.mode = 'keyframes'
          }
        }
      } else {
        // Seedance 逻辑（默认）
        body.mode = generationMode
        
        // 根据模式构建内容
        if (generationMode === GENERATION_MODE.MULTIMODAL_REFERENCE) {
          body.content = buildApiContent()
          body.prompt = prompt
        } else if (generationMode === GENERATION_MODE.TEXT_TO_VIDEO) {
          body.content = [{ type: 'text', text: prompt }]
        } else {
          body.content = []
          if (prompt.trim()) {
            body.content.push({ type: 'text', text: prompt })
          }
          if (firstFrameUrl) {
            body.firstFrameImage = firstFrameUrl
          }
          if (lastFrameUrl) {
            body.lastFrameImage = lastFrameUrl
          }
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

      // 不再立即调用 fetchVideoHistory，因为 activeTasks 已经显示了新任务
      // 历史记录会在下次加载时自动更新
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

  const isMultimodalMode = videoProvider === VIDEO_PROVIDER.SEEDANCE && generationMode === GENERATION_MODE.MULTIMODAL_REFERENCE
  const isImageMode = videoProvider === VIDEO_PROVIDER.SEEDANCE && (generationMode === GENERATION_MODE.IMAGE_TO_VIDEO_FIRST ||
                     generationMode === GENERATION_MODE.IMAGE_TO_VIDEO_FIRST_LAST)
  const [activeParamTab, setActiveParamTab] = useState('basic')

  function resetFiles() {
    setUploadedFiles([])
    setFirstFrameUrl('')
    setFirstFrameName('')
    setLastFrameUrl('')
    setLastFrameName('')
    setPrompt('')
    setMultiImages([])
  }

  // 切换视频提供商时重置状态
  function handleProviderChange(provider) {
    setVideoProvider(provider)
    resetFiles()
    if (provider === VIDEO_PROVIDER.SEEDANCE) {
      setGenerationMode(GENERATION_MODE.TEXT_TO_VIDEO)
      setSelectedModel('doubao-seedance-2-0-260128')
    } else {
      setAgnesMode(AGNES_GENERATION_MODE.TEXT_TO_VIDEO)
      setSelectedModel('agnes-video-v2.0')
    }
  }

  // 处理多图上传（Agnes 专用）
  async function handleMultiImageUpload(files) {
    if (!files || files.length === 0) return
    setLoadingUpload(true)
    setError('')
    try {
      const formData = new FormData()
      Array.from(files).forEach(file => formData.append('files', file))
      const resp = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await resp.json()
      if (data.success && data.files?.length > 0) {
        const newImages = data.files.map((f, idx) => ({
          id: multiImages.length + idx + 1,
          url: f.url,
          filename: f.filename || f.originalname || file.name,
        }))
        setMultiImages(prev => [...prev, ...newImages])
      } else {
        setError(data.message || '上传失败')
      }
    } catch (err) {
      setError('上传失败: ' + err.message)
    } finally {
      setLoadingUpload(false)
    }
  }

  function handleMultiImageInputChange(e) {
    const files = e.target.files
    if (files) handleMultiImageUpload(files)
    e.target.value = ''
  }

  function removeMultiImage(id) {
    setMultiImages(prev => prev.filter(img => img.id !== id).map((img, idx) => ({ ...img, id: idx + 1 })))
  }

  return (
    <div className="workspace">
      <div className="config-panel">
        <div className="panel-title">
          <span style={{ cursor: 'pointer' }}>&larr;</span> 工具箱 - AI 视频生成
        </div>

        {/* API 提供商切换 */}
        <div className="section-label">选择 API 提供商</div>
        <div className="provider-tabs">
          <button
            type="button"
            className={`provider-tab ${videoProvider === VIDEO_PROVIDER.SEEDANCE ? 'active' : ''}`}
            onClick={() => handleProviderChange(VIDEO_PROVIDER.SEEDANCE)}
          >
            Seedance
          </button>
          <button
            type="button"
            className={`provider-tab ${videoProvider === VIDEO_PROVIDER.AGNES ? 'active' : ''}`}
            onClick={() => handleProviderChange(VIDEO_PROVIDER.AGNES)}
          >
            Agnes Video V2.0
          </button>
        </div>

        {/* Seedance 模式选择 */}
        {videoProvider === VIDEO_PROVIDER.SEEDANCE && (
          <>
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

            {/* Seedance 模型选择 */}
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
          </>
        )}

        {/* Agnes 模式选择 */}
        {videoProvider === VIDEO_PROVIDER.AGNES && (
          <>
            <div className="section-label">生成模式</div>
            <div className="mode-tabs">
              <button
                type="button"
                className={`mode-tab ${agnesMode === AGNES_GENERATION_MODE.TEXT_TO_VIDEO ? 'active' : ''}`}
                onClick={() => { setAgnesMode(AGNES_GENERATION_MODE.TEXT_TO_VIDEO); resetFiles(); }}
              >
                文生视频
              </button>
              <button
                type="button"
                className={`mode-tab ${agnesMode === AGNES_GENERATION_MODE.IMAGE_TO_VIDEO ? 'active' : ''}`}
                onClick={() => { setAgnesMode(AGNES_GENERATION_MODE.IMAGE_TO_VIDEO); resetFiles(); }}
              >
                图生视频
              </button>
              <button
                type="button"
                className={`mode-tab ${agnesMode === AGNES_GENERATION_MODE.MULTI_IMAGE_VIDEO ? 'active' : ''}`}
                onClick={() => { setAgnesMode(AGNES_GENERATION_MODE.MULTI_IMAGE_VIDEO); resetFiles(); }}
              >
                多图视频
              </button>
              <button
                type="button"
                className={`mode-tab ${agnesMode === AGNES_GENERATION_MODE.KEYFRAME_ANIMATION ? 'active' : ''}`}
                onClick={() => { setAgnesMode(AGNES_GENERATION_MODE.KEYFRAME_ANIMATION); resetFiles(); }}
              >
                关键帧动画
              </button>
            </div>
            <p className="hint">
              {agnesMode === AGNES_GENERATION_MODE.TEXT_TO_VIDEO && '仅输入文本提示词生成视频'}
              {agnesMode === AGNES_GENERATION_MODE.IMAGE_TO_VIDEO && '上传图片，AI 将其动画化'}
              {agnesMode === AGNES_GENERATION_MODE.MULTI_IMAGE_VIDEO && '使用多张参考图像指导视频生成'}
              {agnesMode === AGNES_GENERATION_MODE.KEYFRAME_ANIMATION && '在多个关键帧之间生成平滑过渡动画'}
            </p>

            {/* Agnes 模型标识 */}
            <div className="section-label">视频模型</div>
            <div className="model-tabs">
              <button
                type="button"
                className={`model-tab active`}
                onClick={() => {}}
                style={{ cursor: 'default' }}
              >
                Agnes Video V2.0
              </button>
            </div>
          </>
        )}

        {/* Seedance 图生视频-首帧：上传首帧图 */}
        {videoProvider === VIDEO_PROVIDER.SEEDANCE && generationMode === GENERATION_MODE.IMAGE_TO_VIDEO_FIRST && (
          <>
            <div className="section-label">首帧图片</div>
            <div
              className="upload-area"
              onClick={() => firstFrameInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over') }}
              onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('drag-over') }}
              onDrop={(e) => {
                e.preventDefault()
                e.currentTarget.classList.remove('drag-over')
                const file = e.dataTransfer.files?.[0]
                if (file && file.type.startsWith('image/')) handleFrameUpload(file, 'first')
              }}
            >
              {firstFrameUrl ? (
                <img src={firstFrameUrl} alt="首帧" style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 8 }} />
              ) : (
                <>
                  点击或拖拽上传首帧图片
                  <br />
                  <span className="upload-tip">支持 PNG、JPG，10MB 以内</span>
                </>
              )}
              {loadingUpload && <div className="upload-status">正在上传...</div>}
              <input
                ref={firstFrameInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => handleFrameChange(e, 'first')}
                style={{ display: 'none' }}
              />
            </div>
            {firstFrameName && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -6, marginBottom: 8 }}>
                已上传: {firstFrameName}
                <button type="button" onClick={() => { setFirstFrameUrl(''); setFirstFrameName(''); }}
                  style={{ marginLeft: 8, background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 11 }}>移除</button>
              </div>
            )}
          </>
        )}

        {/* Seedance 图生视频-首尾帧：上传首帧 + 尾帧 */}
        {videoProvider === VIDEO_PROVIDER.SEEDANCE && generationMode === GENERATION_MODE.IMAGE_TO_VIDEO_FIRST_LAST && (
          <>
            <div className="section-label">首帧图片</div>
            <div
              className="upload-area"
              onClick={() => firstFrameInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over') }}
              onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('drag-over') }}
              onDrop={(e) => {
                e.preventDefault()
                e.currentTarget.classList.remove('drag-over')
                const file = e.dataTransfer.files?.[0]
                if (file && file.type.startsWith('image/')) handleFrameUpload(file, 'first')
              }}
            >
              {firstFrameUrl ? (
                <img src={firstFrameUrl} alt="首帧" style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 8 }} />
              ) : (
                <>
                  点击或拖拽上传首帧图片
                  <br />
                  <span className="upload-tip">支持 PNG、JPG，10MB 以内</span>
                </>
              )}
              {loadingUpload && <div className="upload-status">正在上传...</div>}
              <input
                ref={firstFrameInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => handleFrameChange(e, 'first')}
                style={{ display: 'none' }}
              />
            </div>
            {firstFrameName && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -6, marginBottom: 8 }}>
                已上传: {firstFrameName}
                <button type="button" onClick={() => { setFirstFrameUrl(''); setFirstFrameName(''); }}
                  style={{ marginLeft: 8, background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 11 }}>移除</button>
              </div>
            )}

            <div className="section-label" style={{ marginTop: 8 }}>尾帧图片</div>
            <div
              className="upload-area"
              onClick={() => lastFrameInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over') }}
              onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('drag-over') }}
              onDrop={(e) => {
                e.preventDefault()
                e.currentTarget.classList.remove('drag-over')
                const file = e.dataTransfer.files?.[0]
                if (file && file.type.startsWith('image/')) handleFrameUpload(file, 'last')
              }}
            >
              {lastFrameUrl ? (
                <img src={lastFrameUrl} alt="尾帧" style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 8 }} />
              ) : (
                <>
                  点击或拖拽上传尾帧图片
                  <br />
                  <span className="upload-tip">支持 PNG、JPG，10MB 以内</span>
                </>
              )}
              {loadingUpload && <div className="upload-status">正在上传...</div>}
              <input
                ref={lastFrameInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => handleFrameChange(e, 'last')}
                style={{ display: 'none' }}
              />
            </div>
            {lastFrameName && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -6, marginBottom: 8 }}>
                已上传: {lastFrameName}
                <button type="button" onClick={() => { setLastFrameUrl(''); setLastFrameName(''); }}
                  style={{ marginLeft: 8, background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 11 }}>移除</button>
              </div>
            )}
          </>
        )}

        {/* Seedance 多模态模式：统一上传区 */}
        {videoProvider === VIDEO_PROVIDER.SEEDANCE && generationMode === GENERATION_MODE.MULTIMODAL_REFERENCE && (
          <>
            <div className="section-label">
              上传素材 <span style={{ color: '#a4b0be', fontWeight: 'normal' }}>（图片/视频/音频，在提示词中用 @1 @2 引用）</span>
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
                        {file.type === MEDIA_TYPE.VIDEO ? <Icon.Video size={18} /> : <Icon.Music size={18} />}
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

        {/* Agnes 图生视频模式：单图上传 */}
        {videoProvider === VIDEO_PROVIDER.AGNES && agnesMode === AGNES_GENERATION_MODE.IMAGE_TO_VIDEO && (
          <>
            <div className="section-label">输入图片</div>
            <div
              className="upload-area"
              onClick={() => firstFrameInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over') }}
              onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('drag-over') }}
              onDrop={(e) => {
                e.preventDefault()
                e.currentTarget.classList.remove('drag-over')
                const file = e.dataTransfer.files?.[0]
                if (file && file.type.startsWith('image/')) handleFrameUpload(file, 'first')
              }}
            >
              {firstFrameUrl ? (
                <img src={firstFrameUrl} alt="输入图" style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 8 }} />
              ) : (
                <>
                  点击或拖拽上传图片
                  <br />
                  <span className="upload-tip">支持 PNG、JPG，10MB 以内</span>
                </>
              )}
              {loadingUpload && <div className="upload-status">正在上传...</div>}
              <input
                ref={firstFrameInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => handleFrameChange(e, 'first')}
                style={{ display: 'none' }}
              />
            </div>
            {firstFrameName && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -6, marginBottom: 8 }}>
                已上传: {firstFrameName}
                <button type="button" onClick={() => { setFirstFrameUrl(''); setFirstFrameName(''); }}
                  style={{ marginLeft: 8, background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 11 }}>移除</button>
              </div>
            )}
          </>
        )}

        {/* Agnes 多图视频 / 关键帧动画：多图上传 */}
        {(videoProvider === VIDEO_PROVIDER.AGNES && (agnesMode === AGNES_GENERATION_MODE.MULTI_IMAGE_VIDEO || agnesMode === AGNES_GENERATION_MODE.KEYFRAME_ANIMATION)) && (
          <>
            <div className="section-label">
              {agnesMode === AGNES_GENERATION_MODE.KEYFRAME_ANIMATION ? '关键帧图片' : '参考图片'}
              <span style={{ color: '#a4b0be', fontWeight: 'normal' }}>（至少上传 2 张图片）</span>
            </div>
            <div
              className="upload-area"
              onClick={() => multiImageInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('drag-over') }}
              onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('drag-over') }}
              onDrop={(e) => {
                e.preventDefault()
                e.currentTarget.classList.remove('drag-over')
                const files = e.dataTransfer.files
                if (files && files.length > 0) handleMultiImageUpload(files)
              }}
            >
              点击或拖拽上传多张图片
              <br />
              <span className="upload-tip">支持 PNG、JPG，10MB 以内</span>
              {loadingUpload && <div className="upload-status">正在上传...</div>}
              <input
                ref={multiImageInputRef}
                type="file"
                multiple
                accept="image/*"
                onChange={handleMultiImageInputChange}
                style={{ display: 'none' }}
              />
            </div>

            {/* 多图列表 */}
            {multiImages.length > 0 && (
              <div className="media-files-grid">
                {multiImages.map((img) => (
                  <div key={img.id} className="media-file-item">
                    <div className="media-file-badge" style={{ background: '#6c5ce7' }}>
                      #{img.id}
                    </div>
                    <img src={img.url} alt={img.filename} />
                    <button
                      type="button"
                      className="thumb-remove"
                      onClick={() => removeMultiImage(img.id)}
                    >×</button>
                  </div>
                ))}
              </div>
            )}
            {multiImages.length > 0 && (
              <p className="hint" style={{ marginTop: 4 }}>
                已上传 {multiImages.length} 张图片
                {agnesMode === AGNES_GENERATION_MODE.KEYFRAME_ANIMATION && '（将按顺序生成关键帧之间的过渡）'}
              </p>
            )}
          </>
        )}

        {/* 提示词输入 */}
        <div className="section-label">
          视频描述词
          {videoProvider === VIDEO_PROVIDER.SEEDANCE && generationMode === GENERATION_MODE.MULTIMODAL_REFERENCE && uploadedFiles.length > 0 && (
            <span style={{ color: '#a4b0be', fontWeight: 'normal' }}>（可用 @1 @2 引用素材）</span>
          )}
        </div>
        <div className="prompt-mention-wrapper">
          <textarea
            ref={promptRef}
            className="prompt-box"
            placeholder={
              videoProvider === VIDEO_PROVIDER.SEEDANCE && generationMode === GENERATION_MODE.MULTIMODAL_REFERENCE
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
                      <span style={{ fontSize: '16px' }}>{f.type === MEDIA_TYPE.VIDEO ? <Icon.Video size={16} /> : <Icon.Music size={16} />}</span>
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

        {/* Seedance 生成参数 */}
        {videoProvider === VIDEO_PROVIDER.SEEDANCE && (
          <>
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
          </>
        )}

        {/* Agnes 生成参数 */}
        {videoProvider === VIDEO_PROVIDER.AGNES && (
          <>
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
                    <select
                      value={`${agnesWidth}x${agnesHeight}`}
                      onChange={(e) => {
                        const [w, h] = e.target.value.split('x').map(Number);
                        setAgnesWidth(w);
                        setAgnesHeight(h);
                      }}
                    >
                      <option value="1152x768">1152x768 (3:2)</option>
                      <option value="1024x1024">1024x1024 (1:1)</option>
                      <option value="1280x720">1280x720 (16:9)</option>
                      <option value="768x1152">768x1152 (2:3)</option>
                      <option value="1920x1080">1920x1080 (16:9 HD)</option>
                    </select>
                  </div>
                </div>
              )}

              {activeParamTab === 'video' && (
                <div className="params-row">
                  <div className="param-item">
                    <label>时长</label>
                    <select
                      value={agnesNumFrames}
                      onChange={(e) => {
                        const frames = parseInt(e.target.value, 10);
                        setAgnesNumFrames(frames);
                      }}
                    >
                      <option value="81">3.3秒</option>
                      <option value="121">5秒</option>
                      <option value="161">6.7秒</option>
                      <option value="241">10秒</option>
                      <option value="441">18秒</option>
                    </select>
                  </div>
                  <div className="param-item">
                    <label>帧率</label>
                    <select value={agnesFrameRate} onChange={(e) => setAgnesFrameRate(parseInt(e.target.value, 10))}>
                      <option value="24">24 FPS</option>
                      <option value="30">30 FPS</option>
                      <option value="60">60 FPS</option>
                    </select>
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
                  <div className="param-item" style={{ width: '100%' }}>
                    <label>负向提示词</label>
                    <input
                      type="text"
                      value={agnesNegativePrompt}
                      onChange={(e) => setAgnesNegativePrompt(e.target.value)}
                      placeholder="描述需要避免的内容，如：模糊、变形、低质量"
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {error && <p className="error-text">{error}</p>}

        <button className="generate-btn" onClick={handleGenerate} type="button">
          <Icon.Sparkle size={14} /> 立即生成视频
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
              <span className="tag">
                {task.provider === VIDEO_PROVIDER.AGNES ? 'Agnes V2.0' : 'Seedance 2.0'}
              </span>
              <div className="card-actions">
                {task.status === 'generating' && <span className="generating-badge">生成中</span>}
                {task.status === 'submitted' && <span className="generating-badge" style={{ backgroundColor: '#6366f1' }}>已提交</span>}
                {task.status === 'ready' && <span className="generating-badge" style={{ backgroundColor: '#10b981' }}>已完成</span>}
                {task.status === 'failed' && <span className="generating-badge" style={{ backgroundColor: '#ef4444' }}>失败</span>}
              </div>
            </div>
            <div className="prompt-text">
              [{task.provider === VIDEO_PROVIDER.AGNES ? AGNES_MODE_LABELS[task.agnesMode] || task.agnesMode : MODE_LABELS[task.mode] || task.mode}] {task.prompt || '正在生成视频...'}
            </div>
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
                <video
                  src={task.videoUrl}
                  controls
                  muted
                  loop
                  playsInline
                  style={{
                    width: '100%',
                    maxHeight: '200px',
                    borderRadius: '8px',
                    background: '#000',
                    objectFit: 'contain',
                    marginBottom: '10px',
                  }}
                />
                <button className="btn-outline" type="button" onClick={() => handleDownload(task.videoUrl, 'seedance-video')} style={{ marginRight: '8px' }}>
                  <Icon.Download size={13} /> 下载
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

        {history.map((item) => {
          // 过滤掉已经在 activeTasks 中显示的任务
          const isInActiveTasks = activeTasks.some(t => t.taskId === item.task_id);
          if (isInActiveTasks) return null;

          const isPlayingThis = playingVideo === item.videoUrl;

          return (
          <div className="result-card" key={item.id}>
            <div className="card-header">
              <span className="tag">
                {item.model && item.model.startsWith('agnes') ? 'Agnes V2.0' : 'Seedance 2.0'}
              </span>
              <div className="card-actions">
                {item.videoUrl && (
                  <button className="btn-outline" type="button" onClick={() => handlePlayVideo(item.videoUrl, `history-${item.id}`)} style={{ marginRight: '8px' }}>
                    {isPlayingThis ? <><Icon.Pause size={13} /> 暂停</> : <><Icon.Play size={13} /> 播放</>}
                  </button>
                )}
                {item.videoUrl && (
                  <button className="btn-outline" type="button" onClick={() => handleDownload(item.videoUrl, 'video')} style={{ marginRight: '8px' }}>
                    <Icon.Download size={13} /> 下载
                  </button>
                )}
                <button className="btn-outline" type="button" onClick={() => handleDeleteHistory(item.id)} style={{ color: '#ef4444', borderColor: '#ef4444' }}>
                  <Icon.Trash size={13} /> 删除
                </button>
              </div>
            </div>
            {/* 内联视频预览区域 */}
            {item.videoUrl && (
              <div style={{ marginTop: '10px', marginBottom: '10px' }}>
                <video
                  src={item.videoUrl}
                  controls={isPlayingThis}
                  autoPlay={isPlayingThis}
                  muted={isPlayingThis}
                  loop={isPlayingThis}
                  playsInline
                  style={{
                    width: '100%',
                    maxHeight: isPlayingThis ? '300px' : '180px',
                    borderRadius: '8px',
                    background: '#000',
                    objectFit: 'contain',
                  }}
                  onMouseEnter={(e) => { if (!isPlayingThis) e.target.play().catch(() => {}); }}
                  onMouseLeave={(e) => { if (!isPlayingThis) { e.target.pause(); e.target.currentTime = 0; } }}
                />
              </div>
            )}
            <div className="prompt-text">{item.prompt || '无描述'}</div>
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
          );
        })}

        {/* 视频播放器区域 */}
        {playingVideo && (
          <div className="result-card" style={{ marginTop: '20px', background: '#1f1f1f', padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ color: '#fff' }}>正在播放</span>
              <button className="btn-outline" onClick={() => {
                if (videoRef.current) {
                  videoRef.current.pause()
                  videoRef.current = null
                }
                setPlayingVideo(null)
              }}><Icon.X size={14} /> 关闭</button>
            </div>
            <video
              ref={videoRef}
              src={playingVideo}
              controls
              autoPlay
              style={{ width: '100%', maxHeight: '400px', borderRadius: '8px' }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default VideoGenerate
