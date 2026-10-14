import { useState } from 'react'
import { Icon } from './Icons'

const BRANCHES = [
  { label: '剧情框架', kinds: ['outline', 'volume', 'mainline', 'subplot', 'plot', 'foreshadow'] },
  { label: '人物与世界', kinds: ['character', 'item', 'scene', 'faction', 'world'] },
  { label: '创作规范', kinds: ['style'] },
]

export default function LiteratureFrameworkTree({ entries, chapters, categories, route, onSelect, onAdd, onDraft, onAddDraft }) {
  const [expanded, setExpanded] = useState(() => new Set(['剧情框架', route.view === 'drafts' ? 'drafts' : '', route.kind].filter(Boolean)))
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [query, setQuery] = useState('')
  const ancestors = new Set(route.kind ? [route.kind] : [])
  const selectedBranch = BRANCHES.find(branch => branch.kinds.includes(route.kind))
  if (selectedBranch) ancestors.add(selectedBranch.label)
  if (route.view === 'drafts') ancestors.add('drafts')
  let selected = entries.find(item => item.id === (route.entryId === 'new' ? route.parentId : route.entryId))
  while (selected && !ancestors.has(selected.id)) { ancestors.add(selected.id); ancestors.add(selected.kind); selected = entries.find(item => item.id === selected.parent_id) }
  const isExpanded = key => Boolean(query.trim()) || expanded.has(key) || (ancestors.has(key) && !collapsed.has(key))
  const toggle = key => {
    const wasOpen = isExpanded(key)
    setExpanded(current => { const next = new Set(current); if (wasOpen) next.delete(key); else next.add(key); return next })
    setCollapsed(current => { const next = new Set(current); if (wasOpen) next.add(key); else next.delete(key); return next })
  }
  const entryIds = new Set(entries.map(entry => entry.id))
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matches = new Set(entries.filter(entry => entry.title.toLocaleLowerCase().includes(normalizedQuery)).map(entry => entry.id))
  for (const id of [...matches]) {
    let entry = entries.find(item => item.id === id)
    const visited = new Set()
    while (entry?.parent_id && !visited.has(entry.parent_id)) { visited.add(entry.parent_id); matches.add(entry.parent_id); entry = entries.find(item => item.id === entry.parent_id) }
  }
  const children = new Map()
  for (const entry of entries) {
    if (normalizedQuery && !matches.has(entry.id)) continue
    const parent = entry.parent_id && entryIds.has(entry.parent_id) ? entry.parent_id : entry.kind
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent).push(entry)
  }
  function node(entry, depth = 1) {
    const descendants = children.get(entry.id) || []
    return <li key={entry.id}>
      <div className={`lit-tree-row ${route.entryId === entry.id ? 'active' : ''}`} style={{ paddingLeft: Math.min(depth, 5) * 10 }}>
        {descendants.length ? <button type="button" className="lit-tree-toggle" aria-label={`${isExpanded(entry.id) ? '收起' : '展开'} ${entry.title}`} aria-expanded={isExpanded(entry.id)} onClick={() => toggle(entry.id)}><Icon.ChevronRight size={12} /></button> : <span className="lit-tree-toggle-spacer" />}
        <button type="button" className="lit-tree-label" title={entry.title} aria-current={route.entryId === entry.id ? 'page' : undefined} onClick={() => onSelect(entry.kind, entry.id)}><span className={`lit-tree-dot ${entry.status === 'candidate' ? 'candidate' : ''}`} /><span>{entry.title}</span>{entry.locked && <small>锁</small>}</button>
        <button type="button" className="lit-tree-add" aria-label={`为 ${entry.title} 新增子节点`} title="新增子节点" onClick={() => { setExpanded(current => new Set([...current, entry.id])); onAdd(entry.kind, entry.id) }}><Icon.Plus size={12} /></button>
      </div>
      {descendants.length > 0 && isExpanded(entry.id) && <ul>{descendants.map(child => node(child, depth + 1))}</ul>}
    </li>
  }
  return <nav className="lit-framework-tree" aria-label="创作框架树">
    <div className="lit-tree-search"><Icon.Search size={14} /><input aria-label="搜索创作框架与计划" placeholder="搜索框架与计划" value={query} onChange={event => setQuery(event.target.value)} /></div>
    {BRANCHES.map(branch => <section className="lit-tree-branch" key={branch.label}>
      <button type="button" className="lit-tree-branch-heading" aria-expanded={isExpanded(branch.label)} onClick={() => toggle(branch.label)}><Icon.ChevronRight size={12} /><span>{branch.label}</span></button>
      {isExpanded(branch.label) && <ul>{branch.kinds.filter(kind => !normalizedQuery || entries.some(entry => entry.kind === kind && matches.has(entry.id))).map(kind => <li key={kind}>
        <div className={`lit-tree-row folder ${route.kind === kind && !route.entryId ? 'active' : ''}`}>
          <button type="button" className="lit-tree-toggle" aria-label={`${isExpanded(kind) ? '收起' : '展开'} ${categories[kind]}`} aria-expanded={isExpanded(kind)} onClick={() => toggle(kind)}><Icon.ChevronRight size={12} /></button>
          <button type="button" className="lit-tree-label" onClick={() => { setExpanded(current => new Set([...current, kind])); onSelect(kind) }}><Icon.Folder size={14} /><span>{categories[kind]}</span><small>{entries.filter(entry => entry.kind === kind).length}</small></button>
          <button type="button" className="lit-tree-add" aria-label={`新增${categories[kind]}节点`} title="新增节点" onClick={() => { setExpanded(current => new Set([...current, kind])); onAdd(kind) }}><Icon.Plus size={12} /></button>
        </div>
        {isExpanded(kind) && <ul>{(children.get(kind) || []).map(entry => node(entry))}{!(children.get(kind) || []).length && <li className="lit-tree-empty">暂无节点</li>}</ul>}
      </li>)}</ul>}
    </section>)}
    <section className="lit-tree-branch">
      <div className="lit-tree-row"><button type="button" className="lit-tree-branch-heading" aria-expanded={isExpanded('drafts')} onClick={() => toggle('drafts')}><Icon.ChevronRight size={12} /><span>创作计划</span></button><button type="button" className="lit-tree-add" aria-label="新建创作计划" title="新建创作计划" onClick={onAddDraft}><Icon.Plus size={12} /></button></div>
      {isExpanded('drafts') && <ul className="lit-plan-tree">{chapters.filter(chapter => chapter.title.toLocaleLowerCase().includes(normalizedQuery)).map(chapter => <li key={chapter.id}><div className={`lit-tree-row ${route.chapterId === chapter.id && route.view === 'drafts' ? 'active' : ''}`} style={{ paddingLeft: 10 }}><span className="lit-tree-toggle-spacer" /><button type="button" className="lit-tree-label" title={chapter.title} onClick={() => onDraft(chapter.id)}><Icon.Pen size={13} /><span>{chapter.title}</span><small>{chapter.accepted_revision ? '修订' : '构思'}</small></button></div></li>)}{!chapters.length && <li className="lit-tree-empty">暂无创作计划</li>}</ul>}
    </section>
  </nav>
}
