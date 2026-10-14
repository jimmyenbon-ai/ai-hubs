import { cloneElement, useCallback, useEffect, useId, useRef, useState } from 'react'
import { Icon } from './components/Icons'
import LiteratureFrameworkTree from './components/LiteratureFrameworkTree'
import './LiteratureWorkspace.css'

const CATEGORIES = {
  outline: '全书大纲', volume: '分卷骨架', mainline: '主线', subplot: '支线', character: '人物档案',
  plot: '剧情要点', item: '物品', scene: '场景', faction: '势力', world: '世界规则', style: '文风', foreshadow: '伏笔',
}
const FIELDS = {
  character: ['外貌', '性格', '动机', '背景', '说话习惯', '成长弧线', '人物关系'],
  outline: ['主题', '开端', '核心冲突', '转折', '高潮', '结局候选'],
  volume: ['本卷目标', '起始章节', '结束章节', '主要转折'],
  mainline: ['目标', '冲突', '关键节点', '收束计划', '进展'],
  subplot: ['目标', '关联主线', '关键节点', '收束计划', '进展'],
  plot: ['必须发生', '不能发生', '前置条件', '后续影响'],
  item: ['来源', '能力', '限制', '初始持有人', '初始状态'],
  scene: ['地理位置', '外观', '氛围', '相邻地点'],
  faction: ['目标', '领导者', '盟友', '敌对关系', '资源'],
  world: ['核心规则', '能力边界', '历史背景', '禁区'],
  style: ['叙事视角', '时态', '节奏', '对白风格', '禁用表达', '参考片段'],
  foreshadow: ['埋设计划', '回收计划', '涉及人物', '进展'],
}
const TASKS = { outline: '构思大纲', plan: '规划场景', write: '撰写本章', rewrite: '改写正文', review: '一致性审校', memory: '提取记忆' }
const STATUS = { queued: '等待执行', running: '执行中', ready: '待采纳', applied: '已采纳', stale: '版本已变化', failed: '失败', cancelled: '已取消' }
const STAGE = { queued: '准备任务', context: '组装上下文', planning: '组织剧情', drafting: '撰写正文', reviewing: '审校正文', extracting: '提取事实', done: '完成' }

async function api(path, method = 'GET', body) {
  const response = await fetch(`/api/literature${path}`, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Literature-Request': '1' }, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || '请求失败');
  return result.data;
}
function routeFromLocation() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const view = parts[1] === 'new' ? 'new' : parts[3] === 'framework' ? 'canon' : parts[3] || 'overview';
  return { bookId: parts[1] === 'books' ? parts[2] : '', view, chapterId: ['chapters', 'drafts'].includes(view) ? parts[4] || '' : '', kind: view === 'canon' ? parts[4] || 'outline' : '', entryId: view === 'canon' ? parts[5] || '' : '', parentId: new URLSearchParams(window.location.search).get('parent') || '', jobId: view === 'confirm' ? parts[4] || '' : '' };
}
function download(name, content, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Tool({ icon: Name, title, onClick, disabled, children, primary = false, pressed }) {
  const Component = Icon[Name];
  return <button type="button" title={title} aria-label={title} aria-pressed={pressed} onClick={onClick} disabled={disabled} className={`lit-button ${primary ? 'primary' : ''} ${children ? '' : 'icon-only'}`}>{Component && <Component size={16} />}{children}</button>
}
function Field({ label, children }) {
  const fieldId = useId()
  return <div className="lit-field"><label htmlFor={fieldId}>{label}</label>{cloneElement(children, { id: fieldId })}</div>
}
function Modal({ title, onClose, children }) {
  return <div className="lit-modal-backdrop" onClick={event => event.target === event.currentTarget && onClose()}><section role="dialog" aria-modal="true" aria-label={title} className="lit-modal"><header><h2>{title}</h2><Tool icon="X" title="关闭" onClick={onClose} /></header>{children}</section></div>
}

export default function LiteratureWorkspace() {
  const [auth, setAuth] = useState(null)
  const [route, setRoute] = useState(routeFromLocation)
  const [books, setBooks] = useState([])
  const [data, setData] = useState(null)
  const [models, setModels] = useState([])
  const [chapter, setChapter] = useState(null)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [transitioning, setTransitioning] = useState(false)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(null)
  const [instruction, setInstruction] = useState('')
  const [targetWords, setTargetWords] = useState(2500)
  const [activeJob, setActiveJob] = useState(null)
  const [context, setContext] = useState(null)
  const [versions, setVersions] = useState([])
  const [reviewJob, setReviewJob] = useState(null)
  const [chapterQuery, setChapterQuery] = useState('')
  const [chapterLimit, setChapterLimit] = useState(100)
  const [navigationTab, setNavigationTab] = useState(() => routeFromLocation().view === 'chapters' ? 'formal' : 'framework')
  const [navHidden, setNavHidden] = useState(false)
  const [assistantHidden, setAssistantHidden] = useState(() => routeFromLocation().view === 'chapters')
  const [focusMode, setFocusMode] = useState(false)
  const [mobilePanel, setMobilePanel] = useState('main')
  const [taskSelection, setTaskSelection] = useState(null)
  const [readingSize, setReadingSize] = useState(() => Math.min(24, Math.max(16, Number(localStorage.getItem('lit-reading-size')) || 18)))
  const draftRef = useRef(draft)
  const chapterRef = useRef(chapter)
  const saveRef = useRef(null)
  const bookIdRef = useRef(route.bookId)
  const editorGuardRef = useRef(null)
  const mainScrollRef = useRef(null)
  draftRef.current = draft; chapterRef.current = chapter; bookIdRef.current = route.bookId
  const dirty = Boolean(chapter && draft && JSON.stringify({ title: chapter.title, content: chapter.content, plan: chapter.plan }) !== JSON.stringify(draft))

  const refresh = useCallback(async (bookId = bookIdRef.current) => {
    if (!bookId) return;
    const result = await api(`/books/${bookId}`)
    if (bookIdRef.current === bookId) setData(result)
    return result
  }, [])
  const attempt = useCallback(async action => {
    setError('')
    try { return await action() } catch (failure) { setError(failure.message); return null }
  }, [])
  const registerEditorGuard = useCallback(guard => { editorGuardRef.current = guard }, [])
  const saveCurrent = useCallback(async () => {
    if (saveRef.current) await saveRef.current;
    const item = chapterRef.current, current = draftRef.current, bookId = bookIdRef.current
    if (!item || !current || JSON.stringify({ title: item.title, content: item.content, plan: item.plan }) === JSON.stringify(current)) return item
    const sent = JSON.stringify(current)
    setSaving(true)
    const pending = api(`/books/${bookId}/chapters/${item.id}`, 'PUT', { ...current, revision: item.revision })
    saveRef.current = pending
    try {
      const saved = await pending
      if (chapterRef.current?.id === item.id && bookIdRef.current === bookId) {
        chapterRef.current = saved; setChapter(saved)
        if (JSON.stringify(draftRef.current) === sent) {
          const clean = { title: saved.title, content: saved.content, plan: saved.plan }
          draftRef.current = clean; setDraft(clean)
          sessionStorage.removeItem(`lit-recovery-${item.id}`)
        }
      }
      await refresh(bookId)
      return saved
    } finally { saveRef.current = null; setSaving(false) }
  }, [refresh])

  useEffect(() => { api('/auth/me').then(setAuth).catch(failure => setError(failure.message)) }, [])
  useEffect(() => {
    const handler = () => {
      const next = routeFromLocation()
      setRoute(next); setMobilePanel('main'); setTaskSelection(null); setActiveJob(null); setContext(null)
      if (next.view === 'chapters') { setNavigationTab('formal'); setAssistantHidden(true) }
      if (['canon', 'drafts'].includes(next.view)) { setNavigationTab('framework'); setAssistantHidden(false) }
    }
    window.addEventListener('popstate', handler)
    return () => window.removeEventListener('popstate', handler)
  }, [])
  useEffect(() => {
    if (!auth?.user) return;
    api('/books').then(setBooks).catch(failure => setError(failure.message))
    api('/models').then(setModels).catch(failure => setError(failure.message))
  }, [auth?.user])
  useEffect(() => {
    if (!auth?.user || !route.bookId) return;
    let live = true
    api(`/books/${route.bookId}`).then(result => { if (live) setData(result) }).catch(failure => { if (live) setError(failure.message) })
    return () => { live = false }
  }, [route.bookId, auth?.user])
  useEffect(() => {
    if (!auth?.user || !route.bookId || !route.jobId) return;
    let live = true
    api(`/books/${route.bookId}/jobs/${route.jobId}`).then(result => { if (live) setReviewJob(result) }).catch(failure => { if (live) setError(failure.message) })
    return () => { live = false }
  }, [route.bookId, route.jobId, auth?.user])
  useEffect(() => {
    if (!auth?.user || !route.bookId || !route.chapterId) return;
    let live = true
    api(`/books/${route.bookId}/chapters/${route.chapterId}${route.view === 'chapters' ? '/formal' : ''}`).then(item => {
      if (!live) return;
      const clean = { title: item.title, content: item.content, plan: item.plan }
      const recovery = route.view === 'drafts' ? sessionStorage.getItem(`lit-recovery-${item.id}`) : null
      if (recovery) {
        try { const parsed = JSON.parse(recovery); if (parsed.userId === auth.user.id && window.confirm('发现未保存的本章草稿，是否恢复到编辑器？')) Object.assign(clean, parsed.draft) } catch { /* Ignore invalid recovery data; canonical content stays in the database. */ }
      }
      chapterRef.current = item; draftRef.current = clean; setChapter(item); setDraft(clean)
    }).catch(failure => { if (live) setError(failure.message) })
    return () => { live = false }
  }, [route.bookId, route.chapterId, route.view, auth?.user])
  useEffect(() => { mainScrollRef.current?.scrollTo({ top: 0 }) }, [route.bookId, route.view, route.entryId, route.chapterId, route.jobId])
  useEffect(() => {
    if (!dirty || !chapter || !draft) return;
    sessionStorage.setItem(`lit-recovery-${chapter.id}`, JSON.stringify({ userId: auth?.user?.id, revision: chapter.revision, draft }))
    const timer = setTimeout(() => { saveCurrent().catch(failure => setError(failure.message)) }, 1500)
    return () => clearTimeout(timer)
  }, [dirty, draft, chapter, auth?.user?.id, saveCurrent])
  useEffect(() => {
    const handler = event => { if (dirty || editorGuardRef.current?.dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])
  useEffect(() => {
    const busy = data?.jobs?.find(job => ['queued', 'running'].includes(job.status))
    if (!busy) return;
    const timer = setInterval(() => { refresh().catch(failure => setError(failure.message)) }, 1800)
    return () => clearInterval(timer)
  }, [data, refresh])

  async function navigate(path) {
    if (editorGuardRef.current?.dirty && !window.confirm('当前填写内容尚未保存，是否放弃修改并切换？')) return;
    setTransitioning(true)
    const saved = await attempt(async () => { await saveCurrent(); return true })
    if (!saved) { setTransitioning(false); return }
    window.history.pushState({}, '', path)
    const next = routeFromLocation(); setRoute(next); setActiveJob(null); setContext(null); setMobilePanel('main'); setTaskSelection(null)
    if (next.view === 'chapters') { setNavigationTab('formal'); setAssistantHidden(true) }
    else { setAssistantHidden(false); if (['canon', 'drafts'].includes(next.view) || next.bookId !== route.bookId) setNavigationTab('framework') }
    if (next.bookId !== route.bookId || next.chapterId !== route.chapterId || next.view !== route.view) { setChapter(null); setDraft(null) }
    if (next.bookId !== route.bookId) setData(null)
    if (!next.bookId) { setData(null); setBooks(await api('/books')) }
    setTransitioning(false)
  }
  async function startJob(type) {
    await attempt(async () => {
      const saved = await saveCurrent()
      const job = await api(`/books/${route.bookId}/jobs`, 'POST', { type, chapterId: saved?.id, instruction, targetWords, requestId: crypto.randomUUID() })
      setActiveJob(job.id)
      setTaskSelection(null); setAssistantHidden(false); setMobilePanel('assistant')
      await refresh()
      setTaskSelection(null); setMobilePanel('main')
    })
  }
  async function applyJob(job) {
    await attempt(async () => {
      if (dirty) { await saveCurrent(); throw new Error('本章修改已保存，旧结果不会覆盖，请重新生成') }
      const result = await api(`/books/${route.bookId}/jobs/${job.id}/apply`, 'POST', {})
      if (job.chapter_id && chapter?.id === job.chapter_id) { setChapter(result); setDraft({ title: result.title, content: result.content, plan: result.plan }) }
      await refresh()
      if (result?.entryId) await navigate(`/literature/books/${route.bookId}/framework/outline/${result.entryId}`)
    })
  }
  async function inspectContext() {
    await attempt(async () => {
      await saveCurrent()
      setContext(await api(`/books/${route.bookId}/chapters/${chapter.id}/context`))
      setModal({ type: 'context' })
    })
  }
  async function addChapter() {
    setTransitioning(true)
    await attempt(async () => {
      await saveCurrent()
      const item = await api(`/books/${route.bookId}/chapters`, 'POST', {})
      await refresh()
      await navigate(`/literature/books/${route.bookId}/drafts/${item.id}`)
    })
    setTransitioning(false)
  }
  async function exportBook(format) {
    await attempt(async () => {
      await saveCurrent()
      const response = await fetch(`/api/literature/books/${route.bookId}/export?format=${format}`)
      if (!response.ok) throw new Error('导出失败')
      const content = format === 'txt' ? await response.text() : JSON.stringify((await response.json()).data, null, 2)
      download(`${data.book.title}.${format}`, content, format === 'txt' ? 'text/plain' : 'application/json')
    })
  }
  if (!auth) return <div className="literature-workspace lit-loading">{error || '加载小说工作区...'}</div>
  if (!auth.user) return <div className="literature-workspace"><Login needsSetup={auth.needsSetup} onLogin={user => setAuth({ user, needsSetup: false })} /></div>

  const book = data?.book.id === route.bookId ? data.book : null
  const job = data?.jobs.find(item => item.id === activeJob) || data?.jobs.find(item => route.chapterId ? item.chapter_id === route.chapterId : route.jobId ? item.id === route.jobId : route.view === 'tasks' ? true : item.type === 'outline')
  const busy = Boolean(data?.jobs.some(item => ['queued', 'running'].includes(item.status)))
  const bookPath = `/literature/books/${route.bookId}`
  const chapterReady = ['chapters', 'drafts'].includes(route.view) && chapter && draft && chapter.id === route.chapterId
  const draftingReady = chapterReady && route.view === 'drafts'
  const formalChapters = data?.chapters.filter(item => item.accepted_revision && item.accepted_ai_generated) || []
  const selectedEntry = data?.entries.find(entry => entry.id === route.entryId)
  const confirmationJob = data?.jobs.find(item => item.id === route.jobId) || (reviewJob?.id === route.jobId ? reviewJob : null)
  const matchingJob = job?.chapter_id === chapter?.id ? job : null
  const pendingTask = matchingJob && ['plan', 'write', 'rewrite', 'review', 'memory'].includes(matchingJob.type) && ['queued', 'running', 'ready'].includes(matchingJob.status) && !(matchingJob.type === 'review' && matchingJob.status === 'ready') ? matchingJob.type : ''
  const nextTask = pendingTask || (!draft?.content?.trim() ? (draft?.plan.goal || draft?.plan.beats ? 'write' : 'plan') : matchingJob?.type === 'review' && ['ready', 'applied'].includes(matchingJob.status) ? 'memory' : 'review')
  const currentTask = taskSelection && taskSelection.chapterId === chapter?.id ? taskSelection.type : nextTask
  const formalIndex = formalChapters.findIndex(item => item.id === route.chapterId)
  const entryPath = (kind, entryId = '', parentId = '') => `${bookPath}/framework/${kind}${entryId ? `/${entryId}` : ''}${parentId ? `?parent=${parentId}` : ''}`
  const saveEntry = value => attempt(async () => {
    const saved = await api(`/books/${book.id}/entries${selectedEntry ? `/${selectedEntry.id}` : ''}`, selectedEntry ? 'PUT' : 'POST', value)
    registerEditorGuard(null)
    await refresh()
    await navigate(entryPath(saved.kind, saved.id))
    return true
  })
  const saveBook = value => attempt(async () => {
    const saved = await api(book ? `/books/${book.id}` : '/books', book ? 'PUT' : 'POST', value)
    registerEditorGuard(null)
    if (book) await refresh()
    await navigate(`/literature/books/${saved.id}/overview`)
    setBooks(await api('/books'))
    return true
  })

  return <section className="literature-workspace" data-book-open={Boolean(book)} data-focus={focusMode && Boolean(book)} style={{ '--lit-reading-size': `${readingSize}px` }}>
    <header className="lit-topbar">
      <div className="lit-title"><Icon.Book size={20} /><div><h1>{book?.title || '文学创作'}</h1><span>{book ? `${book.genre || '小说'} · ${formalChapters.length} 章正式正文` : '我的作品'}</span></div></div>
      <div className="lit-actions">
        {book && <><Tool icon="ChevronLeft" title="我的作品" onClick={() => navigate('/literature')} /><Tool icon="Plus" title="新建创作计划" onClick={addChapter} /><div className="lit-layout-tools"><Tool icon="LayoutList" title={navHidden ? '展开作品目录' : '收起作品目录'} pressed={!navHidden} onClick={() => setNavHidden(!navHidden)} /><Tool icon="Brain" title={assistantHidden ? '展开创作助手' : '收起创作助手'} pressed={!assistantHidden} onClick={() => setAssistantHidden(!assistantHidden)} /><Tool icon={focusMode ? 'Layout' : 'Maximize'} title={focusMode ? '退出专注模式' : '进入专注模式'} pressed={focusMode} onClick={() => setFocusMode(!focusMode)} /></div></>}
        <span className="lit-account">{auth.user.username}</span>
        <details className="lit-overflow-menu"><summary title="作品与账户操作" aria-label="作品与账户操作"><Icon.MoreHorizontal size={18} /></summary><div onClick={event => { if (event.target.closest('button')) event.currentTarget.parentElement.open = false }}>
          {book && <><Tool icon="Edit" title="作品与模型配置" onClick={() => navigate(`${bookPath}/settings`)}>作品与模型配置</Tool><Tool icon="Download" title="导出正式正文 TXT" onClick={() => exportBook('txt')}>导出正文 TXT</Tool><Tool icon="Folder" title="导出完整创作框架 JSON" onClick={() => exportBook('json')}>导出创作框架</Tool></>}
          {auth.user.role === 'admin' && <Tool icon="User" title="创建作者账户" onClick={() => setModal({ type: 'user' })}>创建作者账户</Tool>}
          <Tool icon="ExternalLink" title="退出小说工作区登录" onClick={() => attempt(async () => { await saveCurrent(); await api('/auth/logout', 'POST', {}); setAuth({ user: null, needsSetup: false }); setData(null) })}>退出登录</Tool>
        </div></details>
      </div>
    </header>
    {error && <div className="lit-error" role="alert"><Icon.AlertTriangle size={16} />{error}<Tool icon="X" title="关闭提示" onClick={() => setError('')} /></div>}
    {!route.bookId && route.view === 'new' && <div className="lit-books"><BookEditor models={models} onSave={saveBook} onClose={() => navigate('/literature')} registerGuard={registerEditorGuard} /></div>}
    {route.view !== 'new' && (!route.bookId ? <div className="lit-books">
      <div className="lit-section-heading"><h2>我的作品</h2><Tool icon="Plus" title="新建作品" primary onClick={() => navigate('/literature/new')}>新建作品</Tool></div>
      {books.length === 0 ? <div className="lit-empty"><Icon.Book size={36} /><h3>暂无作品</h3><Tool icon="Plus" title="创建第一部作品" onClick={() => navigate('/literature/new')}>新建作品</Tool></div> : <div className="lit-book-grid">{books.map(item => <button type="button" key={item.id} className="lit-book-item" onClick={() => navigate(`/literature/books/${item.id}/overview`)}><span className="lit-book-mark"><Icon.Book size={24} /></span><h3>{item.title}</h3><span>{item.genre || '小说'}</span><p>{item.premise || '尚未填写作品简介'}</p><small>{new Date(item.updated_at).toLocaleDateString()}</small></button>)}</div>}
    </div> : !book ? <div className="lit-loading">正在加载作品...</div> : <><div className="lit-mobile-tabs" role="tablist" aria-label="小说工作区面板">{[['nav', '目录', 'LayoutList'], ['main', route.view === 'chapters' ? '阅读' : '编辑', 'Pen'], ['assistant', 'AI 助手', 'Brain']].map(([key, label, icon]) => { const Component = Icon[icon]; return <button key={key} type="button" role="tab" aria-selected={mobilePanel === key} aria-controls={`lit-panel-${key}`} onClick={() => setMobilePanel(key)}><Component size={16} />{label}</button> })}</div><div className={`lit-layout ${navHidden ? 'nav-hidden' : ''} ${assistantHidden ? 'assistant-hidden' : ''} ${focusMode ? 'focus-mode' : ''}`} data-mobile-panel={mobilePanel}>
      <aside className="lit-project-nav" id="lit-panel-nav">
        <div className="lit-nav-title"><strong>作品目录</strong><Tool icon="ChevronLeft" title="收起作品目录" onClick={() => setNavHidden(true)} /></div>
        <button type="button" className={route.view === 'overview' ? 'active' : ''} onClick={() => navigate(`${bookPath}/overview`)}><Icon.Layout size={15} />作品总览</button>
        <div className="lit-directory-tabs" role="tablist" aria-label="作品目录类型"><button type="button" role="tab" aria-selected={navigationTab === 'framework'} onClick={() => setNavigationTab('framework')}>创作框架</button><button type="button" role="tab" aria-selected={navigationTab === 'formal'} onClick={() => setNavigationTab('formal')}>正式正文 <small>{formalChapters.length}</small></button></div>
        <section className="lit-formal-directory" aria-label="正式正文目录" hidden={navigationTab !== 'formal'}>
          <div className="lit-nav-heading"><span>正式正文</span><small>{formalChapters.length}</small></div>
          {formalChapters.length > 0 && <input className="lit-chapter-search" aria-label="搜索正式正文" placeholder="搜索正式正文" value={chapterQuery} onChange={event => { setChapterQuery(event.target.value); setChapterLimit(100) }} />}
          <div className="lit-chapter-list">{formalChapters.filter(item => `${item.ordinal} ${item.accepted_title || item.title}`.includes(chapterQuery)).filter((item, index) => index < chapterLimit || item.id === route.chapterId).map(item => <button type="button" key={item.id} className={item.id === route.chapterId && route.view === 'chapters' ? 'active' : ''} onClick={() => navigate(`${bookPath}/chapters/${item.id}`)}><span className="lit-chapter-number">{item.ordinal}</span><span>{item.accepted_title || item.title}</span><span className={`lit-state-dot ${item.needs_review ? 'warning' : 'accepted'}`} title={item.needs_review ? '待复核' : '已确认 AI 正文'} /></button>)}{formalChapters.filter(item => `${item.ordinal} ${item.accepted_title || item.title}`.includes(chapterQuery)).length > chapterLimit && <button type="button" onClick={() => setChapterLimit(chapterLimit + 100)}>更多正文</button>}</div>
          {!formalChapters.length && <span className="lit-tree-empty">暂无正式正文</span>}
        </section>
        <div hidden={navigationTab !== 'framework'}><LiteratureFrameworkTree entries={data.entries} chapters={data.chapters} categories={CATEGORIES} route={route} onSelect={(kind, entryId) => navigate(entryPath(kind, entryId))} onAdd={(kind, parentId) => navigate(entryPath(kind, 'new', parentId))} onDraft={chapterId => navigate(`${bookPath}/drafts/${chapterId}`)} onAddDraft={addChapter} /></div>
        <div className="lit-nav-heading"><span>记录</span></div>
        <button type="button" className={route.view === 'memory' ? 'active' : ''} onClick={() => navigate(`${bookPath}/memory`)}><Icon.Brain size={15} />剧情记忆</button>
        <button type="button" className={route.view === 'tasks' ? 'active' : ''} onClick={() => navigate(`${bookPath}/tasks`)}><Icon.History size={15} />任务与变更</button>
      </aside>
      <main className={`lit-main ${chapterReady ? 'lit-writing-surface' : ''} ${route.view === 'chapters' ? 'lit-reading-surface' : ''}`} id="lit-panel-main" ref={mainScrollRef}>
        {route.view === 'overview' && <>
          <div className="lit-section-heading"><h2>作品总览</h2><Tool icon="Edit" title="编辑作品与模型" onClick={() => navigate(`${bookPath}/settings`)} /></div>
          <div className="lit-overview-stats"><div><strong>{data.chapters.length}</strong><span>创作计划</span></div><div><strong>{data.entries.length}</strong><span>框架节点</span></div><div><strong>{formalChapters.length}</strong><span>正式正文</span></div><div><strong>{data.chapters.filter(item => item.needs_review).length}</strong><span>待复核</span></div></div>
          <section className="lit-overview-section"><h3>作品简介</h3><p>{book.premise || '未填写'}</p></section>
          <section className="lit-overview-section"><h3>文风基准</h3><p>{book.style || '未填写'}</p></section>
          <section className="lit-overview-section"><h3>全书约束</h3><p>{book.instructions || '未填写'}</p></section>
          <section className="lit-overview-section"><h3>主线与支线</h3>{data.entries.filter(entry => ['mainline', 'subplot'].includes(entry.kind)).map(entry => <button type="button" className="lit-thread-row" key={entry.id} onClick={() => navigate(entryPath(entry.kind, entry.id))}><span className="lit-tag">{CATEGORIES[entry.kind]}</span><strong>{entry.title}</strong><span>{entry.data['进展'] || '未标记'}</span></button>)}</section>
        </>}
        {route.view === 'canon' && (route.entryId === 'new' || selectedEntry) && <EntryEditor key={`${route.entryId}:${selectedEntry?.revision || 0}:${route.parentId}`} value={selectedEntry} kind={route.kind} parentId={route.parentId} entries={data.entries} registerGuard={registerEditorGuard} onClose={() => navigate(entryPath(route.kind))} onSave={saveEntry} onDelete={() => attempt(async () => { if (!window.confirm('删除这个框架节点？子节点会保留并移到分类根节点。')) return; await api(`/books/${book.id}/entries/${selectedEntry.id}`, 'DELETE', { revision: selectedEntry.revision }); registerEditorGuard(null); await refresh(); await navigate(entryPath(route.kind)) })} />}
        {route.view === 'canon' && !route.entryId && <FrameworkOverview kind={route.kind} entries={data.entries} onSelect={entryId => navigate(entryPath(route.kind, entryId))} onAdd={() => navigate(entryPath(route.kind, 'new'))} />}
        {route.view === 'canon' && route.entryId && route.entryId !== 'new' && !selectedEntry && <div className="lit-empty">框架节点不存在</div>}
        {route.view === 'settings' && <BookEditor key={book.revision} value={book} models={models} registerGuard={registerEditorGuard} onSave={saveBook} onClose={() => navigate(`${bookPath}/overview`)} onDelete={() => attempt(async () => { if (!window.confirm('永久删除作品和全部资料？')) return; await api(`/books/${book.id}`, 'DELETE', { revision: book.revision }); registerEditorGuard(null); setChapter(null); setDraft(null); chapterRef.current = null; draftRef.current = null; await navigate('/literature') })} />}
        {route.view === 'confirm' && confirmationJob && <MemoryReview key={confirmationJob.id} job={confirmationJob} entries={data.entries} registerGuard={registerEditorGuard} onClose={() => navigate(`${bookPath}/drafts/${confirmationJob.chapter_id}`)} onAccept={value => attempt(async () => { if (!window.confirm('确认当前正文与所选记忆？AI 正文确认后会加入正式目录。')) return; await api(`/books/${book.id}/chapters/${confirmationJob.chapter_id}/accept`, 'POST', { ...value, revision: confirmationJob.chapter_revision, jobId: confirmationJob.id }); registerEditorGuard(null); const updated = await refresh(); const view = updated.chapters.find(item => item.id === confirmationJob.chapter_id)?.accepted_ai_generated ? 'chapters' : 'drafts'; await navigate(`${bookPath}/${view}/${confirmationJob.chapter_id}`) })} />}
        {route.view === 'confirm' && !confirmationJob && <div className="lit-loading">加载记忆确认...</div>}
        {chapterReady && <div className="lit-writing-inner">
          <div className="lit-editor-heading">{draftingReady ? <input aria-label="章节标题" readOnly={transitioning} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /> : <h2>{chapter.title}</h2>}<div><span className="lit-save-status">{draftingReady ? saving ? '保存中' : dirty ? '未保存' : `已保存 · v${chapter.revision}` : `正式正文 · v${chapter.revision}`}</span>{draftingReady ? <><Tool icon="Save" title="保存章节" onClick={() => attempt(saveCurrent)} /><Tool icon="History" title="章节版本" onClick={() => attempt(async () => { await saveCurrent(); setVersions(await api(`/books/${book.id}/chapters/${chapter.id}/versions`)); setModal({ type: 'versions' }) })} /><Tool icon="Eye" title="查看本章上下文包" onClick={inspectContext} /></> : <Tool icon="Pen" title="进入创作计划修订" onClick={() => navigate(`${bookPath}/drafts/${chapter.id}`)} />}</div></div>
          {data.chapters.find(item => item.id === chapter.id)?.needs_review ? <div className="lit-warning">前置设定或正文已变化，本章需要复核。</div> : null}
          {!draftingReady && <div className="lit-reading-toolbar"><span>第 {chapter.ordinal} 章</span><div><Tool icon="ChevronLeft" title="缩小正文字号" disabled={readingSize <= 16} onClick={() => { setReadingSize(readingSize - 1); localStorage.setItem('lit-reading-size', readingSize - 1) }} /><span>{readingSize}</span><Tool icon="ChevronRight" title="放大正文字号" disabled={readingSize >= 24} onClick={() => { setReadingSize(readingSize + 1); localStorage.setItem('lit-reading-size', readingSize + 1) }} /></div></div>}
          {draftingReady && <><WorkflowProgress chapter={chapter} jobs={data.jobs} /><details key={chapter.id} className="lit-chapter-plan" open={!draft.content}><summary>章节构思<Icon.ChevronDown size={14} /></summary><div className="lit-plan-fields">{[['goal', '章节目标'], ['beats', '场景推进'], ['mustInclude', '必须出现'], ['forbidden', '不可发生']].map(([key, label]) => <Field key={key} label={label}><textarea rows={2} value={draft.plan[key] || ''} onChange={event => setDraft({ ...draft, plan: { ...draft.plan, [key]: event.target.value } })} /></Field>)}<Field label="叙事视角人物"><select value={draft.plan.povEntityId || ''} onChange={event => setDraft({ ...draft, plan: { ...draft.plan, povEntityId: event.target.value } })}><option value="">未指定 / 全知视角</option>{data.entries.filter(entry => entry.kind === 'character').map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></Field></div><div className="lit-entity-picker">{data.entries.filter(entry => ['character', 'item', 'scene', 'faction', 'mainline', 'subplot', 'foreshadow'].includes(entry.kind)).map(entry => <label key={entry.id}><input type="checkbox" checked={(draft.plan.entityIds || []).includes(entry.id)} onChange={event => setDraft({ ...draft, plan: { ...draft.plan, entityIds: event.target.checked ? [...(draft.plan.entityIds || []), entry.id] : (draft.plan.entityIds || []).filter(value => value !== entry.id) } })} />{entry.title}</label>)}</div></details>
          <div className="lit-plan-fields"><Field label="所属分卷"><select value={draft.plan.volumeId || ''} onChange={event => setDraft({ ...draft, plan: { ...draft.plan, volumeId: event.target.value } })}><option value="">未分卷</option>{data.entries.filter(entry => entry.kind === 'volume').map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></Field><Field label="故事时间"><input value={draft.plan.storyTime || ''} onChange={event => setDraft({ ...draft, plan: { ...draft.plan, storyTime: event.target.value } })} /></Field></div></>}
          {draftingReady ? <textarea className="lit-manuscript" aria-label="小说正文" readOnly={transitioning} value={draft.content} onChange={event => setDraft({ ...draft, content: event.target.value })} placeholder="" spellCheck={false} /> : <article className="lit-formal-manuscript" aria-label="正式小说正文">{chapter.content}</article>}
          <footer className="lit-editor-footer"><span>{draft.content.length.toLocaleString()} 字</span><span>{chapter.status === 'accepted' ? '已确认正文' : '编辑草稿'}</span><span>第 {chapter.ordinal} 章</span></footer>
          {!draftingReady && <nav className="lit-reading-pagination" aria-label="正文章节翻页"><Tool icon="ChevronLeft" title="上一章" disabled={formalIndex <= 0} onClick={() => navigate(`${bookPath}/chapters/${formalChapters[formalIndex - 1].id}`)}>上一章</Tool><Tool icon="ChevronRight" title="下一章" disabled={formalIndex < 0 || formalIndex >= formalChapters.length - 1} onClick={() => navigate(`${bookPath}/chapters/${formalChapters[formalIndex + 1].id}`)}>下一章</Tool></nav>}
        </div>}
        {['chapters', 'drafts'].includes(route.view) && !chapterReady && <div className="lit-loading">加载创作计划...</div>}
        {route.view === 'memory' && <><div className="lit-section-heading"><h2>剧情记忆</h2><span>{data.facts.filter(fact => fact.status === 'active').length} 条有效记录</span></div><div className="lit-memory-list">{data.facts.map(fact => <article key={fact.id}><header><strong>{data.entries.find(entry => entry.id === fact.entity_id)?.title || (fact.key === '__summary' ? '章节摘要' : '剧情事实')}</strong><span className={`lit-tag ${fact.status === 'stale' ? 'warning' : ''}`}>{fact.status === 'active' ? '有效' : '待重建'}</span></header><h4>{fact.key === '__summary' ? '' : fact.key}</h4><p>{fact.value}</p><blockquote>{fact.quote}</blockquote><button type="button" onClick={() => navigate(`${bookPath}/chapters/${fact.chapter_id}`)}>第 {fact.ordinal} 章 · 原文 v{fact.source_revision}</button></article>)}{!data.facts.length && <div className="lit-empty"><Icon.Brain size={30} /><h3>暂无已确认记忆</h3></div>}</div></>}
        {route.view === 'tasks' && <><div className="lit-section-heading"><h2>任务与变更</h2></div>{data.jobs.map(item => <button type="button" className="lit-job-row" key={item.id} onClick={() => setActiveJob(item.id)}><span>{TASKS[item.type]}</span><span className="lit-tag">{STATUS[item.status]}</span><small>{new Date(item.created_at).toLocaleString()}</small></button>)}<h3 className="lit-audit-title">变更记录</h3>{data.audits.map(item => <div className="lit-audit-row" key={item.id}><span>{{ chapter_saved: '正文保存', chapter_accepted: '正文及记忆确认', entry_created: '新增设定', entry_updated: '设定更新', entry_deleted: '删除设定', book_updated: '作品更新', chapter_created: '新增章节', outline_proposed: '新增大纲候选' }[item.kind] || item.kind}</span><small>{new Date(item.created_at).toLocaleString()}</small></div>)}</>}
      </main>
      <aside className="lit-assistant" id="lit-panel-assistant">
        <header><Icon.Brain size={18} /><h2>创作助手</h2><Tool icon="ChevronRight" title="收起创作助手" onClick={() => setAssistantHidden(true)} /></header>
        <div className="lit-assistant-model"><Icon.Bot size={15} /><span>{models.find(model => model.id === book.model_config_id)?.model || '平台默认模型'}</span><Tool icon="Settings" title="配置创作模型" onClick={() => navigate(`${bookPath}/settings`)} /></div>
        {draftingReady ? <div className="lit-assistant-controls">
          <div className="lit-ai-task-tabs" role="tablist" aria-label="AI 创作阶段">{[['plan', '规划'], ['write', '写作'], ['review', '审校'], ['memory', '记忆']].map(([type, label]) => <button type="button" key={type} role="tab" aria-selected={currentTask === type || (currentTask === 'rewrite' && type === 'write')} onClick={() => setTaskSelection({ chapterId: chapter.id, type })}>{label}</button>)}</div>
          <Field label="本次创作要求"><textarea rows={4} value={instruction} onChange={event => setInstruction(event.target.value)} /></Field>
          {['write', 'rewrite'].includes(currentTask) && <Field label="单章目标字数"><input type="number" min="500" max="6000" step="500" value={targetWords} onChange={event => setTargetWords(Number(event.target.value))} /></Field>}
          <div className="lit-primary-task"><Tool icon={currentTask === 'review' ? 'CheckCircle' : currentTask === 'memory' ? 'Brain' : 'Pen'} title={TASKS[currentTask]} primary disabled={busy} onClick={() => startJob(currentTask)}>{TASKS[currentTask]}</Tool></div>
          <details className="lit-secondary-tasks"><summary>更多操作<Icon.ChevronDown size={14} /></summary><div><Tool icon="Edit" title="改写正文" disabled={busy} onClick={() => { setTaskSelection({ chapterId: chapter.id, type: 'rewrite' }) }}>改写正文</Tool><Tool icon="GitBranch" title="构思大纲" disabled={busy} onClick={() => startJob('outline')}>构思大纲</Tool></div></details>
        </div> : route.view === 'chapters' ? <div className="lit-assistant-context"><span className="lit-tag">正式正文</span><h3>{chapter?.title}</h3><Tool icon="Pen" title="进入创作计划修订" disabled={!chapterReady} onClick={() => navigate(`${bookPath}/drafts/${chapter.id}`)}>修订本章</Tool></div> : route.view === 'confirm' ? <div className="lit-assistant-context"><span className="lit-tag warning">作者确认</span><h3>正文与剧情记忆</h3><dl><div><dt>候选事实</dt><dd>{confirmationJob?.result.facts?.length || 0}</dd></div><div><dt>结果状态</dt><dd>{STATUS[confirmationJob?.status] || '加载中'}</dd></div></dl></div> : <div className="lit-assistant-controls"><div className="lit-assistant-context"><span className={`lit-tag ${selectedEntry?.status === 'candidate' ? 'warning' : ''}`}>{selectedEntry ? CATEGORIES[selectedEntry.kind] : '全书框架'}</span><h3>{selectedEntry?.title || book.title}</h3><dl><div><dt>框架节点</dt><dd>{data.entries.length}</dd></div><div><dt>正式正文</dt><dd>{formalChapters.length} 章</dd></div></dl></div><Field label="本次创作要求"><textarea rows={4} value={instruction} onChange={event => setInstruction(event.target.value)} /></Field><div className="lit-primary-task"><Tool icon="GitBranch" title="构思大纲" primary disabled={busy} onClick={() => startJob('outline')}>构思大纲</Tool></div></div>}
        {job && route.view !== 'confirm' && <JobResult job={job} busy={busy || (job.type !== 'outline' && !draftingReady)} onApply={applyJob} onRetry={() => startJob(job.type)} onMemory={() => navigate(`${bookPath}/confirm/${job.id}`)} onCancel={() => attempt(async () => { await api(`/books/${book.id}/jobs/${job.id}/cancel`, 'POST', {}); await refresh() })} />}
        {job?.result.notices?.map(notice => <p className="lit-warning" key={notice}>{notice}</p>)}
      </aside>
    </div></>)}
    {route.view === 'memory' && data?.facts.length < data?.factCount && <div className="lit-memory-more"><Tool icon="ChevronDown" title="更早的剧情记忆" onClick={() => attempt(async () => { const older = await api(`/books/${book.id}/facts?offset=${data.facts.length}`); setData(current => ({ ...current, facts: [...current.facts, ...older] })) })}>更早的剧情记忆</Tool></div>}
    {modal?.type === 'user' && <UserModal onClose={() => setModal(null)} onSave={value => attempt(async () => { await api('/users', 'POST', value); setModal(null) })} />}
    {modal?.type === 'context' && <Modal title="本章上下文包" onClose={() => setModal(null)}><div className="lit-context-stats"><span>设定 {context?.manifest.includedEntryIds.length}</span><span>事实 {context?.manifest.includedFactIds.length}</span><span>未来条目排除 {context?.manifest.excludedFutureEntries}</span><span>未纳入条目 {(context?.manifest.omittedEntries || 0) + (context?.manifest.omittedFacts || 0)}</span></div><pre className="lit-json">{JSON.stringify(context, null, 2)}</pre><footer><Tool icon="Download" title="导出上下文包" onClick={() => download(`${book.title}-第${chapter.ordinal}章-context.json`, JSON.stringify(context, null, 2))}>导出 JSON</Tool></footer></Modal>}
    {modal?.type === 'versions' && <Modal title="章节版本" onClose={() => setModal(null)}>{versions.map(item => <details className="lit-version" key={item.id}><summary>v{item.revision} · {new Date(item.created_at).toLocaleString()} · {item.content.length} 字</summary><pre>{item.content || '(空稿)'}</pre><Tool icon="History" title={`恢复 v${item.revision} 到草稿`} onClick={() => { setDraft({ title: item.title, content: item.content, plan: item.plan }); setModal(null) }}>恢复到草稿</Tool></details>)}</Modal>}
  </section>
}

function Login({ needsSetup, onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [setupKey, setSetupKey] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event) { event.preventDefault(); setBusy(true); setError(''); try { onLogin(await api(needsSetup ? '/auth/setup' : '/auth/login', 'POST', { username, password, setupKey })) } catch (failure) { setError(failure.message) } finally { setBusy(false) } }
  return <form className="lit-login" onSubmit={submit}><Icon.Book size={36} /><h1>{needsSetup ? '初始化文学创作' : '登录文学创作'}</h1><Field label="用户名"><input required maxLength={80} autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} /></Field><Field label="密码"><input required type="password" minLength={needsSetup ? 10 : undefined} maxLength={200} autoComplete={needsSetup ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} /></Field>{needsSetup && <Field label="初始化口令"><input type="password" autoComplete="off" value={setupKey} onChange={event => setSetupKey(event.target.value)} /></Field>}{error && <p role="alert" className="lit-warning">{error}</p>}<button className="lit-button primary" disabled={busy}>{busy ? '处理中...' : needsSetup ? '创建管理员账户' : '登录'}</button></form>
}
function useInlineGuard(form, registerGuard) {
  const [initial] = useState(() => JSON.stringify(form))
  const dirty = JSON.stringify(form) !== initial
  useEffect(() => {
    registerGuard?.({ dirty })
    return () => registerGuard?.(null)
  }, [dirty, registerGuard])
}
function WorkflowProgress({ chapter, jobs }) {
  const currentJobs = jobs.filter(job => job.chapter_id === chapter.id && job.chapter_revision === chapter.revision && ['ready', 'applied'].includes(job.status))
  const step = chapter.accepted_revision === chapter.revision ? 4 : currentJobs.some(job => job.type === 'memory') ? 3 : currentJobs.some(job => job.type === 'review') ? 2 : chapter.content.trim() ? 1 : 0
  return <ol className="lit-workflow-progress" aria-label="本章创作进度">{['构思', '正文', '审校', '记忆', '正式'].map((label, index) => <li key={label} className={index === step ? 'current' : index < step ? 'complete' : ''} aria-current={index === step ? 'step' : undefined}><span>{index < step ? <Icon.Check size={11} /> : index + 1}</span>{label}</li>)}</ol>
}
function BookEditor({ value, models, onSave, onDelete, onClose, registerGuard }) {
  const [form, setForm] = useState(value || { title: '', genre: '', premise: '', style: '', instructions: '', model_config_id: '' })
  const [pending, setPending] = useState(false)
  useInlineGuard(form, registerGuard)
  const update = (key, val) => setForm({ ...form, [key]: val })
  return <section className="lit-inline-editor" aria-label={value ? '作品与模型配置' : '新建作品'}>
    <header className="lit-section-heading"><h2>{value ? '作品与模型配置' : '新建作品'}</h2><Tool icon="ChevronLeft" title="返回" onClick={onClose} disabled={pending} /></header>
    <form onSubmit={async event => { event.preventDefault(); setPending(true); try { await onSave(form) } finally { setPending(false) } }}><fieldset disabled={pending}>
      <section className="lit-form-section"><h3>作品信息</h3><div className="lit-form-grid"><Field label="作品名称"><input required maxLength={200} value={form.title} onChange={event => update('title', event.target.value)} /></Field><Field label="题材"><input maxLength={100} value={form.genre} onChange={event => update('genre', event.target.value)} /></Field></div>
      <Field label="作品简介"><textarea rows={4} maxLength={12000} value={form.premise} onChange={event => update('premise', event.target.value)} /></Field></section>
      <section className="lit-form-section"><h3>创作基准</h3><Field label="文风基准"><textarea rows={4} maxLength={6000} value={form.style} onChange={event => update('style', event.target.value)} /></Field>
      <Field label="全书约束"><textarea rows={4} maxLength={6000} value={form.instructions} onChange={event => update('instructions', event.target.value)} /></Field></section>
      {value && <Field label="创作模型"><select value={form.model_config_id} onChange={event => update('model_config_id', event.target.value)}><option value="">平台当前默认模型</option>{models.map(model => <option key={model.id} value={model.id}>{model.name} · {model.model}</option>)}</select></Field>}
      <footer>{value && <Tool icon="Trash" title="永久删除作品" onClick={onDelete} />}<button className="lit-button primary" type="submit"><Icon.Save size={16} />{pending ? '保存中...' : '保存'}</button></footer>
    </fieldset></form>
  </section>
}
function EntryEditor({ value, kind, parentId, entries, onSave, onDelete, onClose, registerGuard }) {
  const [form, setForm] = useState(value ? { ...value, parent_id: value.parent_id || '' } : { kind, title: '', body: '', data: {}, status: 'confirmed', locked: false, reveal_chapter: 1, parent_id: parentId || '' })
  const [pending, setPending] = useState(false)
  useInlineGuard(form, registerGuard)
  const update = (key, val) => setForm({ ...form, [key]: val })
  const readonly = Boolean(value?.locked && form.locked)
  const blocked = new Set(value ? [value.id] : [])
  for (let changed = true; changed;) { changed = false; for (const entry of entries) if (blocked.has(entry.parent_id) && !blocked.has(entry.id)) { blocked.add(entry.id); changed = true } }
  return <section className="lit-inline-editor" aria-label={`${value ? '编辑' : '新增'}${CATEGORIES[form.kind]}节点`}>
    <header className="lit-section-heading"><div><span className="lit-editor-breadcrumb">创作框架 / {CATEGORIES[form.kind]}</span><h2>{value?.title || `新增${CATEGORIES[form.kind]}节点`}</h2></div><div className="lit-actions"><span className={`lit-tag ${form.status === 'candidate' ? 'warning' : ''}`}>{form.locked ? '已锁定' : form.status === 'confirmed' ? '已确认' : '候选'}</span><Tool icon="ChevronLeft" title="返回分类" onClick={onClose} disabled={pending} /></div></header>
    <form onSubmit={async event => { event.preventDefault(); setPending(true); try { await onSave({ ...form, confirmUnlock: Boolean(value?.locked && !form.locked) }) } finally { setPending(false) } }}><fieldset disabled={pending}>
      <section className="lit-form-section"><h3>基本信息</h3><div className="lit-form-grid"><Field label="节点名称"><input required maxLength={200} readOnly={readonly} value={form.title} onChange={event => update('title', event.target.value)} /></Field>
      <Field label="上级节点"><select disabled={readonly} value={form.parent_id} onChange={event => update('parent_id', event.target.value)}><option value="">分类根节点</option>{entries.filter(entry => entry.kind === form.kind && !blocked.has(entry.id)).map(entry => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></Field></div>
      <Field label="详细设定"><textarea rows={5} maxLength={12000} readOnly={readonly} value={form.body} onChange={event => update('body', event.target.value)} /></Field></section>
      <section className="lit-form-section"><h3>{form.kind === 'character' ? '人物画像' : '核心要点'}</h3><div className="lit-structured-fields">{(FIELDS[form.kind] || []).map(field => <Field key={field} label={field}><textarea rows={3} readOnly={readonly} value={form.data[field] || ''} onChange={event => update('data', { ...form.data, [field]: event.target.value })} /></Field>)}</div></section>
      <details className="lit-form-constraints" open={Boolean(form.locked)}><summary>约束与状态<Icon.ChevronDown size={14} /></summary><div className="lit-form-grid"><Field label="状态"><select disabled={readonly} value={form.status} onChange={event => update('status', event.target.value)}><option value="confirmed">作者已确认</option><option value="candidate">候选方案</option></select></Field><Field label="第几章起可供创作使用"><input disabled={readonly} type="number" min="1" value={form.reveal_chapter} onChange={event => update('reveal_chapter', Number(event.target.value))} /></Field></div>
      <label className="lit-checkbox"><input type="checkbox" checked={form.locked} onChange={event => update('locked', event.target.checked)} />锁定设定</label></details>
      <footer>{value && <Tool icon="Trash" title="删除节点" disabled={value.locked} onClick={onDelete} />}<button type="submit" disabled={readonly} className="lit-button primary"><Icon.Save size={16} />{pending ? '保存中...' : '保存节点'}</button></footer>
    </fieldset></form>
  </section>
}
function UserModal({ onSave, onClose }) {
  const [form, setForm] = useState({ username: '', password: '' })
  return <Modal title="创建作者账户" onClose={onClose}><form onSubmit={event => { event.preventDefault(); onSave(form) }}><Field label="用户名"><input required maxLength={80} autoComplete="off" value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} /></Field><Field label="密码"><input required minLength={10} type="password" autoComplete="new-password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /></Field><footer><button type="submit" className="lit-button primary"><Icon.User size={16} />创建账户</button></footer></form></Modal>
}
function MemoryReview({ job, entries, onAccept, onClose, registerGuard }) {
  const [summary, setSummary] = useState(job.result.summary || '')
  const [selected, setSelected] = useState((job.result.facts || []).map((_, index) => index))
  const [facts, setFacts] = useState(job.result.facts || [])
  const [pending, setPending] = useState(false)
  useInlineGuard({ summary, selected, facts }, registerGuard)
  const change = (index, key, value) => setFacts(current => current.map((fact, position) => position === index ? { ...fact, [key]: value } : fact))
  return <section className="lit-inline-editor" aria-label="确认正文与剧情记忆">
    <header className="lit-section-heading"><h2>确认正文与剧情记忆</h2><Tool icon="ChevronLeft" title="返回草稿" onClick={onClose} disabled={pending} /></header>
    {job.status !== 'ready' && <p className="lit-warning">此记忆结果已失效或已采纳，不能重复确认。</p>}
    <Field label="章节事实摘要"><textarea rows={5} maxLength={4000} value={summary} onChange={event => setSummary(event.target.value)} /></Field>
    <div className="lit-fact-candidates">{facts.map((fact, index) => <article key={index}>
      <label className="lit-checkbox"><input type="checkbox" checked={selected.includes(index)} onChange={event => setSelected(event.target.checked ? [...selected, index] : selected.filter(item => item !== index))} /><strong>{entries.find(entry => entry.id === fact.entity_id)?.title || '剧情事实'} · {fact.key}</strong></label>
      <div className="lit-form-grid"><Field label="记忆分类"><select value={fact.kind || 'state'} onChange={event => change(index, 'kind', event.target.value)}><option value="state">状态</option><option value="event">事件</option><option value="knowledge">人物认知</option><option value="foreshadow">伏笔进展</option></select></Field><Field label="状态或事件名称"><input value={fact.key} maxLength={100} onChange={event => change(index, 'key', event.target.value)} /></Field></div>
      <Field label="事实内容"><textarea rows={2} value={fact.value} maxLength={2000} onChange={event => change(index, 'value', event.target.value)} /></Field>
      <Field label="原文依据"><textarea rows={2} value={fact.quote} maxLength={1200} onChange={event => change(index, 'quote', event.target.value)} /></Field>
      <div className="lit-entity-picker">{entries.filter(entry => entry.kind === 'character').map(entry => <label key={entry.id}><input type="checkbox" checked={fact.known_by.includes(entry.id)} onChange={event => change(index, 'known_by', event.target.checked ? [...fact.known_by, entry.id] : fact.known_by.filter(value => value !== entry.id))} />{entry.title}知情</label>)}</div>
    </article>)}</div>
    <footer><Tool icon="CheckCircle" title="确认正文与所选记忆" primary disabled={!summary.trim() || pending || job.status !== 'ready'} onClick={async () => { setPending(true); try { await onAccept({ summary, selected, overrides: selected.map(index => ({ index, ...facts[index] })) }) } finally { setPending(false) } }}>确认并加入正式正文</Tool></footer>
  </section>
}

function FrameworkOverview({ kind, entries, onSelect, onAdd }) {
  const items = entries.filter(entry => entry.kind === kind)
  const ids = new Set(items.map(entry => entry.id))
  function branch(parentId = null, depth = 0) {
    return <ul>{items.filter(entry => (entry.parent_id && ids.has(entry.parent_id) ? entry.parent_id : null) === parentId).map(entry => <li key={entry.id}><button type="button" style={{ paddingLeft: Math.min(depth, 6) * 16 + 12 }} onClick={() => onSelect(entry.id)}><Icon.Grid size={14} /><strong>{entry.title}</strong><span className={`lit-tag ${entry.status === 'candidate' ? 'warning' : ''}`}>{entry.status === 'candidate' ? '候选' : '已确认'}</span></button>{branch(entry.id, depth + 1)}</li>)}</ul>
  }
  return <section className="lit-framework-index"><div className="lit-section-heading"><h2>{CATEGORIES[kind]}</h2><Tool icon="Plus" title={`新增${CATEGORIES[kind]}节点`} onClick={onAdd}>新增节点</Tool></div>{items.length ? branch() : <div className="lit-empty"><Icon.Folder size={30} /><h3>暂无框架节点</h3></div>}</section>
}

function JobResult({ job, busy, onApply, onRetry, onMemory, onCancel }) {
  return <div className="lit-job-result">
    <header><strong>{TASKS[job.type]}</strong><span className={`lit-tag ${['failed', 'stale'].includes(job.status) ? 'warning' : ''}`}>{STATUS[job.status]}</span></header>
    {['queued', 'running'].includes(job.status) && <div className="lit-running"><Icon.Loader size={18} /><span>{STAGE[job.stage]}</span><Tool icon="X" title="取消生成" onClick={onCancel} /></div>}
    {job.error && <p className="lit-warning">{job.error}</p>}
    {job.result.scenePlan && <details><summary>场景方案</summary><p>{job.result.scenePlan}</p></details>}
    {job.result.content && <div className="lit-generated-text">{job.result.content}</div>}
    {job.type === 'plan' && Object.entries(job.result).filter(([key]) => key !== 'usage').map(([key, value]) => <div key={key}><strong>{key}</strong><p>{typeof value === 'string' ? value : JSON.stringify(value)}</p></div>)}
    {job.type === 'review' && <><p>{job.result.summary}</p>{job.result.issues?.map((issue, index) => <article className="lit-issue" key={index}><span className={`lit-tag ${issue.severity === 'high' ? 'warning' : ''}`}>{{ high: '高', medium: '中', low: '低' }[issue.severity]}</span><blockquote>{issue.quote}</blockquote><p>{issue.reason}</p><p>{issue.suggestion}</p>{!issue.located && <small>原文未定位，需人工核实</small>}</article>)}</>}
    {job.type === 'memory' && <><p>{job.result.summary}</p><span>{job.result.facts?.length || 0} 条候选事实</span>{job.status === 'ready' && <Tool icon="CheckCircle" title="检查并确认正文与记忆" primary disabled={busy} onClick={onMemory}>检查并确认</Tool>}</>}
    {job.status === 'ready' && ['outline', 'plan', 'write', 'rewrite'].includes(job.type) && <Tool icon="Check" title={job.type === 'outline' ? '保存为大纲候选' : '采纳到章节草稿'} primary disabled={busy} onClick={() => onApply(job)}>{job.type === 'outline' ? '保存为大纲候选' : '采纳到草稿'}</Tool>}
    {['failed', 'cancelled', 'stale'].includes(job.status) && <Tool icon="Refresh" title="重新生成" disabled={busy} onClick={onRetry}>重新生成</Tool>}
  </div>
}
