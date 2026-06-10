import { useEffect, useRef, useState } from 'react'
import './App.css'
import HistoryFilterBar from './HistoryFilterBar'
import { Icon } from './components/Icons'

function MusicGenerate() {
  const [gptDescriptionPrompt, setGptDescriptionPrompt] = useState('')
  const [prompt, setPrompt] = useState('')
  const [tags, setTags] = useState('')
  const [negativeTags, setNegativeTags] = useState('')
  const [mv, setMv] = useState('chirp-bluejay')
  const [title, setTitle] = useState('')
  const [makeInstrumental, setMakeInstrumental] = useState(false)
  const [task, setTask] = useState('')
  const [continueClipId, setContinueClipId] = useState('')
  const [continueAt, setContinueAt] = useState('')
  const [coverClipId, setCoverClipId] = useState('')
  const [metadata, setMetadata] = useState({
    vocal_gender: 'f',
    control_sliders: {
      style_weight: 0.87,
      weirdness_constraint: 0.75
    }
  })
  const [metadataText, setMetadataText] = useState(JSON.stringify({
    vocal_gender: 'f',
    control_sliders: {
      style_weight: 0.87,
      weirdness_constraint: 0.75
    }
  }, null, 2))
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
  const [playingAudio, setPlayingAudio] = useState(null)
  const audioRef = useRef(null)
  const progressTimersRef = useRef({})

  // 轮询管理：全局队列 + 并发控制 + 退避，避免每个 taskId 一个 interval 导致请求风暴
  const pollQueueRef = useRef(new Set()) // Set<taskId>
  const pollHandlersRef = useRef({}) // { [taskId]: Array<(result)=>void> }
  const pollInFlightRef = useRef(new Set()) // Set<taskId>
  const pollTimerRef = useRef(null)
  const pollBackoffMsRef = useRef(5000)
  const pollDeadlineRef = useRef({}) // { [taskId]: deadlineAtMs }
  const historyFetchDebounceRef = useRef(null)

  useEffect(() => {
    fetchMusicHistory()
    return () => {
      Object.values(progressTimersRef.current).forEach((timerId) => {
        if (timerId) clearInterval(timerId)
      })
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
      if (historyFetchDebounceRef.current) clearTimeout(historyFetchDebounceRef.current)
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [])

  function clearProgressTimer(localTaskId) {
    const t = progressTimersRef.current[localTaskId]
    if (t) clearInterval(t)
    delete progressTimersRef.current[localTaskId]
  }

  async function queryTaskOnce(taskId) {
    // 轮询接口必须禁用缓存，否则浏览器/代理可能返回 304，导致这里拿不到 JSON（被当成失败吞掉）
    const resp = await fetch(`/api/music/query/${taskId}`, {
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

  function debounceFetchMusicHistory(pageOverride) {
    if (historyFetchDebounceRef.current) clearTimeout(historyFetchDebounceRef.current)
    historyFetchDebounceRef.current = setTimeout(() => {
      fetchMusicHistory(pageOverride)
    }, 800)
  }

  // 筛选条件变化时重新加载
  useEffect(() => {
    fetchMusicHistory(1)
  }, [historySearch, historyDateFrom, historyDateTo, historyPageSize])

  useEffect(() => {
    if (historyPage > 1) fetchMusicHistory(historyPage)
  }, [historyPage])

  function pickAudioUrls(result) {
    // 后端会返回 audioUrls/audioUrl；也兼容 raw 里不同字段名
    const urls = []
    const add = (u) => {
      if (!u || typeof u !== 'string') return
      if (!/^https?:\/\//i.test(u)) return
      if (!urls.includes(u)) urls.push(u)
    }

    if (Array.isArray(result.audioUrls)) result.audioUrls.forEach(add)
    if (result.audioUrl) add(result.audioUrl)

    const raw = result.raw
    if (raw) {
      if (Array.isArray(raw.audioUrls)) raw.audioUrls.forEach(add)
      add(raw.audioUrl || raw.audio_url)
      // 兼容常见返回：clips/tracks 数组里含 audio_url/url
      const arrs = [raw.clips, raw.tracks, raw.data, raw.result]
      arrs.forEach((arr) => {
        if (!Array.isArray(arr)) return
        arr.forEach((x) => {
          add(x?.audioUrl || x?.audio_url || x?.url)
        })
      })
    }

    return urls
  }

  function schedulePollTick() {
    if (pollTimerRef.current) return
    const delay = Math.max(1500, pollBackoffMsRef.current || 5000)
    pollTimerRef.current = setTimeout(async () => {
      pollTimerRef.current = null

      // 页面不可见时暂停轮询，避免后台疯狂打请求
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
            // 超时：移出队列
            pollQueueRef.current.delete(id)
            delete pollHandlersRef.current[id]
            delete pollDeadlineRef.current[id]
            return false
          }
          return true
        })

      // 并发上限：每次最多查 2 个 task，避免触发 rate limit
      const batch = pending.slice(0, 2)
      if (batch.length === 0) {
        // 队列空了就不再继续 tick
        return
      }

      await Promise.all(
        batch.map(async (taskId) => {
          pollInFlightRef.current.add(taskId)
          try {
            const result = await queryTaskOnce(taskId)
            const audioUrls = pickAudioUrls(result)
            if (audioUrls.length > 0) {
              // 成功：执行订阅回调并从队列移除
              const handlers = pollHandlersRef.current[taskId] || []
              handlers.forEach((fn) => {
                try {
                  fn({ taskId, result, audioUrls })
                } catch (_) {
                  // ignore
                }
              })
              pollQueueRef.current.delete(taskId)
              delete pollHandlersRef.current[taskId]
              delete pollDeadlineRef.current[taskId]

              // 成功后恢复默认间隔
              pollBackoffMsRef.current = 5000
            }
          } catch (err) {
            // 429 退避：指数回退到最多 60s
            const msg = err?.message || ''
            if (/429|Too Many Requests/i.test(msg)) {
              pollBackoffMsRef.current = Math.min(60000, (pollBackoffMsRef.current || 5000) * 2)
            }
          } finally {
            pollInFlightRef.current.delete(taskId)
          }
        })
      )

      // 继续下一轮
      schedulePollTick()
    }, delay)
  }

  function enqueuePolling(taskIds, { deadlineAt, onReady }) {
    if (!Array.isArray(taskIds) || taskIds.length === 0) return

    taskIds.forEach((taskId) => {
      pollQueueRef.current.add(taskId)
      pollDeadlineRef.current[taskId] = deadlineAt
      if (!pollHandlersRef.current[taskId]) pollHandlersRef.current[taskId] = []
      if (typeof onReady === 'function') pollHandlersRef.current[taskId].push(onReady)
    })

    schedulePollTick()
  }

  function startQueryForTaskIds(localTaskId, taskIds) {
    if (!Array.isArray(taskIds) || taskIds.length === 0) return

    const deadlineAt = Date.now() + 10 * 60 * 1000 // 最多轮询 10 分钟
    enqueuePolling(taskIds, {
      deadlineAt,
      onReady: ({ audioUrls }) => {
        let mergedCountAfter = 0
        setActiveTasks((prev) =>
          prev.map((t) => {
            if (t.id !== localTaskId) return t
            const merged = Array.isArray(t.audioUrls) ? [...t.audioUrls] : []
            audioUrls.forEach((u) => {
              if (!merged.includes(u)) merged.push(u)
            })
            mergedCountAfter = merged.length
            return {
              ...t,
              status: 'ready',
              progress: 100,
              audioUrl: merged[0],
              audioUrls: merged,
            }
          })
        )
        clearProgressTimer(localTaskId)

        // 拿到音频后延迟刷新历史（去抖），避免反复触发更多轮询
        debounceFetchMusicHistory()
      },
    })

    // 超时兜底：到 deadline 后还没 ready，就标记失败（不强制停止历史回填）
    setTimeout(() => {
      setActiveTasks((prev) =>
        prev.map((t) =>
          t.id === localTaskId && t.status !== 'ready'
            ? { ...t, status: 'failed', error: '查询超时，请稍后在历史记录里查看' }
            : t
        )
      )
      clearProgressTimer(localTaskId)
    }, 10 * 60 * 1000 + 1000)
  }

  function handleMetadataChange(e) {
    const value = e.target.value
    setMetadataText(value)
    try {
      const parsed = JSON.parse(value)
      setMetadata(parsed)
    } catch (err) {
      // 允许无效JSON，只在提交时验证
    }
  }

  function startProgress(taskId) {
    if (progressTimersRef.current[taskId]) {
      clearInterval(progressTimersRef.current[taskId])
    }
    
    setActiveTasks((prev) =>
      prev.map((task) =>
        task.id === taskId ? { ...task, progress: 0 } : task
      )
    )
    
    const ESTIMATED = 180000 // 预估 3 分钟完成
    const startedAt = Date.now()

    progressTimersRef.current[taskId] = setInterval(() => {
      const elapsed = Date.now() - startedAt
      const estimated = Math.min(99, Math.round((elapsed / ESTIMATED) * 100))
      
      setActiveTasks((prev) =>
        prev.map((task) => {
          if (task.id === taskId) {
            const newProgress = estimated > task.progress ? estimated : task.progress
            return { ...task, progress: newProgress }
          }
          return task
        })
      )
    }, 500)
  }

  function stopProgress(taskId) {
    clearProgressTimer(taskId)
  }

  async function fetchMusicHistory(pageOverride) {
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
      const resp = await fetch(`/api/music/history?${params}`)
      const data = await resp.json()
      if (!data.success) {
        throw new Error(data.message || '获取历史记录失败')
      }
      const historyItems = data.data || []
      setHistory(historyItems)
      setHistoryTotal(data.pagination?.total || 0)
      setHistoryTotalPages(data.pagination?.totalPages || 0)

      // 自动查询有 task_ids 但没有 audioUrl 的记录
      historyItems.forEach((item) => {
        if (Array.isArray(item.task_ids) && item.task_ids.length > 0 && !item.audioUrl) {
          const deadlineAt = Date.now() + 10 * 60 * 1000
          enqueuePolling(item.task_ids, {
            deadlineAt,
            onReady: () => {
              // 后端 query 接口会回填历史；这里做去抖刷新即可
              debounceFetchMusicHistory()
            },
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
    if (!confirm('确定要删除这条记录吗？')) {
      return
    }
    try {
      const resp = await fetch(`/api/music/history/${id}`, {
        method: 'DELETE',
      })
      
      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({ message: `删除失败: HTTP ${resp.status}` }))
        throw new Error(errorData.message || `删除失败: HTTP ${resp.status}`)
      }
      
      const data = await resp.json()
      if (!data.success) {
        throw new Error(data.message || '删除失败')
      }
      await fetchMusicHistory()
    } catch (err) {
      setError(err.message || '删除失败')
    }
  }

  function handlePlayAudio(url, taskId) {
    if (playingAudio === url) {
      // 如果正在播放这个音频，则暂停
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      setPlayingAudio(null)
      return
    }

    // 停止当前播放的音频
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }

    // 播放新音频
    const audio = new Audio(url)
    audioRef.current = audio
    setPlayingAudio(url)
    
    audio.onended = () => {
      setPlayingAudio(null)
      audioRef.current = null
    }
    
    audio.onerror = () => {
      setError('音频播放失败')
      setPlayingAudio(null)
      audioRef.current = null
    }
    
    audio.play().catch((err) => {
      console.error('播放失败:', err)
      setError('无法播放音频')
      setPlayingAudio(null)
      audioRef.current = null
    })
  }

  async function handleGenerate() {
    // 验证必填参数
    if (!mv || !title) {
      setError('请填写模型版本和歌名')
      return
    }

    if (!gptDescriptionPrompt && !prompt) {
      setError('请填写【灵感模式】音乐描述或【自定义模式】歌词内容')
      return
    }

    // 验证metadata JSON
    let parsedMetadata
    try {
      parsedMetadata = JSON.parse(metadataText)
    } catch (err) {
      setError('高级参数格式错误，请检查JSON格式')
      return
    }

    setError('')

    const taskId = nextTaskId
    setNextTaskId((prev) => prev + 1)
    
    const newTask = {
      id: taskId,
      title,
      mv,
      prompt: gptDescriptionPrompt || prompt,
      progress: 0,
      status: 'generating',
      createdAt: new Date(),
    }
    
    setActiveTasks((prev) => [...prev, newTask])
    startProgress(taskId)
    
    const controller = new AbortController()
    const THIRTY_MINUTES = 30 * 60 * 1000
    const timeoutId = setTimeout(() => controller.abort(), THIRTY_MINUTES + 60 * 1000)
    
    try {
      const body = {
        model: mv,
        title,
        make_instrumental: makeInstrumental,
        metadata: parsedMetadata,
      }

      if (gptDescriptionPrompt) {
        body.gpt_description_prompt = gptDescriptionPrompt
      }
      if (prompt) {
        body.prompt = prompt
      }
      if (tags) {
        body.tags = tags
      }
      if (negativeTags) {
        body.negative_tags = negativeTags
      }
      if (task) {
        body.task = task
      }
      if (continueClipId) {
        body.continue_clip_id = continueClipId
      }
      if (continueAt) {
        body.continue_at = Number(continueAt)
      }
      if (coverClipId) {
        body.cover_clip_id = coverClipId
      }

      const resp = await fetch('/api/music/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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
      
      // 更新任务状态
      setActiveTasks((prev) =>
        prev.map((task) =>
          task.id === taskId
            ? { ...task, status: 'submitted', taskIds: data.data || [], progress: Math.max(task.progress || 0, 10) }
            : task
        )
      )

      // 自动轮询查询结果，拿到 audioUrl 后右侧立刻展示
      startQueryForTaskIds(taskId, data.data || [])
      
      // 生成成功后刷新历史记录
      await fetchMusicHistory()
    } catch (err) {
      let errorMessage = err.message || '生成出错'
      if (err.name === 'AbortError') {
        errorMessage = '请求超时，请检查网络连接或稍后重试'
      } else if (err.name === 'TypeError' && err.message.includes('fetch')) {
        errorMessage = '网络连接失败，请检查网络后重试'
      }
      
      setActiveTasks((prev) =>
        prev.map((task) =>
          task.id === taskId
            ? { ...task, status: 'failed', error: errorMessage }
            : task
        )
      )
      
      setError(errorMessage)
      stopProgress(taskId)
    } finally {
      clearTimeout(timeoutId)
    }
  }

  return (
    <div className="workspace">
      <div className="config-panel">
        <div className="panel-title">
          <span style={{ cursor: 'pointer' }}>&larr;</span> 工具箱 - Suno AI音乐生成
        </div>

        <div className="section-label">【灵感模式】音乐描述</div>
        <input
          type="text"
          className="input-field"
          placeholder="如: '一首欢快的流行歌' (与prompt二选一)"
          value={gptDescriptionPrompt}
          onChange={(e) => setGptDescriptionPrompt(e.target.value)}
        />

        <div className="section-label">【自定义模式】歌词内容</div>
        <textarea
          className="prompt-box"
          placeholder="V4限3000字, V5限5000字"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
        />

        <div className="section-label">【自定义模式】音乐风格</div>
        <input
          type="text"
          className="input-field"
          placeholder="如: 'pop, rock' (V4限200字, V5限1000字)"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />

        <div className="section-label">排除的风格提示词</div>
        <input
          type="text"
          className="input-field"
          placeholder="排除的风格"
          value={negativeTags}
          onChange={(e) => setNegativeTags(e.target.value)}
        />

        <div className="section-label">模型版本</div>
        <select
          className="select-field"
          value={mv}
          onChange={(e) => setMv(e.target.value)}
        >
          <option value="chirp-v3-0">V3=chirp-v3-0</option>
          <option value="chirp-v3-5">V3=chirp-v3-5</option>
          <option value="chirp-v4">V4=chirp-v4</option>
          <option value="chirp-bluejay">V5=chirp-bluejay(推荐)</option>
          <option value="chirp-auk">V5=chirp-auk</option>
          <option value="chirp-auk-turbo">V5=chirp-auk-turbo</option>
          <option value="chirp-crow">V5=chirp-crow</option>
        </select>

        <div className="section-label">歌名</div>
        <input
          type="text"
          className="input-field"
          placeholder="V4限80字, V5限100字"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <div className="section-label">是否纯音乐(无歌词)</div>
        <select
          className="select-field"
          value={makeInstrumental ? 'true' : 'false'}
          onChange={(e) => setMakeInstrumental(e.target.value === 'true')}
        >
          <option value="false">false</option>
          <option value="true">true</option>
        </select>

        <div className="section-label">操作类型</div>
        <select
          className="select-field"
          value={task}
          onChange={(e) => setTask(e.target.value)}
        >
          <option value="">不传默认生成</option>
          <option value="extend">extend (延长)</option>
          <option value="cover">cover (翻唱)</option>
        </select>

        {task === 'extend' && (
          <>
            <div className="section-label">【延长模式】被延长的歌曲ID</div>
            <input
              type="text"
              className="input-field"
              placeholder="输入歌曲ID"
              value={continueClipId}
              onChange={(e) => setContinueClipId(e.target.value)}
            />
            <div className="section-label">【延长模式】从第几秒开始延长</div>
            <input
              type="number"
              className="input-field"
              placeholder="输入秒数"
              value={continueAt}
              onChange={(e) => setContinueAt(e.target.value)}
            />
          </>
        )}

        {task === 'cover' && (
          <>
            <div className="section-label">【翻唱模式】原歌曲ID</div>
            <input
              type="text"
              className="input-field"
              placeholder="输入原歌曲ID"
              value={coverClipId}
              onChange={(e) => setCoverClipId(e.target.value)}
            />
          </>
        )}

        <div className="section-label">高级参数(如 vocal_gender, audio_weight 等)</div>
        <textarea
          className="prompt-box"
          placeholder='{"vocal_gender": "f", "control_sliders": {"style_weight": 0.87, "weirdness_constraint": 0.75}}'
          value={metadataText}
          onChange={handleMetadataChange}
          rows={6}
        />

        {error && <p className="error-text">{error}</p>}

        <button
          className="generate-btn"
          onClick={handleGenerate}
          type="button"
        >
          <Icon.Sparkle size={14} /> 立即生成 (消耗积分)
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
            className={`result-card generating-card ${
              task.status === 'failed' ? 'failed-card' : ''
            }`}
          >
            <div className="card-header">
              <span className="tag">Suno AI</span>
              <div className="card-actions">
                {task.status === 'generating' && (
                  <span className="generating-badge">生成中</span>
                )}
                {task.status === 'completed' && (
                  <span className="generating-badge" style={{ backgroundColor: '#10b981' }}>
                    已完成
                  </span>
                )}
                {task.status === 'submitted' && (
                  <span className="generating-badge" style={{ backgroundColor: '#6366f1' }}>
                    已提交(等待生成)
                  </span>
                )}
                {task.status === 'ready' && (
                  <span className="generating-badge" style={{ backgroundColor: '#10b981' }}>
                    可播放
                  </span>
                )}
                {task.status === 'failed' && (
                  <span className="generating-badge" style={{ backgroundColor: '#ef4444' }}>
                    失败
                  </span>
                )}
              </div>
            </div>
            <div className="prompt-text">{task.title || '正在生成音乐...'}</div>
            <div className="card-meta-row">
              <span className="meta-item">{task.mv}</span>
              <span className="meta-time">
                {task.createdAt.toLocaleString()}
              </span>
            </div>
            {(task.status === 'generating' || task.status === 'submitted') && (
              <div className="generating-progress-area">
                <div className="generating-progress-wrapper">
                  <div className="generating-progress-circle">
                    <svg className="progress-svg" viewBox="0 0 36 36">
                      <circle
                        className="progress-ring-bg"
                        cx="18"
                        cy="18"
                        r="16"
                        fill="none"
                        stroke="rgba(255, 255, 255, 0.1)"
                        strokeWidth="2"
                      />
                      <circle
                        className="progress-ring"
                        cx="18"
                        cy="18"
                        r="16"
                        fill="none"
                        stroke="var(--primary-color)"
                        strokeWidth="2"
                        strokeDasharray={`${2 * Math.PI * 16}`}
                        strokeDashoffset={`${2 * Math.PI * 16 * (1 - task.progress / 100)}`}
                        strokeLinecap="round"
                        transform="rotate(-90 18 18)"
                      />
                    </svg>
                    <div className="progress-text">{task.progress}%</div>
                  </div>
                  <span className="generating-text">
                    {task.status === 'submitted' ? '已提交，正在生成中，请耐心等待...' : '正在生成中，请耐心等待...'}
                  </span>
                </div>
              </div>
            )}
            {task.status === 'failed' && task.error && (
              <div className="error-text" style={{ marginTop: '10px' }}>
                {task.error}
              </div>
            )}
            {task.status === 'submitted' && task.taskIds && (
              <div style={{ marginTop: '10px', color: '#10b981' }}>
                任务ID: {task.taskIds.join(', ')} - 请使用查询接口查询进度
              </div>
            )}
            {task.status === 'ready' && (task.audioUrl || (Array.isArray(task.audioUrls) && task.audioUrls.length > 0)) && (
              <div className="image-preview-area" style={{ marginTop: '10px' }}>
                {(Array.isArray(task.audioUrls) ? task.audioUrls : [task.audioUrl]).filter(Boolean).slice(0, 2).map((u, idx) => (
                  <div key={`${u}-${idx}`} style={{ marginTop: idx === 0 ? 0 : '10px' }}>
                    <div style={{ fontSize: '12px', opacity: 0.75, marginBottom: '6px' }}>音频 {idx + 1}</div>
                    <audio src={u} controls style={{ width: '100%' }} />
                  </div>
                ))}
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
            <p className="prompt-text">暂无生成记录，试着先生成一首音乐吧。</p>
          </div>
        )}

        {history.map((item) => (
          <div className="result-card" key={item.id}>
            <div className="card-header">
              <span className="tag">Suno AI</span>
              <div className="card-actions">
                {(item.audioUrl || (Array.isArray(item.audioUrls) && item.audioUrls.length > 0)) && (
                  <button
                    className="btn-outline"
                    type="button"
                    onClick={() => handlePlayAudio((item.audioUrls && item.audioUrls[0]) || item.audioUrl, item.id)}
                    style={{ marginRight: '8px' }}
                  >
                    {playingAudio === ((item.audioUrls && item.audioUrls[0]) || item.audioUrl) ? <><Icon.Pause size={13} /> 暂停</> : <><Icon.Play size={13} /> 播放</>}
                  </button>
                )}
                {(item.audioUrl || (Array.isArray(item.audioUrls) && item.audioUrls.length > 0)) && (
                  <button
                    className="btn-outline"
                    type="button"
                    onClick={() => {
                      const url = (item.audioUrls && item.audioUrls[0]) || item.audioUrl
                      const a = document.createElement('a')
                      a.href = url
                      a.download = `${item.title || 'music'}.mp3`
                      document.body.appendChild(a)
                      a.click()
                      document.body.removeChild(a)
                    }}
                    style={{ marginRight: '8px' }}
                  >
                    <Icon.Download size={13} /> 下载
                  </button>
                )}
                <button
                  className="btn-outline"
                  type="button"
                  onClick={() => handleDeleteHistory(item.id)}
                  style={{ color: '#ef4444', borderColor: '#ef4444' }}
                >
                  <Icon.Trash size={13} /> 删除
                </button>
              </div>
            </div>
            <div className="prompt-text">{item.title}</div>
            <div className="card-meta-row">
              <span className="meta-item">{item.model || item.mv}</span>
              {item.createdAt && (
                <span className="meta-time">
                  {new Date(item.createdAt).toLocaleString()}
                </span>
              )}
            </div>
            {(item.audioUrl || (Array.isArray(item.audioUrls) && item.audioUrls.length > 0)) && (
              <div className="image-preview-area" style={{ marginTop: '10px' }}>
                {(Array.isArray(item.audioUrls) ? item.audioUrls : [item.audioUrl]).filter(Boolean).slice(0, 2).map((u, idx) => (
                  <div key={`${u}-${idx}`} style={{ marginTop: idx === 0 ? 0 : '10px' }}>
                    <div style={{ fontSize: '12px', opacity: 0.75, marginBottom: '6px' }}>音频 {idx + 1}</div>
                    <audio src={u} controls style={{ width: '100%' }} />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default MusicGenerate
