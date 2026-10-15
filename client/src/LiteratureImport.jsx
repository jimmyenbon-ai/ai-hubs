import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from './components/Icons'
import { Field, Tool } from './components/LiteratureControls'
import './LiteratureImport.css'

const LABELS = { preview: '待确认原稿', imported: '待分析', analyzing: '分析中', paused: '已暂停', review: '待审核', complete: '已审核', pending: '待分析', running: '分析中', ready: '待审核', accepted: '已确认', failed: '失败', stale: '待重建', superseded: '已细分归档', new: '可导入', duplicate: '重复跳过', conflict: '重名冲突', excluded: '已排除', public: '公开事实', private: '限定知情', unknown: '待核实' }
const KINDS = { outline: '大纲', volume: '分卷', mainline: '主线', subplot: '支线', character: '人物', plot: '剧情', item: '武器 / 物品', scene: '场景', faction: '势力', world: '世界规则', style: '文风', foreshadow: '伏笔' }
const key = value => String(value).trim().toLocaleLowerCase()
const splitNames = value => value.split(/[,，、\n]/).map(name => name.trim()).filter(Boolean)

export default function LiteratureImport({ book, entries, chapters, route, api, navigate, onChanged, registerGuard }) {
  const base = `/books/${book.id}`
  const path = `/literature${base}/imports`
  const [listing, setListing] = useState(null)
  const [report, setReport] = useState(null)
  const [detail, setDetail] = useState(null)
  const [unit, setUnit] = useState(null)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [offset, setOffset] = useState(0)
  const [filter, setFilter] = useState('')
  const [chapterPage, setChapterPage] = useState(0)
  const [selected, setSelected] = useState([])
  const [batchReviewed, setBatchReviewed] = useState(false)
  const activeKey = useRef('')
  activeKey.current = `${book.id}/${route.importId}/${route.unitId}/${offset}/${filter}`
  const reload = useCallback(async () => {
    const requestKey = `${book.id}/${route.importId}/${route.unitId}/${offset}/${filter}`
    const list = await api(`${base}/imports`)
    const check = await api(`${base}/takeover`)
    const batch = route.importId && route.importId !== 'new' ? await api(`${base}/imports/${route.importId}?offset=${offset}&status=${filter}`) : null
    const item = route.unitId ? await api(`${base}/imports/${route.importId}/units/${route.unitId}`) : null
    if (activeKey.current !== requestKey) return
    setListing(list); setReport(check); setDetail(batch); setUnit(item)
  }, [api, base, book.id, route.importId, route.unitId, offset, filter])
  useEffect(() => { let live = true; reload().catch(failure => { if (live) setError(failure.message) }); return () => { live = false } }, [reload])
  useEffect(() => {
    if (detail?.status !== 'analyzing' && !listing?.imports.some(item => item.status === 'analyzing')) return
    const timer = setInterval(() => reload().catch(failure => setError(failure.message)), 5000)
    return () => clearInterval(timer)
  }, [detail?.status, listing, reload])
  async function action(fn) {
    setPending(true); setError('')
    try { await fn(); await onChanged(); await reload(); return true } catch (failure) { setError(failure.message); return false } finally { setPending(false) }
  }
  function open(importId = '', unitId = '') { setOffset(0); setFilter(''); setChapterPage(0); setSelected([]); setBatchReviewed(false); setPreview(null); return navigate(`${path}${importId ? `/${importId}` : ''}${unitId ? `/units/${unitId}` : ''}`) }
  async function sourceDownload() {
    const source = await api(`${base}/imports/${route.importId}/source`)
    const url = URL.createObjectURL(new Blob([source.text], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = source.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const current = detail?.id === route.importId ? detail : null
  const currentUnit = unit?.id === route.unitId ? unit : null
  const counts = Object.fromEntries((current?.counts || []).map(item => [item.status, item.n]))
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
  const processed = (counts.ready || 0) + (counts.accepted || 0)

  return <section className="lit-import-workspace" aria-label="导入与接管">
    <header className="lit-section-heading"><div><span className="lit-editor-breadcrumb">原作接管</span><h2>{route.unitId ? '拆解审核' : route.importId === 'new' ? '导入原稿' : current?.name || '导入与接管'}</h2></div><div className="lit-actions">{route.importId && <Tool icon="ChevronLeft" title="返回导入列表" disabled={pending} onClick={() => open()} />}{!route.importId && <Tool icon="Upload" title="导入新原稿" primary onClick={() => open('new')}>导入原稿</Tool>}</div></header>
    {error && <div className="lit-import-error" role="alert"><Icon.AlertTriangle size={16} /><span>{error}</span><Tool icon="X" title="关闭导入提示" onClick={() => setError('')} /></div>}
    {route.importId === 'new' ? <UploadForm api={api} base={base} pending={pending} action={action} onCreated={batch => { registerGuard(null); open(batch.id) }} registerGuard={registerGuard} /> : route.unitId ? !currentUnit ? <div className="lit-loading">加载原文与拆解结果...</div> : <UnitReview key={`${currentUnit.id}:${currentUnit.status}`} unit={currentUnit} entries={entries} pending={pending} registerGuard={registerGuard} onBack={() => open(route.importId)} onSplit={() => action(async () => { await api(`${base}/imports/${route.importId}/units/${currentUnit.id}/split`, 'POST', {}); registerGuard(null); await open(route.importId) })} onAccept={value => action(async () => { await api(`${base}/imports/${route.importId}/units/${currentUnit.id}/accept`, 'POST', value); registerGuard(null); await open(route.importId) })} /> : current ? <>
      <div className="lit-import-batch-meta"><span className={`lit-tag ${['paused', 'review'].includes(current.status) ? 'warning' : ''}`}>{LABELS[current.status]}</span><span>{current.characters.toLocaleString()} 字符</span><span>{current.chapters.length} 个章节 / 片段</span><Tool icon="Download" title="下载原始上传文本" onClick={() => action(sourceDownload)} disabled={pending} /></div>
      {current.status === 'preview' ? <>
        <div className="lit-import-toolbar"><span>章节预览</span><Tool icon="CheckCircle" title="确认并导入原文" primary disabled={pending || current.chapters.every(chapter => ['excluded', 'duplicate'].includes(chapter.action))} onClick={() => { if (window.confirm('确认章节顺序和完整状态？完整章节将作为“作者导入”正式正文保存，系统不会覆盖旧章。')) action(() => api(`${base}/imports/${current.id}/commit`, 'POST', { confirm: true })) }}>确认导入原文</Tool></div>
        <div className="lit-import-chapter-preview">{current.chapters.slice(chapterPage * 50, chapterPage * 50 + 50).map((chapter, index) => <PreviewRow key={`${chapter.id}:${chapter.title}:${chapter.action}:${chapter.partial}`} chapter={chapter} index={chapterPage * 50 + index} pending={pending} onPreview={() => action(async () => setPreview(await api(`${base}/imports/${current.id}/chapters/${chapter.id}`)))} onUpdate={value => action(() => api(`${base}/imports/${current.id}/chapters/${chapter.id}`, 'PUT', value))} onMove={direction => action(async () => { const order = current.chapters.map(item => item.id); const from = order.indexOf(chapter.id), to = from + direction; if (to < 0 || to >= order.length) return; [order[from], order[to]] = [order[to], order[from]]; await api(`${base}/imports/${current.id}/reorder`, 'POST', { order }) })} last={chapterPage * 50 + index === current.chapters.length - 1} />)}</div>
        <Pagination offset={chapterPage * 50} total={current.chapters.length} onChange={value => setChapterPage(value / 50)} pending={pending} />
        {preview && <section className="lit-import-original"><header><h3>{preview.title}</h3><Tool icon="X" title="关闭原文预览" onClick={() => setPreview(null)} /></header><pre>{preview.content}</pre></section>}
      </> : <>
        <div className="lit-import-progress"><div><strong>{processed} / {total}</strong><span>已拆解 · {counts.accepted || 0} 段已确认</span></div><progress max={Math.max(1, total)} value={processed} aria-label="原稿拆解进度" /></div>
        <div className="lit-import-toolbar"><div className="lit-actions">{current.status === 'analyzing' ? <Tool icon="Pause" title="暂停原稿分析" disabled={pending} onClick={() => action(() => api(`${base}/imports/${current.id}/pause`, 'POST', {}))}>暂停分析</Tool> : <Tool icon="Play" title="开始或继续原稿分析" primary disabled={pending || !(counts.pending || counts.failed)} onClick={() => action(() => api(`${base}/imports/${current.id}/start`, 'POST', {}))}>开始 / 继续分析</Tool>}<Tool icon="Refresh" title="确认当前修订并重建失效分析" disabled={pending || current.status === 'analyzing'} onClick={() => { if (window.confirm('将本批已导入章节的当前保存稿确认为正文，并重建失效分析。原始上传文件和旧版本仍保留。')) action(() => api(`${base}/imports/${current.id}/rebuild`, 'POST', { confirm: true })) }} /></div><select aria-label="筛选分析状态" value={filter} onChange={event => { setFilter(event.target.value); setOffset(0); setSelected([]) }}><option value="">全部分段</option>{['ready', 'accepted', 'pending', 'running', 'failed', 'stale'].map(status => <option key={status} value={status}>{LABELS[status]}</option>)}</select></div>
        <div className="lit-import-units">{current.units.map(item => <article key={item.id}><input type="checkbox" aria-label={`选择 ${item.title} 片段 ${item.position + 1}`} disabled={pending || !item.batch_safe} checked={selected.includes(item.id)} onChange={event => { setSelected(event.target.checked ? [...selected, item.id] : selected.filter(value => value !== item.id)); setBatchReviewed(false) }} /><button type="button" onClick={() => open(current.id, item.id)}><div><strong>{item.title} · 片段 {item.position + 1}</strong><span className={`lit-tag ${['failed', 'stale'].includes(item.status) ? 'warning' : ''}`}>{LABELS[item.status]}</span></div><p>{item.error || item.summary || `${item.end_offset - item.start_offset} 字符`}</p>{item.entry_count !== undefined && <small>{item.entry_count} 个框架候选 · {item.fact_count} 条事实候选</small>}</button><Tool icon="ChevronRight" title={`审核 ${item.title} 片段 ${item.position + 1}`} onClick={() => open(current.id, item.id)} /></article>)}</div>
        {selected.length > 0 && <div className="lit-import-bulk"><label className="lit-checkbox"><input type="checkbox" checked={batchReviewed} onChange={event => setBatchReviewed(event.target.checked)} />已核对所选分段的原文和公开、明确的分析结果</label><Tool icon="CheckCircle" title="批量确认所选公开结果" primary disabled={pending || !batchReviewed || selected.length > 20} onClick={() => action(async () => { await api(`${base}/imports/${current.id}/accept-batch`, 'POST', { unitIds: selected, reviewed: true }); setSelected([]); setBatchReviewed(false) })}>确认所选 {selected.length} 段</Tool></div>}
        <Pagination offset={offset} total={current.unitCount} onChange={value => { setOffset(value); setSelected([]) }} pending={pending} />
        <Tool icon="Target" title="前往接管检查" disabled={pending} onClick={() => open()}>接管检查</Tool>
      </>}
    </> : !route.importId ? <>
      <ol className="lit-import-steps"><li><span>1</span>原稿整理</li><li><span>2</span>分段拆解</li><li><span>3</span>核实确认</li><li><span>4</span>接管续写</li></ol>
      <section className="lit-import-takeover"><header><h3>接管检查</h3><span className={`lit-tag ${report?.problems.length ? 'warning' : ''}`}>{report?.snapshot?.status === 'ready' && !report?.problems.length ? '已建立接管点' : report?.problems.length ? '前文待核实' : '待建立接管点'}</span></header><div className="lit-import-metrics"><div><strong>{report?.importedChapters || 0}</strong><span>导入完整章节</span></div><div><strong>{report?.problems.length || 0}</strong><span>待完成审核</span></div><div><strong>{entries.length}</strong><span>创作框架</span></div><div><strong>{report?.partials.length || 0}</strong><span>未完成片段</span></div></div>
        {report?.problems.length > 0 && <ul className="lit-import-problems">{report.problems.slice(0, 20).map(problem => <li key={problem.chapterId}><span>{problem.title}</span><small>{problem.reason}</small></li>)}{report.problems.length > 20 && <li>另有 {report.problems.length - 20} 章待处理</li>}</ul>}
        {report?.partials.map(partial => <p className="lit-import-partial" key={partial.id}><Icon.Pen size={14} />未完成：{partial.title}</p>)}
        <div className="lit-import-takeover-action"><span>{chapters.find(chapter => chapter.ordinal === report?.cutoff)?.accepted_title || chapters.find(chapter => chapter.ordinal === report?.cutoff)?.title || '尚无完整章节'}</span><Tool icon="Target" title="建立接管点并进入续写" primary disabled={pending || !listing?.imports.some(item => item.status !== 'preview') || Boolean(report?.problems.length) || listing?.imports.some(item => item.status === 'analyzing')} onClick={() => action(async () => { const result = await api(`${base}/takeover`, 'POST', {}); registerGuard(null); await navigate(`/literature${base}/drafts/${result.chapterId}`) })}>建立接管点并续写</Tool></div>
      </section>
      <section className="lit-import-batches"><h3>导入批次</h3>{listing?.imports.map(batch => <button key={batch.id} type="button" onClick={() => open(batch.id)}><Icon.FileText size={20} /><div><strong>{batch.name}</strong><small>{batch.characters.toLocaleString()} 字符 · {new Date(batch.created_at).toLocaleDateString()}{batch.total ? ` · ${batch.accepted}/${batch.total} 段已确认` : ''}</small></div><span className="lit-tag">{LABELS[batch.status]}</span><Icon.ChevronRight size={15} /></button>)}{listing?.imports.length === 0 && <div className="lit-empty"><Icon.Upload size={30} /><h3>尚未导入原作</h3><Tool icon="Upload" title="上传已有小说" onClick={() => open('new')}>导入原稿</Tool></div>}</section>
    </> : <div className="lit-loading">加载导入批次...</div>}
  </section>
}

function Pagination({ offset, total, onChange, pending }) {
  if (total <= 50) return null
  return <div className="lit-import-pagination"><span>{Math.floor(offset / 50) + 1} / {Math.ceil(total / 50)}</span><Tool icon="ChevronLeft" title="上一页" disabled={pending || offset === 0} onClick={() => onChange(Math.max(0, offset - 50))} /><Tool icon="ChevronRight" title="下一页" disabled={pending || offset + 50 >= total} onClick={() => onChange(offset + 50)} /></div>
}
function UploadForm({ api, base, pending, action, onCreated, registerGuard }) {
  const [sourceText, setSource] = useState('')
  const [name, setName] = useState('')
  const [encoding, setEncoding] = useState('utf-8')
  const [mode, setMode] = useState('auto')
  const [chunkSize, setChunkSize] = useState(6000)
  const [lastPartial, setLastPartial] = useState(false)
  const requestId = useRef(crypto.randomUUID())
  const fileRef = useRef(null)
  useEffect(() => { registerGuard({ dirty: Boolean(sourceText) }); return () => registerGuard(null) }, [sourceText, registerGuard])
  const updateSource = value => { setSource(value); requestId.current = crypto.randomUUID() }
  return <form className="lit-import-upload" onSubmit={event => { event.preventDefault(); action(async () => { const batch = await api(`${base}/imports`, 'POST', { name: name || '导入原稿.txt', sourceText, mode, chunkSize, lastPartial, requestId: requestId.current }); onCreated(batch) }) }}><fieldset disabled={pending}>
    <div className="lit-import-file-row"><input ref={fileRef} type="file" aria-label="选择小说原稿文件" accept=".txt,.md,.markdown,text/plain,text/markdown" onChange={event => { const file = event.target.files?.[0]; if (file) action(async () => { if (!/\.(txt|md|markdown)$/i.test(file.name) || file.size > 8000000) throw new Error('请选择 8 MB 以内的 TXT / Markdown 文件；更长作品可分卷上传'); const content = new TextDecoder(encoding, { fatal: true }).decode(await file.arrayBuffer()); if (content.length > 2000000) throw new Error('单批最多 200 万字符，请分卷上传'); setName(file.name); updateSource(content) }) }} /><select aria-label="原稿文件编码" value={encoding} onChange={event => { setEncoding(event.target.value); if (fileRef.current) fileRef.current.value = '' }}><option value="utf-8">UTF-8</option><option value="gb18030">GB18030 / GBK</option></select></div>
    <Field label="导入批次名称"><input maxLength={200} value={name} onChange={event => setName(event.target.value)} /></Field>
    <Field label="原稿文本"><textarea required rows={13} maxLength={2000000} spellCheck={false} value={sourceText} onChange={event => updateSource(event.target.value)} /></Field>
    <div className="lit-form-grid"><Field label="分章方式"><select value={mode} onChange={event => setMode(event.target.value)}><option value="auto">识别章节标题</option><option value="segments">按段落分段</option></select></Field><Field label="AI 单段分析长度"><select value={chunkSize} onChange={event => setChunkSize(Number(event.target.value))}><option value={3000}>3000 字符</option><option value={6000}>6000 字符</option><option value={10000}>10000 字符</option></select></Field></div>
    <label className="lit-checkbox"><input type="checkbox" checked={lastPartial} onChange={event => setLastPartial(event.target.checked)} />最后一章尚未写完</label>
    <footer><span>{sourceText.length.toLocaleString()} / 2,000,000 字符</span><button className="lit-button primary" type="submit" disabled={!sourceText.trim() || pending}><Icon.Search size={16} />{pending ? '整理中...' : '生成章节预览'}</button></footer>
  </fieldset></form>
}
function PreviewRow({ chapter, index, pending, onUpdate, onPreview, onMove, last }) {
  const [title, setTitle] = useState(chapter.title)
  return <article className={`lit-import-preview-row ${chapter.action === 'excluded' ? 'excluded' : ''}`}><div className="lit-import-preview-number">{index + 1}</div><div className="lit-import-preview-fields"><input aria-label={`第 ${index + 1} 项章节名称`} value={title} maxLength={200} disabled={pending} onChange={event => setTitle(event.target.value)} onBlur={() => { if (title !== chapter.title && title.trim()) onUpdate({ title, partial: chapter.partial, excluded: chapter.action === 'excluded' }) }} /><div><span className={`lit-tag ${chapter.action === 'conflict' ? 'warning' : ''}`}>{LABELS[chapter.action]}</span><small>{chapter.characters.toLocaleString()} 字符{chapter.volume ? ` · ${chapter.volume}` : ''}</small></div><div className="lit-import-preview-checks"><label><input type="checkbox" checked={Boolean(chapter.partial)} disabled={pending} onChange={event => onUpdate({ partial: event.target.checked, excluded: chapter.action === 'excluded' })} />未完成片段</label><label><input type="checkbox" checked={chapter.action === 'excluded'} disabled={pending} onChange={event => onUpdate({ partial: chapter.partial, excluded: event.target.checked })} />排除</label></div></div><div className="lit-import-preview-actions"><Tool icon="Eye" title={`预览 ${chapter.title}`} onClick={onPreview} disabled={pending} /><Tool icon="ChevronLeft" title={`上移 ${chapter.title}`} disabled={pending || index === 0} onClick={() => onMove(-1)} /><Tool icon="ChevronRight" title={`下移 ${chapter.title}`} disabled={pending || last} onClick={() => onMove(1)} /></div></article>
}
function UnitReview({ unit, entries, pending, onAccept, onSplit, onBack, registerGuard }) {
  const result = unit.result
  const accepted = result.review
  const [summary, setSummary] = useState(accepted?.summary || result.summary || '')
  const [summaryAccess, setSummaryAccess] = useState({ visibility: accepted?.summaryVisibility || ([...(result.entries || []), ...(result.facts || [])].some(item => item.visibility !== 'public') ? 'unknown' : 'public'), known_by: accepted?.summaryKnownBy || [] })
  const [entryForms, setEntryForms] = useState(() => (result.entries || []).map((entry, index) => {
    const matches = entries.filter(existing => existing.kind === entry.kind && key(existing.title) === key(entry.title))
    const saved = accepted?.entries.find(choice => choice.index === index)
    return { ...entry, index, selected: accepted ? Boolean(saved) : true, targetId: matches.length === 1 ? matches[0].id : '', ...saved }
  }))
  const [factForms, setFactForms] = useState(() => (result.facts || []).map((fact, index) => { const saved = accepted?.facts.find(choice => choice.index === index); return { ...fact, index, selected: accepted ? Boolean(saved) : true, ...saved } }))
  const [acknowledgeIssues, setAcknowledge] = useState(Boolean(accepted?.acknowledgeIssues))
  const [initial] = useState(() => JSON.stringify({ summary, summaryAccess, entryForms, factForms, acknowledgeIssues }))
  const dirty = unit.status === 'ready' && JSON.stringify({ summary, summaryAccess, entryForms, factForms, acknowledgeIssues }) !== initial
  useEffect(() => { registerGuard({ dirty }); return () => registerGuard(null) }, [dirty, registerGuard])
  const updateEntry = (index, patch) => setEntryForms(items => items.map((item, i) => i === index ? { ...item, ...patch } : item))
  const updateFact = (index, patch) => setFactForms(items => items.map((item, i) => i === index ? { ...item, ...patch } : item))
  const readonly = unit.status !== 'ready'
  return <div className="lit-import-review"><div className="lit-import-review-meta"><span className={`lit-tag ${['failed', 'stale'].includes(unit.status) ? 'warning' : ''}`}>{LABELS[unit.status]}</span><span>{unit.title} · 片段 {unit.position + 1} · v{unit.source_revision}</span><Tool icon="ChevronLeft" title="返回分段列表" onClick={onBack} disabled={pending} /></div>
    {unit.error && <p className="lit-warning">{unit.error}</p>}
    {['failed', 'stale', 'pending', 'ready'].includes(unit.status) && unit.content.length >= 1500 && <Tool icon="GitBranch" title="拆成更小分段" disabled={pending} onClick={onSplit}>拆成更小分段</Tool>}
    <section className="lit-import-original"><header><h3>原文依据</h3><small>字符 {unit.start_offset + 1}–{unit.end_offset}</small></header><pre>{unit.content}</pre></section>
    {result.summary && <form onSubmit={event => { event.preventDefault(); onAccept({ summary, summaryVisibility: summaryAccess.visibility, summaryKnownBy: summaryAccess.known_by, entries: entryForms.filter(item => item.selected), facts: factForms.filter(item => item.selected), acknowledgeIssues }) }}><fieldset disabled={pending || readonly}>
      <Field label="本段事实摘要"><textarea rows={4} maxLength={2000} value={summary} onChange={event => setSummary(event.target.value)} /></Field>
      <AccessFields value={summaryAccess} onChange={patch => setSummaryAccess({ ...summaryAccess, ...patch })} />
      {result.issues?.length > 0 && <section className="lit-import-review-issues"><h3>待核实问题</h3><ul>{result.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul><label className="lit-checkbox"><input type="checkbox" checked={acknowledgeIssues} onChange={event => setAcknowledge(event.target.checked)} />已核对本段问题和所选结论</label></section>}
      <section className="lit-import-review-section"><h3>框架与实体 · {entryForms.length}</h3>{entryForms.map((entry, index) => <article key={index} className={!entry.selected ? 'unselected' : ''}><label className="lit-checkbox"><input type="checkbox" checked={entry.selected} onChange={event => updateEntry(index, { selected: event.target.checked })} /><span className="lit-tag">{KINDS[entry.kind]}</span><strong>{entry.title}</strong></label><blockquote>{entry.quote}</blockquote><div className="lit-form-grid"><Field label="实体名称"><input value={entry.title} maxLength={100} onChange={event => updateEntry(index, { title: event.target.value })} /></Field><Field label="实体对应"><select value={entry.targetId} onChange={event => updateEntry(index, { targetId: event.target.value })}><option value="">新增独立节点</option>{entries.filter(existing => existing.kind === entry.kind).map(existing => <option key={existing.id} value={existing.id}>复用：{existing.title}{existing.locked ? '（已锁定）' : ''}</option>)}</select></Field></div>{!entry.targetId && <Field label="框架内容"><textarea rows={3} maxLength={2000} value={entry.body} onChange={event => updateEntry(index, { body: event.target.value })} /></Field>}{entry.aliases?.length > 0 && <p className="lit-import-aliases">别名候选：{entry.aliases.join('、')}</p>}<AccessFields value={entry} onChange={patch => updateEntry(index, patch)} /></article>)}</section>
      <section className="lit-import-review-section"><h3>事件与状态 · {factForms.length}</h3>{factForms.map((fact, index) => <article key={index} className={!fact.selected ? 'unselected' : ''}><label className="lit-checkbox"><input type="checkbox" checked={fact.selected} onChange={event => updateFact(index, { selected: event.target.checked })} /><strong>{fact.entity || '剧情事实'} · {fact.key}</strong></label><blockquote>{fact.quote}</blockquote><div className="lit-form-grid"><Field label="事实实体名称"><input maxLength={100} value={fact.entity} onChange={event => updateFact(index, { entity: event.target.value })} /></Field><Field label="事实分类"><select value={fact.kind} onChange={event => updateFact(index, { kind: event.target.value })}><option value="state">当前状态</option><option value="event">事件</option><option value="knowledge">人物认知</option><option value="foreshadow">伏笔</option></select></Field></div><Field label="事实名称"><input maxLength={100} value={fact.key} onChange={event => updateFact(index, { key: event.target.value })} /></Field><Field label="事实内容"><textarea rows={2} maxLength={2000} value={fact.value} onChange={event => updateFact(index, { value: event.target.value })} /></Field><div className="lit-form-grid"><Field label="事件时序"><select value={fact.chronology} onChange={event => updateFact(index, { chronology: event.target.value })}><option value="unknown">待核实</option><option value="current">当前剧情</option><option value="flashback">回忆 / 倒叙</option></select></Field><Field label="故事时间"><input maxLength={200} value={fact.story_time} onChange={event => updateFact(index, { story_time: event.target.value })} /></Field></div><AccessFields value={fact} onChange={patch => updateFact(index, patch)} /></article>)}</section>
      {!readonly && <footer><span>{entryForms.filter(item => item.selected).length} 个框架 · {factForms.filter(item => item.selected).length} 条事实</span><button type="submit" className="lit-button primary" disabled={pending || (result.issues?.length > 0 && !acknowledgeIssues)}><Icon.CheckCircle size={16} />确认本段与所选资料</button></footer>}
    </fieldset></form>}
  </div>
}
function AccessFields({ value, onChange }) {
  return <div className="lit-form-grid"><Field label="公开程度"><select value={value.visibility} onChange={event => onChange({ visibility: event.target.value })}><option value="unknown">待核实</option><option value="public">公开事实</option><option value="private">限定人物知情</option></select></Field>{value.visibility === 'private' && <Field label="知情人物"><NamesInput value={value.known_by} onChange={names => onChange({ known_by: names })} /></Field>}</div>
}
function NamesInput({ value, onChange, ...props }) {
  const [input, setInput] = useState(value.join('，'))
  return <input {...props} value={input} onChange={event => { setInput(event.target.value); onChange(splitNames(event.target.value)) }} />
}
